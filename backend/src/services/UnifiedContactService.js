import pool from '../config/database.js';

export default class UnifiedContactService {

  static async getAll({ page = 1, limit = 50, search, sortBy, sortDir, source, country,
    contactType, bookingStatus, productTier, geography, hasChats, hasBookings, waStatus, emailStatus } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx} OR phone_key ILIKE $${idx} OR company_name ILIKE $${idx})`);
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
    if (hasChats === 'yes') conditions.push(`total_chats > 0`);
    else if (hasChats === 'no') conditions.push(`(total_chats = 0 OR total_chats IS NULL)`);
    if (hasBookings === 'yes') conditions.push(`total_travel_bookings > 0`);
    else if (hasBookings === 'no') conditions.push(`(total_travel_bookings = 0 OR total_travel_bookings IS NULL)`);
    if (waStatus === 'unsubscribed') conditions.push(`wa_unsubscribed = 'Yes'`);
    else if (waStatus === 'active') conditions.push(`(wa_unsubscribed IS NULL OR wa_unsubscribed = 'No')`);
    if (emailStatus === 'unsubscribed') conditions.push(`email_unsubscribed = 'Yes'`);
    else if (emailStatus === 'active') conditions.push(`(email_unsubscribed IS NULL OR email_unsubscribed = 'No')`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSort = ['name', 'email', 'company_name', 'country', 'total_chats', 'total_tickets',
      'total_travel_bookings', 'total_tour_bookings', 'total_booking_revenue', 'last_seen_at', 'created_at'];
    const col = allowedSort.includes(sortBy) ? sortBy : 'last_seen_at';
    const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM unified_contacts ${where}`, params),
      pool.query(
        `SELECT unified_id, phone_key, email_key, name, email, phone, company_name, city, country, contact_type,
                total_chats, total_travel_bookings,
                total_tour_bookings, total_hotel_bookings, total_visa_bookings, total_flight_bookings,
                total_booking_revenue, sources,
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
      sources: ['chat', 'ticket', 'travel', 'rayna'],
    };
  }

  static async getStats() {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total_contacts,
        COUNT(*) FILTER (WHERE total_chats > 0)::int AS with_chats,
        COUNT(*) FILTER (WHERE total_travel_bookings > 0)::int AS with_travel,
        COUNT(*) FILTER (WHERE total_tour_bookings > 0 OR total_hotel_bookings > 0 OR total_visa_bookings > 0 OR total_flight_bookings > 0)::int AS with_rayna,
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
  static async getSegmentationTree() {
    // Step 1: Booking status counts
    const { rows: statusCounts } = await pool.query(`
      SELECT booking_status, COUNT(*)::int AS count,
        COALESCE(SUM(total_booking_revenue), 0)::numeric AS revenue,
        COUNT(*) FILTER (WHERE total_chats > 0)::int AS with_chats,
        COUNT(*) FILTER (WHERE is_indian)::int AS indian_count
      FROM unified_contacts
      WHERE booking_status IS NOT NULL
      GROUP BY booking_status
      ORDER BY CASE booking_status
        WHEN 'ON_TRIP' THEN 1 WHEN 'FUTURE_TRAVEL' THEN 2 WHEN 'ACTIVE_ENQUIRY' THEN 3
        WHEN 'PAST_BOOKING' THEN 4 WHEN 'PAST_ENQUIRY' THEN 5 WHEN 'PROSPECT' THEN 6 END
    `);

    // Step 2+3: Full breakdown (booking_status x product_tier x geography)
    const { rows: breakdown } = await pool.query(`
      SELECT booking_status, product_tier, geography,
        COUNT(*)::int AS count,
        COALESCE(SUM(total_booking_revenue), 0)::numeric AS revenue,
        COALESCE(AVG(total_booking_revenue) FILTER (WHERE total_booking_revenue > 0), 0)::numeric AS avg_revenue,
        COUNT(*) FILTER (WHERE is_indian)::int AS indian_count,
        COUNT(*) FILTER (WHERE total_chats > 0)::int AS with_chats,
        COALESCE(SUM(total_tour_bookings), 0)::int AS total_tours,
        COALESCE(SUM(total_hotel_bookings), 0)::int AS total_hotels,
        COALESCE(SUM(total_visa_bookings), 0)::int AS total_visas,
        COALESCE(SUM(total_flight_bookings), 0)::int AS total_flights
      FROM unified_contacts
      WHERE booking_status IS NOT NULL
      GROUP BY booking_status, product_tier, geography
      ORDER BY booking_status, product_tier NULLS LAST, geography NULLS LAST
    `);

    // Totals
    const { rows: [totals] } = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE booking_status IS NOT NULL)::int AS segmented,
        COUNT(DISTINCT segment_label) FILTER (WHERE segment_label IS NOT NULL)::int AS segment_count,
        COALESCE(SUM(total_booking_revenue), 0)::numeric AS total_revenue
      FROM unified_contacts
    `);

    return { totals, statusCounts, breakdown };
  }

  /**
   * Get customers for a specific segment combination
   */
  static async getSegmentCustomers({ bookingStatus, productTier, geography, page = 1, limit = 25, search } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

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
                total_chats, total_travel_bookings, total_tour_bookings, total_hotel_bookings,
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
