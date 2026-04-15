-- =============================================================
-- Migration 003: Complete Customer Data Schema (84 Fields)
-- Rayna Tours Omnichannel Marketing Platform
-- 28 Segments · 7 Funnel Stages · 6 Channels
-- =============================================================

BEGIN;

-- ── Channel type extension (add RCS and Web) ──────────────────
DO $$ BEGIN
  -- Drop and recreate to add new values
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_type') THEN
    ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'rcs';
    ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'web';
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- TABLE 1: customers (Master Customer Profile - 32 fields)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
    -- Identity & Basic Info (12 fields)
    customer_id         BIGSERIAL       PRIMARY KEY,
    email               TEXT            UNIQUE,
    phone_number        TEXT,
    whatsapp_number     TEXT,
    first_name          TEXT,
    last_name           TEXT,
    date_of_birth       DATE,
    gender              TEXT,           -- Male/Female/Other
    nationality         TEXT,
    residence_country   TEXT,
    residence_city      TEXT,
    preferred_language  TEXT            DEFAULT 'en',

    -- Account & Registration (3 fields)
    registration_date   TIMESTAMPTZ,
    registration_source TEXT,           -- Website/App/Partner/Agent/Meta Ads
    account_status      TEXT            DEFAULT 'active',  -- Active/Inactive/Suspended

    -- Loyalty & Rewards (2 fields)
    r_points_balance    INTEGER         DEFAULT 0,
    wallet_balance      NUMERIC(12,2)   DEFAULT 0,

    -- Booking History (1 field)
    first_booking_date  DATE,

    -- Communication Preferences (7 fields)
    email_opt_in              BOOLEAN   DEFAULT true,
    sms_opt_in                BOOLEAN   DEFAULT true,
    whatsapp_opt_in           BOOLEAN   DEFAULT true,
    push_notification_opt_in  BOOLEAN   DEFAULT true,
    last_email_opened         TIMESTAMPTZ,
    last_email_clicked        TIMESTAMPTZ,
    email_frequency_preference TEXT     DEFAULT 'weekly', -- Daily/Weekly/Monthly

    -- Lead & General Data (2 fields)
    lead_source         TEXT,           -- Meta Ads/Google/Organic/Referral/Partner
    lead_status         TEXT            DEFAULT 'new', -- New/Contacted/Qualified/Converted

    -- Reviews & Feedback (2 fields)
    last_review_date    TIMESTAMPTZ,
    nps_score           INTEGER,        -- 0-10

    -- Enrichment fields
    phone_clean         TEXT,
    phone_country_code  TEXT,
    enrichment_score    NUMERIC(3,2)    DEFAULT 0,

    -- Metadata
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── Computed / Aggregated fields (materialized via triggers or batch jobs) ──
-- These are stored for fast segment queries:
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_bookings        INTEGER   DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_revenue         NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS days_since_last_booking INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_booking_date     DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_cancelled_bookings INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cancellation_rate     NUMERIC(5,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS product_categories    TEXT[];     -- Array of categories booked
ALTER TABLE customers ADD COLUMN IF NOT EXISTS visa_services_used    INTEGER   DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS website_sessions_total INTEGER  DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_abandoned_cart_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_enquiry_date     TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_enquiry_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_response_rate NUMERIC(5,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_engagement_score NUMERIC(5,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS wallet_usage_rate     NUMERIC(5,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS wallet_spent_total    NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS social_media_mentions INTEGER   DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS average_rating_given  NUMERIC(3,1) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reviews_submitted     INTEGER   DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS average_travelers_count INTEGER DEFAULT 1;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type         TEXT      DEFAULT 'B2C'; -- B2C/B2B/Corporate/Educational
ALTER TABLE customers ADD COLUMN IF NOT EXISTS product_views_count   INTEGER   DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS enquiry_count         INTEGER   DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS travel_date           DATE;      -- Next upcoming travel date

-- Indexes for segment queries
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp ON customers (whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers (customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_lead_source ON customers (lead_source);
CREATE INDEX IF NOT EXISTS idx_customers_lead_status ON customers (lead_status);
CREATE INDEX IF NOT EXISTS idx_customers_nationality ON customers (nationality);
CREATE INDEX IF NOT EXISTS idx_customers_residence ON customers (residence_country);
CREATE INDEX IF NOT EXISTS idx_customers_first_booking ON customers (first_booking_date);
CREATE INDEX IF NOT EXISTS idx_customers_last_booking ON customers (last_booking_date);
CREATE INDEX IF NOT EXISTS idx_customers_total_bookings ON customers (total_bookings);
CREATE INDEX IF NOT EXISTS idx_customers_total_revenue ON customers (total_revenue);
CREATE INDEX IF NOT EXISTS idx_customers_days_since_booking ON customers (days_since_last_booking);
CREATE INDEX IF NOT EXISTS idx_customers_registration ON customers (registration_date);
CREATE INDEX IF NOT EXISTS idx_customers_dob ON customers (date_of_birth);

-- ══════════════════════════════════════════════════════════════
-- TABLE 2: bookings (Per-Booking Record - 37+ fields)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookings (
    booking_id          BIGSERIAL       PRIMARY KEY,
    customer_id         BIGINT          NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,

    -- Booking Info
    booking_date        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    booking_status      TEXT            NOT NULL DEFAULT 'confirmed', -- Confirmed/Cancelled/Completed/Payment Failed
    travel_date         DATE,
    booking_source      TEXT,           -- Website/App/Agent/Phone/WhatsApp
    product_category    TEXT,           -- Tours/Activities/Visas/Transfers/Holidays/Packages
    product_name        TEXT,
    product_id          TEXT,
    service_type        TEXT,           -- Private/Shared/Group
    destination_country TEXT,
    destination_city    TEXT,

    -- Pax
    number_of_adults    INTEGER         DEFAULT 1,
    number_of_children  INTEGER         DEFAULT 0,
    number_of_infants   INTEGER         DEFAULT 0,
    total_travelers     INTEGER         DEFAULT 1,

    -- Pricing
    base_price          NUMERIC(12,2),
    adult_price         NUMERIC(12,2),
    child_price         NUMERIC(12,2),
    infant_price        NUMERIC(12,2),
    discount_amount     NUMERIC(12,2)   DEFAULT 0,
    discount_code       TEXT,
    taxes_fees          NUMERIC(12,2)   DEFAULT 0,
    total_booking_value NUMERIC(12,2)   NOT NULL,
    currency            TEXT            DEFAULT 'AED',

    -- Payment
    payment_method      TEXT,           -- Card/Wallet/Bank/Cash/Installments
    r_points_used       INTEGER         DEFAULT 0,
    r_points_earned     INTEGER         DEFAULT 0,
    wallet_amount_used  NUMERIC(12,2)   DEFAULT 0,

    -- Details
    booking_notes       TEXT,
    pickup_location     TEXT,
    dropoff_location    TEXT,
    hotel_name          TEXT,
    flight_number       TEXT,
    special_requirements TEXT,

    -- Cancellation
    cancellation_date   TIMESTAMPTZ,
    cancellation_reason TEXT,
    refund_amount       NUMERIC(12,2),

    -- Lead Passenger (9 fields)
    lead_passenger_first_name    TEXT,
    lead_passenger_last_name     TEXT,
    lead_passenger_email         TEXT,
    lead_passenger_phone         TEXT,
    lead_passenger_nationality   TEXT,
    lead_passenger_date_of_birth DATE,
    lead_passenger_gender        TEXT,
    lead_passenger_passport_number TEXT,
    lead_passenger_passport_expiry DATE,

    -- Metadata
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings (customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_travel_date ON bookings (travel_date);
CREATE INDEX IF NOT EXISTS idx_bookings_product ON bookings (product_category);
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings (booking_source);
CREATE INDEX IF NOT EXISTS idx_bookings_destination ON bookings (destination_country);

-- ══════════════════════════════════════════════════════════════
-- TABLE 3: whatsapp_enquiries (Per WhatsApp Enquiry - 8 fields)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS whatsapp_enquiries (
    whatsapp_enquiry_id   BIGSERIAL     PRIMARY KEY,
    customer_id           BIGINT        NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    whatsapp_enquiry_date TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    whatsapp_first_message TEXT,
    whatsapp_enquiry_status TEXT        DEFAULT 'new', -- New/In Progress/Converted/Lost
    whatsapp_product_interest TEXT,
    whatsapp_assigned_agent TEXT,
    whatsapp_response_time  INTERVAL,
    whatsapp_conversation_thread JSONB, -- Full conversation history

    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_enquiries_customer ON whatsapp_enquiries (customer_id);
CREATE INDEX IF NOT EXISTS idx_wa_enquiries_status ON whatsapp_enquiries (whatsapp_enquiry_status);
CREATE INDEX IF NOT EXISTS idx_wa_enquiries_date ON whatsapp_enquiries (whatsapp_enquiry_date);
CREATE INDEX IF NOT EXISTS idx_wa_enquiries_product ON whatsapp_enquiries (whatsapp_product_interest);

-- ══════════════════════════════════════════════════════════════
-- TABLE 4: email_enquiries (Per Email Enquiry - 9 fields)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_enquiries (
    email_enquiry_id      BIGSERIAL     PRIMARY KEY,
    customer_id           BIGINT        NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    email_enquiry_date    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    email_enquiry_subject TEXT,
    email_enquiry_body    TEXT,
    email_enquiry_status  TEXT          DEFAULT 'new', -- New/In Progress/Converted/Lost
    email_product_interest TEXT,
    email_assigned_agent  TEXT,
    email_response_time   INTERVAL,
    email_thread_history  JSONB,        -- Full email chain

    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_enquiries_customer ON email_enquiries (customer_id);
CREATE INDEX IF NOT EXISTS idx_email_enquiries_status ON email_enquiries (email_enquiry_status);
CREATE INDEX IF NOT EXISTS idx_email_enquiries_date ON email_enquiries (email_enquiry_date);

-- ══════════════════════════════════════════════════════════════
-- TABLE 5: funnel_stages (7 Stages Definition)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS funnel_stages (
    stage_id            SERIAL        PRIMARY KEY,
    stage_number        INTEGER       NOT NULL UNIQUE,
    stage_name          TEXT          NOT NULL,
    stage_description   TEXT,
    stage_color         TEXT,         -- Hex color for UI
    segment_count       INTEGER       DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO funnel_stages (stage_number, stage_name, stage_description, stage_color) VALUES
  (1, 'Cold Leads - B2C',              'No registration, no enquiry, minimal engagement',   '#ff6b6b'),
  (2, 'Warm Leads - B2C',              'Registered or enquired but never booked',            '#ffa726'),
  (3, 'Existing Customers - Reactivation', 'Booked before but inactive now',                 '#4caf50'),
  (4, 'Active B2C - Upsell/Cross-Sell', 'Recently booked customers, maximize value',         '#5c7cfa'),
  (5, 'B2B & Corporate',               'Business accounts, travel agencies, corporate',       '#b794f6'),
  (6, 'Advocacy & Referral',           'Happy customers, turn them into advocates',            '#26de81'),
  (7, 'Special Behavioral',            'Unique patterns requiring specific strategies',        '#fc5c65')
ON CONFLICT (stage_number) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- TABLE 6: segment_definitions (28 Segments with SQL Criteria)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS segment_definitions (
    segment_id          SERIAL        PRIMARY KEY,
    segment_number      INTEGER       NOT NULL UNIQUE,
    stage_id            INTEGER       NOT NULL REFERENCES funnel_stages(stage_id),
    segment_name        TEXT          NOT NULL,
    segment_description TEXT,
    customer_type       TEXT          NOT NULL, -- B2C/B2B/Corporate/Educational
    priority            TEXT          NOT NULL, -- Critical/High/Medium
    sql_criteria        TEXT          NOT NULL, -- WHERE clause for customer matching
    key_points          JSONB,        -- Array of strategy notes
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- TABLE 7: segment_customers (Many-to-Many: Customer ↔ Segment)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS segment_customers (
    id                  BIGSERIAL     PRIMARY KEY,
    customer_id         BIGINT        NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    segment_id          INTEGER       NOT NULL REFERENCES segment_definitions(segment_id) ON DELETE CASCADE,
    assigned_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    assigned_by         TEXT          DEFAULT 'system', -- system/ai/manual
    confidence          NUMERIC(3,2)  DEFAULT 1.0,
    is_active           BOOLEAN       DEFAULT true,

    UNIQUE(customer_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_seg_customers_customer ON segment_customers (customer_id);
CREATE INDEX IF NOT EXISTS idx_seg_customers_segment ON segment_customers (segment_id);
CREATE INDEX IF NOT EXISTS idx_seg_customers_active ON segment_customers (is_active);

-- ══════════════════════════════════════════════════════════════
-- TABLE 8: journey_flows (Visual Journey Builder)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS journey_flows (
    journey_id          BIGSERIAL     PRIMARY KEY,
    name                TEXT          NOT NULL,
    description         TEXT,
    segment_id          INTEGER       REFERENCES segment_definitions(segment_id),
    strategy_id         INTEGER       REFERENCES omnichannel_strategies(id),
    status              TEXT          DEFAULT 'draft', -- draft/active/paused/completed

    -- Flow definition (node-based)
    nodes               JSONB         NOT NULL DEFAULT '[]',
    edges               JSONB         NOT NULL DEFAULT '[]',

    -- Metrics
    total_entries       INTEGER       DEFAULT 0,
    total_conversions   INTEGER       DEFAULT 0,
    total_exits         INTEGER       DEFAULT 0,
    conversion_rate     NUMERIC(5,2)  DEFAULT 0,

    -- Goal
    goal_type           TEXT,         -- booking/enquiry/registration/click
    goal_value          TEXT,

    created_by          TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journeys_segment ON journey_flows (segment_id);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON journey_flows (status);

-- ══════════════════════════════════════════════════════════════
-- TABLE 9: journey_entries (Track customers through journeys)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS journey_entries (
    entry_id            BIGSERIAL     PRIMARY KEY,
    journey_id          BIGINT        NOT NULL REFERENCES journey_flows(journey_id) ON DELETE CASCADE,
    customer_id         BIGINT        NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    current_node_id     TEXT,         -- ID of current node in flow
    status              TEXT          DEFAULT 'active', -- active/completed/exited/converted
    entered_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    converted_at        TIMESTAMPTZ,
    exit_reason         TEXT,

    UNIQUE(journey_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_journey_entries_journey ON journey_entries (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_entries_customer ON journey_entries (customer_id);
CREATE INDEX IF NOT EXISTS idx_journey_entries_status ON journey_entries (status);

-- ══════════════════════════════════════════════════════════════
-- TABLE 10: journey_events (Event log per customer per journey)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS journey_events (
    event_id            BIGSERIAL     PRIMARY KEY,
    entry_id            BIGINT        NOT NULL REFERENCES journey_entries(entry_id) ON DELETE CASCADE,
    node_id             TEXT          NOT NULL,
    event_type          TEXT          NOT NULL, -- trigger_fired/action_sent/condition_evaluated/wait_started/wait_completed/goal_reached
    channel             TEXT,
    details             JSONB,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_entry ON journey_events (entry_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_type ON journey_events (event_type);

-- ══════════════════════════════════════════════════════════════
-- TABLE 11: conversion_tracking
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversion_tracking (
    conversion_id       BIGSERIAL     PRIMARY KEY,
    customer_id         BIGINT        NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    segment_id          INTEGER       REFERENCES segment_definitions(segment_id),
    campaign_id         BIGINT,
    journey_id          BIGINT,

    conversion_type     TEXT          NOT NULL, -- booking/enquiry/registration/click/purchase
    conversion_value    NUMERIC(12,2),
    source_channel      TEXT,         -- whatsapp/email/sms/push/rcs/web
    utm_source          TEXT,
    utm_medium          TEXT,
    utm_campaign        TEXT,

    converted_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversions_customer ON conversion_tracking (customer_id);
CREATE INDEX IF NOT EXISTS idx_conversions_segment ON conversion_tracking (segment_id);
CREATE INDEX IF NOT EXISTS idx_conversions_campaign ON conversion_tracking (campaign_id);
CREATE INDEX IF NOT EXISTS idx_conversions_type ON conversion_tracking (conversion_type);
CREATE INDEX IF NOT EXISTS idx_conversions_date ON conversion_tracking (converted_at);

-- ══════════════════════════════════════════════════════════════
-- TABLE 12: ai_agent_logs (Multi-agent decision tracking)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_agent_logs (
    log_id              BIGSERIAL     PRIMARY KEY,
    agent_type          TEXT          NOT NULL, -- copywriter/segment_assist/flow_assist/analytics_insights
    action_type         TEXT          NOT NULL, -- generate/suggest/auto_apply/analyze
    target_type         TEXT,         -- segment/strategy/content/campaign/journey
    target_id           TEXT,
    input_context       JSONB,
    output_result       JSONB,
    confidence          NUMERIC(3,2),
    auto_applied        BOOLEAN       DEFAULT false,
    applied_at          TIMESTAMPTZ,
    model_used          TEXT,
    tokens_used         INTEGER,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_agent ON ai_agent_logs (agent_type);
CREATE INDEX IF NOT EXISTS idx_ai_logs_action ON ai_agent_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_ai_logs_target ON ai_agent_logs (target_type, target_id);

-- ══════════════════════════════════════════════════════════════
-- TRIGGERS: Auto-update updated_at
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_segment_defs_updated BEFORE UPDATE ON segment_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_journeys_updated BEFORE UPDATE ON journey_flows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- DATA MIGRATION: Seed from existing customer_segments table (if exists)
-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_segments' AND table_schema = 'public') THEN
    INSERT INTO customers (
        email, first_name, last_name, phone_number, whatsapp_number,
        gender, nationality, residence_country, customer_type,
        total_bookings, phone_clean, phone_country_code, enrichment_score,
        registration_date, lead_status, created_at
    )
    SELECT
        cs.email,
        SPLIT_PART(cs.full_name, ' ', 1),
        CASE WHEN POSITION(' ' IN COALESCE(cs.full_name, '')) > 0
             THEN SUBSTRING(cs.full_name FROM POSITION(' ' IN cs.full_name) + 1) END,
        cs.phone, cs.whatsapp_id, cs.gender, cs.nationality, cs.country,
        COALESCE(cs.customer_type, cs.identifier_type, 'B2C'),
        COALESCE(cs.total_bookings, 0), cs.phone_clean, cs.phone_country_code,
        COALESCE(cs.enrichment_score, 0),
        NOW() - (COALESCE(cs.recency_days, 0) || ' days')::INTERVAL,
        CASE WHEN cs.total_bookings > 0 THEN 'converted' ELSE 'new' END, NOW()
    FROM customer_segments cs WHERE cs.email IS NOT NULL
    ON CONFLICT (email) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'travel_data' AND table_schema = 'public') THEN
    UPDATE customers c SET
        total_revenue = sub.total_rev, first_booking_date = sub.first_book,
        last_booking_date = sub.last_book,
        days_since_last_booking = EXTRACT(DAY FROM NOW() - sub.last_book)::INTEGER
    FROM (SELECT td.email, 0 AS total_rev, MIN(td.added_date) AS first_book, MAX(td.added_date) AS last_book
          FROM travel_data td WHERE td.email IS NOT NULL GROUP BY td.email) sub
    WHERE c.email = sub.email;
  END IF;
END $$;

COMMIT;
