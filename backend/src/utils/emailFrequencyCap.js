/**
 * Per-recipient email frequency cap (e.g. max 3 emails / 24h).
 *
 * Counts in REDIS, not the DB — one O(1) INCR per send, no query on email_send_log,
 * so it adds no DB load and runs entirely in the worker/send tier (the website/API
 * never sees it). Keys are created lazily (only for recipients actually emailed) and
 * auto-expire after the window, so memory tracks send volume, not the user base.
 *
 * Flow per send:
 *   const r = await reserveSend({ unifiedId, email });
 *   if (!r.allowed) -> skip the send (capped)
 *   ...send...
 *   if (send failed) await releaseSend({ unifiedId, email });   // don't consume a slot
 *
 * Fail-OPEN: if disabled or Redis is unavailable, sends are allowed (a cap-system
 * outage must never silently block real mail).
 */
import IORedis from 'ioredis';

const REDIS_URL  = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const ENABLED    = process.env.EMAIL_CAP_ENABLED === 'true';
const CAP        = parseInt(process.env.EMAIL_CAP_PER_24H || '3', 10);
const WINDOW_SEC = parseInt(process.env.EMAIL_CAP_WINDOW_SEC || '86400', 10);

// Test-inbox bypass. Any email in this comma-separated env var will always
// be allowed regardless of ENABLED / CAP. Used for internal QA addresses that
// need to receive unlimited sends during rollout of new journeys.
const BYPASS_EMAILS = new Set(
  (process.env.EMAIL_CAP_BYPASS_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
);
function _isBypassed(email) {
  return !!email && BYPASS_EMAILS.has(String(email).trim().toLowerCase());
}

let _redis;
function getRedis() {
  if (_redis === null) return null;
  if (!_redis) {
    _redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: true });
    _redis.connect().catch(() => { _redis = null; });
    _redis.on('error', () => {});
  }
  return _redis;
}

// Prefer the stable contact id; fall back to the raw email (e.g. ad-hoc test sends).
function capKey({ unifiedId, email } = {}) {
  if (unifiedId !== undefined && unifiedId !== null && `${unifiedId}` !== '') return `cap:u:${unifiedId}`;
  if (email) return `cap:e:${String(email).trim().toLowerCase()}`;
  return null;
}

export function isCapEnabled() { return ENABLED; }
export function capLimit() { return CAP; }

/**
 * Atomically reserve a send slot for this recipient in the current window.
 * Returns { allowed, count, capped }. INCR creates the key (=1) on the first email
 * and we start the TTL then; over the cap → not allowed.
 */
export async function reserveSend(target) {
  // Bypass allowlist wins over ENABLED — QA inboxes never get capped.
  if (_isBypassed(target?.email)) return { allowed: true, count: 0, capped: false, bypassed: true };
  if (!ENABLED) return { allowed: true, count: 0, capped: false };
  const key = capKey(target);
  if (!key) return { allowed: true, count: 0, capped: false };
  const redis = getRedis();
  if (!redis) return { allowed: true, count: 0, capped: false }; // fail-open
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, WINDOW_SEC);
    if (n > CAP) return { allowed: false, count: n, capped: true };
    return { allowed: true, count: n, capped: false };
  } catch {
    return { allowed: true, count: 0, capped: false }; // fail-open
  }
}

/** Release a previously-reserved slot (call when the send itself failed). */
export async function releaseSend(target) {
  if (_isBypassed(target?.email)) return; // Nothing was reserved for bypassed users.
  if (!ENABLED) return;
  const key = capKey(target);
  if (!key) return;
  const redis = getRedis();
  if (!redis) return;
  try { await redis.decr(key); } catch { /* ignore */ }
}

export default { reserveSend, releaseSend, isCapEnabled, capLimit };
