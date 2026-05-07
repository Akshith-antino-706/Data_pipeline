-- 049_users_from_rayna.sql
-- Link unified_contacts to users table for API-sourced contacts

ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_uc_user_id ON unified_contacts(user_id) WHERE user_id IS NOT NULL;

-- Speed up email/phone matching for syncRaynaContactsToUsers
CREATE INDEX IF NOT EXISTS idx_user_emails_lower ON user_emails (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_user_phones_norm ON user_phones (RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10));
