-- 074: Add missing columns to journey_entries for processing
ALTER TABLE journey_entries ADD COLUMN IF NOT EXISTS last_run_id TEXT;
ALTER TABLE journey_entries ADD COLUMN IF NOT EXISTS last_enqueued_at TIMESTAMPTZ;
ALTER TABLE journey_entries ADD COLUMN IF NOT EXISTS next_fire_at TIMESTAMPTZ;
ALTER TABLE journey_entries ADD COLUMN IF NOT EXISTS track TEXT DEFAULT 'all';
ALTER TABLE journey_entries ADD COLUMN IF NOT EXISTS bullmq_job_id TEXT;
