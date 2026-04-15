-- =============================================================
-- Rayna Tours: Omnichannel Marketing Platform Schema
-- FANG-grade: event-sourced, audit-trailed, partition-ready
-- =============================================================

BEGIN;

-- ── ENUM TYPES ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE channel_type AS ENUM ('whatsapp', 'email', 'sms', 'push');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'clicked', 'bounced', 'failed', 'unsubscribed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE strategy_status AS ENUM ('active', 'paused', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE template_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 1. OMNICHANNEL STRATEGIES ───────────────────────────────
-- One strategy per segment, defines the multi-channel flow
CREATE TABLE IF NOT EXISTS omnichannel_strategies (
    id              BIGSERIAL       PRIMARY KEY,
    name            TEXT            NOT NULL,
    description     TEXT,
    segment_label   TEXT            NOT NULL,           -- FK to customer_segments.segment_label
    channels        channel_type[]  NOT NULL DEFAULT '{}',
    status          strategy_status NOT NULL DEFAULT 'active',

    -- Flow definition: JSON array of steps
    -- e.g. [{"day":0,"channel":"whatsapp","template_id":1}, {"day":3,"channel":"email","template_id":2}]
    flow_steps      JSONB           NOT NULL DEFAULT '[]',

    -- AI optimization metadata
    ai_score        NUMERIC(5,2),                       -- AI confidence score 0-100
    ai_last_review  TIMESTAMPTZ,
    ai_suggestions  JSONB           DEFAULT '[]',       -- AI-generated improvement suggestions

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_by      TEXT,

    CONSTRAINT uq_strategy_segment UNIQUE (segment_label, name)
);

CREATE INDEX IF NOT EXISTS idx_strategy_segment ON omnichannel_strategies (segment_label);
CREATE INDEX IF NOT EXISTS idx_strategy_status ON omnichannel_strategies (status);

-- ── 2. CONTENT TEMPLATES ────────────────────────────────────
-- Templates per channel, versioned, approval-tracked
CREATE TABLE IF NOT EXISTS content_templates (
    id              BIGSERIAL           PRIMARY KEY,
    name            TEXT                NOT NULL,
    channel         channel_type        NOT NULL,
    status          template_status     NOT NULL DEFAULT 'draft',

    -- Content fields
    subject         TEXT,                               -- Email subject / Push title
    body            TEXT                NOT NULL,        -- Main content (HTML for email, text for others)
    body_plain      TEXT,                               -- Plain text fallback
    media_url       TEXT,                               -- Image/video URL for WhatsApp/Push
    cta_url         TEXT,                               -- Call-to-action URL
    cta_text        TEXT,                               -- CTA button text

    -- WhatsApp-specific
    wa_template_name TEXT,                              -- Approved WhatsApp template name
    wa_namespace     TEXT,                              -- WhatsApp namespace

    -- Personalization variables: ["first_name", "booking_date", ...]
    variables       TEXT[]              DEFAULT '{}',

    -- AI metadata
    ai_generated    BOOLEAN             DEFAULT FALSE,
    ai_prompt       TEXT,                               -- Prompt used to generate
    ai_model        TEXT,                               -- Model used

    -- Segment targeting
    segment_label   TEXT,

    -- Versioning
    version         INTEGER             NOT NULL DEFAULT 1,
    parent_id       BIGINT              REFERENCES content_templates(id),

    -- Audit
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    created_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_template_channel ON content_templates (channel);
CREATE INDEX IF NOT EXISTS idx_template_status ON content_templates (status);
CREATE INDEX IF NOT EXISTS idx_template_ai ON content_templates (ai_generated) WHERE ai_generated = TRUE;

-- ── 3. CAMPAIGNS ────────────────────────────────────────────
-- A campaign executes a strategy for a segment
CREATE TABLE IF NOT EXISTS campaigns (
    id              BIGSERIAL           PRIMARY KEY,
    name            TEXT                NOT NULL,
    strategy_id     BIGINT              REFERENCES omnichannel_strategies(id),
    segment_label   TEXT                NOT NULL,
    channel         channel_type        NOT NULL,
    template_id     BIGINT              REFERENCES content_templates(id),
    status          campaign_status     NOT NULL DEFAULT 'draft',

    -- Journey link
    journey_id      BIGINT,
    journey_node_id TEXT,

    -- Targeting
    target_count    INTEGER             DEFAULT 0,      -- How many recipients
    filter_criteria JSONB               DEFAULT '{}',   -- Additional filters beyond segment

    -- Scheduling
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,

    -- Aggregate metrics (denormalized for fast reads)
    sent_count      INTEGER             DEFAULT 0,
    delivered_count INTEGER             DEFAULT 0,
    read_count      INTEGER             DEFAULT 0,
    clicked_count   INTEGER             DEFAULT 0,
    bounced_count   INTEGER             DEFAULT 0,
    failed_count    INTEGER             DEFAULT 0,

    -- Metadata
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    created_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns (status);
CREATE INDEX IF NOT EXISTS idx_campaign_segment ON campaigns (segment_label);
CREATE INDEX IF NOT EXISTS idx_campaign_channel ON campaigns (channel);
CREATE INDEX IF NOT EXISTS idx_campaign_strategy ON campaigns (strategy_id);
CREATE INDEX IF NOT EXISTS idx_campaign_scheduled ON campaigns (scheduled_at) WHERE status = 'scheduled';

-- ── 4. MESSAGE LOG ──────────────────────────────────────────
-- Every individual message sent, event-sourced
CREATE TABLE IF NOT EXISTS message_log (
    id              BIGSERIAL           PRIMARY KEY,
    campaign_id     BIGINT              REFERENCES campaigns(id),
    customer_email  TEXT                NOT NULL,        -- FK to customer_segments.email
    channel         channel_type        NOT NULL,
    template_id     BIGINT              REFERENCES content_templates(id),

    -- Delivery tracking
    status          message_status      NOT NULL DEFAULT 'queued',
    external_id     TEXT,                               -- Provider message ID (WhatsApp/SendGrid/Twilio)

    -- Personalized content snapshot
    rendered_body   TEXT,
    rendered_subject TEXT,

    -- Timestamps per status
    queued_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    clicked_at      TIMESTAMPTZ,
    bounced_at      TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    failure_reason  TEXT,

    -- Provider response
    provider_response JSONB
);

-- Partition-ready indexes
CREATE INDEX IF NOT EXISTS idx_msglog_campaign ON message_log (campaign_id);
CREATE INDEX IF NOT EXISTS idx_msglog_customer ON message_log (customer_email);
CREATE INDEX IF NOT EXISTS idx_msglog_status ON message_log (status);
CREATE INDEX IF NOT EXISTS idx_msglog_channel ON message_log (channel);
CREATE INDEX IF NOT EXISTS idx_msglog_queued ON message_log (queued_at DESC);

-- ── 5. CAMPAIGN ANALYTICS (Materialized) ────────────────────
-- Hourly rollups for dashboard performance
CREATE TABLE IF NOT EXISTS campaign_analytics (
    id              BIGSERIAL           PRIMARY KEY,
    campaign_id     BIGINT              NOT NULL REFERENCES campaigns(id),
    hour_bucket     TIMESTAMPTZ         NOT NULL,       -- Truncated to hour
    channel         channel_type        NOT NULL,

    sent            INTEGER             DEFAULT 0,
    delivered       INTEGER             DEFAULT 0,
    read            INTEGER             DEFAULT 0,
    clicked         INTEGER             DEFAULT 0,
    bounced         INTEGER             DEFAULT 0,
    failed          INTEGER             DEFAULT 0,

    -- Rates (precomputed)
    delivery_rate   NUMERIC(5,2),
    open_rate       NUMERIC(5,2),
    click_rate      NUMERIC(5,2),
    bounce_rate     NUMERIC(5,2),

    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_analytics_bucket UNIQUE (campaign_id, hour_bucket, channel)
);

CREATE INDEX IF NOT EXISTS idx_analytics_campaign ON campaign_analytics (campaign_id);
CREATE INDEX IF NOT EXISTS idx_analytics_hour ON campaign_analytics (hour_bucket DESC);

-- ── 6. DATA ENRICHMENT LOG ──────────────────────────────────
-- Track all enrichment operations for audit
CREATE TABLE IF NOT EXISTS enrichment_log (
    id              BIGSERIAL           PRIMARY KEY,
    customer_email  TEXT                NOT NULL,
    field_name      TEXT                NOT NULL,       -- 'gender', 'nationality', 'phone_clean', etc.
    old_value       TEXT,
    new_value       TEXT,
    source          TEXT                NOT NULL,       -- 'country_code', 'name_inference', 'api:apollo', etc.
    confidence      NUMERIC(3,2),                      -- 0.00-1.00
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_customer ON enrichment_log (customer_email);
CREATE INDEX IF NOT EXISTS idx_enrichment_field ON enrichment_log (field_name);

-- ── 7. AI OPTIMIZATION LOG ──────────────────────────────────
-- Track AI suggestions and actions
CREATE TABLE IF NOT EXISTS ai_optimization_log (
    id              BIGSERIAL           PRIMARY KEY,
    strategy_id     BIGINT              REFERENCES omnichannel_strategies(id),
    campaign_id     BIGINT              REFERENCES campaigns(id),
    suggestion_type TEXT                NOT NULL,       -- 'content_change', 'flow_change', 'timing_change', 'channel_change'
    suggestion      JSONB               NOT NULL,
    reasoning       TEXT,
    confidence      NUMERIC(5,2),
    applied         BOOLEAN             DEFAULT FALSE,
    applied_at      TIMESTAMPTZ,
    applied_by      TEXT,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_log_strategy ON ai_optimization_log (strategy_id);

-- ── 8. USER UTM LINKS (per-user tracked links) ──────────────────
CREATE TABLE IF NOT EXISTS user_utm_links (
  id              BIGSERIAL PRIMARY KEY,
  utm_id          BIGINT,
  customer_email  TEXT,
  unique_code     TEXT UNIQUE,
  full_url        TEXT NOT NULL,
  clicked         BOOLEAN DEFAULT false,
  clicked_at      TIMESTAMPTZ,
  converted       BOOLEAN DEFAULT false,
  converted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uutm_code ON user_utm_links(unique_code);

-- ── 9. ADD ENRICHMENT COLUMNS TO CUSTOMER_SEGMENTS (if table exists) ─
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_segments') THEN
    ALTER TABLE customer_segments ADD COLUMN IF NOT EXISTS gender TEXT;
    ALTER TABLE customer_segments ADD COLUMN IF NOT EXISTS phone_clean TEXT;
    ALTER TABLE customer_segments ADD COLUMN IF NOT EXISTS phone_country_code TEXT;
    ALTER TABLE customer_segments ADD COLUMN IF NOT EXISTS enrichment_score NUMERIC(3,2) DEFAULT 0;
  END IF;
END $$;

-- ── TRIGGER: auto-update updated_at ─────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_strategies_updated BEFORE UPDATE ON omnichannel_strategies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON content_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
