-- Add unified_id column to rayna_hotels for linking to unified_contacts
ALTER TABLE rayna_hotels ADD COLUMN IF NOT EXISTS unified_id BIGINT REFERENCES unified_contacts(unified_id);
CREATE INDEX IF NOT EXISTS idx_rayna_hotels_unified_id ON rayna_hotels(unified_id);
