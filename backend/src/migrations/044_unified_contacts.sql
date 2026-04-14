-- 044: Unified contacts table + chat_contacts + normalize_phone function
-- These were previously created manually; this migration ensures they exist on fresh deployments.

BEGIN;

-- ── Helper function: normalize_phone ────────────────────────────
CREATE OR REPLACE FUNCTION normalize_phone(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    WHEN LENGTH(REGEXP_REPLACE(raw, '[^0-9]', '', 'g')) < 7 THEN NULL
    WHEN RIGHT(REGEXP_REPLACE(raw, '[^0-9]', '', 'g'), 10) ~ '^0+$' THEN NULL
    ELSE RIGHT(REGEXP_REPLACE(raw, '[^0-9]', '', 'g'), 10)
  END
$$;

-- ── chat_contacts (aggregated per wa_id) ────────────────────────
CREATE TABLE IF NOT EXISTS chat_contacts (
  id                  BIGSERIAL PRIMARY KEY,
  wa_id               TEXT UNIQUE NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_cc_wa_id ON chat_contacts(wa_id);

-- ── unified_contacts (identity-resolved master contact) ─────────
CREATE TABLE IF NOT EXISTS unified_contacts (
  unified_id              BIGSERIAL PRIMARY KEY,

  -- Identity keys
  phone_key               TEXT,          -- last 10 digits, normalized
  email_key               TEXT,          -- lower-trimmed email

  -- Profile
  name                    TEXT,
  email                   TEXT,
  phone                   TEXT,
  company_name            TEXT,
  city                    TEXT,
  country                 TEXT,
  nationality             TEXT,
  contact_type            TEXT,          -- B2B / B2C

  -- Chat metrics
  total_chats             INTEGER DEFAULT 0,
  first_chat_at           TIMESTAMPTZ,
  last_chat_at            TIMESTAMPTZ,
  first_msg_text          TEXT,
  last_msg_text           TEXT,
  chat_departments        TEXT,

  -- Travel booking metrics (legacy)
  total_travel_bookings   INTEGER DEFAULT 0,
  travel_types            TEXT,
  first_travel_at         DATE,
  last_travel_at          DATE,

  -- Rayna booking metrics
  total_tour_bookings     INTEGER DEFAULT 0,
  total_hotel_bookings    INTEGER DEFAULT 0,
  total_visa_bookings     INTEGER DEFAULT 0,
  total_flight_bookings   INTEGER DEFAULT 0,
  total_booking_revenue   NUMERIC(14,2) DEFAULT 0,
  first_booking_at        DATE,
  last_booking_at         DATE,

  -- GA4 / GTM
  total_ga4_events        INTEGER DEFAULT 0,
  ga4_sessions            INTEGER DEFAULT 0,
  ga4_first_seen          TIMESTAMPTZ,
  ga4_last_seen           TIMESTAMPTZ,

  -- Opt-out flags
  wa_unsubscribed         TEXT DEFAULT 'No',
  email_unsubscribed      TEXT DEFAULT 'No',

  -- 3-step segmentation
  booking_status          TEXT,          -- ON_TRIP / FUTURE_TRAVEL / ACTIVE_ENQUIRY / PAST_BOOKING / PAST_ENQUIRY / PROSPECT
  product_tier            TEXT,          -- LUXURY / STANDARD
  geography               TEXT,          -- LOCAL / INTERNATIONAL
  is_indian               BOOLEAN DEFAULT false,
  segment_label           TEXT,          -- combined label

  -- Occasion targeting
  current_occasion        TEXT,
  occasion_date           DATE,
  occasion_offer_tag      TEXT,

  -- Provenance
  sources                 TEXT,
  first_seen_at           TIMESTAMPTZ,
  last_seen_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for lookup + sync
CREATE INDEX IF NOT EXISTS idx_uc_phone_key     ON unified_contacts(phone_key)      WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uc_email_key     ON unified_contacts(email_key)      WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uc_booking_status ON unified_contacts(booking_status);
CREATE INDEX IF NOT EXISTS idx_uc_segment_label ON unified_contacts(segment_label);
CREATE INDEX IF NOT EXISTS idx_uc_country       ON unified_contacts(country);
CREATE INDEX IF NOT EXISTS idx_uc_last_seen     ON unified_contacts(last_seen_at DESC NULLS LAST);

-- ── user_occasions (occasion-based targeting) ───────────────────
CREATE TABLE IF NOT EXISTS user_occasions (
  id              BIGSERIAL PRIMARY KEY,
  unified_id      BIGINT NOT NULL,
  holiday_id      BIGINT NOT NULL,
  status          TEXT DEFAULT 'active',
  entered_at      TIMESTAMPTZ DEFAULT NOW(),
  exited_at       TIMESTAMPTZ,
  UNIQUE(unified_id, holiday_id)
);

CREATE INDEX IF NOT EXISTS idx_uo_unified ON user_occasions(unified_id);
CREATE INDEX IF NOT EXISTS idx_uo_status  ON user_occasions(status);

COMMIT;
