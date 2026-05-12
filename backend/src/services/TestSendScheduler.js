/**
 * TestSendScheduler — drives the auto-send of Day-1 through Day-7 templates.
 *
 * Testing mode (current):
 *   Click "Start Daily Send" → sends Day 1 immediately,
 *   then every 2 minutes auto-sends Day 2, Day 3 ... Day 7.
 *
 * State machine:
 *   - is_running=false, next_day_to_send=1   → idle
 *   - is_running=true,  next_day_to_send=N   → next tick sends Day-N
 *   - next_day_to_send=8 (after Day-7 sent)  →
 *       loop=true   → reset to 1
 *       loop=false  → set is_running=false (sequence complete)
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
const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes between sends

let autoTimer = null; // holds the setInterval reference

// ── state accessors ──────────────────────────────────────────────────────

export async function getStatus() {
  const { rows: [row] } = await db.query(
    'SELECT * FROM test_segment_schedule WHERE id = $1', [SCHEDULE_ID]
  );
  return row || null;
}

export async function start({ destinationKey = 'singapore', loop = false, emails = [] } = {}) {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error('Select at least one recipient email before starting');
  }
  const { rows: [row] } = await db.query(
    `UPDATE test_segment_schedule SET
       is_running       = TRUE,
       started_at       = NOW(),
       next_day_to_send = 1,
       last_sent_day    = NULL,
       last_sent_at     = NULL,
       destination_key  = $2,
       loop             = $3,
       emails           = $4,
       updated_at       = NOW()
     WHERE id = $1
     RETURNING *`,
    [SCHEDULE_ID, destinationKey, loop, JSON.stringify(emails)]
  );

  // Send Day 1 immediately, then auto-tick every 2 min
  startAutoSend();

  return row;
}

export async function stop() {
  stopAutoSend();
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

// ── auto-send timer ─────────────────────────────────────────────────────

function startAutoSend() {
  stopAutoSend(); // clear any existing timer

  // Fire Day 1 immediately (slight delay to let DB commit settle)
  setTimeout(() => autoTick(), 500);

  // Then fire every 2 minutes for Day 2→7
  autoTimer = setInterval(() => autoTick(), INTERVAL_MS);
}

function stopAutoSend() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

async function autoTick() {
  try {
    const result = await tick();
    console.log(`[AutoSend] Day ${result.day || '?'}: ${result.skipped ? `skipped (${result.reason})` : `sent to ${result.sentTo}`}`);
    if (result.sequenceDone || (result.skipped && result.reason === 'Not running')) {
      console.log('[AutoSend] Sequence complete — stopping timer');
      stopAutoSend();
    }
  } catch (err) {
    console.error('[AutoSend] Error:', err.message);
    stopAutoSend();
  }
}

// ── tick (single send) ──────────────────────────────────────────────────

export async function tick({ baseUrl = `http://localhost:${process.env.PORT || 3001}` } = {}) {
  const status = await getStatus();
  if (!status) return { skipped: true, reason: 'No schedule row' };
  if (!status.is_running) return { skipped: true, reason: 'Not running' };

  const day = status.next_day_to_send;
  if (day < 1 || day > 7) {
    return { skipped: true, reason: `Invalid next_day_to_send=${day}` };
  }

  const emails = Array.isArray(status.emails) ? status.emails : [];
  if (emails.length === 0) {
    return { skipped: true, reason: 'No recipient emails stored in schedule' };
  }

  const path = `/api/v3/test-sends/day${day}`;
  const body = { emails };
  if (day === 6) body.destinationKey = status.destination_key || 'singapore';

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

  // Advance state
  let nextDay = day + 1;
  let stillRunning = true;
  if (nextDay > 7) {
    if (status.loop) {
      nextDay = 1;
    } else {
      stillRunning = false;
      nextDay = 1;
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
