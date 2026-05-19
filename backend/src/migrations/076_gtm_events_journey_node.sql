-- ═══════════════════════════════════════════════════════════════════
-- Migration 076: Add journey_id and node_id to gtm_events
-- Links GTM events back to the journey + node that drove the click
-- ═══════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE gtm_events
  ADD COLUMN IF NOT EXISTS journey_id   BIGINT,
  ADD COLUMN IF NOT EXISTS node_id      TEXT;

CREATE INDEX IF NOT EXISTS idx_gtm_events_journey ON gtm_events(journey_id) WHERE journey_id IS NOT NULL;

COMMIT;
