/**
 * Resolve a contact's rate PLAN (feed market_prices key) + display CURRENCY from their
 * unified_contacts.country (or the is_indian flag).
 *
 *   India / is_indian        → plan 'IN',      currency 'INR'
 *   Saudi Arabia             → plan 'SA',      currency 'SAR'
 *   United Arab Emirates     → plan 'AE',      currency 'AED'
 *   everything else / none   → plan 'default', currency 'USD'
 *
 * The feed's market_prices are all in AED regardless of plan; currency conversion
 * (via utils/currency.js) turns the chosen plan's AED price into the local currency.
 */

export function resolveMarket(contact = {}) {
  const country = String(contact.country || '').trim().toLowerCase();

  if (contact.is_indian === true || country === 'india') {
    return { plan: 'IN', currency: 'INR' };
  }
  if (country === 'saudi arabia' || country === 'ksa') {
    return { plan: 'SA', currency: 'SAR' };
  }
  if (country === 'united arab emirates' || country === 'uae') {
    return { plan: 'AE', currency: 'AED' };
  }
  // Everyone else (incl. no country) → default retail plan, shown in USD.
  return { plan: 'default', currency: 'USD' };
}

export default { resolveMarket };
