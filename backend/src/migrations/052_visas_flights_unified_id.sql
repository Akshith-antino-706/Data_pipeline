-- Add unified_id column to rayna_visas and rayna_flights for linking to unified_contacts
ALTER TABLE rayna_visas ADD COLUMN IF NOT EXISTS unified_id BIGINT REFERENCES unified_contacts(unified_id);
CREATE INDEX IF NOT EXISTS idx_rayna_visas_unified_id ON rayna_visas(unified_id);

ALTER TABLE rayna_flights ADD COLUMN IF NOT EXISTS unified_id BIGINT REFERENCES unified_contacts(unified_id);
CREATE INDEX IF NOT EXISTS idx_rayna_flights_unified_id ON rayna_flights(unified_id);
