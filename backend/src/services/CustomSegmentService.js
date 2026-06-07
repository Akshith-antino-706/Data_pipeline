import { query } from '../config/database.js';

const RAYNA_TABLES = [
  'rayna_tours', 'rayna_packages', 'rayna_hotels',
  'rayna_visas', 'rayna_flights', 'rayna_others',
];

export default class CustomSegmentService {

  /**
   * Convert a conditions array into parameterized WHERE clauses.
   * Returns { clauseItems: [{clause, joinOp}], params, nextIdx, needsRevenueJoin, needsTravelDate, needsBookingDate }.
   * joinOp on clauseItems[i] = operator connecting clauseItems[i] to clauseItems[i+1].
   */
  static buildWhereClause(conditions) {
    const clauseItems = [];
    const params = [];
    let idx = 1;
    let needsRevenueJoin = false;
    let needsTravelDate = false;
    let needsBookingDate = false;

    for (const cond of conditions) {
      const sub = [];

      if (cond.type === 'gtm') {
        if (cond.gtmEvent) {
          params.push(cond.gtmEvent);
          sub.push(`EXISTS (SELECT 1 FROM gtm_events ge WHERE ge.unified_id = uc.id AND ge.event_name = $${idx++})`);
        }
      } else {
        switch (cond.field) {
          case 'name': {
            params.push(`%${cond.value}%`);
            sub.push(`uc.name ILIKE $${idx++}`);
            break;
          }
          case 'email': {
            const emails = Array.isArray(cond.value) ? cond.value : [cond.value];
            const placeholders = emails.map(v => { params.push(v.toLowerCase()); return `$${idx++}`; });
            sub.push(`LOWER(uc.email) IN (${placeholders.join(',')})`);
            break;
          }
          case 'booking_status': {
            const values = Array.isArray(cond.value) ? cond.value : [cond.value];
            const placeholders = values.map(v => { params.push(v); return `$${idx++}`; });
            sub.push(`uc.booking_status IN (${placeholders.join(',')})`);
            break;
          }
          case 'product_tier': {
            const values = Array.isArray(cond.value) ? cond.value : [cond.value];
            const placeholders = values.map(v => { params.push(v); return `$${idx++}`; });
            sub.push(`uc.product_tier IN (${placeholders.join(',')})`);
            break;
          }
          case 'geography': {
            const values = Array.isArray(cond.value) ? cond.value : [cond.value];
            const placeholders = values.map(v => { params.push(v); return `$${idx++}`; });
            sub.push(`uc.geography IN (${placeholders.join(',')})`);
            break;
          }
          case 'contact_type': {
            params.push(cond.value);
            sub.push(`uc.contact_type = $${idx++}`);
            break;
          }
          case 'country': {
            if (Array.isArray(cond.value)) {
              const placeholders = cond.value.map(v => { params.push(v.toUpperCase()); return `$${idx++}`; });
              sub.push(`UPPER(TRIM(uc.country)) IN (${placeholders.join(',')})`);
            } else {
              params.push(cond.value.toUpperCase());
              sub.push(`UPPER(TRIM(uc.country)) = $${idx++}`);
            }
            break;
          }
          case 'mobile_country': {
            // Free-text country name (e.g. India, UAE, United States) — case-insensitive
            if (Array.isArray(cond.value)) {
              const placeholders = cond.value.map(v => { params.push(String(v).toUpperCase()); return `$${idx++}`; });
              sub.push(`UPPER(TRIM(uc.mobile_country)) IN (${placeholders.join(',')})`);
            } else {
              params.push(String(cond.value).toUpperCase());
              sub.push(`UPPER(TRIM(uc.mobile_country)) = $${idx++}`);
            }
            break;
          }
          case 'wa_last_msg': {
            // WhatsApp last message date range — joins the chats table by unified_id.
            // cond.value = [startDate, endDate] (either may be empty).
            const start = cond.value?.[0];
            const end   = cond.value?.[1];
            const parts = ['c.unified_id = uc.id'];
            if (start) { params.push(start); parts.push(`c.last_msg_at >= $${idx++}::date`); }
            if (end)   { params.push(end);   parts.push(`c.last_msg_at < ($${idx++}::date + 1)`); } // inclusive end day
            sub.push(`EXISTS (SELECT 1 FROM chats c WHERE ${parts.join(' AND ')})`);
            break;
          }
          case 'is_indian': {
            params.push(cond.value === true || cond.value === 'yes');
            sub.push(`uc.is_indian = $${idx++}`);
            break;
          }
          case 'wa_status': {
            sub.push(cond.value === 'unsubscribed'
              ? `LOWER(uc.wa_unsubscribe) = 'yes'`
              : `(uc.wa_unsubscribe IS NULL OR LOWER(uc.wa_unsubscribe) <> 'yes')`);
            break;
          }
          case 'email_status': {
            sub.push(cond.value === 'unsubscribed'
              ? `LOWER(uc.email_unsubscribe) = 'yes'`
              : `(uc.email_unsubscribe IS NULL OR LOWER(uc.email_unsubscribe) <> 'yes')`);
            break;
          }
          case 'source': {
            params.push(`%${cond.value}%`);
            sub.push(`uc.sources ILIKE $${idx++}`);
            break;
          }
          case 'travel_date': {
            if (cond.value?.[0]) { needsTravelDate = true; params.push(cond.value[0]); sub.push(`booking_agg.max_travel_date >= $${idx++}::date`); }
            if (cond.value?.[1]) { needsTravelDate = true; params.push(cond.value[1]); sub.push(`booking_agg.min_travel_date <= $${idx++}::date`); }
            break;
          }
          case 'booking_date': {
            if (cond.value?.[0]) { needsBookingDate = true; params.push(cond.value[0]); sub.push(`booking_agg.max_booking_date >= $${idx++}::date`); }
            if (cond.value?.[1]) { needsBookingDate = true; params.push(cond.value[1]); sub.push(`booking_agg.min_booking_date <= $${idx++}::date`); }
            break;
          }
          case 'revenue': {
            if (cond.operator === 'between' && Array.isArray(cond.value)) {
              const [min, max] = cond.value;
              if (min !== '' && min != null) { needsRevenueJoin = true; params.push(Number(min)); sub.push(`COALESCE(rev_agg.total_revenue, 0) >= $${idx++}`); }
              if (max !== '' && max != null) { needsRevenueJoin = true; params.push(Number(max)); sub.push(`COALESCE(rev_agg.total_revenue, 0) <= $${idx++}`); }
            } else if (cond.operator === 'gte' && cond.value !== '' && cond.value != null) {
              needsRevenueJoin = true; params.push(Number(cond.value)); sub.push(`COALESCE(rev_agg.total_revenue, 0) >= $${idx++}`);
            } else if (cond.operator === 'lte' && cond.value !== '' && cond.value != null) {
              needsRevenueJoin = true; params.push(Number(cond.value)); sub.push(`COALESCE(rev_agg.total_revenue, 0) <= $${idx++}`);
            }
            break;
          }
        }
      }

      if (sub.length > 0) {
        const combined = sub.length === 1 ? sub[0] : `(${sub.join(' AND ')})`;
        clauseItems.push({
          clause: cond.exclude ? `NOT (${combined})` : combined,
          joinOp: cond.joinOp || 'AND',
        });
      }
    }

    return { clauseItems, params, nextIdx: idx, needsRevenueJoin, needsTravelDate, needsBookingDate };
  }

  /**
   * Build full SQL with optional JOINs based on conditions.
   * WHERE is built using per-condition joinOp from clauseItems.
   */
  static buildSegmentSQL(conditions, { select = 'COUNT(*)::int AS count', orderBy = '', limitOffset = '' } = {}) {
    const { clauseItems, params, nextIdx, needsRevenueJoin, needsTravelDate, needsBookingDate } =
      this.buildWhereClause(conditions);

    const needsDateJoin = needsTravelDate || needsBookingDate;

    const revenueJoin = needsRevenueJoin ? `
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(sub.selling_price::numeric), 0) AS total_revenue FROM (
          ${RAYNA_TABLES.map(t =>
            `SELECT selling_price FROM ${t} WHERE unified_id = uc.id AND is_cancel <> '1'`
          ).join(' UNION ALL ')}
        ) sub
      ) rev_agg ON true
    ` : '';

    const dateSelectParts = [];
    if (needsTravelDate) dateSelectParts.push(`MIN(CASE WHEN td ~ '^\\d{4}-\\d{2}-\\d{2}' THEN td::date END) AS min_travel_date, MAX(CASE WHEN td ~ '^\\d{4}-\\d{2}-\\d{2}' THEN td::date END) AS max_travel_date`);
    if (needsBookingDate) dateSelectParts.push(`MIN(CASE WHEN bd ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN TO_DATE(bd, 'DD/MM/YYYY') END) AS min_booking_date, MAX(CASE WHEN bd ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN TO_DATE(bd, 'DD/MM/YYYY') END) AS max_booking_date`);

    const dateJoin = needsDateJoin ? `
      LEFT JOIN LATERAL (
        SELECT ${dateSelectParts.join(', ')}
        FROM (
          ${RAYNA_TABLES.map(t => `
            SELECT ${needsTravelDate ? 'travel_date AS td,' : "'x' AS td,"} ${needsBookingDate ? 'booking_date AS bd' : "'x' AS bd"}
            FROM ${t} WHERE unified_id = uc.id AND is_cancel <> '1'
          `).join(' UNION ALL ')}
        ) sub
      ) booking_agg ON true
    ` : '';

    let whereSQL = '';
    if (clauseItems.length > 0) {
      let parts = clauseItems[0].clause;
      for (let i = 1; i < clauseItems.length; i++) {
        parts += ` ${clauseItems[i - 1].joinOp} ${clauseItems[i].clause}`;
      }
      whereSQL = `WHERE ${parts}`;
    }

    const sql = `
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

  static async create({ name, description, color, icon, conditions, status = 'active', operator = 'AND' }) {
    const op = (operator === 'OR') ? 'OR' : 'AND';
    const count = await this.getCountPreview(conditions);

    const { rows: [seg] } = await query(`
      INSERT INTO custom_segments (name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
      RETURNING *
    `, [name, description || null, color || '#3b82f6', icon || 'Filter', JSON.stringify(conditions), count, status, op]);
    return seg;
  }

  static async update(id, { name, description, color, icon, conditions, status, operator }) {
    const updates = [];
    const params = [];
    let idx = 1;

    if (name !== undefined)        { params.push(name);        updates.push(`name = $${idx++}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${idx++}`); }
    if (color !== undefined)       { params.push(color);       updates.push(`color = $${idx++}`); }
    if (icon !== undefined)        { params.push(icon);        updates.push(`icon = $${idx++}`); }
    if (status !== undefined)      { params.push(status);      updates.push(`status = $${idx++}`); }
    if (operator !== undefined) {
      const op = operator === 'OR' ? 'OR' : 'AND';
      params.push(op); updates.push(`condition_operator = $${idx++}`);
    }
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
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator, created_at, updated_at';
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
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator, created_at, updated_at';
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
    console.log('[Segment Preview SQL]', sql);
    console.log('[Segment Preview Params]', params);
    const { rows: [r] } = await query(sql, params);
    return r.count;
  }

  // ── Get Customers ────────────────────────────────────────

  static async getCustomers(id, { page = 1, limit = 25, search } = {}) {
    const seg = await this.getById(id);
    if (!seg) return null;

    const conditions = seg.conditions || [];

    // Count
    const countBuild = this.buildSegmentSQL(conditions);
    const { rows: [countRow] } = await query(countBuild.sql, countBuild.params);
    const total = countRow.count;

    // Build data query
    const { clauseItems, params, nextIdx, needsRevenueJoin, needsTravelDate, needsBookingDate } =
      this.buildWhereClause(conditions);

    let pIdx = nextIdx;
    let whereSQL = '';

    if (clauseItems.length > 0) {
      let parts = clauseItems[0].clause;
      for (let i = 1; i < clauseItems.length; i++) {
        parts += ` ${clauseItems[i - 1].joinOp} ${clauseItems[i].clause}`;
      }
      if (search) {
        params.push(`%${search}%`);
        whereSQL = `WHERE (${parts}) AND (uc.name ILIKE $${pIdx} OR uc.email ILIKE $${pIdx} OR uc.mobile ILIKE $${pIdx})`;
        pIdx++;
      } else {
        whereSQL = `WHERE ${parts}`;
      }
    } else if (search) {
      params.push(`%${search}%`);
      whereSQL = `WHERE (uc.name ILIKE $${pIdx} OR uc.email ILIKE $${pIdx} OR uc.mobile ILIKE $${pIdx})`;
      pIdx++;
    }

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const selectCols = `uc.id, uc.name, uc.email, uc.mobile, uc.country, uc.city, uc.sources,
      uc.contact_type, uc.booking_status, uc.product_tier, uc.geography, uc.is_indian,
      uc.wa_unsubscribe, uc.email_unsubscribe, uc.created_at`;

    const needsDateJoin = needsTravelDate || needsBookingDate;
    const dateSelectParts = [];
    if (needsTravelDate) dateSelectParts.push(`MIN(CASE WHEN td ~ '^\\d{4}-\\d{2}-\\d{2}' THEN td::date END) AS min_travel_date, MAX(CASE WHEN td ~ '^\\d{4}-\\d{2}-\\d{2}' THEN td::date END) AS max_travel_date`);
    if (needsBookingDate) dateSelectParts.push(`MIN(CASE WHEN bd ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN TO_DATE(bd, 'DD/MM/YYYY') END) AS min_booking_date, MAX(CASE WHEN bd ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN TO_DATE(bd, 'DD/MM/YYYY') END) AS max_booking_date`);

    const revenueJoin = needsRevenueJoin ? `
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(sub.selling_price::numeric), 0) AS total_revenue FROM (
          ${RAYNA_TABLES.map(t =>
            `SELECT selling_price FROM ${t} WHERE unified_id = uc.id AND is_cancel <> '1'`
          ).join(' UNION ALL ')}
        ) sub
      ) rev_agg ON true
    ` : '';

    const dateJoin = needsDateJoin ? `
      LEFT JOIN LATERAL (
        SELECT ${dateSelectParts.join(', ')}
        FROM (
          ${RAYNA_TABLES.map(t => `
            SELECT ${needsTravelDate ? 'travel_date AS td,' : "'x' AS td,"} ${needsBookingDate ? 'booking_date AS bd' : "'x' AS bd"}
            FROM ${t} WHERE unified_id = uc.id AND is_cancel <> '1'
          `).join(' UNION ALL ')}
        ) sub
      ) booking_agg ON true
    ` : '';

    const sql = `
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
