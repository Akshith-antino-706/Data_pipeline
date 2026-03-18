import { BigQuery } from '@google-cloud/bigquery';
import { query, transaction } from '../config/database.js';

/**
 * BigQuery → PostgreSQL Incremental Sync Service
 * Pulls data from BigQuery (read-only) and upserts into local PostgreSQL.
 */
class BigQuerySyncService {

  // ── Table Mappings ────────────────────────────────────────
  // Format: project_id.dataset.table_name
  // mode: 'primary' = always sync, 'fallback' = only backfill gaps
  static TABLE_MAPPINGS = {
    customers: {
      bqTable: `${process.env.BQ_PROJECT_ID}.${process.env.BQ_DATASET}.customers`,
      pgTable: 'customers',
      conflictKey: 'customer_id',
      timestampColumn: 'updated_at',
      columnMap: null,
      mode: 'primary',
    },
    bookings: {
      bqTable: `${process.env.BQ_PROJECT_ID}.${process.env.BQ_DATASET}.bookings`,
      pgTable: 'bookings',
      conflictKey: 'booking_id',
      timestampColumn: 'updated_at',
      columnMap: null,
      mode: 'primary',
    },
    gtm_events: {
      bqTable: `${process.env.BQ_PROJECT_ID}.${process.env.BQ_DATASET}.events_*`,
      pgTable: 'gtm_events',
      conflictKey: 'event_id',
      timestampColumn: 'created_at',
      columnMap: null,
      mode: 'fallback',  // GTM webhook is primary; BQ only fills gaps
    },
  };

  // ── BigQuery Client (lazy singleton) ──────────────────────
  static #bq = null;

  static getBQClient() {
    if (!this.#bq) {
      this.#bq = new BigQuery({ projectId: process.env.BQ_PROJECT_ID });
    }
    return this.#bq;
  }

  // ── Sync Metadata ─────────────────────────────────────────

  static async getLastSyncTime(tableName) {
    const { rows } = await query(
      'SELECT last_synced_at FROM sync_metadata WHERE table_name = $1',
      [tableName]
    );
    if (rows.length === 0) {
      await query(
        `INSERT INTO sync_metadata (table_name) VALUES ($1) ON CONFLICT DO NOTHING`,
        [tableName]
      );
      return new Date('1970-01-01T00:00:00Z');
    }
    return rows[0].last_synced_at;
  }

  static async updateSyncMetadata(tableName, { rowsSynced, status, error, durationMs }) {
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
      [tableName, rowsSynced ?? null, status ?? null, error ?? null, durationMs ?? null]
    );
  }

  // ── Core Sync Methods ─────────────────────────────────────

  /**
   * Pull a single table from BigQuery and upsert into PostgreSQL.
   * Read-only on BigQuery — no deletes or modifications.
   */
  static async pullTable(tableName) {
    const mapping = this.TABLE_MAPPINGS[tableName];
    if (!mapping) throw new Error(`No mapping configured for table: ${tableName}`);

    const startTime = Date.now();
    await this.updateSyncMetadata(tableName, { status: 'running' });

    try {
      const lastSync = await this.getLastSyncTime(tableName);
      const bq = this.getBQClient();
      const batchSize = parseInt(process.env.BQ_SYNC_BATCH_SIZE || '500');

      // Query BigQuery for rows updated since last sync (READ-ONLY)
      const bqQuery = `
        SELECT *
        FROM \`${mapping.bqTable}\`
        WHERE ${mapping.timestampColumn} > @lastSync
        ORDER BY ${mapping.timestampColumn} ASC
      `;

      const [rows] = await bq.query({
        query: bqQuery,
        params: { lastSync: lastSync.toISOString() },
      });

      console.log(`[BQ Sync] ${tableName}: fetched ${rows.length} rows from BigQuery`);

      if (rows.length === 0) {
        await this.updateSyncMetadata(tableName, {
          status: 'success',
          rowsSynced: 0,
          durationMs: Date.now() - startTime,
        });
        return { table: tableName, rowsSynced: 0 };
      }

      // Upsert into PostgreSQL in batches
      let totalSynced = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await transaction(async (client) => {
          await this.upsertBatch(client, mapping.pgTable, mapping.conflictKey, batch, mapping.columnMap);
        });
        totalSynced += batch.length;
        console.log(`[BQ Sync] ${tableName}: upserted ${totalSynced}/${rows.length} rows`);
      }

      await this.updateSyncMetadata(tableName, {
        status: 'success',
        rowsSynced: totalSynced,
        durationMs: Date.now() - startTime,
      });

      return { table: tableName, rowsSynced: totalSynced };
    } catch (err) {
      console.error(`[BQ Sync] ${tableName} failed:`, err.message);
      await this.updateSyncMetadata(tableName, {
        status: 'error',
        error: err.message,
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  /**
   * Dynamically build and execute INSERT ... ON CONFLICT DO UPDATE
   * Column names are derived from the BigQuery result (no hardcoding).
   */
  static async upsertBatch(client, pgTable, conflictKey, rows, columnMap) {
    if (rows.length === 0) return;

    const bqColumns = Object.keys(rows[0]);
    const pgColumns = columnMap
      ? bqColumns.map(c => columnMap[c] || c)
      : bqColumns;

    const conflictUpdate = pgColumns
      .filter(c => c !== conflictKey)
      .map(c => `${c} = EXCLUDED.${c}`)
      .join(', ');

    // Build multi-row parameterized VALUES
    const values = [];
    const valueClauses = rows.map((row, rowIdx) => {
      const placeholders = bqColumns.map((col, colIdx) => {
        const val = row[col];
        // Handle BigQuery objects/arrays → JSON string for JSONB columns
        values.push(val !== null && typeof val === 'object' && !(val instanceof Date) ? JSON.stringify(val) : val ?? null);
        return `$${rowIdx * bqColumns.length + colIdx + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `
      INSERT INTO ${pgTable} (${pgColumns.join(', ')})
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (${conflictKey}) DO UPDATE SET ${conflictUpdate}
    `;

    await client.query(sql, values);
  }

  /**
   * Sync all PRIMARY tables sequentially (skips fallback tables like gtm_events).
   * Order matters: customers before bookings (FK dependency).
   */
  static async syncAll() {
    console.log('[BQ Sync] Starting full sync (primary tables only)...');
    const results = [];

    for (const [tableName, mapping] of Object.entries(this.TABLE_MAPPINGS)) {
      if (mapping.mode === 'fallback') {
        console.log(`[BQ Sync] ${tableName}: skipped (fallback mode — use /sync/backfill-gtm)`);
        continue;
      }
      try {
        const result = await this.pullTable(tableName);
        results.push(result);
        console.log(`[BQ Sync] ${tableName}: ${result.rowsSynced} rows synced`);
      } catch (err) {
        console.error(`[BQ Sync] ${tableName} failed:`, err.message);
        results.push({ table: tableName, error: err.message });
      }
    }

    console.log('[BQ Sync] Full sync completed:', JSON.stringify(results));
    return results;
  }

  // ── GTM Fallback: Gap Detection & Backfill ─────────────────

  /**
   * Detect gaps in gtm_events where the GTM webhook may have missed events.
   * Compares hourly event counts between PG and BigQuery.
   */
  static async detectGTMGaps(hoursBack = 24) {
    const bq = this.getBQClient();
    const mapping = this.TABLE_MAPPINGS.gtm_events;

    // Count events per hour in PG
    const pgResult = await query(`
      SELECT date_trunc('hour', created_at) AS hour, COUNT(*) AS cnt
      FROM gtm_events
      WHERE created_at > NOW() - INTERVAL '${hoursBack} hours'
      GROUP BY 1 ORDER BY 1
    `);
    const pgCounts = new Map(pgResult.rows.map(r => [r.hour.toISOString(), parseInt(r.cnt)]));

    // Count events per hour in BigQuery
    const [bqRows] = await bq.query({
      query: `
        SELECT TIMESTAMP_TRUNC(${mapping.timestampColumn}, HOUR) AS hour, COUNT(*) AS cnt
        FROM \`${mapping.bqTable}\`
        WHERE ${mapping.timestampColumn} > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${hoursBack} HOUR)
        GROUP BY 1 ORDER BY 1
      `,
    });

    // Find hours where BQ has more events than PG (= missed by webhook)
    const gaps = [];
    for (const row of bqRows) {
      const hourKey = row.hour.value || row.hour.toISOString();
      const bqCount = parseInt(row.cnt);
      const pgCount = pgCounts.get(hourKey) || 0;
      if (bqCount > pgCount) {
        gaps.push({ hour: hourKey, bqCount, pgCount, missing: bqCount - pgCount });
      }
    }

    console.log(`[BQ Sync] GTM gap detection: ${gaps.length} hours with missing events`);
    return gaps;
  }

  /**
   * Backfill gtm_events from BigQuery for specific time gaps.
   * Only inserts events that don't already exist in PG (ON CONFLICT DO NOTHING).
   */
  static async backfillGTMEvents(hoursBack = 24) {
    const mapping = this.TABLE_MAPPINGS.gtm_events;
    const startTime = Date.now();
    await this.updateSyncMetadata('gtm_events', { status: 'running' });

    try {
      const gaps = await this.detectGTMGaps(hoursBack);
      if (gaps.length === 0) {
        await this.updateSyncMetadata('gtm_events', {
          status: 'success', rowsSynced: 0, durationMs: Date.now() - startTime,
        });
        return { table: 'gtm_events', rowsSynced: 0, gaps: 0 };
      }

      const bq = this.getBQClient();
      const batchSize = parseInt(process.env.BQ_SYNC_BATCH_SIZE || '500');

      // Pull events for gap hours only
      const gapHours = gaps.map(g => `"${g.hour}"`).join(', ');
      const [rows] = await bq.query({
        query: `
          SELECT *
          FROM \`${mapping.bqTable}\`
          WHERE TIMESTAMP_TRUNC(${mapping.timestampColumn}, HOUR) IN (${gapHours})
          ORDER BY ${mapping.timestampColumn} ASC
        `,
      });

      console.log(`[BQ Sync] gtm_events backfill: fetched ${rows.length} rows for ${gaps.length} gap hours`);

      let totalSynced = 0;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        await transaction(async (client) => {
          await this.upsertBatchNoOverwrite(client, mapping.pgTable, mapping.conflictKey, batch, mapping.columnMap);
        });
        totalSynced += batch.length;
      }

      await this.updateSyncMetadata('gtm_events', {
        status: 'success', rowsSynced: totalSynced, durationMs: Date.now() - startTime,
      });

      return { table: 'gtm_events', rowsSynced: totalSynced, gaps: gaps.length };
    } catch (err) {
      console.error('[BQ Sync] gtm_events backfill failed:', err.message);
      await this.updateSyncMetadata('gtm_events', {
        status: 'error', error: err.message, durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  /**
   * INSERT ... ON CONFLICT DO NOTHING — preserves existing GTM webhook data.
   */
  static async upsertBatchNoOverwrite(client, pgTable, conflictKey, rows, columnMap) {
    if (rows.length === 0) return;

    const bqColumns = Object.keys(rows[0]);
    const pgColumns = columnMap
      ? bqColumns.map(c => columnMap[c] || c)
      : bqColumns;

    const values = [];
    const valueClauses = rows.map((row, rowIdx) => {
      const placeholders = bqColumns.map((col, colIdx) => {
        const val = row[col];
        values.push(val !== null && typeof val === 'object' && !(val instanceof Date) ? JSON.stringify(val) : val ?? null);
        return `$${rowIdx * bqColumns.length + colIdx + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `
      INSERT INTO ${pgTable} (${pgColumns.join(', ')})
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (${conflictKey}) DO NOTHING
    `;

    await client.query(sql, values);
  }

  /**
   * Get sync status for all tables.
   */
  static async getSyncStatus() {
    const { rows } = await query(
      'SELECT * FROM sync_metadata ORDER BY table_name'
    );
    return rows;
  }
}

export default BigQuerySyncService;
