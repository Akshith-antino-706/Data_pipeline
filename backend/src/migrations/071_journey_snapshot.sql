-- 071: Journey snapshot support
-- Adds snapshot_count to journey_flows so we remember how many users were
-- locked in at creation time. No CHECK constraint needed — status is TEXT.

ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS snapshot_count INTEGER DEFAULT 0;
