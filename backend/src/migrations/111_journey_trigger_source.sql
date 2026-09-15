-- Distinguishes what a continuous (journey_type='gtm') journey triggers on:
--   'gtm'      → GTM analytics events (gtm_events.event_name)  — existing behavior
--   'giveaway' → giveaway events (giveaway_events.type)         — new
-- Existing rows default to 'gtm' so nothing changes.
ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(20) NOT NULL DEFAULT 'gtm';
