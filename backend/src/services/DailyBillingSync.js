import { query, transaction } from '../config/database.js';
import { invalidate } from '../config/cache.js';

const API_URL = process.env.RAYNA_BILLING_API_URL
  || 'http://bdbizgulf.com/DataCenterAPI/api/BusinessProvider/GetDataAPIDetails';
const API_TOKEN = process.env.RAYNA_BILLING_API_TOKEN
  || 'cdddawVePfTxMPLoSYpGOE6TMwUf+IPzU39+5LGIEaivv9bmoKPC9w==';

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

const BATCH_SIZE = 500;

function getTable(billType) {
  return TABLE_MAP[(billType || '').trim().toLowerCase()] || 'rayna_others';
}

function mapRow(r) {
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

class DailyBillingSync {

  // ─── Main entry: fetch → upsert → update contacts ───────
  static async run() {
    const t0 = Date.now();
    console.log('[DailySync] Starting...');

    // 1. Fetch from API
    const records = await this.fetchFromAPI();
    if (!records || records.length === 0) {
      console.log('[DailySync] No records from API');
      return { fetched: 0, upserted: {}, newContacts: 0, durationMs: Date.now() - t0 };
    }

    // 2. Upsert into rayna tables
    const upserted = await this.upsertRecords(records);

    // 3. Incremental unified_contacts update
    const newContacts = await this.incrementalContactUpdate();

    // 4. Snapshot daily segment counts
    //    NO try/catch — failure must propagate so the retry cron re-runs the full pipeline.
    //    (Steps 1-3 are idempotent, so re-running them is safe.)
    const { default: UnifiedContactService } = await import('./UnifiedContactService.js');
    const snapshot = await UnifiedContactService.snapshotDailySegments();
    console.log(`[DailySync] Snapshot: ${snapshot.segments} segments logged`);

    // 5. Invalidate dashboard caches so the UI sees fresh data immediately
    //    This is non-critical (cache expires in 30 min anyway), so swallow errors.
    try {
      await invalidate('dashboard:*');
      console.log('[DailySync] Dashboard caches invalidated');
    } catch (err) {
      console.error('[DailySync] Cache invalidation failed:', err.message);
    }

    const ms = Date.now() - t0;
    console.log(`[DailySync] Done in ${(ms / 1000).toFixed(1)}s — ${records.length} fetched, ${newContacts} new contacts`);
    return { fetched: records.length, upserted, newContacts, durationMs: ms };
  }

  // ─── 1. Fetch yesterday's data from Rayna API ───────────
  static async fetchFromAPI() {
    console.log('[DailySync] Fetching from API...');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiname: 'getallyesterdaybookingdatedata',
        token: API_TOKEN,
      }),
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    console.log(`[DailySync] Fetched ${data.length} records`);
    return data;
  }

  // ─── 2. Upsert records into rayna tables ─────────────────
  static async upsertRecords(records) {
    console.log(`[DailySync] Upserting ${records.length} records...`);

    // Group by table
    const buckets = {};
    for (const r of records) {
      const table = getTable(r.BillType);
      if (!buckets[table]) buckets[table] = [];
      buckets[table].push(mapRow(r));
    }

    const results = {};
    for (const [table, rows] of Object.entries(buckets)) {
      let upserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        await transaction(async (client) => {
          await this.upsertBatch(client, table, batch);
        });
        upserted += batch.length;
      }
      results[table] = upserted;
      console.log(`[DailySync]   ${table}: ${upserted} upserted`);
    }

    return results;
  }

  // ─── Upsert a batch using ON CONFLICT ────────────────────
  static async upsertBatch(client, tableName, rows) {
    if (rows.length === 0) return;

    const updateCols = COLUMNS.filter(c => c !== 'service_id' && c !== 'bill_serial');
    const updateSet = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');

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

    const sql = `
      INSERT INTO ${tableName} (${COLUMNS.join(', ')})
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT (service_id, bill_serial)
      DO UPDATE SET ${updateSet}, updated_date = NOW()
    `;
    await client.query(sql, values);
  }

  // ─── 3. Incremental unified_contacts update ──────────────
  static async incrementalContactUpdate() {
    console.log('[DailySync] Updating unified_contacts incrementally...');

    // 3A: Insert new email-based contacts not already in unified_contacts
    const emailResult = await query(`
      INSERT INTO unified_contacts (email, mobile, name, country, sources, contact_type,
        wa_unsubscribe, email_unsubscribe)
      SELECT
        new.email, new.mobile, new.name, new.country, new.sources, new.contact_type,
        'no', 'no'
      FROM (
        SELECT
          LOWER(TRIM(guest_email)) AS email,
          MIN(guest_contact) FILTER (WHERE TRIM(guest_contact) <> '' AND guest_contact !~ '^0+$' AND guest_contact <> '-' AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7) AS mobile,
          MIN(guest_name) FILTER (WHERE TRIM(guest_name) <> '') AS name,
          MIN(nationality) FILTER (WHERE TRIM(nationality) <> '' AND nationality <> 'N/A') AS country,
          STRING_AGG(DISTINCT src, ',' ORDER BY src) AS sources,
          CASE WHEN MAX(b2b) = 1 THEN 'B2B' ELSE 'B2C' END AS contact_type
        FROM (
          SELECT guest_email, guest_contact, guest_name, nationality, 'tours' AS src, CASE WHEN is_b2b='1' THEN 1 ELSE 0 END AS b2b FROM rayna_tours WHERE unified_id IS NULL AND TRIM(COALESCE(guest_email,'')) <> '' AND guest_email LIKE '%@%'
          UNION ALL
          SELECT guest_email, guest_contact, guest_name, nationality, 'packages', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_packages WHERE unified_id IS NULL AND TRIM(COALESCE(guest_email,'')) <> '' AND guest_email LIKE '%@%'
          UNION ALL
          SELECT guest_email, guest_contact, guest_name, nationality, 'hotels', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_hotels WHERE unified_id IS NULL AND TRIM(COALESCE(guest_email,'')) <> '' AND guest_email LIKE '%@%'
          UNION ALL
          SELECT guest_email, guest_contact, guest_name, nationality, 'visas', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_visas WHERE unified_id IS NULL AND TRIM(COALESCE(guest_email,'')) <> '' AND guest_email LIKE '%@%'
          UNION ALL
          SELECT guest_email, guest_contact, guest_name, nationality, 'others', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_others WHERE unified_id IS NULL AND TRIM(COALESCE(guest_email,'')) <> '' AND guest_email LIKE '%@%'
        ) t
        GROUP BY LOWER(TRIM(guest_email))
      ) new
      WHERE NOT EXISTS (
        SELECT 1 FROM unified_contacts uc WHERE uc.email = new.email
      )
    `);
    const newEmails = emailResult.rowCount || 0;

    // 3B: Insert new phone-only contacts
    const phoneResult = await query(`
      INSERT INTO unified_contacts (mobile, name, country, sources, contact_type,
        wa_unsubscribe, email_unsubscribe)
      SELECT
        new.mobile, new.name, new.country, new.sources, new.contact_type,
        'no', 'no'
      FROM (
        SELECT
          RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) AS mobile,
          MIN(guest_name) FILTER (WHERE TRIM(guest_name) <> '') AS name,
          MIN(nationality) FILTER (WHERE TRIM(nationality) <> '' AND nationality <> 'N/A') AS country,
          STRING_AGG(DISTINCT src, ',' ORDER BY src) AS sources,
          CASE WHEN MAX(b2b) = 1 THEN 'B2B' ELSE 'B2C' END AS contact_type
        FROM (
          SELECT guest_contact, guest_name, nationality, 'tours' AS src, CASE WHEN is_b2b='1' THEN 1 ELSE 0 END AS b2b FROM rayna_tours WHERE unified_id IS NULL AND (TRIM(COALESCE(guest_email,''))='' OR guest_email NOT LIKE '%@%') AND TRIM(COALESCE(guest_contact,''))<>'' AND guest_contact<>'-' AND guest_contact !~ '^0+$' AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'))>=7
          UNION ALL
          SELECT guest_contact, guest_name, nationality, 'packages', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_packages WHERE unified_id IS NULL AND (TRIM(COALESCE(guest_email,''))='' OR guest_email NOT LIKE '%@%') AND TRIM(COALESCE(guest_contact,''))<>'' AND guest_contact<>'-' AND guest_contact !~ '^0+$' AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'))>=7
          UNION ALL
          SELECT guest_contact, guest_name, nationality, 'hotels', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_hotels WHERE unified_id IS NULL AND (TRIM(COALESCE(guest_email,''))='' OR guest_email NOT LIKE '%@%') AND TRIM(COALESCE(guest_contact,''))<>'' AND guest_contact<>'-' AND guest_contact !~ '^0+$' AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'))>=7
          UNION ALL
          SELECT guest_contact, guest_name, nationality, 'visas', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_visas WHERE unified_id IS NULL AND (TRIM(COALESCE(guest_email,''))='' OR guest_email NOT LIKE '%@%') AND TRIM(COALESCE(guest_contact,''))<>'' AND guest_contact<>'-' AND guest_contact !~ '^0+$' AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'))>=7
          UNION ALL
          SELECT guest_contact, guest_name, nationality, 'others', CASE WHEN is_b2b='1' THEN 1 ELSE 0 END FROM rayna_others WHERE unified_id IS NULL AND (TRIM(COALESCE(guest_email,''))='' OR guest_email NOT LIKE '%@%') AND TRIM(COALESCE(guest_contact,''))<>'' AND guest_contact<>'-' AND guest_contact !~ '^0+$' AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'))>=7
        ) t
        GROUP BY RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10)
      ) new
      WHERE NOT EXISTS (
        SELECT 1 FROM unified_contacts uc WHERE uc.mobile = new.mobile
      )
    `);
    const newPhones = phoneResult.rowCount || 0;

    // 3C: Link unlinked rayna rows to unified_contacts
    const tables = ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_others', 'rayna_flights'];
    for (const tbl of tables) {
      await query(`
        UPDATE ${tbl} rt SET unified_id = uc.id
        FROM unified_contacts uc
        WHERE LOWER(TRIM(rt.guest_email)) = uc.email
          AND uc.email IS NOT NULL AND rt.unified_id IS NULL
      `);
      await query(`
        UPDATE ${tbl} rt SET unified_id = uc.id
        FROM unified_contacts uc
        WHERE RIGHT(REGEXP_REPLACE(rt.guest_contact,'[^0-9]','','g'), 10) = uc.mobile
          AND uc.mobile IS NOT NULL AND rt.unified_id IS NULL
      `);
    }

    // 3D: Collect affected unified_ids (records updated today)
    const { rows: affected } = await query(`
      SELECT DISTINCT unified_id FROM (
        ${tables.filter(t => t !== 'rayna_flights').map(t =>
          `SELECT unified_id FROM ${t} WHERE unified_id IS NOT NULL AND (created_at >= CURRENT_DATE OR updated_date >= CURRENT_DATE)`
        ).join(' UNION ALL ')}
      ) t
    `);
    const affectedIds = affected.map(r => r.unified_id);
    console.log(`[DailySync]   Affected contacts for segmentation: ${affectedIds.length}`);

    // 3E: Recompute segmentation for ALL contacts (not just affected)
    // because time-sensitive statuses (ON_TRIP, FUTURE_TRAVEL) expire daily
    await this.recomputeSegmentation(null);

    const total = newEmails + newPhones;
    console.log(`[DailySync]   New contacts: ${total} (${newEmails} email, ${newPhones} phone)`);
    return total;
  }

  // ─── Recompute segmentation for affected contacts only ──
  static async recomputeSegmentation(affectedIds) {
    const tables = ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_others'];

    // Get the set of unified_ids that were touched today
    // (either newly linked or had records upserted)
    const idFilter = affectedIds && affectedIds.length > 0
      ? `AND uc.id = ANY($1)`
      : '';
    const idParam = affectedIds && affectedIds.length > 0 ? [affectedIds] : [];

    // booking_status — only for affected contacts
    await query(`
      UPDATE unified_contacts uc SET booking_status = sub.status
      FROM (
        WITH bookings AS (
          SELECT unified_id,
            bool_or(is_cancel <> '1' AND td BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE) AS on_trip,
            bool_or(is_cancel <> '1' AND td > CURRENT_DATE) AS future_travel,
            bool_or(is_cancel <> '1') AS has_valid,
            bool_or(is_cancel = '1') AS has_cancelled
          FROM (
            ${tables.map(t => `
              SELECT unified_id, is_cancel,
                CASE WHEN travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN travel_date::date ELSE NULL END AS td
              FROM ${t} WHERE unified_id IS NOT NULL
            `).join(' UNION ALL ')}
          ) all_bookings
          ${affectedIds?.length ? `WHERE unified_id = ANY($1)` : ''}
          GROUP BY unified_id
        )
        SELECT unified_id,
          CASE
            WHEN on_trip THEN 'ON_TRIP'
            WHEN future_travel THEN 'FUTURE_TRAVEL'
            WHEN has_valid THEN 'PAST_BOOKING'
            WHEN has_cancelled THEN 'CANCELLED'
            ELSE 'PROSPECT'
          END AS status
        FROM bookings
      ) sub
      WHERE uc.id = sub.unified_id
    `, idParam);

    // Set new contacts without bookings as PROSPECT
    if (affectedIds?.length) {
      await query(`UPDATE unified_contacts SET booking_status = 'PROSPECT' WHERE booking_status IS NULL AND id = ANY($1)`, [affectedIds]);
    } else {
      await query(`UPDATE unified_contacts SET booking_status = 'PROSPECT' WHERE booking_status IS NULL`);
    }

    // product_tier
    const luxuryKw = ['premium','private','vip','yacht','helicopter','limousine','luxury','megayacht','falcon','chauffeur'];
    const luxuryPattern = luxuryKw.map(k => `service_name ILIKE '%${k}%'`).join(' OR ');
    await query(`
      UPDATE unified_contacts uc SET product_tier = sub.tier
      FROM (
        SELECT unified_id,
          CASE WHEN bool_or(${luxuryPattern}) THEN 'LUXURY' ELSE 'STANDARD' END AS tier
        FROM (
          ${tables.map(t => `SELECT unified_id, service_name, is_cancel FROM ${t} WHERE unified_id IS NOT NULL`).join(' UNION ALL ')}
        ) linked
        WHERE is_cancel <> '1' ${affectedIds?.length ? `AND unified_id = ANY($1)` : ''}
        GROUP BY unified_id
      ) sub
      WHERE uc.id = sub.unified_id
    `, idParam);

    // geography + is_indian — only affected
    if (affectedIds?.length) {
      await query(`
        UPDATE unified_contacts SET
          geography = CASE
            WHEN UPPER(TRIM(country)) IN ('UNITED ARAB EMIRATES','UAE') THEN 'LOCAL'
            WHEN TRIM(COALESCE(country,'')) <> '' AND UPPER(TRIM(country)) NOT IN ('N/A','NA','') THEN 'INTERNATIONAL'
            ELSE NULL
          END,
          is_indian = (
            COALESCE(mobile,'') LIKE '91%' OR COALESCE(mobile,'') LIKE '+91%'
            OR UPPER(TRIM(COALESCE(country,''))) = 'INDIA'
          )
        WHERE id = ANY($1)
      `, [affectedIds]);
      await query(`
        UPDATE unified_contacts SET segments = CONCAT_WS(' / ',
          booking_status, product_tier, geography,
          CASE WHEN is_indian THEN 'INDIAN' END
        ) WHERE id = ANY($1)
      `, [affectedIds]);
    } else {
      await query(`
        UPDATE unified_contacts SET
          geography = CASE
            WHEN UPPER(TRIM(country)) IN ('UNITED ARAB EMIRATES','UAE') THEN 'LOCAL'
            WHEN TRIM(COALESCE(country,'')) <> '' AND UPPER(TRIM(country)) NOT IN ('N/A','NA','') THEN 'INTERNATIONAL'
            ELSE NULL
          END,
          is_indian = (
            COALESCE(mobile,'') LIKE '91%' OR COALESCE(mobile,'') LIKE '+91%'
            OR UPPER(TRIM(COALESCE(country,''))) = 'INDIA'
          )
      `);
      await query(`
        UPDATE unified_contacts SET segments = CONCAT_WS(' / ',
          booking_status, product_tier, geography,
          CASE WHEN is_indian THEN 'INDIAN' END
        )
      `);
    }
  }
}

export default DailyBillingSync;
