/**
 * unified_contacts.contact_type values. Stored exactly as spelled here.
 *   B2C       — end customers (bookings, chats, website guest users)
 *   B2B       — travel agents and partners (B2B bookings, agent registrations)
 *   Affiliate — affiliate partners (affiliate registrations)
 */
export const CONTACT_TYPES = ['B2C', 'B2B', 'Affiliate'];

const BY_LOWER = Object.fromEntries(CONTACT_TYPES.map(t => [t.toLowerCase(), t]));

/** Any spelling ('b2b', 'AFFILIATE', ' B2C ') → the stored value, or null when it isn't a contact type. */
export function normalizeContactType(value) {
  if (value === null || value === undefined) return null;
  return BY_LOWER[String(value).trim().toLowerCase()] || null;
}

/** Scope filter from a query string: a contact type, or undefined for "All" / unknown values. */
export function parseBusinessType(value) {
  return normalizeContactType(value) || undefined;
}
