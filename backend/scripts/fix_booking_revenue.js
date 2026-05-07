/**
 * Re-aggregate unified_contacts.total_booking_revenue + booking counts from the
 * four Rayna tables, then refresh the segmentation MV. Fixes the ~36% under-count
 * caused by the old incremental math.
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import UnifiedContactSync from '../src/services/UnifiedContactSync.js';

async function totals() {
  const { rows: [r] } = await db.query(`
    SELECT
      (SELECT SUM(total_sell)     FROM rayna_tours   WHERE status IS NULL OR status != 'Cancelled')::numeric(14,2) AS src_tours,
      (SELECT SUM(total_sell)     FROM rayna_hotels)::numeric(14,2) AS src_hotels,
      (SELECT SUM(total_sell)     FROM rayna_visas)::numeric(14,2)  AS src_visas,
      (SELECT SUM(selling_price)  FROM rayna_flights WHERE status IS NULL OR status != 'Cancelled')::numeric(14,2) AS src_flights,
      (SELECT SUM(total_booking_revenue) FROM unified_contacts)::numeric(14,2) AS cached_total,
      (SELECT SUM(total_booking_revenue) FROM unified_contacts WHERE business_type='B2C')::numeric(14,2) AS cached_b2c,
      (SELECT SUM(total_booking_revenue) FROM unified_contacts WHERE business_type='B2B')::numeric(14,2) AS cached_b2b
  `);
  return r;
}

async function main() {
  console.log('BEFORE:'); console.log(await totals());

  const t0 = Date.now();
  await UnifiedContactSync.syncRaynaBookings();
  console.log(`\nsyncRaynaBookings done in ${((Date.now()-t0)/1000).toFixed(1)}s`);

  await db.query('REFRESH MATERIALIZED VIEW mv_segmentation_tree');
  console.log('MV refreshed');

  console.log('\nAFTER:'); console.log(await totals());
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
