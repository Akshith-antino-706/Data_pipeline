-- ═══════════════════════════════════════════════════════════
-- Migration 026: Map Rayna Bookings → Customer Master
--
-- Match priority: 1) Phone (last 10 digits)  2) Email
-- Uses temp tables with indexes for fast matching.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Add booking columns to customer_master ───────────────────
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS total_tour_bookings INTEGER DEFAULT 0;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS total_hotel_bookings INTEGER DEFAULT 0;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS total_visa_bookings INTEGER DEFAULT 0;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS total_flight_bookings INTEGER DEFAULT 0;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS total_booking_revenue NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS first_booking_at TIMESTAMPTZ;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS last_booking_at TIMESTAMPTZ;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS booking_nationalities TEXT;
ALTER TABLE customer_master ADD COLUMN IF NOT EXISTS booking_agents TEXT;

-- ── Mapping table ────────────────────────────────────────────
DROP TABLE IF EXISTS booking_customer_map;
CREATE TABLE booking_customer_map (
    id              SERIAL PRIMARY KEY,
    customer_master_id INTEGER REFERENCES customer_master(id),
    booking_source  TEXT NOT NULL,
    booking_id      INTEGER NOT NULL,
    billno          TEXT,
    match_type      TEXT,
    matched_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- Pre-compute phone keys for fast matching
-- ═══════════════════════════════════════════════════════════

-- Customer phone keys
CREATE TEMP TABLE cm_phone_keys AS
SELECT id, phone, RIGHT(phone, 10) as phone_key
FROM customer_master
WHERE phone IS NOT NULL AND LENGTH(phone) >= 7;
CREATE INDEX idx_tmp_cm_phone ON cm_phone_keys(phone_key);

-- Customer email keys
CREATE TEMP TABLE cm_email_keys AS
SELECT id, LOWER(TRIM(email)) as email_key
FROM customer_master
WHERE email IS NOT NULL AND TRIM(email) != '';
CREATE INDEX idx_tmp_cm_email ON cm_email_keys(email_key);

-- Tours phone keys
CREATE TEMP TABLE tours_phone_keys AS
SELECT id, billno, RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10) as phone_key
FROM rayna_tours
WHERE guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
  AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','');
CREATE INDEX idx_tmp_tours_phone ON tours_phone_keys(phone_key);

-- Tours email keys
CREATE TEMP TABLE tours_email_keys AS
SELECT id, billno, LOWER(TRIM(grnty_email)) as email_key
FROM rayna_tours
WHERE grnty_email IS NOT NULL
  AND TRIM(grnty_email) != ''
  AND grnty_email != 'abcd@gmail.com';
CREATE INDEX idx_tmp_tours_email ON tours_email_keys(email_key);

-- ═══════════════════════════════════════════════════════════
-- STEP 1: Match tours by phone
-- ═══════════════════════════════════════════════════════════

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (tp.id)
    cp.id, 'tours', tp.id, tp.billno, 'phone'
FROM tours_phone_keys tp
JOIN cm_phone_keys cp ON tp.phone_key = cp.phone_key
ORDER BY tp.id, cp.id;

-- STEP 2: Match remaining tours by email
INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (te.id)
    ce.id, 'tours', te.id, te.billno, 'email'
FROM tours_email_keys te
JOIN cm_email_keys ce ON te.email_key = ce.email_key
WHERE NOT EXISTS (
    SELECT 1 FROM booking_customer_map bcm
    WHERE bcm.booking_source = 'tours' AND bcm.booking_id = te.id
)
ORDER BY te.id, ce.id;

-- ═══════════════════════════════════════════════════════════
-- STEP 3: Match hotels (phone then email)
-- ═══════════════════════════════════════════════════════════

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (h.id)
    cp.id, 'hotels', h.id, h.billno, 'phone'
FROM rayna_hotels h
JOIN cm_phone_keys cp ON RIGHT(REGEXP_REPLACE(h.guest_contact, '[^0-9]', '', 'g'), 10) = cp.phone_key
WHERE h.guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(h.guest_contact, '[^0-9]', '', 'g')) >= 7
  AND h.guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
ORDER BY h.id, cp.id;

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (h.id)
    ce.id, 'hotels', h.id, h.billno, 'email'
FROM rayna_hotels h
JOIN cm_email_keys ce ON LOWER(TRIM(h.grnty_email)) = ce.email_key
WHERE h.grnty_email IS NOT NULL AND TRIM(h.grnty_email) != ''
  AND NOT EXISTS (
      SELECT 1 FROM booking_customer_map bcm WHERE bcm.booking_source = 'hotels' AND bcm.booking_id = h.id
  )
ORDER BY h.id, ce.id;

-- ═══════════════════════════════════════════════════════════
-- STEP 4: Match visas (phone then email)
-- ═══════════════════════════════════════════════════════════

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (v.id)
    cp.id, 'visas', v.id, v.billno, 'phone'
FROM rayna_visas v
JOIN cm_phone_keys cp ON RIGHT(REGEXP_REPLACE(v.guest_contact, '[^0-9]', '', 'g'), 10) = cp.phone_key
WHERE v.guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(v.guest_contact, '[^0-9]', '', 'g')) >= 7
  AND v.guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
ORDER BY v.id, cp.id;

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (v.id)
    ce.id, 'visas', v.id, v.billno, 'email'
FROM rayna_visas v
JOIN cm_email_keys ce ON LOWER(TRIM(v.grnty_email)) = ce.email_key
WHERE v.grnty_email IS NOT NULL AND TRIM(v.grnty_email) != ''
  AND NOT EXISTS (
      SELECT 1 FROM booking_customer_map bcm WHERE bcm.booking_source = 'visas' AND bcm.booking_id = v.id
  )
ORDER BY v.id, ce.id;

-- ═══════════════════════════════════════════════════════════
-- STEP 5: Match flights (phone then email)
-- ═══════════════════════════════════════════════════════════

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (f.id)
    cp.id, 'flights', f.id, f.billno, 'phone'
FROM rayna_flights f
JOIN cm_phone_keys cp ON RIGHT(REGEXP_REPLACE(f.guest_contact, '[^0-9]', '', 'g'), 10) = cp.phone_key
WHERE f.guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(f.guest_contact, '[^0-9]', '', 'g')) >= 7
  AND f.guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
ORDER BY f.id, cp.id;

INSERT INTO booking_customer_map (customer_master_id, booking_source, booking_id, billno, match_type)
SELECT DISTINCT ON (f.id)
    ce.id, 'flights', f.id, f.billno, 'email'
FROM rayna_flights f
JOIN cm_email_keys ce ON LOWER(TRIM(f.grnty_email)) = ce.email_key
WHERE f.grnty_email IS NOT NULL AND TRIM(f.grnty_email) != ''
  AND NOT EXISTS (
      SELECT 1 FROM booking_customer_map bcm WHERE bcm.booking_source = 'flights' AND bcm.booking_id = f.id
  )
ORDER BY f.id, ce.id;

-- ═══════════════════════════════════════════════════════════
-- STEP 6: Aggregate booking stats into customer_master
-- ═══════════════════════════════════════════════════════════

CREATE INDEX idx_bcm_customer ON booking_customer_map(customer_master_id);
CREATE INDEX idx_bcm_source ON booking_customer_map(booking_source, booking_id);

UPDATE customer_master cm SET
    total_tour_bookings = COALESCE(agg.tour_count, 0),
    total_hotel_bookings = COALESCE(agg.hotel_count, 0),
    total_visa_bookings = COALESCE(agg.visa_count, 0),
    total_flight_bookings = COALESCE(agg.flight_count, 0),
    total_booking_revenue = COALESCE(agg.total_revenue, 0),
    first_booking_at = agg.first_booking,
    last_booking_at = agg.last_booking,
    updated_at = NOW()
FROM (
    SELECT
        bcm.customer_master_id,
        COUNT(*) FILTER (WHERE bcm.booking_source = 'tours') as tour_count,
        COUNT(*) FILTER (WHERE bcm.booking_source = 'hotels') as hotel_count,
        COUNT(*) FILTER (WHERE bcm.booking_source = 'visas') as visa_count,
        COUNT(*) FILTER (WHERE bcm.booking_source = 'flights') as flight_count,
        SUM(CASE
            WHEN bcm.booking_source = 'tours' THEN t.total_sell
            WHEN bcm.booking_source = 'hotels' THEN h.total_sell
            WHEN bcm.booking_source = 'visas' THEN v.total_sell
            WHEN bcm.booking_source = 'flights' THEN f.selling_price
            ELSE 0
        END) as total_revenue,
        LEAST(MIN(t.bill_date), MIN(h.bill_date), MIN(v.bill_date), MIN(f.bill_date)) as first_booking,
        GREATEST(MAX(t.bill_date), MAX(h.bill_date), MAX(v.bill_date), MAX(f.bill_date)) as last_booking
    FROM booking_customer_map bcm
    LEFT JOIN rayna_tours t ON bcm.booking_source = 'tours' AND bcm.booking_id = t.id
    LEFT JOIN rayna_hotels h ON bcm.booking_source = 'hotels' AND bcm.booking_id = h.id
    LEFT JOIN rayna_visas v ON bcm.booking_source = 'visas' AND bcm.booking_id = v.id
    LEFT JOIN rayna_flights f ON bcm.booking_source = 'flights' AND bcm.booking_id = f.id
    GROUP BY bcm.customer_master_id
) agg
WHERE cm.id = agg.customer_master_id;

-- Clean up temp tables
DROP TABLE IF EXISTS tours_phone_keys;
DROP TABLE IF EXISTS tours_email_keys;
DROP TABLE IF EXISTS cm_phone_keys;
DROP TABLE IF EXISTS cm_email_keys;

COMMIT;
