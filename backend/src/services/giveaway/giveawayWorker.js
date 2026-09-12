/**
 * Giveaway email worker (BullMQ) — LOG-ONLY for now (no SMTP/SES send wired).
 *
 * Consumes `giveaway-email` jobs (§3 contract), validates them, dedupes on the message id,
 * and LOGS what it would send. Sending is intentionally left out until we wire the giveaway
 * SMTP mailbox — this lets us watch the trigger → consume flow end-to-end in the logs.
 *
 * Ack policy (mapped to BullMQ):
 *   - valid + first time  → log "would send", complete
 *   - duplicate id        → log + complete (idempotent, no double send)
 *   - poison (bad JSON / unknown version / bad address / missing field)
 *                         → log loudly + complete (NEVER retry a poison message)
 *   - transient error     → throw → BullMQ retries (attempts:3) → then lands in 'failed' (DLQ analogue)
 */
import { Worker } from 'bullmq';
import { getConnection } from '../queue/index.js';
import { GIVEAWAY_EMAIL_QUEUE } from './giveawayQueue.js';

const DEDUPE_TTL = parseInt(process.env.GIVEAWAY_DEDUPE_TTL_SEC || '604800', 10); // 7 days
const CONCURRENCY = parseInt(process.env.GIVEAWAY_PREFETCH || '10', 10);
const VALID_TYPES = new Set(['participation', 'eligible', 'winner', 'loser']);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

let _worker = null;

/** Validate the §3 contract. Returns { ok } or { ok:false, reason }. */
function validate(p) {
  if (!p || typeof p !== 'object')          return { ok: false, reason: 'not_an_object' };
  if (p.version !== 1)                        return { ok: false, reason: `unknown_version:${p.version}` };
  if (!p.id)                                  return { ok: false, reason: 'missing_id' };
  if (!VALID_TYPES.has(p.type))               return { ok: false, reason: `bad_type:${p.type}` };
  if (!p.to?.email || !EMAIL_RE.test(p.to.email)) return { ok: false, reason: 'invalid_email' };
  if (!p.subject)                             return { ok: false, reason: 'missing_subject' };
  if (typeof p.body !== 'string')             return { ok: false, reason: 'missing_body' };
  return { ok: true };
}

async function processGiveawayEmail(job) {
  const p = job.data || {};
  const tag = `[Giveaway] job=${job.id} id=${p.id ?? '?'} type=${p.type ?? '?'}`;

  // 1. Contract validation — poison → log + complete (never requeue).
  const v = validate(p);
  if (!v.ok) {
    console.warn(`${tag} ⛔ POISON (${v.reason}) — dropped, not retried`);
    return { dropped: true, reason: v.reason };
  }

  // 2. Idempotency — claim the id BEFORE we "send"; a duplicate redelivery is a no-op.
  const redis = getConnection();
  const claimed = await redis.set(`giveaway:email:${p.id}`, '1', 'NX', 'EX', DEDUPE_TTL);
  if (claimed === null) {
    console.log(`${tag} 🔁 DUPLICATE — already processed, skipping`);
    return { duplicate: true };
  }

  // 3. "Send" — NOT wired. Just log the fully-rendered email we received.
  const preview = String(p.body).replace(/\s+/g, ' ').slice(0, 140);
  console.log(`${tag} ✅ RECEIVED (would send — SMTP not wired yet)`);
  console.log(`         to:      ${p.to.name || ''} <${p.to.email}>`);
  console.log(`         subject: ${p.subject}`);
  console.log(`         body:    ${preview}${p.body.length > 140 ? '…' : ''}`);
  console.log(`         meta:    tenant=${p.tenantId || '-'} giveaway=${p.giveawayId || '-'} createdAt=${p.createdAt || '-'}`);
  return { logged: true };
}

export function startGiveawayWorker() {
  if (_worker) return _worker;
  _worker = new Worker(GIVEAWAY_EMAIL_QUEUE, processGiveawayEmail, {
    connection: getConnection(),
    concurrency: CONCURRENCY,
  });
  _worker.on('failed', (job, err) => {
    console.error(`[Giveaway] job=${job?.id} id=${job?.data?.id} FAILED (attempt ${job?.attemptsMade}): ${err.message}`);
  });
  _worker.on('error', (err) => console.error(`[Giveaway] worker error: ${err.message}`));
  console.log(`[Giveaway] worker started — queue=${GIVEAWAY_EMAIL_QUEUE} concurrency=${CONCURRENCY} (LOG-ONLY, no email send)`);
  return _worker;
}

export async function stopGiveawayWorker() {
  if (_worker) { await _worker.close(); _worker = null; }
}
