import { query, transaction } from '../config/database.js';

/**
 * Rayna Billing Data → PostgreSQL Sync Service
 * Routes billing records by BillType into the correct table.
 *
 * Tables:
 *   rayna_tours    ← Tours, OnlineTour
 *   rayna_packages ← Package
 *   rayna_hotels   ← Hotel, HotelAmendment, HotelOTH
 *   rayna_visas    ← Visa, IntlVisa
 *   rayna_flights  ← (future use)
 *   rayna_others   ← Ticket, Insurance, OTB, NULL/empty
 */
class RaynaSyncService {

  static BATCH_SIZE = parseInt(process.env.RAYNA_SYNC_BATCH_SIZE || '500');

  // ── BillType → Table Mapping (case-insensitive) ──────────
  static TABLE_MAP = {
    tours:           'rayna_tours',
    onlinetour:      'rayna_tours',
    package:         'rayna_packages',
    hotel:           'rayna_hotels',
    hotelamendment:  'rayna_hotels',
    hoteloth:        'rayna_hotels',
    visa:            'rayna_visas',
    intlvisa:        'rayna_visas',
    ticket:          'rayna_others',
    insurance:       'rayna_others',
    otb:             'rayna_others',
  };

  static getTable(billType) {
    return this.TABLE_MAP[(billType || '').trim().toLowerCase()] || 'rayna_others';
  }

  // ── Map a JSON record to DB columns ──────────────────────
  static mapRow(r) {
    return {
      bill_serial:   String(r.BillSerial ?? ''),
      bill_no:       String(r.BillNo ?? ''),
      bill_type:     r.BillType ?? '',
      is_b2b:        String(r.IsB2B ?? ''),
      service_id:    String(r.ServiceId ?? ''),
      travel_date:   (r.TravelDate || '').slice(0, 10),   // strip time part
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

  // ── Insert a batch of records into a single table ────────
  static async insertBatch(client, tableName, rows) {
    if (rows.length === 0) return;

    const columns = [
      'bill_serial', 'bill_no', 'bill_type', 'is_b2b', 'service_id',
      'travel_date', 'service_name', 'selling_price', 'is_cancel', 'guest_name',
      'nationality', 'guest_contact', 'guest_email', 'guest_age', 'booking_date',
    ];

    const values = [];
    const valueClauses = rows.map((row, rowIdx) => {
      const placeholders = columns.map((col, colIdx) => {
        let val = row[col];
        if (typeof val === 'string') val = val.replace(/\0/g, '');
        values.push(val ?? null);
        return `$${rowIdx * columns.length + colIdx + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${valueClauses.join(', ')}`;
    await client.query(sql, values);
  }

  // ── Ingest an array of JSON records (the main entry point) ──
  static async ingestRecords(records) {
    const startTime = Date.now();
    console.log(`[Rayna Sync] Ingesting ${records.length} records...`);

    // Group by target table
    const buckets = {};
    for (const r of records) {
      const table = this.getTable(r.BillType);
      if (!buckets[table]) buckets[table] = [];
      buckets[table].push(this.mapRow(r));
    }

    const results = {};
    for (const [table, rows] of Object.entries(buckets)) {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
        const batch = rows.slice(i, i + this.BATCH_SIZE);
        await transaction(async (client) => {
          await this.insertBatch(client, table, batch);
        });
        inserted += batch.length;
      }
      results[table] = inserted;
      console.log(`[Rayna Sync] ${table}: inserted ${inserted} rows`);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[Rayna Sync] Ingest complete — ${records.length} records in ${durationMs}ms`);

    // Update sync metadata
    await this.updateSyncMetadata('billing_ingest', {
      status: 'success',
      rowsSynced: records.length,
      durationMs,
    });

    return { totalInserted: records.length, tables: results, durationMs };
  }

  // ── Deduplicated ingest (skip rows that already exist) ──
  static async ingestRecordsDedup(records) {
    const startTime = Date.now();
    console.log(`[Rayna Sync] Dedup ingesting ${records.length} records...`);

    // Group by target table
    const buckets = {};
    for (const r of records) {
      const table = this.getTable(r.BillType);
      if (!buckets[table]) buckets[table] = [];
      buckets[table].push(this.mapRow(r));
    }

    const columns = [
      'bill_serial', 'bill_no', 'bill_type', 'is_b2b', 'service_id',
      'travel_date', 'service_name', 'selling_price', 'is_cancel', 'guest_name',
      'nationality', 'guest_contact', 'guest_email', 'guest_age', 'booking_date',
    ];

    const results = {};
    let totalInserted = 0;

    for (const [table, rows] of Object.entries(buckets)) {
      let inserted = 0;
      for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
        const batch = rows.slice(i, i + this.BATCH_SIZE);
        await transaction(async (client) => {
          const values = [];
          const valueClauses = batch.map((row, rowIdx) => {
            const placeholders = columns.map((col, colIdx) => {
              let val = row[col];
              if (typeof val === 'string') val = val.replace(/\0/g, '');
              values.push(val ?? null);
              return `$${rowIdx * columns.length + colIdx + 1}`;
            });
            return `(${placeholders.join(', ')})`;
          });

          // Use a CTE to check for existing rows by all 15 columns
          const sql = `
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES ${valueClauses.join(', ')}
            ON CONFLICT DO NOTHING
          `;
          // Since there's no unique constraint on all 15 cols, we use NOT EXISTS instead
          // Insert row-by-row with existence check
          for (const row of batch) {
            const vals = columns.map(c => {
              let v = row[c];
              if (typeof v === 'string') v = v.replace(/\0/g, '');
              return v ?? null;
            });
            const whereClauses = columns.map((c, i) =>
              vals[i] === null ? `${c} IS NULL` : `${c} = $${i + 1}`
            ).join(' AND ');
            const filteredVals = vals.filter(v => v !== null);
            let paramIdx = 0;
            const whereClausesIndexed = columns.map((c, i) =>
              vals[i] === null ? `${c} IS NULL` : `${c} = $${++paramIdx}`
            ).join(' AND ');

            const existsResult = await client.query(
              `SELECT 1 FROM ${table} WHERE ${whereClausesIndexed} LIMIT 1`,
              filteredVals
            );
            if (existsResult.rows.length === 0) {
              await client.query(
                `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
                vals
              );
              inserted++;
            }
          }
        });
      }
      results[table] = inserted;
      totalInserted += inserted;
      console.log(`[Rayna Sync] ${table}: inserted ${inserted} new rows (${rows.length - inserted} duplicates skipped)`);
    }

    const durationMs = Date.now() - startTime;
    console.log(`[Rayna Sync] Dedup ingest complete — ${totalInserted}/${records.length} new records in ${durationMs}ms`);

    await this.updateSyncMetadata('billing_ingest', {
      status: 'success',
      rowsSynced: totalInserted,
      durationMs,
    });

    return { totalInserted, totalReceived: records.length, tables: results, durationMs };
  }

  // ── Get table counts ────────────────────────────────────
  static async getTableCounts() {
    const { rows } = await query(`
      SELECT 'rayna_tours' AS table_name, COUNT(*)::int AS count FROM rayna_tours
      UNION ALL SELECT 'rayna_packages', COUNT(*)::int FROM rayna_packages
      UNION ALL SELECT 'rayna_hotels', COUNT(*)::int FROM rayna_hotels
      UNION ALL SELECT 'rayna_visas', COUNT(*)::int FROM rayna_visas
      UNION ALL SELECT 'rayna_flights', COUNT(*)::int FROM rayna_flights
      UNION ALL SELECT 'rayna_others', COUNT(*)::int FROM rayna_others
      ORDER BY count DESC
    `);
    return rows;
  }

  // ── Sync status ─────────────────────────────────────────
  static async getSyncStatus() {
    try {
      const { rows } = await query(
        "SELECT * FROM sync_metadata WHERE table_name LIKE 'rayna_%' ORDER BY table_name"
      );
      return rows;
    } catch {
      return [];
    }
  }

  // ── Sync Metadata ─────────────────────────────────────────
  static async updateSyncMetadata(tableName, { rowsSynced, status, error, durationMs }) {
    const metaKey = `rayna_${tableName}`;
    try {
      await query(
        `INSERT INTO sync_metadata (table_name, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (table_name) DO UPDATE SET
           rows_synced = COALESCE($2, sync_metadata.rows_synced),
           sync_status = COALESCE($3, sync_metadata.sync_status),
           error_message = $4,
           sync_duration_ms = COALESCE($5, sync_metadata.sync_duration_ms),
           last_synced_at = CASE WHEN $3 = 'success' THEN NOW() ELSE sync_metadata.last_synced_at END,
           updated_at = NOW()`,
        [metaKey, rowsSynced ?? null, status ?? null, error ?? null, durationMs ?? null]
      );
    } catch (err) {
      console.error('[Rayna Sync] Failed to update sync metadata:', err.message);
    }
  }
}

export default RaynaSyncService;
