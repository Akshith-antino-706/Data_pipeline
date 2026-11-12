/**
 * Run the full segmentation recompute once, end to end.
 * Use after any event that leaves booking_status in an inconsistent state
 * (e.g. an aborted recompute).
 */
import 'dotenv/config';
import UnifiedContactSync from '../src/services/UnifiedContactSync.js';
import pool from '../src/config/database.js';

async function main() {
  console.log('Recomputing segments...');
  const t = Date.now();
  const segments = await UnifiedContactSync.computeSegments();
  console.log(`Segments done in ${((Date.now() - t) / 1000).toFixed(1)}s:`, segments.map(r => `${r.booking_status}=${r.cnt}`).join(', '));

  console.log('Refreshing materialized view...');
  await pool.query('REFRESH MATERIALIZED VIEW mv_segmentation_tree');

  console.log('Done.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
