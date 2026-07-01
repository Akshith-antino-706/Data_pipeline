import pool from '../config/database.js';
import { cached, invalidate } from '../config/cache.js';

/**
 * UnifiedContactService — updated for the new 18-column unified_contacts schema:
 *   id, email, mobile, name, country, city, sources, contact_type,
 *   wa_unsubscribe, email_unsubscribe, booking_status, product_tier,
 *   geography, is_indian, segments, synced_date, created_at, updated_at
 *
 * Booking counts & revenue are computed dynamically from rayna_* tables.
 */

const RAYNA_TABLES = ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_others', 'rayna_flights'];

const cancelFilter = () => `is_cancel <> '1'`;

export default class UnifiedContactService {

  static async getAll({ page = 1, limit = 50, search, sortBy, sortDir, source, country,
    contactType, businessType, bookingStatus, productTier, geography, hasBookings, waStatus, emailStatus,
    bookingDateFrom, bookingDateTo, travelDateFrom, travelDateTo } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      params.push(`%${search}%`);
      const isPhone = /^\+?\d[\d\s\-]{5,}$/.test(search.trim());
      const isEmail = search.includes('@');
      if (isPhone) {
        conditions.push(`uc.mobile ILIKE $${idx}`);
      } else if (isEmail) {
        conditions.push(`uc.email ILIKE $${idx}`);
      } else {
        conditions.push(`(uc.name ILIKE $${idx} OR uc.email ILIKE $${idx})`);
      }
      idx++;
    }
    if (source) {
      params.push(`%${source}%`);
      conditions.push(`uc.sources LIKE $${idx}`);
      idx++;
    }
    if (country) {
      params.push(country);
      conditions.push(`uc.country = $${idx}`);
      idx++;
    }
    if (contactType || businessType) {
      params.push(contactType || businessType);
      conditions.push(`uc.contact_type = $${idx}`);
      idx++;
    }
    if (bookingStatus) {
      params.push(bookingStatus);
      conditions.push(`uc.booking_status = $${idx}`);
      idx++;
    }
    if (productTier) {
      params.push(productTier);
      conditions.push(`uc.product_tier = $${idx}`);
      idx++;
    }
    if (geography) {
      params.push(geography);
      conditions.push(`uc.geography = $${idx}`);
      idx++;
    }
    if (hasBookings === 'yes') conditions.push(`uc.booking_status NOT IN ('PROSPECT')`);
    else if (hasBookings === 'no') conditions.push(`uc.booking_status = 'PROSPECT'`);
    // Case-insensitive match — DB values may be 'Yes', 'yes', 'No', 'no'
    if (waStatus === 'unsubscribed') conditions.push(`LOWER(uc.wa_unsubscribe) = 'yes'`);
    else if (waStatus === 'active') conditions.push(`(uc.wa_unsubscribe IS NULL OR LOWER(uc.wa_unsubscribe) = 'no')`);
    if (emailStatus === 'unsubscribed') conditions.push(`LOWER(uc.email_unsubscribe) = 'yes'`);
    else if (emailStatus === 'active') conditions.push(`(uc.email_unsubscribe IS NULL OR LOWER(uc.email_unsubscribe) = 'no')`);

    // booking_date stored as DD/MM/YYYY text → parse with TO_DATE before comparing
    if (bookingDateFrom || bookingDateTo) {
      const clauses = [];
      if (bookingDateFrom) { params.push(bookingDateFrom); clauses.push(`TO_DATE(bd.booking_date, 'DD/MM/YYYY') >= $${idx++}::date`); }
      if (bookingDateTo)   { params.push(bookingDateTo);   clauses.push(`TO_DATE(bd.booking_date, 'DD/MM/YYYY') < $${idx++}::date + INTERVAL '1 day'`); }
      conditions.push(`EXISTS (
        SELECT 1 FROM (
          SELECT booking_date FROM rayna_tours     WHERE unified_id = uc.id AND is_cancel <> '1' AND booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
          UNION ALL SELECT booking_date FROM rayna_packages WHERE unified_id = uc.id AND is_cancel <> '1' AND booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
          UNION ALL SELECT booking_date FROM rayna_hotels   WHERE unified_id = uc.id AND is_cancel <> '1' AND booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
          UNION ALL SELECT booking_date FROM rayna_others   WHERE unified_id = uc.id AND is_cancel <> '1' AND booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
          UNION ALL SELECT booking_date FROM rayna_flights  WHERE unified_id = uc.id AND is_cancel <> '1' AND booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$'
        ) bd WHERE ${clauses.join(' AND ')}
      )`);
    }

    // travel_date stored as YYYY-MM-DD text → cast directly to date
    if (travelDateFrom || travelDateTo) {
      const clauses = [];
      if (travelDateFrom) { params.push(travelDateFrom); clauses.push(`td.travel_date::date >= $${idx++}::date`); }
      if (travelDateTo)   { params.push(travelDateTo);   clauses.push(`td.travel_date::date < $${idx++}::date + INTERVAL '1 day'`); }
      conditions.push(`EXISTS (
        SELECT 1 FROM (
          SELECT travel_date FROM rayna_tours     WHERE unified_id = uc.id AND is_cancel <> '1' AND travel_date IS NOT NULL AND travel_date <> ''
          UNION ALL SELECT travel_date FROM rayna_packages WHERE unified_id = uc.id AND is_cancel <> '1' AND travel_date IS NOT NULL AND travel_date <> ''
          UNION ALL SELECT travel_date FROM rayna_hotels   WHERE unified_id = uc.id AND is_cancel <> '1' AND travel_date IS NOT NULL AND travel_date <> ''
          UNION ALL SELECT travel_date FROM rayna_others   WHERE unified_id = uc.id AND is_cancel <> '1' AND travel_date IS NOT NULL AND travel_date <> ''
          UNION ALL SELECT travel_date FROM rayna_flights  WHERE unified_id = uc.id AND is_cancel <> '1' AND travel_date IS NOT NULL AND travel_date <> ''
        ) td WHERE ${clauses.join(' AND ')}
      )`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSort = ['name', 'email', 'phone', 'country', 'contact_type', 'booking_status', 'product_tier', 'geography', 'created_at', 'updated_at', 'total_bookings', 'total_booking_revenue'];
    const col = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM unified_contacts uc ${where}`, params),
      pool.query(
        `SELECT uc.id, uc.email, uc.mobile, uc.name, uc.country, uc.city, uc.sources, uc.contact_type,
                uc.wa_unsubscribe, uc.email_unsubscribe,
                uc.booking_status, uc.product_tier, uc.geography, uc.is_indian, uc.segments,
                uc.created_at, uc.updated_at,
                COALESCE(bc.tour_cnt, 0)::int AS total_tour_bookings,
                COALESCE(bc.pkg_cnt, 0)::int AS total_package_bookings,
                COALESCE(bc.htl_cnt, 0)::int AS total_hotel_bookings,
                COALESCE(bc.vis_cnt, 0)::int AS total_visa_bookings,
                COALESCE(bc.oth_cnt, 0)::int AS total_other_bookings,
                COALESCE(bc.flt_cnt, 0)::int AS total_flight_bookings,
                COALESCE(bc.revenue, 0) AS total_booking_revenue
         FROM unified_contacts uc
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE src = 'tours') AS tour_cnt,
             COUNT(*) FILTER (WHERE src = 'packages') AS pkg_cnt,
             COUNT(*) FILTER (WHERE src = 'hotels') AS htl_cnt,
             COUNT(*) FILTER (WHERE src = 'visas') AS vis_cnt,
             COUNT(*) FILTER (WHERE src = 'others') AS oth_cnt,
             COUNT(*) FILTER (WHERE src = 'flights') AS flt_cnt,
             COALESCE(SUM(selling_price) FILTER (WHERE is_cancel <> '1'), 0) AS revenue
           FROM (
             SELECT 'tours' AS src, selling_price, is_cancel FROM rayna_tours WHERE unified_id = uc.id
             UNION ALL SELECT 'packages', selling_price, is_cancel FROM rayna_packages WHERE unified_id = uc.id
             UNION ALL SELECT 'hotels', selling_price, is_cancel FROM rayna_hotels WHERE unified_id = uc.id
             UNION ALL SELECT 'visas', selling_price, is_cancel FROM rayna_visas WHERE unified_id = uc.id
             UNION ALL SELECT 'others', selling_price, is_cancel FROM rayna_others WHERE unified_id = uc.id
             UNION ALL SELECT 'flights', selling_price, is_cancel FROM rayna_flights WHERE unified_id = uc.id
           ) sub
         ) bc ON true
         ${where.replace(/WHERE/i, 'WHERE')}
         ORDER BY ${
           col === 'total_bookings' ? '(COALESCE(bc.tour_cnt,0)+COALESCE(bc.pkg_cnt,0)+COALESCE(bc.htl_cnt,0)+COALESCE(bc.vis_cnt,0)+COALESCE(bc.oth_cnt,0)+COALESCE(bc.flt_cnt,0))' :
           col === 'total_booking_revenue' ? 'COALESCE(bc.revenue,0)' :
           col === 'phone' ? 'uc.mobile' :
           col === 'created_at' ? 'uc.created_at' :
           col === 'updated_at' ? 'uc.updated_at' :
           'uc.' + col
         } ${dir} NULLS LAST
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
    const { rows } = await pool.query('SELECT * FROM unified_contacts WHERE id = $1', [id]);
    const contact = rows[0] || null;
    if (!contact) return null;

    // Get accurate counts & revenue via aggregation (not limited)
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE src = 'tours')::int AS tour_cnt,
        COUNT(*) FILTER (WHERE src = 'packages')::int AS pkg_cnt,
        COUNT(*) FILTER (WHERE src = 'hotels')::int AS htl_cnt,
        COUNT(*) FILTER (WHERE src = 'visas')::int AS vis_cnt,
        COUNT(*) FILTER (WHERE src = 'others')::int AS oth_cnt,
        COUNT(*) FILTER (WHERE src = 'flights')::int AS flt_cnt,
        COALESCE(SUM(selling_price) FILTER (WHERE is_cancel <> '1'), 0) AS revenue,
        COUNT(*) FILTER (WHERE is_cancel = '1')::int AS cancelled_cnt,
        COALESCE(SUM(selling_price) FILTER (WHERE is_cancel = '1'), 0) AS cancelled_revenue
      FROM (
        SELECT 'tours' AS src, selling_price, is_cancel FROM rayna_tours WHERE unified_id = $1
        UNION ALL SELECT 'packages', selling_price, is_cancel FROM rayna_packages WHERE unified_id = $1
        UNION ALL SELECT 'hotels', selling_price, is_cancel FROM rayna_hotels WHERE unified_id = $1
        UNION ALL SELECT 'visas', selling_price, is_cancel FROM rayna_visas WHERE unified_id = $1
        UNION ALL SELECT 'others', selling_price, is_cancel FROM rayna_others WHERE unified_id = $1
        UNION ALL SELECT 'flights', selling_price, is_cancel FROM rayna_flights WHERE unified_id = $1
      ) sub
    `, [id]);
    const stats = statsRes.rows[0];

    // Fetch booking detail rows (latest 500 per type for display)
    const [tours, packages, hotels, visas, others, flights] = await Promise.all([
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_tours WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 500
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_packages WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 500
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_hotels WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 500
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_visas WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 500
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_others WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 500
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_flights WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 500
      `, [id]),
    ]);

    contact.rayna_tours = tours.rows;
    contact.rayna_packages = packages.rows;
    contact.rayna_hotels = hotels.rows;
    contact.rayna_visas = visas.rows;
    contact.rayna_others = others.rows;
    contact.rayna_flights = flights.rows;

    // Use accurate aggregated counts (not limited by row fetch)
    contact.total_tour_bookings = stats.tour_cnt;
    contact.total_hotel_bookings = stats.htl_cnt;
    contact.total_visa_bookings = stats.vis_cnt;
    contact.total_package_bookings = stats.pkg_cnt;
    contact.total_other_bookings = stats.oth_cnt;
    contact.total_flight_bookings = stats.flt_cnt;
    contact.total_booking_revenue = parseFloat(stats.revenue) || 0;
    contact.cancelled_count = stats.cancelled_cnt;
    contact.cancelled_revenue = parseFloat(stats.cancelled_revenue) || 0;

    return contact;
  }

  static async createContact(fields) {
    const { name, email, mobile, city, country, contact_type, geography, wa_unsubscribe, email_unsubscribe } = fields;
    if (!name && !email && !mobile) throw new Error('At least one of name, email, or phone is required');
    const { rows } = await pool.query(`
      INSERT INTO unified_contacts
        (name, email, mobile, city, country, contact_type, geography,
         wa_unsubscribe, email_unsubscribe, booking_status, sources, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROSPECT','manual', NOW())
      RETURNING *
    `, [
      name || null, email || null, mobile || null, city || null,
      country || null, contact_type || 'B2C', geography || null,
      wa_unsubscribe || 'no', email_unsubscribe || 'no',
    ]);
    return rows[0];
  }

  static async updateContact(id, fields) {
    const ALLOWED = ['name', 'email', 'mobile', 'city', 'country', 'contact_type', 'wa_unsubscribe', 'email_unsubscribe', 'actual_email', 'actual_mobile', 'mobile_country'];
    const entries = Object.entries(fields).filter(([k]) => ALLOWED.includes(k));
    if (entries.length === 0) throw new Error('No valid fields to update');
    const setClause = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...entries.map(([, v]) => v), id];
    const { rows } = await pool.query(
      `UPDATE unified_contacts SET ${setClause} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  static async deleteContact(id) {
    const { rows } = await pool.query(
      'DELETE FROM unified_contacts WHERE id = $1 RETURNING id',
      [id]
    );
    return rows[0] || null;
  }

  static async getFilterOptions({ businessType } = {}) {
    const btClause = businessType ? 'AND contact_type = $1' : '';
    const btParam = businessType ? [businessType] : [];
    const [countries, statuses, tiers, geos] = await Promise.all([
      pool.query(`SELECT country, COUNT(*)::int as cnt FROM unified_contacts WHERE country IS NOT NULL AND country != '' ${btClause} GROUP BY country ORDER BY cnt DESC LIMIT 50`, btParam),
      pool.query(`SELECT DISTINCT booking_status FROM unified_contacts WHERE booking_status IS NOT NULL ${btClause} ORDER BY booking_status`, btParam),
      pool.query(`SELECT DISTINCT product_tier FROM unified_contacts WHERE product_tier IS NOT NULL ${btClause} ORDER BY product_tier`, btParam),
      pool.query(`SELECT DISTINCT geography FROM unified_contacts WHERE geography IS NOT NULL ${btClause} ORDER BY geography`, btParam),
    ]);
    return {
      countries: countries.rows.map(r => r.country),
      contactTypes: ['B2B', 'B2C'],
      bookingStatuses: statuses.rows.map(r => r.booking_status),
      productTiers: tiers.rows.map(r => r.product_tier),
      geographies: geos.rows.map(r => r.geography),
      sources: ['tours', 'packages', 'hotels', 'visas', 'others'],
    };
  }

  static async getStats({ businessType } = {}) {
    const btClause = businessType ? 'WHERE contact_type = $1' : '';
    const btParam = businessType ? [businessType] : [];
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total_contacts,
        COUNT(*) FILTER (WHERE booking_status NOT IN ('PROSPECT'))::int AS with_travel,
        COUNT(*) FILTER (WHERE sources LIKE '%,%')::int AS multi_source,
        COUNT(DISTINCT country)::int AS countries
      FROM unified_contacts
      ${btClause}
    `, btParam);

    // Compute total revenue and total booking count from rayna tables
    const revenueSQL = RAYNA_TABLES.map(t =>
      `SELECT COALESCE(SUM(selling_price), 0) AS rev, COUNT(*) FILTER (WHERE ${cancelFilter()}) AS cnt FROM ${t}`
    ).join(' UNION ALL ');
    const { rows: revRows } = await pool.query(
      `SELECT SUM(rev)::numeric AS total_revenue, SUM(cnt)::int AS total_bookings FROM (${revenueSQL}) t`
    );

    // WhatsApp conversations active in the last 7 days = chats whose last message
    // (last_msg_at) landed within the window. Scoped to the business type via the
    // linked unified contact when a B2C/B2B filter is set.
    const convClause = businessType
      ? 'AND EXISTS (SELECT 1 FROM unified_contacts u WHERE u.id = c.unified_id AND u.contact_type = $1)'
      : '';
    const { rows: convRows } = await pool.query(`
      SELECT COUNT(*)::int AS conversations_7d
      FROM chats c
      WHERE c.last_msg_at >= NOW() - INTERVAL '7 days'
      ${convClause}
    `, btParam);

    return {
      ...rows[0],
      total_revenue: revRows[0].total_revenue || 0,
      total_bookings: revRows[0].total_bookings || 0,
      conversations_7d: convRows[0].conversations_7d || 0,
    };
  }

  /**
   * Segmentation dashboard: 3-step decision tree overview.
   *
   * Read path (no date filter):
   *   Redis L1 (1h TTL) → segmentation_tree_snapshot table → live compute fallback
   *
   * Date-filtered requests always go through live compute + short Redis TTL
   * because arbitrary date ranges cannot be pre-snapshotted.
   *
   * The snapshot table is refreshed nightly at 2 AM Dubai time by a node-cron
   * job in server.js. On first deploy (table empty), the fallback triggers a
   * live compute and auto-populates the table so subsequent requests are fast.
   */
  static async getSegmentationTree({ businessType, dateFrom, dateTo, travelFrom, travelTo, bookingFrom, bookingTo, product } = {}) {
    // Filtered revenue-by-segment: travel-date window AND/OR booking-date window AND/OR product.
    const hasProduct = product && product !== 'all';
    if (travelFrom || travelTo || bookingFrom || bookingTo || hasProduct) {
      const cacheKey = `dashboard:tree:travel:${businessType || 'all'}:${travelFrom || ''}:${travelTo || ''}:${bookingFrom || ''}:${bookingTo || ''}:${product || 'all'}`;
      return cached(cacheKey, () => this._computeRevenueByTravelWindow({ businessType, travelFrom, travelTo, bookingFrom, bookingTo, product }), 1800);
    }

    // Date-filtered (booking/bill date): live compute + short Redis TTL (same as before)
    if (dateFrom || dateTo) {
      const cacheKey = `dashboard:tree:${businessType || 'all'}:${dateFrom || ''}:${dateTo || ''}`;
      return cached(cacheKey, () => this._computeSegmentationTree({ businessType, dateFrom, dateTo }), 1800);
    }

    // Standard (no date filter): Redis → snapshot table → live fallback
    const btKey = businessType || 'All';
    const cacheKey = `dashboard:tree:snapshot:${btKey}`;

    return cached(cacheKey, async () => {
      // 1. Try snapshot table (single primary-key lookup, sub-millisecond)
      try {
        const { rows } = await pool.query(
          `SELECT total_contacts, segment_count, total_revenue,
                  status_counts, breakdown, revenue_by_type
           FROM segmentation_tree_snapshot
           WHERE business_type = $1 AND computed_at IS NOT NULL`,
          [btKey]
        );

        if (rows.length > 0) {
          const r = rows[0];
          return {
            totals: {
              total:         r.total_contacts,
              segmented:     r.total_contacts,
              segment_count: r.segment_count,
              total_revenue: parseFloat(r.total_revenue),
            },
            statusCounts:   r.status_counts,
            breakdown:      r.breakdown,
            revenueByType:  r.revenue_by_type,
          };
        }
      } catch (err) {
        // Table may not exist yet (migration not run) — fall through to live compute
        console.warn(`[Snapshot] Table read failed for ${btKey}, falling back to live:`, err.message);
      }

      // 2. Snapshot empty / table missing — live compute then store for next request
      console.log(`[Snapshot] No snapshot for ${btKey} — computing live and storing...`);
      const data = await this._computeSegmentationTree({ businessType });

      // Store async (don't block the response)
      pool.query(
        `UPDATE segmentation_tree_snapshot
         SET total_contacts  = $1,
             segment_count   = $2,
             total_revenue   = $3,
             status_counts   = $4,
             breakdown       = $5,
             revenue_by_type = $6,
             computed_at     = now()
         WHERE business_type = $7`,
        [
          data.totals.total,
          data.totals.segment_count,
          parseFloat(data.totals.total_revenue || 0),
          JSON.stringify(data.statusCounts),
          JSON.stringify(data.breakdown),
          JSON.stringify(data.revenueByType),
          btKey,
        ]
      ).catch(err => console.warn('[Snapshot] Auto-store failed:', err.message));

      return data;
    }, 3600); // 1-hour Redis TTL — nightly cron invalidates after table refresh
  }

  /**
   * Recompute all 3 business-type variants and store them in
   * segmentation_tree_snapshot. Called by the nightly cron in server.js
   * and the POST /api/v3/snapshot/refresh manual trigger.
   *
   * Runs sequentially (B2C → B2B → All) to avoid saturating the DB pool.
   * After all three are stored, invalidates Redis so the next request
   * reads fresh data from the table.
   */
  static async refreshSegmentationSnapshot() {
    console.log('[Snapshot] Starting nightly refresh...');
    const variants = [
      { businessType: 'B2C', key: 'B2C' },
      { businessType: 'B2B', key: 'B2B' },
      { businessType: undefined, key: 'All' },
    ];

    for (const { businessType, key } of variants) {
      console.log(`[Snapshot] Computing ${key}...`);
      const data = await this._computeSegmentationTree({ businessType });

      await pool.query(
        `UPDATE segmentation_tree_snapshot
         SET total_contacts  = $1,
             segment_count   = $2,
             total_revenue   = $3,
             status_counts   = $4,
             breakdown       = $5,
             revenue_by_type = $6,
             computed_at     = now()
         WHERE business_type = $7`,
        [
          data.totals.total,
          data.totals.segment_count,
          parseFloat(data.totals.total_revenue || 0),
          JSON.stringify(data.statusCounts),
          JSON.stringify(data.breakdown),
          JSON.stringify(data.revenueByType),
          key,
        ]
      );
      console.log(`[Snapshot] ${key} stored (${data.totals.total} contacts)`);
    }

    // Invalidate Redis so next requests read the fresh table data
    await invalidate('dashboard:tree:snapshot:*');
    console.log('[Snapshot] Nightly refresh complete — Redis invalidated');
    return { refreshed: ['B2C', 'B2B', 'All'], at: new Date().toISOString() };
  }

  /**
   * Revenue-by-segment with optional filters (all AND-combined), per booking_status:
   *   • travelFrom/travelTo  → bookings whose travel_date falls in the window
   *   • bookingFrom/bookingTo → bookings whose bill_date (booking date) falls in the window
   *   • product               → restrict to one booking table
   * Returns, per segment, the count of distinct customers with a matching booking and
   * the total revenue of those bookings.
   */
  static async _computeRevenueByTravelWindow({ businessType, travelFrom, travelTo, bookingFrom, bookingTo, product } = {}) {
    const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
    const clauses = [];
    // Travel-date window (travel_date is TEXT — guard the regex before casting)
    if (isDate(travelFrom)) clauses.push(`b.travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND b.travel_date::date >= '${travelFrom}'`);
    if (isDate(travelTo))   clauses.push(`b.travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND b.travel_date::date <= '${travelTo}'`);
    // Booking-date window (booking_date is TEXT in DD/MM/YYYY — parse via to_date)
    if (isDate(bookingFrom)) clauses.push(`b.booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$' AND to_date(b.booking_date,'DD/MM/YYYY') >= '${bookingFrom}'`);
    if (isDate(bookingTo))   clauses.push(`b.booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$' AND to_date(b.booking_date,'DD/MM/YYYY') <= '${bookingTo}'`);
    const filterAnd = clauses.length ? ' AND ' + clauses.join(' AND ') : '';
    const btAnd = businessType ? ` AND uc.contact_type = '${businessType}'` : '';

    // Optional product filter: restrict to one booking table (else union all six).
    const PRODUCT_TABLES = {
      tours: 'rayna_tours', packages: 'rayna_packages', hotels: 'rayna_hotels',
      visas: 'rayna_visas', others: 'rayna_others', flights: 'rayna_flights',
    };
    const TABLES = (product && PRODUCT_TABLES[product]) ? [PRODUCT_TABLES[product]] : Object.values(PRODUCT_TABLES);
    const bookingUnion = TABLES.map(t =>
      `SELECT unified_id, travel_date, booking_date, selling_price FROM ${t}
       WHERE is_cancel <> '1' AND unified_id IS NOT NULL`
    ).join(' UNION ALL ');

    const { rows: statusCounts } = await pool.query(`
      SELECT uc.booking_status,
             COUNT(DISTINCT uc.id)::int AS count,
             COUNT(DISTINCT uc.id) FILTER (WHERE uc.is_indian = true)::int AS indian_count,
             COALESCE(SUM(b.selling_price), 0)::numeric AS revenue
      FROM unified_contacts uc
      JOIN ( ${bookingUnion} ) b ON b.unified_id = uc.id
      WHERE 1=1 ${btAnd} ${filterAnd}
      GROUP BY uc.booking_status
      ORDER BY CASE uc.booking_status
        WHEN 'ON_TRIP' THEN 1 WHEN 'FUTURE_TRAVEL' THEN 2
        WHEN 'PAST_BOOKING' THEN 3 WHEN 'CANCELLED' THEN 4 WHEN 'PROSPECT' THEN 5 ELSE 6 END
    `);

    statusCounts.forEach(r => { r.revenue = parseFloat(r.revenue) || 0; });
    const totalRevenue = statusCounts.reduce((s, r) => s + r.revenue, 0);

    return {
      totals: { total_revenue: totalRevenue, travel_filtered: true, travelFrom: travelFrom || null, travelTo: travelTo || null },
      statusCounts,
      breakdown: [],
      revenueByType: {
        label: `Travel ${travelFrom || '…'} → ${travelTo || '…'}`,
        sources: [],
        total: totalRevenue,
      },
    };
  }

  static async _computeSegmentationTree({ businessType, dateFrom, dateTo } = {}) {
    const btWhere = businessType ? `WHERE contact_type = '${businessType}'` : '';

    // Date filter for revenue queries (applied to bill_date)
    const dateClauses = [];
    if (dateFrom) dateClauses.push(`bill_date >= '${dateFrom}'`);
    if (dateTo) dateClauses.push(`bill_date <= '${dateTo}'::date + INTERVAL '1 day'`);
    const dateAnd = dateClauses.length ? ' AND ' + dateClauses.join(' AND ') : '';

    // Run all 7 queries in parallel for speed
    const [
      { rows: statusCounts },
      { rows: breakdown },
      { rows: [totals] },
      { rows: revenueByType },
      { rows: revenueByStatus },
      { rows: [onTripBookings] },
      { rows: [ftBookings] },
    ] = await Promise.all([
      // 1. Booking status counts
      pool.query(`
        SELECT booking_status, COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE is_indian = true)::int AS indian_count
        FROM unified_contacts ${btWhere}
        GROUP BY booking_status
        ORDER BY CASE booking_status
          WHEN 'ON_TRIP' THEN 1 WHEN 'FUTURE_TRAVEL' THEN 2
          WHEN 'PAST_BOOKING' THEN 3 WHEN 'CANCELLED' THEN 4 WHEN 'PROSPECT' THEN 5 END
      `),
      // 2. Full breakdown — revenue SCOPED to each contact's booking-status period (not lifetime):
      //    FUTURE_TRAVEL → only upcoming bookings (travel_date > today)
      //    ON_TRIP       → only bookings travelling now (today-7 .. today)
      //    PAST_BOOKING / CANCELLED / PROSPECT → all confirmed bookings (their travel is all past / none)
      pool.query(`
          WITH contact_rev AS (
            SELECT unified_id,
              SUM(selling_price) AS all_rev,
              SUM(selling_price) FILTER (WHERE travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE) AS future_rev,
              SUM(selling_price) FILTER (WHERE travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE) AS ontrip_rev
            FROM (
              SELECT unified_id, travel_date, selling_price FROM rayna_tours WHERE is_cancel <> '1' AND unified_id IS NOT NULL
              UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_packages WHERE is_cancel <> '1' AND unified_id IS NOT NULL
              UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_hotels WHERE is_cancel <> '1' AND unified_id IS NOT NULL
              UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_visas WHERE is_cancel <> '1' AND unified_id IS NOT NULL
              UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_others WHERE is_cancel <> '1' AND unified_id IS NOT NULL
              UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_flights WHERE is_cancel <> '1' AND unified_id IS NOT NULL
            ) all_bookings GROUP BY unified_id
          )
          SELECT
              uc.booking_status,
              uc.product_tier,
              uc.geography,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE uc.is_indian = true)::int AS indian_count,
              COALESCE(SUM(CASE uc.booking_status
                WHEN 'FUTURE_TRAVEL' THEN COALESCE(cr.future_rev, 0)
                WHEN 'ON_TRIP'       THEN COALESCE(cr.ontrip_rev, 0)
                ELSE COALESCE(cr.all_rev, 0)
              END), 0) AS revenue
          FROM unified_contacts uc
          LEFT JOIN contact_rev cr ON cr.unified_id = uc.id
          ${btWhere}
          GROUP BY uc.booking_status, uc.product_tier, uc.geography
          ORDER BY uc.booking_status, uc.product_tier NULLS LAST, uc.geography NULLS LAST
      `),
      // 3. Totals
      pool.query(`
        SELECT COUNT(*)::int AS total, COUNT(*)::int AS segmented,
          COUNT(DISTINCT booking_status || COALESCE(product_tier,'') || COALESCE(geography,''))::int AS segment_count
        FROM unified_contacts ${btWhere}
      `),
      // 4. Revenue by type (with date filter + flights)
      pool.query(`
        SELECT 'tours' as source, COUNT(*)::int as bookings, COALESCE(SUM(selling_price),0)::numeric as revenue FROM rayna_tours WHERE is_cancel <> '1'${dateAnd}
        UNION ALL SELECT 'packages', COUNT(*)::int, COALESCE(SUM(selling_price),0)::numeric FROM rayna_packages WHERE is_cancel <> '1'${dateAnd}
        UNION ALL SELECT 'hotels', COUNT(*)::int, COALESCE(SUM(selling_price),0)::numeric FROM rayna_hotels WHERE is_cancel <> '1'${dateAnd}
        UNION ALL SELECT 'visas', COUNT(*)::int, COALESCE(SUM(selling_price),0)::numeric FROM rayna_visas WHERE is_cancel <> '1'${dateAnd}
        UNION ALL SELECT 'others', COUNT(*)::int, COALESCE(SUM(selling_price),0)::numeric FROM rayna_others WHERE is_cancel <> '1'${dateAnd}
        UNION ALL SELECT 'flights', COUNT(*)::int, COALESCE(SUM(selling_price),0)::numeric FROM rayna_flights WHERE is_cancel <> '1'${dateAnd}
      `),
      // 5. Revenue per booking_status — SCOPED to each status's travel period (matches breakdown #2):
      //    FUTURE_TRAVEL → upcoming bookings only · ON_TRIP → this-week only · others → all confirmed
      pool.query(`
        SELECT uc.booking_status, COALESCE(SUM(
          CASE uc.booking_status
            WHEN 'FUTURE_TRAVEL' THEN CASE WHEN r.travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND r.travel_date::date > CURRENT_DATE THEN r.selling_price ELSE 0 END
            WHEN 'ON_TRIP'       THEN CASE WHEN r.travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND r.travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE THEN r.selling_price ELSE 0 END
            ELSE r.selling_price
          END
        ), 0)::numeric AS revenue
        FROM unified_contacts uc
        JOIN (
          SELECT unified_id, travel_date, selling_price FROM rayna_tours WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_packages WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_hotels WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_visas WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_others WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, travel_date, selling_price FROM rayna_flights WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
        ) r ON r.unified_id = uc.id
        ${btWhere}
        GROUP BY uc.booking_status
      `),
      // 6. ON_TRIP breakdown (counts + revenue per type)
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as tours,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::numeric as tours_revenue,
          (SELECT COUNT(*) FROM rayna_packages WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as packages,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_packages WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::numeric as packages_revenue,
          (SELECT COUNT(*) FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as hotels,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::numeric as hotels_revenue,
          (SELECT COUNT(*) FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as visas,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::numeric as visas_revenue,
          (SELECT COUNT(*) FROM rayna_others WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as others,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_others WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::numeric as others_revenue
      `),
      // 7. FUTURE_TRAVEL breakdown (counts + revenue per type)
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as tours,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::numeric as tours_revenue,
          (SELECT COUNT(*) FROM rayna_packages WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as packages,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_packages WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::numeric as packages_revenue,
          (SELECT COUNT(*) FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as hotels,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::numeric as hotels_revenue,
          (SELECT COUNT(*) FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as visas,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::numeric as visas_revenue,
          (SELECT COUNT(*) FROM rayna_others WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as others,
          (SELECT COALESCE(SUM(selling_price),0) FROM rayna_others WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::numeric as others_revenue
      `),
    ]);

    // Merge revenue into totals
    const totalRevenue = revenueByType.reduce((s, r) => s + parseFloat(r.revenue || 0), 0);
    totals.total_revenue = totalRevenue;

    // Merge revenue per status into statusCounts
    const revenueMap = Object.fromEntries(revenueByStatus.map(r => [r.booking_status, parseFloat(r.revenue)]));
    for (const sc of statusCounts) {
      sc.revenue = revenueMap[sc.booking_status] || 0;
    }

    // Merge booking breakdowns with total_bookings and revenue per type
    const mergeBreakdown = (idx, bookings) => {
      if (idx < 0) return;
      const total = (bookings.tours || 0) + (bookings.packages || 0) + (bookings.hotels || 0)
        + (bookings.visas || 0) + (bookings.others || 0);
      statusCounts[idx].total_bookings = total;
      statusCounts[idx].booking_breakdown = {
        tours: bookings.tours || 0,
        tours_revenue: parseFloat(bookings.tours_revenue) || 0,
        packages: bookings.packages || 0,
        packages_revenue: parseFloat(bookings.packages_revenue) || 0,
        hotels: bookings.hotels || 0,
        hotels_revenue: parseFloat(bookings.hotels_revenue) || 0,
        visas: bookings.visas || 0,
        visas_revenue: parseFloat(bookings.visas_revenue) || 0,
        others: bookings.others || 0,
        others_revenue: parseFloat(bookings.others_revenue) || 0,
      };
    };
    mergeBreakdown(statusCounts.findIndex(r => r.booking_status === 'ON_TRIP'), onTripBookings);
    mergeBreakdown(statusCounts.findIndex(r => r.booking_status === 'FUTURE_TRAVEL'), ftBookings);

    return {
      totals,
      statusCounts,
      breakdown,
      revenueByType: { label: dateFrom || dateTo ? 'Filtered Revenue' : 'All-Time Confirmed', sources: revenueByType, total: totalRevenue },
    };
  }

  /**
   * Snapshot daily segment counts into segment_daily_log
   * Computes revenue per segment and entered/exited from previous snapshot
   */
  static async snapshotDailySegments() {
    // Use Dubai timezone (UTC+4) for the date
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const snapshotTime = new Date();

    // 1. Current segment counts
    const { rows: segments } = await pool.query(`
      SELECT booking_status as segment_label, COUNT(*)::int as total_count
      FROM unified_contacts
      WHERE booking_status IS NOT NULL
      GROUP BY booking_status
    `);

    // 2. Revenue per segment
    const { rows: revenueRows } = await pool.query(`
      SELECT uc.booking_status AS segment_label, COALESCE(SUM(r.selling_price), 0)::numeric AS revenue
      FROM unified_contacts uc
      JOIN (
        SELECT unified_id, selling_price FROM rayna_tours WHERE is_cancel <> '1' AND unified_id IS NOT NULL
        UNION ALL SELECT unified_id, selling_price FROM rayna_packages WHERE is_cancel <> '1' AND unified_id IS NOT NULL
        UNION ALL SELECT unified_id, selling_price FROM rayna_hotels WHERE is_cancel <> '1' AND unified_id IS NOT NULL
        UNION ALL SELECT unified_id, selling_price FROM rayna_visas WHERE is_cancel <> '1' AND unified_id IS NOT NULL
        UNION ALL SELECT unified_id, selling_price FROM rayna_others WHERE is_cancel <> '1' AND unified_id IS NOT NULL
        UNION ALL SELECT unified_id, selling_price FROM rayna_flights WHERE is_cancel <> '1' AND unified_id IS NOT NULL
      ) r ON r.unified_id = uc.id
      GROUP BY uc.booking_status
    `);
    const revenueMap = Object.fromEntries(revenueRows.map(r => [r.segment_label, parseFloat(r.revenue)]));

    // 3. Previous snapshot for entered/exited calculation
    const { rows: prevRows } = await pool.query(`
      SELECT segment_label, total_count FROM segment_daily_log
      WHERE snapshot_time = (
        SELECT MAX(snapshot_time) FROM segment_daily_log
        WHERE snapshot_time < NOW() - INTERVAL '1 minute'
      )
    `);
    const prevMap = Object.fromEntries(prevRows.map(r => [r.segment_label, r.total_count]));

    // 4. Upsert — one row per (log_date, segment_label), update if already exists
    for (const seg of segments) {
      const prev = prevMap[seg.segment_label] || 0;
      const entered = Math.max(0, seg.total_count - prev);
      const exited = Math.max(0, prev - seg.total_count);
      const revenue = revenueMap[seg.segment_label] || 0;

      await pool.query(`
        INSERT INTO segment_daily_log (log_date, segment_label, total_count, entered, exited, converted,
          emails_sent, whatsapp_sent, push_sent, total_reached, journey_active, journey_completed, revenue, snapshot_time)
        VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, 0, 0, 0, $6, $7)
        ON CONFLICT (log_date, segment_label) DO UPDATE SET
          total_count = EXCLUDED.total_count,
          entered = EXCLUDED.entered,
          exited = EXCLUDED.exited,
          revenue = EXCLUDED.revenue,
          snapshot_time = EXCLUDED.snapshot_time
      `, [today, seg.segment_label, seg.total_count, entered, exited, revenue, snapshotTime]);
    }

    // Invalidate dashboard caches after snapshot
    await invalidate('dashboard:*');

    console.log(`[SegmentLog] Snapshot for ${today}: ${segments.length} segments logged`);
    return { date: today, segments: segments.length, snapshotTime };
  }

  /**
   * Get segment daily activity log
   */
  static async getSegmentDailyLog({ days = 30, segment, businessType } = {}) {
    const cacheKey = `dashboard:activity:${days}:${segment || 'all'}:${businessType || 'all'}`;
    return cached(cacheKey, () => this._computeSegmentDailyLog({ days, segment, businessType }), 1800);
  }

  static async _computeSegmentDailyLog({ days = 30, segment, businessType } = {}) {
    const conditions = ['log_date >= CURRENT_DATE - $1::int'];
    const params = [days];

    if (segment) {
      params.push(segment);
      conditions.push(`segment_label = $${params.length}`);
    }

    const { rows } = await pool.query(`
      SELECT *, log_date::text AS log_date FROM segment_daily_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY snapshot_time DESC NULLS LAST, segment_label
    `, params);

    // Live counts with revenue
    const btClause = businessType ? `AND uc.contact_type = $1` : '';
    const liveParams = businessType ? [businessType] : [];
    const { rows: liveToday } = await pool.query(`
      SELECT uc.booking_status AS segment_label,
        COUNT(*)::int AS total_count,
        COALESCE(rev.revenue, 0)::numeric AS revenue
      FROM unified_contacts uc
      LEFT JOIN (
        SELECT uc2.booking_status,
          SUM(r.selling_price)::numeric AS revenue
        FROM unified_contacts uc2
        JOIN (
          SELECT unified_id, selling_price FROM rayna_tours WHERE is_cancel <> '1' AND unified_id IS NOT NULL
          UNION ALL SELECT unified_id, selling_price FROM rayna_packages WHERE is_cancel <> '1' AND unified_id IS NOT NULL
          UNION ALL SELECT unified_id, selling_price FROM rayna_hotels WHERE is_cancel <> '1' AND unified_id IS NOT NULL
          UNION ALL SELECT unified_id, selling_price FROM rayna_visas WHERE is_cancel <> '1' AND unified_id IS NOT NULL
          UNION ALL SELECT unified_id, selling_price FROM rayna_others WHERE is_cancel <> '1' AND unified_id IS NOT NULL
          UNION ALL SELECT unified_id, selling_price FROM rayna_flights WHERE is_cancel <> '1' AND unified_id IS NOT NULL
        ) r ON r.unified_id = uc2.id
        GROUP BY uc2.booking_status
      ) rev ON rev.booking_status = uc.booking_status
      WHERE uc.booking_status IS NOT NULL ${btClause}
      GROUP BY uc.booking_status, rev.revenue
      ORDER BY CASE uc.booking_status
        WHEN 'ON_TRIP' THEN 1 WHEN 'FUTURE_TRAVEL' THEN 2
        WHEN 'PAST_BOOKING' THEN 3 WHEN 'CANCELLED' THEN 4 WHEN 'PROSPECT' THEN 5 END
    `, liveParams);

    return { logs: rows, liveToday };
  }

  /**
   * Get before/after segment changes from the latest two snapshots
   */
  static async getSegmentChanges() {
    // Find the two most recent distinct snapshot_time values
    const { rows: times } = await pool.query(`
      SELECT DISTINCT snapshot_time FROM segment_daily_log
      ORDER BY snapshot_time DESC LIMIT 2
    `);

    if (times.length < 2) {
      return { before: null, after: null, changes: [] };
    }

    const afterTime = times[0].snapshot_time;
    const beforeTime = times[1].snapshot_time;

    const { rows: afterRows } = await pool.query(
      `SELECT segment_label, total_count, revenue FROM segment_daily_log WHERE snapshot_time = $1`,
      [afterTime]
    );
    const { rows: beforeRows } = await pool.query(
      `SELECT segment_label, total_count, revenue FROM segment_daily_log WHERE snapshot_time = $1`,
      [beforeTime]
    );

    const beforeMap = Object.fromEntries(beforeRows.map(r => [r.segment_label, r]));
    const allSegments = new Set([...afterRows.map(r => r.segment_label), ...beforeRows.map(r => r.segment_label)]);

    const changes = [];
    for (const seg of allSegments) {
      const before = beforeMap[seg]?.total_count || 0;
      const after = afterRows.find(r => r.segment_label === seg)?.total_count || 0;
      changes.push({
        segment: seg,
        before,
        after,
        change: after - before,
      });
    }

    // Sort by standard order
    const order = { ON_TRIP: 1, FUTURE_TRAVEL: 2, PAST_BOOKING: 3, CANCELLED: 4, PROSPECT: 5 };
    changes.sort((a, b) => (order[a.segment] || 99) - (order[b.segment] || 99));

    return {
      before: { date: new Date(beforeTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }), time: beforeTime },
      after: { date: new Date(afterTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }), time: afterTime },
      changes,
    };
  }

  static async getSegmentCustomers({ bookingStatus, productTier, geography, businessType, page = 1, limit = 25, search } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (businessType) { params.push(businessType); conditions.push(`uc.contact_type = $${idx++}`); }
    if (bookingStatus) { params.push(bookingStatus); conditions.push(`uc.booking_status = $${idx++}`); }
    if (productTier) { params.push(productTier); conditions.push(`uc.product_tier = $${idx++}`); }
    if (geography) { params.push(geography); conditions.push(`uc.geography = $${idx++}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(uc.name ILIKE $${idx} OR uc.email ILIKE $${idx} OR uc.mobile ILIKE $${idx})`); idx++; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    // Filter revenue by travel_date for time-sensitive statuses
    const dateFilter = bookingStatus === 'ON_TRIP'
      ? "AND travel_date::date >= CURRENT_DATE - INTERVAL '7 days' AND travel_date::date <= CURRENT_DATE"
      : bookingStatus === 'FUTURE_TRAVEL'
        ? 'AND travel_date::date > CURRENT_DATE'
        : '';
    const revSubquery = ['rayna_tours','rayna_packages','rayna_hotels','rayna_visas','rayna_others','rayna_flights']
      .map(t => `SELECT selling_price FROM ${t} WHERE unified_id = uc.id AND is_cancel != '1' ${dateFilter}`)
      .join(' UNION ALL ');

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM unified_contacts uc ${where}`, params),
      pool.query(
        `SELECT uc.id, uc.name, uc.email, uc.mobile, uc.country, uc.city, uc.contact_type, uc.sources,
                uc.booking_status, uc.product_tier, uc.geography, uc.is_indian, uc.segments,
                uc.wa_unsubscribe, uc.email_unsubscribe, uc.created_at, uc.updated_at,
                COALESCE(rev.total, 0) AS total_booking_revenue
         FROM unified_contacts uc
         LEFT JOIN LATERAL (
           SELECT SUM(selling_price) AS total FROM (${revSubquery}) sub
         ) rev ON true
         ${where}
         ORDER BY total_booking_revenue DESC NULLS LAST
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

  /**
   * Recompute segmentation — delegates to UnifiedContactBuilder
   */
  static async recomputeSegmentation() {
    const { default: UnifiedContactBuilder } = await import('./UnifiedContactBuilder.js');
    return UnifiedContactBuilder.computeSegmentation();
  }
}
