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
      insertOnly: true, // no unique constraint on tours, duplicates OK
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
      conflictKeys: ['billno', 'applicant_name', 'passport_number', 'visa_type'],
      mapRow: (r) => ({
        billno:          r.billNo || r.billno,
        bill_date:       RaynaSyncService.parseDate(r.billDate || r.billdate),
        modified_date:   RaynaSyncService.parseDate(r.modified_date),
        guest_name:      r.guestName || null,
        guest_contact:   r.guestContact || null,
        nationality:     r.nationality || null,
        country_name:    r.country_name || null,
        agent_name:      r.agentName || null,
        visa_type:       r.typeName || r.visaType || r.visa_type || 'UNKNOWN',
        profit_center:   r.profitShareCenterName || null,
        grnty_email:     r.grnty_email || null,
        status:          r.current_status || r.status || null,
        total_sell:      parseFloat(r.total_sell || r.sellingPrice) || 0,
        apply_date:      RaynaSyncService.parseDate(r.applydate),
        applicant_name:  r.name || null,
        passport_number: r.passportnumber || null,
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

  // ── API Fetch (with retry) ─────────────────────────────────
  static async fetchFromAPI(endpoint, { dateFrom, dateTo, maxRetries = 3 } = {}) {
    const url = `${this.BASE_URL}${endpoint.path}`;
    const body = {};
    if (dateFrom) body.DateFrom = dateFrom;
    if (dateTo) body.DateTo = dateTo;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[Rayna Sync] Fetching ${url} (attempt ${attempt}/${maxRetries}) with body:`, JSON.stringify(body));

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
      } catch (err) {
        clearTimeout(timeout);
        if (attempt < maxRetries) {
          const delay = attempt * 10000; // 10s, 20s, 30s
          console.warn(`[Rayna Sync] ${endpoint.path} attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  // ── Batch Upsert (or plain INSERT for insertOnly tables) ──
  static async upsertBatch(client, pgTable, conflictKeys, rows, { insertOnly = false } = {}) {
    if (rows.length === 0) return;

    const columns = Object.keys(rows[0]);
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

    let sql;
    if (insertOnly) {
      sql = `INSERT INTO ${pgTable} (${columns.join(', ')}) VALUES ${valueClauses.join(', ')}`;
    } else {
      const updateColumns = columns.filter(c => !conflictKeys.includes(c));
      const conflictUpdate = updateColumns
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');
      sql = `
        INSERT INTO ${pgTable} (${columns.join(', ')})
        VALUES ${valueClauses.join(', ')}
        ON CONFLICT (${conflictKeys.join(', ')}) DO UPDATE SET ${conflictUpdate}, synced_at = NOW()
      `;
    }

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
          await this.upsertBatch(client, endpoint.pgTable, endpoint.conflictKeys, batch, { insertOnly: !!endpoint.insertOnly });
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

  // ── Catch-up Sync (re-fetch last N days to pick up modified records) ──
  static async syncCatchUp(days = 90) {
    console.log(`[Rayna Sync] Catch-up sync starting — re-fetching last ${days} days to pick up modifications...`);
    const results = [];

    for (const name of Object.keys(this.ENDPOINTS)) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const current = new Date(startDate);
      current.setHours(0, 0, 0, 0);
      const endDate = new Date();
      let totalRows = 0;

      // Sync week-by-week to avoid overwhelming the API
      while (current <= endDate) {
        const weekEnd = new Date(current);
        weekEnd.setDate(weekEnd.getDate() + 6);
        if (weekEnd > endDate) weekEnd.setTime(endDate.getTime());

        const dateFrom = this.formatDateParam(current);
        const dateTo = this.formatDateParam(weekEnd);

        try {
          const result = await this.syncEndpoint(name, { dateFrom, dateTo });
          totalRows += result.rowsSynced || 0;
        } catch (err) {
          console.error(`[Rayna Sync] ${name} catch-up ${dateFrom}→${dateTo} failed:`, err.message);
        }

        current.setDate(current.getDate() + 7);
      }

      console.log(`[Rayna Sync] ${name} catch-up done — ${totalRows} rows re-synced`);
      results.push({ endpoint: name, totalRows });
    }

    console.log('[Rayna Sync] Catch-up sync completed:', JSON.stringify(results));
    return results;
  }

  // ── Incremental Sync by bill_date + modified_date ────────
  // Fetches from API and upserts records where bill_date = target OR modified_date = target.
  // Default target: yesterday. Used for daily incremental sync.
  static async syncByModifiedDate(name, { targetDate } = {}) {
    const endpoint = this.ENDPOINTS[name];
    if (!endpoint) throw new Error(`Unknown Rayna endpoint: ${name}`);

    // Target date: default to yesterday (UTC)
    const target = targetDate ? new Date(targetDate) : new Date();
    if (!targetDate) target.setDate(target.getDate() - 1);
    target.setHours(0, 0, 0, 0);
    const targetStr = target.toISOString().slice(0, 10); // YYYY-MM-DD

    console.log(`[Rayna Sync] ${name}: bill_date + modified_date sync for ${targetStr}`);

    const startTime = Date.now();
    await this.updateSyncMetadata(name, { status: 'running' });

    try {
      // Fetch from API — no date filter so we get whatever the API shares
      const { rows: rawRows, meta } = await this.fetchFromAPI(endpoint, {});

      if (rawRows.length === 0) {
        // Retry with a broad date range as fallback
        console.log(`[Rayna Sync] ${name}: empty response, retrying with 90-day range...`);
        const from90 = new Date(target); from90.setDate(from90.getDate() - 90);
        const { rows: retryRows } = await this.fetchFromAPI(endpoint, {
          dateFrom: this.formatDateParam(from90),
          dateTo: this.formatDateParam(new Date()),
        });
        rawRows.push(...retryRows);
      }

      // Filter by bill_date OR modified_date matching target date
      // API field names: billDate (tours/flights) or billdate (hotels/visas)
      const filtered = rawRows.filter(row => {
        const parseDateStr = (d) => {
          if (!d) return null;
          const p = new Date(d);
          return isNaN(p) ? null : p.toISOString().slice(0, 10);
        };
        const bd = parseDateStr(row.billDate || row.billdate);
        const md = parseDateStr(row.modified_date);
        return bd === targetStr || md === targetStr;
      });

      console.log(`[Rayna Sync] ${name}: ${rawRows.length} total rows, ${filtered.length} with bill_date OR modified_date=${targetStr}`);

      if (filtered.length === 0) {
        await this.updateSyncMetadata(name, {
          status: 'success', rowsSynced: 0,
          durationMs: Date.now() - startTime,
        });
        return { endpoint: name, rowsSynced: 0, totalFromAPI: rawRows.length, filtered: 0, targetDate: targetStr };
      }

      // Map, validate, deduplicate
      const allMapped = filtered.map(endpoint.mapRow);
      const validRows = allMapped.filter(row =>
        endpoint.conflictKeys.every(k => row[k] != null)
      );
      const seen = new Set();
      const mappedRows = validRows.filter(row => {
        const key = JSON.stringify(endpoint.conflictKeys.map(k => row[k]));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      console.log(`[Rayna Sync] ${name}: ${filtered.length} → ${mappedRows.length} after dedup`);

      // Batch upsert
      let totalSynced = 0;
      for (let i = 0; i < mappedRows.length; i += this.BATCH_SIZE) {
        const batch = mappedRows.slice(i, i + this.BATCH_SIZE);
        await transaction(async (client) => {
          await this.upsertBatch(client, endpoint.pgTable, endpoint.conflictKeys, batch, { insertOnly: !!endpoint.insertOnly });
        });
        totalSynced += batch.length;
      }

      await this.updateSyncMetadata(name, {
        status: 'success', rowsSynced: totalSynced,
        durationMs: Date.now() - startTime,
      });

      console.log(`[Rayna Sync] ${name}: bill+modified date sync done — ${totalSynced} rows in ${Date.now() - startTime}ms`);
      return { endpoint: name, rowsSynced: totalSynced, totalFromAPI: rawRows.length, filtered: filtered.length, targetDate: targetStr };
    } catch (err) {
      console.error(`[Rayna Sync] ${name} bill+modified date sync failed:`, err.message);
      await this.updateSyncMetadata(name, {
        status: 'error', error: err.message,
        durationMs: Date.now() - startTime,
      });
      throw err;
    }
  }

  // ── Bill+Modified Date Sync All Endpoints ──────────────────
  static async syncAllByModifiedDate({ targetDate } = {}) {
    console.log('[Rayna Sync] Starting bill_date + modified_date sync for all endpoints...');
    const results = [];
    for (const name of Object.keys(this.ENDPOINTS)) {
      try {
        const result = await this.syncByModifiedDate(name, { targetDate });
        results.push(result);
      } catch (err) {
        results.push({ endpoint: name, error: err.message });
      }
    }
    console.log('[Rayna Sync] Bill+modified date sync completed:', JSON.stringify(results));
    return results;
  }

  // ── Tours Daily Smart Sync (Batch) ───────────────────────
  // Fetches ALL from /tours-sync API, matches each row against DB
  // by 6-field combination key (in-memory), then batch UPDATE/INSERT.
  //   combo key: billno + bill_date + tours_name + guest_name + grnty_email + group_name
  // Match found → UPDATE row + update unified_contacts if contact info changed
  // No match   → INSERT row + find/create unified_contact + link
  static async syncToursDaily() {
    const endpoint = this.ENDPOINTS.tours;
    const startTime = Date.now();

    console.log(`[Tours Daily] Starting batch sync — processing all API records`);
    await this.updateSyncMetadata('tours', { status: 'running' });

    // Helper: normalize date to YYYY-MM-DD string for consistent combo key matching
    const normDate = (d) => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    };

    // 6-field combination key (NULL-safe via JSON.stringify)
    const COMBO = ['billno', 'bill_date', 'tours_name', 'guest_name', 'grnty_email', 'group_name'];
    const makeKey = (row) => JSON.stringify(COMBO.map(f =>
      f === 'bill_date' ? normDate(row[f]) : (row[f] ?? null)
    ));

    try {
      // ── Phase 1: Fetch & Map ──
      const { rows: rawRows } = await this.fetchFromAPI(endpoint, {});

      if (rawRows.length === 0) {
        console.log(`[Tours Daily] API returned 0 rows`);
        await this.updateSyncMetadata('tours', { status: 'success', rowsSynced: 0, durationMs: Date.now() - startTime });
        return { updated: 0, inserted: 0, totalFromAPI: 0, durationMs: Date.now() - startTime };
      }

      const allMapped = rawRows.map(endpoint.mapRow);

      // Deduplicate API rows by combo key (keep last occurrence)
      const apiDedup = new Map();
      for (const row of allMapped) {
        apiDedup.set(makeKey(row), row);
      }
      const apiRows = [...apiDedup.values()];
      console.log(`[Tours Daily] ${rawRows.length} from API → ${apiRows.length} after dedup`);

      // ── Phase 2: Load DB State into Memory ──
      const { rows: dbRows } = await query(`
        SELECT id, billno, bill_date, tours_name, guest_name, grnty_email, group_name,
               guest_contact, unified_id
        FROM rayna_tours
      `);
      const dbMap = new Map();
      for (const row of dbRows) {
        dbMap.set(makeKey(row), row);
      }
      console.log(`[Tours Daily] Loaded ${dbRows.length} DB rows into memory`);

      // ── Phase 3: Classify ──
      const toUpdate = []; // {apiRow, dbRow}
      const toInsert = []; // apiRow
      for (const apiRow of apiRows) {
        const dbRow = dbMap.get(makeKey(apiRow));
        if (dbRow) {
          toUpdate.push({ apiRow, dbRow });
        } else {
          toInsert.push(apiRow);
        }
      }
      console.log(`[Tours Daily] ${toUpdate.length} to update, ${toInsert.length} to insert`);

      let updated = 0, inserted = 0, contactsUpdated = 0, contactsCreated = 0;

      // ── Phase 4: Batch UPDATE (chunks of BATCH_SIZE) ──
      const UPDATE_FIELDS = ['tour_date', 'modified_date', 'nationality', 'country_name',
        'agent_name', 'profit_center', 'status', 'adult', 'child', 'infant',
        'total_sell', 'guest_contact', 'grnty_email'];
      const ALL_UPD_COLS = ['id', ...UPDATE_FIELDS]; // 14 columns
      const UPD_TYPES = ['int', 'timestamptz', 'timestamptz', 'text', 'text',
        'text', 'text', 'text', 'int', 'int', 'int', 'numeric', 'text', 'text'];

      const contactChanges = []; // {unified_id, newPhone, newEmail}

      for (let i = 0; i < toUpdate.length; i += this.BATCH_SIZE) {
        const chunk = toUpdate.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const { apiRow, dbRow } = chunk[j];
          const base = j * ALL_UPD_COLS.length;
          const placeholders = ALL_UPD_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${UPD_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);

          values.push(
            dbRow.id,
            apiRow.tour_date, apiRow.modified_date, apiRow.nationality, apiRow.country_name,
            apiRow.agent_name, apiRow.profit_center, apiRow.status, apiRow.adult, apiRow.child,
            apiRow.infant, apiRow.total_sell, apiRow.guest_contact, apiRow.grnty_email
          );

          // Track contact changes for Phase 7
          const phoneChanged = (apiRow.guest_contact || null) !== (dbRow.guest_contact || null);
          const emailChanged = (apiRow.grnty_email || null) !== (dbRow.grnty_email || null);
          if ((phoneChanged || emailChanged) && dbRow.unified_id) {
            contactChanges.push({
              unified_id: dbRow.unified_id,
              newPhone: phoneChanged ? apiRow.guest_contact : null,
              newEmail: emailChanged ? apiRow.grnty_email : null,
            });
          }
        }

        const setClause = UPDATE_FIELDS.map(c => `${c} = v.${c}`).join(', ');
        await query(`
          UPDATE rayna_tours AS t SET ${setClause}, synced_at = NOW()
          FROM (VALUES ${rowClauses.join(', ')}) AS v(${ALL_UPD_COLS.join(', ')})
          WHERE t.id = v.id
        `, values);

        updated += chunk.length;
        if (updated % 5000 < this.BATCH_SIZE) {
          console.log(`[Tours Daily] Updated ${updated}/${toUpdate.length}...`);
        }
      }

      // ── Phase 5: Batch INSERT (chunks of BATCH_SIZE) ──
      const INSERT_COLS = ['billno', 'bill_date', 'tour_date', 'modified_date', 'guest_name',
        'guest_contact', 'nationality', 'country_name', 'agent_name', 'group_name',
        'tours_name', 'profit_center', 'grnty_email', 'status', 'adult', 'child', 'infant', 'total_sell'];
      const INS_TYPES = ['text', 'timestamptz', 'timestamptz', 'timestamptz', 'text',
        'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'int', 'int', 'int', 'numeric'];

      const allInserted = []; // returned rows from INSERT

      for (let i = 0; i < toInsert.length; i += this.BATCH_SIZE) {
        const chunk = toInsert.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const base = j * INSERT_COLS.length;
          const placeholders = INSERT_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${INS_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);
          INSERT_COLS.forEach(col => values.push(row[col] ?? null));
        }

        const { rows: returnedRows } = await query(`
          INSERT INTO rayna_tours (${INSERT_COLS.join(', ')})
          VALUES ${rowClauses.join(', ')}
          RETURNING id, guest_contact, grnty_email, guest_name, country_name, profit_center, bill_date
        `, values);

        allInserted.push(...returnedRows);
        inserted += chunk.length;
        if (inserted % 5000 < this.BATCH_SIZE) {
          console.log(`[Tours Daily] Inserted ${inserted}/${toInsert.length}...`);
        }
      }

      // ── Phase 6: Link inserts to unified_contacts (batch) ──
      if (allInserted.length > 0) {
        console.log(`[Tours Daily] Linking ${allInserted.length} new rows to unified_contacts...`);

        // Prepare phone_key and email_key for each inserted row
        const insertMeta = allInserted.map(row => {
          const phoneDigits = row.guest_contact
            ? row.guest_contact.replace(/[^0-9]/g, '').slice(-10)
            : null;
          const emailKey = row.grnty_email
            ? row.grnty_email.trim().toLowerCase()
            : null;
          const validPhone = phoneDigits && phoneDigits.length >= 7 && !/^0+$/.test(phoneDigits);
          return { ...row, phoneKey: validPhone ? phoneDigits : null, emailKey };
        });

        // Batch lookup existing unified_contacts by phone and email
        const allPhoneKeys = [...new Set(insertMeta.map(m => m.phoneKey).filter(Boolean))];
        const allEmailKeys = [...new Set(insertMeta.map(m => m.emailKey).filter(Boolean))];

        const ucByPhone = new Map(); // phone_key → unified_id
        const ucByEmail = new Map(); // email_key → unified_id

        if (allPhoneKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, phone_key FROM unified_contacts WHERE phone_key = ANY($1)`,
            [allPhoneKeys]
          );
          for (const r of rows) ucByPhone.set(r.phone_key, r.unified_id);
        }
        if (allEmailKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, email_key FROM unified_contacts WHERE email_key = ANY($1)`,
            [allEmailKeys]
          );
          for (const r of rows) ucByEmail.set(r.email_key, r.unified_id);
        }

        // Match each insert to existing UC (phone first, email fallback)
        const tourToUC = new Map();   // tourId → unified_id
        const unmatched = [];          // rows that need new UC created

        for (const meta of insertMeta) {
          let uid = null;
          if (meta.phoneKey) uid = ucByPhone.get(meta.phoneKey);
          if (!uid && meta.emailKey) uid = ucByEmail.get(meta.emailKey);

          if (uid) {
            tourToUC.set(meta.id, uid);
          } else if (meta.phoneKey || meta.emailKey) {
            unmatched.push(meta);
          }
        }

        // Create new unified_contacts for unmatched (deduplicate by phone/email)
        if (unmatched.length > 0) {
          const seenNewUC = new Map(); // dedupeKey → unified_id (after creation)
          const toCreateUC = [];

          for (const meta of unmatched) {
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            if (!seenNewUC.has(dk)) {
              seenNewUC.set(dk, null); // placeholder
              toCreateUC.push(meta);
            }
          }

          // Batch INSERT new unified_contacts
          for (let i = 0; i < toCreateUC.length; i += this.BATCH_SIZE) {
            const chunk = toCreateUC.slice(i, i + this.BATCH_SIZE);
            const UC_COLS = ['phone_key', 'phone', 'email_key', 'email', 'name', 'country',
              'sources', 'first_seen_at', 'total_tour_bookings', 'first_booking_at',
              'business_type', 'contact_type'];
            const UC_TYPES = ['text', 'text', 'text', 'text', 'text', 'text',
              'text', 'timestamptz', 'int', 'timestamptz', 'text', 'text'];

            const values = [];
            const rowClauses = [];

            for (let j = 0; j < chunk.length; j++) {
              const meta = chunk[j];
              const isB2B = meta.profit_center && /b2b/i.test(meta.profit_center);
              const bType = isB2B ? 'B2B' : 'B2C';
              const base = j * UC_COLS.length;
              const placeholders = UC_COLS.map((_, ci) => {
                const p = `$${base + ci + 1}`;
                return j === 0 ? `${p}::${UC_TYPES[ci]}` : p;
              });
              rowClauses.push(`(${placeholders.join(', ')})`);

              values.push(
                meta.phoneKey, meta.guest_contact, meta.emailKey, meta.grnty_email,
                meta.guest_name, meta.country_name, 'rayna', meta.bill_date,
                1, meta.bill_date, bType, bType
              );
            }

            const { rows: newRows } = await query(`
              INSERT INTO unified_contacts (${UC_COLS.join(', ')})
              VALUES ${rowClauses.join(', ')}
              RETURNING unified_id, phone_key, email_key
            `, values);

            for (const r of newRows) {
              const dk = r.phone_key ? `p:${r.phone_key}` : `e:${r.email_key}`;
              seenNewUC.set(dk, r.unified_id);
              // Also add to lookup maps for subsequent rows
              if (r.phone_key) ucByPhone.set(r.phone_key, r.unified_id);
              if (r.email_key) ucByEmail.set(r.email_key, r.unified_id);
            }
            contactsCreated += newRows.length;
          }

          // Map unmatched tours to newly created UCs
          for (const meta of unmatched) {
            if (tourToUC.has(meta.id)) continue;
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            const uid = seenNewUC.get(dk);
            if (uid) tourToUC.set(meta.id, uid);
          }
        }

        // Batch UPDATE rayna_tours SET unified_id for all linked inserts
        const linkEntries = [...tourToUC.entries()];
        for (let i = 0; i < linkEntries.length; i += this.BATCH_SIZE) {
          const chunk = linkEntries.slice(i, i + this.BATCH_SIZE);
          // Use unnest for efficient batch update
          const tourIds = chunk.map(([tid]) => tid);
          const ucIds = chunk.map(([, uid]) => uid);
          await query(`
            UPDATE rayna_tours AS t SET unified_id = v.uid
            FROM unnest($1::int[], $2::bigint[]) AS v(tid, uid)
            WHERE t.id = v.tid
          `, [tourIds, ucIds]);
        }

        console.log(`[Tours Daily] Linked ${tourToUC.size} inserts to unified_contacts (${contactsCreated} new contacts created)`);
      }

      // ── Phase 7: Update unified_contacts for changed contacts ──
      if (contactChanges.length > 0) {
        console.log(`[Tours Daily] Updating ${contactChanges.length} unified_contacts with changed contact info...`);
        for (const { unified_id, newPhone, newEmail } of contactChanges) {
          const updates = [];
          const vals = [];
          let idx = 1;

          if (newEmail) {
            updates.push(`email = $${idx}, email_key = LOWER(TRIM($${idx}))`);
            vals.push(newEmail);
            idx++;
          }
          if (newPhone) {
            updates.push(`phone = $${idx}`);
            vals.push(newPhone);
            idx++;
            updates.push(`phone_key = RIGHT(REGEXP_REPLACE($${idx},'[^0-9]','','g'), 10)`);
            vals.push(newPhone);
            idx++;
          }
          if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            vals.push(unified_id);
            await query(`UPDATE unified_contacts SET ${updates.join(', ')} WHERE unified_id = $${idx}`, vals);
            contactsUpdated++;
          }
        }
      }

      const durationMs = Date.now() - startTime;
      await this.updateSyncMetadata('tours', { status: 'success', rowsSynced: updated + inserted, durationMs });

      console.log(`[Tours Daily] Done in ${(durationMs / 1000).toFixed(1)}s — updated: ${updated}, inserted: ${inserted}, contacts updated: ${contactsUpdated}, contacts created: ${contactsCreated}`);
      return { updated, inserted, totalFromAPI: rawRows.length, contactsUpdated, contactsCreated, durationMs };
    } catch (err) {
      console.error(`[Tours Daily] Failed:`, err.message);
      await this.updateSyncMetadata('tours', { status: 'error', error: err.message, durationMs: Date.now() - startTime });
      throw err;
    }
  }

  // ── Hotels Daily Smart Sync (Batch) ──────────────────────
  // Fetches ALL from /hotel-sync API, matches each row against DB
  // by 4-field combination key (in-memory), then batch UPDATE/INSERT.
  //   combo key: billno + bill_date + check_in_date + guest_name
  // Match found → UPDATE row + update unified_contacts if contact info changed
  // No match   → INSERT row + find/create unified_contact + link
  static async syncHotelsDaily() {
    const endpoint = this.ENDPOINTS.hotels;
    const startTime = Date.now();

    console.log(`[Hotels Daily] Starting batch sync — processing all API records`);
    await this.updateSyncMetadata('hotels', { status: 'running' });

    // Helper: normalize date to YYYY-MM-DD string for consistent combo key matching
    const normDate = (d) => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    };

    // 4-field combination key (NULL-safe via JSON.stringify)
    const COMBO = ['billno', 'bill_date', 'check_in_date', 'guest_name'];
    const makeKey = (row) => JSON.stringify(COMBO.map(f =>
      (f === 'bill_date' || f === 'check_in_date') ? normDate(row[f]) : (row[f] ?? null)
    ));

    try {
      // ── Phase 1: Fetch & Map ──
      // Hotel API requires date range — use a wide window (5 years back → 2 years ahead)
      const dateFrom = new Date(); dateFrom.setFullYear(dateFrom.getFullYear() - 5);
      const dateTo = new Date(); dateTo.setFullYear(dateTo.getFullYear() + 2);
      let { rows: rawRows } = await this.fetchFromAPI(endpoint, {
        dateFrom: this.formatDateParam(dateFrom),
        dateTo: this.formatDateParam(dateTo),
      });

      if (rawRows.length === 0) {
        console.log(`[Hotels Daily] API returned 0 rows`);
        await this.updateSyncMetadata('hotels', { status: 'success', rowsSynced: 0, durationMs: Date.now() - startTime });
        return { updated: 0, inserted: 0, totalFromAPI: 0, durationMs: Date.now() - startTime };
      }

      const allMapped = rawRows.map(endpoint.mapRow);

      // Deduplicate API rows by combo key (keep last occurrence)
      const apiDedup = new Map();
      for (const row of allMapped) {
        apiDedup.set(makeKey(row), row);
      }
      const apiRows = [...apiDedup.values()];
      console.log(`[Hotels Daily] ${rawRows.length} from API → ${apiRows.length} after dedup`);

      // ── Phase 2: Load DB State into Memory ──
      const { rows: dbRows } = await query(`
        SELECT id, billno, bill_date, check_in_date, guest_name,
               guest_contact, grnty_email, unified_id
        FROM rayna_hotels
      `);
      const dbMap = new Map();
      for (const row of dbRows) {
        dbMap.set(makeKey(row), row);
      }
      console.log(`[Hotels Daily] Loaded ${dbRows.length} DB rows into memory`);

      // ── Phase 3: Classify ──
      const toUpdate = []; // {apiRow, dbRow}
      const toInsert = []; // apiRow
      for (const apiRow of apiRows) {
        const dbRow = dbMap.get(makeKey(apiRow));
        if (dbRow) {
          toUpdate.push({ apiRow, dbRow });
        } else {
          toInsert.push(apiRow);
        }
      }
      console.log(`[Hotels Daily] ${toUpdate.length} to update, ${toInsert.length} to insert`);

      let updated = 0, inserted = 0, contactsUpdated = 0, contactsCreated = 0;

      // ── Phase 4: Batch UPDATE (chunks of BATCH_SIZE) ──
      const UPDATE_FIELDS = ['modified_date', 'guest_contact', 'country_name', 'agent_name',
        'hotel_name', 'profit_center', 'grnty_email', 'no_of_rooms', 'total_sell'];
      const ALL_UPD_COLS = ['id', ...UPDATE_FIELDS]; // 10 columns
      const UPD_TYPES = ['int', 'timestamptz', 'text', 'text', 'text',
        'text', 'text', 'text', 'int', 'numeric'];

      const contactChanges = []; // {unified_id, newPhone, newEmail}

      for (let i = 0; i < toUpdate.length; i += this.BATCH_SIZE) {
        const chunk = toUpdate.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const { apiRow, dbRow } = chunk[j];
          const base = j * ALL_UPD_COLS.length;
          const placeholders = ALL_UPD_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${UPD_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);

          values.push(
            dbRow.id,
            apiRow.modified_date, apiRow.guest_contact, apiRow.country_name, apiRow.agent_name,
            apiRow.hotel_name, apiRow.profit_center, apiRow.grnty_email, apiRow.no_of_rooms,
            apiRow.total_sell
          );

          // Track contact changes for Phase 7
          const phoneChanged = (apiRow.guest_contact || null) !== (dbRow.guest_contact || null);
          const emailChanged = (apiRow.grnty_email || null) !== (dbRow.grnty_email || null);
          if ((phoneChanged || emailChanged) && dbRow.unified_id) {
            contactChanges.push({
              unified_id: dbRow.unified_id,
              newPhone: phoneChanged ? apiRow.guest_contact : null,
              newEmail: emailChanged ? apiRow.grnty_email : null,
            });
          }
        }

        const setClause = UPDATE_FIELDS.map(c => `${c} = v.${c}`).join(', ');
        await query(`
          UPDATE rayna_hotels AS t SET ${setClause}, synced_at = NOW()
          FROM (VALUES ${rowClauses.join(', ')}) AS v(${ALL_UPD_COLS.join(', ')})
          WHERE t.id = v.id
        `, values);

        updated += chunk.length;
        if (updated % 5000 < this.BATCH_SIZE) {
          console.log(`[Hotels Daily] Updated ${updated}/${toUpdate.length}...`);
        }
      }

      // ── Phase 5: Batch INSERT (chunks of BATCH_SIZE) ──
      const INSERT_COLS = ['billno', 'bill_date', 'check_in_date', 'modified_date', 'guest_name',
        'guest_contact', 'country_name', 'agent_name', 'hotel_name', 'profit_center',
        'grnty_email', 'no_of_rooms', 'total_sell'];
      const INS_TYPES = ['text', 'timestamptz', 'timestamptz', 'timestamptz', 'text',
        'text', 'text', 'text', 'text', 'text', 'text', 'int', 'numeric'];

      const allInserted = []; // returned rows from INSERT

      for (let i = 0; i < toInsert.length; i += this.BATCH_SIZE) {
        const chunk = toInsert.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const base = j * INSERT_COLS.length;
          const placeholders = INSERT_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${INS_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);
          INSERT_COLS.forEach(col => values.push(row[col] ?? null));
        }

        const { rows: returnedRows } = await query(`
          INSERT INTO rayna_hotels (${INSERT_COLS.join(', ')})
          VALUES ${rowClauses.join(', ')}
          RETURNING id, guest_contact, grnty_email, guest_name, country_name, profit_center, bill_date
        `, values);

        allInserted.push(...returnedRows);
        inserted += chunk.length;
        if (inserted % 5000 < this.BATCH_SIZE) {
          console.log(`[Hotels Daily] Inserted ${inserted}/${toInsert.length}...`);
        }
      }

      // ── Phase 6: Link inserts to unified_contacts (batch) ──
      if (allInserted.length > 0) {
        console.log(`[Hotels Daily] Linking ${allInserted.length} new rows to unified_contacts...`);

        // Prepare phone_key and email_key for each inserted row
        const insertMeta = allInserted.map(row => {
          const phoneDigits = row.guest_contact
            ? row.guest_contact.replace(/[^0-9]/g, '').slice(-10)
            : null;
          const emailKey = row.grnty_email
            ? row.grnty_email.trim().toLowerCase()
            : null;
          const validPhone = phoneDigits && phoneDigits.length >= 7 && !/^0+$/.test(phoneDigits);
          return { ...row, phoneKey: validPhone ? phoneDigits : null, emailKey };
        });

        // Batch lookup existing unified_contacts by phone and email
        const allPhoneKeys = [...new Set(insertMeta.map(m => m.phoneKey).filter(Boolean))];
        const allEmailKeys = [...new Set(insertMeta.map(m => m.emailKey).filter(Boolean))];

        const ucByPhone = new Map(); // phone_key → unified_id
        const ucByEmail = new Map(); // email_key → unified_id

        if (allPhoneKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, phone_key FROM unified_contacts WHERE phone_key = ANY($1)`,
            [allPhoneKeys]
          );
          for (const r of rows) ucByPhone.set(r.phone_key, r.unified_id);
        }
        if (allEmailKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, email_key FROM unified_contacts WHERE email_key = ANY($1)`,
            [allEmailKeys]
          );
          for (const r of rows) ucByEmail.set(r.email_key, r.unified_id);
        }

        // Match each insert to existing UC (phone first, email fallback)
        const hotelToUC = new Map();   // hotelId → unified_id
        const unmatched = [];           // rows that need new UC created

        for (const meta of insertMeta) {
          let uid = null;
          if (meta.phoneKey) uid = ucByPhone.get(meta.phoneKey);
          if (!uid && meta.emailKey) uid = ucByEmail.get(meta.emailKey);

          if (uid) {
            hotelToUC.set(meta.id, uid);
          } else if (meta.phoneKey || meta.emailKey) {
            unmatched.push(meta);
          }
        }

        // Create new unified_contacts for unmatched (deduplicate by phone/email)
        if (unmatched.length > 0) {
          const seenNewUC = new Map(); // dedupeKey → unified_id (after creation)
          const toCreateUC = [];

          for (const meta of unmatched) {
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            if (!seenNewUC.has(dk)) {
              seenNewUC.set(dk, null); // placeholder
              toCreateUC.push(meta);
            }
          }

          // Batch INSERT new unified_contacts
          for (let i = 0; i < toCreateUC.length; i += this.BATCH_SIZE) {
            const chunk = toCreateUC.slice(i, i + this.BATCH_SIZE);
            const UC_COLS = ['phone_key', 'phone', 'email_key', 'email', 'name', 'country',
              'sources', 'first_seen_at', 'total_hotel_bookings', 'first_booking_at',
              'business_type', 'contact_type'];
            const UC_TYPES = ['text', 'text', 'text', 'text', 'text', 'text',
              'text', 'timestamptz', 'int', 'timestamptz', 'text', 'text'];

            const values = [];
            const rowClauses = [];

            for (let j = 0; j < chunk.length; j++) {
              const meta = chunk[j];
              const isB2B = meta.profit_center && /b2b/i.test(meta.profit_center);
              const bType = isB2B ? 'B2B' : 'B2C';
              const base = j * UC_COLS.length;
              const placeholders = UC_COLS.map((_, ci) => {
                const p = `$${base + ci + 1}`;
                return j === 0 ? `${p}::${UC_TYPES[ci]}` : p;
              });
              rowClauses.push(`(${placeholders.join(', ')})`);

              values.push(
                meta.phoneKey, meta.guest_contact, meta.emailKey, meta.grnty_email,
                meta.guest_name, meta.country_name, 'rayna', meta.bill_date,
                1, meta.bill_date, bType, bType
              );
            }

            const { rows: newRows } = await query(`
              INSERT INTO unified_contacts (${UC_COLS.join(', ')})
              VALUES ${rowClauses.join(', ')}
              RETURNING unified_id, phone_key, email_key
            `, values);

            for (const r of newRows) {
              const dk = r.phone_key ? `p:${r.phone_key}` : `e:${r.email_key}`;
              seenNewUC.set(dk, r.unified_id);
              if (r.phone_key) ucByPhone.set(r.phone_key, r.unified_id);
              if (r.email_key) ucByEmail.set(r.email_key, r.unified_id);
            }
            contactsCreated += newRows.length;
          }

          // Map unmatched hotels to newly created UCs
          for (const meta of unmatched) {
            if (hotelToUC.has(meta.id)) continue;
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            const uid = seenNewUC.get(dk);
            if (uid) hotelToUC.set(meta.id, uid);
          }
        }

        // Batch UPDATE rayna_hotels SET unified_id for all linked inserts
        const linkEntries = [...hotelToUC.entries()];
        for (let i = 0; i < linkEntries.length; i += this.BATCH_SIZE) {
          const chunk = linkEntries.slice(i, i + this.BATCH_SIZE);
          const hotelIds = chunk.map(([tid]) => tid);
          const ucIds = chunk.map(([, uid]) => uid);
          await query(`
            UPDATE rayna_hotels AS t SET unified_id = v.uid
            FROM unnest($1::int[], $2::bigint[]) AS v(tid, uid)
            WHERE t.id = v.tid
          `, [hotelIds, ucIds]);
        }

        console.log(`[Hotels Daily] Linked ${hotelToUC.size} inserts to unified_contacts (${contactsCreated} new contacts created)`);
      }

      // ── Phase 7: Update unified_contacts for changed contacts ──
      if (contactChanges.length > 0) {
        console.log(`[Hotels Daily] Updating ${contactChanges.length} unified_contacts with changed contact info...`);
        for (const { unified_id, newPhone, newEmail } of contactChanges) {
          const updates = [];
          const vals = [];
          let idx = 1;

          if (newEmail) {
            updates.push(`email = $${idx}, email_key = LOWER(TRIM($${idx}))`);
            vals.push(newEmail);
            idx++;
          }
          if (newPhone) {
            updates.push(`phone = $${idx}`);
            vals.push(newPhone);
            idx++;
            updates.push(`phone_key = RIGHT(REGEXP_REPLACE($${idx},'[^0-9]','','g'), 10)`);
            vals.push(newPhone);
            idx++;
          }
          if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            vals.push(unified_id);
            await query(`UPDATE unified_contacts SET ${updates.join(', ')} WHERE unified_id = $${idx}`, vals);
            contactsUpdated++;
          }
        }
      }

      const durationMs = Date.now() - startTime;
      await this.updateSyncMetadata('hotels', { status: 'success', rowsSynced: updated + inserted, durationMs });

      console.log(`[Hotels Daily] Done in ${(durationMs / 1000).toFixed(1)}s — updated: ${updated}, inserted: ${inserted}, contacts updated: ${contactsUpdated}, contacts created: ${contactsCreated}`);
      return { updated, inserted, totalFromAPI: rawRows.length, contactsUpdated, contactsCreated, durationMs };
    } catch (err) {
      console.error(`[Hotels Daily] Failed:`, err.message);
      await this.updateSyncMetadata('hotels', { status: 'error', error: err.message, durationMs: Date.now() - startTime });
      throw err;
    }
  }

  // ── Visas Daily Smart Sync (Batch) ──────────────────────
  // Fetches ALL from /visa-sync API, matches each row against DB
  // by 4-field combination key (in-memory), then batch UPDATE/INSERT.
  //   combo key: billno + bill_date + grnty_email + country_name
  static async syncVisasDaily() {
    const endpoint = this.ENDPOINTS.visas;
    const startTime = Date.now();

    console.log(`[Visas Daily] Starting batch sync — processing all API records`);
    await this.updateSyncMetadata('visas', { status: 'running' });

    const normDate = (d) => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    };

    const COMBO = ['billno', 'bill_date', 'grnty_email', 'country_name'];
    const makeKey = (row) => JSON.stringify(COMBO.map(f =>
      f === 'bill_date' ? normDate(row[f]) : (row[f] ?? null)
    ));

    try {
      // ── Phase 1: Fetch & Map ──
      const dateFrom = new Date(); dateFrom.setFullYear(dateFrom.getFullYear() - 5);
      const dateTo = new Date(); dateTo.setFullYear(dateTo.getFullYear() + 2);
      let { rows: rawRows } = await this.fetchFromAPI(endpoint, {
        dateFrom: this.formatDateParam(dateFrom),
        dateTo: this.formatDateParam(dateTo),
      });

      if (rawRows.length === 0) {
        console.log(`[Visas Daily] API returned 0 rows`);
        await this.updateSyncMetadata('visas', { status: 'success', rowsSynced: 0, durationMs: Date.now() - startTime });
        return { updated: 0, inserted: 0, totalFromAPI: 0, durationMs: Date.now() - startTime };
      }

      const allMapped = rawRows.map(endpoint.mapRow);
      const apiDedup = new Map();
      for (const row of allMapped) {
        apiDedup.set(makeKey(row), row);
      }
      const apiRows = [...apiDedup.values()];
      console.log(`[Visas Daily] ${rawRows.length} from API → ${apiRows.length} after dedup`);

      // ── Phase 2: Load DB State into Memory ──
      const { rows: dbRows } = await query(`
        SELECT id, billno, bill_date, grnty_email, country_name,
               guest_contact, unified_id
        FROM rayna_visas
      `);
      const dbMap = new Map();
      for (const row of dbRows) {
        dbMap.set(makeKey(row), row);
      }
      console.log(`[Visas Daily] Loaded ${dbRows.length} DB rows into memory`);

      // ── Phase 3: Classify ──
      const toUpdate = [];
      const toInsert = [];
      for (const apiRow of apiRows) {
        const dbRow = dbMap.get(makeKey(apiRow));
        if (dbRow) {
          toUpdate.push({ apiRow, dbRow });
        } else {
          toInsert.push(apiRow);
        }
      }
      console.log(`[Visas Daily] ${toUpdate.length} to update, ${toInsert.length} to insert`);

      let updated = 0, inserted = 0, contactsUpdated = 0, contactsCreated = 0;

      // ── Phase 4: Batch UPDATE ──
      const UPDATE_FIELDS = ['modified_date', 'guest_name', 'guest_contact', 'nationality',
        'agent_name', 'visa_type', 'profit_center', 'status', 'total_sell',
        'apply_date', 'applicant_name', 'passport_number'];
      const ALL_UPD_COLS = ['id', ...UPDATE_FIELDS];
      const UPD_TYPES = ['int', 'timestamptz', 'text', 'text', 'text',
        'text', 'text', 'text', 'text', 'numeric',
        'timestamptz', 'text', 'text'];

      const contactChanges = [];

      for (let i = 0; i < toUpdate.length; i += this.BATCH_SIZE) {
        const chunk = toUpdate.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const { apiRow, dbRow } = chunk[j];
          const base = j * ALL_UPD_COLS.length;
          const placeholders = ALL_UPD_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${UPD_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);

          values.push(
            dbRow.id,
            apiRow.modified_date, apiRow.guest_name, apiRow.guest_contact, apiRow.nationality,
            apiRow.agent_name, apiRow.visa_type, apiRow.profit_center, apiRow.status, apiRow.total_sell,
            apiRow.apply_date, apiRow.applicant_name, apiRow.passport_number
          );

          const phoneChanged = (apiRow.guest_contact || null) !== (dbRow.guest_contact || null);
          const emailChanged = (apiRow.grnty_email || null) !== (dbRow.grnty_email || null);
          if ((phoneChanged || emailChanged) && dbRow.unified_id) {
            contactChanges.push({
              unified_id: dbRow.unified_id,
              newPhone: phoneChanged ? apiRow.guest_contact : null,
              newEmail: emailChanged ? apiRow.grnty_email : null,
            });
          }
        }

        const setClause = UPDATE_FIELDS.map(c => `${c} = v.${c}`).join(', ');
        await query(`
          UPDATE rayna_visas AS t SET ${setClause}, synced_at = NOW()
          FROM (VALUES ${rowClauses.join(', ')}) AS v(${ALL_UPD_COLS.join(', ')})
          WHERE t.id = v.id
        `, values);

        updated += chunk.length;
        if (updated % 5000 < this.BATCH_SIZE) {
          console.log(`[Visas Daily] Updated ${updated}/${toUpdate.length}...`);
        }
      }

      // ── Phase 5: Batch INSERT ──
      const INSERT_COLS = ['billno', 'bill_date', 'modified_date', 'guest_name', 'guest_contact',
        'nationality', 'country_name', 'agent_name', 'visa_type', 'profit_center',
        'grnty_email', 'status', 'total_sell', 'apply_date', 'applicant_name', 'passport_number'];
      const INS_TYPES = ['text', 'timestamptz', 'timestamptz', 'text', 'text',
        'text', 'text', 'text', 'text', 'text',
        'text', 'text', 'numeric', 'timestamptz', 'text', 'text'];

      const allInserted = [];

      for (let i = 0; i < toInsert.length; i += this.BATCH_SIZE) {
        const chunk = toInsert.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const base = j * INSERT_COLS.length;
          const placeholders = INSERT_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${INS_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);
          INSERT_COLS.forEach(col => values.push(row[col] ?? null));
        }

        const conflictCols = INSERT_COLS.filter(c => !['billno', 'applicant_name', 'passport_number', 'visa_type'].includes(c));
        const { rows: returnedRows } = await query(`
          INSERT INTO rayna_visas (${INSERT_COLS.join(', ')})
          VALUES ${rowClauses.join(', ')}
          ON CONFLICT (billno, applicant_name, passport_number, visa_type) DO UPDATE SET
            ${conflictCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, synced_at = NOW()
          RETURNING id, guest_contact, grnty_email, guest_name, country_name, profit_center, bill_date
        `, values);

        allInserted.push(...returnedRows);
        inserted += chunk.length;
        if (inserted % 5000 < this.BATCH_SIZE) {
          console.log(`[Visas Daily] Inserted ${inserted}/${toInsert.length}...`);
        }
      }

      // ── Phase 6: Link inserts to unified_contacts ──
      if (allInserted.length > 0) {
        console.log(`[Visas Daily] Linking ${allInserted.length} new rows to unified_contacts...`);

        const insertMeta = allInserted.map(row => {
          const phoneDigits = row.guest_contact
            ? row.guest_contact.replace(/[^0-9]/g, '').slice(-10)
            : null;
          const emailKey = row.grnty_email
            ? row.grnty_email.trim().toLowerCase()
            : null;
          const validPhone = phoneDigits && phoneDigits.length >= 7 && !/^0+$/.test(phoneDigits);
          return { ...row, phoneKey: validPhone ? phoneDigits : null, emailKey };
        });

        const allPhoneKeys = [...new Set(insertMeta.map(m => m.phoneKey).filter(Boolean))];
        const allEmailKeys = [...new Set(insertMeta.map(m => m.emailKey).filter(Boolean))];

        const ucByPhone = new Map();
        const ucByEmail = new Map();

        if (allPhoneKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, phone_key FROM unified_contacts WHERE phone_key = ANY($1)`,
            [allPhoneKeys]
          );
          for (const r of rows) ucByPhone.set(r.phone_key, r.unified_id);
        }
        if (allEmailKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, email_key FROM unified_contacts WHERE email_key = ANY($1)`,
            [allEmailKeys]
          );
          for (const r of rows) ucByEmail.set(r.email_key, r.unified_id);
        }

        const visaToUC = new Map();
        const unmatched = [];

        for (const meta of insertMeta) {
          let uid = null;
          if (meta.phoneKey) uid = ucByPhone.get(meta.phoneKey);
          if (!uid && meta.emailKey) uid = ucByEmail.get(meta.emailKey);

          if (uid) {
            visaToUC.set(meta.id, uid);
          } else if (meta.phoneKey || meta.emailKey) {
            unmatched.push(meta);
          }
        }

        if (unmatched.length > 0) {
          const seenNewUC = new Map();
          const toCreateUC = [];

          for (const meta of unmatched) {
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            if (!seenNewUC.has(dk)) {
              seenNewUC.set(dk, null);
              toCreateUC.push(meta);
            }
          }

          for (let i = 0; i < toCreateUC.length; i += this.BATCH_SIZE) {
            const chunk = toCreateUC.slice(i, i + this.BATCH_SIZE);
            const UC_COLS = ['phone_key', 'phone', 'email_key', 'email', 'name', 'country',
              'sources', 'first_seen_at', 'total_visa_bookings', 'first_booking_at',
              'business_type', 'contact_type'];
            const UC_TYPES = ['text', 'text', 'text', 'text', 'text', 'text',
              'text', 'timestamptz', 'int', 'timestamptz', 'text', 'text'];

            const values = [];
            const rowClauses = [];

            for (let j = 0; j < chunk.length; j++) {
              const meta = chunk[j];
              const isB2B = meta.profit_center && /b2b/i.test(meta.profit_center);
              const bType = isB2B ? 'B2B' : 'B2C';
              const base = j * UC_COLS.length;
              const placeholders = UC_COLS.map((_, ci) => {
                const p = `$${base + ci + 1}`;
                return j === 0 ? `${p}::${UC_TYPES[ci]}` : p;
              });
              rowClauses.push(`(${placeholders.join(', ')})`);

              values.push(
                meta.phoneKey, meta.guest_contact, meta.emailKey, meta.grnty_email,
                meta.guest_name, meta.country_name, 'rayna', meta.bill_date,
                1, meta.bill_date, bType, bType
              );
            }

            const { rows: newRows } = await query(`
              INSERT INTO unified_contacts (${UC_COLS.join(', ')})
              VALUES ${rowClauses.join(', ')}
              RETURNING unified_id, phone_key, email_key
            `, values);

            for (const r of newRows) {
              const dk = r.phone_key ? `p:${r.phone_key}` : `e:${r.email_key}`;
              seenNewUC.set(dk, r.unified_id);
              if (r.phone_key) ucByPhone.set(r.phone_key, r.unified_id);
              if (r.email_key) ucByEmail.set(r.email_key, r.unified_id);
            }
            contactsCreated += newRows.length;
          }

          for (const meta of unmatched) {
            if (visaToUC.has(meta.id)) continue;
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            const uid = seenNewUC.get(dk);
            if (uid) visaToUC.set(meta.id, uid);
          }
        }

        const linkEntries = [...visaToUC.entries()];
        for (let i = 0; i < linkEntries.length; i += this.BATCH_SIZE) {
          const chunk = linkEntries.slice(i, i + this.BATCH_SIZE);
          const visaIds = chunk.map(([tid]) => tid);
          const ucIds = chunk.map(([, uid]) => uid);
          await query(`
            UPDATE rayna_visas AS t SET unified_id = v.uid
            FROM unnest($1::int[], $2::bigint[]) AS v(tid, uid)
            WHERE t.id = v.tid
          `, [visaIds, ucIds]);
        }

        console.log(`[Visas Daily] Linked ${visaToUC.size} inserts to unified_contacts (${contactsCreated} new contacts created)`);
      }

      // ── Phase 7: Update unified_contacts for changed contacts ──
      if (contactChanges.length > 0) {
        console.log(`[Visas Daily] Updating ${contactChanges.length} unified_contacts with changed contact info...`);
        for (const { unified_id, newPhone, newEmail } of contactChanges) {
          const updates = [];
          const vals = [];
          let idx = 1;

          if (newEmail) {
            updates.push(`email = $${idx}, email_key = LOWER(TRIM($${idx}))`);
            vals.push(newEmail);
            idx++;
          }
          if (newPhone) {
            updates.push(`phone = $${idx}`);
            vals.push(newPhone);
            idx++;
            updates.push(`phone_key = RIGHT(REGEXP_REPLACE($${idx},'[^0-9]','','g'), 10)`);
            vals.push(newPhone);
            idx++;
          }
          if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            vals.push(unified_id);
            await query(`UPDATE unified_contacts SET ${updates.join(', ')} WHERE unified_id = $${idx}`, vals);
            contactsUpdated++;
          }
        }
      }

      const durationMs = Date.now() - startTime;
      await this.updateSyncMetadata('visas', { status: 'success', rowsSynced: updated + inserted, durationMs });

      console.log(`[Visas Daily] Done in ${(durationMs / 1000).toFixed(1)}s — updated: ${updated}, inserted: ${inserted}, contacts updated: ${contactsUpdated}, contacts created: ${contactsCreated}`);
      return { updated, inserted, totalFromAPI: rawRows.length, contactsUpdated, contactsCreated, durationMs };
    } catch (err) {
      console.error(`[Visas Daily] Failed:`, err.message);
      await this.updateSyncMetadata('visas', { status: 'error', error: err.message, durationMs: Date.now() - startTime });
      throw err;
    }
  }

  // ── Flights Daily Smart Sync (Batch) ────────────────────
  // Fetches ALL from /flight-sync API, matches each row against DB
  // by 4-field combination key (in-memory), then batch UPDATE/INSERT.
  //   combo key: bill_date + billno + grnty_email + from_datetime
  static async syncFlightsDaily() {
    const endpoint = this.ENDPOINTS.flights;
    const startTime = Date.now();

    console.log(`[Flights Daily] Starting batch sync — processing all API records`);
    await this.updateSyncMetadata('flights', { status: 'running' });

    const normDate = (d) => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
    };

    const COMBO = ['bill_date', 'billno', 'grnty_email', 'from_datetime'];
    const makeKey = (row) => JSON.stringify(COMBO.map(f =>
      (f === 'bill_date' || f === 'from_datetime') ? normDate(row[f]) : (row[f] ?? null)
    ));

    try {
      // ── Phase 1: Fetch & Map ──
      const dateFrom = new Date(); dateFrom.setFullYear(dateFrom.getFullYear() - 5);
      const dateTo = new Date(); dateTo.setFullYear(dateTo.getFullYear() + 2);
      let { rows: rawRows } = await this.fetchFromAPI(endpoint, {
        dateFrom: this.formatDateParam(dateFrom),
        dateTo: this.formatDateParam(dateTo),
      });

      if (rawRows.length === 0) {
        console.log(`[Flights Daily] API returned 0 rows`);
        await this.updateSyncMetadata('flights', { status: 'success', rowsSynced: 0, durationMs: Date.now() - startTime });
        return { updated: 0, inserted: 0, totalFromAPI: 0, durationMs: Date.now() - startTime };
      }

      const allMapped = rawRows.map(endpoint.mapRow);
      const apiDedup = new Map();
      for (const row of allMapped) {
        apiDedup.set(makeKey(row), row);
      }
      const apiRows = [...apiDedup.values()];
      console.log(`[Flights Daily] ${rawRows.length} from API → ${apiRows.length} after dedup`);

      // ── Phase 2: Load DB State into Memory ──
      const { rows: dbRows } = await query(`
        SELECT id, bill_date, billno, grnty_email, from_datetime,
               guest_contact, unified_id
        FROM rayna_flights
      `);
      const dbMap = new Map();
      for (const row of dbRows) {
        dbMap.set(makeKey(row), row);
      }
      console.log(`[Flights Daily] Loaded ${dbRows.length} DB rows into memory`);

      // ── Phase 3: Classify ──
      const toUpdate = [];
      const toInsert = [];
      for (const apiRow of apiRows) {
        const dbRow = dbMap.get(makeKey(apiRow));
        if (dbRow) {
          toUpdate.push({ apiRow, dbRow });
        } else {
          toInsert.push(apiRow);
        }
      }
      console.log(`[Flights Daily] ${toUpdate.length} to update, ${toInsert.length} to insert`);

      let updated = 0, inserted = 0, contactsUpdated = 0, contactsCreated = 0;

      // ── Phase 4: Batch UPDATE ──
      const UPDATE_FIELDS = ['modified_date', 'guest_name', 'guest_contact', 'passenger_name',
        'nationality', 'agent_name', 'airport_name', 'flight_no', 'profit_center',
        'status', 'selling_price'];
      const ALL_UPD_COLS = ['id', ...UPDATE_FIELDS];
      const UPD_TYPES = ['int', 'timestamptz', 'text', 'text', 'text',
        'text', 'text', 'text', 'text', 'text',
        'text', 'numeric'];

      const contactChanges = [];

      for (let i = 0; i < toUpdate.length; i += this.BATCH_SIZE) {
        const chunk = toUpdate.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const { apiRow, dbRow } = chunk[j];
          const base = j * ALL_UPD_COLS.length;
          const placeholders = ALL_UPD_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${UPD_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);

          values.push(
            dbRow.id,
            apiRow.modified_date, apiRow.guest_name, apiRow.guest_contact, apiRow.passenger_name,
            apiRow.nationality, apiRow.agent_name, apiRow.airport_name, apiRow.flight_no,
            apiRow.profit_center, apiRow.status, apiRow.selling_price
          );

          const phoneChanged = (apiRow.guest_contact || null) !== (dbRow.guest_contact || null);
          const emailChanged = (apiRow.grnty_email || null) !== (dbRow.grnty_email || null);
          if ((phoneChanged || emailChanged) && dbRow.unified_id) {
            contactChanges.push({
              unified_id: dbRow.unified_id,
              newPhone: phoneChanged ? apiRow.guest_contact : null,
              newEmail: emailChanged ? apiRow.grnty_email : null,
            });
          }
        }

        const setClause = UPDATE_FIELDS.map(c => `${c} = v.${c}`).join(', ');
        await query(`
          UPDATE rayna_flights AS t SET ${setClause}, synced_at = NOW()
          FROM (VALUES ${rowClauses.join(', ')}) AS v(${ALL_UPD_COLS.join(', ')})
          WHERE t.id = v.id
        `, values);

        updated += chunk.length;
        if (updated % 5000 < this.BATCH_SIZE) {
          console.log(`[Flights Daily] Updated ${updated}/${toUpdate.length}...`);
        }
      }

      // ── Phase 5: Batch INSERT ──
      const INSERT_COLS = ['billno', 'bill_date', 'modified_date', 'guest_name', 'guest_contact',
        'passenger_name', 'nationality', 'agent_name', 'airport_name', 'flight_no',
        'from_datetime', 'profit_center', 'grnty_email', 'status', 'selling_price'];
      const INS_TYPES = ['text', 'timestamptz', 'timestamptz', 'text', 'text',
        'text', 'text', 'text', 'text', 'text',
        'timestamptz', 'text', 'text', 'text', 'numeric'];

      const allInserted = [];

      for (let i = 0; i < toInsert.length; i += this.BATCH_SIZE) {
        const chunk = toInsert.slice(i, i + this.BATCH_SIZE);
        const values = [];
        const rowClauses = [];

        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const base = j * INSERT_COLS.length;
          const placeholders = INSERT_COLS.map((_, ci) => {
            const p = `$${base + ci + 1}`;
            return j === 0 ? `${p}::${INS_TYPES[ci]}` : p;
          });
          rowClauses.push(`(${placeholders.join(', ')})`);
          INSERT_COLS.forEach(col => values.push(row[col] ?? null));
        }

        const conflictCols = INSERT_COLS.filter(c => !['billno', 'passenger_name', 'flight_no'].includes(c));
        const { rows: returnedRows } = await query(`
          INSERT INTO rayna_flights (${INSERT_COLS.join(', ')})
          VALUES ${rowClauses.join(', ')}
          ON CONFLICT (billno, passenger_name, flight_no) DO UPDATE SET
            ${conflictCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, synced_at = NOW()
          RETURNING id, guest_contact, grnty_email, guest_name, country_name, profit_center, bill_date
        `, values);

        allInserted.push(...returnedRows);
        inserted += chunk.length;
        if (inserted % 5000 < this.BATCH_SIZE) {
          console.log(`[Flights Daily] Inserted ${inserted}/${toInsert.length}...`);
        }
      }

      // ── Phase 6: Link inserts to unified_contacts ──
      if (allInserted.length > 0) {
        console.log(`[Flights Daily] Linking ${allInserted.length} new rows to unified_contacts...`);

        const insertMeta = allInserted.map(row => {
          const phoneDigits = row.guest_contact
            ? row.guest_contact.replace(/[^0-9]/g, '').slice(-10)
            : null;
          const emailKey = row.grnty_email
            ? row.grnty_email.trim().toLowerCase()
            : null;
          const validPhone = phoneDigits && phoneDigits.length >= 7 && !/^0+$/.test(phoneDigits);
          return { ...row, phoneKey: validPhone ? phoneDigits : null, emailKey };
        });

        const allPhoneKeys = [...new Set(insertMeta.map(m => m.phoneKey).filter(Boolean))];
        const allEmailKeys = [...new Set(insertMeta.map(m => m.emailKey).filter(Boolean))];

        const ucByPhone = new Map();
        const ucByEmail = new Map();

        if (allPhoneKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, phone_key FROM unified_contacts WHERE phone_key = ANY($1)`,
            [allPhoneKeys]
          );
          for (const r of rows) ucByPhone.set(r.phone_key, r.unified_id);
        }
        if (allEmailKeys.length > 0) {
          const { rows } = await query(
            `SELECT unified_id, email_key FROM unified_contacts WHERE email_key = ANY($1)`,
            [allEmailKeys]
          );
          for (const r of rows) ucByEmail.set(r.email_key, r.unified_id);
        }

        const flightToUC = new Map();
        const unmatched = [];

        for (const meta of insertMeta) {
          let uid = null;
          if (meta.phoneKey) uid = ucByPhone.get(meta.phoneKey);
          if (!uid && meta.emailKey) uid = ucByEmail.get(meta.emailKey);

          if (uid) {
            flightToUC.set(meta.id, uid);
          } else if (meta.phoneKey || meta.emailKey) {
            unmatched.push(meta);
          }
        }

        if (unmatched.length > 0) {
          const seenNewUC = new Map();
          const toCreateUC = [];

          for (const meta of unmatched) {
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            if (!seenNewUC.has(dk)) {
              seenNewUC.set(dk, null);
              toCreateUC.push(meta);
            }
          }

          for (let i = 0; i < toCreateUC.length; i += this.BATCH_SIZE) {
            const chunk = toCreateUC.slice(i, i + this.BATCH_SIZE);
            const UC_COLS = ['phone_key', 'phone', 'email_key', 'email', 'name', 'country',
              'sources', 'first_seen_at', 'total_flight_bookings', 'first_booking_at',
              'business_type', 'contact_type'];
            const UC_TYPES = ['text', 'text', 'text', 'text', 'text', 'text',
              'text', 'timestamptz', 'int', 'timestamptz', 'text', 'text'];

            const values = [];
            const rowClauses = [];

            for (let j = 0; j < chunk.length; j++) {
              const meta = chunk[j];
              const isB2B = meta.profit_center && /b2b/i.test(meta.profit_center);
              const bType = isB2B ? 'B2B' : 'B2C';
              const base = j * UC_COLS.length;
              const placeholders = UC_COLS.map((_, ci) => {
                const p = `$${base + ci + 1}`;
                return j === 0 ? `${p}::${UC_TYPES[ci]}` : p;
              });
              rowClauses.push(`(${placeholders.join(', ')})`);

              values.push(
                meta.phoneKey, meta.guest_contact, meta.emailKey, meta.grnty_email,
                meta.guest_name, meta.country_name, 'rayna', meta.bill_date,
                1, meta.bill_date, bType, bType
              );
            }

            const { rows: newRows } = await query(`
              INSERT INTO unified_contacts (${UC_COLS.join(', ')})
              VALUES ${rowClauses.join(', ')}
              RETURNING unified_id, phone_key, email_key
            `, values);

            for (const r of newRows) {
              const dk = r.phone_key ? `p:${r.phone_key}` : `e:${r.email_key}`;
              seenNewUC.set(dk, r.unified_id);
              if (r.phone_key) ucByPhone.set(r.phone_key, r.unified_id);
              if (r.email_key) ucByEmail.set(r.email_key, r.unified_id);
            }
            contactsCreated += newRows.length;
          }

          for (const meta of unmatched) {
            if (flightToUC.has(meta.id)) continue;
            const dk = meta.phoneKey ? `p:${meta.phoneKey}` : `e:${meta.emailKey}`;
            const uid = seenNewUC.get(dk);
            if (uid) flightToUC.set(meta.id, uid);
          }
        }

        const linkEntries = [...flightToUC.entries()];
        for (let i = 0; i < linkEntries.length; i += this.BATCH_SIZE) {
          const chunk = linkEntries.slice(i, i + this.BATCH_SIZE);
          const flightIds = chunk.map(([tid]) => tid);
          const ucIds = chunk.map(([, uid]) => uid);
          await query(`
            UPDATE rayna_flights AS t SET unified_id = v.uid
            FROM unnest($1::int[], $2::bigint[]) AS v(tid, uid)
            WHERE t.id = v.tid
          `, [flightIds, ucIds]);
        }

        console.log(`[Flights Daily] Linked ${flightToUC.size} inserts to unified_contacts (${contactsCreated} new contacts created)`);
      }

      // ── Phase 7: Update unified_contacts for changed contacts ──
      if (contactChanges.length > 0) {
        console.log(`[Flights Daily] Updating ${contactChanges.length} unified_contacts with changed contact info...`);
        for (const { unified_id, newPhone, newEmail } of contactChanges) {
          const updates = [];
          const vals = [];
          let idx = 1;

          if (newEmail) {
            updates.push(`email = $${idx}, email_key = LOWER(TRIM($${idx}))`);
            vals.push(newEmail);
            idx++;
          }
          if (newPhone) {
            updates.push(`phone = $${idx}`);
            vals.push(newPhone);
            idx++;
            updates.push(`phone_key = RIGHT(REGEXP_REPLACE($${idx},'[^0-9]','','g'), 10)`);
            vals.push(newPhone);
            idx++;
          }
          if (updates.length > 0) {
            updates.push(`updated_at = NOW()`);
            vals.push(unified_id);
            await query(`UPDATE unified_contacts SET ${updates.join(', ')} WHERE unified_id = $${idx}`, vals);
            contactsUpdated++;
          }
        }
      }

      const durationMs = Date.now() - startTime;
      await this.updateSyncMetadata('flights', { status: 'success', rowsSynced: updated + inserted, durationMs });

      console.log(`[Flights Daily] Done in ${(durationMs / 1000).toFixed(1)}s — updated: ${updated}, inserted: ${inserted}, contacts updated: ${contactsUpdated}, contacts created: ${contactsCreated}`);
      return { updated, inserted, totalFromAPI: rawRows.length, contactsUpdated, contactsCreated, durationMs };
    } catch (err) {
      console.error(`[Flights Daily] Failed:`, err.message);
      await this.updateSyncMetadata('flights', { status: 'error', error: err.message, durationMs: Date.now() - startTime });
      throw err;
    }
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
