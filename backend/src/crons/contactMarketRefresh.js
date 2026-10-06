/**
 * contactMarketRefresh — derive + persist each contact's market pricing identity:
 *   unified_contacts.market_plan ('IN'|'SA'|'AE'|'default') + currency_code (ISO).
 *
 * Set-based and idempotent: resolves each DISTINCT country value once in JS (the
 * country→currency map lives in utils/countryCurrency), then issues one batched
 * UPDATE per country value — only touching rows whose stored values differ, so the
 * nightly run after the initial backfill is nearly free. is_indian=true overrides
 * country last (IN/INR), matching utils/marketPlan.resolveMarket exactly.
 *
 * Run nightly (after the FX cron) and ad-hoc:  node src/crons/contactMarketRefresh.js
 */
import db from '../config/database.js';
import { resolveMarket } from '../utils/marketPlan.js';

const BATCH = parseInt(process.env.CONTACT_MARKET_BATCH || '50000', 10);

async function batchedUpdate(whereSql, params, plan, currency) {
  let total = 0;
  for (;;) {
    const { rowCount } = await db.query(
      `UPDATE unified_contacts SET market_plan = $${params.length + 1}, currency_code = $${params.length + 2}
       WHERE id IN (
         SELECT id FROM unified_contacts
         WHERE ${whereSql}
           AND (market_plan IS DISTINCT FROM $${params.length + 1} OR currency_code IS DISTINCT FROM $${params.length + 2})
         LIMIT ${BATCH}
       )`,
      [...params, plan, currency]
    );
    total += rowCount;
    if (rowCount < BATCH) return total;
  }
}

export async function runContactMarketRefresh() {
  const started = Date.now();
  console.log(`[ContactMarket] Starting at ${new Date().toISOString()}`);

  // 1. PRIMARY: every distinct mobile_country value (derived from the phone number — far more
  //    reliable than the free-text country field) → resolve once → one batched UPDATE each.
  const { rows: mobiles } = await db.query(
    `SELECT DISTINCT mobile_country FROM unified_contacts WHERE COALESCE(TRIM(mobile_country), '') <> ''`
  );
  let changed = 0;
  for (const { mobile_country } of mobiles) {
    const { plan, currency } = resolveMarket({ mobile_country });
    changed += await batchedUpdate(`mobile_country = $1`, [mobile_country], plan, currency);
  }

  // 2. FALLBACK: rows with NO mobile_country → derive from the country field.
  const { rows: countries } = await db.query(
    `SELECT DISTINCT country FROM unified_contacts
     WHERE COALESCE(TRIM(mobile_country), '') = '' AND COALESCE(TRIM(country), '') <> ''`
  );
  for (const { country } of countries) {
    const { plan, currency } = resolveMarket({ country });
    changed += await batchedUpdate(
      `COALESCE(TRIM(mobile_country), '') = '' AND country = $1`, [country], plan, currency
    );
  }

  // 3. Blank both → default plan in AED (never guess a currency).
  changed += await batchedUpdate(
    `COALESCE(TRIM(mobile_country), '') = '' AND COALESCE(TRIM(country), '') = ''`, [], 'default', 'AED'
  );

  // 4. is_indian override LAST — wins over everything (matches resolveMarket).
  changed += await batchedUpdate(`is_indian = true`, [], 'IN', 'INR');

  console.log(`[ContactMarket] Done in ${Math.round((Date.now() - started) / 1000)}s — ${mobiles.length} mobile-countries + ${countries.length} country-fallbacks, ${changed} rows updated`);
  return { ok: true, mobileCountries: mobiles.length, countryFallbacks: countries.length, changed };
}

export default { runContactMarketRefresh };

// CLI: node src/crons/contactMarketRefresh.js
if (process.argv[1] && process.argv[1].endsWith('contactMarketRefresh.js')) {
  runContactMarketRefresh().then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
