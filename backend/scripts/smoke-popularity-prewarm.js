/**
 * Smoke test for the T-60 popularity prewarm.
 *
 *   node backend/scripts/smoke-popularity-prewarm.js [journeyId]
 *
 * What it does:
 *   1. Picks the first wait node in the journey, sets a fake `last_event` on
 *      one entry so the wait will elapse exactly 60 min from now (i.e., fire
 *      time = T+60).
 *   2. Calls JourneyService.prewarmJourneyPopularity().
 *   3. Verifies popularity_snapshots received rows under the deterministic
 *      bucketed run_id (PopularityService.runIdForBucket).
 *   4. Verifies a second prewarm call is a no-op (ON CONFLICT DO NOTHING).
 *   5. Restores the entry's original last_event timestamp.
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import JourneyService from '../src/services/JourneyService.js';
import PopularityService from '../src/services/PopularityService.js';

const JOURNEY_ID = parseInt(process.argv[2] || '120');

async function main() {
  console.log(`Provider: ${PopularityService.provider()}`);
  console.log(`Journey:  ${JOURNEY_ID}\n`);

  const { rows: [journey] } = await db.query(
    `SELECT name, nodes FROM journey_flows WHERE journey_id = $1`, [JOURNEY_ID]);
  if (!journey) throw new Error(`journey ${JOURNEY_ID} not found`);

  const waitNode = (journey.nodes || []).find(n => n.type === 'wait');
  if (!waitNode) throw new Error(`journey ${JOURNEY_ID} has no wait node`);
  console.log(`Wait node:  ${waitNode.id}  (${waitNode.data?.waitDays || 1} day${(waitNode.data?.waitDays || 1) === 1 ? '' : 's'})`);

  // Find an entry sitting on this wait node.
  const { rows: [entry] } = await db.query(
    `SELECT entry_id, current_node_id, entered_at,
            (SELECT MAX(created_at) FROM journey_events WHERE entry_id = je.entry_id) AS last_event
       FROM journey_entries je
      WHERE journey_id = $1 AND status = 'active' AND current_node_id = $2
      ORDER BY entry_id LIMIT 1`,
    [JOURNEY_ID, waitNode.id]);
  if (!entry) {
    console.log(`No active entry on wait node ${waitNode.id} — nothing to test.`);
    process.exit(0);
  }
  console.log(`Entry:      ${entry.entry_id}  current_node=${entry.current_node_id}  last_event=${entry.last_event || entry.entered_at}\n`);

  // Force fire-time to be exactly T+60 by writing a synthetic journey_event.
  const waitDays = waitNode.data?.waitDays || 1;
  const fakeLastEvent = new Date(Date.now() + 60 * 60_000 - waitDays * 86_400_000);
  console.log(`Pretending last_event = ${fakeLastEvent.toISOString()} → fire time = T+60min`);

  const { rows: [insertedEvent] } = await db.query(
    `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details, created_at)
     VALUES ($1, $2, 'smoke_test_marker', NULL, '{"test":true}'::jsonb, $3)
     RETURNING event_id`,
    [entry.entry_id, waitNode.id, fakeLastEvent]);

  try {
    const expectedRunId = PopularityService.runIdForBucket(JOURNEY_ID);
    console.log(`Expected run_id (bucketed): ${expectedRunId}\n`);

    // Clear any rows already in the day-bucket so the test is clean.
    await db.query(
      `DELETE FROM popularity_snapshots WHERE journey_id = $1 AND run_id = $2`,
      [JOURNEY_ID, expectedRunId]);

    console.log('First prewarm call:');
    const r1 = await JourneyService.prewarmJourneyPopularity({
      journeyId: JOURNEY_ID, lookaheadMinutes: 60, windowMinutes: 30,
    });
    console.log(`  ${JSON.stringify(r1)}`);

    const { rows: postFirst } = await db.query(
      `SELECT node_id, COUNT(*) AS rows FROM popularity_snapshots
        WHERE journey_id = $1 AND run_id = $2
        GROUP BY node_id ORDER BY node_id`,
      [JOURNEY_ID, expectedRunId]);
    console.log(`  popularity_snapshots after first call:`);
    for (const r of postFirst) console.log(`    ${r.node_id}: ${r.rows} rows`);

    // Second call should be a no-op (ON CONFLICT DO NOTHING).
    console.log('\nSecond prewarm call (should be no-op):');
    const r2 = await JourneyService.prewarmJourneyPopularity({
      journeyId: JOURNEY_ID, lookaheadMinutes: 60, windowMinutes: 30,
    });
    console.log(`  ${JSON.stringify(r2)}`);

    const { rows: postSecond } = await db.query(
      `SELECT node_id, COUNT(*) AS rows FROM popularity_snapshots
        WHERE journey_id = $1 AND run_id = $2
        GROUP BY node_id ORDER BY node_id`,
      [JOURNEY_ID, expectedRunId]);
    console.log(`  popularity_snapshots after second call:`);
    for (const r of postSecond) console.log(`    ${r.node_id}: ${r.rows} rows`);

    const sameRows = JSON.stringify(postFirst) === JSON.stringify(postSecond);
    console.log(`\n${sameRows ? '✓' : '✗'} idempotency check: ${sameRows ? 'second call did not duplicate rows' : 'ROWS CHANGED — bug!'}`);
  } finally {
    // Clean up the synthetic event regardless.
    await db.query(`DELETE FROM journey_events WHERE event_id = $1`, [insertedEvent.event_id]);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
