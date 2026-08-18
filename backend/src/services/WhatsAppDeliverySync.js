/**
 * WhatsAppDeliverySync — pull real delivery outcomes from ChatHead into our tables.
 *
 * ChatHead has no webhooks, so this POLLS two session-less endpoints (auth = c=rayna):
 *   - broadcast/reports/get   → aggregate counters  → chathead_broadcasts
 *   - broadcast/reports/list?type=failed → per-#    → whatsapp_send_log (best-effort)
 *
 * It works for EVERY journey type (fixed, continuous, gtm) because it only ever
 * operates on broadcast ids we've recorded — it never touches the send engines.
 * A broadcast is re-synced until its counters are fully accounted for ('finished')
 * or it ages out (see syncPending).
 */
import db from '../config/database.js';

const BASE   = 'https://ser1.chathead.io/apis/v1/services';
const CLIENT = 'rayna';
const num = (v) => (v == null || v === '' ? null : parseInt(v, 10));
// A broadcast is 'finished' only once its counters STOP MOVING for this long (or are
// fully resolved). Big sends (7 lakh+) sit in 'sent'/'delivered' churn for hours — a
// sum check would freeze them at "accepted"; stability captures the true final numbers.
const STABLE_MINUTES = 60;

/**
 * Sync ONE broadcast by its ChatHead broadcast id. Returns a small summary.
 * Never throws — network/parse errors degrade to { ok:false }.
 */
export async function syncBroadcast(broadcastId) {
  const bid = String(broadcastId);
  let counters = null;
  let reportStatus = null;

  // 1) Aggregate counters → chathead_broadcasts
  try {
    const r = await fetch(`${BASE}/broadcast/reports/get/?c=${CLIENT}&broadcast_id=${encodeURIComponent(bid)}`);
    const j = await r.json().catch(() => null);
    if (j?.status === 'success' && j.data) {
      const d = j.data;
      counters = {
        total: num(d.total), sent: num(d.sent), failed: num(d.failed), delivered: num(d.delivered),
        opened: num(d.open), clicked: num(d.clicked), replied: num(d.replied),
        soft: num(d.soft_bounce), hard: num(d.hard_bounce), complaints: num(d.complaints),
      };

      // Did anything move since last sync? Compare against the stored snapshot.
      const { rows: [prev] } = await db.query(
        `SELECT total_count,sent_count,failed_count,delivered_count,opened_count,clicked_count,
                replied_count,soft_bounce,hard_bounce,complaints,counters_changed_at
           FROM chathead_broadcasts WHERE chathead_broadcast_id=$1`, [bid]
      );
      const eq = (a, b) => (a == null ? 0 : Number(a)) === (b == null ? 0 : Number(b));
      const unchanged = !!prev && eq(prev.total_count, counters.total) && eq(prev.sent_count, counters.sent)
        && eq(prev.failed_count, counters.failed) && eq(prev.delivered_count, counters.delivered)
        && eq(prev.opened_count, counters.opened) && eq(prev.clicked_count, counters.clicked)
        && eq(prev.replied_count, counters.replied) && eq(prev.soft_bounce, counters.soft)
        && eq(prev.hard_bounce, counters.hard) && eq(prev.complaints, counters.complaints);

      // 'finished' = fully resolved (nothing left in-flight) OR counters stable ≥ STABLE_MINUTES.
      let finished = false;
      if (counters.total) {
        const resolved = (counters.sent || 0) === 0 && ((counters.delivered || 0) + (counters.failed || 0)) >= counters.total;
        const stableMin = unchanged && prev?.counters_changed_at
          ? (Date.now() - new Date(prev.counters_changed_at).getTime()) / 60000 : 0;
        finished = resolved || (unchanged && stableMin >= STABLE_MINUTES);
      }
      reportStatus = !counters.total ? 'pending' : (finished ? 'finished' : 'in_progress');

      await db.query(
        `UPDATE chathead_broadcasts
            SET total_count=$2, sent_count=$3, failed_count=$4, delivered_count=$5,
                opened_count=$6, clicked_count=$7, replied_count=$8,
                soft_bounce=$9, hard_bounce=$10, complaints=$11,
                report_status=$12, last_synced_at=NOW(),
                counters_changed_at = CASE WHEN $13 THEN counters_changed_at ELSE NOW() END
          WHERE chathead_broadcast_id=$1`,
        [bid, counters.total, counters.sent, counters.failed, counters.delivered,
         counters.opened, counters.clicked, counters.replied,
         counters.soft, counters.hard, counters.complaints, reportStatus, unchanged]
      );
    }
  } catch (err) {
    console.error(`[WA delivery] reports/get ${bid} failed: ${err.message}`);
  }

  // 2) Per-recipient outcomes → whatsapp_send_log (best-effort; ChatHead's list is
  //    per-number with a wamid = reached Meta, or a text reason = dropped/failed).
  let perRecipient = 0;
  try {
    const r = await fetch(`${BASE}/broadcast/reports/list/?c=${CLIENT}&broadcast_id=${encodeURIComponent(bid)}&type=failed`);
    const j = await r.json().catch(() => null);
    for (const row of (j?.data || [])) {
      const phone = String(row.number || '').replace(/\D/g, '');
      if (phone.length < 10) continue;                    // skip malformed rows (e.g. "r")
      const reason = row.reason == null ? '' : String(row.reason);
      if (/^wamid\./i.test(reason)) {
        // Accepted by WhatsApp — record the message id; don't downgrade a real failure.
        await db.query(
          `UPDATE whatsapp_send_log SET wamid=$3, delivery_checked_at=NOW()
             WHERE external_id=$1 AND phone=$2 AND status <> 'failed'`,
          [bid, phone, reason]
        ).catch(() => {});
      } else if (reason) {
        // A real drop/failure (e.g. Meta "healthy ecosystem engagement").
        await db.query(
          `UPDATE whatsapp_send_log
              SET status='failed', delivery_reason=$3,
                  error=COALESCE(NULLIF(error,''),$3), delivery_checked_at=NOW()
            WHERE external_id=$1 AND phone=$2`,
          [bid, phone, reason.slice(0, 500)]
        ).catch(() => {});
      }
      perRecipient++;
    }
  } catch (err) {
    console.error(`[WA delivery] reports/list ${bid} failed: ${err.message}`);
  }

  return { ok: !!counters, broadcastId: bid, counters, reportStatus, perRecipient };
}

/**
 * Sync all broadcasts that aren't 'finished' yet and are recent enough to still be
 * changing. Sequential + gentle (this is a polling loop, not a hot path).
 */
export async function syncPending({ maxAgeHours = 168, limit = 200 } = {}) {
  // Poll for up to 7 days (168h) — large broadcasts (7 lakh+) keep delivering for days.
  // We stop re-syncing a broadcast the moment its counters go 'finished' (stable/resolved).
  const { rows } = await db.query(
    `SELECT chathead_broadcast_id
       FROM chathead_broadcasts
      WHERE chathead_broadcast_id IS NOT NULL
        AND (report_status IS NULL OR report_status <> 'finished')
        AND created_at > NOW() - ($1 || ' hours')::interval
      ORDER BY created_at DESC
      LIMIT $2`,
    [String(maxAgeHours), limit]
  );
  let ok = 0, finished = 0;
  for (const r of rows) {
    const res = await syncBroadcast(r.chathead_broadcast_id);
    if (res.ok) ok++;
    if (res.reportStatus === 'finished') finished++;
  }
  const summary = { candidates: rows.length, synced: ok, finished };
  if (rows.length) console.log('[WA delivery] syncPending:', JSON.stringify(summary));
  return summary;
}

export default { syncBroadcast, syncPending };
