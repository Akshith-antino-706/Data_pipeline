import 'dotenv/config';
import { Pool } from 'pg';

// One-off backfill: refresh unified_contacts.name to whichever rayna_* booking
// has the latest booking_date, for ALL existing contacts.
// Batched by unified_contacts.id range to avoid one giant lock on ~1.6M rows.
//
// Usage:
//   node scripts/backfill_latest_contact_name.js            # dry run, no writes
//   node scripts/backfill_latest_contact_name.js --execute   # applies the update

const EXECUTE = process.argv.includes('--execute');
const BATCH_SIZE = 20000;

const BOOKING_TABLES = ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_packages', 'rayna_others', 'rayna_flights'];

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: { rejectUnauthorized: false },
});

function latestBookingCte() {
  const unionSql = BOOKING_TABLES.map((t) => `
    SELECT unified_id, guest_name, created_at,
      CASE WHEN booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN TO_DATE(booking_date, 'DD/MM/YYYY') END AS bd
    FROM ${t}
    WHERE unified_id >= $1 AND unified_id < $2 AND TRIM(COALESCE(guest_name,'')) <> ''
  `).join(' UNION ALL ');

  return `
    WITH latest_booking AS (
      SELECT DISTINCT ON (unified_id) unified_id, guest_name
      FROM (${unionSql}) x
      ORDER BY unified_id, bd DESC NULLS LAST, created_at DESC
    )
  `;
}

async function main() {
  const { rows: [{ min_id: minIdRaw, max_id: maxIdRaw }] } = await pool.query(
    'SELECT MIN(id) AS min_id, MAX(id) AS max_id FROM unified_contacts'
  );
  const min_id = Number(minIdRaw);
  const max_id = Number(maxIdRaw);
  console.log(`unified_contacts id range: ${min_id} - ${max_id}`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (writes will happen)' : 'DRY RUN (no writes)'}`);

  let totalWouldChange = 0;
  let totalUpdated = 0;

  for (let start = min_id; start <= max_id; start += BATCH_SIZE) {
    const end = start + BATCH_SIZE;

    if (!EXECUTE) {
      const { rows: [{ count }] } = await pool.query(
        `${latestBookingCte()}
         SELECT COUNT(*) FROM latest_booking lb
         JOIN unified_contacts uc ON uc.id = lb.unified_id
         WHERE uc.name IS DISTINCT FROM lb.guest_name`,
        [start, end]
      );
      totalWouldChange += parseInt(count, 10);
      console.log(`  [${start}-${end}) would change: ${count} (running total: ${totalWouldChange})`);
    } else {
      const result = await pool.query(
        `${latestBookingCte()}
         UPDATE unified_contacts uc
         SET name = lb.guest_name, updated_at = NOW()
         FROM latest_booking lb
         WHERE uc.id = lb.unified_id
           AND uc.name IS DISTINCT FROM lb.guest_name`,
        [start, end]
      );
      totalUpdated += result.rowCount || 0;
      console.log(`  [${start}-${end}) updated: ${result.rowCount} (running total: ${totalUpdated})`);
    }
  }

  if (!EXECUTE) {
    console.log(`\nDry run complete. Total names that would change: ${totalWouldChange}`);
    console.log('Re-run with --execute to apply.');
  } else {
    console.log(`\nExecute complete. Total names updated: ${totalUpdated}`);
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
