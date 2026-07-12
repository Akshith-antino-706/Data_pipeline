/**
 * Per-recipient post-trip review link builder.
 *
 * Post-trip review emails (e.g. J22_post_trip_n1, content_template 122) carry a
 * `%%REVIEW_URL%%` sentinel that the email worker swaps — per recipient, at send
 * time — for a link to the feedback site, pre-filled with the recipient's most
 * recent completed trip:
 *
 *   https://feedback.raynatours.com/?ref=<bill_no>&name=&email=&audience=&items=
 *
 * "Most recent trip" = the bill with the latest travel_date on/before today,
 * among ACTIVE (non-cancelled, is_cancel='0') bookings, across ALL booking types
 * (tours/hotels/visas/packages/others). `items` lists
 * every service on that one bill as `service_name|bill_type|YYYY-MM-DD`, joined
 * by ';'. Data source: the rayna_* billing tables, joined by unified_id.
 */
import db from '../config/database.js';

const REVIEW_BASE = (process.env.REVIEW_SITE_URL || 'https://feedback.raynatours.com').replace(/\/+$/, '');

const BOOKING_TABLES = ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_packages', 'rayna_others'];

// UNION ALL of every booking type for one contact — only real, past, named services.
// travel_date is stored as TEXT in canonical YYYY-MM-DD form, so lexicographic
// comparison/ordering is exact; the regex guard drops any stray malformed value.
const UNION_SQL = BOOKING_TABLES.map(t => `
  SELECT bill_no, bill_type, service_name, travel_date FROM ${t}
   WHERE unified_id = $1
     AND bill_no IS NOT NULL
     AND is_cancel = '0'
     AND travel_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     AND travel_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD')
     AND service_name IS NOT NULL AND service_name <> '' AND service_name <> 'MIX Charges'`).join('\n  UNION ALL\n');

const QUERY = `
  WITH all_b AS (${UNION_SQL}),
       latest AS (SELECT bill_no FROM all_b ORDER BY travel_date DESC, bill_no LIMIT 1)
  SELECT b.bill_no, b.bill_type, b.service_name, b.travel_date
    FROM all_b b JOIN latest l ON b.bill_no = l.bill_no
   ORDER BY b.travel_date, b.service_name`;

const enc = encodeURIComponent;

/**
 * Build the feedback URL for a contact's most recent completed trip.
 * Returns the bare feedback base (still a working button) when the contact has
 * no eligible bookings, so the CTA is never a dead/relative link.
 */
export async function buildReviewUrl(unifiedId) {
  if (!unifiedId) return REVIEW_BASE + '/';
  let rows;
  try {
    ({ rows } = await db.query(QUERY, [unifiedId]));
  } catch (err) {
    console.error(`[reviewUrl] booking query failed for unified_id=${unifiedId}: ${err.message}`);
    return REVIEW_BASE + '/';
  }
  if (!rows.length) return REVIEW_BASE + '/';

  const billNo = rows[0].bill_no;
  // travel_date is already canonical YYYY-MM-DD text — use as-is (no Date() TZ shifts).
  const items = rows.map(r => `${r.service_name}|${r.bill_type}|${r.travel_date || ''}`).join(';');

  let name = '', email = '', audience = '';
  try {
    const { rows: [uc] } = await db.query(
      'SELECT name, email, contact_type FROM unified_contacts WHERE id = $1', [unifiedId]
    );
    name = uc?.name || '';
    email = uc?.email || '';
    audience = (uc?.contact_type || '').toLowerCase();
  } catch (err) {
    console.error(`[reviewUrl] contact lookup failed for unified_id=${unifiedId}: ${err.message}`);
  }

  return `${REVIEW_BASE}/?ref=${enc(billNo)}&name=${enc(name)}&email=${enc(email)}&audience=${enc(audience)}&items=${enc(items)}`;
}

export default { buildReviewUrl };
