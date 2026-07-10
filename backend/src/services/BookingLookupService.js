/**
 * BookingLookupService
 *
 * Resolves a user's most-relevant booking for a given recommendation context.
 * Isolated in its own file so the messy join across rayna_tours (and later
 * rayna_packages / rayna_hotels / …) stays contained.
 *
 * ADDITIVE — read-only. No writes, no touches to existing services.
 *
 * Contract:
 *   findFor(unifiedId, context) → {
 *     bookingId:       <bigint>,
 *     productId:       '<text>',
 *     productName:     '<text>',
 *     destinationCity: '<text>',
 *     travelDate:      '<YYYY-MM-DD>',
 *   } | null
 *
 * `context` is one of: 'on_trip', 'future_trip', 'past_trip'
 *   - on_trip:      travel_date in [today-7, today]     (they're mid-trip)
 *   - future_trip:  travel_date > today                 (upcoming)
 *   - past_trip:    travel_date < today-7               (previous trips, TBD refinement)
 *
 * City derivation: rayna_tours has no `city` column, but service_id maps to
 * products.product_id, which does. We JOIN products to fill it in.
 */

import db from '../config/database.js';

const CONTEXT_WHERE = {
  // Only match travel_date rows that look like YYYY-MM-DD (the text column has
  // dirty values). Using the same regex as UnifiedContactBuilder to stay
  // consistent with how the ON_TRIP segment is computed.
  on_trip: `
    travel_date ~ '^\\d{4}-\\d{2}-\\d{2}'
    AND travel_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE
  `,
  future_trip: `
    travel_date ~ '^\\d{4}-\\d{2}-\\d{2}'
    AND travel_date::date > CURRENT_DATE
  `,
  past_trip: `
    travel_date ~ '^\\d{4}-\\d{2}-\\d{2}'
    AND travel_date::date < CURRENT_DATE - 7
  `,
};

/**
 * Find the single most-relevant booking for this user + context.
 *
 * Ordering rules (deterministic — same picks every call):
 *   on_trip:     latest travel_date within window, then latest id
 *   future_trip: EARLIEST future travel_date (the "next" trip), then latest id
 *   past_trip:   MOST RECENT past travel_date, then latest id
 */
export async function findFor(unifiedId, context) {
  if (!unifiedId) return null;
  if (!CONTEXT_WHERE[context]) throw new Error(`Unknown context: ${context}`);

  const ordering =
    context === 'future_trip'
      ? 'ORDER BY travel_date::date ASC, id DESC'
      : 'ORDER BY travel_date::date DESC, id DESC';

  // Union across all 6 booking source tables. Same 5 cols per table (verified in DB).
  // rt.tbl is the source table name, kept for diagnostics.
  const RAYNA_TABLES = ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_others'];
  const unions = RAYNA_TABLES.map(t => `
    SELECT id, service_id, service_name, travel_date, is_cancel, unified_id, '${t}' AS tbl
    FROM ${t}
    WHERE unified_id = $1 AND COALESCE(is_cancel, '0') <> '1' AND ${CONTEXT_WHERE[context]}
  `).join(' UNION ALL ');

  const sql = `
    SELECT rt.id            AS booking_id,
           rt.service_id    AS product_id,
           rt.service_name  AS product_name,
           rt.travel_date   AS travel_date,
           rt.tbl           AS source_table,
           p.city           AS destination_city
    FROM (${unions}) rt
    LEFT JOIN products p
      ON p.product_id::text = rt.service_id
    ${ordering}
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [unifiedId]);
  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    bookingId:       r.booking_id,
    productId:       r.product_id || null,
    productName:     r.product_name || null,
    travelDate:      r.travel_date || null,
    // City derivation fallback chain:
    // 1. products JOIN (rare — service_id from bookings usually doesn't match products.product_id)
    // 2. Scan service_name for known city names
    // 3. Default to Dubai (Rayna Tours is Dubai-based; top 10 booked services are all Dubai attractions)
    destinationCity: r.destination_city || _deriveCityFromName(r.product_name) || 'Dubai',
  };
}

// Known Rayna destinations. Add here as coverage expands.
const KNOWN_CITIES = [
  'Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah', 'Ajman',
  'Bali', 'Singapore', 'Istanbul', 'Bangkok', 'Phuket', 'Kuala Lumpur',
  'Maldives', 'Sri Lanka', 'Colombo',
];

function _deriveCityFromName(serviceName) {
  if (!serviceName) return null;
  const s = serviceName.toLowerCase();
  for (const city of KNOWN_CITIES) {
    if (s.includes(city.toLowerCase())) return city;
  }
  return null;
}

/**
 * Diagnostic — return ALL bookings matching this context for a user.
 * Used by the daily cron to log completeness stats.
 */
export async function listFor(unifiedId, context, { limit = 10 } = {}) {
  if (!unifiedId) return [];
  if (!CONTEXT_WHERE[context]) throw new Error(`Unknown context: ${context}`);

  const { rows } = await db.query(`
    SELECT rt.id, rt.service_id, rt.service_name, rt.travel_date, p.city
    FROM rayna_tours rt
    LEFT JOIN products p ON p.product_id::text = rt.service_id
    WHERE rt.unified_id = $1
      AND COALESCE(rt.is_cancel, '0') <> '1'
      AND ${CONTEXT_WHERE[context]}
    ORDER BY rt.travel_date::date DESC, rt.id DESC
    LIMIT $2
  `, [unifiedId, limit]);
  return rows;
}

export default { findFor, listFor };
