-- ═══════════════════════════════════════════════════════════════════
-- Migration 032: Per-User UTM Links for Individual Journey Tracking
-- Each user gets a unique trackable link per campaign.
-- Click → record who clicked → redirect to Rayna website with rid param → GTM picks up identity
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS user_utm_links (
  link_id       BIGSERIAL PRIMARY KEY,
  utm_id        BIGINT REFERENCES utm_tracking(utm_id) ON DELETE CASCADE,
  campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  unified_id    BIGINT,                          -- references unified_contacts
  customer_email TEXT,
  customer_name  TEXT,
  token         TEXT NOT NULL UNIQUE,             -- short unique token for tracking URL
  destination_url TEXT NOT NULL,                  -- full URL with UTM + rid params
  click_count   INTEGER DEFAULT 0,
  first_clicked_at TIMESTAMPTZ,
  last_clicked_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup by token (the click redirect endpoint)
CREATE INDEX IF NOT EXISTS idx_user_utm_token ON user_utm_links(token);

-- Find all links for a campaign
CREATE INDEX IF NOT EXISTS idx_user_utm_campaign ON user_utm_links(campaign_id);

-- Find all links for a user
CREATE INDEX IF NOT EXISTS idx_user_utm_unified ON user_utm_links(unified_id);

-- Analytics: who clicked
CREATE INDEX IF NOT EXISTS idx_user_utm_clicked ON user_utm_links(campaign_id) WHERE click_count > 0;

COMMIT;
