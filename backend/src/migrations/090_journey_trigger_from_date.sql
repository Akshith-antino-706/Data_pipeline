-- Continuous/GTM journeys: only enroll for GTM events fired on/after this date.
-- Prevents the start fan-out from backfilling ALL historical events (spam).
-- NULL → defaults (in code) to the journey's created_at, so no historical backfill by default.
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS trigger_from_date timestamptz;
