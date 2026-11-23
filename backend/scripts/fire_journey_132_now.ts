/**
 * Force every active journey_entries row on journey 132 / node_1 to be
 * immediately due (next_fire_at = NOW). The next cron tick will enqueue
 * all of them in one shot.
 *
 * Run: node backend/scripts/fire_journey_132_now.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  const JOURNEY_ID = 132;
  const NODE_ID    = 'node_1';

  console.log(`\nForcing all active entries on journey ${JOURNEY_ID} / ${NODE_ID} to fire now...`);

  // 1. Show what we're about to update
  const before = await query(`
    SELECT
      COUNT(*) AS total_active,
      COUNT(*) FILTER (WHERE next_fire_at <= NOW())              AS already_due,
      COUNT(*) FILTER (WHERE next_fire_at > NOW())               AS future,
      MIN(next_fire_at)                                          AS earliest_fire,
      MAX(next_fire_at)                                          AS latest_fire
    FROM journey_entries
    WHERE journey_id = $1 AND current_node_id = $2 AND status = 'active'
  `, [JOURNEY_ID, NODE_ID]);
  console.log('Before update:', before.rows[0]);

  // 2. Update
  const result = await query(`
    UPDATE journey_entries
    SET next_fire_at = NOW()
    WHERE journey_id = $1
      AND current_node_id = $2
      AND status = 'active'
      AND (next_fire_at > NOW() OR next_fire_at IS NULL)
  `, [JOURNEY_ID, NODE_ID]);
  console.log(`\n✓ Updated ${result.rowCount} entries — next_fire_at set to NOW()`);

  // 3. Confirm
  const after = await query(`
    SELECT COUNT(*) AS due_now
    FROM journey_entries
    WHERE journey_id = $1 AND current_node_id = $2
      AND status = 'active' AND next_fire_at <= NOW()
  `, [JOURNEY_ID, NODE_ID]);
  console.log(`Now due to fire: ${after.rows[0].due_now} entries`);
  console.log('\nThe next cron tick (every 5 min) will pick them up.');

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
