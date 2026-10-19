/**
 * dailySendCounts
 *
 * Fills `daily_send_counts` with how many messages were SENT per channel on each
 * finished Dubai day. The Home 14-day chart reads these rows instead of counting
 * the send logs live.
 *
 * Safety (agreed scope):
 *  - READS only from email_send_log, whatsapp_send_log and sms_send_log.
 *  - WRITES only to daily_send_counts (one upsert per finished day). Never touches
 *    any other table.
 *  - Never writes "today" (it is still changing; the chart counts today live).
 *  - Missing table (migration not run yet) → logs and returns; nothing else happens.
 *
 * "Sent" uses the same rules as the Home cards (routes/overview.ts):
 *   email    — sent_at in the day (failed/queued rows have no sent_at)
 *   whatsapp — created_at in the day, status NOT IN ('failed','queued')
 *   sms      — sent_at in the day, status NOT IN ('failed','queued','blocked')
 */
import db from '../config/database.js';

const TARGET_TABLE = 'daily_send_counts';
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

type CountRow = { n: string | number | null };
export interface DailySendCountsResult { checked: number; written: number; skipped: number; error?: string }

/** Dubai-midnight timestamp `k` days ago; k is an internal integer, never user input. */
const dayStart = (k: number) =>
  `((date_trunc('day', NOW() AT TIME ZONE 'Asia/Dubai') - INTERVAL '${Math.trunc(k)} days') AT TIME ZONE 'Asia/Dubai')`;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function countDay(k: number): Promise<{ email: number; whatsapp: number; sms: number }> {
  const from = dayStart(k), to = dayStart(k - 1);
  const [e, w, s] = await Promise.all([
    db.query<CountRow>(`SELECT COUNT(*) AS n FROM email_send_log WHERE sent_at >= ${from} AND sent_at < ${to}`),
    db.query<CountRow>(`SELECT COUNT(*) AS n FROM whatsapp_send_log
      WHERE created_at >= ${from} AND created_at < ${to} AND status NOT IN ('failed','queued')`),
    db.query<CountRow>(`SELECT COUNT(*) AS n FROM sms_send_log
      WHERE sent_at >= ${from} AND sent_at < ${to} AND status NOT IN ('failed','queued','blocked')`),
  ]);
  return { email: n(e.rows[0]?.n), whatsapp: n(w.rows[0]?.n), sms: n(s.rows[0]?.n) };
}

/**
 * Computes finished days (1 = yesterday … `days` ago). Yesterday is always recomputed
 * (late log updates); older days are only filled when missing.
 */
export async function runDailySendCounts({ days = DEFAULT_DAYS }: { days?: number } = {}): Promise<DailySendCountsResult> {
  const span = Math.min(MAX_DAYS, Math.max(1, Math.trunc(days)));
  const result: DailySendCountsResult = { checked: 0, written: 0, skipped: 0 };
  try {
    const { rows: have } = await db.query<{ day: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day FROM ${TARGET_TABLE}
       WHERE day >= (NOW() AT TIME ZONE 'Asia/Dubai')::date - $1::int
       GROUP BY day HAVING COUNT(*) = 3`, [span]);
    const present = new Set(have.map(r => r.day));
    for (let k = 1; k <= span; k++) {
      result.checked++;
      const { rows: [d] } = await db.query<{ day: string }>(`SELECT to_char((${dayStart(k)} AT TIME ZONE 'Asia/Dubai')::date, 'YYYY-MM-DD') AS day`);
      if (k > 1 && present.has(d.day)) { result.skipped++; continue; }
      const c = await countDay(k);
      await db.query(
        `INSERT INTO ${TARGET_TABLE} (day, channel, sent, computed_at)
         VALUES ($1::date, 'email', $2, NOW()), ($1::date, 'whatsapp', $3, NOW()), ($1::date, 'sms', $4, NOW())
         ON CONFLICT (day, channel) DO UPDATE SET sent = EXCLUDED.sent, computed_at = EXCLUDED.computed_at`,
        [d.day, c.email, c.whatsapp, c.sms]);
      result.written++;
    }
    console.log(`[DailySendCounts] checked ${result.checked}, written ${result.written}, skipped ${result.skipped}`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    result.error = e.code === '42P01' ? `${TARGET_TABLE} does not exist yet (run migration 118)` : (e.message ?? String(err));
    console.error('[DailySendCounts] Error:', result.error);
  }
  return result;
}
