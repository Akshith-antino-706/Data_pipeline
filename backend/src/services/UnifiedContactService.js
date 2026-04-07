import pool from '../config/database.js';

export default class UnifiedContactService {

  static async getAll({ page = 1, limit = 50, search, sortBy, sortDir, source, country } = {}) {
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
    return rows[0] || null;
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
}
