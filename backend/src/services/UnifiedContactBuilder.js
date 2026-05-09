import { query, transaction } from '../config/database.js';

const RAYNA_TABLES = [
  'rayna_tours', 'rayna_packages', 'rayna_hotels',
  'rayna_visas', 'rayna_flights', 'rayna_others',
];

// Short name for sources column
const TABLE_SHORT = {
  rayna_tours: 'tours',
  rayna_packages: 'packages',
  rayna_hotels: 'hotels',
  rayna_visas: 'visas',
  rayna_flights: 'flights',
  rayna_others: 'others',
};

const LUXURY_KEYWORDS = [
  'premium', 'private', 'vip', 'yacht', 'helicopter',
  'limousine', 'luxury', 'megayacht', 'falcon', 'chauffeur',
];

// Placeholder / junk names to exclude from name resolution
const PLACEHOLDER_NAMES = [
  'GROUP', 'GUEST', 'TBA', 'DUBAI GROUP', 'DUABI GROUP',
  'RAYNA TOURISM BLOCKING', 'RAYNA TD', 'NA', 'N/A',
  'TEST', 'DUMMY', '.', '-', 'NONE', 'NO NAME',
];
const PLACEHOLDER_LIST = PLACEHOLDER_NAMES.map(n => `'${n}'`).join(',');

// SQL expression to clean a raw name:
//  1. Strip non-ASCII  2. Strip title prefixes (with or without space after dot)  3. Normalize whitespace
const CLEAN_NAME_SQL = (col) => `
  TRIM(REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(${col}, '[^\\x20-\\x7E]', '', 'g'),
      '^\\s*(Mr|Mrs|Ms|Dr|Miss)[.\\s]+', '', 'i'
    ),
    '\\s+', ' ', 'g'
  ))
`;

// SQL FILTER clause for valid (non-placeholder) names
const NAME_FILTER = `
  WHERE cname <> '' AND LENGTH(cname) >= 2
  AND UPPER(cname) NOT IN (${PLACEHOLDER_LIST})
`;

class UnifiedContactBuilder {

  // ─── Full pipeline: extract → link → segment ─────────────
  static async rebuild() {
    const t0 = Date.now();
    console.log('[UCB] Starting full rebuild...');

    const extracted = await this.extractContacts();
    const linked    = await this.linkRaynaTables();
    const segmented = await this.computeSegmentation();

    const ms = Date.now() - t0;
    console.log(`[UCB] Rebuild complete in ${(ms / 1000).toFixed(1)}s`);
    return { extracted, linked, segmented, durationMs: ms };
  }

  // ─── Step 1: Extract & dedup contacts ────────────────────
  static async extractContacts() {
    console.log('[UCB] Step 1 — Extracting contacts from rayna tables...');

    // Clear existing contacts
    await query('TRUNCATE unified_contacts RESTART IDENTITY CASCADE');

    // Pass 1: Email-based contacts
    // Build a UNION ALL across all 6 tables
    const emailUnion = RAYNA_TABLES.map(tbl => `
      SELECT
        LOWER(TRIM(guest_email)) AS email,
        guest_contact AS phone,
        guest_name AS name,
        nationality AS country,
        '${TABLE_SHORT[tbl]}' AS src,
        CASE WHEN is_b2b = '1' THEN 1 ELSE 0 END AS b2b_flag,
        booking_date AS bdate
      FROM ${tbl}
      WHERE TRIM(COALESCE(guest_email,'')) <> ''
        AND guest_email LIKE '%@%'
    `).join(' UNION ALL ');

    const emailInsertSQL = `
      INSERT INTO unified_contacts (email, mobile, name, country, sources, contact_type,
        wa_unsubscribe, email_unsubscribe)
      SELECT
        email,
        -- pick first valid phone
        MIN(phone) FILTER (WHERE TRIM(phone) <> '' AND phone !~ '^0+$' AND phone <> '-' AND LENGTH(REGEXP_REPLACE(phone,'[^0-9]','','g')) >= 7) AS mobile,
        -- pick the latest (most recent booking) cleaned name
        (array_agg(cname ORDER BY TO_DATE(bdate, 'DD/MM/YYYY') DESC NULLS LAST) FILTER (${NAME_FILTER}))[1] AS name,
        -- pick first non-empty country
        MIN(country) FILTER (WHERE TRIM(country) <> '' AND country <> 'N/A') AS country,
        -- aggregate sources
        STRING_AGG(DISTINCT src, ',' ORDER BY src) AS sources,
        -- contact type per group
        contact_type,
        'no' AS wa_unsubscribe,
        'no' AS email_unsubscribe
      FROM (
        SELECT email, phone, ${CLEAN_NAME_SQL('name')} AS cname, country, src,
          CASE WHEN b2b_flag = 1 THEN 'B2B' ELSE 'B2C' END AS contact_type,
          bdate
        FROM (${emailUnion}) raw
      ) t
      GROUP BY email, contact_type
    `;

    const emailResult = await query(emailInsertSQL);
    const emailCount = emailResult.rowCount;
    console.log(`[UCB]   Pass 1 (email): ${emailCount.toLocaleString()} contacts`);

    // Pass 2: Phone-only contacts (no valid email)
    const phoneUnion = RAYNA_TABLES.map(tbl => `
      SELECT
        RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) AS phone_key,
        guest_contact AS raw_phone,
        guest_name AS name,
        nationality AS country,
        '${TABLE_SHORT[tbl]}' AS src,
        CASE WHEN is_b2b = '1' THEN 1 ELSE 0 END AS b2b_flag,
        booking_date AS bdate
      FROM ${tbl}
      WHERE (TRIM(COALESCE(guest_email,'')) = '' OR guest_email NOT LIKE '%@%')
        AND TRIM(COALESCE(guest_contact,'')) <> ''
        AND guest_contact <> '-'
        AND guest_contact !~ '^0+$'
        AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
    `).join(' UNION ALL ');

    const phoneInsertSQL = `
      INSERT INTO unified_contacts (mobile, name, country, sources, contact_type,
        wa_unsubscribe, email_unsubscribe)
      SELECT
        phone_key AS mobile,
        (array_agg(cname ORDER BY TO_DATE(bdate, 'DD/MM/YYYY') DESC NULLS LAST) FILTER (${NAME_FILTER}))[1] AS name,
        MIN(country) FILTER (WHERE TRIM(country) <> '' AND country <> 'N/A') AS country,
        STRING_AGG(DISTINCT src, ',' ORDER BY src) AS sources,
        contact_type,
        'no' AS wa_unsubscribe,
        'no' AS email_unsubscribe
      FROM (
        SELECT phone_key, raw_phone AS phone, ${CLEAN_NAME_SQL('name')} AS cname, country, src,
          CASE WHEN b2b_flag = 1 THEN 'B2B' ELSE 'B2C' END AS contact_type,
          bdate
        FROM (${phoneUnion}) raw
      ) t
      GROUP BY phone_key, contact_type
    `;

    const phoneResult = await query(phoneInsertSQL);
    const phoneCount = phoneResult.rowCount;
    console.log(`[UCB]   Pass 2 (phone-only): ${phoneCount.toLocaleString()} contacts`);

    const total = emailCount + phoneCount;
    console.log(`[UCB]   Total: ${total.toLocaleString()} unified contacts`);
    return { emailBased: emailCount, phoneBased: phoneCount, total };
  }

  // ─── Step 2: Link rayna tables back to unified_contacts ──
  static async linkRaynaTables() {
    console.log('[UCB] Step 2 — Linking rayna tables to unified_contacts...');

    const results = {};

    for (const tbl of RAYNA_TABLES) {
      // Reset existing links
      await query(`UPDATE ${tbl} SET unified_id = NULL`);

      // Pass A: match by email + contact_type (B2B/B2C)
      const emailLink = await query(`
        UPDATE ${tbl} rt SET unified_id = uc.id
        FROM unified_contacts uc
        WHERE LOWER(TRIM(rt.guest_email)) = uc.email
          AND uc.email IS NOT NULL
          AND uc.contact_type = CASE WHEN rt.is_b2b = '1' THEN 'B2B' ELSE 'B2C' END
          AND rt.unified_id IS NULL
      `);

      // Pass B: match by phone + contact_type (fallback)
      const phoneLink = await query(`
        UPDATE ${tbl} rt SET unified_id = uc.id
        FROM unified_contacts uc
        WHERE RIGHT(REGEXP_REPLACE(rt.guest_contact,'[^0-9]','','g'), 10) = uc.mobile
          AND uc.mobile IS NOT NULL
          AND uc.contact_type = CASE WHEN rt.is_b2b = '1' THEN 'B2B' ELSE 'B2C' END
          AND rt.unified_id IS NULL
      `);

      const total = (emailLink.rowCount || 0) + (phoneLink.rowCount || 0);
      const tableTotal = (await query(`SELECT COUNT(*)::int AS c FROM ${tbl}`)).rows[0].c;
      results[tbl] = {
        byEmail: emailLink.rowCount || 0,
        byPhone: phoneLink.rowCount || 0,
        linked: total,
        total: tableTotal,
      };
      console.log(`[UCB]   ${tbl}: ${total.toLocaleString()}/${tableTotal.toLocaleString()} linked (email: ${emailLink.rowCount}, phone: ${phoneLink.rowCount})`);
    }

    return results;
  }

  // ─── Step 3: Compute segmentation ────────────────────────
  static async computeSegmentation() {
    console.log('[UCB] Step 3 — Computing segmentation...');

    // 3A: booking_status
    const statusSQL = `
      UPDATE unified_contacts uc SET booking_status = sub.status
      FROM (
        WITH bookings AS (
          SELECT unified_id,
            bool_or(is_cancel <> '1' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE) AS on_trip,
            bool_or(is_cancel <> '1' AND travel_date::date > CURRENT_DATE) AS future_travel,
            bool_or(is_cancel <> '1') AS has_valid,
            bool_or(is_cancel = '1') AS has_cancelled,
            COUNT(*) AS total
          FROM (
            ${RAYNA_TABLES.map(t => `
              SELECT unified_id, is_cancel,
                CASE WHEN travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN travel_date::date ELSE NULL END AS travel_date
              FROM ${t} WHERE unified_id IS NOT NULL
            `).join(' UNION ALL ')}
          ) all_bookings
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
    `;
    const statusResult = await query(statusSQL);
    console.log(`[UCB]   booking_status: ${statusResult.rowCount} updated`);

    // Set remaining as PROSPECT
    await query(`UPDATE unified_contacts SET booking_status = 'PROSPECT' WHERE booking_status IS NULL`);

    // 3B: product_tier
    const luxuryPattern = LUXURY_KEYWORDS.map(k => `service_name ILIKE '%${k}%'`).join(' OR ');
    const tierSQL = `
      UPDATE unified_contacts uc SET product_tier = sub.tier
      FROM (
        WITH linked AS (
          ${RAYNA_TABLES.map(t => `
            SELECT unified_id, service_name, is_cancel FROM ${t} WHERE unified_id IS NOT NULL
          `).join(' UNION ALL ')}
        )
        SELECT unified_id,
          CASE
            WHEN bool_or(${luxuryPattern}) THEN 'LUXURY'
            ELSE 'STANDARD'
          END AS tier
        FROM linked
        WHERE is_cancel <> '1'
        GROUP BY unified_id
      ) sub
      WHERE uc.id = sub.unified_id
    `;
    const tierResult = await query(tierSQL);
    console.log(`[UCB]   product_tier: ${tierResult.rowCount} updated`);

    // 3C: geography + is_indian
    const geoSQL = `
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
    `;
    await query(geoSQL);
    console.log('[UCB]   geography + is_indian: done');

    // 3D: segments label
    const segSQL = `
      UPDATE unified_contacts SET segments = CONCAT_WS(' / ',
        booking_status,
        product_tier,
        geography,
        CASE WHEN is_indian THEN 'INDIAN' END
      )
    `;
    await query(segSQL);
    console.log('[UCB]   segments label: done');

    // Counts summary
    const { rows: summary } = await query(`
      SELECT booking_status, COUNT(*)::int AS count
      FROM unified_contacts GROUP BY booking_status ORDER BY count DESC
    `);
    console.log('[UCB]   Segment summary:');
    for (const r of summary) {
      console.log(`[UCB]     ${r.booking_status}: ${r.count.toLocaleString()}`);
    }

    return summary;
  }
}

export default UnifiedContactBuilder;
