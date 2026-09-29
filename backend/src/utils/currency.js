/**
 * Currency conversion for emails — converts AED base prices (from the product feed)
 * into the recipient's local currency using the `fx_rates` table (refreshed daily by
 * crons/fxRatesSync.js).
 *
 *   1 AED = fx_rates.aed_to_currency  <currency>
 *
 * Rates are cached in-process for CACHE_TTL_MS so we don't hit the DB per product.
 * Fail-safe: if a rate is missing/unavailable, we fall back to AED (never blank/crash).
 */
import db from '../config/database.js';

const CACHE_TTL_MS = 60 * 60 * 1000;   // 1h
let _rates = null;         // { AED:1, INR:26.1, SAR:1.02, USD:0.27 }
let _ratesAt = 0;

const SYMBOL = { AED: 'AED ', INR: '₹', SAR: 'SAR ', USD: '$' };

/** Load AED→currency rates (cached). Never throws — returns at least { AED: 1 }. */
export async function getRates() {
  if (_rates && Date.now() - _ratesAt < CACHE_TTL_MS) return _rates;
  try {
    const { rows } = await db.query('SELECT currency, aed_to_currency FROM fx_rates');
    const map = { AED: 1 };
    for (const r of rows) map[String(r.currency).toUpperCase()] = Number(r.aed_to_currency);
    _rates = map; _ratesAt = Date.now();
  } catch {
    _rates = _rates || { AED: 1 };   // keep last good, else AED-only
  }
  return _rates;
}

/** Convert an AED amount to `currency`. Falls back to the AED amount if no rate. */
export async function convertFromAed(amountAed, currency = 'AED') {
  const amt = Number(amountAed);
  if (!Number.isFinite(amt)) return null;
  const cur = String(currency || 'AED').toUpperCase();
  if (cur === 'AED') return amt;
  const rates = await getRates();
  const rate = rates[cur];
  if (!rate || !Number.isFinite(rate)) return amt;   // fail-safe → AED amount
  return amt * rate;
}

/** Format an amount + currency for display, e.g. "₹3,526", "SAR 138", "AED 128", "$35". */
export function format(amount, currency = 'AED') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const cur = String(currency || 'AED').toUpperCase();
  const rounded = Math.round(n).toLocaleString('en-US');   // whole units, thousands separators
  return `${SYMBOL[cur] ?? (cur + ' ')}${rounded}`;
}

/** Convenience: AED amount → fully formatted local string in one call. */
export async function priceInCurrency(amountAed, currency = 'AED') {
  const converted = await convertFromAed(amountAed, currency);
  return converted == null ? '' : format(converted, currency);
}

export default { getRates, convertFromAed, format, priceInCurrency };
