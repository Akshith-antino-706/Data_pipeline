-- 073: Fix journey_entries FK — customer_id references unified_contacts, not customers
-- Drop the old FK to customers table (unified_contacts is the real source of truth)
ALTER TABLE journey_entries DROP CONSTRAINT IF EXISTS journey_entries_customer_id_fkey;
