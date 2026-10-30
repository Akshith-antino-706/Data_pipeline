/**
 * Daily offer email — settings.
 *
 * Every value can be changed from backend/.env without a code change. The job is
 * OFF unless DAILY_OFFER_ENABLED=true, so deploying this code changes nothing.
 */

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export function getDailyOfferConfig(env = process.env) {
  return {
    enabled:        env.DAILY_OFFER_ENABLED === 'true',
    // custom_segments.id — 95 = "B2C Testing Email Users" (testing), 86 = "B2C - Subscribed Users only".
    segmentId:      int(env.DAILY_OFFER_SEGMENT_ID, 95),
    feedUrl:        env.DAILY_OFFER_FEED_URL || 'https://data-projects-flax.vercel.app/api/enriched-feed?format=json',
    feedTimeoutMs:  int(env.DAILY_OFFER_FEED_TIMEOUT_MS, 5 * 60 * 1000),
    minFeedRows:    int(env.DAILY_OFFER_MIN_FEED_ROWS, 1500),
    minProducts:    int(env.DAILY_OFFER_MIN_PRODUCTS, 8),
    // Dubai wall-clock times (HH:MM). Create retries every 30 min until the cut-off.
    createAt:       env.DAILY_OFFER_CREATE_AT || '09:00',
    retryUntil:     env.DAILY_OFFER_RETRY_UNTIL || '14:00',
    checkAt:        env.DAILY_OFFER_CHECK_AT || '15:45',
    sendAt:         env.DAILY_OFFER_SEND_AT || '16:00',
    maxFxAgeHours:  int(env.DAILY_OFFER_MAX_FX_AGE_HOURS, 48),
  };
}

// ── Dubai time helpers (UTC+4 all year, no daylight saving) ──
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** YYYY-MM-DD in Dubai for the given instant. */
export function dubaiDate(at = new Date()) {
  return new Date(at.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since Dubai midnight for the given instant. */
export function dubaiMinutes(at = new Date()) {
  const d = new Date(at.getTime() + DUBAI_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "HH:MM" → minutes since midnight. */
export function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** The UTC instant of a Dubai wall-clock time on a Dubai date ("2026-11-01", "16:00"). */
export function dubaiInstant(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm.padStart(5, '0')}:00+04:00`);
}
