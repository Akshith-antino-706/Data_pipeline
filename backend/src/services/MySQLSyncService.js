import { Op, literal } from 'sequelize';
import { getMySQLModels } from '../config/mysqlORM.js';
import { query } from '../config/database.js';

/**
 * MySQL → PostgreSQL Incremental Sync Service
 * Pulls from remote MySQL (read-only) and upserts into local PostgreSQL.
 * Tables: users, tickets, chats, departments
 */
class MySQLSyncService {

  // ── Table Mappings ────────────────────────────────────────
  static TABLE_MAPPINGS = {
    users: {
      mysqlTable: 'contacts',
      pgTable: 'users',
      conflictKey: 'id',
      timestampColumn: 'updated_at',
      connection: 'primary',
      modelName: 'Contact',
      columns: ['id', 'contact_type', 'department_name', 'name', 'company_name', 'email', 'dob', 'mobile', 'city', 'cstate', 'updated_at'],
      pgColumnMap: { department_name: 'source', email: 'primary_email' },
    },
    tickets: {
      mysqlTable: 'tickets',
      pgTable: 'tickets',
      conflictKey: 'id',
      timestampColumn: 'updated_at',
      connection: 'primary',
      modelName: 'Ticket',
      columns: ['id', 'department_name', 't_from', 'from_name', 'subject', 'time', 'contact_status', 'updated_at'],
      pgColumnMap: { department_name: 'dept_id', time: 'created_at' },
      // dept_id will be text for now — we store the department name/email as-is
    },
    chats: {
      mysqlTable: 'chats',
      pgTable: 'chats',
      conflictKey: 'id',
      timestampColumn: 'created_at',
      connection: 'chats',
      modelName: 'Chat',
      columns: ['id', 'customer_no', 'wa_name', 'country', 'department_number', 'tags', 'last_msg', 'created_at'],
      pgColumnMap: { customer_no: 'wa_id', department_number: 'receiver', last_msg: 'last_msg_at' },
    },
    departments: {
      mysqlTable: 'departments',
      pgTable: 'departments',
      conflictKey: 'id',
      timestampColumn: 'created_at',
      connection: 'chats',
      modelName: 'Department',
      columns: ['id', 'connection', 'name', 'description', 'created_at'],
      extraPgColumns: { source: 'chats' },
      fullSync: true,
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
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      return sixMonthsAgo;
    }
    const lastSynced = rows[0].last_synced_at;
    if (!lastSynced || lastSynced.getFullYear() <= 1970) {
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

  static buildAttributes(mapping) {
    const attrs = [...mapping.columns];
    if (mapping.columnAliases) {
      for (const [alias, sourceCol] of Object.entries(mapping.columnAliases)) {
        attrs.push([sourceCol, alias]);
      }
    }
    if (mapping.derivedColumns) {
      for (const dc of mapping.derivedColumns) {
        attrs.push([literal(dc.sql), dc.name]);
      }
    }
    return attrs;
  }

  static getPgColumns(mapping) {
    const cols = [...mapping.columns];
    if (mapping.columnAliases) {
      cols.push(...Object.keys(mapping.columnAliases));
    }
    if (mapping.derivedColumns) {
      cols.push(...mapping.derivedColumns.map(dc => dc.name));
    }
    if (mapping.extraPgColumns) {
      cols.push(...Object.keys(mapping.extraPgColumns));
    }
    if (mapping.pgColumnMap) {
      return cols.map(c => mapping.pgColumnMap[c] || c);
    }
    return cols;
  }

  static remapRowKeys(row, pgColumnMap) {
    if (!pgColumnMap) return row;
    const mapped = {};
    for (const [key, val] of Object.entries(row)) {
      mapped[pgColumnMap[key] || key] = val;
    }
    return mapped;
  }

  static async pullTable(tableName, { forceFullSync = false } = {}) {
    const mapping = this.TABLE_MAPPINGS[tableName];
    if (!mapping) throw new Error(`No MySQL mapping for table: ${tableName}`);

    const startTime = Date.now();
    await this.updateSyncMetadata(tableName, { status: 'running' });

    try {
      const lastSync = forceFullSync
        ? new Date('2000-01-01T00:00:00Z')
        : await this.getLastSyncTime(tableName);
      const batchSize = parseInt(process.env.MYSQL_SYNC_BATCH_SIZE || '500');
      const pageSize = 5000;

      let totalSynced = 0;
      let offset = 0;
      let hasMore = true;

      const connectionName = mapping.connection || 'primary';
      const models = getMySQLModels(connectionName);
      const Model = models[mapping.modelName];
      const attributes = this.buildAttributes(mapping);
      const pgColumns = this.getPgColumns(mapping);

      while (hasMore) {
        const findOptions = {
          attributes,
          limit: pageSize,
          offset,
          raw: true,
        };

        if (mapping.fullSync) {
          findOptions.order = [['id', 'ASC']];
        } else {
          findOptions.where = { [mapping.timestampColumn]: { [Op.gt]: lastSync } };
          findOptions.order = [[mapping.timestampColumn, 'ASC']];
        }

        const rows = await Model.findAll(findOptions);
        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`[MySQL Sync] ${tableName}: fetched page of ${rows.length} rows (offset ${offset})`);

        // Upsert in batches
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const values = [];
          const valueClauses = batch.map((row, rowIdx) => {
            let mapped = mapping.pgColumnMap ? this.remapRowKeys(row, mapping.pgColumnMap) : row;
            if (mapping.extraPgColumns) {
              mapped = { ...mapped, ...mapping.extraPgColumns };
            }

            const placeholders = pgColumns.map((col, colIdx) => {
              let val = mapped[col] ?? null;
              if (typeof val === 'string') val = val.replace(/\0/g, '');
              values.push(val);
              return `$${rowIdx * pgColumns.length + colIdx + 1}`;
            });
            return `(${placeholders.join(', ')})`;
          });

          const conflictKey = mapping.conflictKey;
          const updateCols = pgColumns.filter(c => c !== conflictKey);
          const updateSet = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');

          const sql = `
            INSERT INTO ${mapping.pgTable} (${pgColumns.join(', ')})
            VALUES ${valueClauses.join(', ')}
            ON CONFLICT (${conflictKey}) DO UPDATE SET ${updateSet}
          `;

          await query(sql, values);
          totalSynced += batch.length;
          console.log(`[MySQL Sync] ${tableName}: upserted ${totalSynced} rows so far`);
        }

        if (rows.length < pageSize) {
          hasMore = false;
        }
        offset += rows.length;
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

  static async syncAll() {
    // MySQL sync is handled by format_etc.py (full) and incremental_sync.py (incremental)
    // This service is disabled to avoid conflicts with the normalized schema
    console.log('[MySQL Sync] Skipped — use incremental_sync.py instead');
    return { skipped: true, message: 'Use incremental_sync.py for MySQL sync' };
  }
}

export default MySQLSyncService;
