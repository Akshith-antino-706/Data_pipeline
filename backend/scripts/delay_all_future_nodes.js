/**
 * Delay all stragglers on node_5, node_7, node_9, node_11 to their
 * proper "every 2 days" dates so they don't fire today.
 *
 * Main wave (today's 5.5 lakh) will arrive at each node naturally
 * on its scheduled day via the Wait 2 Days nodes.
 *
 * Run: node backend/scripts/delay_all_future_nodes.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

const SCHEDULE = [
  { node: 'node_5',  date: '2026-06-06 06:30:00+00', label: 'Day 3 Visa' },
  { node: 'node_7',  date: '2026-06-08 06:30:00+00', label: 'Day 4 Holiday' },
  { node: 'node_9',  date: '2026-06-10 06:30:00+00', label: 'Day 5 Activities' },
  { node: 'node_11', date: '2026-06-12 06:30:00+00', label: 'Day 6 Destinations' },
];

async function main() {
  console.log('\nDelaying stragglers on future nodes...\n');

  for (const { node, date, label } of SCHEDULE) {
    const result = await query(`
      UPDATE journey_entries
      SET next_fire_at = $2::timestamptz
      WHERE journey_id = 132
        AND current_node_id = $1
        AND status = 'active'
        AND next_fire_at < $2::timestamptz
    `, [node, date]);
    console.log(`  ${node} (${label.padEnd(20)}) → ${result.rowCount} entries delayed to ${date}`);
  }

  console.log('\n── Final state ──');
  const summary = await query(`
    SELECT current_node_id, COUNT(*) AS total, MIN(next_fire_at) AS earliest, MAX(next_fire_at) AS latest
    FROM journey_entries
    WHERE journey_id = 132 AND status = 'active'
      AND current_node_id IN ('node_3','node_5','node_7','node_9','node_11')
    GROUP BY current_node_id
    ORDER BY current_node_id
  `);
  summary.rows.forEach(r => console.log(`  ${r.current_node_id}: ${r.total} entries, earliest ${r.earliest}`));

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
