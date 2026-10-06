-- 117_contact_market_currency.sql
-- Per-user market pricing identity (see utils/marketPlan.js):
--   market_plan   — which products.market_prices key applies: 'IN' | 'SA' | 'AE' | 'default'
--   currency_code — ISO display currency ('INR','AED','SAR','GBP','PKR',… ; AED fallback)
-- Derived from unified_contacts.country (+ is_indian). Backfilled + refreshed nightly by
-- crons/contactMarketRefresh.js. Nullable + additive → fully reversible via DROP COLUMN;
-- when NULL, resolveMarket derives live from country (fail-open).

ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS market_plan   TEXT;
ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS currency_code TEXT;
