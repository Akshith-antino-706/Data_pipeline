-- ===================================================================
-- Migration 047: Ensure All Infrastructure Objects Exist
-- Safe to run repeatedly (IF NOT EXISTS / OR REPLACE throughout)
-- Creates objects that were previously created manually but missing
-- from the migration pipeline.
-- ===================================================================

-- 1. normalize_phone() function — extracts last 10 digits from any phone string
CREATE OR REPLACE FUNCTION normalize_phone(raw TEXT)
RETURNS TEXT AS $$
BEGIN
  IF raw IS NULL OR LENGTH(REGEXP_REPLACE(raw, '[^0-9]', '', 'g')) < 7 THEN
    RETURN NULL;
  END IF;
  RETURN RIGHT(REGEXP_REPLACE(raw, '[^0-9]', '', 'g'), 10);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. unified_contacts table — master unified customer profile
CREATE TABLE IF NOT EXISTS unified_contacts (
  unified_id          BIGSERIAL PRIMARY KEY,
  email_key           TEXT,
  email               TEXT,
  phone               TEXT,
  phone_key           TEXT,
  name                TEXT,
  company_name        TEXT,
  city                TEXT,
  country             TEXT,
  contact_type        TEXT,
  business_type       TEXT DEFAULT 'B2C',
  sources             TEXT DEFAULT '',
  first_seen_at       TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  total_chats         INTEGER DEFAULT 0,
  first_chat_at       TIMESTAMPTZ,
  last_chat_at        TIMESTAMPTZ,
  first_msg_text      TEXT,
  last_msg_text       TEXT,
  chat_departments    TEXT,
  wa_unsubscribed     TEXT DEFAULT 'No',
  email_unsubscribed  TEXT DEFAULT 'No',
  total_tour_bookings   INTEGER DEFAULT 0,
  total_hotel_bookings  INTEGER DEFAULT 0,
  total_visa_bookings   INTEGER DEFAULT 0,
  total_flight_bookings INTEGER DEFAULT 0,
  total_booking_revenue NUMERIC DEFAULT 0,
  first_booking_at    TIMESTAMPTZ,
  last_booking_at     TIMESTAMPTZ,
  total_ga4_events    INTEGER DEFAULT 0,
  ga4_sessions        INTEGER DEFAULT 0,
  ga4_first_seen      TIMESTAMPTZ,
  ga4_last_seen       TIMESTAMPTZ,
  booking_status      TEXT,
  product_tier        TEXT,
  geography           TEXT,
  is_indian           BOOLEAN DEFAULT false,
  segment_label       TEXT,
  current_occasion    TEXT,
  occasion_date       DATE,
  occasion_offer_tag  TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uc_email_key ON unified_contacts(email_key);
CREATE INDEX IF NOT EXISTS idx_uc_phone_key ON unified_contacts(phone_key);
CREATE INDEX IF NOT EXISTS idx_uc_booking_status ON unified_contacts(booking_status);
CREATE INDEX IF NOT EXISTS idx_uc_business_type ON unified_contacts(business_type);
CREATE INDEX IF NOT EXISTS idx_uc_segment_label ON unified_contacts(segment_label);

-- 3. chat_contacts table — aggregated WhatsApp chat contacts
CREATE TABLE IF NOT EXISTS chat_contacts (
  id                  BIGSERIAL PRIMARY KEY,
  wa_id               TEXT UNIQUE,
  wa_name             TEXT,
  country             TEXT,
  total_chats         INTEGER DEFAULT 0,
  first_chat_at       TIMESTAMPTZ,
  last_chat_at        TIMESTAMPTZ,
  first_msg_text      TEXT,
  last_msg_text       TEXT,
  departments         TEXT,
  unsubscribed_status TEXT DEFAULT 'No',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 4. customer_segments table — segment tracking
CREATE TABLE IF NOT EXISTS customer_segments (
  id              BIGSERIAL PRIMARY KEY,
  unified_id      BIGINT,
  segment_label   TEXT,
  identifier_type TEXT DEFAULT 'email',
  can_email       BOOLEAN DEFAULT true,
  can_whatsapp    BOOLEAN DEFAULT false,
  can_sms         BOOLEAN DEFAULT false,
  frequency       NUMERIC DEFAULT 0,
  recency_days    INTEGER DEFAULT 0,
  total_bookings  INTEGER DEFAULT 0,
  gender          TEXT,
  nationality     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Ensure mysql_contacts has country and created_at columns (needed by contacts_raw view)
DO $$
BEGIN
  ALTER TABLE mysql_contacts ADD COLUMN IF NOT EXISTS country TEXT;
  ALTER TABLE mysql_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- 6. contacts_raw view — normalized view over mysql_contacts for UnifiedContactSync
CREATE OR REPLACE VIEW contacts_raw AS
SELECT
  id,
  contact_type,
  name,
  company_name,
  email,
  mobile,
  city,
  country,
  created_at,
  updated_at
FROM mysql_contacts;

-- 7. mv_segmentation_tree materialized view — pre-aggregated segment counts for dashboard
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_segmentation_tree') THEN
    EXECUTE '
      CREATE MATERIALIZED VIEW mv_segmentation_tree AS
      SELECT
        booking_status,
        product_tier,
        geography,
        business_type,
        COUNT(*)::int as count,
        COALESCE(SUM(total_booking_revenue), 0) as revenue,
        COALESCE(AVG(total_booking_revenue), 0) as avg_revenue,
        COUNT(*) FILTER (WHERE total_chats > 0)::int as with_chats,
        COUNT(*) FILTER (WHERE is_indian = true)::int as indian_count,
        COALESCE(SUM(total_tour_bookings), 0)::int as total_tours,
        COALESCE(SUM(total_hotel_bookings), 0)::int as total_hotels,
        COALESCE(SUM(total_visa_bookings), 0)::int as total_visas,
        COALESCE(SUM(total_flight_bookings), 0)::int as total_flights
      FROM unified_contacts
      GROUP BY booking_status, product_tier, geography, business_type
    ';
  END IF;
END $$;
