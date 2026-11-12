import { query } from '../config/database.js';
import type { SegmentCondition, SegmentClauseItem, SegmentInput, CustomSegmentRow, SegmentScalar } from '../types/services_B_segments.js';

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
  static buildWhereClause(conditions: SegmentCondition[]) {
    const clauseItems: SegmentClauseItem[] = [];
    const params: unknown[] = [];
    let idx = 1;
    let needsRevenueJoin = false;
    let needsTravelDate = false;
    let needsBookingDate = false;

    for (const cond of conditions) {
      const sub: string[] = [];

      if (cond.type === 'gtm') {
        // Count-based: COUNT of GTM events (optionally a specific event, optionally within
        // the last N days) compared with ≥ / ≤ / between. Falls back to the legacy
        // "fired at least once" EXISTS when no count is set.
        const cv = cond.countValue;
        const hasCount = Array.isArray(cv)
          ? cv.some(v => v !== '' && v != null)
          : (cv !== '' && cv != null);
        if (hasCount) {
          const where = ['ge.unified_id = uc.id'];
          if (cond.gtmEvent) { params.push(cond.gtmEvent); where.push(`ge.event_name = $${idx++}`); }
          const days = parseInt(cond.windowDays as string);
          if (days > 0) { params.push(days); where.push(`ge.created_at >= NOW() - ($${idx++} || ' days')::interval`); }
          const countSql = `(SELECT COUNT(*) FROM gtm_events ge WHERE ${where.join(' AND ')})`;
          const op = cond.countOp || 'gte';
          if (op === 'between' && Array.isArray(cv)) {
            if (cv[0] !== '' && cv[0] != null) { params.push(parseInt(cv[0] as string)); sub.push(`${countSql} >= $${idx++}`); }
            if (cv[1] !== '' && cv[1] != null) { params.push(parseInt(cv[1] as string)); sub.push(`${countSql} <= $${idx++}`); }
          } else if (op === 'lte') {
            params.push(parseInt(cv as string)); sub.push(`${countSql} <= $${idx++}`);
          } else {
            params.push(parseInt(cv as string)); sub.push(`${countSql} >= $${idx++}`);
          }
        } else if (cond.gtmEvent) {
          params.push(cond.gtmEvent);
          sub.push(`EXISTS (SELECT 1 FROM gtm_events ge WHERE ge.unified_id = uc.id AND ge.event_name = $${idx++})`);
        }
      } else if (cond.type === 'giveaway' || cond.type === 'giveaway_affiliate') {
        // Count-based: COUNT of giveaway_affiliate_events (optionally a specific type e.g.
        // 'winner' or 'coupon_assigned', optionally a specific giveaway name, optionally a
        // specific source, optionally within the last N days) compared with ≥ / ≤ / between.
        // Falls back to EXISTS ("has any matching event") when no count is given.
        //
        // 'giveaway' is the LEGACY condition key — segments saved before the affiliate merge
        // still carry it, so both are accepted and behave identically (no source filter =
        // both feeds counted). No data migration needed for existing segments.
        const filters = ['gv.unified_id = uc.id'];
        if (cond.giveawaySource && cond.giveawaySource !== 'any') {
          params.push(String(cond.giveawaySource).toUpperCase()); filters.push(`gv.source = $${idx++}`);
        }
        if (cond.giveawayType) { params.push(cond.giveawayType); filters.push(`gv.type = $${idx++}`); }
        if (cond.giveawayName) { params.push(cond.giveawayName); filters.push(`gv.giveaway = $${idx++}`); }
        const gvDays = parseInt(cond.windowDays as string);
        if (gvDays > 0) { params.push(gvDays); filters.push(`gv.created_at >= NOW() - ($${idx++} || ' days')::interval`); }

        const cv = cond.countValue;
        const hasCount = Array.isArray(cv)
          ? cv.some(v => v !== '' && v != null)
          : (cv !== '' && cv != null);
        if (hasCount) {
          const countSql = `(SELECT COUNT(*) FROM giveaway_affiliate_events gv WHERE ${filters.join(' AND ')})`;
          const op = cond.countOp || 'gte';
          if (op === 'between' && Array.isArray(cv)) {
            if (cv[0] !== '' && cv[0] != null) { params.push(parseInt(cv[0] as string)); sub.push(`${countSql} >= $${idx++}`); }
            if (cv[1] !== '' && cv[1] != null) { params.push(parseInt(cv[1] as string)); sub.push(`${countSql} <= $${idx++}`); }
          } else if (op === 'lte') {
            params.push(parseInt(cv as string)); sub.push(`${countSql} <= $${idx++}`);
          } else {
            params.push(parseInt(cv as string)); sub.push(`${countSql} >= $${idx++}`);
          }
        } else if (cond.giveawayType || cond.giveawayName || gvDays > 0) {
          sub.push(`EXISTS (SELECT 1 FROM giveaway_affiliate_events gv WHERE ${filters.join(' AND ')})`);
        }
      } else {
        switch (cond.field) {
          case 'name': {
            params.push(`%${cond.value}%`);
            sub.push(`uc.name ILIKE $${idx++}`);
            break;
          }
          case 'email': {
            const emails = (Array.isArray(cond.value) ? cond.value : [cond.value]).filter(v => v != null && v !== '');
            if (!emails.length) break;
            const placeholders = emails.map((v: SegmentScalar | undefined) => { params.push(String(v).toLowerCase()); return `$${idx++}`; });
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
              const placeholders = cond.value.map((v: SegmentScalar) => { params.push(String(v).toUpperCase()); return `$${idx++}`; });
              sub.push(`UPPER(TRIM(uc.country)) IN (${placeholders.join(',')})`);
            } else {
              params.push(String(cond.value).toUpperCase());
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
            const start = (cond.value as SegmentScalar[] | undefined)?.[0];
            const end   = (cond.value as SegmentScalar[] | undefined)?.[1];
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
            if ((cond.value as SegmentScalar[] | undefined)?.[0]) { needsTravelDate = true; params.push((cond.value as SegmentScalar[])[0]); sub.push(`booking_agg.max_travel_date >= $${idx++}::date`); }
            if ((cond.value as SegmentScalar[] | undefined)?.[1]) { needsTravelDate = true; params.push((cond.value as SegmentScalar[])[1]); sub.push(`booking_agg.min_travel_date <= $${idx++}::date`); }
            break;
          }
          case 'booking_date': {
            if ((cond.value as SegmentScalar[] | undefined)?.[0]) { needsBookingDate = true; params.push((cond.value as SegmentScalar[])[0]); sub.push(`booking_agg.max_booking_date >= $${idx++}::date`); }
            if ((cond.value as SegmentScalar[] | undefined)?.[1]) { needsBookingDate = true; params.push((cond.value as SegmentScalar[])[1]); sub.push(`booking_agg.min_booking_date <= $${idx++}::date`); }
            break;
          }
          // ── DYNAMIC relative windows centered on today (for continuous journeys) ──
          // value = X (days) → an ACTIVE booking whose date is within CURRENT_DATE ± X.
          // Correlated EXISTS (EXACT, not min/max overlap) + CURRENT_DATE (self-updating,
          // re-evaluated on every daily re-scan). travel_date is 'YYYY-MM-DD';
          // booking_date is 'DD/MM/YYYY'. X is parseInt → SQL-safe.
          case 'travel_date_within': {
            const x = parseInt(cond.value as string);
            if (!isNaN(x)) {
              // Direction via cond.operator: 'after' → [today, today+X] (upcoming);
              // 'before' → [today-X, today] (past); 'within'/default → [today-X, today+X].
              const lo = cond.operator === 'after'  ? 'CURRENT_DATE' : `(CURRENT_DATE - ${x})`;
              const hi = cond.operator === 'before' ? 'CURRENT_DATE' : `(CURRENT_DATE + ${x})`;
              const ex = RAYNA_TABLES.map(t =>
                `SELECT 1 FROM ${t} b WHERE b.unified_id = uc.id AND b.is_cancel <> '1'
                   AND b.travel_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                   AND b.travel_date::date BETWEEN ${lo} AND ${hi}`
              ).join(' UNION ALL ');
              sub.push(`EXISTS (${ex} LIMIT 1)`);
            }
            break;
          }
          case 'booking_date_within': {
            const x = Math.abs(parseInt(cond.value as string));
            if (!isNaN(x)) {
              const lo = cond.operator === 'after'  ? 'CURRENT_DATE' : `(CURRENT_DATE - ${x})`;
              const hi = cond.operator === 'before' ? 'CURRENT_DATE' : `(CURRENT_DATE + ${x})`;
              const ex = RAYNA_TABLES.map(t =>
                `SELECT 1 FROM ${t} b WHERE b.unified_id = uc.id AND b.is_cancel <> '1'
                   AND b.booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
                   AND TO_DATE(b.booking_date,'DD/MM/YYYY') BETWEEN ${lo} AND ${hi}`
              ).join(' UNION ALL ');
              sub.push(`EXISTS (${ex} LIMIT 1)`);
            }
            break;
          }
          case 'last_booking_age': {
            // Relative recency of the LAST booking (booking_agg.max_booking_date) vs today.
            // value = preset key, or an explicit [minDaysAgo, maxDaysAgo] pair.
            //   minDaysAgo → booking happened AT LEAST that many days ago (max_booking_date <= today - min)
            //   maxDaysAgo → booking happened AT MOST that many days ago (max_booking_date >= today - max)
            // Contacts with no booking have NULL max_booking_date → excluded (correct for every preset).
            const PRESETS: Record<string, [number | null, number | null]> = {
              recent_90: [null, 90],     // within the last 90 days
              '90_180':  [90, 180],      // last booking 90–180 days ago
              '90_plus': [90, null],     // last booking more than 90 days ago
              '180_plus':[180, null],    // last booking 180+ days ago
            };
            let minD: SegmentScalar | undefined = null, maxD: SegmentScalar | undefined = null;
            if (Array.isArray(cond.value)) { [minD, maxD] = cond.value; }
            else if (PRESETS[cond.value as string]) { [minD, maxD] = PRESETS[cond.value as string]; }
            if (minD != null && minD !== '') { needsBookingDate = true; params.push(parseInt(minD as string)); sub.push(`booking_agg.max_booking_date <= (CURRENT_DATE - $${idx++}::int)`); }
            if (maxD != null && maxD !== '') { needsBookingDate = true; params.push(parseInt(maxD as string)); sub.push(`booking_agg.max_booking_date >= (CURRENT_DATE - $${idx++}::int)`); }
            break;
          }
          case 'revenue': {
            if (cond.operator === 'between' && Array.isArray(cond.value)) {
              const [min, max] = cond.value;
              if (min !== '' && min != null && Number.isFinite(Number(min))) { needsRevenueJoin = true; params.push(Number(min)); sub.push(`COALESCE(rev_agg.total_revenue, 0) >= $${idx++}`); }
              if (max !== '' && max != null && Number.isFinite(Number(max))) { needsRevenueJoin = true; params.push(Number(max)); sub.push(`COALESCE(rev_agg.total_revenue, 0) <= $${idx++}`); }
            } else if (cond.operator === 'gte' && cond.value !== '' && cond.value != null && Number.isFinite(Number(cond.value))) {
              needsRevenueJoin = true; params.push(Number(cond.value)); sub.push(`COALESCE(rev_agg.total_revenue, 0) >= $${idx++}`);
            } else if (cond.operator === 'lte' && cond.value !== '' && cond.value != null && Number.isFinite(Number(cond.value))) {
              needsRevenueJoin = true; params.push(Number(cond.value)); sub.push(`COALESCE(rev_agg.total_revenue, 0) <= $${idx++}`);
            }
            break;
          }
          case 'top_service':
          case 'top_product': {
            // Booking affinity (user_affinity_top3, rebuilt nightly by BookingAffinityService):
            // the contact's top business lines / products. value = service names
            // (tours, visas, …) or product keys; operator 'top1' = #1 only, else in the top 3.
            const values = (Array.isArray(cond.value) ? cond.value : [cond.value]).filter(v => v != null && v !== '');
            if (!values.length) break;
            const placeholders = values.map(v => { params.push(String(v)); return `$${idx++}`; }).join(',');
            const cols = cond.field === 'top_service'
              ? (cond.operator === 'top1' ? ['service_1'] : ['service_1', 'service_2', 'service_3'])
              : (cond.operator === 'top1' ? ['product_1_key'] : ['product_1_key', 'product_2_key', 'product_3_key']);
            sub.push(`EXISTS (SELECT 1 FROM user_affinity_top3 a WHERE a.unified_id = uc.id AND (${cols.map(c => `a.${c} IN (${placeholders})`).join(' OR ')}))`);
            break;
          }
        }
      }

      if (sub.length > 0) {
        const combined = sub.length === 1 ? sub[0] : `(${sub.join(' AND ')})`;
        clauseItems.push({
          clause: cond.exclude ? `NOT (${combined})` : combined,
          // Only AND / OR ever reach the SQL — this value is concatenated into the WHERE clause.
          joinOp: String(cond.joinOp || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND',
        });
      }
    }

    return { clauseItems, params, nextIdx: idx, needsRevenueJoin, needsTravelDate, needsBookingDate };
  }

  /**
   * Build full SQL with optional JOINs based on conditions.
   * WHERE is built using per-condition joinOp from clauseItems.
   */
  static buildSegmentSQL(conditions: SegmentCondition[], { select = 'COUNT(*)::int AS count', orderBy = '', limitOffset = '' }: { select?: string; orderBy?: string; limitOffset?: string } = {}) {
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

    const dateSelectParts: string[] = [];
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

  static async create({ name, description, color, icon, conditions, status = 'active', operator = 'AND' }: SegmentInput) {
    const op = (operator === 'OR') ? 'OR' : 'AND';
    const count = await this.getCountPreview(conditions);

    const { rows: [seg] } = await query<CustomSegmentRow>(`
      INSERT INTO custom_segments (name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
      RETURNING *
    `, [name, description || null, color || '#3b82f6', icon || 'Filter', JSON.stringify(conditions), count, status, op]);
    return seg;
  }

  static async update(id: number | string, { name, description, color, icon, conditions, status, operator }: SegmentInput) {
    const updates: string[] = [];
    const params: unknown[] = [];
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
    const { rows: [seg] } = await query<CustomSegmentRow>(
      `UPDATE custom_segments SET ${updates.join(', ')} WHERE id = $${idx} AND is_active = true RETURNING *`, params
    );
    return seg || null;
  }

  static async delete(id: number | string) {
    await query('UPDATE custom_segments SET is_active = false, updated_at = NOW() WHERE id = $1', [id]);
  }

  static async getAll({ status }: { status?: string } = {}) {
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator, created_at, updated_at';
    let sql = `SELECT ${cols} FROM custom_segments WHERE is_active = true`;
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      sql += ` AND status = $1`;
    }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query<CustomSegmentRow>(sql, params);
    return rows;
  }

  /**
   * One page of custom segments for the Segments page: optional status filter, name/description
   * search (parameterised ILIKE), newest first. `counts` are per-status totals ignoring the
   * status filter (for the All / Active / Draft pills) but honouring the search.
   */
  static async getPage({ status, q, page = 1, limit = 20 }: { status?: string; q?: string; page?: number; limit?: number } = {}) {
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator, created_at, updated_at';
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 20, 100));
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const params: unknown[] = [];
    const where: string[] = ['is_active = true'];
    const search = (q ?? '').trim().slice(0, 100);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(name ILIKE $${params.length} OR COALESCE(description, '') ILIKE $${params.length})`);
    }
    const base = where.join(' AND ');
    const statusWhere = status ? ` AND status = $${params.length + 1}` : '';
    const listParams = status ? [...params, status] : [...params];

    const [countsRes, pageRes] = await Promise.all([
      query<{ status: string | null; n: string }>(`SELECT status, COUNT(*)::text AS n FROM custom_segments WHERE ${base} GROUP BY status`, params),
      query<CustomSegmentRow>(
        `SELECT ${cols} FROM custom_segments WHERE ${base}${statusWhere} ORDER BY created_at DESC LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
        [...listParams, safeLimit, (safePage - 1) * safeLimit],
      ),
    ]);
    const counts = { all: 0, active: 0, draft: 0 };
    for (const r of countsRes.rows) {
      const n = parseInt(r.n, 10) || 0;
      counts.all += n;
      if (r.status === 'active') counts.active += n;
      else if (r.status === 'draft') counts.draft += n;
    }
    const total = status === 'active' ? counts.active : status === 'draft' ? counts.draft : counts.all;
    return { data: pageRes.rows, total, page: safePage, limit: safeLimit, totalPages: Math.max(1, Math.ceil(total / safeLimit)), counts };
  }

  static async getById(id: number | string) {
    const cols = 'id, name, description, color, icon, conditions, cached_count, cached_at, status, condition_operator, created_at, updated_at';
    const { rows: [seg] } = await query<CustomSegmentRow>(`SELECT ${cols} FROM custom_segments WHERE id = $1 AND is_active = true`, [id]);
    return seg || null;
  }

  // ── Count Preview ────────────────────────────────────────

  static async getCountPreview(conditions: SegmentCondition[] | undefined): Promise<number> {
    if (!conditions || conditions.length === 0) {
      const { rows: [r] } = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM unified_contacts');
      return r!.count;
    }
    const { sql, params } = this.buildSegmentSQL(conditions);
    console.log('[Segment Preview SQL]', sql);
    console.log('[Segment Preview Params]', params);
    const { rows: [r] } = await query<{ count: number }>(sql, params);
    return r!.count;
  }

  // ── Get Customers ────────────────────────────────────────

  /** Customer counts per (segment, version, search) — a page change never re-runs the count. */
  private static readonly customerCounts = new Map<string, { at: number; total: number }>();
  private static readonly COUNT_TTL_MS = 60_000;
  static clearCustomerCounts(): void { this.customerCounts.clear(); }

  static async getCustomers(id: number | string, { page = 1, limit = 25, search }: { page?: number; limit?: number; search?: string } = {}) {
    const seg = await this.getById(id);
    if (!seg) return null;

    const conditions = seg.conditions || [];

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
    const whereParams = [...params];

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const selectCols = `uc.id, uc.name, uc.email, uc.mobile, uc.country, uc.city, uc.sources,
      uc.contact_type, uc.booking_status, uc.product_tier, uc.geography, uc.is_indian,
      uc.wa_unsubscribe, uc.email_unsubscribe, uc.created_at`;

    const needsDateJoin = needsTravelDate || needsBookingDate;
    const dateSelectParts: string[] = [];
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

    // The count uses the same joins and WHERE (so it honours the search), and is cached per
    // segment version + search for a minute so paging only runs the page query.
    const countKey = `${seg.id}|${String(seg.updated_at ?? '')}|${search ?? ''}`;
    const hit = this.customerCounts.get(countKey);
    const countP: Promise<number> = hit && Date.now() - hit.at < this.COUNT_TTL_MS
      ? Promise.resolve(hit.total)
      : query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM unified_contacts uc ${revenueJoin} ${dateJoin} ${whereSQL}`, whereParams)
          .then(r => { const total = Number(r.rows[0]?.count) || 0; this.customerCounts.set(countKey, { at: Date.now(), total }); return total; });

    const [{ rows }, total] = await Promise.all([query(sql, params), countP]);

    return {
      data: rows,
      total,
      page, limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
