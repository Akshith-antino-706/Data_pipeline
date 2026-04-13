-- 033: Add missing fields from Rayna visa API (applydate, applicant name, passport number)

ALTER TABLE rayna_visas ADD COLUMN IF NOT EXISTS apply_date TIMESTAMPTZ;
ALTER TABLE rayna_visas ADD COLUMN IF NOT EXISTS applicant_name TEXT;
ALTER TABLE rayna_visas ADD COLUMN IF NOT EXISTS passport_number TEXT;

CREATE INDEX IF NOT EXISTS idx_rayna_visas_apply_date ON rayna_visas(apply_date);
CREATE INDEX IF NOT EXISTS idx_rayna_visas_passport ON rayna_visas(passport_number);
