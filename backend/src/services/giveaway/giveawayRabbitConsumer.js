/**
 * Giveaway email RabbitMQ consumer — implements the handoff doc (CloudAMQP → consume → SMTP).
 *
 * Transport:  RabbitMQ (CloudAMQP `rayna-normal`), NOT our BullMQ. The producer (Ankit)
 *             publishes fully-rendered emails to the `giveaways` topic exchange; we own the
 *             queue, idempotency, send, retries and DLQ.
 *
 * Doc rules honoured:
 *   §1  ONE connection per process (Little Lemur caps at 20 shared with the producer).
 *   §2  We declare queue + binding + DLX/DLQ (re-asserted on every (re)connect — idempotent).
 *   §4  prefetch(10), manual ack; idempotency via Redis SET NX; poison → ack+log (never requeue);
 *       transient send failure → in-process retry → then nack(false,false) → DLQ. Never requeue.
 *   §5  Send via SMTP (nodemailer) — text = body verbatim, html = escaped + nl2br; id in a header.
 *
 * Sending is gated by GIVEAWAY_SEND_ENABLED (default OFF → log-only), so the consumer can run
 * and declare topology (unblocking the producer) before we flip real sending on.
 */
import amqp from 'amqplib';
import nodemailer from 'nodemailer';
import { getConnection } from '../queue/index.js';   // reuse ioredis for idempotency
import { ingestGiveawayEvent } from './giveawayIngest.js';

// The producer publishes `giveaway.email.<env>.<type>` (4 segments). All environments share
// ONE CloudAMQP vhost, so the <env> segment is what keeps dev draws out of prod mailboxes.
// A topic `*` matches exactly one segment — the old `giveaway.email.*` matched nothing the
// producer sends, so the exchange silently discarded every message.
// GIVEAWAY_ENV must equal the producer's ENVIRONMENT, normalised the same way (lowercase,
// non-alphanumerics → '-'). Unset → consumer stays idle: never bind to every env's mail.
const ENV = (process.env.GIVEAWAY_ENV || '').trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const EXCHANGE = 'giveaways';
const QUEUE    = `giveaways.email.send.${ENV}`;
const BINDING  = `giveaway.email.${ENV}.*`;
const DLX      = `giveaways.dlx.${ENV}`;       // per env: a shared fanout DLX would copy dead letters into every env's DLQ
const DLQ      = `giveaways.email.dlq.${ENV}`;

const PREFETCH     = parseInt(process.env.GIVEAWAY_PREFETCH || '10', 10);
const DEDUPE_TTL   = parseInt(process.env.GIVEAWAY_DEDUPE_TTL_SEC || '604800', 10); // 7 days
const MAX_RETRIES  = parseInt(process.env.GIVEAWAY_MAX_SEND_RETRIES || '3', 10);
const SEND_ENABLED = process.env.GIVEAWAY_SEND_ENABLED === 'true';
const CONN_NAME    = process.env.GIVEAWAY_CONNECTION_NAME || 'rayna-giveaway-consumer';

const VALID_TYPES = new Set(['participation', 'eligible', 'winner', 'loser']);
const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

let _conn = null, _ch = null, _transporter = null, _stopped = false, _reconnectMs = 1000;

// ── SMTP transport (lazy) ──
function smtp() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.GIVEAWAY_SMTP_HOST,
    port: parseInt(process.env.GIVEAWAY_SMTP_PORT || '465'),
    secure: process.env.GIVEAWAY_SMTP_SECURE === 'true',
    auth: { user: process.env.GIVEAWAY_SMTP_USER, pass: process.env.GIVEAWAY_SMTP_PASS },
  });
  return _transporter;
}

// ── §3 contract validation ──
function validate(p) {
  if (!p || typeof p !== 'object')                return { ok: false, reason: 'not_an_object' };
  if (p.version !== 1)                             return { ok: false, reason: `unknown_version:${p.version}` };
  if (!p.id)                                       return { ok: false, reason: 'missing_id' };
  if (!VALID_TYPES.has(p.type))                    return { ok: false, reason: `bad_type:${p.type}` };
  if (!p.to?.email || !EMAIL_RE.test(p.to.email))  return { ok: false, reason: 'invalid_email' };
  if (!p.subject)                                  return { ok: false, reason: 'missing_subject' };
  if (typeof p.body !== 'string')                  return { ok: false, reason: 'missing_body' };
  return { ok: true };
}

// plain body → HTML part (escape, then newlines → <br>). body is admin-authored → treat as untrusted.
function bodyToHtml(body) {
  const esc = String(body).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">${esc.replace(/\r?\n/g, '<br>')}</div>`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Recent captured events → a capped Redis list, so the web API (a different process) can
// read them and the frontend can toast them. Recording must NEVER break the consumer.
const EVENTS_KEY = 'giveaway:mq:events';
async function record(evt) {
  try {
    await getConnection().multi()
      .lpush(EVENTS_KEY, JSON.stringify({ ...evt, ts: Date.now() }))
      .ltrim(EVENTS_KEY, 0, 199)
      .expire(EVENTS_KEY, 604800)
      .exec();
  } catch { /* ignore */ }
}

// ── message handler ──
async function handle(msg) {
  const raw = msg.content.toString();
  let p;
  try { p = JSON.parse(raw); }
  catch {
    console.warn('[GiveawayMQ] ⛔ malformed JSON — ack+drop');
    await record({ outcome: 'poison', reason: 'malformed_json' });
    return _ch.ack(msg);
  }

  const tag = `[GiveawayMQ] id=${p?.id ?? '?'} type=${p?.type ?? '?'}`;
  // meta = light fields the toast uses; payload = parsed §3 message; raw = exact wire string.
  const meta = { id: p?.id ?? null, type: p?.type ?? null, email: p?.to?.email ?? null, name: p?.to?.name ?? null, subject: p?.subject ?? null, payload: p ?? null, raw };

  // 1. contract validation → poison acked + logged, NEVER requeued
  const v = validate(p);
  if (!v.ok) {
    console.warn(`${tag} ⛔ POISON (${v.reason}) — ack+drop`);
    await record({ ...meta, outcome: 'poison', reason: v.reason });
    return _ch.ack(msg);
  }

  // 1b. PERSIST — upsert contact (no duplicates) + store the event (idempotent on id),
  // then real-time enrol into any matching giveaway journey (segment-gated, like GTM).
  // Runs for EVERY valid message, independent of send-enabled, and safe on redelivery
  // (contact upsert + event insert + journey entry are all idempotent).
  try {
    const { unifiedId } = await ingestGiveawayEvent(p);
    if (unifiedId) {
      const { default: GiveawayJourneyService } = await import('../GiveawayJourneyService.js');
      await GiveawayJourneyService.onEvent({ giveawayType: p.type, unifiedId, eventId: p.id });
    }
  } catch (e) {
    console.error(`${tag} ⚠️ ingest/journey failed (continuing): ${e.message}`);
  }

  // 2. idempotency — claim BEFORE sending; duplicate redelivery is a no-op
  const redis = getConnection();
  const claimed = await redis.set(`giveaway:email:${p.id}`, '1', 'NX', 'EX', DEDUPE_TTL);
  if (claimed === null) {
    console.log(`${tag} 🔁 DUPLICATE — ack`);
    await record({ ...meta, outcome: 'duplicate' });
    return _ch.ack(msg);
  }

  // 3. send (or log-only), with transient-failure retries → DLQ
  if (!SEND_ENABLED) {
    console.log(`${tag} ✅ RECEIVED (GIVEAWAY_SEND_ENABLED!=true → log-only) <${p.to.email}> subject="${p.subject}"`);
    await record({ ...meta, outcome: 'received' });
    return _ch.ack(msg);
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const info = await smtp().sendMail({
        from: process.env.GIVEAWAY_FROM,
        to: p.to.name ? `${p.to.name} <${p.to.email}>` : p.to.email,
        subject: p.subject,
        text: p.body,                       // verbatim
        html: bodyToHtml(p.body),           // escaped + nl2br
        headers: { 'X-Giveaway-Email-Id': String(p.id) },  // for bounce reconciliation
      });
      console.log(`${tag} ✅ SENT <${p.to.email}> msgId=${info.messageId}`);
      await record({ ...meta, outcome: 'sent', msgId: info.messageId });
      return _ch.ack(msg);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(500 * attempt + Math.floor(Math.random() * 300)); // jittered backoff
    }
  }
  // all retries failed → release the claim so a DLQ replay can retry, then DLQ (no requeue)
  await redis.del(`giveaway:email:${p.id}`).catch(() => {});
  console.error(`${tag} ❌ SEND FAILED after ${MAX_RETRIES} tries: ${lastErr?.message} — nack→DLQ`);
  await record({ ...meta, outcome: 'failed', reason: lastErr?.message });
  return _ch.nack(msg, false, false);
}

// ── topology (idempotent; re-asserted on every connect) ──
async function assertTopology(ch) {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, '');
  await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX } });
  await ch.bindQueue(QUEUE, EXCHANGE, BINDING);
}

async function connect() {
  if (_stopped) return;
  const url = process.env.GIVEAWAY_RABBITMQ_URL;
  if (!url) { console.warn('[GiveawayMQ] GIVEAWAY_RABBITMQ_URL not set — consumer idle (set it to connect).'); return; }
  if (!ENV) { console.warn('[GiveawayMQ] GIVEAWAY_ENV not set — consumer idle (set it to the producer\'s ENVIRONMENT, e.g. prod).'); return; }

  try {
    _conn = await amqp.connect(url, { heartbeat: 30, clientProperties: { connection_name: CONN_NAME } });
    _conn.on('error', (e) => console.error(`[GiveawayMQ] connection error: ${e.message}`));
    _conn.on('close', () => { if (!_stopped) scheduleReconnect('connection closed'); });

    _ch = await _conn.createChannel();
    await assertTopology(_ch);            // re-assert on every (re)connect — idempotent
    await _ch.prefetch(PREFETCH);
    await _ch.consume(QUEUE, (msg) => { if (msg) handle(msg).catch(e => { console.error('[GiveawayMQ] handler crash:', e.message); try { _ch.nack(msg, false, false); } catch {} }); }, { noAck: false });

    _reconnectMs = 1000;
    console.log(`[GiveawayMQ] connected (conn="${CONN_NAME}") — consuming ${QUEUE} (bound ${BINDING}) prefetch=${PREFETCH} send=${SEND_ENABLED ? 'ENABLED' : 'log-only'}`);
  } catch (err) {
    scheduleReconnect(`connect failed: ${err.message}`);
  }
}

function scheduleReconnect(why) {
  _ch = null; _conn = null;
  if (_stopped) return;
  const delay = Math.min(_reconnectMs, 30_000);
  console.warn(`[GiveawayMQ] ${why} — reconnecting in ${delay}ms`);
  setTimeout(connect, delay);
  _reconnectMs = Math.min(_reconnectMs * 2, 30_000);
}

export async function startGiveawayRabbitConsumer() {
  _stopped = false;
  await connect();
}

export async function stopGiveawayRabbitConsumer() {
  _stopped = true;
  try { await _ch?.close(); } catch {}
  try { await _conn?.close(); } catch {}
  _ch = null; _conn = null;
}
