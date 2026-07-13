/**
 * dailyPastTripCompute
 *
 * Nightly (4:00 AM Dubai) computes past_trip AI recommendation rows for ALL
 * users in booking_status='PAST_BOOKING'. Runs entirely on the DB server as a
 * single INSERT ... SELECT — no per-user network round-trips. Processes all
 * ~626k users in under a minute.
 *
 * Depends on:
 *   - daily_category_picks having today's rows (populated by
 *     dailyCategoryPicksCompute at 3:45 AM Dubai)
 *   - unified_contacts.booking_status having been refreshed by the 2 AM cron
 *   - products.category populated (from enriched-feed sync)
 *
 * Logic per user (all in one SQL):
 *   1. Aggregate their bookings across the 6 rayna_ tables
 *   2. Join to products.category → count per raw category
 *   3. Reverse-map to journey category (activities/holidays/cruises) via a
 *      hardcoded CATEGORY_MAP → journey_category table.
 *   4. Pick the max-count journey category (defaulting to 'activities' if none).
 *   5. Attach the daily_category_picks row for that journey category.
 *   6. UPSERT into user_product_recommendations with recommendation_type='past_trip'.
 */

import db from '../config/database.js';
import { CATEGORY_MAP } from '../services/CategoryPicksService.js';

// Build the reverse map in-code, then materialize it into a VALUES clause so
// PostgreSQL can join products.category → journey category natively.
function _reverseMapRows() {
  const seen = new Set();
  const rows = [];
  // Priority: cruises > holidays > activities (matches CategoryPicksService)
  for (const jcat of ['cruises', 'holidays', 'activities']) {
    for (const raw of CATEGORY_MAP[jcat]) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      rows.push(`('${raw.replace(/'/g, "''")}', '${jcat}')`);
    }
  }
  return rows.join(', ');
}

export async function runDailyPastTripCompute() {
  const started = Date.now();
  console.log(`[PastTripCron] Starting at ${new Date().toISOString()}`);

  const reverseMapValues = _reverseMapRows();
  const cacheDays = 30;

  // ONE SQL statement — runs entirely on the DB. All 626k users processed in
  // a single INSERT ... SELECT. Uses CTEs to keep the logic readable.
  const sql = `
    WITH
      -- 1. All active past bookings across 6 rayna_ tables
      raw_bookings AS (
        SELECT unified_id, service_id FROM rayna_tours    WHERE unified_id IS NOT NULL AND COALESCE(is_cancel,'0') <> '1' AND service_id IS NOT NULL
        UNION ALL
        SELECT unified_id, service_id FROM rayna_packages WHERE unified_id IS NOT NULL AND COALESCE(is_cancel,'0') <> '1' AND service_id IS NOT NULL
        UNION ALL
        SELECT unified_id, service_id FROM rayna_hotels   WHERE unified_id IS NOT NULL AND COALESCE(is_cancel,'0') <> '1' AND service_id IS NOT NULL
        UNION ALL
        SELECT unified_id, service_id FROM rayna_visas    WHERE unified_id IS NOT NULL AND COALESCE(is_cancel,'0') <> '1' AND service_id IS NOT NULL
        UNION ALL
        SELECT unified_id, service_id FROM rayna_flights  WHERE unified_id IS NOT NULL AND COALESCE(is_cancel,'0') <> '1' AND service_id IS NOT NULL
        UNION ALL
        SELECT unified_id, service_id FROM rayna_others   WHERE unified_id IS NOT NULL AND COALESCE(is_cancel,'0') <> '1' AND service_id IS NOT NULL
      ),
      -- 2. Reverse map: products.category → journey category
      cat_map(raw_cat, jcat) AS ( VALUES ${reverseMapValues} ),
      -- 3. Per user + journey category count
      user_jcat_counts AS (
        SELECT b.unified_id, m.jcat, COUNT(*) AS n
        FROM raw_bookings b
        JOIN products p ON p.product_id::text = b.service_id
        JOIN cat_map m ON m.raw_cat = p.category
        GROUP BY b.unified_id, m.jcat
      ),
      -- 4. Max journey category per user (ties broken alphabetically for determinism)
      user_top_jcat AS (
        SELECT DISTINCT ON (unified_id) unified_id, jcat
        FROM user_jcat_counts
        ORDER BY unified_id, n DESC, jcat
      ),
      -- 5. Today's picks per journey category (latest available, fall back to
      --    the most recent computed_date if today's row isn't there yet)
      todays_picks AS (
        SELECT DISTINCT ON (category) category, product_ids, source, rationale
        FROM daily_category_picks
        ORDER BY category, computed_date DESC
      ),
      -- 6. All PAST_BOOKING users — attach either their max jcat or default 'activities'
      users_to_rec AS (
        SELECT uc.id AS unified_id,
               COALESCE(t.jcat, 'activities') AS jcat
        FROM unified_contacts uc
        LEFT JOIN user_top_jcat t ON t.unified_id = uc.id
        WHERE uc.booking_status = 'PAST_BOOKING' AND uc.email IS NOT NULL
      )
    INSERT INTO user_product_recommendations
      (unified_id, recommendation_type, based_on_booking_id, based_on_product_id,
       destination_city, product_ids, source, rationale, computed_at, expires_at)
    SELECT
      u.unified_id,
      'past_trip',
      NULL,
      u.jcat,                                                          -- store journey category as audit
      'multi-city',
      COALESCE(tp.product_ids, '[]'::jsonb),
      COALESCE(tp.source, 'no_category_picks'),
      'Top 5 ' || u.jcat || ' · ' || COALESCE(tp.rationale, 'no rationale'),
      NOW(),
      NOW() + INTERVAL '${cacheDays} days'
    FROM users_to_rec u
    LEFT JOIN todays_picks tp ON tp.category = u.jcat
    ON CONFLICT (unified_id, recommendation_type) DO UPDATE SET
      based_on_product_id = EXCLUDED.based_on_product_id,
      destination_city    = EXCLUDED.destination_city,
      product_ids         = EXCLUDED.product_ids,
      source              = EXCLUDED.source,
      rationale           = EXCLUDED.rationale,
      computed_at         = NOW(),
      expires_at          = EXCLUDED.expires_at
  `;

  const result = await db.query(sql);
  const inserted = result.rowCount || 0;
  const durMs = Date.now() - started;
  console.log(`[PastTripCron] Done — ${inserted} rows inserted/updated in ${(durMs / 1000).toFixed(1)}s`);

  // Coverage report
  const { rows: cov } = await db.query(`
    SELECT source, COUNT(*) FROM user_product_recommendations
    WHERE recommendation_type = 'past_trip' AND expires_at > NOW()
    GROUP BY source ORDER BY 2 DESC
  `);
  for (const c of cov) console.log(`[PastTripCron]   past_trip | ${c.source} | ${c.count}`);

  return { inserted, durationMs: durMs };
}

export default runDailyPastTripCompute;
