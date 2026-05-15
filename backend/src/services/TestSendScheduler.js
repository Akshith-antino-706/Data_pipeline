/**
 * TestSendScheduler — drives the auto-send of Day-1 through Day-7 templates.
 *
 * Multiple schedules are supported simultaneously. Each schedule is a row in
 * test_segment_schedule. A new row is INSERTed every time start() is called.
 *
 * In-memory state (timers + prewarm) is keyed by scheduleId and survives as
 * long as the server process is alive. On server restart, running DB rows
 * remain marked is_running=true but timers are gone — call stop(id) to clean up.
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

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours between each day's send

const timers   = new Map(); // id → intervalRef
const prewarms = new Map(); // id → prewarm state

const idlePw = () => ({
  status: 'idle', startedAt: null, completedAt: null,
  summary: null, readyCount: 0, error: null,
});

const pw = (id) => prewarms.get(id) ?? idlePw();

// ── public API ────────────────────────────────────────────────────────────

export function getPrewarmState(id) {
  return pw(id);
}

export async function listSchedules() {
  const { rows } = await db.query(
    'SELECT * FROM test_segment_schedule ORDER BY id DESC'
  );
  return rows.map(r => ({ ...r, prewarm: pw(r.id) }));
}

export async function getStatus(id) {
  const { rows: [row] } = await db.query(
    'SELECT * FROM test_segment_schedule WHERE id = $1', [id]
  );
  return row ? { ...row, prewarm: pw(id) } : null;
}

export async function start({
  destinationKey = 'singapore',
  loop = false,
  emails = [],
  baseUrl = `http://localhost:${process.env.PORT || 3001}`,
} = {}) {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error('Select at least one recipient email before starting');
  }

  const { rows: [row] } = await db.query(
    `INSERT INTO test_segment_schedule
       (is_running, started_at, next_day_to_send, last_sent_day, last_sent_at,
        destination_key, loop, emails, updated_at)
     VALUES (TRUE, NOW(), 1, NULL, NULL, $1, $2, $3::jsonb, NOW())
     RETURNING *`,
    [destinationKey, loop, JSON.stringify(emails)]
  );

  const id = row.id;
  prewarms.set(id, idlePw());
  _prewarmThenSend({ id, destinationKey, baseUrl });
  return { ...row, prewarm: pw(id) };
}

export async function removeEmail(id, email) {
  const clean = String(email).toLowerCase().trim();
  const { rows: [row] } = await db.query(
    `UPDATE test_segment_schedule
        SET emails     = (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                            FROM jsonb_array_elements_text(emails::jsonb) AS e
                           WHERE LOWER(e) <> $2),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, clean]
  );
  if (!row) throw new Error('Schedule not found');
  const remaining = Array.isArray(row.emails) ? row.emails : [];
  if (remaining.length === 0) {
    await stop(id);
    return { ...row, emails: [], is_running: false, prewarm: idlePw() };
  }
  return { ...row, prewarm: pw(id) };
}

export async function stop(id) {
  _clearTimer(id);
  prewarms.delete(id);
  const { rows: [row] } = await db.query(
    `UPDATE test_segment_schedule
        SET is_running = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id]
  );
  return { ...(row || { id }), prewarm: idlePw() };
}

// ── timer helpers ─────────────────────────────────────────────────────────

function _clearTimer(id) {
  const t = timers.get(id);
  if (t) { clearInterval(t); timers.delete(id); }
}

async function _prewarmThenSend({ id, destinationKey, baseUrl }) {
  prewarms.set(id, {
    status: 'prewarming', startedAt: new Date().toISOString(),
    completedAt: null, summary: null, readyCount: 0, error: null,
  });
  console.log(`[Schedule#${id}] Pre-warming all 7 day rankings…`);

  try {
    const res  = await fetch(`${baseUrl}/api/v3/test-sends/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destinationKey }),
    });
    const data = await res.json().catch(() => ({}));
    prewarms.set(id, {
      status:      'ready',
      startedAt:   prewarms.get(id)?.startedAt,
      completedAt: new Date().toISOString(),
      summary:     data?.data?.summary || [],
      readyCount:  data?.data?.ready   || 0,
      error:       null,
    });
    console.log(`[Schedule#${id}] Pre-warm complete — ${prewarms.get(id).readyCount}/7 ready`);
  } catch (err) {
    const prev = prewarms.get(id) || {};
    prewarms.set(id, {
      ...prev, status: 'failed',
      completedAt: new Date().toISOString(), error: err.message,
    });
    console.error(`[Schedule#${id}] Pre-warm failed:`, err.message, '— proceeding anyway');
  }

  _startTimer(id);
}

function _startTimer(id) {
  _clearTimer(id);
  setTimeout(() => _autoTick(id), 500);
  timers.set(id, setInterval(() => _autoTick(id), INTERVAL_MS));
}

async function _autoTick(id) {
  try {
    const r = await tick(id);
    console.log(`[Schedule#${id}] Day ${r.day || '?'}: ${r.skipped ? `skipped (${r.reason})` : r.async ? `queued ${r.sentTo} in background (job:${r.jobId})` : `sent to ${r.sentTo}`}`);
    if (r.sequenceDone || (r.skipped && r.reason === 'Not running')) {
      console.log(`[Schedule#${id}] Sequence complete — stopping timer`);
      _clearTimer(id);
    }
  } catch (err) {
    console.error(`[Schedule#${id}] Error:`, err.message);
    _clearTimer(id);
  }
}

// ── tick (single send) ───────────────────────────────────────────────────

export async function tick(id, {
  baseUrl = `http://localhost:${process.env.PORT || 3001}`,
} = {}) {
  const status = await getStatus(id);
  if (!status)             return { skipped: true, reason: 'No schedule row' };
  if (!status.is_running)  return { skipped: true, reason: 'Not running' };

  const day = status.next_day_to_send;
  if (day < 1 || day > 7) return { skipped: true, reason: `Invalid next_day_to_send=${day}` };

  const emails = Array.isArray(status.emails) ? status.emails : [];
  if (emails.length === 0) return { skipped: true, reason: 'No recipient emails' };

  const path = `/api/v3/test-sends/day${day}`;
  const body = { emails, source: `schedule-${id}` };
  if (day === 6) body.destinationKey = status.destination_key || 'singapore';

  const res  = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Day-${day} send failed: HTTP ${res.status} ${data?.error || ''}`);

  // When >100 recipients, the day endpoint responds async (no results array yet)
  const isAsync       = !!data?.data?.async;
  const sendResults   = data?.data?.results || [];
  const successCount  = isAsync
    ? (data?.data?.recipients || emails.length)   // all queued in background
    : sendResults.filter(r => r.success).length;

  let nextDay = day + 1;
  let stillRunning = true;
  if (nextDay > 7) {
    nextDay = 1;
    if (!status.loop) stillRunning = false;
  }

  await db.query(
    `UPDATE test_segment_schedule
        SET last_sent_day    = $2,
            last_sent_at     = NOW(),
            next_day_to_send = $3,
            is_running       = $4,
            updated_at       = NOW()
      WHERE id = $1`,
    [id, day, nextDay, stillRunning]
  );

  return {
    skipped:       false,
    day,
    label:         DAY_LABELS[day],
    sentTo:        successCount,
    failed:        isAsync ? 0 : (sendResults.length - successCount),
    async:         isAsync,
    jobId:         data?.data?.jobId || null,
    sequenceDone:  !stillRunning,
    results:       sendResults,
    rankingSource: data?.data?.ranking?.source,
  };
}

export const _internals = { DAY_LABELS };
export default { listSchedules, getStatus, start, stop, tick, removeEmail };
