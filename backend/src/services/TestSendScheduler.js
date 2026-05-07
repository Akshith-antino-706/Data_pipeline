/**
 * TestSendScheduler — drives the auto-send of Day-1 through Day-7 templates
 * to the TEST_USERS segment on a daily schedule, with no manual intervention
 * after start.
 *
 * State machine:
 *   - is_running=false, next_day_to_send=1   → idle
 *   - is_running=true,  next_day_to_send=N   → cron fires today: send Day-N,
 *                                              increment to N+1
 *   - next_day_to_send=8 (after Day-7 sent)  →
 *       loop=true   → reset to 1
 *       loop=false  → set is_running=false (sequence complete)
 *
 * Day-6 uses the destination_key field (default singapore).
 *
 * The cron tick is gated by last_sent_at — if the last send was within
 * the last 22 hours we skip (idempotent guard against double-firing).
 */

import db from '../config/database.js';

const DAY_LABELS = {
  1: 'Welcome',
  2: 'Cruise Spotlight',
  3: 'Visa Hub',
  4: 'Holidays',
  5: 'Activities',
  6: 'Destination Spotlight',
  7: 'Abandoned Cart',
};

const SCHEDULE_ID = 1;

// ── state accessors ──────────────────────────────────────────────────────

export async function getStatus() {
  const { rows: [row] } = await db.query(
    'SELECT * FROM test_segment_schedule WHERE id = $1', [SCHEDULE_ID]
  );
  return row || null;
}

export async function start({ destinationKey = 'singapore', loop = false } = {}) {
  const { rows: [row] } = await db.query(
    `UPDATE test_segment_schedule SET
       is_running       = TRUE,
       started_at       = NOW(),
       next_day_to_send = 1,
       last_sent_day    = NULL,
       last_sent_at     = NULL,
       destination_key  = $2,
       loop             = $3,
       updated_at       = NOW()
     WHERE id = $1
     RETURNING *`,
    [SCHEDULE_ID, destinationKey, loop]
  );
  return row;
}

export async function stop() {
  const { rows: [row] } = await db.query(
    `UPDATE test_segment_schedule SET
       is_running = FALSE,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [SCHEDULE_ID]
  );
  return row;
}

// ── cron tick ────────────────────────────────────────────────────────────

/**
 * Called once per day by the cron. Idempotent — safe to call multiple times
 * within a 22-hour window without duplicating sends.
 *
 * @returns { skipped: boolean, reason?: string, day?: number, results?: any[] }
 */
export async function tick({ baseUrl = `http://localhost:${process.env.PORT || 3001}` } = {}) {
  const status = await getStatus();
  if (!status) return { skipped: true, reason: 'No schedule row' };
  if (!status.is_running) return { skipped: true, reason: 'Not running' };

  // Idempotency: skip if we already fired in the last 22h.
  if (status.last_sent_at) {
    const ageMs = Date.now() - new Date(status.last_sent_at).getTime();
    if (ageMs < 22 * 60 * 60 * 1000) {
      return { skipped: true, reason: `Last sent ${Math.round(ageMs / 3600000)}h ago — too recent` };
    }
  }

  const day = status.next_day_to_send;
  if (day < 1 || day > 7) {
    return { skipped: true, reason: `Invalid next_day_to_send=${day}` };
  }

  const path = `/api/v3/test-sends/day${day}`;
  const body = day === 6 ? { destinationKey: status.destination_key || 'singapore' } : {};

  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Day-${day} send failed: HTTP ${res.status} ${data?.error || ''}`);
  }

  const sendResults = data?.data?.results || [];
  const successCount = sendResults.filter(r => r.success).length;

  // Advance state — pre-compute the next day, handling loop / completion.
  let nextDay = day + 1;
  let stillRunning = true;
  if (nextDay > 7) {
    if (status.loop) {
      nextDay = 1;
    } else {
      stillRunning = false;
      nextDay = 1; // reset for next manual start
    }
  }

  await db.query(
    `UPDATE test_segment_schedule SET
       last_sent_day    = $2,
       last_sent_at     = NOW(),
       next_day_to_send = $3,
       is_running       = $4,
       updated_at       = NOW()
     WHERE id = $1`,
    [SCHEDULE_ID, day, nextDay, stillRunning]
  );

  return {
    skipped:        false,
    day,
    label:          DAY_LABELS[day],
    sentTo:         successCount,
    failed:         sendResults.length - successCount,
    sequenceDone:   !stillRunning,
    results:        sendResults,
    rankingSource:  data?.data?.ranking?.source,
  };
}

export const _internals = { DAY_LABELS, SCHEDULE_ID };

export default { getStatus, start, stop, tick };
