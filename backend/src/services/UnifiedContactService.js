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

// rayna_flights uses 'status' column instead of 'is_cancel'
const cancelFilter = (table) =>
  table === 'rayna_flights' ? `(status IS NULL OR status != 'Cancelled')` : `is_cancel <> '1'`;

export default class UnifiedContactService {

  static async getAll({ page = 1, limit = 50, search, sortBy, sortDir, source, country,
    contactType, businessType, bookingStatus, productTier, geography, hasBookings, waStatus, emailStatus } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      params.push(`%${search}%`);
      const isPhone = /^\+?\d[\d\s\-]{5,}$/.test(search.trim());
      const isEmail = search.includes('@');
      if (isPhone) {
        conditions.push(`mobile ILIKE $${idx}`);
      } else if (isEmail) {
        conditions.push(`email ILIKE $${idx}`);
      } else {
        conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx})`);
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
    if (contactType || businessType) {
      params.push(contactType || businessType);
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
    if (hasBookings === 'yes') conditions.push(`booking_status NOT IN ('PROSPECT')`);
    else if (hasBookings === 'no') conditions.push(`booking_status = 'PROSPECT'`);
    if (waStatus === 'unsubscribed') conditions.push(`wa_unsubscribe = 'yes'`);
    else if (waStatus === 'active') conditions.push(`(wa_unsubscribe IS NULL OR wa_unsubscribe = 'no')`);
    if (emailStatus === 'unsubscribed') conditions.push(`email_unsubscribe = 'yes'`);
    else if (emailStatus === 'active') conditions.push(`(email_unsubscribe IS NULL OR email_unsubscribe = 'no')`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSort = ['name', 'email', 'country', 'contact_type', 'booking_status', 'created_at', 'updated_at'];
    const col = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM unified_contacts ${where}`, params),
      pool.query(
        `SELECT id, email, mobile, name, country, city, sources, contact_type,
                wa_unsubscribe, email_unsubscribe,
                booking_status, product_tier, geography, is_indian, segments,
                created_at, updated_at
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
    const { rows } = await pool.query('SELECT * FROM unified_contacts WHERE id = $1', [id]);
    const contact = rows[0] || null;
    if (!contact) return null;

    // Fetch booking records linked by unified_id from all rayna tables
    const [tours, packages, hotels, visas, others, flights] = await Promise.all([
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_tours WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_packages WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_hotels WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_visas WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT bill_serial, bill_no, bill_type, service_id, travel_date, service_name,
               selling_price, is_cancel, guest_name, nationality, booking_date
        FROM rayna_others WHERE unified_id = $1 ORDER BY travel_date DESC NULLS LAST LIMIT 100
      `, [id]),
      pool.query(`
        SELECT billno AS bill_no, bill_date, flight_no, passenger_name AS guest_name,
               selling_price, status, nationality
        FROM rayna_flights WHERE unified_id = $1 ORDER BY bill_date DESC NULLS LAST LIMIT 100
      `, [id]),
    ]);

    contact.rayna_tours = tours.rows;
    contact.rayna_packages = packages.rows;
    contact.rayna_hotels = hotels.rows;
    contact.rayna_visas = visas.rows;
    contact.rayna_others = others.rows;
    contact.rayna_flights = flights.rows;

    // Compute totals dynamically
    contact.total_tour_bookings = tours.rows.length;
    contact.total_hotel_bookings = hotels.rows.length;
    contact.total_visa_bookings = visas.rows.length;
    contact.total_package_bookings = packages.rows.length;
    contact.total_other_bookings = others.rows.length;
    contact.total_flight_bookings = flights.rows.length;
    contact.total_booking_revenue = [tours, packages, hotels, visas, others]
      .flatMap(r => r.rows)
      .filter(r => r.is_cancel !== '1')
      .reduce((sum, r) => sum + (parseFloat(r.selling_price) || 0), 0)
      + flights.rows
        .filter(r => !r.status || r.status !== 'Cancelled')
        .reduce((sum, r) => sum + (parseFloat(r.selling_price) || 0), 0);

    return contact;
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

    // Compute total revenue from rayna tables
    const revenueSQL = RAYNA_TABLES.map(t =>
      `SELECT COALESCE(SUM(selling_price), 0) AS rev FROM ${t} WHERE ${cancelFilter(t)}`
    ).join(' UNION ALL ');
    const { rows: revRows } = await pool.query(`SELECT SUM(rev)::numeric AS total_revenue FROM (${revenueSQL}) t`);

    return { ...rows[0], total_revenue: revRows[0].total_revenue || 0 };
  }

  /**
   * Segmentation dashboard: 3-step decision tree overview
   * Computed directly from unified_contacts (no materialized view)
   */
  static async getSegmentationTree({ businessType, dateFrom, dateTo } = {}) {
    const cacheKey = `dashboard:tree:${businessType || 'all'}:${dateFrom || ''}:${dateTo || ''}`;
    return cached(cacheKey, () => this._computeSegmentationTree({ businessType, dateFrom, dateTo }), 1800);
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
      // 2. Full breakdown
      pool.query(`
        SELECT booking_status, product_tier, geography,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE is_indian = true)::int AS indian_count
        FROM unified_contacts ${btWhere}
        GROUP BY booking_status, product_tier, geography
        ORDER BY booking_status, product_tier NULLS LAST, geography NULLS LAST
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
        UNION ALL SELECT 'flights', COUNT(*)::int, COALESCE(SUM(selling_price),0)::numeric FROM rayna_flights WHERE (status IS NULL OR status != 'Cancelled')${dateAnd}
      `),
      // 5. Revenue per booking_status (with date filter + flights)
      pool.query(`
        SELECT uc.booking_status, COALESCE(SUM(r.selling_price), 0)::numeric AS revenue
        FROM unified_contacts uc
        JOIN (
          SELECT unified_id, selling_price FROM rayna_tours WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, selling_price FROM rayna_packages WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, selling_price FROM rayna_hotels WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, selling_price FROM rayna_visas WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, selling_price FROM rayna_others WHERE is_cancel <> '1' AND unified_id IS NOT NULL${dateAnd}
          UNION ALL SELECT unified_id, selling_price FROM rayna_flights WHERE (status IS NULL OR status != 'Cancelled') AND unified_id IS NOT NULL${dateAnd}
        ) r ON r.unified_id = uc.id
        ${btWhere}
        GROUP BY uc.booking_status
      `),
      // 6. ON_TRIP breakdown
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as tours,
          (SELECT COUNT(*) FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as hotels,
          (SELECT COUNT(*) FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int as visas
      `),
      // 7. FUTURE_TRAVEL breakdown
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as tours,
          (SELECT COUNT(*) FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as hotels,
          (SELECT COUNT(*) FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
            AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND travel_date::date > CURRENT_DATE)::int as visas
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

    // Merge booking breakdowns
    const onTripIdx = statusCounts.findIndex(r => r.booking_status === 'ON_TRIP');
    if (onTripIdx >= 0) statusCounts[onTripIdx].booking_breakdown = onTripBookings;
    const ftIdx = statusCounts.findIndex(r => r.booking_status === 'FUTURE_TRAVEL');
    if (ftIdx >= 0) statusCounts[ftIdx].booking_breakdown = ftBookings;

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
        UNION ALL SELECT unified_id, selling_price FROM rayna_flights WHERE (status IS NULL OR status != 'Cancelled') AND unified_id IS NOT NULL
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

    // 4. Insert (always INSERT, no upsert — allows multiple snapshots per day)
    for (const seg of segments) {
      const prev = prevMap[seg.segment_label] || 0;
      const entered = Math.max(0, seg.total_count - prev);
      const exited = Math.max(0, prev - seg.total_count);
      const revenue = revenueMap[seg.segment_label] || 0;

      await pool.query(`
        INSERT INTO segment_daily_log (log_date, segment_label, total_count, entered, exited, converted,
          emails_sent, whatsapp_sent, push_sent, total_reached, journey_active, journey_completed, revenue, snapshot_time)
        VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, 0, 0, 0, $6, $7)
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
          UNION ALL SELECT unified_id, selling_price FROM rayna_flights WHERE (status IS NULL OR status != 'Cancelled') AND unified_id IS NOT NULL
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

    if (businessType) { params.push(businessType); conditions.push(`contact_type = $${idx++}`); }
    if (bookingStatus) { params.push(bookingStatus); conditions.push(`booking_status = $${idx++}`); }
    if (productTier) { params.push(productTier); conditions.push(`product_tier = $${idx++}`); }
    if (geography) { params.push(geography); conditions.push(`geography = $${idx++}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR mobile ILIKE $${idx})`); idx++; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM unified_contacts ${where}`, params),
      pool.query(
        `SELECT id, name, email, mobile, country, city, contact_type, sources,
                booking_status, product_tier, geography, is_indian, segments,
                wa_unsubscribe, email_unsubscribe, created_at, updated_at
         FROM unified_contacts ${where}
         ORDER BY created_at DESC NULLS LAST
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
