import { query } from '../config/database.js';

/**
 * Daily Data Report Service
 * Provides record counts, bill-level summaries, revenue, half-data preview,
 * and CSV generation for all synced data tables.
 */
class DailyReportService {

  // ── Table Configuration (exact columns from migrations 021-027) ──
  static TABLES = {
    rayna_tours: {
      label: 'Rayna Tours',
      group: 'rayna',
      dateColumn: 'bill_date',
      revenueColumn: 'total_sell',
      billColumn: 'billno',
      columns: ['billno', 'bill_date', 'tour_date', 'modified_date', 'guest_name', 'guest_contact', 'nationality', 'country_name', 'agent_name', 'group_name', 'tours_name', 'profit_center', 'grnty_email', 'status', 'adult', 'child', 'infant', 'total_sell', 'synced_at'],
    },
    rayna_hotels: {
      label: 'Rayna Hotels',
      group: 'rayna',
      dateColumn: 'bill_date',
      revenueColumn: 'total_sell',
      billColumn: 'billno',
      columns: ['billno', 'bill_date', 'check_in_date', 'modified_date', 'guest_name', 'guest_contact', 'country_name', 'agent_name', 'hotel_name', 'profit_center', 'grnty_email', 'no_of_rooms', 'total_sell', 'synced_at'],
    },
    rayna_visas: {
      label: 'Rayna Visas',
      group: 'rayna',
      dateColumn: 'bill_date',
      revenueColumn: 'total_sell',
      billColumn: 'billno',
      columns: ['billno', 'bill_date', 'modified_date', 'guest_name', 'guest_contact', 'nationality', 'country_name', 'agent_name', 'visa_type', 'profit_center', 'grnty_email', 'status', 'total_sell', 'synced_at'],
    },
    rayna_flights: {
      label: 'Rayna Flights',
      group: 'rayna',
      dateColumn: 'bill_date',
      revenueColumn: 'selling_price',
      billColumn: 'billno',
      columns: ['billno', 'bill_date', 'modified_date', 'guest_name', 'guest_contact', 'passenger_name', 'nationality', 'agent_name', 'airport_name', 'flight_no', 'from_datetime', 'profit_center', 'grnty_email', 'status', 'selling_price', 'synced_at'],
    },
    mysql_contacts: {
      label: 'CRM Contacts',
      group: 'mysql',
      dateColumn: 'updated_at',
      columns: ['id', 'contact_type', 'department_name', 'name', 'company_name', 'email', 'dob', 'mobile', 'city', 'cstate', 'updated_at'],
    },
    mysql_chats: {
      label: 'WhatsApp Chats',
      group: 'mysql',
      dateColumn: 'created_at',
      columns: ['id', 'customer_no', 'wa_name', 'email', 'country', 'department_number', 'department_name', 'tags', 'first_message', 'created_at', 'last_in', 'last_out', 'last_msg'],
    },
    mysql_tickets: {
      label: 'Email Tickets',
      group: 'mysql',
      dateColumn: 'updated_at',
      columns: ['id', 'department_name', 't_from', 'from_name', 'subject', 'time', 'updated_at'],
    },
    ga4_events: {
      label: 'GA4 Events',
      group: 'ga4',
      dateColumn: 'event_date',
      dateType: 'date',
      columns: [
        'event_date', 'event_ts', 'event_name', 'user_pseudo_id', 'user_id',
        'hostname', 'device_category', 'geo_country', 'geo_city',
        'ga_session_id', 'ep_source', 'ep_medium', 'ep_campaign',
        'page_location', 'page_path_clean', 'landing_page_path_clean',
        'email_any', 'name_any', 'contact_number_any', 'logged_in_status',
        'transaction_id', 'final_order_id', 'currency',
        'item_name', 'item_category', 'item_price', 'item_quantity', 'item_revenue',
        'coupon', 'search_term', 'synced_at',
      ],
    },
  };

  // ── Date filter builder ──────────────────────────────────────
  static _dateFilter(table) {
    const { dateColumn, dateType } = this.TABLES[table];
    if (dateType === 'date') {
      return `WHERE ${dateColumn} >= $1::date AND ${dateColumn} <= $2::date`;
    }
    return `WHERE ${dateColumn} >= $1::date AND ${dateColumn} < ($2::date + interval '1 day')`;
  }

  // ── Get Record Counts + Revenue + Bill Stats ─────────────────
  static async getRecordCounts(from, to) {
    const tables = Object.keys(this.TABLES);

    const promises = tables.map(table => {
      const config = this.TABLES[table];
      const dateFilter = this._dateFilter(table);

      if (config.billColumn && config.revenueColumn) {
        // Rayna tables: count rows, unique bills, revenue, min/max bill numbers
        return query(
          `SELECT
             COUNT(*)                                  AS total_rows,
             COUNT(DISTINCT ${config.billColumn})      AS total_bills,
             COALESCE(SUM(${config.revenueColumn}), 0) AS total_sales,
             MIN(${config.billColumn})                 AS first_bill,
             MAX(${config.billColumn})                 AS last_bill
           FROM ${table} ${dateFilter}`,
          [from, to]
        );
      }
      // Non-rayna tables: just count
      return query(`SELECT COUNT(*) AS total_rows FROM ${table} ${dateFilter}`, [from, to]);
    });

    const results = await Promise.all(promises);
    const tableStats = {};

    tables.forEach((table, i) => {
      const row = results[i].rows[0];
      tableStats[table] = {
        totalRows: parseInt(row.total_rows),
        totalBills: row.total_bills ? parseInt(row.total_bills) : null,
        totalSales: row.total_sales ? parseFloat(row.total_sales) : null,
        firstBill: row.first_bill || null,
        lastBill: row.last_bill || null,
      };
    });

    return tableStats;
  }

  // ── Get Preview (50% of data, capped at 500 for performance) ─
  static async getPreview(tableName, from, to) {
    const config = this.TABLES[tableName];
    if (!config) throw new Error(`Unknown table: ${tableName}`);

    const { columns, dateColumn } = config;
    const dateFilter = this._dateFilter(tableName);

    // First get total count
    const countResult = await query(
      `SELECT COUNT(*) AS cnt FROM ${tableName} ${dateFilter}`, [from, to]
    );
    const totalRows = parseInt(countResult.rows[0].cnt);
    const halfRows = Math.min(Math.ceil(totalRows / 2), 500);

    const sql = `SELECT ${columns.join(', ')} FROM ${tableName} ${dateFilter} ORDER BY ${dateColumn} DESC LIMIT ${halfRows}`;
    const result = await query(sql, [from, to]);

    return {
      columns,
      rows: result.rows,
      totalRows,
      previewRows: result.rows.length,
    };
  }

  // ── Get Last Sync Times ──────────────────────────────────────
  static async getSyncStatus() {
    try {
      const result = await query(
        `SELECT table_name, sync_status, last_synced_at, rows_synced, sync_duration_ms, error_message
         FROM sync_metadata ORDER BY table_name`
      );
      const status = {};
      for (const row of result.rows) {
        status[row.table_name] = {
          syncStatus: row.sync_status,
          lastSyncedAt: row.last_synced_at,
          rowsSynced: parseInt(row.rows_synced) || 0,
          durationMs: parseInt(row.sync_duration_ms) || 0,
          error: row.error_message,
        };
      }
      return status;
    } catch {
      return {};
    }
  }

  // ── Generate CSV String ──────────────────────────────────────
  static async generateCSV(tableName, from, to) {
    const config = this.TABLES[tableName];
    if (!config) throw new Error(`Unknown table: ${tableName}`);

    const { columns } = config;
    const dateFilter = this._dateFilter(tableName);
    const sql = `SELECT ${columns.join(', ')} FROM ${tableName} ${dateFilter} ORDER BY ${config.dateColumn} DESC`;
    const result = await query(sql, [from, to]);

    const BOM = '\uFEFF';
    const header = columns.join(',');
    const rows = result.rows.map(row =>
      columns.map(col => this.escapeCSV(row[col])).join(',')
    );

    return BOM + header + '\n' + rows.join('\n');
  }

  // ── CSV Escape Helper ────────────────────────────────────────
  static escapeCSV(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
      return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
}

export default DailyReportService;
