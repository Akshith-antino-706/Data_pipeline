/**
 * fxRatesSync
 *
 * Daily refresh of AED→local-currency exchange rates into the `fx_rates` table.
 * These feed country-based email pricing (utils/currency.js): the product feed
 * gives per-market prices in AED, and we convert to the recipient's currency.
 *
 * Source: https://open.er-api.com/v6/latest/AED  (free, no key, AED base).
 * Fail-safe: on any error the existing rows are left untouched (last-good rates
 * stay in place, or the migration's seed values), so pricing never breaks.
 *
 * We refresh currencies we actually use; add to CURRENCIES to support more.
 */
import db from '../config/database.js';

const FX_URL = process.env.FX_RATES_URL || 'https://open.er-api.com/v6/latest/AED';
// ALL currencies from the API response are stored (one AED-base call returns ~160) so the
// `default` market plan can display every user's OWN currency (see utils/countryCurrency).
// Core currencies keep strict sanity bounds; the rest just need to be finite and positive.
const BOUNDS = { AED: [1, 1], INR: [10, 40], SAR: [0.8, 1.3], USD: [0.2, 0.35] };

export async function runFxRatesSync() {
  const started = Date.now();
  console.log(`[FxRatesCron] Starting at ${new Date().toISOString()} — ${FX_URL}`);

  let data;
  try {
    const res = await fetch(FX_URL, { signal: AbortSignal.timeout(20000) });
    data = await res.json();
    if (data?.result !== 'success' || !data?.rates) throw new Error(`bad response: ${data?.result || 'no rates'}`);
  } catch (err) {
    console.error(`[FxRatesCron] fetch failed (${err.message}) — keeping existing rates`);
    return { ok: false, error: err.message };
  }

  let updated = 0, skipped = 0;
  for (const [cur, raw] of Object.entries(data.rates)) {
    if (!/^[A-Z]{3}$/.test(cur)) { skipped++; continue; }
    const rate = Number(raw);
    const [lo, hi] = BOUNDS[cur] || [1e-9, Infinity];   // non-core: finite & positive
    if (!Number.isFinite(rate) || rate < lo || rate > hi) {
      console.warn(`[FxRatesCron] ${cur}: rate ${raw} out of bounds [${lo},${hi}] — skipped`);
      skipped++;
      continue;
    }
    try {
      await db.query(`
        INSERT INTO fx_rates (currency, aed_to_currency, source, updated_at)
        VALUES ($1, $2, 'api', now())
        ON CONFLICT (currency) DO UPDATE SET aed_to_currency = EXCLUDED.aed_to_currency, source = 'api', updated_at = now()
      `, [cur, rate]);
      updated++;
    } catch (err) {
      console.error(`[FxRatesCron] ${cur} upsert failed:`, err.message);
    }
  }

  console.log(`[FxRatesCron] Done in ${Date.now() - started}ms — updated ${updated} currencies (${skipped} skipped)`);
  return { ok: true, updated, skipped };
}

export default { runFxRatesSync };
