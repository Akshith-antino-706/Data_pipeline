/**
 * dailyJourneyReSnapshot
 *
 * Nightly re-enrollment for rec journeys (on_trip / future_trip). Fixed
 * journeys normally snapshot ONCE at creation, but these journey types target
 * a rolling segment (users whose travel_date is in a rolling 7-day window).
 * So each night we re-scan the segment and add newly-eligible users as fresh
 * entries at node_1.
 *
 * ADDITIVE — no touch to existing snapshot logic. Uses the same
 * `journey_entries` table and the same worker path (`processEmail`) — so AI
 * rec injection continues to fire on send.
 *
 * Only touches journeys with:
 *   - status = 'active'
 *   - recommendation_type IN ('on_trip', 'future_trip')
 *   - journey_type = 'normal' (fixed)
 * Continuous/GTM journeys are ignored — they enroll via events, not snapshot.
 *
 * Runs at 2:30 AM Dubai (after the 2:00 AM segment refresh so booking_status
 * on unified_contacts is up-to-date first).
 */

import db from '../config/database.js';

async function _reSnapshotOne(journey) {
  const { journey_id, name, custom_segment_id, segment_id, audience, nodes } = journey;
  const firstNodeId = (Array.isArray(nodes) ? nodes : [])[0]?.id || 'node_0';

  // Resolve the target user set from either the custom or standard segment
  let inserted = 0;

  if (custom_segment_id) {
    // Reuse CustomSegmentService to build the users-in-segment SQL
    const { default: CustomSegmentService } = await import('../services/CustomSegmentService.js');
    const seg = await CustomSegmentService.getById(custom_segment_id);
    if (!seg) { console.warn(`[ReSnapshot] journey=${journey_id} — custom segment ${custom_segment_id} not found`); return 0; }
    const { sql: segSql, params: segParams } =
      CustomSegmentService.buildSegmentSQL(seg.conditions || [], { select: 'uc.id, uc.is_indian' });

    let audienceWhere = '';
    if (audience === 'indian') audienceWhere = 'AND seg.is_indian = true';
    else if (audience === 'rest') audienceWhere = 'AND seg.is_indian = false';

    const nBase = segParams.length;
    const { rowCount } = await db.query(`
      INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track, status)
      SELECT $${nBase + 1}, seg.id, $${nBase + 2},
             CASE WHEN seg.is_indian THEN 'indian' ELSE 'rest' END,
             'snapshot'
      FROM   (${segSql}) AS seg
      WHERE  true ${audienceWhere}
      ON CONFLICT DO NOTHING
    `, [...segParams, journey_id, firstNodeId]);
    inserted = rowCount;

  } else if (segment_id) {
    let audienceFilter = '';
    if (audience === 'indian') audienceFilter = 'AND uc.is_indian = true';
    else if (audience === 'rest') audienceFilter = 'AND uc.is_indian = false';

    const { rowCount } = await db.query(`
      INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track, status)
      SELECT $1, sc.customer_id, $2,
             CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END,
             'snapshot'
      FROM   segment_customers sc
      JOIN   unified_contacts uc ON uc.id = sc.customer_id
      WHERE  sc.segment_id = $3 AND sc.is_active = true ${audienceFilter}
      ON CONFLICT DO NOTHING
    `, [journey_id, firstNodeId, segment_id]);
    inserted = rowCount;
  } else {
    console.warn(`[ReSnapshot] journey=${journey_id} (${name}) — no segment attached, skipping`);
    return 0;
  }

  // Refresh journey_flows totals with the CURRENT count (not the delta)
  await db.query(`
    UPDATE journey_flows
    SET total_entries = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1)
    WHERE journey_id = $1
  `, [journey_id]);

  return inserted;
}

/**
 * Entry point — called by node-cron each night at 2:30 AM Dubai.
 * Exported for manual runs / testing.
 */
export async function runDailyJourneyReSnapshot() {
  console.log(`[ReSnapshot] === Starting daily journey re-snapshot at ${new Date().toISOString()} ===`);

  const { rows: journeys } = await db.query(`
    SELECT journey_id, name, recommendation_type, segment_id, custom_segment_id, audience, nodes
    FROM journey_flows
    WHERE status = 'active'
      AND COALESCE(journey_type, 'normal') = 'normal'
      AND recommendation_type IN ('on_trip', 'future_trip')
    ORDER BY journey_id
  `);

  console.log(`[ReSnapshot] Found ${journeys.length} eligible journey(s)`);

  const results = [];
  for (const j of journeys) {
    try {
      const added = await _reSnapshotOne(j);
      console.log(`[ReSnapshot] journey=${j.journey_id} (${j.name}) type=${j.recommendation_type} — added ${added} new entries`);
      results.push({ journey_id: j.journey_id, added });
    } catch (err) {
      console.error(`[ReSnapshot] journey=${j.journey_id} FAILED: ${err.message}`);
      results.push({ journey_id: j.journey_id, error: err.message });
    }
  }

  console.log(`[ReSnapshot] === Done ===`, JSON.stringify(results));
  return results;
}

export default runDailyJourneyReSnapshot;
