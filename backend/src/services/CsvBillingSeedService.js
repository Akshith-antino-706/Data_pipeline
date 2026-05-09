import fs from 'fs';
import { createReadStream } from 'fs';
import readline from 'readline';
import { transaction, query } from '../config/database.js';

/**
 * CSV Billing Data → PostgreSQL Seed Service
 *
 * Reads a CSV file with columns:
 *   BillSerial, BillNo, BillType, IsB2B, ServiceId, TravelDate,
 *   ServiceName, SellingPrice, IsCancel, Guest_Name, Nationality,
 *   Guest_Contact, Guest_Email, Guest_Age, BookingDate
 *
 * Routes each row into the correct table by BillType:
 *   rayna_tours    ← Tours, OnlineTour
 *   rayna_packages ← Package
 *   rayna_hotels   ← Hotel, HotelAmendment, HotelOTH
 *   rayna_visas    ← Visa, IntlVisa
 *   rayna_flights  ← (future use)
 *   rayna_others   ← Ticket, Insurance, OTB, NULL/empty
 */

const TABLE_MAP = {
  tours:          'rayna_tours',
  onlinetour:     'rayna_tours',
  package:        'rayna_packages',
  hotel:          'rayna_hotels',
  hotelamendment: 'rayna_hotels',
  hoteloth:       'rayna_hotels',
  visa:           'rayna_visas',
  intlvisa:       'rayna_visas',
  ticket:         'rayna_others',
  insurance:      'rayna_others',
  otb:            'rayna_others',
};

const COLUMNS = [
  'bill_serial', 'bill_no', 'bill_type', 'is_b2b', 'service_id',
  'travel_date', 'service_name', 'selling_price', 'is_cancel', 'guest_name',
  'nationality', 'guest_contact', 'guest_email', 'guest_age', 'booking_date',
];

const BATCH_SIZE = 2000;

function getTable(billType) {
  return TABLE_MAP[(billType || '').trim().toLowerCase()] || 'rayna_others';
}

function mapCsvRow(row) {
  // row is an array: [BillSerial, BillNo, BillType, IsB2B, ServiceId, TravelDate,
  //   ServiceName, SellingPrice, IsCancel, Guest_Name, Nationality,
  //   Guest_Contact, Guest_Email, Guest_Age, BookingDate]
  return {
    bill_serial:   row[0] ?? '',
    bill_no:       row[1] ?? '',
    bill_type:     row[2] ?? '',
    is_b2b:        row[3] ?? '',
    service_id:    row[4] ?? '',
    travel_date:   row[5] ?? '',
    service_name:  row[6] ?? '',
    selling_price: parseFloat(row[7]) || 0,
    is_cancel:     row[8] ?? '',
    guest_name:    row[9] ?? '',
    nationality:   row[10] ?? '',
    guest_contact: row[11] ?? '',
    guest_email:   row[12] ?? '',
    guest_age:     row[13] ?? '',
    booking_date:  row[14] ?? '',
  };
}

function mapJsonRow(r) {
  return {
    bill_serial:   String(r.BillSerial ?? ''),
    bill_no:       String(r.BillNo ?? ''),
    bill_type:     r.BillType ?? '',
    is_b2b:        String(r.IsB2B ?? ''),
    service_id:    String(r.ServiceId ?? ''),
    travel_date:   (r.TravelDate || '').slice(0, 10),
    service_name:  r.ServiceName ?? '',
    selling_price: parseFloat(r.SellingPrice) || 0,
    is_cancel:     String(r.IsCancel ?? ''),
    guest_name:    r.Guest_Name ?? '',
    nationality:   r.Nationality ?? '',
    guest_contact: r.Guest_Contact ?? '',
    guest_email:   r.Guest_Email ?? '',
    guest_age:     String(r.Guest_Age ?? ''),
    booking_date:  r.BookingDate ?? '',
  };
}

async function insertBatch(client, tableName, rows) {
  if (rows.length === 0) return;

  const values = [];
  const valueClauses = rows.map((row, rowIdx) => {
    const placeholders = COLUMNS.map((col, colIdx) => {
      let val = row[col];
      if (typeof val === 'string') val = val.replace(/\0/g, '');
      values.push(val ?? null);
      return `$${rowIdx * COLUMNS.length + colIdx + 1}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  await client.query(
    `INSERT INTO ${tableName} (${COLUMNS.join(', ')}) VALUES ${valueClauses.join(', ')}`,
    values
  );
}

// ─── CSV line parser (handles quoted fields with commas) ───
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ─── Main: Seed from CSV file (streaming — handles large files) ──
export async function seedFromCsv(csvPath) {
  console.log(`[CsvSeed] Reading ${csvPath}...`);

  const rl = readline.createInterface({
    input: createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  // Group by target table — flush in batches
  const buckets = {};
  const results = {};
  let total = 0;
  let skipped = 0;

  for await (let line of rl) {
    // Strip BOM from first line
    if (total === 0 && line.charCodeAt(0) === 0xFEFF) {
      line = line.slice(1);
    }

    const row = parseCsvLine(line);
    if (row.length < 15) { skipped++; continue; }

    const mapped = mapCsvRow(row);
    const table = getTable(mapped.bill_type);
    if (!buckets[table]) buckets[table] = [];
    buckets[table].push(mapped);
    total++;

    // Flush when any bucket hits BATCH_SIZE
    for (const tbl of Object.keys(buckets)) {
      if (buckets[tbl].length >= BATCH_SIZE) {
        await transaction(async (client) => {
          await insertBatch(client, tbl, buckets[tbl]);
        });
        results[tbl] = (results[tbl] || 0) + buckets[tbl].length;
        buckets[tbl] = [];
      }
    }

    if (total % 100000 === 0) {
      console.log(`[CsvSeed] ${total.toLocaleString()} rows processed...`);
    }
  }

  // Flush remaining
  for (const tbl of Object.keys(buckets)) {
    if (buckets[tbl].length > 0) {
      await transaction(async (client) => {
        await insertBatch(client, tbl, buckets[tbl]);
      });
      results[tbl] = (results[tbl] || 0) + buckets[tbl].length;
      buckets[tbl] = [];
    }
  }

  console.log(`[CsvSeed] Done — ${total.toLocaleString()} rows inserted, ${skipped} skipped`);
  return { total, skipped, tables: results };
}

// ─── Main: Seed from JSON file ─────────────────────────────
export async function seedFromJson(jsonPath) {
  console.log(`[JsonSeed] Reading ${jsonPath}...`);
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  console.log(`[JsonSeed] Parsed ${data.length} records`);

  const buckets = {};
  for (const r of data) {
    const mapped = mapJsonRow(r);
    const table = getTable(mapped.bill_type);
    if (!buckets[table]) buckets[table] = [];
    buckets[table].push(mapped);
  }

  const results = {};
  let total = 0;
  for (const [table, tableRows] of Object.entries(buckets)) {
    let inserted = 0;
    for (let i = 0; i < tableRows.length; i += BATCH_SIZE) {
      const batch = tableRows.slice(i, i + BATCH_SIZE);
      await transaction(async (client) => {
        await insertBatch(client, table, batch);
      });
      inserted += batch.length;
    }
    results[table] = inserted;
    total += inserted;
    console.log(`[JsonSeed] ${table}: ${inserted.toLocaleString()} rows inserted`);
  }

  console.log(`[JsonSeed] Done — ${total.toLocaleString()} total rows`);
  return { total, tables: results };
}

// ─── Main: Seed from JSON array (in-memory) ────────────────
export async function seedFromRecords(records) {
  console.log(`[Seed] Processing ${records.length} records...`);

  const buckets = {};
  for (const r of records) {
    const mapped = mapJsonRow(r);
    const table = getTable(mapped.bill_type);
    if (!buckets[table]) buckets[table] = [];
    buckets[table].push(mapped);
  }

  const results = {};
  let total = 0;
  for (const [table, tableRows] of Object.entries(buckets)) {
    let inserted = 0;
    for (let i = 0; i < tableRows.length; i += BATCH_SIZE) {
      const batch = tableRows.slice(i, i + BATCH_SIZE);
      await transaction(async (client) => {
        await insertBatch(client, table, batch);
      });
      inserted += batch.length;
    }
    results[table] = inserted;
    total += inserted;
    console.log(`[Seed] ${table}: ${inserted.toLocaleString()} rows`);
  }

  return { total, tables: results };
}

// ─── Get current table counts ──────────────────────────────
export async function getTableCounts() {
  const { rows } = await query(`
    SELECT 'rayna_tours' AS tbl, COUNT(*)::int AS count FROM rayna_tours
    UNION ALL SELECT 'rayna_packages', COUNT(*)::int FROM rayna_packages
    UNION ALL SELECT 'rayna_hotels', COUNT(*)::int FROM rayna_hotels
    UNION ALL SELECT 'rayna_visas', COUNT(*)::int FROM rayna_visas
    UNION ALL SELECT 'rayna_flights', COUNT(*)::int FROM rayna_flights
    UNION ALL SELECT 'rayna_others', COUNT(*)::int FROM rayna_others
    ORDER BY count DESC
  `);
  return rows;
}

export default { seedFromCsv, seedFromJson, seedFromRecords, getTableCounts };
