-- ═══════════════════════════════════════════════════════════
-- Migration 029: Fresh Customer Master (Unified from ALL sources)
--
-- Sources: chats, contacts, tickets (contact_status JSON),
--          tours, hotels, visas, flights
--
-- Primary key: phone (last 10 digits)
-- Enrichment priority: contacts > tickets > chats > bookings
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Step 0: Drop old table and recreate ────────────────────
DROP TABLE IF EXISTS booking_customer_map CASCADE;
DROP TABLE IF EXISTS customer_master CASCADE;

CREATE TABLE customer_master (
    id                    SERIAL PRIMARY KEY,
    phone_key             VARCHAR(10) NOT NULL UNIQUE,
    name                  VARCHAR(150),
    email                 VARCHAR(150),
    phone                 TEXT,
    company_name          VARCHAR(150),
    city                  VARCHAR(75),
    state                 VARCHAR(75),
    country               VARCHAR(75),
    dob                   VARCHAR(20),
    contact_type          VARCHAR(20),
    contact_id            INTEGER,

    -- Source activity counts
    total_chats           INTEGER DEFAULT 0,
    total_tickets         INTEGER DEFAULT 0,
    total_tour_bookings   INTEGER DEFAULT 0,
    total_hotel_bookings  INTEGER DEFAULT 0,
    total_visa_bookings   INTEGER DEFAULT 0,
    total_flight_bookings INTEGER DEFAULT 0,

    -- Timestamps
    first_chat_at         TIMESTAMPTZ,
    last_chat_at          TIMESTAMPTZ,
    chat_departments      TEXT,
    first_ticket_at       TIMESTAMPTZ,
    last_ticket_at        TIMESTAMPTZ,
    ticket_departments    TEXT,
    first_booking_at      TIMESTAMPTZ,
    last_booking_at       TIMESTAMPTZ,
    total_booking_revenue NUMERIC(12,2) DEFAULT 0,

    -- Unified
    all_departments       TEXT,
    sources               TEXT,
    first_seen_at         TIMESTAMPTZ,
    last_seen_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- Step 1: Extract phone keys from ALL sources into one union
-- ═══════════════════════════════════════════════════════════

CREATE TEMP TABLE all_phones (
    phone_key   VARCHAR(10),
    raw_phone   TEXT,
    source      TEXT,
    name        TEXT,
    email       TEXT,
    company     TEXT,
    city        TEXT,
    state       TEXT,
    country     TEXT,
    dob         TEXT,
    contact_type TEXT,
    contact_id  INTEGER
);

-- 1a) Chats (wa_id = phone number)
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, country)
SELECT
    RIGHT(wa_id, 10),
    wa_id,
    'chats',
    NULLIF(TRIM(wa_name), ''),
    NULLIF(TRIM(email), ''),
    NULLIF(TRIM(country), '')
FROM mysql_chats
WHERE wa_id IS NOT NULL AND LENGTH(wa_id) >= 7;

-- 1b) Contacts (by mobile)
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, company, city, state, dob, contact_type, contact_id)
SELECT
    RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10),
    TRIM(mobile),
    'contacts',
    NULLIF(TRIM(name), ''),
    NULLIF(TRIM(email), ''),
    NULLIF(TRIM(company_name), ''),
    NULLIF(TRIM(city), ''),
    NULLIF(TRIM(cstate), ''),
    NULLIF(TRIM(dob), ''),
    NULLIF(TRIM(contact_type), ''),
    id
FROM mysql_contacts
WHERE mobile IS NOT NULL AND TRIM(mobile) != ''
  AND LENGTH(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g')) >= 7
  AND TRIM(mobile) NOT IN ('0','00','000','0000000','00000000','0000000000','na','NA','N/A');

-- 1c) Tickets (contact_status JSON → mobile)
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, company, city, state, country)
SELECT
    RIGHT(REGEXP_REPLACE(c->>'mobile', '[^0-9]', '', 'g'), 10),
    c->>'mobile',
    'tickets',
    NULLIF(TRIM(c->>'name'), ''),
    NULLIF(TRIM(c->>'email'), ''),
    NULLIF(TRIM(c->>'company_name'), ''),
    NULLIF(TRIM(c->>'city'), ''),
    NULLIF(TRIM(c->>'cstate'), ''),
    NULLIF(TRIM(c->>'country_name'), '')
FROM (
    SELECT translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0 as c
    FROM mysql_tickets
    WHERE contact_status ~ '^\{"contacts"'
      AND contact_status NOT LIKE '%\u0000%'
      AND octet_length(contact_status) = length(contact_status)
) t
WHERE c->>'mobile' IS NOT NULL
  AND TRIM(c->>'mobile') NOT IN ('', '0', '00', '000', 'N/A', 'NA', 'na', '0000000', '00000000', '00', '000000000')
  AND LENGTH(REGEXP_REPLACE(c->>'mobile', '[^0-9]', '', 'g')) >= 7;

-- 1d) Tours (guest_contact = phone, guest_name = name)
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, country)
SELECT
    RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10),
    guest_contact,
    'tours',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(nationality), '')
FROM rayna_tours
WHERE guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
  AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','');

-- 1e) Hotels
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, country)
SELECT
    RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10),
    guest_contact,
    'hotels',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(country_name), '')
FROM rayna_hotels
WHERE guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
  AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','');

-- 1f) Visas
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, country)
SELECT
    RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10),
    guest_contact,
    'visas',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(country_name), '')
FROM rayna_visas
WHERE guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
  AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','');

-- 1g) Flights
INSERT INTO all_phones (phone_key, raw_phone, source, name, email, country)
SELECT
    RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10),
    guest_contact,
    'flights',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(nationality), '')
FROM rayna_flights
WHERE guest_contact IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
  AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','');

-- Index for fast grouping
CREATE INDEX idx_tmp_allphones ON all_phones(phone_key);

-- ═══════════════════════════════════════════════════════════
-- Step 2: Build unified customer master from all_phones
-- Priority: contacts > tickets > chats > tours > hotels > visas > flights
-- ═══════════════════════════════════════════════════════════

WITH ranked AS (
    SELECT *,
        ROW_NUMBER() OVER (
            PARTITION BY phone_key
            ORDER BY
                CASE source
                    WHEN 'contacts' THEN 1
                    WHEN 'tickets'  THEN 2
                    WHEN 'chats'    THEN 3
                    WHEN 'tours'    THEN 4
                    WHEN 'hotels'   THEN 5
                    WHEN 'visas'    THEN 6
                    WHEN 'flights'  THEN 7
                END,
                -- prefer rows with more data filled
                (CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END +
                 CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) DESC
        ) as rn
    FROM all_phones
),
-- Best profile per phone_key (from highest priority source with most data)
best AS (
    SELECT * FROM ranked WHERE rn = 1
),
-- Collect all sources per phone_key
source_list AS (
    SELECT phone_key, STRING_AGG(DISTINCT source, ', ' ORDER BY source) as sources
    FROM all_phones GROUP BY phone_key
),
-- Fill missing fields from other sources (COALESCE across sources)
enriched AS (
    SELECT
        b.phone_key,
        b.raw_phone,
        COALESCE(b.name, n.name) as name,
        COALESCE(b.email, e.email) as email,
        COALESCE(b.company, co.company) as company_name,
        COALESCE(b.city, ci.city) as city,
        COALESCE(b.state, st.state) as state,
        COALESCE(b.country, cr.country) as country,
        b.dob,
        b.contact_type,
        b.contact_id,
        sl.sources
    FROM best b
    LEFT JOIN source_list sl ON sl.phone_key = b.phone_key
    -- Fill name from any source
    LEFT JOIN LATERAL (
        SELECT name FROM all_phones
        WHERE phone_key = b.phone_key AND name IS NOT NULL AND name != b.name
        LIMIT 1
    ) n ON b.name IS NULL
    -- Fill email from any source
    LEFT JOIN LATERAL (
        SELECT email FROM all_phones
        WHERE phone_key = b.phone_key AND email IS NOT NULL
        LIMIT 1
    ) e ON b.email IS NULL
    -- Fill company
    LEFT JOIN LATERAL (
        SELECT company FROM all_phones
        WHERE phone_key = b.phone_key AND company IS NOT NULL
        LIMIT 1
    ) co ON b.company IS NULL
    -- Fill city
    LEFT JOIN LATERAL (
        SELECT city FROM all_phones
        WHERE phone_key = b.phone_key AND city IS NOT NULL
        LIMIT 1
    ) ci ON b.city IS NULL
    -- Fill state
    LEFT JOIN LATERAL (
        SELECT state FROM all_phones
        WHERE phone_key = b.phone_key AND state IS NOT NULL
        LIMIT 1
    ) st ON b.state IS NULL
    -- Fill country
    LEFT JOIN LATERAL (
        SELECT country FROM all_phones
        WHERE phone_key = b.phone_key AND country IS NOT NULL
        LIMIT 1
    ) cr ON b.country IS NULL
)

INSERT INTO customer_master (
    phone_key, phone, name, email, company_name, city, state, country,
    dob, contact_type, contact_id, sources
)
SELECT
    phone_key, raw_phone, name, email, company_name, city, state, country,
    dob, contact_type, contact_id, sources
FROM enriched;

-- ═══════════════════════════════════════════════════════════
-- Step 3: Populate activity counts from each source
-- ═══════════════════════════════════════════════════════════

-- Index for fast joins
CREATE INDEX idx_cm_phone_key ON customer_master(phone_key);
CREATE INDEX idx_cm_email ON customer_master(LOWER(email));

-- 3a) Chat activity
WITH chat_agg AS (
    SELECT
        RIGHT(wa_id, 10) as phone_key,
        COUNT(*) as total_chats,
        MIN(created_at) as first_chat_at,
        MAX(GREATEST(last_msg, last_in, last_out, created_at)) as last_chat_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as chat_departments
    FROM mysql_chats
    WHERE wa_id IS NOT NULL AND LENGTH(wa_id) >= 7
    GROUP BY RIGHT(wa_id, 10)
)
UPDATE customer_master cm SET
    total_chats = ca.total_chats,
    first_chat_at = ca.first_chat_at,
    last_chat_at = ca.last_chat_at,
    chat_departments = ca.chat_departments
FROM chat_agg ca WHERE cm.phone_key = ca.phone_key;

-- 3b) Ticket activity (match by phone from contact_status AND by email)
WITH ticket_phone AS (
    SELECT
        RIGHT(REGEXP_REPLACE(
            translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'mobile',
            '[^0-9]', '', 'g'
        ), 10) as phone_key,
        updated_at,
        department_name
    FROM mysql_tickets
    WHERE contact_status ~ '^\{"contacts"'
      AND contact_status NOT LIKE '%\u0000%'
      AND octet_length(contact_status) = length(contact_status)
      AND LENGTH(REGEXP_REPLACE(
            translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'mobile',
            '[^0-9]', '', 'g'
          )) >= 7
),
ticket_email AS (
    SELECT
        cm.phone_key,
        t.updated_at,
        t.department_name
    FROM mysql_tickets t
    JOIN customer_master cm ON LOWER(TRIM(t.t_from)) = LOWER(cm.email)
    WHERE t.t_from IS NOT NULL AND TRIM(t.t_from) != '' AND cm.email IS NOT NULL
),
ticket_all AS (
    SELECT * FROM ticket_phone
    UNION
    SELECT * FROM ticket_email
),
ticket_agg AS (
    SELECT
        phone_key,
        COUNT(*) as total_tickets,
        MIN(updated_at) as first_ticket_at,
        MAX(updated_at) as last_ticket_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as ticket_departments
    FROM ticket_all
    WHERE phone_key IS NOT NULL
    GROUP BY phone_key
)
UPDATE customer_master cm SET
    total_tickets = ta.total_tickets,
    first_ticket_at = ta.first_ticket_at,
    last_ticket_at = ta.last_ticket_at,
    ticket_departments = ta.ticket_departments
FROM ticket_agg ta WHERE cm.phone_key = ta.phone_key;

-- 3c) Tour bookings
WITH tour_agg AS (
    SELECT
        RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10) as phone_key,
        COUNT(*) as cnt,
        SUM(total_sell) as revenue,
        MIN(bill_date) as first_at,
        MAX(bill_date) as last_at
    FROM rayna_tours
    WHERE guest_contact IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
    GROUP BY RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10)
)
UPDATE customer_master cm SET
    total_tour_bookings = ta.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(ta.revenue, 0),
    first_booking_at = LEAST(cm.first_booking_at, ta.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, ta.last_at)
FROM tour_agg ta WHERE cm.phone_key = ta.phone_key;

-- 3d) Hotel bookings
WITH hotel_agg AS (
    SELECT
        RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10) as phone_key,
        COUNT(*) as cnt,
        SUM(total_sell) as revenue,
        MIN(bill_date) as first_at,
        MAX(bill_date) as last_at
    FROM rayna_hotels
    WHERE guest_contact IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
    GROUP BY RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10)
)
UPDATE customer_master cm SET
    total_hotel_bookings = ha.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(ha.revenue, 0),
    first_booking_at = LEAST(cm.first_booking_at, ha.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, ha.last_at)
FROM hotel_agg ha WHERE cm.phone_key = ha.phone_key;

-- 3e) Visa bookings
WITH visa_agg AS (
    SELECT
        RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10) as phone_key,
        COUNT(*) as cnt,
        SUM(total_sell) as revenue,
        MIN(bill_date) as first_at,
        MAX(bill_date) as last_at
    FROM rayna_visas
    WHERE guest_contact IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
    GROUP BY RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10)
)
UPDATE customer_master cm SET
    total_visa_bookings = va.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(va.revenue, 0),
    first_booking_at = LEAST(cm.first_booking_at, va.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, va.last_at)
FROM visa_agg va WHERE cm.phone_key = va.phone_key;

-- 3f) Flight bookings
WITH flight_agg AS (
    SELECT
        RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10) as phone_key,
        COUNT(*) as cnt,
        SUM(selling_price) as revenue,
        MIN(bill_date) as first_at,
        MAX(bill_date) as last_at
    FROM rayna_flights
    WHERE guest_contact IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g')) >= 7
    GROUP BY RIGHT(REGEXP_REPLACE(guest_contact, '[^0-9]', '', 'g'), 10)
)
UPDATE customer_master cm SET
    total_flight_bookings = fa.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(fa.revenue, 0),
    first_booking_at = LEAST(cm.first_booking_at, fa.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, fa.last_at)
FROM flight_agg fa WHERE cm.phone_key = fa.phone_key;

-- ═══════════════════════════════════════════════════════════
-- Step 4: Compute unified fields
-- ═══════════════════════════════════════════════════════════

UPDATE customer_master SET
    all_departments = NULLIF(CONCAT_WS(', ',
        NULLIF(chat_departments, ''),
        NULLIF(ticket_departments, '')
    ), ''),
    first_seen_at = LEAST(first_chat_at, first_ticket_at, first_booking_at),
    last_seen_at = GREATEST(last_chat_at, last_ticket_at, last_booking_at),
    updated_at = NOW();

-- ═══════════════════════════════════════════════════════════
-- Step 5: Indexes
-- ═══════════════════════════════════════════════════════════

CREATE INDEX idx_cm_name ON customer_master(name);
CREATE INDEX idx_cm_phone ON customer_master(phone);
CREATE INDEX idx_cm_country ON customer_master(country);
CREATE INDEX idx_cm_last_seen ON customer_master(last_seen_at);

-- Clean up
DROP TABLE IF EXISTS all_phones;

COMMIT;
