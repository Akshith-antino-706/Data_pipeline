import { query } from '../config/database.js';

const RAYNA_TABLES = [
  'rayna_tours', 'rayna_packages', 'rayna_hotels',
  'rayna_visas', 'rayna_flights', 'rayna_others',
];

export default class CustomSegmentService {

  /**
   * Convert a conditions array into parameterized WHERE clauses.
   * All conditions are ANDed. Returns { clauses, params, needsRevenueJoin, needsDateJoin }.
   */
  static buildWhereClause(conditions) {
    const clauses = [];
    const params = [];
    let idx = 1;
    let needsRevenueJoin = false;
    let needsTravelDate = false;
    let needsBookingDate = false;

    for (const cond of conditions) {
      switch (cond.field) {
        case 'booking_status': {
          const values = Array.isArray(cond.value) ? cond.value : [cond.value];
          if (values.length > 0) {
            const placeholders = values.map(v => { params.push(v); return `$${idx++}`; });
            clauses.push(`uc.booking_status IN (${placeholders.join(',')})`);
          }
          break;
        }
        case 'product_tier': {
          const values = Array.isArray(cond.value) ? cond.value : [cond.value];
          if (values.length > 0) {
            const placeholders = values.map(v => { params.push(v); return `$${idx++}`; });
            clauses.push(`uc.product_tier IN (${placeholders.join(',')})`);
          }
          break;
        }
        case 'geography': {
          const values = Array.isArray(cond.value) ? cond.value : [cond.value];
          if (values.length > 0) {
            const placeholders = values.map(v => { params.push(v); return `$${idx++}`; });
            clauses.push(`uc.geography IN (${placeholders.join(',')})`);
          }
          break;
        }
        case 'contact_type': {
          params.push(cond.value);
          clauses.push(`uc.contact_type = $${idx++}`);
          break;
        }
        case 'country': {
          if (Array.isArray(cond.value)) {
            const placeholders = cond.value.map(v => { params.push(v.toUpperCase()); return `$${idx++}`; });
            clauses.push(`UPPER(TRIM(uc.country)) IN (${placeholders.join(',')})`);
          } else {
            params.push(cond.value.toUpperCase());
            clauses.push(`UPPER(TRIM(uc.country)) = $${idx++}`);
          }
          break;
        }
        case 'is_indian': {
          params.push(cond.value === true || cond.value === 'yes');
          clauses.push(`uc.is_indian = $${idx++}`);
          break;
        }
        case 'wa_status': {
          if (cond.value === 'unsubscribed') {
            clauses.push(`uc.wa_unsubscribe = 'yes'`);
          } else {
            clauses.push(`(uc.wa_unsubscribe IS NULL OR uc.wa_unsubscribe <> 'yes')`);
          }
          break;
        }
        case 'email_status': {
          if (cond.value === 'unsubscribed') {
            clauses.push(`uc.email_unsubscribe = 'yes'`);
          } else {
            clauses.push(`(uc.email_unsubscribe IS NULL OR uc.email_unsubscribe <> 'yes')`);
          }
          break;
        }
        case 'source': {
          params.push(`%${cond.value}%`);
          clauses.push(`uc.sources ILIKE $${idx++}`);
          break;
        }
        case 'travel_date': {
          let tAdded = false;
          if (cond.value?.[0]) { params.push(cond.value[0]); clauses.push(`booking_agg.max_travel_date >= $${idx++}::date`); tAdded = true; }
          if (cond.value?.[1]) { params.push(cond.value[1]); clauses.push(`booking_agg.min_travel_date <= $${idx++}::date`); tAdded = true; }
          if (tAdded) needsTravelDate = true;
          break;
        }
        case 'booking_date': {
          let bAdded = false;
          if (cond.value?.[0]) { params.push(cond.value[0]); clauses.push(`booking_agg.max_booking_date >= $${idx++}::date`); bAdded = true; }
          if (cond.value?.[1]) { params.push(cond.value[1]); clauses.push(`booking_agg.min_booking_date <= $${idx++}::date`); bAdded = true; }
          if (bAdded) needsBookingDate = true;
          break;
        }
        case 'revenue': {
          if (cond.operator === 'between' && Array.isArray(cond.value)) {
            const [v0, v1] = cond.value;
            if (v0 !== '' && v0 != null) { params.push(Number(v0)); clauses.push(`COALESCE(rev_agg.total_revenue, 0) >= $${idx++}`); needsRevenueJoin = true; }
            if (v1 !== '' && v1 != null) { params.push(Number(v1)); clauses.push(`COALESCE(rev_agg.total_revenue, 0) <= $${idx++}`); needsRevenueJoin = true; }
          } else if (cond.operator === 'gte') {
            const v = Array.isArray(cond.value) ? cond.value[0] : cond.value;
            if (v !== '' && v != null) { params.push(Number(v)); clauses.push(`COALESCE(rev_agg.total_revenue, 0) >= $${idx++}`); needsRevenueJoin = true; }
          } else if (cond.operator === 'lte') {
            const v = Array.isArray(cond.value) ? (cond.value[1] ?? cond.value[0]) : cond.value;
            if (v !== '' && v != null) { params.push(Number(v)); clauses.push(`COALESCE(rev_agg.total_revenue, 0) <= $${idx++}`); needsRevenueJoin = true; }
          }
          break;
        }
      }
    }

    return { clauses, params, nextIdx: idx, needsRevenueJoin, needsTravelDate, needsBookingDate };
  }

  /**
   * Build full SQL with optional JOINs based on conditions.
   */
  static buildSegmentSQL(conditions, { select = 'COUNT(*)::int AS count', orderBy = '', limitOffset = '' } = {}) {
    const { clauses, params, nextIdx, needsRevenueJoin, needsTravelDate, needsBookingDate } =
      this.buildWhereClause(conditions);

    const needsDateJoin = needsTravelDate || needsBookingDate;
    const ctes = [];

    if (needsRevenueJoin) {
      ctes.push(`rev_agg AS (
        SELECT unified_id, COALESCE(SUM(selling_price::numeric), 0) AS total_revenue
        FROM (
          ${RAYNA_TABLES.map(t =>
            `SELECT unified_id, selling_price FROM ${t} WHERE is_cancel <> '1' AND unified_id IS NOT NULL`
          ).join(' UNION ALL ')}
        ) sub
        GROUP BY unified_id
      )`);
    }

    if (needsDateJoin) {
      ctes.push(`booking_agg AS (
        SELECT unified_id,
          MIN(CASE WHEN travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN travel_date::date END) AS min_travel_date,
          MAX(CASE WHEN travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN travel_date::date END) AS max_travel_date,
          MIN(CASE
            WHEN booking_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN booking_date::date
            WHEN booking_date ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN TO_DATE(booking_date, 'DD/MM/YYYY')
          END) AS min_booking_date,
          MAX(CASE
            WHEN booking_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN booking_date::date
            WHEN booking_date ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN TO_DATE(booking_date, 'DD/MM/YYYY')
          END) AS max_booking_date
        FROM (
          ${RAYNA_TABLES.map(t =>
            `SELECT unified_id, travel_date, booking_date FROM ${t} WHERE is_cancel <> '1' AND unified_id IS NOT NULL`
          ).join(' UNION ALL ')}
        ) sub
        GROUP BY unified_id
      )`);
    }

    const cteSql = ctes.length > 0 ? `WITH ${ctes.join(',\n')}` : '';
    const revenueJoin = needsRevenueJoin ? `LEFT JOIN rev_agg ON rev_agg.unified_id = uc.id` : '';
    const dateJoin = needsDateJoin ? `LEFT JOIN booking_agg ON booking_agg.unified_id = uc.id` : '';
    const whereSQL = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      ${cteSql}
      SELECT ${select}
      FROM unified_contacts uc
      ${revenueJoin}
      ${dateJoin}
      ${whereSQL}
      ${orderBy}
      ${limitOffset}
    `;

    return { sql, params, nextIdx };
  }

  // ── CRUD ────────────────────────────────────────────────

  static async create({ name, description, color, icon, conditions, status = 'active' }) {
    const count = await this.getCountPreview(conditions);

    const { rows: [seg] } = await query(`
      INSERT INTO custom_segments (name, description, color, icon, conditions, cached_count, cached_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
      RETURNING *
    `, [name, description || null, color || '#3b82f6', icon || 'Filter', JSON.stringify(conditions), count, status]);
    return seg;
  }

  static async update(id, { name, description, color, icon, conditions, status }) {
    const updates = [];
    const params = [];
    let idx = 1;

    if (name !== undefined)        { params.push(name);        updates.push(`name = $${idx++}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${idx++}`); }
    if (color !== undefined)       { params.push(color);       updates.push(`color = $${idx++}`); }
    if (icon !== undefined)        { params.push(icon);        updates.push(`icon = $${idx++}`); }
    if (status !== undefined)      { params.push(status);      updates.push(`status = $${idx++}`); }
    if (conditions !== undefined) {
      params.push(JSON.stringify(conditions)); updates.push(`conditions = $${idx++}`);
      const count = await this.getCountPreview(conditions);
      params.push(count); updates.push(`cached_count = $${idx++}`);
      updates.push(`cached_at = NOW()`);
    }
    updates.push(`updated_at = NOW()`);

    params.push(id);
    const { rows: [seg] } = await query(
      `UPDATE custom_segments SET ${updates.join(', ')} WHERE id = $${idx} AND is_active = true RETURNING *`, params
    );
    return seg || null;
  }

  static async delete(id) {
    await query('UPDATE custom_segments SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
  }

  static async getAll({ status } = {}) {
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, created_at, updated_at';
    let sql = `SELECT ${cols} FROM custom_segments WHERE is_active = true`;
    const params = [];
    if (status) {
      params.push(status);
      sql += ` AND status = $1`;
    }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query(sql, params);
    return rows;
  }

  static async getById(id) {
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, created_at, updated_at';
    const { rows: [seg] } = await query(`SELECT ${cols} FROM custom_segments WHERE id = $1 AND is_active = true`, [id]);
    return seg || null;
  }

  // ── Count Preview ────────────────────────────────────────

  static async getCountPreview(conditions) {
    if (!conditions || conditions.length === 0) {
      const { rows: [r] } = await query('SELECT COUNT(*)::int AS count FROM unified_contacts');
      return r.count;
    }
    const { sql, params } = this.buildSegmentSQL(conditions);
    const { rows: [r] } = await query(sql, params);
    return r.count;
  }

  // ── Get Customers ────────────────────────────────────────

  static async getCustomers(id, { page = 1, limit = 25, search } = {}) {
    const seg = await this.getById(id);
    if (!seg) return null;

    const conditions = seg.conditions || [];

    const { clauses: condClauses, params: condParams, nextIdx, needsRevenueJoin, needsTravelDate, needsBookingDate } =
      this.buildWhereClause(conditions);

    const clauses = [...condClauses];
    const params = [...condParams];
    let pIdx = nextIdx;

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(uc.name ILIKE $${pIdx} OR uc.email ILIKE $${pIdx} OR uc.mobile ILIKE $${pIdx})`);
      pIdx++;
    }

    // Count (uses CTEs via buildSegmentSQL)
    const countBuild = this.buildSegmentSQL(conditions);
    const { rows: [countRow] } = await query(countBuild.sql, countBuild.params);
    const total = countRow.count;

    // Data query with CTEs instead of LATERAL JOINs
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const selectCols = `uc.id, uc.name, uc.email, uc.mobile, uc.country, uc.city, uc.sources,
      uc.contact_type, uc.booking_status, uc.product_tier, uc.geography, uc.is_indian,
      uc.wa_unsubscribe, uc.email_unsubscribe, uc.created_at`;

    const needsDateJoin = needsTravelDate || needsBookingDate;
    const ctes = [];

    if (needsRevenueJoin) {
      ctes.push(`rev_agg AS (
        SELECT unified_id, COALESCE(SUM(selling_price::numeric), 0) AS total_revenue
        FROM (
          ${RAYNA_TABLES.map(t =>
            `SELECT unified_id, selling_price FROM ${t} WHERE is_cancel <> '1' AND unified_id IS NOT NULL`
          ).join(' UNION ALL ')}
        ) sub
        GROUP BY unified_id
      )`);
    }

    if (needsDateJoin) {
      ctes.push(`booking_agg AS (
        SELECT unified_id,
          MIN(CASE WHEN travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN travel_date::date END) AS min_travel_date,
          MAX(CASE WHEN travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN travel_date::date END) AS max_travel_date,
          MIN(CASE
            WHEN booking_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN booking_date::date
            WHEN booking_date ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN TO_DATE(booking_date, 'DD/MM/YYYY')
          END) AS min_booking_date,
          MAX(CASE
            WHEN booking_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN booking_date::date
            WHEN booking_date ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN TO_DATE(booking_date, 'DD/MM/YYYY')
          END) AS max_booking_date
        FROM (
          ${RAYNA_TABLES.map(t =>
            `SELECT unified_id, travel_date, booking_date FROM ${t} WHERE is_cancel <> '1' AND unified_id IS NOT NULL`
          ).join(' UNION ALL ')}
        ) sub
        GROUP BY unified_id
      )`);
    }

    const cteSql = ctes.length > 0 ? `WITH ${ctes.join(',\n')}` : '';
    const revenueJoin = needsRevenueJoin ? `LEFT JOIN rev_agg ON rev_agg.unified_id = uc.id` : '';
    const dateJoin = needsDateJoin ? `LEFT JOIN booking_agg ON booking_agg.unified_id = uc.id` : '';
    const whereSQL = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      ${cteSql}
      SELECT ${selectCols}
      FROM unified_contacts uc
      ${revenueJoin}
      ${dateJoin}
      ${whereSQL}
      ORDER BY uc.created_at DESC
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    const { rows } = await query(sql, params);

    return {
      data: rows,
      total,
      page, limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
