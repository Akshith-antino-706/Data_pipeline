/**
 * Backfill unified_contacts from unlinked Rayna booking rows and link them back.
 *
 * 12,431 rayna_tours rows + ~2,600 others have valid phone OR email but sit with
 * unified_id=NULL. The nightly sync has been missing them; this script reconciles.
 *
 *   1. syncNewRaynaContacts — create unified_contacts for every new (phone|email)
 *   2. relinkRawTables      — set unified_id on rayna rows by phone_key / email_key
 *   3. Report delta
 *
 * Run: node scripts/backfill_rayna_contacts.js
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import UnifiedContactSync from '../src/services/UnifiedContactSync.js';

async function countUnlinked() {
  const { rows: [r] } = await db.query<Record<'tours' | 'hotels' | 'visas' | 'flights' | 'contacts_total', string>>(`
    SELECT
      (SELECT COUNT(*) FROM rayna_tours   WHERE unified_id IS NULL) AS tours,
      (SELECT COUNT(*) FROM rayna_hotels  WHERE unified_id IS NULL) AS hotels,
      (SELECT COUNT(*) FROM rayna_visas   WHERE unified_id IS NULL) AS visas,
      (SELECT COUNT(*) FROM rayna_flights WHERE unified_id IS NULL) AS flights,
      (SELECT COUNT(*) FROM unified_contacts) AS contacts_total
  `);
  return r;
}

async function main() {
  console.log('\n=== BEFORE ===');
  const before = await countUnlinked();
  console.log(before);

  console.log('\n=== Stage 1: creating unified_contacts from unlinked Rayna rows ===');
  const t1 = Date.now();
  const created = await UnifiedContactSync.syncNewRaynaContacts();
  console.log(`Created in ${((Date.now() - t1) / 1000).toFixed(1)}s:`, created);

  console.log('\n=== Stage 2: linking rayna rows to unified_contacts ===');
  const t2 = Date.now();
  const linked = await UnifiedContactSync.relinkRawTables();
  console.log(`Linked in ${((Date.now() - t2) / 1000).toFixed(1)}s:`, linked);

  console.log('\n=== AFTER ===');
  const after = await countUnlinked();
  console.log(after);

  console.log('\n=== DELTA ===');
  console.log({
    contacts_added: (after.contacts_total as unknown as number) - (before.contacts_total as unknown as number),
    tours_linked: (before.tours as unknown as number) - (after.tours as unknown as number),
    hotels_linked: (before.hotels as unknown as number) - (after.hotels as unknown as number),
    visas_linked: (before.visas as unknown as number) - (after.visas as unknown as number),
    flights_linked: (before.flights as unknown as number) - (after.flights as unknown as number),
  });

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
