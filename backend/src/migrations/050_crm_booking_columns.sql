-- ===================================================================
-- Migration 050: Add CRM booking columns for better segmentation
-- Pulls n_bookings / l_booking from MySQL CRM into users table,
-- then flows into unified_contacts.crm_bookings for segmentation.
-- ===================================================================

-- 1. Add n_bookings and l_booking to users table (from MySQL CRM)
ALTER TABLE users ADD COLUMN IF NOT EXISTS n_bookings INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS l_booking  DATE;

-- 2. Add crm_bookings to unified_contacts (aggregated from users table)
ALTER TABLE unified_contacts ADD COLUMN IF NOT EXISTS crm_bookings INTEGER DEFAULT 0;

-- 3. Index for fast segmentation lookups
CREATE INDEX IF NOT EXISTS idx_uc_crm_bookings ON unified_contacts(crm_bookings) WHERE crm_bookings > 0;
