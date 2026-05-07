/**
 * Centralised blocklist for destinations / cities we should NOT promote
 * right now (active conflict zones, travel advisories, regulatory issues, etc.).
 *
 * Every Day-N data service and ranking service imports from here so a single
 * edit to this file removes the blocked destination from every email template
 * (Day-1 welcome, Day-2 cruise, Day-3 visa, Day-4 holidays, Day-5 activities).
 *
 * What's blocked:
 *   - BLOCKED_DESTINATION_KEYS: matches catalog keys (e.g. 'dubai' in
 *     HOLIDAY_DESTINATIONS, DEPARTURE_CITIES, TOP_CITIES, visa_products).
 *   - BLOCKED_CITIES: matches catalog rows that store a city string
 *     (e.g. ACTIVITY_CATALOG entries tagged city='Dubai'). Compared
 *     case-insensitively after trimming.
 *
 * To unblock: remove the key/city from the Set below. To add a new block:
 * add the key + the matching city. Always do BOTH so all template types
 * are covered.
 */

// Catalog KEYS used by the destination-keyed maps (cities, holidays, cruises).
export const BLOCKED_DESTINATION_KEYS = new Set([
  'dubai',
]);

// City NAMES used by maps that tag rows with a city string (activities).
export const BLOCKED_CITIES = new Set([
  'dubai',
]);

/** Test whether a destination KEY (e.g. 'dubai', 'abu_dhabi') is blocked. */
export function isKeyBlocked(key) {
  return BLOCKED_DESTINATION_KEYS.has(String(key || '').toLowerCase());
}

/** Test whether a CITY (e.g. 'Dubai', 'Abu Dhabi') is blocked. */
export function isCityBlocked(city) {
  return BLOCKED_CITIES.has(String(city || '').trim().toLowerCase());
}

/**
 * Filter a destination map (object keyed by destination key) to remove
 * blocked entries. Returns a new object — does not mutate.
 *
 *   filterMapByKey({ dubai: {...}, singapore: {...} })
 *      → { singapore: {...} }
 */
export function filterMapByKey(map) {
  return Object.fromEntries(
    Object.entries(map).filter(([key]) => !isKeyBlocked(key))
  );
}

/**
 * Filter an activity-style map where each entry has a `city` field.
 * Removes entries whose city is blocked.
 */
export function filterMapByCity(map) {
  return Object.fromEntries(
    Object.entries(map).filter(([, entry]) => !isCityBlocked(entry?.city))
  );
}

export default {
  BLOCKED_DESTINATION_KEYS,
  BLOCKED_CITIES,
  isKeyBlocked,
  isCityBlocked,
  filterMapByKey,
  filterMapByCity,
};
