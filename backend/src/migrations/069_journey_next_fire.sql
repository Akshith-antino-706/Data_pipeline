-- Add next_fire_at to journey_entries for scalable cron-based processing
ALTER TABLE journey_entries ADD COLUMN IF NOT EXISTS next_fire_at TIMESTAMPTZ;

-- Partial index: only active entries with a scheduled fire time
CREATE INDEX IF NOT EXISTS idx_je_next_fire
  ON journey_entries(next_fire_at)
  WHERE status = 'active' AND next_fire_at IS NOT NULL;
