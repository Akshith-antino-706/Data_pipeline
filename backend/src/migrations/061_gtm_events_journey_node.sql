-- 061: Add journey_id, node_id, unified_id, raw_payload columns to gtm_events
--
-- Why: GTMService.recordEvent already tries to INSERT into unified_id and
-- raw_payload, but neither was ever added to the schema in migration 010 —
-- the INSERT would fail (or has been silently patched on the live DB). At the
-- same time, journey_id and node_id are needed so every GTM event (not just
-- add_to_cart) can be traced back to the specific journey + node that fired
-- it. The frontend dataLayer push has to send these on every event for it to
-- be useful end-to-end.
--
-- Idempotent — all ADDs use IF NOT EXISTS.

BEGIN;

ALTER TABLE gtm_events
  ADD COLUMN IF NOT EXISTS unified_id  BIGINT REFERENCES unified_contacts(unified_id),
  ADD COLUMN IF NOT EXISTS raw_payload JSONB,
  ADD COLUMN IF NOT EXISTS journey_id  BIGINT REFERENCES journey_flows(journey_id),
  ADD COLUMN IF NOT EXISTS node_id     TEXT;

CREATE INDEX IF NOT EXISTS idx_gtm_unified  ON gtm_events(unified_id);
CREATE INDEX IF NOT EXISTS idx_gtm_journey  ON gtm_events(journey_id);
CREATE INDEX IF NOT EXISTS idx_gtm_journey_node ON gtm_events(journey_id, node_id);

COMMIT;
