-- 065: Add unified_id and raw_payload columns to gtm_events
-- These columns are referenced by GTMService.recordEvent() but were missing from the original DDL.

ALTER TABLE gtm_events ADD COLUMN IF NOT EXISTS unified_id BIGINT;
ALTER TABLE gtm_events ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_gtm_events_unified ON gtm_events(unified_id);
