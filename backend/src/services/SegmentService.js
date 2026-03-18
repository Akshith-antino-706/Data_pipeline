import { query } from '../config/database.js';

export class SegmentService {

  /** Get all segments with aggregate stats */
  static async getSegmentOverview() {
    const { rows } = await query(`
      SELECT
        segment_label,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE identifier_type = 'email') AS email_contacts,
        COUNT(*) FILTER (WHERE identifier_type = 'whatsapp') AS wa_contacts,
        COUNT(*) FILTER (WHERE can_email) AS reachable_email,
        COUNT(*) FILTER (WHERE can_whatsapp) AS reachable_whatsapp,
        COUNT(*) FILTER (WHERE can_sms) AS reachable_sms,
        ROUND(AVG(frequency), 1) AS avg_frequency,
        ROUND(AVG(recency_days), 0) AS avg_recency_days,
        ROUND(AVG(total_bookings), 1) AS avg_bookings,
        COUNT(*) FILTER (WHERE gender = 'male') AS male,
        COUNT(*) FILTER (WHERE gender = 'female') AS female,
        COUNT(*) FILTER (WHERE gender IS NULL) AS gender_unknown
      FROM customer_segments
      GROUP BY segment_label
      ORDER BY total DESC
    `);
    return rows;
  }

  /** Get customers in a specific segment with pagination + filters */
  static async getSegmentCustomers(segmentLabel, { page = 1, limit = 50, search, channel, sortBy = 'frequency', sortDir = 'DESC' } = {}) {
    const offset = (page - 1) * limit;
    const conditions = ['segment_label = $1'];
    const params = [segmentLabel];
    let paramIdx = 2;

    if (search) {
      conditions.push(`(full_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (channel === 'email') conditions.push('can_email = TRUE');
    if (channel === 'whatsapp') conditions.push('can_whatsapp = TRUE');
    if (channel === 'sms') conditions.push('can_sms = TRUE');

    const allowedSorts = ['frequency', 'recency_days', 'total_bookings', 'monetary', 'last_interaction'];
    const sort = allowedSorts.includes(sortBy) ? sortBy : 'frequency';
    const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const where = conditions.join(' AND ');

    const [countResult, dataResult] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM customer_segments WHERE ${where}`, params),
      query(
        `SELECT email, identifier_type, full_name, phone_clean, country, nationality, gender,
                customer_type, segment_label, can_email, can_whatsapp, can_sms,
                total_bookings, total_chats, total_tickets, frequency, recency_days, monetary,
                last_interaction, enrichment_score
         FROM customer_segments
         WHERE ${where}
         ORDER BY ${sort} ${dir} NULLS LAST
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limit),
    };
  }

  /** Get segment stats by customer_type (B2B/B2C) */
  static async getSegmentByType() {
    const { rows } = await query(`
      SELECT
        customer_type,
        segment_label,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE can_email) AS can_email,
        COUNT(*) FILTER (WHERE can_whatsapp) AS can_whatsapp,
        ROUND(AVG(total_bookings), 1) AS avg_bookings,
        ROUND(AVG(frequency), 1) AS avg_frequency
      FROM customer_segments
      WHERE customer_type IS NOT NULL
      GROUP BY customer_type, segment_label
      ORDER BY customer_type, total DESC
    `);
    return rows;
  }

  /** Get nationality distribution for a segment */
  static async getSegmentNationalities(segmentLabel) {
    const { rows } = await query(`
      SELECT
        COALESCE(nationality, 'Unknown') AS nationality,
        COUNT(*) AS count
      FROM customer_segments
      WHERE segment_label = $1
      GROUP BY nationality
      ORDER BY count DESC
      LIMIT 20
    `, [segmentLabel]);
    return rows;
  }

  /** Get gender distribution for a segment */
  static async getSegmentGenders(segmentLabel) {
    const { rows } = await query(`
      SELECT
        COALESCE(gender, 'unknown') AS gender,
        COUNT(*) AS count
      FROM customer_segments
      WHERE segment_label = $1
      GROUP BY gender
      ORDER BY count DESC
    `, [segmentLabel]);
    return rows;
  }
}
