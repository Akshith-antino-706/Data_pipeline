-- Migration 068: Add status column to custom_segments
-- Allows segments to be marked as 'active' or 'draft'

ALTER TABLE custom_segments
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Add constraint separately (idempotent with DO block)
DO $$ BEGIN
  ALTER TABLE custom_segments ADD CONSTRAINT chk_custom_segments_status
    CHECK (status IN ('active', 'draft'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_custom_segments_status
  ON custom_segments(status) WHERE is_active = true;
