/**
 * Resolve a contact's rate PLAN (feed market_prices key) + display CURRENCY.
 *
 *   India (any variant / is_indian)  → plan 'IN',      currency 'INR'
 *   Saudi Arabia (any variant)       → plan 'SA',      currency 'SAR'
 *   United Arab Emirates (variant)   → plan 'AE',      currency 'AED'
 *   any OTHER known country          → plan 'default', currency = that country's own
 *                                      (via utils/countryCurrency — names, ISO codes, variants)
 *   blank / unknown country          → plan 'default', currency 'AED'  (never guess)
 *
 * Persisted per contact as unified_contacts.market_plan + currency_code (backfilled +
 * refreshed nightly); when those columns are present on the contact row they win, so
 * send-time needs no re-derivation. Falls back to live derivation otherwise.
 *
 * The feed's market_prices are AED for every plan; utils/currency.js converts the chosen
 * plan's AED price into the display currency at send time (fx_rates, refreshed daily).
 */
import { currencyForCountry, normalizeCountry } from './countryCurrency.js';

const INDIA = new Set(['india', 'in', 'ind', 'bharat', 'republic of india']);
const SAUDI = new Set(['saudi arabia', 'ksa', 'sa', 'sau', 'saudi', 'kingdom of saudi arabia']);
const UAE   = new Set(['united arab emirates', 'uae', 'ae', 'are', 'emirates', 'u a e']);

const VALID_PLANS = new Set(['IN', 'SA', 'AE', 'default']);

export function resolveMarket(contact = {}) {
  // Stored per-user values win (set by the backfill / nightly refresh).
  const storedPlan = String(contact.market_plan || '').trim();
  const storedCur  = String(contact.currency_code || '').trim().toUpperCase();
  if (VALID_PLANS.has(storedPlan) && /^[A-Z]{3}$/.test(storedCur)) {
    return { plan: storedPlan, currency: storedCur };
  }

  // mobile_country (derived from the phone number) is more reliable than the free-text
  // country field, so it wins when present; country is the fallback.
  const n = normalizeCountry(contact.mobile_country) || normalizeCountry(contact.country);

  if (contact.is_indian === true || INDIA.has(n)) return { plan: 'IN', currency: 'INR' };
  if (SAUDI.has(n))                               return { plan: 'SA', currency: 'SAR' };
  if (UAE.has(n))                                 return { plan: 'AE', currency: 'AED' };

  // Everyone else → default retail plan in their OWN currency; blank/unknown → AED.
  return { plan: 'default', currency: currencyForCountry(n) || 'AED' };
}

/**
 * Mobile-country-only market (daily offer email rule):
 *   India → IN/INR · Saudi → SA/SAR · UAE → AE/AED · other known country → default in
 *   its own currency · blank/unknown → default/AED. Ignores is_indian, the typed country
 *   and the stored market_plan/currency_code. Existing callers keep using resolveMarket.
 */
export function resolveMarketByMobileCountry(mobileCountry) {
  const n = normalizeCountry(mobileCountry);
  if (!n)              return { plan: 'default', currency: 'AED' };
  if (INDIA.has(n))    return { plan: 'IN', currency: 'INR' };
  if (SAUDI.has(n))    return { plan: 'SA', currency: 'SAR' };
  if (UAE.has(n))      return { plan: 'AE', currency: 'AED' };
  return { plan: 'default', currency: currencyForCountry(n) || 'AED' };
}

export default { resolveMarket, resolveMarketByMobileCountry };
