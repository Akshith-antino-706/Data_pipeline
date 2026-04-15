-- ═══════════════════════════════════════════════════════════
-- Migration 030: Customer Master — Phone + Email Matching
--
-- Pass 1: Extract identities from all 7 sources
-- Pass 2: Build clusters (phone-based + email merge + email-only)
-- Pass 3: One customer per cluster with best profile
-- Pass 4: Activity counts
-- ═══════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS booking_customer_map CASCADE;
DROP TABLE IF EXISTS customer_master CASCADE;

CREATE TABLE customer_master (
    id                    SERIAL PRIMARY KEY,
    phone_key             VARCHAR(10),
    email_key             VARCHAR(150),
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
    total_chats           INTEGER DEFAULT 0,
    total_tickets         INTEGER DEFAULT 0,
    total_tour_bookings   INTEGER DEFAULT 0,
    total_hotel_bookings  INTEGER DEFAULT 0,
    total_visa_bookings   INTEGER DEFAULT 0,
    total_flight_bookings INTEGER DEFAULT 0,
    first_chat_at         TIMESTAMPTZ,
    last_chat_at          TIMESTAMPTZ,
    chat_departments      TEXT,
    first_ticket_at       TIMESTAMPTZ,
    last_ticket_at        TIMESTAMPTZ,
    ticket_departments    TEXT,
    first_booking_at      TIMESTAMPTZ,
    last_booking_at       TIMESTAMPTZ,
    total_booking_revenue NUMERIC(12,2) DEFAULT 0,
    all_departments       TEXT,
    sources               TEXT,
    first_seen_at         TIMESTAMPTZ,
    last_seen_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- PASS 1: Extract all identities
-- ═══════════════════════════════════════════════════════════

CREATE TEMP TABLE all_ids (
    phone_key VARCHAR(10), email_key VARCHAR(150), raw_phone TEXT,
    source TEXT, name TEXT, email TEXT, company TEXT,
    city TEXT, state TEXT, country TEXT, dob TEXT,
    contact_type TEXT, contact_id INTEGER
);

-- Chats
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(customer_no) >= 7 THEN RIGHT(customer_no, 10) END,
    CASE WHEN TRIM(COALESCE(email,'')) != '' THEN LOWER(TRIM(email)) END,
    customer_no, 'chats', NULLIF(TRIM(wa_name),''), NULLIF(TRIM(email),''), NULLIF(TRIM(country),'')
FROM mysql_chats WHERE customer_no IS NOT NULL;

-- Contacts
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, company, city, state, dob, contact_type, contact_id)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(mobile,'[^0-9]','','g')) >= 7
         AND TRIM(mobile) NOT IN ('0','00','000','0000000','00000000','0000000000','na','NA','N/A')
         THEN RIGHT(REGEXP_REPLACE(mobile,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(email,'')) != '' THEN LOWER(TRIM(email)) END,
    NULLIF(TRIM(mobile),''), 'contacts',
    NULLIF(TRIM(name),''), NULLIF(TRIM(email),''), NULLIF(TRIM(company_name),''),
    NULLIF(TRIM(city),''), NULLIF(TRIM(cstate),''), NULLIF(TRIM(dob),''),
    NULLIF(TRIM(contact_type),''), id
FROM mysql_contacts;

-- Tickets JSON
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, company, city, state, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(c->>'mobile','[^0-9]','','g')) >= 7
         AND TRIM(c->>'mobile') NOT IN ('','0','00','000','N/A','NA','na','0000000','00000000','000000000')
         THEN RIGHT(REGEXP_REPLACE(c->>'mobile','[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(c->>'email','')) != '' THEN LOWER(TRIM(c->>'email')) END,
    c->>'mobile', 'tickets',
    NULLIF(TRIM(c->>'name'),''), NULLIF(TRIM(c->>'email'),''),
    NULLIF(TRIM(c->>'company_name'),''), NULLIF(TRIM(c->>'city'),''),
    NULLIF(TRIM(c->>'cstate'),''), NULLIF(TRIM(c->>'country_name'),'')
FROM (
    SELECT translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0 as c
    FROM mysql_tickets
    WHERE contact_status ~ '^\{"contacts"' AND contact_status NOT LIKE '%\u0000%'
      AND octet_length(contact_status) = length(contact_status)
) t WHERE c IS NOT NULL;

-- Tickets t_from (no valid contact_status)
INSERT INTO all_ids (email_key, source, email)
SELECT LOWER(TRIM(t_from)), 'tickets', TRIM(t_from)
FROM mysql_tickets
WHERE t_from IS NOT NULL AND TRIM(t_from) != ''
  AND (contact_status IS NULL OR contact_status = '' OR contact_status !~ '^\{"contacts"');

-- Tours
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'tours', NULLIF(TRIM(guest_name),''), NULLIF(TRIM(grnty_email),''), NULLIF(TRIM(nationality),'')
FROM rayna_tours;

-- Hotels
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'hotels', NULLIF(TRIM(guest_name),''), NULLIF(TRIM(grnty_email),''), NULLIF(TRIM(country_name),'')
FROM rayna_hotels;

-- Visas
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'visas', NULLIF(TRIM(guest_name),''), NULLIF(TRIM(grnty_email),''), NULLIF(TRIM(country_name),'')
FROM rayna_visas;

-- Flights
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND guest_contact NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'flights', NULLIF(TRIM(guest_name),''), NULLIF(TRIM(grnty_email),''), NULLIF(TRIM(nationality),'')
FROM rayna_flights;

DELETE FROM all_ids WHERE phone_key IS NULL AND email_key IS NULL;

-- ═══════════════════════════════════════════════════════════
-- PASS 2: Phone-based customers
-- ═══════════════════════════════════════════════════════════

-- Best profile per phone_key
CREATE TEMP TABLE phone_customers AS
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY phone_key ORDER BY
            CASE source WHEN 'contacts' THEN 1 WHEN 'tickets' THEN 2 WHEN 'chats' THEN 3
                WHEN 'tours' THEN 4 WHEN 'hotels' THEN 5 WHEN 'visas' THEN 6 WHEN 'flights' THEN 7 END,
            (CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) DESC
    ) as rn
    FROM all_ids WHERE phone_key IS NOT NULL
)
SELECT phone_key, raw_phone, name, email, email_key, company, city, state, country,
       dob, contact_type, contact_id
FROM ranked WHERE rn = 1;

CREATE INDEX idx_pc_phone ON phone_customers(phone_key);
CREATE INDEX idx_pc_email ON phone_customers(email_key);

-- Collect best email per phone_key (from any source)
UPDATE phone_customers pc SET
    email_key = sub.email_key, email = sub.email
FROM (
    SELECT DISTINCT ON (phone_key) phone_key, email_key, email
    FROM all_ids WHERE phone_key IS NOT NULL AND email_key IS NOT NULL
    ORDER BY phone_key,
        CASE source WHEN 'contacts' THEN 1 WHEN 'tickets' THEN 2 WHEN 'chats' THEN 3 ELSE 4 END
) sub
WHERE pc.phone_key = sub.phone_key AND pc.email_key IS NULL;

-- Fill missing fields from other rows with same phone
UPDATE phone_customers pc SET name = sub.name
FROM (SELECT DISTINCT ON (phone_key) phone_key, name FROM all_ids WHERE phone_key IS NOT NULL AND name IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.name IS NULL;

UPDATE phone_customers pc SET company = sub.company
FROM (SELECT DISTINCT ON (phone_key) phone_key, company FROM all_ids WHERE phone_key IS NOT NULL AND company IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.company IS NULL;

UPDATE phone_customers pc SET city = sub.city
FROM (SELECT DISTINCT ON (phone_key) phone_key, city FROM all_ids WHERE phone_key IS NOT NULL AND city IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.city IS NULL;

UPDATE phone_customers pc SET state = sub.state
FROM (SELECT DISTINCT ON (phone_key) phone_key, state FROM all_ids WHERE phone_key IS NOT NULL AND state IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.state IS NULL;

UPDATE phone_customers pc SET country = sub.country
FROM (SELECT DISTINCT ON (phone_key) phone_key, country FROM all_ids WHERE phone_key IS NOT NULL AND country IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.country IS NULL;

-- Sources per phone_key
CREATE TEMP TABLE phone_sources AS
SELECT phone_key, STRING_AGG(DISTINCT source, ', ' ORDER BY source) as sources
FROM all_ids WHERE phone_key IS NOT NULL GROUP BY phone_key;

-- Emails already claimed by phone-based customers
CREATE TEMP TABLE claimed_emails AS
SELECT DISTINCT email_key FROM phone_customers WHERE email_key IS NOT NULL;
CREATE INDEX idx_ce ON claimed_emails(email_key);

-- ═══════════════════════════════════════════════════════════
-- PASS 3: Email-only customers (no valid phone, email not already claimed)
-- ═══════════════════════════════════════════════════════════

CREATE TEMP TABLE email_customers AS
WITH email_only AS (
    SELECT * FROM all_ids
    WHERE phone_key IS NULL AND email_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM claimed_emails ce WHERE ce.email_key = all_ids.email_key)
),
ranked AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY email_key ORDER BY
            CASE source WHEN 'contacts' THEN 1 WHEN 'tickets' THEN 2 WHEN 'tours' THEN 3
                WHEN 'hotels' THEN 4 WHEN 'visas' THEN 5 WHEN 'flights' THEN 6 END,
            (CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) DESC
    ) as rn
    FROM email_only
)
SELECT email_key, name, email, company, city, state, country,
       dob, contact_type, contact_id
FROM ranked WHERE rn = 1;

CREATE TEMP TABLE email_sources AS
SELECT email_key, STRING_AGG(DISTINCT source, ', ' ORDER BY source) as sources
FROM all_ids WHERE phone_key IS NULL AND email_key IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM claimed_emails ce WHERE ce.email_key = all_ids.email_key)
GROUP BY email_key;

-- Fill missing fields for email-only
UPDATE email_customers ec SET name = sub.name
FROM (SELECT DISTINCT ON (email_key) email_key, name FROM all_ids WHERE phone_key IS NULL AND email_key IS NOT NULL AND name IS NOT NULL ORDER BY email_key) sub
WHERE ec.email_key = sub.email_key AND ec.name IS NULL;

UPDATE email_customers ec SET company = sub.company
FROM (SELECT DISTINCT ON (email_key) email_key, company FROM all_ids WHERE phone_key IS NULL AND email_key IS NOT NULL AND company IS NOT NULL ORDER BY email_key) sub
WHERE ec.email_key = sub.email_key AND ec.company IS NULL;

UPDATE email_customers ec SET city = sub.city
FROM (SELECT DISTINCT ON (email_key) email_key, city FROM all_ids WHERE phone_key IS NULL AND email_key IS NOT NULL AND city IS NOT NULL ORDER BY email_key) sub
WHERE ec.email_key = sub.email_key AND ec.city IS NULL;

UPDATE email_customers ec SET country = sub.country
FROM (SELECT DISTINCT ON (email_key) email_key, country FROM all_ids WHERE phone_key IS NULL AND email_key IS NOT NULL AND country IS NOT NULL ORDER BY email_key) sub
WHERE ec.email_key = sub.email_key AND ec.country IS NULL;

-- ═══════════════════════════════════════════════════════════
-- PASS 4: Insert both sets into customer_master
-- ═══════════════════════════════════════════════════════════

-- Phone-based customers
INSERT INTO customer_master (phone_key, email_key, phone, name, email, company_name, city, state, country, dob, contact_type, contact_id, sources)
SELECT pc.phone_key, pc.email_key, pc.raw_phone, pc.name, pc.email, pc.company, pc.city, pc.state, pc.country,
    pc.dob, pc.contact_type, pc.contact_id, ps.sources
FROM phone_customers pc
LEFT JOIN phone_sources ps ON ps.phone_key = pc.phone_key;

-- Email-only customers
INSERT INTO customer_master (phone_key, email_key, phone, name, email, company_name, city, state, country, dob, contact_type, contact_id, sources)
SELECT NULL, ec.email_key, NULL, ec.name, ec.email, ec.company, ec.city, ec.state, ec.country,
    ec.dob, ec.contact_type, ec.contact_id, es.sources
FROM email_customers ec
LEFT JOIN email_sources es ON es.email_key = ec.email_key;

-- ═══════════════════════════════════════════════════════════
-- PASS 5: Activity counts
-- ═══════════════════════════════════════════════════════════

CREATE INDEX idx_cm_phone_key ON customer_master(phone_key);
CREATE INDEX idx_cm_email_key ON customer_master(email_key);

-- 5a) Chats
WITH chat_agg AS (
    SELECT RIGHT(customer_no, 10) as phone_key,
        COUNT(*) as total_chats, MIN(created_at) as first_chat_at,
        MAX(GREATEST(last_msg, last_in, last_out, created_at)) as last_chat_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as chat_departments
    FROM mysql_chats WHERE customer_no IS NOT NULL AND LENGTH(customer_no) >= 7
    GROUP BY RIGHT(customer_no, 10)
)
UPDATE customer_master cm SET total_chats = ca.total_chats, first_chat_at = ca.first_chat_at,
    last_chat_at = ca.last_chat_at, chat_departments = ca.chat_departments
FROM chat_agg ca WHERE cm.phone_key = ca.phone_key;

-- 5b) Tickets (phone match + email match for email-only customers)
WITH ticket_phone AS (
    SELECT RIGHT(REGEXP_REPLACE(
        translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'mobile',
        '[^0-9]','','g'), 10) as match_key, 'phone' as match_type, updated_at, department_name
    FROM mysql_tickets
    WHERE contact_status ~ '^\{"contacts"' AND contact_status NOT LIKE '%\u0000%'
      AND octet_length(contact_status) = length(contact_status)
      AND LENGTH(REGEXP_REPLACE(translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'mobile','[^0-9]','','g')) >= 7
),
ticket_email AS (
    SELECT LOWER(TRIM(t_from)) as match_key, 'email' as match_type, updated_at, department_name
    FROM mysql_tickets WHERE t_from IS NOT NULL AND TRIM(t_from) != ''
),
matched AS (
    SELECT cm.id, tp.updated_at, tp.department_name FROM ticket_phone tp
    JOIN customer_master cm ON cm.phone_key = tp.match_key
    UNION
    SELECT cm.id, te.updated_at, te.department_name FROM ticket_email te
    JOIN customer_master cm ON cm.email_key = te.match_key WHERE cm.phone_key IS NULL
),
agg AS (
    SELECT id, COUNT(*) as cnt, MIN(updated_at) as first_at, MAX(updated_at) as last_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as depts
    FROM matched GROUP BY id
)
UPDATE customer_master cm SET total_tickets = a.cnt, first_ticket_at = a.first_at,
    last_ticket_at = a.last_at, ticket_departments = a.depts
FROM agg a WHERE cm.id = a.id;

-- 5c) Tours
WITH tour_phone AS (
    SELECT cm.id, t.total_sell, t.bill_date FROM rayna_tours t
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(t.guest_contact,'[^0-9]','','g'), 10)
    WHERE t.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(t.guest_contact,'[^0-9]','','g')) >= 7
),
tour_email AS (
    SELECT cm.id, t.total_sell, t.bill_date FROM rayna_tours t
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(t.grnty_email))
    WHERE t.grnty_email IS NOT NULL AND TRIM(t.grnty_email) != '' AND cm.phone_key IS NULL
),
agg AS (
    SELECT id, COUNT(*) as cnt, SUM(total_sell) as rev, MIN(bill_date) as first_at, MAX(bill_date) as last_at
    FROM (SELECT * FROM tour_phone UNION ALL SELECT * FROM tour_email) x GROUP BY id
)
UPDATE customer_master cm SET total_tour_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, a.last_at)
FROM agg a WHERE cm.id = a.id;

-- 5d) Hotels
WITH hotel_phone AS (
    SELECT cm.id, h.total_sell, h.bill_date FROM rayna_hotels h
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(h.guest_contact,'[^0-9]','','g'), 10)
    WHERE h.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(h.guest_contact,'[^0-9]','','g')) >= 7
),
hotel_email AS (
    SELECT cm.id, h.total_sell, h.bill_date FROM rayna_hotels h
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(h.grnty_email))
    WHERE h.grnty_email IS NOT NULL AND TRIM(h.grnty_email) != '' AND cm.phone_key IS NULL
),
agg AS (
    SELECT id, COUNT(*) as cnt, SUM(total_sell) as rev, MIN(bill_date) as first_at, MAX(bill_date) as last_at
    FROM (SELECT * FROM hotel_phone UNION ALL SELECT * FROM hotel_email) x GROUP BY id
)
UPDATE customer_master cm SET total_hotel_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, a.last_at)
FROM agg a WHERE cm.id = a.id;

-- 5e) Visas
WITH visa_phone AS (
    SELECT cm.id, v.total_sell, v.bill_date FROM rayna_visas v
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(v.guest_contact,'[^0-9]','','g'), 10)
    WHERE v.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(v.guest_contact,'[^0-9]','','g')) >= 7
),
visa_email AS (
    SELECT cm.id, v.total_sell, v.bill_date FROM rayna_visas v
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(v.grnty_email))
    WHERE v.grnty_email IS NOT NULL AND TRIM(v.grnty_email) != '' AND cm.phone_key IS NULL
),
agg AS (
    SELECT id, COUNT(*) as cnt, SUM(total_sell) as rev, MIN(bill_date) as first_at, MAX(bill_date) as last_at
    FROM (SELECT * FROM visa_phone UNION ALL SELECT * FROM visa_email) x GROUP BY id
)
UPDATE customer_master cm SET total_visa_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, a.last_at)
FROM agg a WHERE cm.id = a.id;

-- 5f) Flights
WITH flight_phone AS (
    SELECT cm.id, f.selling_price, f.bill_date FROM rayna_flights f
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(f.guest_contact,'[^0-9]','','g'), 10)
    WHERE f.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(f.guest_contact,'[^0-9]','','g')) >= 7
),
flight_email AS (
    SELECT cm.id, f.selling_price, f.bill_date FROM rayna_flights f
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(f.grnty_email))
    WHERE f.grnty_email IS NOT NULL AND TRIM(f.grnty_email) != '' AND cm.phone_key IS NULL
),
agg AS (
    SELECT id, COUNT(*) as cnt, SUM(selling_price) as rev, MIN(bill_date) as first_at, MAX(bill_date) as last_at
    FROM (SELECT * FROM flight_phone UNION ALL SELECT * FROM flight_email) x GROUP BY id
)
UPDATE customer_master cm SET total_flight_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.first_at),
    last_booking_at = GREATEST(cm.last_booking_at, a.last_at)
FROM agg a WHERE cm.id = a.id;

-- ═══════════════════════════════════════════════════════════
-- PASS 6: Unified fields + indexes
-- ═══════════════════════════════════════════════════════════

UPDATE customer_master SET
    all_departments = NULLIF(CONCAT_WS(', ', NULLIF(chat_departments,''), NULLIF(ticket_departments,'')), ''),
    first_seen_at = LEAST(first_chat_at, first_ticket_at, first_booking_at),
    last_seen_at = GREATEST(last_chat_at, last_ticket_at, last_booking_at),
    updated_at = NOW();

CREATE INDEX idx_cm_name ON customer_master(name);
CREATE INDEX idx_cm_phone ON customer_master(phone);
CREATE INDEX idx_cm_email ON customer_master(LOWER(email));
CREATE INDEX idx_cm_country ON customer_master(country);
CREATE INDEX idx_cm_last_seen ON customer_master(last_seen_at);
CREATE UNIQUE INDEX idx_cm_phone_key_uniq ON customer_master(phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX idx_cm_email_key_idx ON customer_master(email_key) WHERE email_key IS NOT NULL;

-- Clean up
DROP TABLE IF EXISTS all_ids, phone_customers, phone_sources, claimed_emails, email_customers, email_sources;

COMMIT;
