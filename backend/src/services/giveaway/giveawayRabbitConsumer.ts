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
import type { Channel, ChannelModel, ConsumeMessage, SocketOptions } from 'amqplib';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type {
  RedisSetNxEx, GiveawayMessage, GiveawayValidation,
  GiveawayFeedSource, GiveawayType, AffiliateType, AffiliateBlockKey, LifecycleType,
} from '../../types/giveaway.js';
import nodemailer from 'nodemailer';
import { getConnection } from '../queue/index.js';   // reuse ioredis for idempotency
import { ingestGiveawayEvent, ingestLifecycleEvent } from './giveawayIngest.js';
import { SendTrackService } from '../SendTrackService.js';
import type { OtpSendResult } from './otpSend.js';   // log direct sends to email_send_log

// The producer publishes `giveaway.email.<env>.<type>` (4 segments). A topic `*` matches exactly
// ONE segment, so the old `giveaway.email.*` matched nothing and the exchange silently dropped
// every message. Only prod exists today, so the env is hard-coded; bind `giveaway.email.<env>.*`
// per env (with env-suffixed queues) if a second environment ever shares this vhost.
const EXCHANGE = 'giveaways';
const QUEUE    = 'giveaways.email.send';
const BINDING  = 'giveaway.email.prod.*';
const DLX      = 'giveaways.dlx';
const DLQ      = 'giveaways.email.dlq';

const PREFETCH     = parseInt(process.env.GIVEAWAY_PREFETCH || '10', 10);
const DEDUPE_TTL   = parseInt(process.env.GIVEAWAY_DEDUPE_TTL_SEC || '604800', 10); // 7 days
const MAX_RETRIES  = parseInt(process.env.GIVEAWAY_MAX_SEND_RETRIES || '3', 10);
const SEND_ENABLED = process.env.GIVEAWAY_SEND_ENABLED === 'true';
const CONN_NAME    = process.env.GIVEAWAY_CONNECTION_NAME || 'rayna-giveaway-consumer';

const EMAIL_RE    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ── AFFILIATE feed ─────────────────────────────────────────────────────────
// The affiliate app publishes to the SAME exchange on the SAME vhost, differing only by
// routing key: `affiliate.email.<env>.<type>`. It gets its OWN queue so a problem in one
// feed can never stall the other.
//
// ⚠️ ALL FOUR ENVIRONMENTS (dev/test/pre-prod/prod) SHARE THIS ONE VHOST. Bind only our
// env's key — `affiliate.email.#` would pull dev/test events into prod and email real
// people from test data.
const AFF_QUEUE   = process.env.AFFILIATE_QUEUE || 'affiliate-emails-prod';
const AFF_BINDING = process.env.AFFILIATE_BINDING || 'affiliate.email.prod.*';

// ── OTP feed ───────────────────────────────────────────────────────────────
// `phone.otp.<env>.send` on the same exchange. Self-addressed (the payload names the phone),
// so it carries no email, no contact and no segment — see otpSend.js. Gated by OTP_ENABLED so
// the queue can be declared and drained to a log before real codes go out.
// ⚠️ Prod key only, for the same reason as AFF_BINDING: all four envs share this vhost.
const OTP_QUEUE   = process.env.OTP_QUEUE   || 'otp.send.prod';
const OTP_BINDING = process.env.OTP_BINDING || 'phone.otp.prod.*';
const OTP_ENABLED = process.env.OTP_ENABLED === 'true';

// ── LIFECYCLE feed ─────────────────────────────────────────────────────────
// `giveaway.lifecycle.<env>.<type>` on the same exchange, published whenever an admin SAVES a
// giveaway. The payload describes the GIVEAWAY, not a person: no `to`, no subject, no body,
// plus a `changes` array naming which fields moved.
//
// Until this queue existed the exchange matched these against nothing and DISCARDED them at
// publish time — no queue, no DLQ, no counter, no trace. Capture begins at first connect;
// everything published before that is unrecoverable.
// ⚠️ Prod key only, for the same reason as AFF_BINDING: all four envs share this vhost.
const LC_QUEUE   = process.env.LIFECYCLE_QUEUE   || 'giveaways.lifecycle.prod';
const LC_BINDING = process.env.LIFECYCLE_BINDING || 'giveaway.lifecycle.prod.*';
// Off by default. The queue is still bound and consumed so messages are captured and acked
// rather than piling up behind an unconsumed binding; the flag gates PERSISTING and
// ENROLLING — i.e. whether anyone actually gets mailed.
const LC_ENABLED = process.env.GIVEAWAY_LIFECYCLE_ENABLED === 'true';

// Which `changes[]` fields justify mailing a whole segment. The producer fires on EVERY save,
// including a typo fix, and each one that gets through costs one email per segment member —
// so the default is the single meaningful field. Set the var to an empty string to notify on
// every edit.
const NOTIFY_FIELDS = (process.env.GIVEAWAY_UPDATED_NOTIFY_FIELDS ?? 'endAt')
  .split(',').map(s => s.trim()).filter(Boolean);

// Event types per source. A type outside its source's set is poison (ack + drop, never requeued).
const TYPES_BY_SOURCE: Record<GiveawayFeedSource, ReadonlySet<string>> = {
  GIVEAWAY:  new Set<GiveawayType>(['participation', 'eligible', 'winner', 'loser']),
  AFFILIATE: new Set<AffiliateType>(['joined', 'coupon_assigned', 'commission_assigned', 'link_generated', 'card_offer_generated']),
  OTP:       new Set(['otp']),
  LIFECYCLE: new Set<LifecycleType>(['updated']),
};
// The affiliate block that must accompany each type (it carries the event's actual data).
const AFF_BLOCK_FOR_TYPE: Record<AffiliateType, AffiliateBlockKey> = {
  joined:                'coupon',
  coupon_assigned:       'coupon',
  commission_assigned:   'commission',
  link_generated:        'link',
  card_offer_generated:  'cardOffer',
};

/**
 * Source from the routing key — `affiliate.*` → AFFILIATE, `phone.*` → OTP,
 * `giveaway.lifecycle.*` → LIFECYCLE, anything else → GIVEAWAY.
 *
 * The lifecycle test must read the SECOND segment: those keys also start with `giveaway`,
 * so a first-segment-only split classes them as GIVEAWAY and validate() then rejects every
 * one of them twice over — `bad_type:updated`, then `invalid_email` — for failing an email
 * contract they were never meant to satisfy.
 */
export function sourceFromRoutingKey(rk: string | null | undefined): GiveawayFeedSource {
  const seg = String(rk || '').toLowerCase().split('.');
  if (seg[0] === 'affiliate') return 'AFFILIATE';
  if (seg[0] === 'phone')     return 'OTP';
  if (seg[0] === 'giveaway' && seg[1] === 'lifecycle') return 'LIFECYCLE';
  return 'GIVEAWAY';
}

let _conn: ChannelModel | null = null, _ch: Channel | null = null, _transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null, _stopped = false, _reconnectMs = 1000;
let _reconnectTimer: NodeJS.Timeout | null = null;
let _connecting = false;

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
export function validate(p: GiveawayMessage | null | undefined, source: GiveawayFeedSource = 'GIVEAWAY'): GiveawayValidation {
  if (!p || typeof p !== 'object')                return { ok: false, reason: 'not_an_object' };
  if (p.version !== 1)                             return { ok: false, reason: `unknown_version:${p.version}` };
  if (!p.id)                                       return { ok: false, reason: 'missing_id' };
  const types = TYPES_BY_SOURCE[source] || TYPES_BY_SOURCE.GIVEAWAY;
  if (!p.type || !types.has(p.type))                          return { ok: false, reason: `bad_type:${p.type}` };
  // LIFECYCLE messages describe a GIVEAWAY, not a person — no recipient, subject or body.
  // Like OTP, this must return before the email contract below, which rejects all of them.
  if (source === 'LIFECYCLE') {
    if (!p.giveawayId)                             return { ok: false, reason: 'missing_giveawayId' };
    return { ok: true };
  }
  // OTP messages are addressed by PHONE and carry no email, subject or body — so they must
  // return before the email contract below, which would otherwise reject every one of them.
  if (source === 'OTP') {
    if (!p.to?.phone)                              return { ok: false, reason: 'missing_phone' };
    if (!p.code)                                   return { ok: false, reason: 'missing_code' };
    if (!p.expiresAt)                              return { ok: false, reason: 'missing_expiresAt' };
    return { ok: true };
  }

  if (!p.to?.email || !EMAIL_RE.test(p.to.email))  return { ok: false, reason: 'invalid_email' };

  if (source === 'AFFILIATE') {
    // Affiliate messages carry DATA, not a rendered email — there is no subject/body to
    // require. Instead the type-specific block must be present; the journey template turns
    // it into the actual email.
    const block: AffiliateBlockKey | undefined = AFF_BLOCK_FOR_TYPE[p.type as AffiliateType];
    const blockValue: unknown = block ? p[block] : undefined;
    if (block && (blockValue == null || typeof blockValue !== 'object')) {
      return { ok: false, reason: `missing_block:${block}` };
    }
    return { ok: true };
  }

  // GIVEAWAY messages ARE a pre-rendered email — subject + body are mandatory.
  if (!p.subject)                                  return { ok: false, reason: 'missing_subject' };
  if (typeof p.body !== 'string')                  return { ok: false, reason: 'missing_body' };
  return { ok: true };
}

// plain body → HTML part (escape, then newlines → <br>). body is admin-authored → treat as untrusted.
function bodyToHtml(body: string | undefined): string {
  const esc = String(body).replace(/[&<>"]/g, ch => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[ch]));
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">${esc.replace(/\r?\n/g, '<br>')}</div>`;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// Recent captured events → a capped Redis list, so the web API (a different process) can
// read them and the frontend can toast them. Recording must NEVER break the consumer.
const EVENTS_KEY = 'giveaway:mq:events';

interface GiveawayMqEvent {
  outcome: string;
  reason?: string;
  msgId?: string;
  id?: string | number | null;
  type?: string | null;
  source?: GiveawayFeedSource;
  journeys?: number;
  email?: string | null;
  name?: string | null;
  subject?: string | null;
  payload?: GiveawayMessage | null;
  raw?: string;
  wamid?: string | null;
}
async function record(evt: GiveawayMqEvent): Promise<void> {
  try {
    await getConnection().multi()
      .lpush(EVENTS_KEY, JSON.stringify({ ...evt, ts: Date.now() }))
      .ltrim(EVENTS_KEY, 0, 199)
      .expire(EVENTS_KEY, 604800)
      .exec();
  } catch { /* ignore */ }
}

// ── message handler ──
// ch = the channel this message was delivered on. After a reconnect the module-level
// _ch is a NEW channel, and acking an old delivery tag on it closes that channel.
async function handle(msg: ConsumeMessage, ch: Channel): Promise<void> {
  const raw = msg.content.toString();
  // Which feed this came from — decides the valid types, the validation rules and whether
  // the producer supplied an email body at all.
  const source = sourceFromRoutingKey(msg.fields?.routingKey);
  let p: GiveawayMessage;
  try { p = JSON.parse(raw) as GiveawayMessage; }
  catch {
    console.warn('[GiveawayMQ] ⛔ malformed JSON — ack+drop');
    await record({ outcome: 'poison', reason: 'malformed_json' });
    return ch.ack(msg);
  }

  const LABEL: Record<GiveawayFeedSource, string> = { AFFILIATE: 'AffiliateMQ', OTP: 'OtpMQ', GIVEAWAY: 'GiveawayMQ', LIFECYCLE: 'LifecycleMQ' };
  const tag = `[${LABEL[source]}] id=${p?.id ?? '?'} type=${p?.type ?? '?'}`;
  // meta = light fields the toast uses; payload = parsed §3 message; raw = exact wire string.
  const meta = { id: p?.id ?? null, type: p?.type ?? null, source, email: p?.to?.email ?? null, name: p?.to?.name ?? null, subject: p?.subject ?? null, payload: p ?? null, raw };

  // 1. contract validation → poison acked + logged, NEVER requeued
  const v = validate(p, source);
  if (!v.ok) {
    console.warn(`${tag} ⛔ POISON (${v.reason}) — ack+drop`);
    await record({ ...meta, outcome: 'poison', reason: v.reason });
    return ch.ack(msg);
  }

  // 1a. OTP — send and stop. Nothing is persisted: no contact (the requester is not a marketing
  // contact), no giveaway_affiliate_events row, no journey entry. The journey named by
  // OTP_JOURNEY_ID supplies the channel + template only. Always ack — a verification code is
  // worthless by the time a retry would land, and the queue's x-message-ttl expires the rest.
  if (source === 'OTP') {
    if (!OTP_ENABLED) {
      console.log(`${tag} 🔕 OTP_ENABLED=false — not sending (phone=${p?.to?.phone ?? '?'})`);
      await record({ ...meta, outcome: 'otp_disabled' });
      return ch.ack(msg);
    }
    let r: OtpSendResult;
    try {
      const { sendOtp } = await import('./otpSend.js');
      r = await sendOtp(p);
    } catch (e) {
      r = { ok: false, error: `crash:${(e as Error).message}` };
    }
    if (r.ok) console.log(`${tag} ✅ OTP sent wamid=${r.wamid ?? '-'}`);
    else      console.warn(`${tag} ⛔ OTP send failed: ${r.error}`);
    await record({ ...meta, outcome: r.ok ? 'otp_sent' : 'otp_failed', reason: r.error, wamid: r.wamid ?? null });
    return ch.ack(msg);
  }

  // 1a-bis. LIFECYCLE — an admin edited a giveaway. There is no recipient and no email to
  // send, so this branch stores the event and hands it to the BROADCAST path, then stops. It
  // must return before the dedupe/SMTP block below, which exists only to send the producer's
  // own direct email (mirroring the AFFILIATE early return further down).
  if (source === 'LIFECYCLE') {
    if (!LC_ENABLED) {
      console.log(`${tag} 🔕 GIVEAWAY_LIFECYCLE_ENABLED=false — captured, not acted on (changes=${JSON.stringify(p.changes ?? null)})`);
      await record({ ...meta, outcome: 'lifecycle_disabled' });
      return ch.ack(msg);
    }
    // FIELD GATE — the producer fires on every save, and one event here costs one email per
    // segment member. Fail CLOSED when `changes` is missing or unusable: we cannot tell what
    // moved, and guessing wrong mails the entire segment.
    if (NOTIFY_FIELDS.length) {
      const changed = Array.isArray(p.changes) ? p.changes.map(String) : null;
      const hit = changed ? changed.filter(f => NOTIFY_FIELDS.includes(f)) : [];
      if (!changed || !hit.length) {
        const why = changed ? `changes=[${changed.join(',')}] ∉ [${NOTIFY_FIELDS.join(',')}]` : 'no changes[] on the payload';
        console.log(`${tag} 🔕 not a notifying edit (${why}) — stored only`);
        try { await ingestLifecycleEvent(p); } catch (e) { console.error(`${tag} ⚠️ lifecycle ingest failed: ${(e as Error).message}`); }
        await record({ ...meta, outcome: 'lifecycle_ignored', reason: why });
        return ch.ack(msg);
      }
      console.log(`${tag} 📣 notifying edit — changed [${changed.join(',')}], matched [${hit.join(',')}]`);
    }

    let cohort = 0;
    try {
      // Ingest FIRST: the broadcast email reads this row for {{ giveaway }}, {{ giveaway_ends_at }}…
      await ingestLifecycleEvent(p);
      const { default: GiveawayJourneyService } = await import('../GiveawayJourneyService.js');
      cohort = await GiveawayJourneyService.onLifecycleEvent({
        lifecycleType: p.type, giveawayId: p.giveawayId, eventId: p.id,
      });
    } catch (e) {
      console.error(`${tag} ⚠️ lifecycle ingest/broadcast failed: ${(e as Error).message}`);
    }
    console.log(`${tag} ✅ lifecycle stored — broadcast to ${cohort} contact(s)`);
    await record({ ...meta, outcome: 'lifecycle', journeys: cohort });
    return ch.ack(msg);
  }

  // 1b. PERSIST — upsert contact (no duplicates) + store the event (idempotent on id),
  // then real-time enrol into any matching giveaway journey (segment-gated, like GTM).
  // Runs for EVERY valid message, independent of send-enabled, and safe on redelivery
  // (contact upsert + event insert + journey entry are all idempotent).
  let journeyHandled = 0;
  let unifiedId: number | null = null;
  try {
    ({ unifiedId } = await ingestGiveawayEvent(p, source));
    if (unifiedId) {
      const { default: GiveawayJourneyService } = await import('../GiveawayJourneyService.js');
      journeyHandled = (await GiveawayJourneyService.onEvent({ giveawayType: p.type, unifiedId, eventId: p.id, source })) || 0;
    }
  } catch (e) {
    console.error(`${tag} ⚠️ ingest/journey failed (continuing): ${(e as Error).message}`);
  }

  // AFFILIATE messages carry no email body, so there is nothing to "send directly" — the
  // journey template is the only possible email. Stop here either way: enrolled or not, a
  // direct send is impossible. (This also keeps store-only types like link_generated silent.)
  if (source === 'AFFILIATE') {
    console.log(`${tag} ✅ stored${journeyHandled ? ` — enrolled in ${journeyHandled} journey(s)` : ' — no matching journey (store-only)'}`);
    await record({ ...meta, outcome: 'stored', journeys: journeyHandled });
    return ch.ack(msg);
  }

  // 1c. DEDUP THE EMAIL: when a giveaway JOURNEY handles this contact (active journey for this
  // type + segment member), the journey's template email is the ONLY email we want — so DO NOT
  // also send the producer's direct email (that was the duplicate). We only fall through to the
  // direct send below when NO journey handles the contact (fallback, so they're not left without
  // any email).
  if (journeyHandled > 0) {
    console.log(`${tag} ✉️ handled by ${journeyHandled} giveaway journey(s) — skipping direct send (journey email only)`);
    await record({ ...meta, outcome: 'journey_handled' });
    return ch.ack(msg);
  }

  // 2. idempotency — claim BEFORE sending; duplicate redelivery is a no-op
  const redis = getConnection();
  const claimed = await (redis.set as unknown as RedisSetNxEx)(`giveaway:email:${p.id}`, '1', 'NX', 'EX', DEDUPE_TTL);
  if (claimed === null) {
    console.log(`${tag} 🔁 DUPLICATE — ack`);
    await record({ ...meta, outcome: 'duplicate' });
    return ch.ack(msg);
  }

  // 3. send (or log-only), with transient-failure retries → DLQ
  if (!SEND_ENABLED) {
    console.log(`${tag} ✅ RECEIVED (GIVEAWAY_SEND_ENABLED!=true → log-only) <${p.to!.email}> subject="${p.subject}"`);
    await record({ ...meta, outcome: 'received' });
    return ch.ack(msg);
  }

  // Log the direct send to email_send_log too (not just the Redis events list), so giveaway
  // emails are visible in the Send Log screen like every other channel. source='giveaway'.
  let logId: number | null = null;
  const _started = Date.now();
  try {
    logId = await SendTrackService.logSend({
      unifiedId, email: p.to!.email, contactName: p.to!.name || null,
      subject: p.subject, templateLabel: `Giveaway: ${p.type}`, source: 'giveaway',
    } as Parameters<typeof SendTrackService.logSend>[0]);
  } catch { /* logging must never block the send */ }

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const info = await smtp().sendMail({
        from: process.env.GIVEAWAY_FROM,
        to: p.to!.name ? `${p.to!.name} <${p.to!.email}>` : p.to!.email,
        subject: p.subject,
        text: p.body,                       // verbatim
        html: bodyToHtml(p.body),           // escaped + nl2br
        headers: { 'X-Giveaway-Email-Id': String(p.id) },  // for bounce reconciliation
      });
      console.log(`${tag} ✅ SENT <${p.to!.email}> msgId=${info.messageId}`);
      if (logId) await SendTrackService.markSent(logId, { externalId: info.messageId, provider: 'giveaway-smtp', durationMs: Date.now() - _started }).catch(() => {});
      await record({ ...meta, outcome: 'sent', msgId: info.messageId });
      return ch.ack(msg);
    } catch (err) {
      lastErr = err as Error;
      if (attempt < MAX_RETRIES) await sleep(500 * attempt + Math.floor(Math.random() * 300)); // jittered backoff
    }
  }
  // all retries failed → release the claim so a DLQ replay can retry, then DLQ (no requeue)
  if (logId) await SendTrackService.markFailed(logId, { error: lastErr?.message, provider: 'giveaway-smtp', durationMs: Date.now() - _started }).catch(() => {});
  await redis.del(`giveaway:email:${p.id}`).catch(() => {});
  console.error(`${tag} ❌ SEND FAILED after ${MAX_RETRIES} tries: ${lastErr?.message} — nack→DLQ`);
  await record({ ...meta, outcome: 'failed', reason: lastErr?.message });
  return ch.nack(msg, false, false);
}

// ── topology (idempotent; re-asserted on every connect) ──
async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, '');
  await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX } });
  await ch.bindQueue(QUEUE, EXCHANGE, BINDING);
  // Affiliate feed — its own queue on the same exchange, sharing the giveaway DLQ.
  // Bound to THIS env's key only (all envs share the vhost — see AFF_BINDING).
  await ch.assertQueue(AFF_QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX } });
  await ch.bindQueue(AFF_QUEUE, EXCHANGE, AFF_BINDING);
  // OTP feed — x-message-ttl matches the code's own 10-minute lifetime, so a backlog built up
  // while the consumer was down expires itself instead of sending a burst of dead codes.
  await ch.assertQueue(OTP_QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX, 'x-message-ttl': 600000 } });
  await ch.bindQueue(OTP_QUEUE, EXCHANGE, OTP_BINDING);
  // Lifecycle feed — bound and consumed even when GIVEAWAY_LIFECYCLE_ENABLED is false, so the
  // events are captured and acked instead of being silently discarded by the exchange (today's
  // behaviour) or accumulating behind a binding nobody reads. The flag gates acting on them.
  await ch.assertQueue(LC_QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX } });
  await ch.bindQueue(LC_QUEUE, EXCHANGE, LC_BINDING);
}

async function connect() {
  if (_stopped) return;
  const url = process.env.GIVEAWAY_RABBITMQ_URL;
  if (!url) { console.warn('[GiveawayMQ] GIVEAWAY_RABBITMQ_URL not set — consumer idle (set it to connect).'); return; }

  if (_connecting) return;   // never open two connections in parallel (§1)
  _connecting = true;
  try {
    const conn = await amqp.connect(url, { heartbeat: 30, clientProperties: { connection_name: CONN_NAME } } as SocketOptions & { heartbeat: number });
    if (_stopped) { await conn.close().catch(() => {}); return; }   // stopped while connecting
    _conn = conn;
    _conn.on('error', (e: Error) => console.error(`[GiveawayMQ] connection error: ${e.message}`));
    _conn.on('close', () => { if (!_stopped) scheduleReconnect('connection closed'); });

    _ch = await _conn.createChannel();
    await assertTopology(_ch);            // re-assert on every (re)connect — idempotent
    await _ch.prefetch(PREFETCH);
    const ch = _ch;
    // A channel-level close (e.g. a 406) used to stop consumption silently. Closing the
    // connection routes it through the normal reconnect path.
    ch.on('error', (e: Error) => console.error(`[GiveawayMQ] channel error: ${e.message}`));
    ch.on('close', () => { if (!_stopped && _ch === ch) _conn?.close().catch(() => {}); });
    const onMessage = (label: string) => (msg: ConsumeMessage | null): void => {
      if (!msg) return;
      handle(msg, ch).catch((e: Error) => { console.error(`[${label}] handler crash:`, e.message); try { ch.nack(msg, false, false); } catch {} });
    };
    // Two queues, ONE process/connection — CloudAMQP caps connections and a second replica
    // would split each queue. `handle` branches on the routing key, so both feeds share all
    // the idempotency, retry and DLQ behaviour.
    await ch.consume(QUEUE,     onMessage('GiveawayMQ'),  { noAck: false });
    await ch.consume(AFF_QUEUE, onMessage('AffiliateMQ'), { noAck: false });
    await ch.consume(OTP_QUEUE, onMessage('OtpMQ'),       { noAck: false });
    await ch.consume(LC_QUEUE,  onMessage('LifecycleMQ'), { noAck: false });

    _reconnectMs = 1000;
    console.log(`[GiveawayMQ] connected (conn="${CONN_NAME}") — consuming ${QUEUE} (bound ${BINDING}) + ${AFF_QUEUE} (bound ${AFF_BINDING}) + ${OTP_QUEUE} (bound ${OTP_BINDING}, otp=${OTP_ENABLED ? 'ENABLED' : 'log-only'}) + ${LC_QUEUE} (bound ${LC_BINDING}, lifecycle=${LC_ENABLED ? `ENABLED, notify on [${NOTIFY_FIELDS.join(',') || 'EVERY edit'}]` : 'capture-only'}) prefetch=${PREFETCH} send=${SEND_ENABLED ? 'ENABLED' : 'log-only'}`);
  } catch (err) {
    // connect() can succeed and createChannel/assertTopology fail — close that connection
    // so each retry doesn't leak one (CloudAMQP caps connections).
    const stale = _conn;
    scheduleReconnect(`connect failed: ${(err as Error).message}`);
    try { await stale?.close(); } catch { /* already closed */ }
  } finally {
    _connecting = false;
  }
}

function scheduleReconnect(why: string): void {
  _ch = null; _conn = null;
  // One pending reconnect at a time: a connection close and a failed connect can both
  // land here, which used to start two parallel reconnect loops.
  if (_stopped || _reconnectTimer) return;
  const delay = Math.min(_reconnectMs, 30_000);
  console.warn(`[GiveawayMQ] ${why} — reconnecting in ${delay}ms`);
  _reconnectTimer = setTimeout(() => { _reconnectTimer = null; connect(); }, delay);
  _reconnectMs = Math.min(_reconnectMs * 2, 30_000);
}

export async function startGiveawayRabbitConsumer() {
  _stopped = false;
  // Already connected, connecting, or a reconnect is pending → don't open a duplicate.
  if (_conn || _connecting || _reconnectTimer) return;
  await connect();
}

export async function stopGiveawayRabbitConsumer() {
  _stopped = true;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  try { await _ch?.close(); } catch {}
  try { await _conn?.close(); } catch {}
  _ch = null; _conn = null;
}
