-- ═══════════════════════════════════════════════════════════════════
-- Migration 075: Add journey_id and node_id to UTM tables
-- Allows tracing UTM links back to the specific journey + node that triggered the send
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

-- Add to campaign-level UTM tracking
ALTER TABLE utm_tracking
  ADD COLUMN IF NOT EXISTS journey_id   BIGINT,
  ADD COLUMN IF NOT EXISTS node_id    TEXT;

-- Add to per-user UTM links
ALTER TABLE user_utm_links
  ADD COLUMN IF NOT EXISTS journey_id   BIGINT,
  ADD COLUMN IF NOT EXISTS node_id    TEXT;

-- Index for filtering UTM links by journey
CREATE INDEX IF NOT EXISTS idx_utm_tracking_journey ON utm_tracking(journey_id) WHERE journey_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_utm_journey ON user_utm_links(journey_id) WHERE journey_id IS NOT NULL;

COMMIT;
