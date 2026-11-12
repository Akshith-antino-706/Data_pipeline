/**
 * The 548 node_3 leaked contacts received Day 2 Cruise today (June 2).
 * Without intervention, they'd get Day 3 on June 4, Day 4 on June 6, etc. —
 * always 2 days ahead of the main wave.
 *
 * This script pushes their next_fire_at so they wait at node_4 longer,
 * syncing them back to the main wave schedule:
 *   - Day 3 (node_5) on June 6 (instead of June 4)
 *
 * After that, the natural 2-day waits keep them in sync.
 *
 * Run: node backend/scripts/sync_leaked_to_mainwave.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  const NODE_4_FIRE_AT = '2026-06-06 06:30:00+00';  // = June 6 12:00 IST

  console.log('\nSyncing leaked node_3 contacts back to main wave schedule...\n');

  // Find contacts who:
  //  - are currently at node_4 (Wait 2 Days after Day 2)
  //  - already sent node_3 today (the 548 leaked)
  //  - have next_fire_at < June 6 (so they'd fire too early)
  const result = await query(`
    UPDATE journey_entries je
    SET next_fire_at = $1::timestamptz
    WHERE journey_id = 132
      AND current_node_id = 'node_4'
      AND status = 'active'
      AND next_fire_at < $1::timestamptz
      AND EXISTS (
        SELECT 1 FROM email_send_log esl
        WHERE esl.journey_id = 132
          AND esl.node_id = 'node_3'
          AND esl.unified_id = je.customer_id
          AND esl.sent_at >= CURRENT_DATE
      )
  `, [NODE_4_FIRE_AT]);

  console.log(`✓ Updated ${result.rowCount} contacts — Day 3 will fire on June 6, 2026 (synced with main wave)`);

  // Verify
  const after = await query(`
    SELECT current_node_id, COUNT(*) AS total, MIN(next_fire_at) AS earliest
    FROM journey_entries
    WHERE journey_id = 132 AND status = 'active' AND current_node_id = 'node_4'
    GROUP BY current_node_id
  `);
  console.log('\nnode_4 (Wait 2 Days after Day 2):', after.rows[0]);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
