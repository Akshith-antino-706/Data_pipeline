/**
 * Per-recipient TRIP / PRODUCT NAME for post-trip emails (`%%TRIP_NAME%%`).
 *
 * WHY THIS EXISTS
 * placeholderResolver fills ITEM_NAME from the TRIGGERING GTM EVENT. A per-user continuous
 * journey (trigger_event = NULL — every post-trip journey) has no event, so ITEM_NAME is
 * structurally blank and NO template can recover it. The name of what the customer actually
 * booked lives in the rayna_* billing tables, which the resolver never reads.
 *
 * So the email worker swaps a `%%TRIP_NAME%%` sentinel per recipient at send time — exactly
 * the mechanism `%%REVIEW_URL%%` already uses for booking-sourced data. The `%%…%%` syntax is
 * deliberate: placeholderResolver's regex only matches {{KEY}}, so it walks straight past this.
 *
 * "Most recent trip" = the bill with the latest travel_date on/before today, among ACTIVE
 * (is_cancel='0') bookings across all booking types — the SAME definition buildReviewUrl uses,
 * so the name in the copy and the trip behind the review link always agree.
 *
 * ADDITIVE: only templates containing %%TRIP_NAME%% reach this code. None did before it.
 */
import db from '../config/database.js';

const BOOKING_TABLES = ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_packages', 'rayna_others'];

const UNION_SQL = BOOKING_TABLES.map(t => `
  SELECT bill_no, service_name, travel_date FROM ${t}
   WHERE unified_id = $1
     AND bill_no IS NOT NULL
     AND is_cancel = '0'
     AND travel_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     AND travel_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD')
     AND service_name IS NOT NULL AND service_name <> '' AND service_name <> 'MIX Charges'`).join('\n  UNION ALL\n');

const QUERY = `
  WITH all_b AS (${UNION_SQL}),
       latest AS (SELECT bill_no FROM all_b ORDER BY travel_date DESC, bill_no LIMIT 1)
  SELECT DISTINCT b.service_name
    FROM all_b b JOIN latest l ON b.bill_no = l.bill_no
   ORDER BY b.service_name`;

/**
 * Human-readable name of the contact's most recent completed trip.
 *
 *   one service    → "Aquaventure Day Pass - All Days"
 *   two services   → "Dubai Frame Admission and Global Village Entrance"
 *   three or more  → "Dubai Frame Admission and 3 more experiences"
 *
 * Never returns empty — the caller can swap it in blind, so the sentinel can never
 * reach an inbox as literal text.
 *
 * `fallback` is used when the contact has no eligible booking.
 */
export async function buildTripName(unifiedId: number | string | null | undefined, fallback = 'your recent booking'): Promise<string> {
  if (!unifiedId) return fallback;
  let rows: { service_name: string | null }[];
  try {
    ({ rows } = await db.query<{ service_name: string | null }>(QUERY, [unifiedId]));
  } catch (err) {
    console.error(`[tripName] query failed for unified_id=${unifiedId}: ${(err as Error).message}`);
    return fallback;
  }
  const names = rows.map(r => String(r.service_name || '').trim()).filter(Boolean);
  if (!names.length) return fallback;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} more experiences`;
}

export default { buildTripName };
