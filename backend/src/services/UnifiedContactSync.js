import { query } from '../config/database.js';

/**
 * Incremental sync for unified_contacts table.
 * Updates existing rows and adds new ones without full rebuild.
 */
export default class UnifiedContactSync {

  /**
   * Sync new contacts from contacts_raw that aren't in unified_contacts yet
   */
  static async syncNewContacts() {
    const { rowCount } = await query(`
      INSERT INTO unified_contacts (email_key, email, phone, phone_key, name, company_name, city, country, contact_type, sources, first_seen_at)
      SELECT DISTINCT ON (LOWER(TRIM(cr.email)))
        LOWER(TRIM(cr.email)), cr.email, cr.mobile,
        CASE WHEN cr.mobile IS NOT NULL AND LENGTH(REGEXP_REPLACE(cr.mobile, '[^0-9]', '', 'g')) >= 7
             AND RIGHT(REGEXP_REPLACE(cr.mobile, '[^0-9]', '', 'g'), 10) !~ '^0+$'
             AND TRIM(cr.mobile) NOT IN ('0','00','000','NA','N/A','na')
             THEN RIGHT(REGEXP_REPLACE(cr.mobile, '[^0-9]', '', 'g'), 10) END,
        NULLIF(TRIM(cr.name), ''), NULLIF(TRIM(cr.company_name), ''), NULLIF(TRIM(cr.city), ''), NULLIF(TRIM(cr.country), ''),
        cr.contact_type, 'contacts', cr.created_at
      FROM contacts_raw cr
      LEFT JOIN unified_contacts uc ON uc.email_key = LOWER(TRIM(cr.email))
      WHERE cr.email IS NOT NULL AND TRIM(cr.email) != '' AND uc.unified_id IS NULL
      ORDER BY LOWER(TRIM(cr.email)),
        (CASE WHEN cr.name IS NOT NULL AND TRIM(cr.name) NOT IN ('N/A','NA','') THEN 1 ELSE 0 END +
         CASE WHEN cr.company_name IS NOT NULL THEN 1 ELSE 0 END) DESC
      ON CONFLICT DO NOTHING
    `);
    console.log(`[UnifiedSync] New contacts added: ${rowCount}`);
    return rowCount;
  }

  /**
   * Sync new chat customers + update chat counts for existing
   */
  static async syncChats() {
    // Add chat-only customers not yet in unified_contacts
    const { rowCount: newChats } = await query(`
      INSERT INTO unified_contacts (phone_key, phone, name, country, sources, first_seen_at)
      SELECT RIGHT(REGEXP_REPLACE(cc.wa_id, '[^0-9]', '', 'g'), 10),
        cc.wa_id, cc.wa_name, cc.country, 'chat', cc.first_chat_at
      FROM chat_contacts cc
      LEFT JOIN unified_contacts uc ON uc.phone_key = RIGHT(REGEXP_REPLACE(cc.wa_id, '[^0-9]', '', 'g'), 10)
      WHERE uc.unified_id IS NULL
        AND cc.wa_id IS NOT NULL AND LENGTH(REGEXP_REPLACE(cc.wa_id, '[^0-9]', '', 'g')) >= 7
        AND RIGHT(REGEXP_REPLACE(cc.wa_id, '[^0-9]', '', 'g'), 10) !~ '^0+$'
      ON CONFLICT DO NOTHING
    `);
    console.log(`[UnifiedSync] New chat contacts: ${newChats}`);

    // Update chat data for all phone-matched contacts
    const { rowCount: updated } = await query(`
      UPDATE unified_contacts uc SET
        total_chats = cc.total_chats,
        first_chat_at = cc.first_chat_at,
        last_chat_at = cc.last_chat_at,
        first_msg_text = cc.first_msg_text,
        last_msg_text = cc.last_msg_text,
        chat_departments = cc.departments,
        wa_unsubscribed = cc.unsubscribed_status,
        sources = CASE WHEN uc.sources LIKE '%chat%' THEN uc.sources ELSE uc.sources || ', chat' END,
        last_seen_at = GREATEST(uc.last_seen_at, cc.last_chat_at),
        updated_at = NOW()
      FROM chat_contacts cc
      WHERE uc.phone_key IS NOT NULL
        AND uc.phone_key = RIGHT(REGEXP_REPLACE(cc.wa_id, '[^0-9]', '', 'g'), 10)
        AND (uc.total_chats != cc.total_chats OR uc.total_chats = 0)
    `);
    console.log(`[UnifiedSync] Chat data updated: ${updated}`);
    return { newChats, updated };
  }

  // syncTravelBookings removed — legacy travel_bookings table dropped.
  // All booking data comes from Rayna API tables: rayna_tours, rayna_hotels, rayna_visas, rayna_flights.

  /**
   * Sync per-contact booking counts + revenue from the four Rayna tables.
   *
   * 2026-04-22: scoped to **bill_date >= 2026-02-01 and non-Cancelled only**.
   * Anything earlier is covered by the historical travel_data dump; anything
   * cancelled should not count as revenue. Policy applied uniformly to every
   * aggregate so counts, revenue, and segment rules line up.
   */
  static API_CUTOFF = '2026-02-01';

  static async syncRaynaBookings() {
    const t0 = Date.now();
    const CUTOFF = this.API_CUTOFF;

    // Count CONFIRMED bookings with bill_date >= CUTOFF, per contact per table
    const { rowCount: countsChanged } = await query(`
      WITH per_contact AS (
        SELECT uc.unified_id,
          (SELECT COUNT(*) FROM rayna_tours   WHERE unified_id = uc.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}') AS tours,
          (SELECT COUNT(*) FROM rayna_hotels  WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}') AS hotels,
          (SELECT COUNT(*) FROM rayna_visas   WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}') AS visas,
          (SELECT COUNT(*) FROM rayna_flights WHERE unified_id = uc.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}') AS flights
        FROM unified_contacts uc
        WHERE EXISTS (SELECT 1 FROM rayna_tours   WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}')
           OR EXISTS (SELECT 1 FROM rayna_hotels  WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}')
           OR EXISTS (SELECT 1 FROM rayna_visas   WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}')
           OR EXISTS (SELECT 1 FROM rayna_flights WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}')
      )
      UPDATE unified_contacts uc SET
        total_tour_bookings   = p.tours,
        total_hotel_bookings  = p.hotels,
        total_visa_bookings   = p.visas,
        total_flight_bookings = p.flights,
        sources = CASE WHEN uc.sources LIKE '%rayna%' THEN uc.sources ELSE uc.sources || ', rayna' END,
        updated_at = NOW()
      FROM per_contact p
      WHERE uc.unified_id = p.unified_id
        AND (COALESCE(uc.total_tour_bookings,0)   IS DISTINCT FROM p.tours
          OR COALESCE(uc.total_hotel_bookings,0)  IS DISTINCT FROM p.hotels
          OR COALESCE(uc.total_visa_bookings,0)   IS DISTINCT FROM p.visas
          OR COALESCE(uc.total_flight_bookings,0) IS DISTINCT FROM p.flights)
    `);

    // Revenue: same scope — post-cutoff + confirmed
    const { rowCount: revChanged } = await query(`
      WITH per_contact AS (
        SELECT unified_id,
          SUM(rev) AS total_rev, MIN(dt) AS first_dt, MAX(dt) AS last_dt
        FROM (
          SELECT unified_id, total_sell    AS rev, bill_date AS dt FROM rayna_tours   WHERE unified_id IS NOT NULL AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}'
          UNION ALL
          SELECT unified_id, total_sell,    bill_date FROM rayna_hotels  WHERE unified_id IS NOT NULL AND bill_date >= '${CUTOFF}'
          UNION ALL
          SELECT unified_id, total_sell,    bill_date FROM rayna_visas   WHERE unified_id IS NOT NULL AND bill_date >= '${CUTOFF}'
          UNION ALL
          SELECT unified_id, selling_price, bill_date FROM rayna_flights WHERE unified_id IS NOT NULL AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}'
        ) all_bookings
        GROUP BY unified_id
      )
      UPDATE unified_contacts uc SET
        total_booking_revenue = COALESCE(p.total_rev, 0),
        first_booking_at = LEAST(uc.first_booking_at, p.first_dt),
        last_booking_at  = GREATEST(uc.last_booking_at, p.last_dt),
        updated_at = NOW()
      FROM per_contact p
      WHERE uc.unified_id = p.unified_id
        AND COALESCE(uc.total_booking_revenue, 0) IS DISTINCT FROM COALESCE(p.total_rev, 0)
    `);

    // Zero out contacts whose post-cutoff bookings all got cancelled / removed
    const { rowCount: zeroed } = await query(`
      UPDATE unified_contacts SET total_booking_revenue = 0, updated_at = NOW()
      WHERE total_booking_revenue > 0
        AND NOT EXISTS (SELECT 1 FROM rayna_tours   WHERE unified_id = unified_contacts.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}')
        AND NOT EXISTS (SELECT 1 FROM rayna_hotels  WHERE unified_id = unified_contacts.unified_id AND bill_date >= '${CUTOFF}')
        AND NOT EXISTS (SELECT 1 FROM rayna_visas   WHERE unified_id = unified_contacts.unified_id AND bill_date >= '${CUTOFF}')
        AND NOT EXISTS (SELECT 1 FROM rayna_flights WHERE unified_id = unified_contacts.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}')
    `);

    console.log(`[UnifiedSync] syncRaynaBookings (>=${CUTOFF}, confirmed): counts=${countsChanged}, revenue=${revChanged}, zeroed=${zeroed} in ${((Date.now()-t0)/1000).toFixed(1)}s`);
    return countsChanged + revChanged;
  }

  /**
   * Add new contacts from Rayna bookings that don't exist in unified_contacts
   * Checks both guest_contact (phone) and grnty_email against existing records.
   * If neither matches → creates a new unified_contacts row.
   */
  static async syncNewRaynaContacts() {
    // Each table has a slightly different schema — especially the country column —
    // so we parameterise it per-table instead of hard-coding country_name everywhere.
    const tables = [
      { name: 'rayna_tours',   countryExpr: 'country_name' },
      { name: 'rayna_hotels',  countryExpr: 'country_name' },
      { name: 'rayna_visas',   countryExpr: 'country_name' },
      { name: 'rayna_flights', countryExpr: 'nationality' },
    ];

    let totalByPhone = 0;
    let totalByEmail = 0;

    for (const t of tables) {
      // ── Stage 1: insert contacts with a usable phone ──
      // phone_key = last 10 digits of a guest_contact with >=7 digits, not all zeros.
      // This uses a CTE so the same row-shape logic is visible and debuggable.
      // If email is present on that row, it goes in too — one contact carries both.
      const { rowCount: byPhone } = await query(`
        WITH cleaned AS (
          SELECT
            RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) AS phone_key,
            MIN(guest_contact) AS phone,
            MIN(NULLIF(TRIM(COALESCE(grnty_email,'')), '')) AS email_raw,
            MIN(NULLIF(TRIM(COALESCE(guest_name,'')), '')) AS name,
            MIN(NULLIF(TRIM(COALESCE(${t.countryExpr},'')), '')) AS country,
            MIN(bill_date) AS first_seen
          FROM ${t.name}
          WHERE guest_contact IS NOT NULL
            AND LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
            AND RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) !~ '^0+$'
          GROUP BY RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10)
        )
        INSERT INTO unified_contacts (phone_key, phone, email, email_key, name, country, sources, first_seen_at)
        SELECT
          c.phone_key, c.phone, c.email_raw,
          CASE WHEN c.email_raw IS NOT NULL THEN LOWER(c.email_raw) END,
          c.name, c.country, 'rayna', c.first_seen
        FROM cleaned c
        WHERE NOT EXISTS (SELECT 1 FROM unified_contacts uc WHERE uc.phone_key = c.phone_key)
        ON CONFLICT (phone_key) WHERE phone_key IS NOT NULL DO NOTHING
      `);
      totalByPhone += byPhone;

      // ── Stage 2: insert contacts with email only ──
      // Catches rows where the phone is junk ("-", "0", "000", etc.) but the email is real.
      // Filters out (a) emails already in unified_contacts, (b) emails whose corresponding
      // phone was already inserted above (so one person doesn't become two contacts).
      const { rowCount: byEmail } = await query(`
        WITH cleaned AS (
          SELECT
            LOWER(TRIM(grnty_email)) AS email_key,
            MIN(grnty_email) AS email,
            MIN(guest_contact) AS phone_raw,
            MIN(NULLIF(TRIM(COALESCE(guest_name,'')), '')) AS name,
            MIN(NULLIF(TRIM(COALESCE(${t.countryExpr},'')), '')) AS country,
            MIN(bill_date) AS first_seen
          FROM ${t.name}
          WHERE grnty_email IS NOT NULL
            AND TRIM(grnty_email) != ''
            AND TRIM(grnty_email) ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
          GROUP BY LOWER(TRIM(grnty_email))
        )
        INSERT INTO unified_contacts (email_key, email, phone, phone_key, name, country, sources, first_seen_at)
        SELECT
          c.email_key, c.email, c.phone_raw,
          NULL,  -- phone_key intentionally NULL — if phone was valid, stage 1 already handled it
          c.name, c.country, 'rayna', c.first_seen
        FROM cleaned c
        WHERE NOT EXISTS (SELECT 1 FROM unified_contacts uc WHERE uc.email_key = c.email_key)
      `);
      totalByEmail += byEmail;

      console.log(`[UnifiedSync] ${t.name} — created ${byPhone} by phone, ${byEmail} by email`);
    }

    console.log(`[UnifiedSync] Total Rayna contacts created: ${totalByPhone} by phone, ${totalByEmail} by email`);
    return { byPhone: totalByPhone, byEmail: totalByEmail };
  }

  /**
   * Add new contacts from GTM/GA4 events that don't exist in unified_contacts
   * Checks both email and phone from event payloads.
   */
  static async syncNewGTMContacts() {
    let totalByEmail = 0;
    let totalByPhone = 0;

    // From GTM events — email in raw_payload->>'emailId'
    try {
      const { rowCount } = await query(`
        INSERT INTO unified_contacts (email_key, email, phone, phone_key, name, country, city, sources, first_seen_at)
        SELECT DISTINCT ON (ek)
          ek, email, phone,
          CASE WHEN phone IS NOT NULL AND LENGTH(REGEXP_REPLACE(phone,'[^0-9]','','g')) >= 7
               AND RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'), 10) !~ '^0+$'
               THEN RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'), 10) END,
          name, country, city, 'gtm', first_seen
        FROM (
          SELECT
            LOWER(TRIM(ge.raw_payload->>'emailId')) as ek,
            ge.raw_payload->>'emailId' as email,
            ge.raw_payload->>'contactNumber' as phone,
            ge.raw_payload->>'name' as name,
            ge.country, ge.city,
            MIN(ge.created_at) as first_seen
          FROM gtm_events ge
          WHERE ge.unified_id IS NULL
            AND ge.raw_payload->>'emailId' IS NOT NULL
            AND TRIM(ge.raw_payload->>'emailId') != ''
          GROUP BY LOWER(TRIM(ge.raw_payload->>'emailId')), ge.raw_payload->>'emailId',
            ge.raw_payload->>'contactNumber', ge.raw_payload->>'name', ge.country, ge.city
        ) sub
        WHERE ek NOT IN (SELECT email_key FROM unified_contacts WHERE email_key IS NOT NULL)
        ORDER BY ek, name IS NOT NULL DESC
        ON CONFLICT DO NOTHING
      `);
      totalByEmail += rowCount;
      if (rowCount > 0) console.log(`[UnifiedSync] New GTM contacts by email: ${rowCount}`);
    } catch (err) {
      console.error(`[UnifiedSync] GTM email contacts failed:`, err.message);
    }

    // From GTM events — phone in raw_payload->>'contactNumber' (no email)
    try {
      const { rowCount } = await query(`
        INSERT INTO unified_contacts (phone_key, phone, name, country, city, sources, first_seen_at)
        SELECT DISTINCT ON (pk)
          pk, phone, name, country, city, 'gtm', first_seen
        FROM (
          SELECT
            RIGHT(REGEXP_REPLACE(ge.raw_payload->>'contactNumber','[^0-9]','','g'), 10) as pk,
            ge.raw_payload->>'contactNumber' as phone,
            ge.raw_payload->>'name' as name,
            ge.country, ge.city,
            MIN(ge.created_at) as first_seen
          FROM gtm_events ge
          WHERE ge.unified_id IS NULL
            AND (ge.raw_payload->>'emailId' IS NULL OR TRIM(ge.raw_payload->>'emailId') = '')
            AND ge.raw_payload->>'contactNumber' IS NOT NULL
            AND LENGTH(REGEXP_REPLACE(ge.raw_payload->>'contactNumber','[^0-9]','','g')) >= 7
          GROUP BY RIGHT(REGEXP_REPLACE(ge.raw_payload->>'contactNumber','[^0-9]','','g'), 10),
            ge.raw_payload->>'contactNumber', ge.raw_payload->>'name', ge.country, ge.city
        ) sub
        WHERE pk NOT IN (SELECT phone_key FROM unified_contacts WHERE phone_key IS NOT NULL)
          AND pk !~ '^0+$'
        ORDER BY pk, name IS NOT NULL DESC
        ON CONFLICT DO NOTHING
      `);
      totalByPhone += rowCount;
      if (rowCount > 0) console.log(`[UnifiedSync] New GTM contacts by phone: ${rowCount}`);
    } catch (err) {
      console.error(`[UnifiedSync] GTM phone contacts failed:`, err.message);
    }

    // From GA4 events — email in email_any
    try {
      const { rowCount } = await query(`
        INSERT INTO unified_contacts (email_key, email, phone, phone_key, sources, first_seen_at)
        SELECT DISTINCT ON (ek)
          ek, email, phone,
          CASE WHEN phone IS NOT NULL AND LENGTH(REGEXP_REPLACE(phone,'[^0-9]','','g')) >= 7
               AND RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'), 10) !~ '^0+$'
               THEN RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'), 10) END,
          'ga4', first_seen
        FROM (
          SELECT
            LOWER(TRIM(ge.email_any)) as ek,
            ge.email_any as email,
            ge.contact_number_any as phone,
            MIN(ge.event_ts) as first_seen
          FROM ga4_events ge
          WHERE ge.unified_id IS NULL
            AND ge.email_any IS NOT NULL AND TRIM(ge.email_any) != ''
          GROUP BY LOWER(TRIM(ge.email_any)), ge.email_any, ge.contact_number_any
        ) sub
        WHERE ek NOT IN (SELECT email_key FROM unified_contacts WHERE email_key IS NOT NULL)
        ORDER BY ek
        ON CONFLICT DO NOTHING
      `);
      totalByEmail += rowCount;
      if (rowCount > 0) console.log(`[UnifiedSync] New GA4 contacts by email: ${rowCount}`);
    } catch (err) {
      console.error(`[UnifiedSync] GA4 email contacts failed:`, err.message);
    }

    // From GA4 events — phone only (no email)
    try {
      const { rowCount } = await query(`
        INSERT INTO unified_contacts (phone_key, phone, sources, first_seen_at)
        SELECT DISTINCT ON (pk)
          pk, phone, 'ga4', first_seen
        FROM (
          SELECT
            RIGHT(REGEXP_REPLACE(ge.contact_number_any,'[^0-9]','','g'), 10) as pk,
            ge.contact_number_any as phone,
            MIN(ge.event_ts) as first_seen
          FROM ga4_events ge
          WHERE ge.unified_id IS NULL
            AND (ge.email_any IS NULL OR TRIM(ge.email_any) = '')
            AND ge.contact_number_any IS NOT NULL
            AND LENGTH(REGEXP_REPLACE(ge.contact_number_any,'[^0-9]','','g')) >= 7
          GROUP BY RIGHT(REGEXP_REPLACE(ge.contact_number_any,'[^0-9]','','g'), 10), ge.contact_number_any
        ) sub
        WHERE pk NOT IN (SELECT phone_key FROM unified_contacts WHERE phone_key IS NOT NULL)
          AND pk !~ '^0+$'
        ORDER BY pk
        ON CONFLICT DO NOTHING
      `);
      totalByPhone += rowCount;
      if (rowCount > 0) console.log(`[UnifiedSync] New GA4 contacts by phone: ${rowCount}`);
    } catch (err) {
      console.error(`[UnifiedSync] GA4 phone contacts failed:`, err.message);
    }

    console.log(`[UnifiedSync] Total new GTM/GA4 contacts: ${totalByEmail} by email, ${totalByPhone} by phone`);
    return { byEmail: totalByEmail, byPhone: totalByPhone };
  }

  /**
   * Sync unsubscribe flags
   */
  static async syncUnsubscribed() {
    const { rowCount: email } = await query(`
      UPDATE unified_contacts uc SET email_unsubscribed = 'Yes', updated_at = NOW()
      FROM unsubscribed uns
      WHERE LOWER(TRIM(uc.email)) = LOWER(TRIM(uns.email))
        AND (uns.unsubscribe = 1 OR uns.hard_bounces::int > 0)
        AND uc.email_unsubscribed = 'No'
    `);
    console.log(`[UnifiedSync] Email unsubscribed flagged: ${email}`);
    return email;
  }

  /**
   * Re-link unified_id on raw tables for new rows
   */
  static async relinkRawTables() {
    let total = 0;

    const updates = [
      // Chats: link by phone
      `UPDATE chats c SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.phone_key = normalize_phone(c.wa_id) AND c.unified_id IS NULL AND c.wa_id IS NOT NULL`,

      // Rayna tables: link by phone (primary)
      `UPDATE rayna_tours t SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.phone_key = normalize_phone(t.guest_contact) AND t.unified_id IS NULL AND t.guest_contact IS NOT NULL`,
      `UPDATE rayna_hotels h SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.phone_key = normalize_phone(h.guest_contact) AND h.unified_id IS NULL AND h.guest_contact IS NOT NULL`,
      `UPDATE rayna_visas v SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.phone_key = normalize_phone(v.guest_contact) AND v.unified_id IS NULL AND v.guest_contact IS NOT NULL`,
      `UPDATE rayna_flights f SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.phone_key = normalize_phone(f.guest_contact) AND f.unified_id IS NULL AND f.guest_contact IS NOT NULL`,

      // Rayna tables: link by grnty_email (fallback for unmatched by phone)
      `UPDATE rayna_tours t SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.email_key = LOWER(TRIM(t.grnty_email)) AND t.unified_id IS NULL AND t.grnty_email IS NOT NULL AND TRIM(t.grnty_email) != ''`,
      `UPDATE rayna_hotels h SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.email_key = LOWER(TRIM(h.grnty_email)) AND h.unified_id IS NULL AND h.grnty_email IS NOT NULL AND TRIM(h.grnty_email) != ''`,
      `UPDATE rayna_visas v SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.email_key = LOWER(TRIM(v.grnty_email)) AND v.unified_id IS NULL AND v.grnty_email IS NOT NULL AND TRIM(v.grnty_email) != ''`,
      `UPDATE rayna_flights f SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.email_key = LOWER(TRIM(f.grnty_email)) AND f.unified_id IS NULL AND f.grnty_email IS NOT NULL AND TRIM(f.grnty_email) != ''`,

      // GA4: link by email then phone
      `UPDATE ga4_events g SET unified_id = uc.unified_id FROM unified_contacts uc WHERE uc.email_key = LOWER(TRIM(g.email_any)) AND g.unified_id IS NULL AND g.email_any IS NOT NULL AND TRIM(g.email_any) != ''`,
      `UPDATE ga4_events g SET unified_id = uc.unified_id FROM unified_contacts uc WHERE g.unified_id IS NULL AND uc.phone_key = normalize_phone(g.contact_number_any) AND g.contact_number_any IS NOT NULL`,
    ];

    for (const sql of updates) {
      const { rowCount } = await query(sql);
      total += rowCount;
    }
    console.log(`[UnifiedSync] Raw tables re-linked: ${total}`);
    return total;
  }

  /**
   * Link GA4 + GTM events to unified_contacts
   */
  static async syncGA4GTM() {
    let total = 0;

    // GA4 by email
    let res = await query(`UPDATE ga4_events g SET unified_id = uc.unified_id FROM unified_contacts uc
      WHERE uc.email_key = LOWER(TRIM(g.email_any)) AND g.unified_id IS NULL AND g.email_any IS NOT NULL AND TRIM(g.email_any) != ''`);
    total += res.rowCount;

    // GA4 by phone
    res = await query(`UPDATE ga4_events g SET unified_id = uc.unified_id FROM unified_contacts uc
      WHERE g.unified_id IS NULL AND uc.phone_key = normalize_phone(g.contact_number_any) AND g.contact_number_any IS NOT NULL AND TRIM(g.contact_number_any) != ''`);
    total += res.rowCount;

    // GTM by email from payload
    try {
      res = await query(`UPDATE gtm_events g SET unified_id = uc.unified_id FROM unified_contacts uc
        WHERE g.unified_id IS NULL AND uc.email_key = LOWER(TRIM(g.raw_payload::jsonb->>'emailId')) AND g.raw_payload::jsonb->>'emailId' IS NOT NULL AND TRIM(g.raw_payload::jsonb->>'emailId') != ''`);
      total += res.rowCount;

      // GTM by phone from payload
      res = await query(`UPDATE gtm_events g SET unified_id = uc.unified_id FROM unified_contacts uc
        WHERE g.unified_id IS NULL AND uc.phone_key = normalize_phone(g.raw_payload::jsonb->>'contactNumber') AND g.raw_payload::jsonb->>'contactNumber' IS NOT NULL`);
      total += res.rowCount;
    } catch { /* gtm_events may not exist */ }

    // Update GA4 summary on unified_contacts
    res = await query(`UPDATE unified_contacts uc SET
      total_ga4_events = ga.cnt, ga4_sessions = ga.sessions, ga4_first_seen = ga.first_seen, ga4_last_seen = ga.last_seen,
      sources = CASE WHEN uc.sources LIKE '%ga4%' THEN uc.sources ELSE uc.sources || ', ga4' END,
      last_seen_at = GREATEST(uc.last_seen_at, ga.last_seen), updated_at = NOW()
      FROM (SELECT unified_id, COUNT(*) as cnt, COUNT(DISTINCT ga_session_id) as sessions, MIN(event_ts) as first_seen, MAX(event_ts) as last_seen
        FROM ga4_events WHERE unified_id IS NOT NULL GROUP BY unified_id) ga
      WHERE uc.unified_id = ga.unified_id AND (uc.total_ga4_events IS NULL OR uc.total_ga4_events != ga.cnt)`);
    total += res.rowCount;

    console.log(`[UnifiedSync] GA4/GTM linked: ${total}`);
    return total;
  }

  /**
   * Refresh chat_contacts from chats table (incremental)
   */
  static async refreshChatContacts() {
    // Add new wa_ids to chat_contacts
    const { rowCount: newContacts } = await query(`
      INSERT INTO chat_contacts (wa_id, wa_name, country, total_chats, first_chat_at, last_chat_at, last_msg_text, first_msg_text)
      SELECT c.wa_id, ln.wa_name, fc.country, c.total_chats, c.first_chat_at, c.last_chat_at, ln.last_short, fm.first_msg_text
      FROM (SELECT wa_id, COUNT(*) as total_chats, MIN(created_at) as first_chat_at,
          MAX(GREATEST(last_msg_at, created_at)) as last_chat_at
        FROM chats WHERE wa_id IS NOT NULL AND wa_id != '' GROUP BY wa_id) c
      LEFT JOIN LATERAL (SELECT wa_name, last_short FROM chats WHERE wa_id = c.wa_id ORDER BY last_msg_at DESC NULLS LAST LIMIT 1) ln ON true
      LEFT JOIN LATERAL (SELECT country FROM chats WHERE wa_id = c.wa_id AND country IS NOT NULL LIMIT 1) fc ON true
      LEFT JOIN LATERAL (SELECT first_msg_text FROM chats WHERE wa_id = c.wa_id AND first_msg_text IS NOT NULL LIMIT 1) fm ON true
      WHERE NOT EXISTS (SELECT 1 FROM chat_contacts cc WHERE cc.wa_id = c.wa_id)
      ON CONFLICT (wa_id) DO NOTHING
    `);

    // Update existing chat_contacts with new counts (fast — no subquery)
    const { rowCount: updated } = await query(`
      UPDATE chat_contacts cc SET
        total_chats = c.cnt, last_chat_at = c.last_at, updated_at = NOW()
      FROM (SELECT wa_id, COUNT(*) as cnt, MAX(GREATEST(last_msg_at, created_at)) as last_at
        FROM chats GROUP BY wa_id) c
      WHERE cc.wa_id = c.wa_id AND cc.total_chats != c.cnt
    `);

    console.log(`[UnifiedSync] Chat contacts: ${newContacts} new, ${updated} updated`);
    return { newContacts, updated };
  }

  /**
   * Compute 3-step decision tree segmentation
   *
   * Step 1: Booking Status (priority: ON_TRIP > FUTURE_TRAVEL > ACTIVE_ENQUIRY > PAST_BOOKING > PAST_ENQUIRY > PROSPECT)
   * Step 2: Product Tier (LUXURY if any one luxury booking, else STANDARD)
   * Step 3: Geography (LOCAL = UAE, INTERNATIONAL = rest) + INDIAN sub-tag
   */
  static async computeSegments() {
    // ── Single-pass booking_status compute ─────────────────────
    // Previous version cleared every row and ran 8 sequential UPDATEs, each scanning
    // ~1.6M rows with 21 indexes to maintain → ~17 min. This version builds the
    // target status in one CTE (using EXISTS for booking dates, reading pre-aggregated
    // totals for the booking bucket) and only writes rows whose status actually
    // changes. Typical daily drift: <1% of rows, so writes go from 1.6M to <20K.
    const t0 = Date.now();
    const CUTOFF = UnifiedContactSync.API_CUTOFF;  // '2026-02-01'
    const { rowCount: statusChanged } = await query(`
      WITH target AS (
        SELECT uc.unified_id,
          CASE
            -- ON_TRIP: current-window non-cancelled booking from Rayna API (post-cutoff only)
            WHEN EXISTS (SELECT 1 FROM rayna_tours   WHERE unified_id = uc.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}' AND tour_date::date <= CURRENT_DATE AND (tour_date::date + INTERVAL '7 days') >= CURRENT_DATE)
              OR EXISTS (SELECT 1 FROM rayna_hotels  WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}' AND check_in_date::date <= CURRENT_DATE AND (check_in_date::date + INTERVAL '7 days') >= CURRENT_DATE)
              OR EXISTS (SELECT 1 FROM rayna_flights WHERE unified_id = uc.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}' AND from_datetime::date <= CURRENT_DATE AND (from_datetime::date + INTERVAL '7 days') >= CURRENT_DATE)
            THEN 'FUTURE_ONTRIP_ONTRIP'
            -- FUTURE_TRAVEL: future non-cancelled Rayna booking (post-cutoff only)
            WHEN EXISTS (SELECT 1 FROM rayna_tours   WHERE unified_id = uc.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}' AND tour_date::date > CURRENT_DATE)
              OR EXISTS (SELECT 1 FROM rayna_hotels  WHERE unified_id = uc.unified_id AND bill_date >= '${CUTOFF}' AND check_in_date::date > CURRENT_DATE)
              OR EXISTS (SELECT 1 FROM rayna_flights WHERE unified_id = uc.unified_id AND (status IS NULL OR status != 'Cancelled') AND bill_date >= '${CUTOFF}' AND from_datetime::date > CURRENT_DATE)
            THEN 'FUTURE_TRAVEL'
            -- ACTIVE_ENQUIRY: recent chat, no confirmed bookings anywhere
            WHEN uc.total_chats > 0
              AND uc.last_chat_at >= NOW() - INTERVAL '30 days'
              AND COALESCE(uc.total_tour_bookings,0)+COALESCE(uc.total_hotel_bookings,0)+COALESCE(uc.total_visa_bookings,0)+COALESCE(uc.total_flight_bookings,0) = 0
              AND NOT EXISTS (SELECT 1 FROM travel_data WHERE unified_id = uc.unified_id)
            THEN 'ACTIVE_ENQUIRY'
            -- PAST_BOOKING: confirmed post-cutoff Rayna bookings OR historical travel_data
            WHEN COALESCE(uc.total_tour_bookings,0)+COALESCE(uc.total_hotel_bookings,0)+COALESCE(uc.total_visa_bookings,0)+COALESCE(uc.total_flight_bookings,0) > 0
              OR EXISTS (SELECT 1 FROM travel_data WHERE unified_id = uc.unified_id)
            THEN 'PAST_BOOKING'
            -- CANCELLED: zero valid bookings, but has cancellation history post-cutoff
            WHEN EXISTS (SELECT 1 FROM rayna_tours   WHERE unified_id = uc.unified_id AND status = 'Cancelled' AND bill_date >= '${CUTOFF}')
              OR EXISTS (SELECT 1 FROM rayna_flights WHERE unified_id = uc.unified_id AND status = 'Cancelled' AND bill_date >= '${CUTOFF}')
            THEN 'CANCELLED'
            -- PAST_ENQUIRY: old chat, never booked
            WHEN uc.total_chats > 0 AND uc.last_chat_at < NOW() - INTERVAL '30 days'
            THEN 'PAST_ENQUIRY'
            ELSE 'PROSPECT'
          END AS new_status
        FROM unified_contacts uc
      ),
      target_fixed AS (
        -- The ON_TRIP sentinel is a trick to avoid column-name collisions in CASE;
        -- normalise it back here.
        SELECT unified_id,
          CASE new_status WHEN 'FUTURE_ONTRIP_ONTRIP' THEN 'ON_TRIP' ELSE new_status END AS new_status
        FROM target
      )
      UPDATE unified_contacts uc
      SET booking_status = t.new_status, updated_at = NOW()
      FROM target_fixed t
      WHERE uc.unified_id = t.unified_id
        AND uc.booking_status IS DISTINCT FROM t.new_status
    `);
    console.log(`[UnifiedSync] booking_status: ${statusChanged} rows changed in ${((Date.now()-t0)/1000).toFixed(1)}s`);

    // ── Product Tier + Geography + Indian — single-pass, writes only changed rows ──
    const luxuryTours = `tours_name ILIKE '%premium%' OR tours_name ILIKE '%private%' OR tours_name ILIKE '%vip%' OR tours_name ILIKE '%yacht%' OR tours_name ILIKE '%helicopter%' OR tours_name ILIKE '%limousine%' OR tours_name ILIKE '%luxury%' OR tours_name ILIKE '%megayacht%' OR tours_name ILIKE '%falcon%' OR tours_name ILIKE '%chauffeur%'`;
    const luxuryTravel = `service_name ILIKE '%premium%' OR service_name ILIKE '%private%' OR service_name ILIKE '%vip%' OR service_name ILIKE '%yacht%' OR service_name ILIKE '%helicopter%' OR service_name ILIKE '%limousine%' OR service_name ILIKE '%luxury%' OR service_name ILIKE '%megayacht%' OR service_name ILIKE '%falcon%' OR service_name ILIKE '%chauffeur%'`;

    const t1 = Date.now();
    const { rowCount: tierGeoChanged } = await query(`
      WITH luxury_bookers AS (
        SELECT DISTINCT unified_id FROM rayna_tours WHERE unified_id IS NOT NULL AND (${luxuryTours})
        UNION
        SELECT DISTINCT unified_id FROM travel_data WHERE unified_id IS NOT NULL AND (${luxuryTravel})
      ),
      any_bookers AS (
        -- Anyone with at least one booking in rayna_* totals or in travel_data
        SELECT unified_id FROM unified_contacts
        WHERE COALESCE(total_tour_bookings,0)+COALESCE(total_hotel_bookings,0)+COALESCE(total_visa_bookings,0)+COALESCE(total_flight_bookings,0) > 0
        UNION
        SELECT DISTINCT unified_id FROM travel_data WHERE unified_id IS NOT NULL
      ),
      target AS (
        SELECT uc.unified_id,
          CASE
            WHEN lb.unified_id IS NOT NULL THEN 'LUXURY'
            WHEN ab.unified_id IS NOT NULL THEN 'STANDARD'
            ELSE NULL
          END AS new_tier,
          CASE
            WHEN uc.country = 'United Arab Emirates' THEN 'LOCAL'
            WHEN uc.country IS NOT NULL AND uc.country NOT IN ('', 'N/A', 'NA') THEN 'INTERNATIONAL'
            ELSE NULL
          END AS new_geo,
          (uc.phone LIKE '91%' OR uc.phone LIKE '+91%' OR uc.country = 'India') AS new_indian
        FROM unified_contacts uc
        LEFT JOIN luxury_bookers lb ON lb.unified_id = uc.unified_id
        LEFT JOIN any_bookers   ab ON ab.unified_id = uc.unified_id
      )
      UPDATE unified_contacts uc
      SET product_tier = t.new_tier,
          geography    = t.new_geo,
          is_indian    = t.new_indian,
          updated_at   = NOW()
      FROM target t
      WHERE uc.unified_id = t.unified_id
        AND (uc.product_tier IS DISTINCT FROM t.new_tier
          OR uc.geography    IS DISTINCT FROM t.new_geo
          OR uc.is_indian    IS DISTINCT FROM t.new_indian)
    `);
    console.log(`[UnifiedSync] tier/geo/indian: ${tierGeoChanged} rows changed in ${((Date.now()-t1)/1000).toFixed(1)}s`);

    // ── Combined segment label + business_type (both: only write changed rows) ──
    const t2 = Date.now();
    const { rowCount: labelChanged } = await query(`
      UPDATE unified_contacts SET segment_label = new_label
      FROM (
        SELECT unified_id, CONCAT_WS(' / ', booking_status, product_tier, geography,
          CASE WHEN is_indian THEN 'INDIAN' END) AS new_label
        FROM unified_contacts
      ) t
      WHERE unified_contacts.unified_id = t.unified_id
        AND unified_contacts.segment_label IS DISTINCT FROM t.new_label
    `);
    const { rowCount: btChanged } = await query(`
      UPDATE unified_contacts
      SET business_type = CASE WHEN contact_type IN ('B2B','b2b') OR chat_departments LIKE '%B2B%' THEN 'B2B' ELSE 'B2C' END
      WHERE business_type IS DISTINCT FROM (CASE WHEN contact_type IN ('B2B','b2b') OR chat_departments LIKE '%B2B%' THEN 'B2B' ELSE 'B2C' END)
    `);
    console.log(`[UnifiedSync] segment_label: ${labelChanged} changed, business_type: ${btChanged} changed in ${((Date.now()-t2)/1000).toFixed(1)}s`);

    const { rows } = await query(`SELECT booking_status, COUNT(*) as cnt FROM unified_contacts GROUP BY booking_status ORDER BY cnt DESC`);
    console.log('[UnifiedSync] Segments computed:', rows.map(r => `${r.booking_status}: ${r.cnt}`).join(', '));
    return rows;
  }

  /**
   * Compute occasion segments — auto-enter users 14 days before their local holiday, auto-exit after
   */
  static async computeOccasions() {
    console.log('[UnifiedSync] Computing occasion segments...');

    // Step 1: Auto-enter — find upcoming holidays (within entry_days) and assign matching users
    const { rowCount: entered } = await query(`
      INSERT INTO user_occasions (unified_id, holiday_id)
      SELECT uc.unified_id, hc.id
      FROM unified_contacts uc
      JOIN holidays_calendar hc ON (
        uc.country = hc.country
        OR (uc.is_indian = true AND hc.country = 'India')
        OR (uc.geography = 'LOCAL' AND hc.country = 'United Arab Emirates')
      )
      WHERE hc.is_active = true
        AND hc.holiday_date >= CURRENT_DATE
        AND hc.holiday_date <= CURRENT_DATE + (hc.entry_days || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM user_occasions uo
          WHERE uo.unified_id = uc.unified_id AND uo.holiday_id = hc.id
        )
      ON CONFLICT (unified_id, holiday_id) DO NOTHING
    `);
    if (entered > 0) console.log(`[UnifiedSync] Occasion entries: ${entered}`);

    // Step 2: Auto-exit — mark occasions where the holiday has passed
    const { rowCount: exited } = await query(`
      UPDATE user_occasions uo SET
        status = 'exited',
        exited_at = NOW()
      FROM holidays_calendar hc
      WHERE uo.holiday_id = hc.id
        AND uo.status = 'active'
        AND hc.holiday_date < CURRENT_DATE
    `);
    if (exited > 0) console.log(`[UnifiedSync] Occasion exits: ${exited}`);

    // Step 3: Update unified_contacts with active occasion info
    // Set current_occasion on contacts who have an active occasion
    await query(`
      UPDATE unified_contacts uc SET
        current_occasion = sub.holiday_name,
        occasion_date = sub.holiday_date,
        occasion_offer_tag = sub.offer_tag
      FROM (
        SELECT DISTINCT ON (uo.unified_id)
          uo.unified_id, hc.holiday_name, hc.holiday_date, hc.offer_tag
        FROM user_occasions uo
        JOIN holidays_calendar hc ON hc.id = uo.holiday_id
        WHERE uo.status = 'active'
        ORDER BY uo.unified_id, hc.holiday_date ASC
      ) sub
      WHERE uc.unified_id = sub.unified_id
    `);

    // Clear occasion for contacts with no active occasion
    await query(`
      UPDATE unified_contacts SET
        current_occasion = NULL, occasion_date = NULL, occasion_offer_tag = NULL
      WHERE current_occasion IS NOT NULL
        AND unified_id NOT IN (
          SELECT unified_id FROM user_occasions WHERE status = 'active'
        )
    `);

    const { rows: [stats] } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int as active,
        COUNT(*) FILTER (WHERE status = 'exited')::int as exited
      FROM user_occasions
    `);
    console.log(`[UnifiedSync] Occasions: ${stats.active} active, ${stats.exited} exited`);
    return { entered, exited, active: stats.active };
  }

  /**
   * Run full incremental sync
   */
  static async run() {
    const start = Date.now();
    console.log('[UnifiedSync] Starting incremental sync...');

    const chatContacts = await this.refreshChatContacts();
    const contacts = await this.syncNewContacts();
    const chats = await this.syncChats();
    const rayna = await this.syncRaynaBookings();
    const newRayna = await this.syncNewRaynaContacts();
    const unsub = await this.syncUnsubscribed();
    const ga4gtm = await this.syncGA4GTM();
    const newGTM = await this.syncNewGTMContacts();
    const relinked = await this.relinkRawTables();
    const segments = await this.computeSegments();
    const occasions = await this.computeOccasions();

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[UnifiedSync] Done in ${duration}s`);

    return { chatContacts, contacts, chats, rayna, newRayna, unsub, ga4gtm, newGTM, relinked, segments, occasions, duration };
  }
}
