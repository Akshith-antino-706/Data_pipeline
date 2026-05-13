-- Migration 066: Sub-journey hierarchy
-- Adds parent_journey_id so each journey card in the list can contain
-- multiple child journeys (campaign instances) beneath it.

ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS parent_journey_id BIGINT
    REFERENCES journey_flows(journey_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_journey_flows_parent_id
  ON journey_flows(parent_journey_id);
