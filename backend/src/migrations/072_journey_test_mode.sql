-- 072: Journey test mode support
-- test_mode: when true, all emails go to test_email instead of real users
-- test_email: override recipient for all action nodes
-- test_interval_min: minutes between nodes (default 10) instead of wait-days

ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS test_mode BOOLEAN DEFAULT false;
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS test_email TEXT;
ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS test_interval_min INTEGER DEFAULT 10;
