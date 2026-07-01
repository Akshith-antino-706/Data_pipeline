/**
 * PhpAdminWeeklySync
 *
 * Weekly cron that pulls NEW contacts from the source MySQL `contacts` table
 * (managed via phpMyAdmin, source label = 'phpadmin') into Postgres
 * `unified_contacts`.
 *
 * Schedule: Sundays 05:00 Asia/Dubai (registered in server.js).
 * Idempotent: only inserts rows whose LOWER(TRIM(email)) is NOT already in
 * unified_contacts. Uses `sync_metadata.last_synced_at` as a watermark so
 * every run after the first only scans MySQL rows created since the last
 * successful run — even if MySQL has millions of rows, an average week's
 * delta is small (~100 rows).
 *
 * Mapping (confirmed with product owner):
 *   email             ← LOWER(TRIM(email))
 *   mobile            ← TRIM(mobile)
 *   name              ← name
 *   country           ← country_name
 *   city              ← city
 *   contact_type      ← contact_type
 *   sources           ← 'phpadmin' (literal)
 *   booking_status    ← n_bookings > 0 ? PAST_BOOKING : PROSPECT
 *   product_tier      ← NULL (no source data for this)
 *   geography         ← country in ('UAE','United Arab Emirates') ? LOCAL : INTERNATIONAL
 *   is_indian         ← country ILIKE '%India%'
 *   segments          ← "{booking_status} / {geography}[ / INDIAN]"
 *   email_unsubscribe ← h_bounce > 0 ? 'Yes' : 'No'
 *   wa_unsubscribe    ← 'No'
 *   actual_email      ← raw email
 *   actual_mobile     ← raw mobile
 *   mobile_country    ← derived from mobile prefix (+971, +91, etc.)
 */

import mysql from 'mysql2/promise';
import db from '../config/database.js';

const SYNC_KEY = 'phpadmin_weekly_sync';

// Country-code prefix → country name for mobile_country derivation.
// Covers the top prefixes seen in Rayna's contact base. Fallback = null.
const MOBILE_PREFIX_MAP = [
  { prefix: '971', country: 'United Arab Emirates' },
  { prefix: '91',  country: 'India' },
  { prefix: '966', country: 'Saudi Arabia' },
  { prefix: '974', country: 'Qatar' },
  { prefix: '973', country: 'Bahrain' },
  { prefix: '968', country: 'Oman' },
  { prefix: '965', country: 'Kuwait' },
  { prefix: '44',  country: 'United Kingdom' },
  { prefix: '1',   country: 'United States' },
  { prefix: '61',  country: 'Australia' },
  { prefix: '65',  country: 'Singapore' },
  { prefix: '60',  country: 'Malaysia' },
  { prefix: '81',  country: 'Japan' },
  { prefix: '86',  country: 'China' },
  { prefix: '92',  country: 'Pakistan' },
  { prefix: '880', country: 'Bangladesh' },
  { prefix: '94',  country: 'Sri Lanka' },
  { prefix: '20',  country: 'Egypt' },
  { prefix: '27',  country: 'South Africa' },
  { prefix: '49',  country: 'Germany' },
  { prefix: '33',  country: 'France' },
  { prefix: '39',  country: 'Italy' },
  { prefix: '34',  country: 'Spain' },
];

function deriveMobileCountry(mobile) {
  if (!mobile) return null;
  const digits = String(mobile).replace(/[^0-9]/g, '');
  if (!digits) return null;
  // Try longest prefix first so '971' matches before '9'
  const sorted = [...MOBILE_PREFIX_MAP].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, country } of sorted) {
    if (digits.startsWith(prefix)) return country;
  }
  return null;
}

function deriveGeography(countryName) {
  if (!countryName) return null;
  const norm = countryName.trim().toLowerCase();
  if (norm === 'uae' || norm === 'united arab emirates') return 'LOCAL';
  return 'INTERNATIONAL';
}

function deriveIsIndian(countryName) {
  if (!countryName) return false;
  return /india/i.test(countryName);
}

function deriveSegments(bookingStatus, geography, isIndian) {
  const parts = [bookingStatus, geography].filter(Boolean);
  if (isIndian) parts.push('INDIAN');
  return parts.join(' / ');
}

async function readWatermark() {
  const { rows } = await db.query(
    `SELECT last_synced_at FROM sync_metadata WHERE table_name = $1`,
    [SYNC_KEY]
  );
  if (rows.length === 0) {
    await db.query(
      `INSERT INTO sync_metadata (table_name) VALUES ($1) ON CONFLICT DO NOTHING`,
      [SYNC_KEY]
    );
    return new Date('1970-01-01T00:00:00Z');
  }
  return new Date(rows[0].last_synced_at);
}

async function writeMetadata({ rowsSynced, durationMs, status, error, watermarkAdvance }) {
  await db.query(
    `INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (table_name) DO UPDATE SET
       last_synced_at   = EXCLUDED.last_synced_at,
       rows_synced      = EXCLUDED.rows_synced,
       sync_status      = EXCLUDED.sync_status,
       error_message    = EXCLUDED.error_message,
       sync_duration_ms = EXCLUDED.sync_duration_ms,
       updated_at       = NOW()`,
    [SYNC_KEY, watermarkAdvance, rowsSynced, status, error || null, durationMs]
  );
}

/**
 * Run one sync pass. Safe to call from cron OR manually via an admin endpoint.
 * Returns a summary object. Never throws — logs + writes error to sync_metadata.
 */
export async function runPhpAdminSync({ triggeredBy = 'cron' } = {}) {
  const start = Date.now();
  const runStartedAt = new Date();          // NOW at the top so we advance the watermark
                                            // to a moment BEFORE we started reading MySQL
                                            // (any inserts happening during the run get
                                            //  picked up on the next run — no misses).
  let conn = null;
  const summary = {
    triggeredBy,
    startedAt: runStartedAt.toISOString(),
    watermarkFrom: null,
    watermarkTo: null,
    mysqlRowsFetched: 0,
    alreadyInUnified: 0,
    newlyInserted: 0,
    durationMs: 0,
    status: 'success',
    error: null,
  };

  try {
    const watermark = await readWatermark();
    summary.watermarkFrom = watermark.toISOString();

    console.log(`[PhpAdminSync] Starting — watermark=${summary.watermarkFrom} triggeredBy=${triggeredBy}`);

    conn = await mysql.createConnection({
      host:     process.env.MYSQL_HOST,
      port:     parseInt(process.env.MYSQL_PORT || '3306'),
      user:     process.env.MYSQL_USER,
      password: process.env.MYSQL_PASS,
      database: process.env.MYSQL_DB,
      connectTimeout: 15000,
    });

    // Fetch contacts created since the watermark. First run (watermark=epoch)
    // scans ALL rows; subsequent runs scan only new deltas.
    const [rows] = await conn.query(
      `SELECT id, contact_type, name, email, mobile,
              city, country_name, n_bookings, h_bounce, created_at
         FROM contacts
        WHERE email IS NOT NULL
          AND email <> ''
          AND LENGTH(TRIM(email)) > 3
          AND (created_at > ? OR created_at IS NULL AND id > ?)
        ORDER BY id`,
      [watermark, 0]   // second placeholder reserved for id-fallback; kept simple for now
    );
    summary.mysqlRowsFetched = rows.length;
    console.log(`[PhpAdminSync] Fetched ${rows.length} MySQL rows since watermark`);

    if (rows.length === 0) {
      summary.durationMs = Date.now() - start;
      await writeMetadata({
        rowsSynced: 0,
        durationMs: summary.durationMs,
        status: 'success',
        error: null,
        watermarkAdvance: runStartedAt,
      });
      summary.watermarkTo = runStartedAt.toISOString();
      return summary;
    }

    // Dedupe within this batch by normalized email — MySQL can have duplicate rows
    const byEmail = new Map();
    for (const r of rows) {
      const key = String(r.email).toLowerCase().trim();
      if (!byEmail.has(key)) byEmail.set(key, r);
    }
    const uniqueRows = [...byEmail.values()];

    // Check which of these normalized emails are already in unified_contacts
    const emailKeys = [...byEmail.keys()];
    const already = new Set();
    const BATCH = 5000;
    for (let i = 0; i < emailKeys.length; i += BATCH) {
      const chunk = emailKeys.slice(i, i + BATCH);
      const { rows: existing } = await db.query(
        `SELECT DISTINCT LOWER(TRIM(email)) AS e FROM unified_contacts
          WHERE LOWER(TRIM(email)) = ANY($1)`,
        [chunk]
      );
      existing.forEach(r => already.add(r.e));
    }
    summary.alreadyInUnified = already.size;

    const toInsert = uniqueRows.filter(r => !already.has(String(r.email).toLowerCase().trim()));
    console.log(`[PhpAdminSync] ${uniqueRows.length} unique; ${already.size} already in unified; ${toInsert.length} new to insert`);

    // Insert new rows in batches
    const INS_BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += INS_BATCH) {
      const chunk = toInsert.slice(i, i + INS_BATCH);
      const values2 = [];
      const params2 = [];
      chunk.forEach((r, idx) => {
        const base = idx * 14;
        const rawEmail  = String(r.email);
        const email     = rawEmail.toLowerCase().trim();
        const rawMobile = r.mobile ? String(r.mobile) : null;
        const mobile    = rawMobile ? rawMobile.trim() : null;
        const bookingStatus = (parseInt(r.n_bookings) > 0) ? 'PAST_BOOKING' : 'PROSPECT';
        const geography = deriveGeography(r.country_name);
        const isIndian  = deriveIsIndian(r.country_name);
        const segments  = deriveSegments(bookingStatus, geography, isIndian);
        const emailUnsub = (parseInt(r.h_bounce) > 0) ? 'Yes' : 'No';
        const mobileCountry = deriveMobileCountry(mobile);

        values2.push(
          `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},'phpadmin',$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},'No',$${base+12},$${base+13},$${base+14})`
        );
        params2.push(
          email, mobile, r.name || null, r.country_name || null, r.city || null,
          r.contact_type || null, bookingStatus, geography, isIndian, segments,
          emailUnsub, rawEmail, rawMobile, mobileCountry
        );
      });

      const sql = `
        INSERT INTO unified_contacts (
          email, mobile, name, country, city,
          sources, contact_type, booking_status, geography, is_indian,
          segments, email_unsubscribe, wa_unsubscribe,
          actual_email, actual_mobile, mobile_country
        )
        VALUES ${values2.join(',')}
        ON CONFLICT DO NOTHING
      `;
      const res = await db.query(sql, params2);
      inserted += res.rowCount || 0;
    }
    summary.newlyInserted = inserted;

    summary.durationMs = Date.now() - start;
    await writeMetadata({
      rowsSynced: inserted,
      durationMs: summary.durationMs,
      status: 'success',
      error: null,
      watermarkAdvance: runStartedAt,
    });
    summary.watermarkTo = runStartedAt.toISOString();
    console.log(`[PhpAdminSync] Done — inserted=${inserted} duration=${summary.durationMs}ms`);
  } catch (err) {
    summary.durationMs = Date.now() - start;
    summary.status = 'error';
    summary.error = err.message;
    console.error('[PhpAdminSync] Failed:', err);
    await writeMetadata({
      rowsSynced: summary.newlyInserted,
      durationMs: summary.durationMs,
      status: 'error',
      error: err.message,
      watermarkAdvance: (await readWatermark()),   // do NOT advance on failure
    }).catch(() => {});
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
  return summary;
}
