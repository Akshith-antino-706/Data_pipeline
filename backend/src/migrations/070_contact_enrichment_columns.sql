-- Add columns for contact enrichment (email validation + mobile formatting)
-- actual_email: original email before enrichment
-- actual_mobile: original mobile before formatting
-- mobile_country: country detected from mobile number

ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS actual_email TEXT;
ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS actual_mobile TEXT;
ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS mobile_country TEXT;

CREATE INDEX IF NOT EXISTS idx_uc_mobile_country ON unified_contacts(mobile_country);
