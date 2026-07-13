-- 094_products_enriched_columns.sql
--
-- Expand the products table to store all fields from the enriched-feed API:
--   https://data-projects-flax.vercel.app/api/enriched-feed?format=json&types=tour,holiday,cruise,yacht
--
-- All existing 15 columns are UNCHANGED. New columns are nullable so existing
-- rows stay valid. syncProducts() will populate them on the next sync run.
--
-- Idempotent — safe to re-run (ADD COLUMN IF NOT EXISTS everywhere).

-- ── Listing / detail metadata ─────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_rating         NUMERIC(3,1);
ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_review_count   INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_amenities      TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS enriched_flag          BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_title           TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_share_url       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS detail_promotion_badge TEXT;

-- ── Location ──────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS location_address       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS location_title         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS location_latitude      NUMERIC(10,6);
ALTER TABLE products ADD COLUMN IF NOT EXISTS location_longitude     NUMERIC(10,6);

-- ── Amenities (12 fields) ─────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenities_all          TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_duration       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_pickup         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_transport      TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_meals          TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_language       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_group_size     TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_hotel          TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_nights         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_confirmation   TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_voucher        TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS amenity_cancellation   TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS transfer_types         TEXT;

-- ── Long-form content ─────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_text         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_overview         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_highlights       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_inclusions       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_exclusions       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_how_to_redeem    TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_know_before_you_go TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_sections         JSONB;

-- ── Meta / SEO ────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_title             TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_description       TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_keywords          TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_h1                TEXT;

-- ── Availability / booking ────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS available              BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS next_available_dates   JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS options                JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS options_count          INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS lowest_option_price    NUMERIC(12,2);

-- ── Pricing (detailed from API) ───────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_total_price      NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_currency         TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_discount         NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_discounted_price NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_availability_status TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_booking_url      TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_variant          TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_yacht_type       TEXT;

-- ── Reviews ───────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_average_rating  NUMERIC(3,1);
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_total_count     INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_excellent       INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_very_good       INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_average         INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_poor            INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS review_terrible        INTEGER;

-- ── Cruise-specific ───────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS cruise_next_date       TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cruise_total_dates     INTEGER;

-- ── Holiday-specific ──────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS holiday_hotels         JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS holiday_tours          JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS holiday_categories     JSONB;

-- ── Yacht-specific ────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS yacht_type             TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS yacht_min_guests       INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS yacht_max_guests       INTEGER;

-- ── Media ─────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS all_image_links        JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_count            INTEGER;

-- ── Lifecycle ─────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS first_seen_date        TIMESTAMPTZ;

-- ── Indexes for common lookups ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_products_type_city   ON products(type, city) WHERE type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_rating      ON products(listing_rating DESC NULLS LAST) WHERE listing_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_available   ON products(available) WHERE available = true;
