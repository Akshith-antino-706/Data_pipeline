/**
 * JourneyStatsService — populates the `journey_node_stats` rollup that powers the
 * dashboard Analytics tab.
 *
 * WHY A ROLLUP: computing per-node engagement live means scanning email_send_log
 * (~17M rows / 6.4GB) + ses_events + gtm_events + journey_entries for a journey.
 * That's fine for ONE journey (the detail screen) but a multi-journey table would
 * time out. So a 30-min cron precomputes everything here IN THE BACKGROUND, one
 * journey at a time (never parallel — concurrent COUNT(DISTINCT) scans of the same
 * huge table thrash the cache). The dashboard then reads a small flat table with no
 * joins → milliseconds, independent of journey size.
 *
 * ISOLATION: only this service and the read endpoints touch journey_node_stats. No
 * other flow is affected, and dropping the table (rollback) loses nothing derivable.
 *
 * All engagement queries mirror the (already perf-fixed) getJourneyCampaignAnalytics:
 * partial-index scans (idx_esl_journey_node_opened / _clicked), run sequentially.
 */
import db from '../config/database.js';

const ROLLUP_KEY = '__ALL__'; // node_id sentinel for the per-journey summary row

function botWindowSec() {
  return parseInt(process.env.BOT_ENGAGEMENT_WINDOW_SEC || '15', 10);
}

/**
 * Recompute + persist stats for a single journey (all its nodes + the __ALL__ rollup).
 * Fully self-contained and wrapped by the caller in try/catch so one bad journey never
 * breaks a full run. Returns { journeyId, nodes, ms }.
 */
export async function refreshJourney(journeyId) {
  const t0 = Date.now();
  const W = String(botWindowSec());

  // Journey shell (name/status/nodes for denormalized display fields)
  const { rows: [jf] } = await db.query(
    `SELECT journey_id, name, status, journey_type, nodes FROM journey_flows WHERE journey_id = $1`,
    [journeyId]
  );
  if (!jf) return { journeyId, nodes: 0, ms: Date.now() - t0, skipped: 'no_journey' };

  const nodeDefs = Array.isArray(jf.nodes) ? jf.nodes : [];
  const nodeMeta = new Map(nodeDefs.map(n => [n.id, {
    label: n.data?.label || n.data?.title || n.id,
    type: n.type || 'unknown',
    channel: n.data?.channel || null,
  }]));

  // ── Engagement (sequential partial-index scans; see getJourneyCampaignAnalytics) ──
  // 1) base: entries = distinct recipients that reached the node; sent = distinct recipients
  //    successfully sent to (so a node's Sent can never exceed its Entries — duplicate/resend
  //    rows collapse); failed = distinct recipients whose send failed; sends_today (Dubai day).
  const { rows: baseRows } = await db.query(`
    SELECT node_id,
      COUNT(DISTINCT unified_id)                                                     AS entries,
      COUNT(DISTINCT unified_id) FILTER (WHERE status NOT IN ('failed','queued'))    AS sent,
      COUNT(DISTINCT unified_id) FILTER (WHERE status = 'failed')                    AS failed,
      COUNT(*) FILTER (WHERE (COALESCE(sent_at, created_at) AT TIME ZONE 'Asia/Dubai')::date
                              = (NOW() AT TIME ZONE 'Asia/Dubai')::date)             AS sends_today
    FROM email_send_log
    WHERE journey_id = $1 AND node_id IS NOT NULL
    GROUP BY node_id
  `, [journeyId]);

  // 2) opens + human_opens (idx_esl_journey_node_opened)
  const { rows: openRows } = await db.query(`
    SELECT node_id,
      COUNT(DISTINCT unified_id) AS opened,
      COUNT(DISTINCT unified_id) FILTER (
        WHERE sent_at IS NOT NULL AND opened_at - sent_at >= ($2 || ' seconds')::interval
      ) AS human_opened
    FROM email_send_log
    WHERE journey_id = $1 AND node_id IS NOT NULL AND opened_at IS NOT NULL
    GROUP BY node_id
  `, [journeyId, W]);

  // 3) clicks + human_clicks (idx_esl_journey_node_clicked)
  const { rows: clickRows } = await db.query(`
    SELECT node_id,
      COUNT(DISTINCT unified_id) AS clicked,
      COUNT(DISTINCT unified_id) FILTER (
        WHERE sent_at IS NOT NULL AND clicked_at - sent_at >= ($2 || ' seconds')::interval
      ) AS human_clicked
    FROM email_send_log
    WHERE journey_id = $1 AND node_id IS NOT NULL AND clicked_at IS NOT NULL
    GROUP BY node_id
  `, [journeyId, W]);

  // 4) landed clicks (clicked AND produced a real GTM event for this journey)
  const { rows: landedRows } = await db.query(`
    SELECT esl.node_id, COUNT(DISTINCT esl.unified_id) AS landed
    FROM email_send_log esl
    WHERE esl.journey_id = $1 AND esl.node_id IS NOT NULL AND esl.clicked_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM gtm_events g WHERE g.unified_id = esl.unified_id AND g.journey_id = $1)
    GROUP BY esl.node_id
  `, [journeyId]);

  // 5) delivered + bounced (SES events) in one join
  const { rows: sesRows } = await db.query(`
    SELECT esl.node_id,
      COUNT(*) FILTER (WHERE se.event_type = 'Delivery') AS delivered,
      COUNT(*) FILTER (WHERE se.event_type = 'Bounce')   AS bounced
    FROM email_send_log esl
    JOIN ses_events se ON se.message_id = esl.external_id
    WHERE esl.journey_id = $1 AND esl.node_id IS NOT NULL AND se.event_type IN ('Delivery','Bounce')
    GROUP BY esl.node_id
  `, [journeyId]);

  // 6) GTM website events per node
  const { rows: gtmRows } = await db.query(`
    SELECT node_id, COUNT(*) AS gtm_events
    FROM gtm_events
    WHERE journey_id = $1 AND node_id IS NOT NULL
    GROUP BY node_id
  `, [journeyId]);

  // Unsubscribes PER NODE (which email drove the opt-out) from unsubscribe_log.
  const { rows: unsubRows } = await db.query(`
    SELECT node_id, COUNT(*) AS unsubscribed
    FROM unsubscribe_log
    WHERE journey_id = $1 AND node_id IS NOT NULL
    GROUP BY node_id
  `, [journeyId]);

  // ── Lifecycle: entries / booked / exits. Normal journeys use journey_entries;
  //    continuous/GTM journeys use gtm_journey_entries. Pull journey-level totals from
  //    whichever has rows (per-node lifecycle isn't cumulative, so we keep it journey-level).
  const lifecycle = await _lifecycleTotals(journeyId);

  // ── Assemble per-node map ──
  const map = new Map(); // node_id -> stats
  const ensure = (id) => {
    if (!map.has(id)) map.set(id, {
      node_id: id, sent: 0, entries: 0, failed: 0, sends_today: 0, delivered: 0, bounced: 0,
      opened: 0, human_opened: 0, clicked: 0, human_clicked: 0, landed: 0, gtm_events: 0, unsubscribed: 0,
    });
    return map.get(id);
  };
  for (const r of baseRows)   { const n = ensure(r.node_id); n.sent = +r.sent||0; n.entries = +r.entries||0; n.failed = +r.failed||0; n.sends_today = +r.sends_today||0; }
  for (const r of openRows)   { const n = ensure(r.node_id); n.opened = +r.opened||0; n.human_opened = +r.human_opened||0; }
  for (const r of clickRows)  { const n = ensure(r.node_id); n.clicked = +r.clicked||0; n.human_clicked = +r.human_clicked||0; }
  for (const r of landedRows) { ensure(r.node_id).landed = +r.landed||0; }
  for (const r of sesRows)    { const n = ensure(r.node_id); n.delivered = +r.delivered||0; n.bounced = +r.bounced||0; }
  for (const r of gtmRows)    { ensure(r.node_id).gtm_events = +r.gtm_events||0; }
  for (const r of unsubRows)  { ensure(r.node_id).unsubscribed = +r.unsubscribed||0; }

  // Rollup row (__ALL__) = sum of node metrics + journey-level lifecycle
  const sum = (k) => [...map.values()].reduce((s, n) => s + (n[k] || 0), 0);
  const rollup = {
    node_id: ROLLUP_KEY,
    sent: sum('sent'), entries: lifecycle.entries, failed: sum('failed'), sends_today: sum('sends_today'),
    delivered: sum('delivered'), bounced: sum('bounced'),
    opened: sum('opened'), human_opened: sum('human_opened'),
    clicked: sum('clicked'), human_clicked: sum('human_clicked'),
    landed: sum('landed'), gtm_events: sum('gtm_events'), unsubscribed: sum('unsubscribed'),
  };

  // ── Persist: replace all rows for this journey in one transaction ──
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM journey_node_stats WHERE journey_id = $1', [journeyId]);

    const rows = [...map.values(), rollup];
    for (const n of rows) {
      const isRollup = n.node_id === ROLLUP_KEY;
      const meta = nodeMeta.get(n.node_id) || {};
      await client.query(`
        INSERT INTO journey_node_stats (
          journey_id, node_id, journey_name, journey_status, node_label, node_type, channel,
          target_count, entries, booked, exited_booked, exited_unsub,
          sent, sends_today, delivered, bounced,
          opened, human_opened, clicked, human_clicked, landed, gtm_events, unsubscribed, failed,
          bot_window_sec, computed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,
          $13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,$23,$24,
          $25, NOW()
        )
      `, [
        journeyId, n.node_id, jf.name, jf.status,
        isRollup ? 'All nodes' : (meta.label || n.node_id),
        isRollup ? 'summary' : (meta.type || 'unknown'),
        isRollup ? null : (meta.channel || null),
        isRollup ? lifecycle.entries : 0,   // target_count only meaningful on rollup
        n.entries,
        // booked/exited_* are journey lifecycle (per-node not attributable) → rollup row only.
        isRollup ? lifecycle.booked : 0,
        isRollup ? lifecycle.exited_booked : 0,
        isRollup ? lifecycle.exited_unsub : 0,
        n.sent, n.sends_today, n.delivered, n.bounced,
        n.opened, n.human_opened, n.clicked, n.human_clicked, n.landed, n.gtm_events, n.unsubscribed, n.failed,
        botWindowSec(),
      ]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { journeyId, nodes: map.size, ms: Date.now() - t0 };
}

/**
 * On-demand per-node metrics scoped to a single Dubai date — powers the Analytics tab's
 * date filter. Same row shape as the rollup, but every metric counts only that day's send
 * cohort (opens/clicks/landed/bounced follow those sends; gtm/unsub by their own event day).
 * Only nodes that actually sent on the date are returned. Journey-scoped + on-demand → fast;
 * booked stays null (journey-level, not node-attributable) → the UI shows '—'.
 */
export async function computeNodesForDate(journeyId, dateStr) {
  const W = String(botWindowSec());
  const { rows: [jf] } = await db.query(`SELECT nodes FROM journey_flows WHERE journey_id = $1`, [journeyId]);
  const nodeDefs = Array.isArray(jf?.nodes) ? jf.nodes : [];
  const nodeMeta = new Map(nodeDefs.map(n => [n.id, { label: n.data?.label || n.data?.title || n.id, type: n.type || 'unknown' }]));

  // Sequential (journey-scoped → small) to avoid the concurrent-scan cache thrash.
  const base = (await db.query(`
    SELECT node_id,
      COUNT(DISTINCT unified_id) AS entries,
      COUNT(DISTINCT unified_id) FILTER (WHERE status NOT IN ('failed','queued')) AS sent,
      COUNT(DISTINCT unified_id) FILTER (WHERE status = 'failed') AS failed
    FROM email_send_log
    WHERE journey_id=$1 AND node_id IS NOT NULL AND (sent_at AT TIME ZONE 'Asia/Dubai')::date = $2::date
    GROUP BY node_id`, [journeyId, dateStr])).rows;
  const opens = (await db.query(`
    SELECT node_id, COUNT(DISTINCT unified_id) AS opened,
      COUNT(DISTINCT unified_id) FILTER (WHERE opened_at - sent_at >= ($3 || ' seconds')::interval) AS human_opened
    FROM email_send_log
    WHERE journey_id=$1 AND node_id IS NOT NULL AND opened_at IS NOT NULL AND sent_at IS NOT NULL AND (sent_at AT TIME ZONE 'Asia/Dubai')::date = $2::date
    GROUP BY node_id`, [journeyId, dateStr, W])).rows;
  const clicks = (await db.query(`
    SELECT node_id, COUNT(DISTINCT unified_id) AS clicked,
      COUNT(DISTINCT unified_id) FILTER (WHERE clicked_at - sent_at >= ($3 || ' seconds')::interval) AS human_clicked
    FROM email_send_log
    WHERE journey_id=$1 AND node_id IS NOT NULL AND clicked_at IS NOT NULL AND sent_at IS NOT NULL AND (sent_at AT TIME ZONE 'Asia/Dubai')::date = $2::date
    GROUP BY node_id`, [journeyId, dateStr, W])).rows;
  const landed = (await db.query(`
    SELECT esl.node_id, COUNT(DISTINCT esl.unified_id) AS landed
    FROM email_send_log esl
    WHERE esl.journey_id=$1 AND esl.node_id IS NOT NULL AND esl.clicked_at IS NOT NULL AND esl.sent_at IS NOT NULL AND (esl.sent_at AT TIME ZONE 'Asia/Dubai')::date = $2::date
      AND EXISTS (SELECT 1 FROM gtm_events g WHERE g.unified_id = esl.unified_id AND g.journey_id = $1)
    GROUP BY esl.node_id`, [journeyId, dateStr])).rows;
  const ses = (await db.query(`
    SELECT esl.node_id,
      COUNT(*) FILTER (WHERE se.event_type='Delivery') AS delivered,
      COUNT(*) FILTER (WHERE se.event_type='Bounce')   AS bounced
    FROM email_send_log esl JOIN ses_events se ON se.message_id = esl.external_id
    WHERE esl.journey_id=$1 AND esl.node_id IS NOT NULL AND (esl.sent_at AT TIME ZONE 'Asia/Dubai')::date = $2::date AND se.event_type IN ('Delivery','Bounce')
    GROUP BY esl.node_id`, [journeyId, dateStr])).rows;
  const gtm = (await db.query(`
    SELECT node_id, COUNT(*) AS gtm_events FROM gtm_events
    WHERE journey_id=$1 AND node_id IS NOT NULL AND (created_at AT TIME ZONE 'Asia/Dubai')::date = $2::date
    GROUP BY node_id`, [journeyId, dateStr])).rows;
  const unsub = (await db.query(`
    SELECT node_id, COUNT(*) AS unsubscribed FROM unsubscribe_log
    WHERE journey_id=$1 AND node_id IS NOT NULL AND (unsubscribed_at AT TIME ZONE 'Asia/Dubai')::date = $2::date
    GROUP BY node_id`, [journeyId, dateStr])).rows;

  const map = new Map();
  const ensure = (id) => {
    if (!map.has(id)) map.set(id, { node_id: id, sent: 0, entries: 0, failed: 0, delivered: 0, bounced: 0, opened: 0, human_opened: 0, clicked: 0, human_clicked: 0, landed: 0, gtm_events: 0, unsubscribed: 0 });
    return map.get(id);
  };
  for (const r of base)   { const n = ensure(r.node_id); n.sent = +r.sent || 0; n.entries = +r.entries || 0; n.failed = +r.failed || 0; }
  for (const r of opens)  { const n = ensure(r.node_id); n.opened = +r.opened || 0; n.human_opened = +r.human_opened || 0; }
  for (const r of clicks) { const n = ensure(r.node_id); n.clicked = +r.clicked || 0; n.human_clicked = +r.human_clicked || 0; }
  for (const r of landed) { ensure(r.node_id).landed = +r.landed || 0; }
  for (const r of ses)    { const n = ensure(r.node_id); n.delivered = +r.delivered || 0; n.bounced = +r.bounced || 0; }
  for (const r of gtm)    { ensure(r.node_id).gtm_events = +r.gtm_events || 0; }
  for (const r of unsub)  { ensure(r.node_id).unsubscribed = +r.unsubscribed || 0; }

  return [...map.values()].filter(n => n.sent > 0).map(n => {
    const meta = nodeMeta.get(n.node_id) || {};
    return { ...n, node_label: meta.label || n.node_id, node_type: meta.type || 'unknown', booked: null };
  });
}

/**
 * Journey-level entries / booked / exit counts. Reads journey_entries; if that journey
 * has none (continuous/GTM engine), falls back to gtm_journey_entries.
 */
async function _lifecycleTotals(journeyId) {
  const q = async (table, exitCol) => {
    const { rows: [r] } = await db.query(`
      SELECT COUNT(*)::int AS entries,
        COUNT(*) FILTER (WHERE ${exitCol} = 'booked')::int      AS booked,
        COUNT(*) FILTER (WHERE status = 'exited' AND ${exitCol} = 'booked')::int      AS exited_booked,
        COUNT(*) FILTER (WHERE status = 'exited' AND ${exitCol} = 'unsubscribed')::int AS exited_unsub
      FROM ${table} WHERE journey_id = $1
    `, [journeyId]);
    return r;
  };
  try {
    const je = await q('journey_entries', 'exit_reason');
    if (je.entries > 0) return je;
  } catch { /* table/col mismatch → try gtm */ }
  try {
    const ge = await q('gtm_journey_entries', 'exit_reason');
    return ge;
  } catch {
    return { entries: 0, booked: 0, exited_booked: 0, exited_unsub: 0 };
  }
}

/**
 * Refresh ALL journeys, stalest-first, sequentially. Bounded by a soft time budget so a
 * run never overruns the cron cadence — leftover journeys are picked up next cycle
 * (computed_at ordering guarantees forward progress). Records a meta row for the
 * "updated X min ago" badge.
 */
export async function refreshAllJourneys({ maxMs = 25 * 60 * 1000, force = false } = {}) {
  const t0 = Date.now();

  // How stale a journey may be before we recompute it, BY STATUS. This is the key guard
  // that keeps this job from affecting other flows: a full pass over every journey costs
  // 70-97s EACH for big ones (cold cache) — far too heavy to run for all 38 every 30 min.
  // But only ACTIVE journeys actually change; completed/draft are stable and paused rarely
  // move. So after the first population, each run recomputes only the handful of active
  // journeys; the rest refresh at most ~daily. `force` recomputes everything (manual reseed).
  const STALE_MS = {
    active:    0,                    // always refresh (numbers move each send)
    paused:    6 * 60 * 60 * 1000,   // 6h
    completed: 24 * 60 * 60 * 1000,  // 24h (numbers are final; only late opens trickle in)
    draft:     24 * 60 * 60 * 1000,  // 24h (not sending)
  };

  // Stalest first: journeys never computed (LEFT JOIN NULL) rank ahead of old ones.
  const { rows: journeys } = await db.query(`
    SELECT jf.journey_id, jf.status, st.computed_at
    FROM journey_flows jf
    LEFT JOIN LATERAL (
      SELECT MIN(computed_at) AS computed_at FROM journey_node_stats s WHERE s.journey_id = jf.journey_id
    ) st ON true
    ORDER BY st.computed_at ASC NULLS FIRST, jf.journey_id
  `);

  let done = 0, failed = 0, skipped = 0;
  for (const j of journeys) {
    if (Date.now() - t0 > maxMs) {
      console.warn(`[JourneyStats] time budget hit after ${done} journeys; remaining deferred to next run`);
      break;
    }
    // Skip if this journey was computed recently enough for its status.
    if (!force && j.computed_at) {
      const ageMs = Date.now() - new Date(j.computed_at).getTime();
      const threshold = STALE_MS[j.status] ?? 6 * 60 * 60 * 1000;
      if (ageMs < threshold) { skipped++; continue; }
    }
    try {
      const r = await refreshJourney(j.journey_id);
      done++;
      if (r.ms > 8000) console.log(`[JourneyStats] journey ${j.journey_id} took ${r.ms}ms (${r.nodes} nodes)`);
    } catch (e) {
      failed++;
      console.error(`[JourneyStats] journey ${j.journey_id} failed:`, e.message);
    }
  }

  const ms = Date.now() - t0;
  await db.query(`
    INSERT INTO journey_stats_meta (id, last_run_at, last_run_ms, journeys_run)
    VALUES (true, NOW(), $1, $2)
    ON CONFLICT (id) DO UPDATE SET last_run_at = NOW(), last_run_ms = $1, journeys_run = $2
  `, [ms, done]);

  console.log(`[JourneyStats] refreshAllJourneys: ${done} refreshed, ${skipped} skipped (fresh), ${failed} failed, ${ms}ms`);
  return { done, skipped, failed, ms };
}

export default { refreshJourney, refreshAllJourneys };
