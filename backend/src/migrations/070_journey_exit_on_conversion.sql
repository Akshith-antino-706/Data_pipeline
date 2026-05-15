-- Add exit_on_conversion flag to journey_flows (default true for backward compat)
-- When false, the journey runs all nodes without checking booking/segment changes (awareness campaigns)
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS exit_on_conversion BOOLEAN NOT NULL DEFAULT TRUE;

-- Scheduled start time — when the journey should first trigger (NULL = immediately on Start click)
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

-- Custom segment support — when journey uses a custom segment instead of a standard one
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS custom_segment_id INTEGER;
