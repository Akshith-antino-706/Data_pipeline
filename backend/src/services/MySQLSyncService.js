import { mysqlQuery, getMySQLPool } from '../config/mysql.js';
import { query, transaction } from '../config/database.js';

/**
 * MySQL → PostgreSQL Incremental Sync Service
 * Pulls data from remote MySQL (read-only) and upserts into local PostgreSQL.
 * Runs every 30 minutes via cron.
 */
class MySQLSyncService {

  // ── Table Mappings ────────────────────────────────────────
  static TABLE_MAPPINGS = {
    tickets: {
      mysqlTable: 'tickets',
      pgTable: 'mysql_tickets',
      conflictKey: 'id',
      timestampColumn: 'updated_at',
      pool: 'primary',
    },
    travel_data: {
      mysqlTable: 'travel_data',
      pgTable: 'mysql_travel_data',
      conflictKey: 'id',
      timestampColumn: 'added_date',  // no updated_at in this table
      pool: 'primary',
    },
    contacts: {
      mysqlTable: 'contacts',
      pgTable: 'mysql_contacts',
      conflictKey: 'id',
      timestampColumn: 'updated_at',
      pool: 'primary',
    },
    chats: {
      mysqlTable: 'chats',
      pgTable: 'mysql_chats',
      conflictKey: 'id',
      timestampColumn: 'created_at',  // updated_at is NULL for most rows
      pool: 'chats',                  // second MySQL server (5.79.64.193)
    },
  };

  // ── Sync Metadata ─────────────────────────────────────────

  static async getLastSyncTime(tableName) {
    const metaKey = `mysql_${tableName}`;
    const { rows } = await query(
      'SELECT last_synced_at FROM sync_metadata WHERE table_name = $1',
      [metaKey]
    );
    if (rows.length === 0) {
      await query(
        `INSERT INTO sync_metadata (table_name) VALUES ($1) ON CONFLICT DO NOTHING`,
        [metaKey]
      );
      // First sync: only pull last 6 months of data
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return sixMonthsAgo;
    }
    // If last_synced_at is epoch (never synced successfully), use 6 months ago
    const lastSynced = rows[0].last_synced_at;
    if (lastSynced.getTime() === new Date('1970-01-01T00:00:00Z').getTime()) {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return sixMonthsAgo;
    }
    return lastSynced;
  }

  static async updateSyncMetadata(tableName, { rowsSynced, status, error, durationMs }) {
    const metaKey = `mysql_${tableName}`;
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
  }

  // ── Core Sync Methods ─────────────────────────────────────

  /**
   * Pull a single table from MySQL and upsert into PostgreSQL.
   * Read-only on MySQL — no writes or modifications.
   * Uses paginated reads (LIMIT/OFFSET) to handle large tables without OOM.
   */
  static async pullTable(tableName) {
    const mapping = this.TABLE_MAPPINGS[tableName];
    if (!mapping) throw new Error(`No MySQL mapping for table: ${tableName}`);

    const startTime = Date.now();
    await this.updateSyncMetadata(tableName, { status: 'running' });

    try {
      const lastSync = await this.getLastSyncTime(tableName);
      const batchSize = parseInt(process.env.MYSQL_SYNC_BATCH_SIZE || '500');
      const pageSize = 5000; // rows per MySQL read page

      let totalSynced = 0;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        // READ-ONLY paginated query against remote MySQL
        const rows = await mysqlQuery(
          `SELECT * FROM \`${mapping.mysqlTable}\` WHERE \`${mapping.timestampColumn}\` > ? ORDER BY \`${mapping.timestampColumn}\` ASC LIMIT ? OFFSET ?`,
          [lastSync, pageSize, offset],
          mapping.pool || 'primary'
        );

        console.log(`[MySQL Sync] ${tableName}: fetched page of ${rows.length} rows (offset ${offset})`);

        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        // Upsert this page into PostgreSQL in batches
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          await transaction(async (client) => {
            await this.upsertBatch(client, mapping.pgTable, mapping.conflictKey, batch);
          });
          totalSynced += batch.length;
          console.log(`[MySQL Sync] ${tableName}: upserted ${totalSynced} rows so far`);
        }

        offset += rows.length;
        hasMore = rows.length === pageSize;
      }

      await this.updateSyncMetadata(tableName, {
        status: 'success',
        rowsSynced: totalSynced,
        durationMs: Date.now() - startTime,
      });

      console.log(`[MySQL Sync] ${tableName}: completed — ${totalSynced} rows in ${Date.now() - startTime}ms`);
      return { table: tableName, rowsSynced: totalSynced };
    } catch (err) {
      console.error(`[MySQL Sync] ${tableName} failed:`, err.message);
      await this.updateSyncMetadata(tableName, {
        status: 'error',
        error: err.message,
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  /**
   * Dynamically build and execute INSERT ... ON CONFLICT DO UPDATE.
   * Column names are derived from the MySQL result (no hardcoding).
   */
  static async upsertBatch(client, pgTable, conflictKey, rows) {
    if (rows.length === 0) return;

    const columns = Object.keys(rows[0]);
    const updateColumns = columns.filter(c => c !== conflictKey);
    const conflictUpdate = updateColumns
      .map(c => `${c} = EXCLUDED.${c}`)
      .join(', ');

    // Build multi-row parameterized VALUES
    const values = [];
    const valueClauses = rows.map((row, rowIdx) => {
      const placeholders = columns.map((col, colIdx) => {
        let val = row[col];
        // Sanitize Invalid Date objects (from MySQL 0000-00-00 00:00:00)
        if (val instanceof Date && isNaN(val.getTime())) {
          val = null;
        }
        // Strip null bytes from strings (PostgreSQL rejects 0x00 in UTF8)
        if (typeof val === 'string') {
          val = val.replace(/\0/g, '');
        }
        // Handle objects/arrays → JSON string for any JSONB columns
        values.push(
          val !== null && typeof val === 'object' && !(val instanceof Date)
            ? JSON.stringify(val)
            : val ?? null
        );
        return `$${rowIdx * columns.length + colIdx + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const sql = `
      INSERT INTO ${pgTable} (${columns.join(', ')})
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (${conflictKey}) DO UPDATE SET ${conflictUpdate}
    `;

    await client.query(sql, values);
  }

  /**
   * Sync all configured tables sequentially.
   */
  static async syncAll() {
    console.log('[MySQL Sync] Starting full sync...');
    const results = [];

    for (const tableName of Object.keys(this.TABLE_MAPPINGS)) {
      try {
        const result = await this.pullTable(tableName);
        results.push(result);
        console.log(`[MySQL Sync] ${tableName}: ${result.rowsSynced} rows synced`);
      } catch (err) {
        console.error(`[MySQL Sync] ${tableName} failed:`, err.message);
        results.push({ table: tableName, error: err.message });
      }
    }

    console.log('[MySQL Sync] Full sync completed:', JSON.stringify(results));
    return results;
  }

  /**
   * Get sync status for MySQL tables only.
   */
  static async getSyncStatus() {
    const { rows } = await query(
      "SELECT * FROM sync_metadata WHERE table_name LIKE 'mysql_%' ORDER BY table_name"
    );
    return rows;
  }

  /**
   * Discover remote MySQL table schemas (for debugging/inspection).
   */
  static async discoverSchema() {
    const schemas = {};
    for (const [name, mapping] of Object.entries(this.TABLE_MAPPINGS)) {
      const poolName = mapping.pool || 'primary';
      const columns = await mysqlQuery(`DESCRIBE \`${mapping.mysqlTable}\``, [], poolName);
      const [countResult] = await mysqlQuery(`SELECT COUNT(*) as count FROM \`${mapping.mysqlTable}\``, [], poolName);
      schemas[name] = {
        mysqlTable: mapping.mysqlTable,
        pgTable: mapping.pgTable,
        server: poolName,
        rowCount: countResult.count,
        columns,
      };
    }
    return schemas;
  }
}

export default MySQLSyncService;
