-- 116_journey_skip_log.sql
-- Permanent store for every message skipped by the item-completeness (missing-key) guard,
-- across all three send paths (GTM WhatsApp, GTM email, Continuous WhatsApp). Replaces the
-- ephemeral CSV file (which vanished on each container rebuild). The /skip-log.csv endpoint
-- now renders from this table, newest first. Durable across deploys; shared by both containers.

CREATE TABLE IF NOT EXISTS journey_skip_log (
  id           BIGSERIAL PRIMARY KEY,
  skipped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  journey_id   INTEGER,
  channel      TEXT,          -- 'whatsapp' | 'email'
  event_id     BIGINT,        -- gtm_events.event_id that triggered the send
  event_name   TEXT,          -- e.g. view_item, add_to_cart
  item_id      TEXT,
  item_name    TEXT,
  missing_keys TEXT,          -- comma-joined missing field labels (ITEM_PRICE, DESTINATION_CITY, …)
  page_url     TEXT
);

CREATE INDEX IF NOT EXISTS idx_journey_skip_log_skipped_at ON journey_skip_log (skipped_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_skip_log_journey    ON journey_skip_log (journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_skip_log_item       ON journey_skip_log (item_id);
