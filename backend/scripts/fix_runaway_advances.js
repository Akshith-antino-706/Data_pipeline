/**
 * Two-part fix to keep ONLY node_1 sending today:
 *
 * 1. Move any contacts that snuck into node_3, node_5, node_7, node_9, node_11
 *    BACK to their preceding wait node with future next_fire_at.
 *
 * 2. Push any node_2/node_4/node_6/node_8/node_10/node_12 entries with
 *    next_fire_at < June 4 to June 4 so cron doesn't advance them today.
 *
 * Run: node backend/scripts/fix_runaway_advances.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  console.log('\nLocking down all non-node_1 nodes...\n');

  // 1. Move runaway entries from action nodes back to preceding wait nodes
  const moves = [
    { from: 'node_3', to: 'node_2',  fireAt: '2026-06-04 06:30:00+00' },
    { from: 'node_5', to: 'node_4',  fireAt: '2026-06-06 06:30:00+00' },
    { from: 'node_7', to: 'node_6',  fireAt: '2026-06-08 06:30:00+00' },
    { from: 'node_9', to: 'node_8',  fireAt: '2026-06-10 06:30:00+00' },
    { from: 'node_11', to: 'node_10', fireAt: '2026-06-12 06:30:00+00' },
  ];

  for (const m of moves) {
    const r = await query(`
      UPDATE journey_entries
      SET current_node_id = $2, next_fire_at = $3::timestamptz, last_enqueued_at = NULL
      WHERE journey_id = 132 AND status = 'active' AND current_node_id = $1
    `, [m.from, m.to, m.fireAt]);
    console.log(`  ${m.from} → ${m.to}: ${r.rowCount} runaway entries moved (fire ${m.fireAt})`);
  }

  // 2. Push any wait node entries with past next_fire_at to their proper date
  // (prevents cron from advancing them to action node today)
  const waitFixes = [
    { node: 'node_2',  fireAt: '2026-06-04 06:30:00+00' },
    { node: 'node_4',  fireAt: '2026-06-06 06:30:00+00' },
    { node: 'node_6',  fireAt: '2026-06-08 06:30:00+00' },
    { node: 'node_8',  fireAt: '2026-06-10 06:30:00+00' },
    { node: 'node_10', fireAt: '2026-06-12 06:30:00+00' },
    { node: 'node_12', fireAt: '2026-06-14 06:30:00+00' },
  ];

  for (const w of waitFixes) {
    const r = await query(`
      UPDATE journey_entries
      SET next_fire_at = $2::timestamptz
      WHERE journey_id = 132 AND status = 'active' AND current_node_id = $1
        AND next_fire_at < $2::timestamptz
    `, [w.node, w.fireAt]);
    console.log(`  ${w.node}: ${r.rowCount} entries pushed to ${w.fireAt}`);
  }

  // 3. Final verification — show node distribution
  console.log('\n── Final state ──');
  const dist = await query(`
    SELECT current_node_id, COUNT(*) AS total,
           COUNT(*) FILTER (WHERE next_fire_at <= NOW()) AS due_now
    FROM journey_entries
    WHERE journey_id = 132 AND status = 'active'
    GROUP BY current_node_id
    ORDER BY current_node_id
  `);
  dist.rows.forEach(r => console.log(`  ${r.current_node_id}: total=${r.total}, due_now=${r.due_now}`));

  console.log('\n✓ Only node_1 should have due_now > 0. Everything else locked to future dates.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
