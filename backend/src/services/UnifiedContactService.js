import pool from '../config/database.js';

export default class UnifiedContactService {

  static async getAll({ page = 1, limit = 50, search, sortBy, sortDir, source, country,
    contactType, businessType, bookingStatus, productTier, geography, chatDepartment, hasChats, hasBookings, waStatus, emailStatus } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      params.push(`%${search}%`);
      // Detect search type for optimal index usage (trigram GIN indexes)
      const isPhone = /^\+?\d[\d\s\-]{5,}$/.test(search.trim());
      const isEmail = search.includes('@');
      if (isPhone) {
        conditions.push(`(phone ILIKE $${idx} OR phone_key ILIKE $${idx})`);
      } else if (isEmail) {
        conditions.push(`email ILIKE $${idx}`);
      } else {
        conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR company_name ILIKE $${idx})`);
      }
      idx++;
    }
    if (source) {
      params.push(`%${source}%`);
      conditions.push(`sources LIKE $${idx}`);
      idx++;
    }
    if (country) {
      params.push(country);
      conditions.push(`country = $${idx}`);
      idx++;
    }
    if (contactType) {
      params.push(contactType);
      conditions.push(`contact_type = $${idx}`);
      idx++;
    }
    if (businessType) {
      params.push(businessType);
      conditions.push(`business_type = $${idx}`);
      idx++;
    }
    if (bookingStatus) {
      params.push(bookingStatus);
      conditions.push(`booking_status = $${idx}`);
      idx++;
    }
    if (productTier) {
      params.push(productTier);
      conditions.push(`product_tier = $${idx}`);
      idx++;
    }
    if (geography) {
      params.push(geography);
      conditions.push(`geography = $${idx}`);
      idx++;
    }
    if (chatDepartment) {
      params.push(`%${chatDepartment}%`);
      conditions.push(`chat_departments LIKE $${idx}`);
      idx++;
    }
    if (hasChats === 'yes') conditions.push(`total_chats > 0`);
    else if (hasChats === 'no') conditions.push(`(total_chats = 0 OR total_chats IS NULL)`);
    if (hasBookings === 'yes') conditions.push(`(total_tour_bookings > 0 OR total_hotel_bookings > 0 OR total_visa_bookings > 0 OR total_flight_bookings > 0)`);
    else if (hasBookings === 'no') conditions.push(`(COALESCE(total_tour_bookings,0) + COALESCE(total_hotel_bookings,0) + COALESCE(total_visa_bookings,0) + COALESCE(total_flight_bookings,0) = 0)`);
    if (waStatus === 'unsubscribed') conditions.push(`wa_unsubscribed = 'Yes'`);
    else if (waStatus === 'active') conditions.push(`(wa_unsubscribed IS NULL OR wa_unsubscribed = 'No')`);
    if (emailStatus === 'unsubscribed') conditions.push(`email_unsubscribed = 'Yes'`);
    else if (emailStatus === 'active') conditions.push(`(email_unsubscribed IS NULL OR email_unsubscribed = 'No')`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSort = ['name', 'email', 'company_name', 'country', 'total_chats', 'total_tickets',
      'total_tour_bookings', 'total_booking_revenue', 'last_seen_at', 'created_at'];
    const col = allowedSort.includes(sortBy) ? sortBy : 'last_seen_at';
    const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM unified_contacts ${where}`, params),
      pool.query(
        `SELECT unified_id, phone_key, email_key, name, email, phone, company_name, city, country, contact_type,
                total_chats,
                total_tour_bookings, total_hotel_bookings, total_visa_bookings, total_flight_bookings,
                total_booking_revenue, sources, chat_departments,
                booking_status, product_tier, geography, is_indian, segment_label,
                wa_unsubscribed, email_unsubscribed,
                last_seen_at, created_at
         FROM unified_contacts ${where}
         ORDER BY ${col} ${dir} NULLS LAST
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataRes.rows,
      total: parseInt(countRes.rows[0].total, 10),
      page, limit,
      totalPages: Math.ceil(parseInt(countRes.rows[0].total, 10) / limit),
    };
  }

  static async getById(id) {
    const { rows } = await pool.query('SELECT * FROM unified_contacts WHERE unified_id = $1', [id]);
    const contact = rows[0] || null;
    if (!contact) return null;

    // Fetch detailed booking records linked by unified_id
    const [tours, hotels, visas, flights] = await Promise.all([
      pool.query(`
        SELECT billno, bill_date, tour_date, guest_name, tours_name, nationality,
               agent_name, status, adult, child, infant, total_sell
        FROM rayna_tours WHERE unified_id = $1 ORDER BY tour_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT billno, bill_date, check_in_date, guest_name, hotel_name, country_name,
               agent_name, no_of_rooms, total_sell
        FROM rayna_hotels WHERE unified_id = $1 ORDER BY check_in_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT billno, bill_date, guest_name, visa_type, nationality, country_name,
               agent_name, status, total_sell, apply_date, applicant_name, passport_number
        FROM rayna_visas WHERE unified_id = $1 ORDER BY bill_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT billno, bill_date, guest_name, passenger_name, flight_no, airport_name,
               from_datetime, agent_name, status, selling_price
        FROM rayna_flights WHERE unified_id = $1 ORDER BY from_datetime DESC NULLS LAST LIMIT 100
      `, [id]),
    ]);

    contact.rayna_tours = tours.rows;
    contact.rayna_hotels = hotels.rows;
    contact.rayna_visas = visas.rows;
    contact.rayna_flights = flights.rows;

    // Fetch chats linked by phone_key
    if (contact.phone_key) {
      const { rows: chatRows } = await pool.query(`
        SELECT id, wa_id, wa_name, country, status, tags,
               last_msg_at, last_short, first_msg_text, created_at
        FROM chats WHERE wa_id LIKE '%' || $1
        ORDER BY last_msg_at DESC NULLS LAST LIMIT 50
      `, [contact.phone_key]);
      contact.chats_list = chatRows;
    } else {
      contact.chats_list = [];
    }

    return contact;
  }

  static async getFilterOptions() {
    const [countries, statuses, tiers, geos] = await Promise.all([
      pool.query(`SELECT country, COUNT(*)::int as cnt FROM unified_contacts WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY cnt DESC LIMIT 50`),
      pool.query(`SELECT DISTINCT booking_status FROM unified_contacts WHERE booking_status IS NOT NULL ORDER BY booking_status`),
      pool.query(`SELECT DISTINCT product_tier FROM unified_contacts WHERE product_tier IS NOT NULL ORDER BY product_tier`),
      pool.query(`SELECT DISTINCT geography FROM unified_contacts WHERE geography IS NOT NULL ORDER BY geography`),
    ]);
    return {
      countries: countries.rows.map(r => r.country),
      contactTypes: ['B2B', 'B2C'],
      bookingStatuses: statuses.rows.map(r => r.booking_status),
      productTiers: tiers.rows.map(r => r.product_tier),
      geographies: geos.rows.map(r => r.geography),
      sources: ['chat', 'contacts', 'rayna', 'ga4'],
    };
  }

  static async getStats() {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total_contacts,
        COUNT(*) FILTER (WHERE total_chats > 0)::int AS with_chats,
        COUNT(*) FILTER (WHERE total_tour_bookings > 0 OR total_hotel_bookings > 0 OR total_visa_bookings > 0 OR total_flight_bookings > 0)::int AS with_travel,
        COUNT(*) FILTER (WHERE sources LIKE '%,%')::int AS multi_source,
        COUNT(DISTINCT country)::int AS countries,
        COALESCE(SUM(total_booking_revenue), 0)::numeric AS total_revenue
      FROM unified_contacts
    `);
    return rows[0];
  }

  /**
   * Segmentation dashboard: 3-step decision tree overview
   */
  static async getSegmentationTree({ businessType } = {}) {
    // Business type filter — uses precomputed indexed column for fast queries
    // btFilter removed — now uses materialized view with btWhere

    // Uses materialized view for fast queries (refreshed after each sync)
    const btWhere = businessType ? `WHERE business_type = '${businessType}'` : 'WHERE 1=1';

    // Step 1: Booking status counts (from materialized view — <1ms)
    const { rows: statusCounts } = await pool.query(`
      SELECT booking_status,
        SUM(count)::int AS count,
        SUM(revenue)::numeric AS revenue,
        SUM(with_chats)::int AS with_chats,
        SUM(indian_count)::int AS indian_count
      FROM mv_segmentation_tree
      ${btWhere}
      GROUP BY booking_status
      ORDER BY CASE booking_status
        WHEN 'ON_TRIP' THEN 1 WHEN 'FUTURE_TRAVEL' THEN 2 WHEN 'ACTIVE_ENQUIRY' THEN 3
        WHEN 'PAST_BOOKING' THEN 4 WHEN 'PAST_ENQUIRY' THEN 5 WHEN 'PROSPECT' THEN 6 END
    `);

    // Step 2+3: Full breakdown (already pre-aggregated in materialized view)
    const { rows: breakdown } = await pool.query(`
      SELECT booking_status, product_tier, geography,
        count, revenue, avg_revenue, indian_count, with_chats,
        total_tours, total_hotels, total_visas, total_flights
      FROM mv_segmentation_tree
      ${btWhere}
      ORDER BY booking_status, product_tier NULLS LAST, geography NULLS LAST
    `);

    // Totals
    const { rows: [totals] } = await pool.query(`
      SELECT SUM(count)::int AS total,
        SUM(count)::int AS segmented,
        COUNT(DISTINCT booking_status || COALESCE(product_tier,'') || COALESCE(geography,''))::int AS segment_count,
        SUM(revenue)::numeric AS total_revenue
      FROM mv_segmentation_tree
      ${btWhere}
    `);

    return { totals, statusCounts, breakdown };
  }

  /**
   * Get customers for a specific segment combination
   */
  /**
   * Snapshot daily segment counts into segment_daily_log
   * Called by cron after computeSegments() completes
   */
  static async snapshotDailySegments() {
    const today = new Date().toISOString().slice(0, 10);

    // Current segment counts
    const { rows: segments } = await pool.query(`
      SELECT booking_status as segment_label, COUNT(*)::int as total_count,
        COALESCE(SUM(total_booking_revenue), 0)::numeric as revenue
      FROM unified_contacts
      WHERE booking_status IS NOT NULL
      GROUP BY booking_status
    `);

    // Journey entries/exits/conversions today
    const { rows: journeyStats } = await pool.query(`
      SELECT
        jf.nodes->0->'data'->>'segmentLabel' as segment_label,
        COUNT(*) FILTER (WHERE je.entered_at::date = $1)::int as entered,
        COUNT(*) FILTER (WHERE je.completed_at::date = $1 AND je.status = 'exited')::int as exited,
        COUNT(*) FILTER (WHERE je.converted_at::date = $1)::int as converted,
        COUNT(*) FILTER (WHERE je.status = 'active')::int as journey_active,
        COUNT(*) FILTER (WHERE je.status = 'completed' OR je.status = 'converted')::int as journey_completed
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      GROUP BY jf.nodes->0->'data'->>'segmentLabel'
    `, [today]);

    // Messages sent today
    const { rows: msgStats } = await pool.query(`
      SELECT segment_label,
        SUM(CASE WHEN channel = 'email' THEN sent_count ELSE 0 END)::int as emails_sent,
        SUM(CASE WHEN channel = 'whatsapp' THEN sent_count ELSE 0 END)::int as whatsapp_sent,
        SUM(CASE WHEN channel = 'push' THEN sent_count ELSE 0 END)::int as push_sent
      FROM campaigns
      GROUP BY segment_label
    `);

    const journeyMap = Object.fromEntries(journeyStats.map(r => [r.segment_label, r]));
    const msgMap = Object.fromEntries(msgStats.map(r => [r.segment_label, r]));

    for (const seg of segments) {
      const js = journeyMap[seg.segment_label] || {};
      const ms = msgMap[seg.segment_label] || {};
      const emailsSent = ms.emails_sent || 0;
      const whatsappSent = ms.whatsapp_sent || 0;
      const pushSent = ms.push_sent || 0;

      await pool.query(`
        INSERT INTO segment_daily_log (log_date, segment_label, total_count, entered, exited, converted,
          emails_sent, whatsapp_sent, push_sent, total_reached, journey_active, journey_completed, revenue)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (log_date, segment_label) DO UPDATE SET
          total_count = EXCLUDED.total_count, entered = EXCLUDED.entered, exited = EXCLUDED.exited,
          converted = EXCLUDED.converted, emails_sent = EXCLUDED.emails_sent, whatsapp_sent = EXCLUDED.whatsapp_sent,
          push_sent = EXCLUDED.push_sent, total_reached = EXCLUDED.total_reached,
          journey_active = EXCLUDED.journey_active, journey_completed = EXCLUDED.journey_completed,
          revenue = EXCLUDED.revenue
      `, [today, seg.segment_label, seg.total_count,
          js.entered || 0, js.exited || 0, js.converted || 0,
          emailsSent, whatsappSent, pushSent,
          emailsSent + whatsappSent + pushSent,
          js.journey_active || 0, js.journey_completed || 0,
          seg.revenue]);
    }

    console.log(`[SegmentLog] Snapshot for ${today}: ${segments.length} segments logged`);
    return { date: today, segments: segments.length };
  }

  /**
   * Get segment daily activity log
   */
  static async getSegmentDailyLog({ days = 30, segment, businessType } = {}) {
    const conditions = ['log_date >= CURRENT_DATE - $1::int'];
    const params = [days];

    if (segment) {
      params.push(segment);
      conditions.push(`segment_label = $${params.length}`);
    }

    const { rows } = await pool.query(`
      SELECT * FROM segment_daily_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY log_date DESC, segment_label
    `, params);

    // Live counts filtered by business_type
    const liveConds = ['booking_status IS NOT NULL'];
    const liveParams = [];
    if (businessType) {
      liveParams.push(businessType);
      liveConds.push(`business_type = $${liveParams.length}`);
    }

    const { rows: liveToday } = await pool.query(`
      SELECT booking_status as segment_label, COUNT(*)::int as total_count,
        COALESCE(SUM(total_booking_revenue), 0)::numeric as revenue
      FROM unified_contacts
      WHERE ${liveConds.join(' AND ')}
      GROUP BY booking_status
      ORDER BY CASE booking_status
        WHEN 'ON_TRIP' THEN 1 WHEN 'FUTURE_TRAVEL' THEN 2 WHEN 'ACTIVE_ENQUIRY' THEN 3
        WHEN 'PAST_BOOKING' THEN 4 WHEN 'PAST_ENQUIRY' THEN 5 WHEN 'PROSPECT' THEN 6 END
    `, liveParams);

    return { logs: rows, liveToday };
  }

  static async getSegmentCustomers({ bookingStatus, productTier, geography, businessType, page = 1, limit = 25, search } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (businessType) { params.push(businessType); conditions.push(`business_type = $${idx++}`); }
    if (bookingStatus) { params.push(bookingStatus); conditions.push(`booking_status = $${idx++}`); }
    if (productTier) { params.push(productTier); conditions.push(`product_tier = $${idx++}`); }
    if (geography) { params.push(geography); conditions.push(`geography = $${idx++}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`); idx++; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM unified_contacts ${where}`, params),
      pool.query(
        `SELECT unified_id, name, email, phone, company_name, country, contact_type,
                total_chats, total_tour_bookings, total_hotel_bookings,
                total_visa_bookings, total_flight_bookings, total_booking_revenue,
                booking_status, product_tier, geography, is_indian, segment_label,
                last_seen_at
         FROM unified_contacts ${where}
         ORDER BY total_booking_revenue DESC NULLS LAST, last_seen_at DESC NULLS LAST
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataRes.rows,
      total: parseInt(countRes.rows[0].total, 10),
      page, limit,
      totalPages: Math.ceil(parseInt(countRes.rows[0].total, 10) / limit),
    };
  }
}
