-- 025: Fix Rayna sync table conflict keys
-- Expand visa unique constraint to include visa_type (prevents multi-visa data loss)
-- Set NOT NULL defaults on conflict key columns for flights and visas

-- ── Visas: expand unique constraint ──────────────────────────
ALTER TABLE rayna_visas ALTER COLUMN visa_type SET DEFAULT 'UNKNOWN';
UPDATE rayna_visas SET visa_type = 'UNKNOWN' WHERE visa_type IS NULL;
ALTER TABLE rayna_visas ALTER COLUMN visa_type SET NOT NULL;
ALTER TABLE rayna_visas DROP CONSTRAINT IF EXISTS rayna_visas_billno_guest_name_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rayna_visas_billno_guest_name_visa_type_key') THEN
    ALTER TABLE rayna_visas ADD CONSTRAINT rayna_visas_billno_guest_name_visa_type_key UNIQUE (billno, guest_name, visa_type);
  END IF;
END $$;

-- ── Flights: ensure conflict key columns are never null ──────
ALTER TABLE rayna_flights ALTER COLUMN passenger_name SET DEFAULT 'UNKNOWN';
UPDATE rayna_flights SET passenger_name = 'UNKNOWN' WHERE passenger_name IS NULL;
ALTER TABLE rayna_flights ALTER COLUMN passenger_name SET NOT NULL;

ALTER TABLE rayna_flights ALTER COLUMN flight_no SET DEFAULT 'UNKNOWN';
UPDATE rayna_flights SET flight_no = 'UNKNOWN' WHERE flight_no IS NULL;
ALTER TABLE rayna_flights ALTER COLUMN flight_no SET NOT NULL;
