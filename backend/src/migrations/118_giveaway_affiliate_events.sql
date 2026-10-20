-- 118_giveaway_affiliate_events.sql
--
-- Merge the AFFILIATE event feed into the existing giveaway pipeline. Both feeds arrive on
-- the SAME CloudAMQP broker and the SAME `giveaways` topic exchange, differing only by
-- routing key (`giveaway.email.prod.*` vs `affiliate.email.prod.*`), so one table serves both.
--
-- NOT RUN YET — apply together with the code deploy. The code references the NEW table
-- name, so running this early (or deploying the code without it) breaks the ingest.
--
-- SAFETY
--   • RENAME is metadata-only: no rows copied, instant at any size, every index/constraint
--     follows automatically, and it reverses with a single statement.
--   • The 868 existing rows become source='GIVEAWAY' via the column DEFAULT.
--   • Affiliate payloads already fit the existing columns: `id` is TEXT (their composite ids
--     run ~110 chars), `tenant_id` is TEXT (ULIDs), and only `id` is NOT NULL — so rows with
--     no subject/body insert cleanly.
--   • Do NOT add a compatibility view named giveaway_events: PostgreSQL does not support
--     ON CONFLICT on views, and giveawayIngest relies on ON CONFLICT (id) DO NOTHING.
--
-- ROLLBACK
--   ALTER TABLE giveaway_affiliate_events RENAME TO giveaway_events;
--   (the added columns are nullable and harmless if left in place)

BEGIN;

ALTER TABLE giveaway_events RENAME TO giveaway_affiliate_events;

ALTER TABLE giveaway_affiliate_events
  -- Which feed produced the row. Derived from the routing key's first segment.
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'GIVEAWAY',
  -- Affiliate envelope
  ADD COLUMN IF NOT EXISTS user_tenant_id TEXT,
  -- coupon{}  — types: joined, coupon_assigned
  --   coupon.code       → existing `code`
  --   coupon.validUntil → existing `expiry`
  --   discounts[0].value→ existing `value`
  ADD COLUMN IF NOT EXISTS coupon_id TEXT,
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_total_redemptions INT,
  ADD COLUMN IF NOT EXISTS max_per_user INT,
  ADD COLUMN IF NOT EXISTS discount_type TEXT,          -- 'percentage' | 'amount'
  ADD COLUMN IF NOT EXISTS max_discount_value NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT,               -- discounts[0].maxDiscountCurrency
  -- commission{} — type: commission_assigned
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS commission_prev_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
  -- link{} — type: link_generated
  ADD COLUMN IF NOT EXISTS link_id TEXT,
  ADD COLUMN IF NOT EXISTS link_slug TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS destination_url TEXT,
  ADD COLUMN IF NOT EXISTS campaign_source TEXT,
  ADD COLUMN IF NOT EXISTS campaign_medium TEXT,
  ADD COLUMN IF NOT EXISTS campaign_name TEXT,
  -- cardOffer{} — type: card_offer_generated
  --   cardOffer.title → existing `offer`, cardOffer.code → existing `offer_code`
  ADD COLUMN IF NOT EXISTS offer_id TEXT,
  ADD COLUMN IF NOT EXISTS offer_subtitle TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS min_order_value NUMERIC,
  ADD COLUMN IF NOT EXISTS max_discount_cap NUMERIC;

-- Anything not mapped above (the full coupon/commission/link/cardOffer objects, userTenantId)
-- is still preserved verbatim in the existing raw_payload jsonb column.

CREATE INDEX IF NOT EXISTS idx_gae_source      ON giveaway_affiliate_events (source);
CREATE INDEX IF NOT EXISTS idx_gae_source_type ON giveaway_affiliate_events (source, type);

-- Indexes follow the rename automatically but keep their old names; rename for clarity.
ALTER INDEX IF EXISTS idx_giveaway_events_type     RENAME TO idx_gae_type;
ALTER INDEX IF EXISTS idx_giveaway_events_unified  RENAME TO idx_gae_unified;
ALTER INDEX IF EXISTS idx_giveaway_events_giveaway RENAME TO idx_gae_giveaway;
ALTER INDEX IF EXISTS idx_giveaway_events_created  RENAME TO idx_gae_created;

COMMIT;
