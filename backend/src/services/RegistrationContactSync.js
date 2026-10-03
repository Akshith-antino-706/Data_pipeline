/**
 * RegistrationContactSync
 *
 * Brings website registrations into unified_contacts:
 *   affiliate_data → Affiliate
 *   agent_data     → B2B
 *   guestuser_data → B2C
 *
 * Each registration is linked to an existing contact — by email, then by mobile
 * (mobile only when the registration or the contact has no email, so two people
 * sharing an office phone are never merged). Registrations with no match become new
 * contacts, one per email / mobile / row, with the same raw values the other syncs
 * store; the 1:30 AM enrichment job then fills actual_email / actual_mobile /
 * mobile_country, and the 1:00 AM billing sync links their bookings.
 * The contact id is written back to the registration row's unified_id.
 *
 * Type precedence: Affiliate > B2B > B2C.
 *   - an affiliate registration always makes the contact Affiliate
 *   - an agent registration makes a B2C (or untyped) contact B2B
 *   - a guest registration only types a contact that has no type yet
 * Contacts that already exist keep their name / country / city; blanks are filled.
 *
 * Modes:
 *   full: true  → every registration row (one-time backfill, and after a contacts rebuild)
 *   default     → rows not linked yet, or added / edited by the registration sync in
 *                 the last 2 days (the daily run right after the 00:30 registration sync)
 *   dryRun      → do everything in a transaction, report the counts, roll back
 */
import db from '../config/database.js';
import DailyBillingSync from './DailyBillingSync.js';

const SYNC_KEY = 'registration_contacts_sync';
const RECENT_DAYS = 2;

// Registration tables store every value as text, with empty values as the text 'NULL'.
const nz = col => `NULLIF(NULLIF(TRIM(${col}), 'NULL'), '')`;
const email = col => `CASE WHEN ${nz(col)} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' THEN LOWER(${nz(col)}) END`;
// A phone number is usable when it has 7–15 digits and isn't all zeros.
const phoneOk = col => `(LENGTH(REGEXP_REPLACE(COALESCE(${col}, ''), '[^0-9]', '', 'g')) BETWEEN 7 AND 15
  AND REGEXP_REPLACE(${col}, '[^0-9]', '', 'g') !~ '^0+$')`;
const regDate = col => `CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(${col}, 19)::timestamp END`;

// One row per registration: who it is and what type it brings.
const SOURCES = [
  {
    table: 'affiliate_data', rank: 3, tag: 'affiliate',
    email: email('"email"'),
    mobile: 'NULL::text',
    name: nz('"affiliateName"'),
    country: nz('"countryName"'),
    city: nz('"cityName"'),
    regDate: regDate('"registrationDate"'),
  },
  {
    table: 'agent_data', rank: 2, tag: 'agent',
    email: email('"email"'),
    mobile: `CASE WHEN ${phoneOk(nz('"MobileNo"'))} THEN ${nz('"MobileNo"')}
                  WHEN ${phoneOk(nz('"PhoneNo"'))} THEN ${nz('"PhoneNo"')} END`,
    name: `COALESCE(${nz('"AgentName"')}, ${nz('"CompanyName"')})`,
    country: 'NULL::text',
    city: 'NULL::text',
    regDate: regDate('"registrationDate"'),
  },
  {
    table: 'guestuser_data', rank: 1, tag: 'guestuser',
    email: email('"email"'),
    // Add the ISD code when the number doesn't carry one yet, e.g. 971 + 501234567 → '+971 501234567'
    mobile: `CASE WHEN ${phoneOk(nz('"mobileNo"'))} THEN
               CASE WHEN ${nz('"isdCode"')} ~ '^\\d{1,4}$'
                     AND LENGTH(REGEXP_REPLACE("mobileNo", '[^0-9]', '', 'g')) <= 10
                     AND REGEXP_REPLACE("mobileNo", '[^0-9]', '', 'g') NOT LIKE ${nz('"isdCode"')} || '%'
                    THEN '+' || ${nz('"isdCode"')} || ' ' || ${nz('"mobileNo"')}
                    ELSE ${nz('"mobileNo"')} END END`,
    name: `NULLIF(${nz('"guestName"')}, '#NAME?')`,
    country: nz('"countryName"'),
    city: 'NULL::text',
    regDate: regDate('"registrationDate"'),
  },
];

const TYPE_FOR_RANK = `CASE MAX(rank) WHEN 3 THEN 'Affiliate' WHEN 2 THEN 'B2B' ELSE 'B2C' END`;
// The value preferred by the strongest, then most recent, registration.
const best = col => `(ARRAY_AGG(${col} ORDER BY rank DESC, reg_date DESC NULLS LAST) FILTER (WHERE ${col} IS NOT NULL))[1]`;

let running = false;

export default class RegistrationContactSync {
  static isRunning() { return running; }

  /**
   * @param {{ full?: boolean, dryRun?: boolean }} opts
   * @returns {Promise<object>} counts of what was (or, in a dry run, would be) done
   */
  static async run({ full = false, dryRun = false } = {}) {
    if (running) return { skipped: true, reason: 'already running' };
    running = true;
    const started = Date.now();
    const client = await db.connect();
    let result;
    try {
      await client.query('BEGIN');
      const { rows: [lock] } = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok`, [SYNC_KEY]);
      if (!lock.ok) {
        await client.query('ROLLBACK');
        return { skipped: true, reason: 'another server is running it' };
      }

      result = await this._sync(client, { full });
      await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[RegistrationContacts] Failed:', err.message);
      if (!dryRun) await this._writeStatus('error', 0, Date.now() - started, err.message);
      throw err;
    } finally {
      client.release();
      running = false;
    }

    // Segments, geography and the Indian flag for every contact this run created or changed.
    if (!dryRun && result.touchedIds.length) {
      await DailyBillingSync.recomputeSegmentation(result.touchedIds);
    }

    const { touchedIds, ...counts } = result;
    const summary = { mode: full ? 'full' : 'recent', dryRun, ...counts, touched: touchedIds.length, durationMs: Date.now() - started };
    console.log(`[RegistrationContacts] ${dryRun ? 'DRY RUN ' : ''}done:`, JSON.stringify(summary));
    if (!dryRun) await this._writeStatus('success', counts.created + counts.updated, summary.durationMs, null);
    return summary;
  }

  static async _sync(client, { full }) {
    const q = (sql, params) => client.query(sql, params);

    // Stray spellings ('b2b', 'b2c', 'affiliate') → the stored values, so filters match them.
    const { rowCount: normalized } = await q(`
      UPDATE unified_contacts
      SET contact_type = CASE LOWER(TRIM(contact_type)) WHEN 'b2b' THEN 'B2B' WHEN 'b2c' THEN 'B2C' ELSE 'Affiliate' END
      WHERE LOWER(TRIM(contact_type)) IN ('b2b', 'b2c', 'affiliate')
        AND contact_type NOT IN ('B2B', 'B2C', 'Affiliate')
    `);

    // 1. The registrations to process
    const recent = full ? '' : `WHERE unified_id IS NULL OR synced_at >= NOW() - INTERVAL '${RECENT_DAYS} days'`;
    await q(`
      CREATE TEMP TABLE _rc ON COMMIT DROP AS
      ${SOURCES.map(s => `
        SELECT '${s.table}'::text AS tbl, id AS row_id, unified_id, ${s.rank} AS rank, '${s.tag}'::text AS tag,
               ${s.email} AS email, ${s.mobile} AS mobile, ${s.name} AS name,
               ${s.country} AS country, ${s.city} AS city, ${s.regDate} AS reg_date
        FROM ${s.table} ${recent}`).join(' UNION ALL ')}
    `);
    await q(`
      ALTER TABLE _rc ADD COLUMN mob10 TEXT, ADD COLUMN uid BIGINT, ADD COLUMN gkey TEXT;
      UPDATE _rc SET mob10 = RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) WHERE mobile IS NOT NULL;
    `);
    const { rows: [{ n: processed }] } = await q(`SELECT COUNT(*)::int AS n FROM _rc`);

    // 2. Link to contacts: existing link → email → mobile
    await q(`
      UPDATE _rc r SET uid = r.unified_id
      WHERE r.unified_id IS NOT NULL AND EXISTS (SELECT 1 FROM unified_contacts uc WHERE uc.id = r.unified_id)
    `);
    const { rowCount: byEmail } = await q(`
      UPDATE _rc r SET uid = m.id
      FROM (
        SELECT LOWER(TRIM(email)) AS em, MIN(id) AS id
        FROM unified_contacts
        WHERE LOWER(TRIM(email)) IN (SELECT email FROM _rc WHERE uid IS NULL AND email IS NOT NULL)
        GROUP BY 1
      ) m
      WHERE r.uid IS NULL AND r.email = m.em
    `);
    let byMobile = 0;
    const { rows: [{ n: needMobile }] } = await q(`SELECT COUNT(*)::int AS n FROM _rc WHERE uid IS NULL AND mob10 IS NOT NULL`);
    if (needMobile) {
      ({ rowCount: byMobile } = await q(`
        UPDATE _rc r SET uid = m.id
        FROM (
          SELECT DISTINCT ON (m10) m10, has_email, id
          FROM (
            SELECT RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) AS m10,
                   COALESCE(TRIM(email), '') <> '' AS has_email, id
            FROM unified_contacts
            WHERE mobile IS NOT NULL AND LENGTH(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g')) >= 7
          ) c
          WHERE m10 IN (SELECT mob10 FROM _rc WHERE uid IS NULL AND mob10 IS NOT NULL)
          ORDER BY m10, has_email, id   -- an email-less contact first: any registration may join it
        ) m
        WHERE r.uid IS NULL AND r.mob10 = m.m10
          AND (r.email IS NULL OR NOT m.has_email)
      `));
    }

    // 3. New contacts — one per email, else per mobile, else per registration row
    await q(`
      UPDATE _rc SET gkey = COALESCE(email, 'm:' || mob10, tbl || ':' || row_id) WHERE uid IS NULL;
      CREATE TEMP TABLE _rc_new ON COMMIT DROP AS
        SELECT gkey, NEXTVAL('unified_contacts_id_seq') AS id FROM (SELECT DISTINCT gkey FROM _rc WHERE uid IS NULL) g;
    `);
    const { rowCount: created } = await q(`
      INSERT INTO unified_contacts
        (id, email, mobile, name, country, city, sources, contact_type,
         wa_unsubscribe, email_unsubscribe, booking_status, synced_date, created_at, updated_at)
      SELECT n.id, g.email, g.mobile, g.name, g.country, g.city, g.sources, g.contact_type,
             'no', 'no', 'PROSPECT', NOW(), NOW(), NOW()
      FROM (
        SELECT gkey, MAX(email) AS email, ${best('mobile')} AS mobile, ${best('name')} AS name,
               ${best('country')} AS country, ${best('city')} AS city,
               STRING_AGG(DISTINCT tag, ',' ORDER BY tag) AS sources,
               ${TYPE_FOR_RANK} AS contact_type
        FROM _rc WHERE uid IS NULL GROUP BY gkey
      ) g
      JOIN _rc_new n ON n.gkey = g.gkey
    `);
    const { rows: createdByType } = await q(`
      SELECT contact_type AS type, COUNT(*)::int AS n FROM unified_contacts WHERE id IN (SELECT id FROM _rc_new) GROUP BY 1 ORDER BY 1
    `);
    await q(`UPDATE _rc r SET uid = n.id FROM _rc_new n WHERE r.uid IS NULL AND r.gkey = n.gkey`);

    // 4. Write the contact id back to the registration rows
    let linked = 0;
    for (const s of SOURCES) {
      const { rowCount } = await q(`
        UPDATE ${s.table} t SET unified_id = r.uid
        FROM _rc r
        WHERE r.tbl = '${s.table}' AND t.id = r.row_id AND t.unified_id IS DISTINCT FROM r.uid
      `);
      linked += rowCount;
    }

    // 5. Linked contacts: type by precedence, add the registration source, fill blanks.
    //    Every registration linked to the contact counts (not just this run's), and
    //    contacts sharing a registration's email get the same treatment — including
    //    ones created in step 3 (e.g. a guest's new contact whose email an agent,
    //    matched by mobile, also uses).
    await q(`
      CREATE TEMP TABLE _rc_target ON COMMIT DROP AS
      SELECT uid, MAX(rank) AS rank, STRING_AGG(DISTINCT tag, ',') AS tags,
             ${best('name')} AS name, ${best('country')} AS country, ${best('city')} AS city
      FROM (
        SELECT uid, rank, tag, name, country, city, reg_date FROM _rc
        UNION ALL
        SELECT uc.id, r.rank, r.tag, r.name, r.country, r.city, r.reg_date
        FROM _rc r JOIN unified_contacts uc ON LOWER(TRIM(uc.email)) = r.email
        WHERE r.email IS NOT NULL
        UNION ALL
        ${SOURCES.map(s => `
          SELECT unified_id, ${s.rank}, '${s.tag}', NULL, NULL, NULL, NULL::timestamp FROM ${s.table}
          WHERE unified_id IN (SELECT uid FROM _rc)`).join(' UNION ALL ')}
      ) x
      GROUP BY uid
    `);
    const { rows: typeChanges } = await q(`
      WITH next AS (
        SELECT uc.id, uc.contact_type AS old_type,
          CASE
            WHEN t.rank = 3 THEN 'Affiliate'
            WHEN t.rank = 2 AND uc.contact_type IS DISTINCT FROM 'Affiliate' THEN 'B2B'
            WHEN uc.contact_type IN ('B2B', 'B2C', 'Affiliate') THEN uc.contact_type
            ELSE 'B2C'
          END AS contact_type,
          (SELECT STRING_AGG(DISTINCT s, ',' ORDER BY s)
           FROM UNNEST(STRING_TO_ARRAY(COALESCE(uc.sources, ''), ',') || STRING_TO_ARRAY(t.tags, ',')) s
           WHERE TRIM(s) <> '') AS sources,
          COALESCE(NULLIF(TRIM(uc.name), ''), t.name) AS name,
          COALESCE(NULLIF(TRIM(uc.country), ''), t.country) AS country,
          COALESCE(NULLIF(TRIM(uc.city), ''), t.city) AS city
        FROM unified_contacts uc JOIN _rc_target t ON t.uid = uc.id
      ),
      changed AS (
        UPDATE unified_contacts uc
        SET contact_type = n.contact_type, sources = n.sources, name = n.name,
            country = n.country, city = n.city, updated_at = NOW()
        FROM next n
        WHERE uc.id = n.id
          AND (uc.contact_type IS DISTINCT FROM n.contact_type OR uc.sources IS DISTINCT FROM n.sources
               OR uc.name IS DISTINCT FROM n.name OR uc.country IS DISTINCT FROM n.country
               OR uc.city IS DISTINCT FROM n.city)
        RETURNING uc.id, n.old_type, n.contact_type
      )
      SELECT id, old_type, contact_type FROM changed
    `);

    const typeChangeCounts = {};
    for (const r of typeChanges) {
      if (r.old_type === r.contact_type) continue;
      const k = `${r.old_type ?? 'none'} → ${r.contact_type}`;
      typeChangeCounts[k] = (typeChangeCounts[k] || 0) + 1;
    }
    const { rows: newIds } = await q(`SELECT id FROM _rc_new`);

    return {
      processed,
      matchedByEmail: byEmail,
      matchedByMobile: byMobile,
      created,
      createdByType: Object.fromEntries(createdByType.map(r => [r.type, r.n])),
      updated: typeChanges.length,
      typeChanges: typeChangeCounts,
      registrationsLinked: linked,
      straySpellingsFixed: normalized,
      touchedIds: [...new Set([...newIds.map(r => r.id), ...typeChanges.map(r => r.id)])],
    };
  }

  static async _writeStatus(status, rows, durationMs, error) {
    try {
      await db.query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ($1, NOW(), $2, $3, $4, $5, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          last_synced_at   = EXCLUDED.last_synced_at,
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = EXCLUDED.sync_status,
          error_message    = EXCLUDED.error_message,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [SYNC_KEY, rows, status, error ? String(error).slice(0, 500) : null, durationMs]);
    } catch (err) {
      console.warn('[RegistrationContacts] sync_metadata write failed:', err.message);
    }
  }
}
