import { query, transaction } from '../config/database.js';
import fs from 'fs';
import path from 'path';

/**
 * Rayna External API → PostgreSQL Sync Service
 * Pulls tours, hotels, visas, and flights from the Rayna ACICO API
 * and upserts into local PostgreSQL tables.
 */
class RaynaSyncService {

  static BASE_URL = process.env.RAYNA_API_URL;
  static ACCESS_TOKEN = process.env.RAYNA_API_TOKEN;
  static BATCH_SIZE = parseInt(process.env.RAYNA_SYNC_BATCH_SIZE || '500');

  // ── API → Table Mappings ───────────────────────────────────
  static ENDPOINTS = {
    tours: {
      path: '/tours-sync',
      responseKey: 'BillToursList',
      pgTable: 'rayna_tours',
      conflictKeys: ['billno', 'tours_name', 'tour_date'],
      mapRow: (r) => ({
        billno:        r.billno,
        bill_date:     RaynaSyncService.parseDate(r.billDate),
        tour_date:     RaynaSyncService.parseDate(r.tour_date),
        modified_date: RaynaSyncService.parseDate(r.modified_date),
        guest_name:    r.guestName || null,
        guest_contact: r.guestContact || null,
        nationality:   r.nationality || null,
        country_name:  r.country_name || null,
        agent_name:    r.agentName || null,
        group_name:    r.group_name || null,
        tours_name:    r.toursName || null,
        profit_center: r.profitShareCenterName || null,
        grnty_email:   r.grnty_email || null,
        status:        r.status || null,
        adult:         r.adult ?? 0,
        child:         r.child ?? 0,
        infant:        r.infant ?? 0,
        total_sell:    parseFloat(r.total_sell) || 0,
      }),
    },
    hotels: {
      path: '/hotel-sync',
      responseKey: 'Hotel_booking',
      pgTable: 'rayna_hotels',
      conflictKeys: ['billno', 'hotel_name', 'check_in_date'],
      mapRow: (r) => ({
        billno:        r.billNo,
        bill_date:     RaynaSyncService.parseDate(r.billdate),
        check_in_date: RaynaSyncService.parseDate(r.checkInDate),
        modified_date: RaynaSyncService.parseDate(r.modified_date),
        guest_name:    r.guestName || null,
        guest_contact: r.guestContact || null,
        country_name:  r.country_name || null,
        agent_name:    r.agentName || null,
        hotel_name:    r.hotelName || '',
        profit_center: r.profitShareCenterName || null,
        grnty_email:   r.grnty_email || null,
        no_of_rooms:   r.noOfRoom ?? 1,
        total_sell:    parseFloat(r.total_sell) || 0,
      }),
    },
    visas: {
      path: '/visa-sync',
      responseKey: 'VisaInformation',
      pgTable: 'rayna_visas',
      conflictKeys: ['billno', 'guest_name', 'visa_type'],
      mapRow: (r) => ({
        billno:        r.billNo || r.billno,
        bill_date:     RaynaSyncService.parseDate(r.billDate || r.billdate),
        modified_date: RaynaSyncService.parseDate(r.modified_date),
        guest_name:    r.guestName || null,
        guest_contact: r.guestContact || null,
        nationality:   r.nationality || null,
        country_name:  r.country_name || null,
        agent_name:    r.agentName || null,
        visa_type:     r.visaType || r.visa_type || 'UNKNOWN',
        profit_center: r.profitShareCenterName || null,
        grnty_email:   r.grnty_email || null,
        status:        r.status || null,
        total_sell:    parseFloat(r.total_sell || r.sellingPrice) || 0,
      }),
    },
    flights: {
      path: '/flight-sync',
      responseKey: 'Tkt_Information',
      pgTable: 'rayna_flights',
      conflictKeys: ['billno', 'passenger_name', 'flight_no'],
      mapRow: (r) => ({
        billno:         r.billNo,
        bill_date:      RaynaSyncService.parseDate(r.billDate),
        modified_date:  RaynaSyncService.parseDate(r.modified_date),
        guest_name:     r.guestName || null,
        guest_contact:  r.guestContact || null,
        passenger_name: r.name || 'UNKNOWN',
        nationality:    r.nationality || null,
        agent_name:     r.agentName || null,
        airport_name:   r.airport_name || null,
        flight_no:      r.flightNo || 'UNKNOWN',
        from_datetime:  RaynaSyncService.parseDate(r.from_dateTime),
        profit_center:  r.profitShareCenterName || null,
        grnty_email:    r.grnty_email || null,
        status:         r.status || null,
        selling_price:  parseFloat(r.sellingPrice) || 0,
      }),
    },
  };

  // ── Date Parser ────────────────────────────────────────────
  static parseDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  // ── Sync Metadata ─────────────────────────────────────────
  static async updateSyncMetadata(tableName, { rowsSynced, status, error, durationMs }) {
    const metaKey = `rayna_${tableName}`;
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

  // ── Date Helpers ──────────────────────────────────────────
  static formatDateParam(date) {
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  // ── Save Raw API Response to Backup File ──────────────────
  static saveRawBackup(endpointPath, data, rowCount) {
    try {
      const backupDir = path.resolve(process.cwd(), 'data_backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = endpointPath.replace('/', '');
      const filePath = path.join(backupDir, `${name}_${timestamp}_${rowCount}rows.json`);

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`[Rayna Sync] Raw backup saved: ${filePath} (${rowCount} rows)`);
      return filePath;
    } catch (err) {
      console.error(`[Rayna Sync] Failed to save backup:`, err.message);
      return null;
    }
  }

  // ── API Fetch ──────────────────────────────────────────────
  static async fetchFromAPI(endpoint, { dateFrom, dateTo } = {}) {
    const url = `${this.BASE_URL}${endpoint.path}`;
    const body = {};
    if (dateFrom) body.DateFrom = dateFrom;
    if (dateTo) body.DateTo = dateTo;

    console.log(`[Rayna Sync] Fetching ${url} with body:`, JSON.stringify(body));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10 min timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rows = data[endpoint.responseKey] || [];
      console.log(`[Rayna Sync] ${endpoint.path}: received ${rows.length} rows`);

      // Always save raw response to backup file
      if (rows.length > 0) {
        this.saveRawBackup(endpoint.path, data, rows.length);
      }

      return { rows, meta: { from_billdate: data.from_billdate, to_billdate: data.to_billdate } };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Batch Upsert ───────────────────────────────────────────
  static async upsertBatch(client, pgTable, conflictKeys, rows) {
    if (rows.length === 0) return;

    const columns = Object.keys(rows[0]);
    const updateColumns = columns.filter(c => !conflictKeys.includes(c));
    const conflictUpdate = updateColumns
      .map(c => `${c} = EXCLUDED.${c}`)
      .join(', ');

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

    const sql = `
      INSERT INTO ${pgTable} (${columns.join(', ')})
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (${conflictKeys.join(', ')}) DO UPDATE SET ${conflictUpdate}, synced_at = NOW()
    `;

    await client.query(sql, values);
  }

  // ── Sync Single Endpoint ───────────────────────────────────
  static async syncEndpoint(name, { dateFrom, dateTo } = {}) {
    const endpoint = this.ENDPOINTS[name];
    if (!endpoint) throw new Error(`Unknown Rayna endpoint: ${name}`);

    const startTime = Date.now();
    await this.updateSyncMetadata(name, { status: 'running' });

    try {
      const { rows: rawRows, meta } = await this.fetchFromAPI(endpoint, { dateFrom, dateTo });

      if (rawRows.length === 0) {
        await this.updateSyncMetadata(name, {
          status: 'success',
          rowsSynced: 0,
          durationMs: Date.now() - startTime,
        });
        console.log(`[Rayna Sync] ${name}: no rows to sync (range: ${meta.from_billdate} → ${meta.to_billdate})`);
        return { endpoint: name, rowsSynced: 0, meta };
      }

      // Map API rows to PG columns, filter nulls in conflict keys, and deduplicate
      const allMapped = rawRows.map(endpoint.mapRow);

      // Drop rows where any conflict key is null (can't upsert on nulls)
      const validRows = allMapped.filter(row =>
        endpoint.conflictKeys.every(k => row[k] != null)
      );
      if (validRows.length < allMapped.length) {
        console.log(`[Rayna Sync] ${name}: dropped ${allMapped.length - validRows.length} rows with null conflict keys`);
      }

      // Deduplicate by conflict keys using JSON for collision-safe keys
      const seen = new Set();
      const mappedRows = validRows.filter(row => {
        const key = JSON.stringify(endpoint.conflictKeys.map(k => row[k]));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      console.log(`[Rayna Sync] ${name}: ${allMapped.length} rows → ${mappedRows.length} after dedup`);

      // Batch upsert
      let totalSynced = 0;
      for (let i = 0; i < mappedRows.length; i += this.BATCH_SIZE) {
        const batch = mappedRows.slice(i, i + this.BATCH_SIZE);
        await transaction(async (client) => {
          await this.upsertBatch(client, endpoint.pgTable, endpoint.conflictKeys, batch);
        });
        totalSynced += batch.length;
        console.log(`[Rayna Sync] ${name}: upserted ${totalSynced}/${mappedRows.length} rows`);
      }

      await this.updateSyncMetadata(name, {
        status: 'success',
        rowsSynced: totalSynced,
        durationMs: Date.now() - startTime,
      });

      console.log(`[Rayna Sync] ${name}: completed — ${totalSynced} rows in ${Date.now() - startTime}ms`);
      return { endpoint: name, rowsSynced: totalSynced, meta };
    } catch (err) {
      console.error(`[Rayna Sync] ${name} failed:`, err.message);
      await this.updateSyncMetadata(name, {
        status: 'error',
        error: err.message,
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  // ── Sync All (incremental: 1 day at a time) ────────────────
  static async syncAll() {
    console.log('[Rayna Sync] Starting incremental sync (day-by-day)...');
    const results = [];

    for (const name of Object.keys(this.ENDPOINTS)) {
      try {
        const result = await this.syncEndpointIncremental(name);
        results.push(result);
      } catch (err) {
        results.push({ endpoint: name, error: err.message });
      }
    }

    console.log('[Rayna Sync] Incremental sync completed:', JSON.stringify(results));
    return results;
  }

  // ── Incremental Sync (1-day chunks from last sync date) ────
  static async syncEndpointIncremental(name, { days } = {}) {
    const endpoint = this.ENDPOINTS[name];
    if (!endpoint) throw new Error(`Unknown Rayna endpoint: ${name}`);

    // Determine start date: last synced bill_date or fallback to yesterday
    const { rows: metaRows } = await query(
      "SELECT last_synced_at FROM sync_metadata WHERE table_name = $1",
      [`rayna_${name}`]
    );

    let startDate;
    if (metaRows.length > 0 && metaRows[0].last_synced_at) {
      const lastSync = new Date(metaRows[0].last_synced_at);
      // If last sync was epoch (never synced), start from 7 days ago
      if (lastSync.getFullYear() <= 1970) {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - (days || 7));
      } else {
        // Start from the day of last sync (re-sync that day to catch late entries)
        startDate = lastSync;
      }
    } else {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - (days || 7));
    }

    // End date is today
    const endDate = new Date();
    const results = [];
    let totalRows = 0;

    // Sync one day at a time from startDate → today
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    while (current <= endDate) {
      const dayFrom = this.formatDateParam(current);
      const dayTo = dayFrom; // same day

      console.log(`[Rayna Sync] ${name} day chunk: ${dayFrom}`);
      try {
        const result = await this.syncEndpoint(name, { dateFrom: dayFrom, dateTo: dayTo });
        results.push({ date: dayFrom, ...result });
        totalRows += result.rowsSynced || 0;
      } catch (err) {
        console.error(`[Rayna Sync] ${name} day ${dayFrom} failed:`, err.message);
        results.push({ date: dayFrom, endpoint: name, error: err.message });
      }

      // Next day
      current.setDate(current.getDate() + 1);
    }

    console.log(`[Rayna Sync] ${name} incremental done — ${totalRows} total rows across ${results.length} days`);
    return { endpoint: name, totalRows, days: results.length, chunks: results };
  }

  // ── Historical Sync (chunked by month) ──────────────────────
  static async syncHistorical(name, months = 6) {
    const endpoint = this.ENDPOINTS[name];
    if (!endpoint) throw new Error(`Unknown Rayna endpoint: ${name}`);

    console.log(`[Rayna Sync] Starting ${months}-month historical sync for ${name}...`);
    const results = [];

    for (let i = months; i > 0; i--) {
      const from = new Date();
      from.setMonth(from.getMonth() - i);
      from.setDate(1); // start of month

      const to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      to.setDate(0); // end of month (last day)

      const dateFrom = this.formatDateParam(from);
      const dateTo = this.formatDateParam(to);

      console.log(`[Rayna Sync] ${name} historical chunk: ${dateFrom} → ${dateTo}`);
      try {
        const result = await this.syncEndpoint(name, { dateFrom, dateTo });
        results.push({ dateFrom, dateTo, ...result });
      } catch (err) {
        console.error(`[Rayna Sync] ${name} chunk ${dateFrom}→${dateTo} failed:`, err.message);
        results.push({ dateFrom, dateTo, endpoint: name, error: err.message });
      }
    }

    const totalRows = results.reduce((sum, r) => sum + (r.rowsSynced || 0), 0);
    console.log(`[Rayna Sync] ${name} historical sync done — ${totalRows} total rows across ${months} months`);
    return { endpoint: name, months, totalRows, chunks: results };
  }

  // ── Status ─────────────────────────────────────────────────
  static async getSyncStatus() {
    const { rows } = await query(
      "SELECT * FROM sync_metadata WHERE table_name LIKE 'rayna_%' ORDER BY table_name"
    );
    return rows;
  }

  // ── Table Counts ───────────────────────────────────────────
  static async getTableCounts() {
    const counts = {};
    for (const [name, ep] of Object.entries(this.ENDPOINTS)) {
      const { rows } = await query(`SELECT COUNT(*) as count FROM ${ep.pgTable}`);
      counts[name] = parseInt(rows[0].count);
    }
    return counts;
  }
}

export default RaynaSyncService;
