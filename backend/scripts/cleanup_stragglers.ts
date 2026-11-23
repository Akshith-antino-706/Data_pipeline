/**
 * Move stragglers BACK from action nodes (node_3, node_5) to their preceding
 * wait nodes (node_2, node_4). Result:
 *   - node_3 shows 0 active entries → badge will show PENDING
 *   - node_5 shows 0 active entries → badge will show PENDING
 *   - Stragglers naturally cascade through the journey with the main wave
 *
 * The 447 leaked contacts at node_4 are LEFT ALONE — moving them back to
 * node_3 would cause them to get Day 2 Cruise a second time (duplicate spam).
 *
 * Run: node backend/scripts/cleanup_stragglers.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  console.log('\nMoving stragglers back to wait nodes...\n');

  // node_3 → node_2 (Wait 2 Days, next_fire_at = June 4 — same as main wave)
  const n3 = await query(`
    UPDATE journey_entries
    SET current_node_id = 'node_2', next_fire_at = '2026-06-04 06:30:00+00'::timestamptz
    WHERE journey_id = 132 AND status = 'active' AND current_node_id = 'node_3'
  `);
  console.log(`  node_3 → node_2: ${n3.rowCount} stragglers moved (will hit node_3 on June 4 with main wave)`);

  // node_5 → node_4 (Wait 2 Days, next_fire_at = June 6 — same as main wave)
  const n5 = await query(`
    UPDATE journey_entries
    SET current_node_id = 'node_4', next_fire_at = '2026-06-06 06:30:00+00'::timestamptz
    WHERE journey_id = 132 AND status = 'active' AND current_node_id = 'node_5'
  `);
  console.log(`  node_5 → node_4: ${n5.rowCount} stragglers moved (will hit node_5 on June 6 with main wave)`);

  console.log('\n── Verify each action node has 0 active stragglers ──');
  const after = await query(`
    SELECT current_node_id, COUNT(*) AS total
    FROM journey_entries
    WHERE journey_id = 132 AND status = 'active'
      AND current_node_id IN ('node_1','node_3','node_5','node_7','node_9','node_11')
    GROUP BY current_node_id
    ORDER BY current_node_id
  `);
  after.rows.forEach(r => console.log(`  ${r.current_node_id}: ${r.total} active`));

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
