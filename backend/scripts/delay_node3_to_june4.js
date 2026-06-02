/**
 * Push all journey-132 entries currently at node_3 (Day 2 Cruise) to
 * fire on June 4, 2026 at 12:00 IST (06:30 UTC). Prevents the 645 old
 * stragglers from firing today.
 *
 * Today's main wave will arrive at node_3 naturally on June 4 too.
 *
 * Run: node backend/scripts/delay_node3_to_june4.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  const JOURNEY_ID = 132;
  const NODE_ID    = 'node_3';
  const FIRE_AT_UTC = '2026-06-04 06:30:00+00';  // = 12:00 IST = 10:30 Dubai

  console.log(`\nDelaying journey ${JOURNEY_ID} / ${NODE_ID} entries to fire on June 4, 2026 at 12:00 IST...\n`);

  // 1. Before snapshot
  const before = await query(`
    SELECT
      COUNT(*) AS total_active,
      COUNT(*) FILTER (WHERE next_fire_at <= NOW())  AS due_now,
      MIN(next_fire_at) AS earliest_fire
    FROM journey_entries
    WHERE journey_id = $1 AND current_node_id = $2 AND status = 'active'
  `, [JOURNEY_ID, NODE_ID]);
  console.log('Before:', before.rows[0]);

  // 2. Update
  const result = await query(`
    UPDATE journey_entries
    SET next_fire_at = $3::timestamptz
    WHERE journey_id = $1
      AND current_node_id = $2
      AND status = 'active'
  `, [JOURNEY_ID, NODE_ID, FIRE_AT_UTC]);
  console.log(`\n✓ Updated ${result.rowCount} entries — next_fire_at = ${FIRE_AT_UTC}`);

  // 3. After snapshot
  const after = await query(`
    SELECT
      COUNT(*) AS total_active,
      COUNT(*) FILTER (WHERE next_fire_at <= NOW())  AS due_now,
      MIN(next_fire_at) AS earliest_fire
    FROM journey_entries
    WHERE journey_id = $1 AND current_node_id = $2 AND status = 'active'
  `, [JOURNEY_ID, NODE_ID]);
  console.log('After: ', after.rows[0]);
  console.log('\nNo node_3 sends will fire until June 4, 2026 at 12:00 IST.');

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
