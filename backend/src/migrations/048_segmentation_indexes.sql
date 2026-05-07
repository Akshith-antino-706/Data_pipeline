-- 048: Indexes to accelerate computeSegments' EXISTS subqueries + backfill linking
-- Before: ON_TRIP/FUTURE_TRAVEL checks did seq scans on rayna_tours (98K+ rows).
-- After: index-only scans on (unified_id, date, status).
--
-- The single-pass CTE in computeSegments hits these indexes once per contact,
-- so a 1.6M-row rebuild drops from minutes to seconds.

CREATE INDEX IF NOT EXISTS idx_rayna_tours_uid_date_status
  ON rayna_tours (unified_id, tour_date, status)
  WHERE unified_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rayna_hotels_uid_date
  ON rayna_hotels (unified_id, check_in_date)
  WHERE unified_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rayna_flights_uid_date_status
  ON rayna_flights (unified_id, from_datetime, status)
  WHERE unified_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rayna_visas_uid
  ON rayna_visas (unified_id)
  WHERE unified_id IS NOT NULL;

-- Partial index for CANCELLED rule (EXISTS on status='Cancelled')
CREATE INDEX IF NOT EXISTS idx_rayna_tours_cancelled_uid
  ON rayna_tours (unified_id)
  WHERE unified_id IS NOT NULL AND status = 'Cancelled';

CREATE INDEX IF NOT EXISTS idx_rayna_flights_cancelled_uid
  ON rayna_flights (unified_id)
  WHERE unified_id IS NOT NULL AND status = 'Cancelled';

-- For the backfill: linking rayna rows to unified_contacts by phone_key / email_key
-- relinkRawTables uses normalize_phone(guest_contact) and LOWER(TRIM(grnty_email))
-- as join keys. These expression indexes make the join index-driven.
CREATE INDEX IF NOT EXISTS idx_rayna_tours_guest_contact_norm
  ON rayna_tours (RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10))
  WHERE guest_contact IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rayna_tours_grnty_email_lower
  ON rayna_tours (LOWER(TRIM(grnty_email)))
  WHERE grnty_email IS NOT NULL;

ANALYZE rayna_tours;
ANALYZE rayna_hotels;
ANALYZE rayna_visas;
ANALYZE rayna_flights;
