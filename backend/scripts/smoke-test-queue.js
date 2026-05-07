/**
 * Smoke test the full queue pipeline: ioredis connection → BullMQ enqueue →
 * worker pulls job → render with snapshot → simulated Chathead send → journey_events
 * insert → entry advance.
 *
 *   node backend/scripts/smoke-test-queue.js [journeyId=120]
 *
 * Requires Redis up (brew services start redis). CHATHEAD_API_TOKEN may be unset
 * — the email channel falls back to simulation mode and still exercises the
 *   full worker code path.
 *
 * The script:
 *   1. Verifies ioredis can PING.
 *   2. Resets the test entries' last_run_id so they're eligible for enqueue.
 *   3. Calls JourneyService.processJourney(journeyId) — producer side.
 *   4. Starts workers in-process and waits up to 30s for them to drain.
 *   5. Reports per-entry journey_events + final node id.
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import JourneyService from '../src/services/JourneyService.js';
import { startWorkers, stopWorkers } from '../src/services/queue/workers.js';
import { getConnection, queueCounts, closeQueues } from '../src/services/queue/index.js';

const journeyId = parseInt(process.argv[2] || '120');

async function pingRedis() {
  const conn = getConnection();
  const t0 = Date.now();
  const reply = await conn.ping();
  console.log(`✓ ioredis PING → ${reply} (${Date.now() - t0}ms)`);
}

async function showJourneyEntries() {
  const { rows } = await db.query(
    `SELECT je.entry_id, je.customer_id, uc.name, uc.email, je.current_node_id,
            je.status, je.last_run_id IS NOT NULL AS in_flight
       FROM journey_entries je
       JOIN unified_contacts uc ON uc.unified_id = je.customer_id
      WHERE je.journey_id = $1
      ORDER BY je.entry_id`, [journeyId]);
  console.log('Entries:');
  for (const r of rows) console.log(`  · ${r.entry_id}  ${r.name}  <${r.email}>  node=${r.current_node_id}  status=${r.status}  in_flight=${r.in_flight}`);
  return rows;
}

async function showRecentEvents(entryIds) {
  const { rows } = await db.query(
    `SELECT entry_id, node_id, event_type, channel, details->'sendResult'->>'success' AS sent_ok,
            details->'sendResult'->>'simulated' AS simulated, created_at
       FROM journey_events WHERE entry_id = ANY($1::int[])
      ORDER BY created_at DESC, event_id DESC LIMIT 20`, [entryIds]);
  console.log(`\njourney_events (most recent for ${entryIds.length} entries):`);
  for (const r of rows) console.log(`  · entry=${r.entry_id}  node=${r.node_id}  ${r.event_type}  channel=${r.channel}  sent_ok=${r.sent_ok}  simulated=${r.simulated}`);
}

async function waitForDrain(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const c = await queueCounts('email');
    if (c.waiting === 0 && c.active === 0 && c.delayed === 0) return c;
    await new Promise(r => setTimeout(r, 500));
  }
  return queueCounts('email');
}

async function main() {
  await pingRedis();

  // 1. Reset run-tracking on these entries so processJourney enqueues them again
  await db.query(
    `UPDATE journey_entries SET last_run_id = NULL, last_enqueued_at = NULL,
       current_node_id = (SELECT (nodes->0->>'id') FROM journey_flows WHERE journey_id = $1),
       status = 'active', completed_at = NULL
     WHERE journey_id = $1`,
    [journeyId]
  );
  console.log(`\nReset journey_entries for journey ${journeyId}`);
  const entriesBefore = await showJourneyEntries();

  // 2. Producer: first call advances entries past the trigger node,
  //    second call sees them at the action node and enqueues sends.
  console.log(`\nRunning processJourney(${journeyId}) — pass 1 (advance through trigger)…`);
  let result = await JourneyService.processJourney(journeyId);
  console.log(`  result: ${JSON.stringify(result)}`);
  console.log(`\nRunning processJourney(${journeyId}) — pass 2 (enqueue action sends)…`);
  result = await JourneyService.processJourney(journeyId);
  console.log(`  result: ${JSON.stringify(result)}`);

  console.log(`  queue counts after enqueue: ${JSON.stringify(await queueCounts('email'))}`);

  // 3. Workers
  console.log(`\nStarting workers (in-process)…`);
  startWorkers();

  // 4. Wait for drain
  const finalCounts = await waitForDrain(30_000);
  console.log(`\nQueue drained: ${JSON.stringify(finalCounts)}`);

  // 5. Inspect outcome
  const entriesAfter = await showJourneyEntries();
  await showRecentEvents(entriesBefore.map(e => e.entry_id));

  await stopWorkers();
  await closeQueues();

  // Summary
  const sentOk = await db.query(
    `SELECT count(*) AS n FROM journey_events
       WHERE entry_id = ANY($1::bigint[]) AND event_type='action_sent'`,
    [entriesBefore.map(e => e.entry_id)]);
  console.log(`\n✓ ${sentOk.rows[0].n} send(s) recorded.`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
