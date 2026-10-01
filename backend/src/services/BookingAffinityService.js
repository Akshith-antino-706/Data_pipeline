import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db, { query } from '../config/database.js';

/**
 * BookingAffinityService — each customer's top 3 services and top 3 products,
 * built only from bookings (the rayna_* tables).
 *
 *   user_service_affinity        every business line a customer booked, ranked
 *   user_booked_product_affinity every product a customer booked, ranked
 *   user_affinity_top3           one row per customer: contact snapshot + #1..#3 of each
 *   affinity_products            product catalog for pickers
 *
 * Service = business line = the rayna table a booking lives in. Product = service_name,
 * grouped by affinity_product_rules (service_id is a booking-line id, not a product id).
 * A booking is one bill: several lines of the same bill count once, and a bill is
 * cancelled only when all its lines are (is_cancel = '1').
 *
 * Score: every non-cancelled booking adds 10 points, halving every 180 days of age, so
 * booked often and recently ranks first. Ties: more bookings, latest booking, more revenue.
 * Bulk: 50+ bookings in total — resellers, OTAs and corporates, many stored as B2C
 * (e.g. tickets@headout.com) — or a Rayna staff email, so the page can leave them out.
 *
 * Rebuilt each night: aggregated into temp tables, then swapped in with DELETE + INSERT
 * in one transaction, so readers (including send-time lookups) never wait or see it empty.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SERVICES = ['tours', 'packages', 'hotels', 'visas', 'flights', 'others'];
// API period → bookings_<suffix> column on user_affinity_top3
export const PERIODS = { day: '1d', week: '7d', month: '30d', quarter: '90d', year: '365d', all: 'all' };
const WINDOW_DAYS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
const SUFFIXES = [...Object.keys(WINDOW_DAYS), 'all'];
const RANKS = [1, 2, 3];

const BULK_MIN_BOOKINGS = 50;
// Staff book under their own address (raynatours.com, raynab2b.com, rayna.com …) — not customers.
const INTERNAL_EMAIL_RE = '@rayna[a-z0-9-]*\\.[a-z.]+$';
const POINTS_PER_BOOKING = 10;
const HALF_LIFE_DAYS = 180;
const SYNC_KEY = 'booking_affinity';
const CSV_MAX_ROWS = 100000;
const AFFINITY_TABLES = ['user_booked_product_affinity', 'user_service_affinity', 'user_affinity_top3', 'affinity_products'];

// "Z(Old Don t Use) Lapita" → "Lapita"; "Aquarium (Valid till 31st Dec 2021)" → "Aquarium"
const CLEAN_NAME_SQL = `regexp_replace(regexp_replace(regexp_replace(trim(COALESCE(service_name, '')),
  '^z\\s*\\(old[^)]*\\)\\s*', '', 'i'),
  '\\s*\\(valid (till|until|for)[^)]*\\)\\s*$', '', 'i'),
  '\\s+', ' ', 'g')`;

// Dates as 'YYYY-MM-DD' text, so JSON never shifts them by the server's timezone.
const DAYS = `first_booking_date::text AS first_booking_date, last_booking_date::text AS last_booking_date`;

const TOP3_COLUMNS = [
  ...RANKS.flatMap(r => [`service_${r}`, `service_${r}_score`, `service_${r}_bookings`]),
  ...RANKS.flatMap(r => [`product_${r}_key`, `product_${r}_name`, `product_${r}_score`, `product_${r}_bookings`]),
];

let _ensurePromise = null;
let _running = false;

function likePattern(s) {
  return `%${String(s).replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default class BookingAffinityService {

  /** Create the tables and seed rules on first use (migration 115 is idempotent). */
  static ensureTables() {
    if (!_ensurePromise) {
      _ensurePromise = readFile(join(__dirname, '../migrations/115_booking_affinity.sql'), 'utf8')
        .then(sql => query(sql))
        .catch(err => { _ensurePromise = null; throw err; });
    }
    return _ensurePromise;
  }

  static isRunning() { return _running; }

  /** Is a build running anywhere (this or another backend process)? */
  static async isLockHeld() {
    const client = await db.connect();
    try {
      const { rows: [r] } = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS free`, [SYNC_KEY]);
      if (r.free) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [SYNC_KEY]);
      return !r.free;
    } finally {
      client.release();
    }
  }

  // ── Build ─────────────────────────────────────────────────────

  static async build() {
    await this.ensureTables();
    const client = await db.connect();
    const started = Date.now();
    const startedAt = new Date();
    let locked = false;
    try {
      const { rows: [lock] } = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [SYNC_KEY]);
      if (!lock.ok) {
        console.log('[BookingAffinity] Another build is running — skipped');
        return { skipped: true };
      }
      locked = true;
      _running = true;
      await this.writeStatus('running', { startedAt });

      const { rows: [{ today }] } = await client.query(`SELECT to_char((NOW() AT TIME ZONE 'Asia/Dubai')::date, 'YYYY-MM-DD') AS today`);
      const asOf = `DATE '${today}'`;
      const weight = (day) => `${POINTS_PER_BOOKING} * power(0.5::float8, GREATEST(${asOf} - ${day}, 0)::float8 / ${HALF_LIFE_DAYS})`;
      const step = async (label, sql) => {
        const t = Date.now();
        const res = await client.query(sql);
        console.log(`[BookingAffinity] ${label} — ${res.rowCount ?? 0} rows in ${((Date.now() - t) / 1000).toFixed(1)}s`);
        return res;
      };

      const lines = SERVICES.map(s => `
          SELECT unified_id, '${s}'::text AS service,
                 COALESCE(NULLIF(trim(bill_no), ''), 'id:' || id) AS bill_key,
                 ${CLEAN_NAME_SQL} AS clean_name,
                 CASE WHEN booking_date ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(booking_date, 'DD/MM/YYYY') END AS booking_day,
                 COALESCE(is_cancel, '0') = '1' AS is_cancelled,
                 COALESCE(selling_price, 0) AS price
            FROM rayna_${s}
           WHERE unified_id IS NOT NULL`).join('\n          UNION ALL');

      await client.query(`DROP TABLE IF EXISTS _aff_bill_product, _aff_map, _aff_name, _aff_bill, _aff_customer`);

      // 1. One row per customer × business line × bill × product name.
      await step('Bills per product', `
        CREATE TEMP TABLE _aff_bill_product AS
        SELECT unified_id, service, bill_key, lower(clean_name) AS product_key,
               MAX(clean_name) AS sample_name,
               MIN(booking_day) AS booking_day,
               BOOL_OR(NOT is_cancelled) AS active,
               COALESCE(SUM(price) FILTER (WHERE NOT is_cancelled), 0) AS revenue
          FROM (${lines}) l
         GROUP BY unified_id, service, bill_key, lower(clean_name)`);

      // 2. Product name → product group via the first matching rule.
      await step('Product groups', `
        CREATE TEMP TABLE _aff_map AS
        SELECT DISTINCT ON (k.service, k.product_key)
               k.service, k.product_key,
               r.id IS NOT NULL AS matched,
               COALESCE(r.is_excluded, FALSE) OR k.product_key = '' AS is_excluded,
               COALESCE(lower(r.product_group), k.product_key) AS group_key,
               r.product_group
          FROM (SELECT DISTINCT service, product_key FROM _aff_bill_product) k
          LEFT JOIN affinity_product_rules r
            ON r.active AND (r.service IS NULL OR r.service = k.service) AND k.product_key ~ r.pattern
         ORDER BY k.service, k.product_key, r.priority NULLS LAST, r.id`);

      const { rows: [coverage] } = await client.query(`
        SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE m.matched AND NOT m.is_excluded)
                     / NULLIF(COUNT(*) FILTER (WHERE NOT m.is_excluded), 0), 1) AS grouped_pct,
               ROUND(100.0 * COUNT(*) FILTER (WHERE m.is_excluded) / NULLIF(COUNT(*), 0), 1) AS excluded_pct
          FROM _aff_bill_product b JOIN _aff_map m USING (service, product_key)
         WHERE b.active`);
      const { rows: unmapped } = await client.query(`
        SELECT b.product_key, COUNT(*)::int AS bookings
          FROM _aff_bill_product b JOIN _aff_map m USING (service, product_key)
         WHERE b.active AND NOT m.matched AND NOT m.is_excluded
         GROUP BY b.product_key ORDER BY bookings DESC LIMIT 15`);
      console.log(`[BookingAffinity] Product bookings grouped by a rule: ${coverage.grouped_pct}% · excluded as add-ons: ${coverage.excluded_pct}%`);
      console.log(`[BookingAffinity] Top ungrouped: ${unmapped.map(u => `${u.product_key} (${u.bookings})`).join(' · ')}`);

      // Display name: the rule's name, else the most common spelling.
      await step('Product names', `
        CREATE TEMP TABLE _aff_name AS
        SELECT DISTINCT ON (group_key) group_key, COALESCE(product_group, sample_name) AS product_name
          FROM (
            SELECT m.group_key, MAX(m.product_group) AS product_group, b.sample_name, COUNT(*) AS n
              FROM _aff_bill_product b JOIN _aff_map m USING (service, product_key)
             WHERE NOT m.is_excluded
             GROUP BY m.group_key, b.sample_name
          ) x
         ORDER BY group_key, (product_group IS NULL), n DESC, sample_name`);

      // 3. One row per customer × business line × bill; customers with their totals.
      await step('Bills per service', `
        CREATE TEMP TABLE _aff_bill AS
        SELECT unified_id, service, bill_key, MIN(booking_day) AS booking_day,
               BOOL_OR(active) AS active, SUM(revenue) AS revenue
          FROM _aff_bill_product
         GROUP BY unified_id, service, bill_key`);

      const booked = (s) => s === 'all' ? 'b.active' : `b.active AND b.booking_day >= ${asOf} - ${WINDOW_DAYS[s]}`;
      // Customers missing from unified_contacts drop out here (inner join).
      await step('Customers', `
        CREATE TEMP TABLE _aff_customer AS
        SELECT b.unified_id, uc.name, uc.email, uc.mobile, COALESCE(NULLIF(uc.country, ''), uc.mobile_country) AS country,
               CASE WHEN UPPER(uc.contact_type) = 'B2B' THEN 'B2B' ELSE 'B2C' END AS contact_type,
               ${SUFFIXES.map(s => `COUNT(DISTINCT b.bill_key) FILTER (WHERE ${booked(s)})::int AS bookings_${s}`).join(',\n               ')},
               COALESCE(SUM(b.revenue) FILTER (WHERE b.active), 0) AS revenue_all,
               MIN(b.booking_day) FILTER (WHERE b.active) AS first_booking_date,
               MAX(b.booking_day) FILTER (WHERE b.active) AS last_booking_date,
               COALESCE(SUM(${weight('b.booking_day')}) FILTER (WHERE b.active AND b.booking_day IS NOT NULL), 0) AS affinity_score
          FROM _aff_bill b
          JOIN unified_contacts uc ON uc.id = b.unified_id
         GROUP BY b.unified_id, uc.id
        HAVING BOOL_OR(b.active)`);

      // 4. Swap in. DELETE (not TRUNCATE) so readers keep the old rows until COMMIT.
      await client.query('BEGIN');
      let products, services, customers;
      try {
        for (const t of AFFINITY_TABLES) await client.query(`DELETE FROM ${t}`);

        products = await step('Write user_booked_product_affinity', `
          INSERT INTO user_booked_product_affinity
            (unified_id, product_key, product_name, services, rank, bookings, revenue, cancelled,
             first_booking_date, last_booking_date, affinity_score, built_at)
          SELECT p.unified_id, p.group_key, n.product_name, p.services,
                 ROW_NUMBER() OVER (PARTITION BY p.unified_id
                   ORDER BY p.score DESC, p.bookings DESC, p.last_booking_date DESC NULLS LAST, p.revenue DESC, p.group_key),
                 p.bookings, p.revenue, p.cancelled, p.first_booking_date, p.last_booking_date,
                 ROUND(p.score::numeric, 2), NOW()
            FROM (
              SELECT x.unified_id, x.group_key,
                     array_agg(DISTINCT x.service ORDER BY x.service) AS services,
                     COUNT(*) FILTER (WHERE x.active)::int AS bookings,
                     COUNT(*) FILTER (WHERE NOT x.active)::int AS cancelled,
                     COALESCE(SUM(x.revenue) FILTER (WHERE x.active), 0) AS revenue,
                     MIN(x.booking_day) FILTER (WHERE x.active) AS first_booking_date,
                     MAX(x.booking_day) FILTER (WHERE x.active) AS last_booking_date,
                     COALESCE(SUM(${weight('x.booking_day')}) FILTER (WHERE x.active AND x.booking_day IS NOT NULL), 0) AS score
                FROM (
                  -- several names of one product group in one bill = one booking
                  SELECT b.unified_id, m.group_key, b.service, b.bill_key,
                         MIN(b.booking_day) AS booking_day, BOOL_OR(b.active) AS active, SUM(b.revenue) AS revenue
                    FROM _aff_bill_product b
                    JOIN _aff_map m USING (service, product_key)
                   WHERE NOT m.is_excluded
                   GROUP BY b.unified_id, m.group_key, b.service, b.bill_key
                ) x
                JOIN _aff_customer c USING (unified_id)
               GROUP BY x.unified_id, x.group_key
              HAVING BOOL_OR(x.active)
            ) p
            JOIN _aff_name n USING (group_key)`);

        services = await step('Write user_service_affinity', `
          INSERT INTO user_service_affinity
            (unified_id, service, rank, bookings, revenue, cancelled, distinct_products,
             first_booking_date, last_booking_date, affinity_score, built_at)
          SELECT s.unified_id, s.service,
                 ROW_NUMBER() OVER (PARTITION BY s.unified_id
                   ORDER BY s.score DESC, s.bookings DESC, s.last_booking_date DESC NULLS LAST, s.revenue DESC, s.service),
                 s.bookings, s.revenue, s.cancelled, COALESCE(dp.n, 0),
                 s.first_booking_date, s.last_booking_date, ROUND(s.score::numeric, 2), NOW()
            FROM (
              SELECT b.unified_id, b.service,
                     COUNT(*) FILTER (WHERE b.active)::int AS bookings,
                     COUNT(*) FILTER (WHERE NOT b.active)::int AS cancelled,
                     COALESCE(SUM(b.revenue) FILTER (WHERE b.active), 0) AS revenue,
                     MIN(b.booking_day) FILTER (WHERE b.active) AS first_booking_date,
                     MAX(b.booking_day) FILTER (WHERE b.active) AS last_booking_date,
                     COALESCE(SUM(${weight('b.booking_day')}) FILTER (WHERE b.active AND b.booking_day IS NOT NULL), 0) AS score
                FROM _aff_bill b
                JOIN _aff_customer c USING (unified_id)
               GROUP BY b.unified_id, b.service
              HAVING BOOL_OR(b.active)
            ) s
            LEFT JOIN (
              SELECT unified_id, svc AS service, COUNT(*)::int AS n
                FROM user_booked_product_affinity, unnest(services) AS svc
               GROUP BY unified_id, svc
            ) dp USING (unified_id, service)`);

        const pick = (col, r) => `MAX(${col}) FILTER (WHERE rank = ${r})`;
        customers = await step('Write user_affinity_top3', `
          INSERT INTO user_affinity_top3
            (unified_id, name, email, mobile, country, contact_type, is_bulk,
             ${SUFFIXES.map(s => `bookings_${s}`).join(', ')}, revenue_all, first_booking_date, last_booking_date,
             affinity_score, service_count, product_count, ${TOP3_COLUMNS.join(', ')}, built_at)
          SELECT c.unified_id, c.name, c.email, c.mobile, c.country, c.contact_type,
                 c.bookings_all >= ${BULK_MIN_BOOKINGS} OR COALESCE(c.email, '') ~* '${INTERNAL_EMAIL_RE}',
                 ${SUFFIXES.map(s => `c.bookings_${s}`).join(', ')}, c.revenue_all, c.first_booking_date, c.last_booking_date,
                 ROUND(c.affinity_score::numeric, 2), s.service_count, COALESCE(p.product_count, 0),
                 ${TOP3_COLUMNS.map(col => `${col.startsWith('service') ? 's' : 'p'}.${col}`).join(', ')}, NOW()
            FROM _aff_customer c
            JOIN (
              SELECT unified_id, COUNT(*)::int AS service_count,
                     ${RANKS.map(r => `${pick('service', r)} AS service_${r}, ${pick('affinity_score', r)} AS service_${r}_score, ${pick('bookings', r)} AS service_${r}_bookings`).join(',\n                     ')}
                FROM user_service_affinity
               GROUP BY unified_id
            ) s USING (unified_id)
            LEFT JOIN (
              SELECT unified_id, COUNT(*)::int AS product_count,
                     ${RANKS.map(r => `${pick('product_key', r)} AS product_${r}_key, ${pick('product_name', r)} AS product_${r}_name, ${pick('affinity_score', r)} AS product_${r}_score, ${pick('bookings', r)} AS product_${r}_bookings`).join(',\n                     ')}
                FROM user_booked_product_affinity
               GROUP BY unified_id
            ) p USING (unified_id)`);

        await step('Write affinity_products', `
          INSERT INTO affinity_products
            (product_key, product_name, services, customers_rank1, customers_top3, customers_any, bookings, built_at)
          SELECT p.product_key, MIN(p.product_name), sv.services,
                 COUNT(*) FILTER (WHERE p.rank = 1)::int, COUNT(*) FILTER (WHERE p.rank <= 3)::int, COUNT(*)::int,
                 SUM(p.bookings)::int, NOW()
            FROM user_booked_product_affinity p
            JOIN (
              SELECT product_key, array_agg(DISTINCT svc ORDER BY svc) AS services
                FROM user_booked_product_affinity, unnest(services) AS svc
               GROUP BY product_key
            ) sv USING (product_key)
           GROUP BY p.product_key, sv.services`);

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      // VACUUM can't run inside a transaction or a multi-statement string.
      for (const t of AFFINITY_TABLES) await client.query(`VACUUM (ANALYZE) ${t}`);

      const result = {
        customers: customers.rowCount,
        serviceRows: services.rowCount,
        productRows: products.rowCount,
        groupedPct: Number(coverage.grouped_pct),
        excludedPct: Number(coverage.excluded_pct),
        topUngrouped: unmapped,
        asOf: today,
        duration: ((Date.now() - started) / 1000).toFixed(1),
      };
      await this.writeStatus('success', { startedAt, rows: customers.rowCount, durationMs: Date.now() - started });
      console.log(`[BookingAffinity] Done — ${result.customers} customers, ${result.serviceRows} service rows, ${result.productRows} product rows in ${result.duration}s`);
      return result;
    } catch (err) {
      console.error('[BookingAffinity] Build failed:', err.message);
      if (locked) await this.writeStatus('error', { startedAt, durationMs: Date.now() - started, error: err.message });
      throw err;
    } finally {
      await client.query(`DROP TABLE IF EXISTS _aff_bill_product, _aff_map, _aff_name, _aff_bill, _aff_customer`).catch(() => {});
      if (locked) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [SYNC_KEY]).catch(() => {});
      _running = false;
      client.release();
    }
  }

  // Last-run info for the page (and /data-pipeline). Never blocks the build.
  static async writeStatus(status, { startedAt, rows = 0, durationMs = null, error = null }) {
    await query(`
      INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (table_name) DO UPDATE SET
        last_synced_at   = EXCLUDED.last_synced_at,
        rows_synced      = CASE WHEN EXCLUDED.sync_status = 'success' THEN EXCLUDED.rows_synced ELSE sync_metadata.rows_synced END,
        sync_status      = EXCLUDED.sync_status,
        error_message    = EXCLUDED.error_message,
        sync_duration_ms = EXCLUDED.sync_duration_ms,
        updated_at       = NOW()
    `, [SYNC_KEY, startedAt, rows, status, error, durationMs]).catch(err =>
      console.warn('[BookingAffinity] sync_metadata write failed:', err.message)
    );
  }

  // ── Queries ───────────────────────────────────────────────────

  /**
   * WHERE clause shared by every list on the page.
   *   businessType  'B2B' | 'B2C' | anything else = both
   *   excludeBulk   leave out bulk / internal accounts (50+ bookings or a Rayna email)
   *   period        only customers with a booking in the window
   *   view=service + service   #1 service = service
   *   view=product + product   #1 product = product (product_key)
   *   search        name, email, mobile or any of the top 3 product names
   */
  static buildWhere({ businessType, excludeBulk, period, view, service, product, search }) {
    const params = [];
    const where = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
    if (businessType === 'B2B' || businessType === 'B2C') add('contact_type = ?', businessType);
    if (excludeBulk) where.push('NOT is_bulk');
    const w = PERIODS[period];
    if (w && w !== 'all') where.push(`bookings_${w} > 0`);
    if (view === 'service' && service) add('service_1 = ?', service);
    if (view === 'product' && product) add('product_1_key = ?', product);
    if (search) {
      params.push(likePattern(search));
      const p = `$${params.length}`;
      where.push(`(name ILIKE ${p} OR email ILIKE ${p} OR mobile ILIKE ${p} OR product_1_name ILIKE ${p} OR product_2_name ILIKE ${p} OR product_3_name ILIKE ${p})`);
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  static async getStatus() {
    const [{ rows: [meta] }, { rows: [built] }] = await Promise.all([
      query(`SELECT last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms FROM sync_metadata WHERE table_name = $1`, [SYNC_KEY]),
      query(`SELECT MAX(built_at) AS built_at FROM affinity_products`),
    ]);
    // 'running' left behind by a process that died mid-build (restart / deploy): nobody holds the lock.
    if (meta?.sync_status === 'running' && !_running && !(await this.isLockHeld())) {
      meta.sync_status = 'error';
      meta.error_message = 'The last build was interrupted (server restarted). The previous data is still shown.';
    }
    return {
      builtAt: built?.built_at || null,
      status: _running ? 'running' : (meta?.sync_status || null),
      lastRunAt: meta?.last_synced_at || null,
      lastError: meta?.sync_status === 'error' ? meta.error_message : null,
      lastDurationMs: meta?.sync_duration_ms ?? null,
    };
  }

  /** Build status + customer counts by #1 service. */
  static async getSummary(filters) {
    const { sql, params } = this.buildWhere({ ...filters, view: null, search: null });
    const [status, { rows }] = await Promise.all([
      this.getStatus(),
      query(`SELECT service_1 AS service, COUNT(*)::int AS customers FROM user_affinity_top3 ${sql} GROUP BY 1`, params),
    ]);
    const counts = Object.fromEntries(rows.map(r => [r.service, r.customers]));
    const topService = SERVICES.map(s => ({ service: s, customers: counts[s] || 0 }));
    return { ...status, totalCustomers: rows.reduce((n, r) => n + r.customers, 0), topService };
  }

  /** The most common #1 products for the current filters. */
  static async getTopProducts(filters, limit = 12) {
    const { sql, params } = this.buildWhere({ ...filters, view: null, search: null });
    const { rows } = await query(`
      SELECT product_1_key AS product_key, MIN(product_1_name) AS product_name, COUNT(*)::int AS customers
        FROM user_affinity_top3 ${sql ? `${sql} AND` : 'WHERE'} product_1_key IS NOT NULL
       GROUP BY product_1_key
       ORDER BY customers DESC, product_name
       LIMIT ${Math.min(Math.max(parseInt(limit) || 12, 1), 50)}
    `, params);
    return rows;
  }

  /** Search the product catalog (most customers first). */
  static async searchProducts(search, limit = 20) {
    const params = [];
    let where = '';
    if (search) { params.push(likePattern(search)); where = `WHERE product_name ILIKE $1`; }
    const { rows } = await query(`
      SELECT product_key, product_name, services, customers_rank1, customers_top3, customers_any, bookings
        FROM affinity_products ${where}
       ORDER BY customers_any DESC, product_name
       LIMIT ${Math.min(Math.max(parseInt(limit) || 20, 1), 100)}
    `, params);
    return rows;
  }

  static customerQuery(filters) {
    const { sql, params } = this.buildWhere(filters);
    const w = PERIODS[filters.period] || 'all';
    const order = {
      bookings: `bookings_${w} DESC, affinity_score DESC`,
      revenue: `revenue_all DESC, affinity_score DESC`,
      last: `last_booking_date DESC NULLS LAST, affinity_score DESC`,
    }[filters.sort] || `affinity_score DESC, bookings_${w} DESC`;
    const select = `
      SELECT unified_id, name, email, mobile, country, contact_type, is_bulk,
             bookings_${w} AS bookings, bookings_all, revenue_all, ${DAYS},
             affinity_score, service_count, product_count, ${TOP3_COLUMNS.join(', ')}
        FROM user_affinity_top3 ${sql}
       ORDER BY ${order}, unified_id`;
    return { select, sql, params };
  }

  /** Customers with their top 3 services and products. */
  static async getCustomers(filters) {
    const limit = Math.min(Math.max(parseInt(filters.limit) || 25, 1), 200);
    const page = Math.max(parseInt(filters.page) || 1, 1);
    const { select, sql, params } = this.customerQuery(filters);
    const [{ rows }, { rows: [count] }] = await Promise.all([
      query(`${select} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
      query(`SELECT COUNT(*)::int AS n FROM user_affinity_top3 ${sql}`, params),
    ]);
    return { total: count.n, customers: rows };
  }

  /** Every service and product one customer booked, in rank order. */
  static async getCustomerDetail(unifiedId) {
    const [{ rows: [customer] }, { rows: services }, { rows: products }] = await Promise.all([
      query(`SELECT unified_id, name, email, mobile, country, contact_type, is_bulk, ${SUFFIXES.map(s => `bookings_${s}`).join(', ')},
                    revenue_all, ${DAYS}, affinity_score, service_count, product_count, ${TOP3_COLUMNS.join(', ')}, built_at
               FROM user_affinity_top3 WHERE unified_id = $1`, [unifiedId]),
      query(`SELECT service, rank, bookings, revenue, cancelled, distinct_products, ${DAYS}, affinity_score
               FROM user_service_affinity WHERE unified_id = $1 ORDER BY rank`, [unifiedId]),
      query(`SELECT product_key, product_name, services, rank, bookings, revenue, cancelled, ${DAYS}, affinity_score
               FROM user_booked_product_affinity WHERE unified_id = $1 ORDER BY rank LIMIT 50`, [unifiedId]),
    ]);
    return customer ? { customer, services, products } : null;
  }

  /** Same list as getCustomers, as CSV (capped at CSV_MAX_ROWS). */
  static async getCustomersCsv(filters) {
    const { select, params } = this.customerQuery(filters);
    const { rows } = await query(`${select} LIMIT ${CSV_MAX_ROWS}`, params);
    const cols = [
      ['unified_id', 'Unified ID'], ['name', 'Name'], ['email', 'Email'], ['mobile', 'Mobile'], ['country', 'Country'],
      ['contact_type', 'Type'], ['is_bulk', 'Bulk booker'], ['bookings', 'Bookings (period)'], ['bookings_all', 'Bookings (all time)'],
      ['revenue_all', 'Revenue AED (all time)'], ['first_booking_date', 'First booking'], ['last_booking_date', 'Last booking'],
      ['affinity_score', 'Affinity score'],
      ...RANKS.flatMap(r => [[`service_${r}`, `Service #${r}`], [`service_${r}_score`, `Service #${r} score`], [`service_${r}_bookings`, `Service #${r} bookings`]]),
      ...RANKS.flatMap(r => [[`product_${r}_name`, `Product #${r}`], [`product_${r}_score`, `Product #${r} score`], [`product_${r}_bookings`, `Product #${r} bookings`]]),
    ];
    const lines = [cols.map(c => c[1]).join(',')];
    for (const r of rows) lines.push(cols.map(([k]) => csvCell(r[k])).join(','));
    return lines.join('\n');
  }
}
