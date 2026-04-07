import pool from '../config/database.js';

export default class CustomerService {

  static async getAll({ page = 1, limit = 50, search, sortBy, sortDir, country, city } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(u.name ILIKE $${idx} OR u.primary_email ILIKE $${idx} OR u.mobile ILIKE $${idx} OR u.company_name ILIKE $${idx})`);
      idx++;
    }
    if (country) {
      params.push(country);
      conditions.push(`u.country = $${idx}`);
      idx++;
    }
    if (city) {
      params.push(city);
      conditions.push(`u.city = $${idx}`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSort = {
      name: 'u.name', email: 'u.primary_email', company_name: 'u.company_name',
      city: 'u.city', country: 'u.country', created_at: 'u.created_at',
      total_chats: 'total_chats', total_tickets: 'total_tickets',
      total_bookings: 'total_bookings',
    };
    const col = allowedSort[sortBy] || 'u.created_at';
    const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*) AS total FROM users u ${where}`;
    const dataSql = `
      SELECT
        u.id, u.name, u.primary_email as email, u.mobile as phone,
        u.company_name, u.designation, u.city, u.cstate as state, u.country,
        u.contact_type, u.source, u.is_unsubscribed, u.is_hard_bounced,
        u.created_at, u.updated_at,
        COALESCE(ch.total_chats, 0) as total_chats,
        COALESCE(tk.total_tickets, 0) as total_tickets,
        COALESCE(tb.total_bookings, 0) as total_bookings
      FROM users u
      LEFT JOIN (SELECT user_id, COUNT(*) as total_chats FROM chats GROUP BY user_id) ch ON ch.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) as total_tickets FROM tickets GROUP BY user_id) tk ON tk.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) as total_bookings FROM travel_bookings GROUP BY user_id) tb ON tb.user_id = u.id
      ${where}
      ORDER BY ${col} ${dir} NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countSql, params),
      pool.query(dataSql, [...params, limit, offset]),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    return {
      data: dataRes.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  static async getById(id) {
    const { rows } = await pool.query(`
      SELECT
        u.*,
        COALESCE(ch.total_chats, 0) as total_chats,
        ch.first_chat_at, ch.last_chat_at, fm.first_msg_text, lm.last_message,
        COALESCE(tk.total_tickets, 0) as total_tickets,
        tk.first_ticket_at, tk.last_ticket_at,
        COALESCE(tb.total_bookings, 0) as total_bookings,
        tb.first_booking_at, tb.last_booking_at,
        em.emails,
        ph.phones
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) as total_chats,
          MIN(created_at) as first_chat_at, MAX(last_msg_at) as last_chat_at
        FROM chats GROUP BY user_id
      ) ch ON ch.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT first_msg_text FROM chats WHERE user_id = u.id AND first_msg_text IS NOT NULL LIMIT 1
      ) fm ON true
      LEFT JOIN LATERAL (
        SELECT last_short as last_message FROM chats WHERE user_id = u.id AND last_short IS NOT NULL ORDER BY last_msg_at DESC NULLS LAST LIMIT 1
      ) lm ON true
      LEFT JOIN (
        SELECT user_id, COUNT(*) as total_tickets,
          MIN(created_at) as first_ticket_at, MAX(updated_at) as last_ticket_at
        FROM tickets GROUP BY user_id
      ) tk ON tk.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as total_bookings,
          MIN(start_date) as first_booking_at, MAX(start_date) as last_booking_at
        FROM travel_bookings GROUP BY user_id
      ) tb ON tb.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(email, ', ') as emails FROM (
          SELECT email FROM user_emails WHERE user_id = u.id LIMIT 5
        ) x
      ) em ON true
      LEFT JOIN LATERAL (
        SELECT STRING_AGG(phone, ', ') as phones FROM (
          SELECT phone FROM user_phones WHERE user_id = u.id LIMIT 5
        ) x
      ) ph ON true
      WHERE u.id = $1
    `, [id]);
    return rows[0] || null;
  }

  static async getStats() {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users)::int AS total_customers,
        (SELECT COUNT(DISTINCT country) FROM users WHERE country IS NOT NULL)::int AS countries,
        (SELECT COUNT(*) FROM chats)::int AS total_chats,
        (SELECT COUNT(*) FROM tickets)::int AS total_tickets,
        (SELECT COUNT(*) FROM travel_bookings)::int AS total_bookings,
        (SELECT COUNT(DISTINCT user_id) FROM travel_bookings)::int AS customers_with_bookings
    `);
    return rows[0];
  }
}
