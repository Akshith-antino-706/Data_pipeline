
-- 113_market_prices_and_fx.sql
--
-- Country-based local pricing for recommendation emails (Phase 1).
--
--   1. products.market_prices (jsonb) — per-rate-plan AED prices straight from the
--      enriched feed: { default:{sale_price,…}, SA:{…}, IN:{…}, AE:{…} }. Tour per-option
--      prices already live inside the existing `options` jsonb (variants[].market_prices),
--      so only this top-level field is new.
--   2. fx_rates — AED → local-currency rates, refreshed daily by crons/fxRatesSync.js
--      (source: https://open.er-api.com/v6/latest/AED). Seeded with the CURRENT live
--      market rates so pricing is correct even before the first FX cron run.
--
-- Additive + idempotent: new nullable column + new table, NO existing column touched.
-- Safe to re-run. Fully reversible (DROP COLUMN / DROP TABLE).

-- ── 1. per-market prices on products (populated by syncProducts on next run) ──
ALTER TABLE products ADD COLUMN IF NOT EXISTS market_prices jsonb;

-- ── 2. FX rates: 1 AED = <aed_to_currency> <currency> ──
CREATE TABLE IF NOT EXISTS fx_rates (
  currency         text PRIMARY KEY,          -- ISO code: AED, INR, SAR, USD
  aed_to_currency  numeric(14,6) NOT NULL,    -- multiply an AED amount by this to get `currency`
  source           text,                      -- 'api' | 'fallback' | 'manual'
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Seed with CURRENT live market rates (open.er-api.com, AED base, 2026-09-28).
-- The daily FX cron overwrites these; ON CONFLICT DO NOTHING so re-running the
-- migration never clobbers a live rate already fetched.
INSERT INTO fx_rates (currency, aed_to_currency, source) VALUES
  ('AED', 1.000000,  'seed'),
  ('INR', 26.122186, 'seed'),
  ('SAR', 1.021103,  'seed'),
  ('USD', 0.272294,  'seed')
ON CONFLICT (currency) DO NOTHING;
