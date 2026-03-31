import { Op, literal } from 'sequelize';
import { getSequelizeInstance, getMySQLModels } from '../config/mysqlORM.js';
import { query, transaction } from '../config/database.js';

/**
 * MySQL → PostgreSQL Incremental Sync Service
 * Pulls specific columns from remote MySQL (read-only) and upserts into local PostgreSQL.
 * Runs every 10 minutes via cron.
 */
class MySQLSyncService {

  // ── Table Mappings ────────────────────────────────────────
  static TABLE_MAPPINGS = {
    contacts: {
      mysqlTable: 'contacts',
      pgTable: 'mysql_contacts',
      conflictKey: 'id',
      timestampColumn: 'updated_at',
      connection: 'primary',
      modelName: 'Contact',
      // Only pull these columns from MySQL
      columns: ['id', 'contact_type', 'department_name', 'name', 'company_name', 'email', 'dob', 'mobile', 'city', 'cstate', 'updated_at'],
    },
    tickets: {
      mysqlTable: 'tickets',
      pgTable: 'mysql_tickets',
      conflictKey: 'id',
      timestampColumn: 'updated_at',
      connection: 'primary',
      modelName: 'Ticket',
      columns: ['id', 'department_name', 't_from', 'from_name', 'subject', 'time', 'updated_at'],
    },
    chats: {
      mysqlTable: 'chats',
      pgTable: 'mysql_chats',
      conflictKey: 'id',
      timestampColumn: 'created_at',
      connection: 'chats',
      modelName: 'Chat',
      columns: ['id', 'customer_no', 'wa_name', 'email', 'country', 'department_number', 'tags', 'last_in', 'last_out', 'last_msg', 'created_at'],
      // first_message is derived from created_at (earliest message timestamp)
      columnAliases: { first_message: 'created_at' },
      // Pull department name from the departments table via receiver (department ID)
      derivedColumns: [
        { name: 'department_name', sql: '(SELECT `name` FROM `departments` WHERE `departments`.`id` = `Chat`.`receiver` LIMIT 1)' },
      ],
      // Sequelize model aliases → actual PG column names
      pgColumnMap: { customer_no: 'wa_id', department_number: 'receiver' },
    },
    departments: {
      mysqlTable: 'departments',
      pgTable: 'mysql_departments',
      conflictKey: 'id',
      timestampColumn: 'created_at',
      connection: 'chats',  // departments is on the chats server (5.79.64.193)
      modelName: 'Department',
      columns: ['id', 'connection', 'name', 'description', 'created_at'],
      // email_id doesn't exist in source — will be NULL
      extraPgColumns: { email_id: null },
      fullSync: true,  // small reference table — always pull all rows
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
    // Check for epoch (never synced) — compare year to avoid timezone issues
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

  /**
   * Build Sequelize attributes array — columns plus aliases.
   */
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

  /**
   * Get the list of PostgreSQL column names for upsert.
   */
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
    // Rename Sequelize aliases to actual PG column names
    if (mapping.pgColumnMap) {
      return cols.map(c => mapping.pgColumnMap[c] || c);
    }
    return cols;
  }

  /**
   * Rename row keys from Sequelize aliases to PG column names.
   */
  static remapRowKeys(row, pgColumnMap) {
    if (!pgColumnMap) return row;
    const mapped = {};
    for (const [key, val] of Object.entries(row)) {
      mapped[pgColumnMap[key] || key] = val;
    }
    return mapped;
  }

  /**
   * Pull a single table from MySQL and upsert into PostgreSQL.
   * Read-only on MySQL — no writes or modifications.
   */
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

        console.log(`[MySQL Sync] ${tableName}: fetched page of ${rows.length} rows (offset ${offset})`);

        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        // Remap Sequelize aliases to PG column names, then add extra PG columns
        const remappedRows = mapping.pgColumnMap
          ? rows.map(row => this.remapRowKeys(row, mapping.pgColumnMap))
          : rows;
        const enrichedRows = mapping.extraPgColumns
          ? remappedRows.map(row => ({ ...row, ...mapping.extraPgColumns }))
          : remappedRows;

        for (let i = 0; i < enrichedRows.length; i += batchSize) {
          const batch = enrichedRows.slice(i, i + batchSize);
          await transaction(async (client) => {
            await this.upsertBatch(client, mapping.pgTable, mapping.conflictKey, batch, pgColumns);
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
   * Build and execute INSERT ... ON CONFLICT DO UPDATE for specific columns.
   */
  static async upsertBatch(client, pgTable, conflictKey, rows, pgColumns) {
    if (rows.length === 0) return;

    const columns = pgColumns || Object.keys(rows[0]);
    const updateColumns = columns.filter(c => c !== conflictKey);
    const conflictUpdate = updateColumns
      .map(c => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const values = [];
    const valueClauses = rows.map((row, rowIdx) => {
      const placeholders = columns.map((col, colIdx) => {
        let val = row[col];
        if (val instanceof Date && isNaN(val.getTime())) {
          val = null;
        }
        if (typeof val === 'string') {
          val = val.replace(/\0/g, '');
        }
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

    // Map department emails from primary MySQL server
    try {
      await this.mapDepartmentEmails();
    } catch (err) {
      console.error('[MySQL Sync] Department email mapping failed:', err.message);
    }

    console.log('[MySQL Sync] Full sync completed:', JSON.stringify(results));
    return results;
  }

  /**
   * Sync department_emails from primary MySQL server and store locally.
   * The two servers use different department ID systems, so we store
   * the full mapping table (did → dept_name + email) from the primary server.
   */
  static async mapDepartmentEmails() {
    const sequelize = getSequelizeInstance('primary');

    const rows = await sequelize.query(
      `SELECT de.id, de.did, d.name as dept_name, de.email, de.status
       FROM department_emails de
       JOIN departments d ON d.id = de.did
       ORDER BY de.id`,
      { type: sequelize.constructor.QueryTypes.SELECT }
    );

    let synced = 0;
    for (const r of rows) {
      await query(
        `INSERT INTO mysql_department_emails (id, did, dept_name, email, status)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET did=$2, dept_name=$3, email=$4, status=$5`,
        [r.id, r.did, r.dept_name, r.email, r.status]
      );
      synced++;
    }
    console.log(`[MySQL Sync] Department emails synced: ${synced} records`);
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
      const connectionName = mapping.connection || 'primary';
      const models = getMySQLModels(connectionName);
      const Model = models[mapping.modelName];

      const columns = await Model.describe();
      const count = await Model.count();
      schemas[name] = {
        mysqlTable: mapping.mysqlTable,
        pgTable: mapping.pgTable,
        server: connectionName,
        rowCount: count,
        syncedColumns: mapping.columns,
        columns,
      };
    }
    return schemas;
  }
}

export default MySQLSyncService;
