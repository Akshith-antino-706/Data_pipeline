-- ═══════════════════════════════════════════════════════════
-- Migration 031: Customer Master — Activity-Based Only
--
-- Sources: chats, tickets, tours, hotels, visas, flights
-- NO mysql_contacts (678k dead records removed)
-- Matching: phone (primary) + email (fallback)
-- Garbage values filtered during build
-- ═══════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS booking_customer_map CASCADE;
DROP TABLE IF EXISTS customer_master CASCADE;

-- Junk values to exclude
CREATE TEMP TABLE junk_vals (val TEXT);
INSERT INTO junk_vals VALUES ('N/A'),('NA'),('na'),('n/a'),('N/a'),('.'),('-'),('0'),('00'),
  ('Nil'),('nil'),('NIL'),('None'),('none'),('NONE'),('null'),('NULL'),('---'),('..'),('XX'),
  ('Guest'),('guest'),('GUEST'),('test'),('Test'),('TEST');

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
    first_message         TIMESTAMPTZ,
    first_msg_text        TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- PASS 1: Extract identities from activity sources only
-- ═══════════════════════════════════════════════════════════

CREATE TEMP TABLE all_ids (
    phone_key VARCHAR(10), email_key VARCHAR(150), raw_phone TEXT,
    source TEXT, name TEXT, email TEXT, company TEXT,
    city TEXT, state TEXT, country TEXT, designation TEXT
);

-- 1) Chats
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(customer_no) >= 7 THEN RIGHT(customer_no, 10) END,
    CASE WHEN TRIM(COALESCE(email,'')) != '' THEN LOWER(TRIM(email)) END,
    customer_no, 'chats',
    NULLIF(TRIM(wa_name), ''),
    NULLIF(TRIM(email), ''),
    NULLIF(TRIM(country), '')
FROM mysql_chats WHERE customer_no IS NOT NULL;

-- 2) Tickets (contact_status JSON → extract contact fields)
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, company, city, state, country, designation)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(c->>'mobile','[^0-9]','','g')) >= 7
         AND COALESCE(c->>'mobile','') NOT IN (SELECT val FROM junk_vals)
         THEN RIGHT(REGEXP_REPLACE(c->>'mobile','[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(c->>'email','')) != '' THEN LOWER(TRIM(c->>'email')) END,
    c->>'mobile', 'tickets',
    NULLIF(TRIM(c->>'name'), ''),
    NULLIF(TRIM(c->>'email'), ''),
    NULLIF(TRIM(c->>'company_name'), ''),
    NULLIF(TRIM(c->>'city'), ''),
    NULLIF(TRIM(c->>'cstate'), ''),
    NULLIF(TRIM(c->>'country_name'), ''),
    NULLIF(TRIM(c->>'designation'), '')
FROM (
    SELECT translate(contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0 as c
    FROM mysql_tickets
    WHERE contact_status ~ '^\{"contacts"'
      AND contact_status NOT LIKE '%\u0000%'
      AND octet_length(contact_status) = length(contact_status)
) t
WHERE c->>'name' IS NOT NULL;

-- 3) Tickets (t_from fallback — no contact_status, exclude Rayna internal emails)
INSERT INTO all_ids (email_key, source, email)
SELECT LOWER(TRIM(t_from)), 'tickets', TRIM(t_from)
FROM mysql_tickets
WHERE t_from IS NOT NULL AND TRIM(t_from) != ''
  AND (contact_status IS NULL OR contact_status !~ '^\{"contacts"')
  AND t_from NOT LIKE '%raynatours.com%' AND t_from NOT LIKE '%raynab2b.com%';

-- 4) Tours
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND COALESCE(guest_contact,'') NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'tours',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(nationality), '')
FROM rayna_tours;

-- 5) Hotels
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND COALESCE(guest_contact,'') NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'hotels',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(country_name), '')
FROM rayna_hotels;

-- 6) Visas
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND COALESCE(guest_contact,'') NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'visas',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(country_name), '')
FROM rayna_visas;

-- 7) Flights
INSERT INTO all_ids (phone_key, email_key, raw_phone, source, name, email, country)
SELECT
    CASE WHEN LENGTH(REGEXP_REPLACE(guest_contact,'[^0-9]','','g')) >= 7
         AND COALESCE(guest_contact,'') NOT IN ('0','00','000','0000000','00000000','.','')
         THEN RIGHT(REGEXP_REPLACE(guest_contact,'[^0-9]','','g'), 10) END,
    CASE WHEN TRIM(COALESCE(grnty_email,'')) != '' THEN LOWER(TRIM(grnty_email)) END,
    guest_contact, 'flights',
    NULLIF(TRIM(guest_name), ''),
    NULLIF(TRIM(grnty_email), ''),
    NULLIF(TRIM(nationality), '')
FROM rayna_flights;

-- Remove rows with neither phone nor email
DELETE FROM all_ids WHERE phone_key IS NULL AND email_key IS NULL;

-- Clean junk from profile fields
UPDATE all_ids SET name = NULL WHERE name IN (SELECT val FROM junk_vals);
UPDATE all_ids SET city = NULL WHERE city IN (SELECT val FROM junk_vals);
UPDATE all_ids SET company = NULL WHERE company IN (SELECT val FROM junk_vals);
UPDATE all_ids SET country = NULL WHERE country IN (SELECT val FROM junk_vals);
UPDATE all_ids SET state = NULL WHERE state IN (SELECT val FROM junk_vals);
UPDATE all_ids SET designation = NULL WHERE designation IN (SELECT val FROM junk_vals);

-- ═══════════════════════════════════════════════════════════
-- PASS 2: Phone-based customers
-- ═══════════════════════════════════════════════════════════

CREATE TEMP TABLE phone_customers AS
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY phone_key ORDER BY
            CASE source WHEN 'tickets' THEN 1 WHEN 'chats' THEN 2
                WHEN 'tours' THEN 3 WHEN 'hotels' THEN 4 WHEN 'visas' THEN 5 WHEN 'flights' THEN 6 END,
            (CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) DESC
    ) as rn
    FROM all_ids WHERE phone_key IS NOT NULL
)
SELECT phone_key, raw_phone, name, email, email_key, company, city, state, country, designation
FROM ranked WHERE rn = 1;

CREATE INDEX idx_pc_pk ON phone_customers(phone_key);

-- Fill missing email from other rows
UPDATE phone_customers pc SET email_key = sub.email_key, email = sub.email
FROM (
    SELECT DISTINCT ON (phone_key) phone_key, email_key, email
    FROM all_ids WHERE phone_key IS NOT NULL AND email_key IS NOT NULL
    ORDER BY phone_key, CASE source WHEN 'tickets' THEN 1 WHEN 'chats' THEN 2 ELSE 3 END
) sub WHERE pc.phone_key = sub.phone_key AND pc.email_key IS NULL;

-- Fill missing name
UPDATE phone_customers pc SET name = sub.name
FROM (SELECT DISTINCT ON (phone_key) phone_key, name FROM all_ids WHERE phone_key IS NOT NULL AND name IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.name IS NULL;

-- Fill missing company
UPDATE phone_customers pc SET company = sub.company
FROM (SELECT DISTINCT ON (phone_key) phone_key, company FROM all_ids WHERE phone_key IS NOT NULL AND company IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.company IS NULL;

-- Fill missing city
UPDATE phone_customers pc SET city = sub.city
FROM (SELECT DISTINCT ON (phone_key) phone_key, city FROM all_ids WHERE phone_key IS NOT NULL AND city IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.city IS NULL;

-- Fill missing state
UPDATE phone_customers pc SET state = sub.state
FROM (SELECT DISTINCT ON (phone_key) phone_key, state FROM all_ids WHERE phone_key IS NOT NULL AND state IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.state IS NULL;

-- Fill missing country
UPDATE phone_customers pc SET country = sub.country
FROM (SELECT DISTINCT ON (phone_key) phone_key, country FROM all_ids WHERE phone_key IS NOT NULL AND country IS NOT NULL ORDER BY phone_key) sub
WHERE pc.phone_key = sub.phone_key AND pc.country IS NULL;

-- Sources
CREATE TEMP TABLE phone_sources AS
SELECT phone_key, STRING_AGG(DISTINCT source, ', ' ORDER BY source) as sources
FROM all_ids WHERE phone_key IS NOT NULL GROUP BY phone_key;

-- Claimed emails
CREATE TEMP TABLE claimed_emails AS
SELECT DISTINCT email_key FROM phone_customers WHERE email_key IS NOT NULL;
CREATE INDEX idx_ce ON claimed_emails(email_key);

-- ═══════════════════════════════════════════════════════════
-- PASS 3: Email-only customers
-- ═══════════════════════════════════════════════════════════

CREATE TEMP TABLE email_customers AS
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY email_key ORDER BY
            CASE source WHEN 'tickets' THEN 1 WHEN 'tours' THEN 2
                WHEN 'hotels' THEN 3 WHEN 'visas' THEN 4 WHEN 'flights' THEN 5 END,
            (CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END +
             CASE WHEN city IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN country IS NOT NULL THEN 1 ELSE 0 END) DESC
    ) as rn
    FROM all_ids
    WHERE phone_key IS NULL AND email_key IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM claimed_emails ce WHERE ce.email_key = all_ids.email_key)
)
SELECT email_key, name, email, company, city, state, country, designation
FROM ranked WHERE rn = 1;

CREATE TEMP TABLE email_sources AS
SELECT email_key, STRING_AGG(DISTINCT source, ', ' ORDER BY source) as sources
FROM all_ids WHERE phone_key IS NULL AND email_key IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM claimed_emails ce WHERE ce.email_key = all_ids.email_key)
GROUP BY email_key;

-- Fill missing fields for email-only
UPDATE email_customers ec SET name = sub.name FROM (SELECT DISTINCT ON (email_key) email_key, name FROM all_ids WHERE phone_key IS NULL AND name IS NOT NULL ORDER BY email_key) sub WHERE ec.email_key = sub.email_key AND ec.name IS NULL;
UPDATE email_customers ec SET company = sub.company FROM (SELECT DISTINCT ON (email_key) email_key, company FROM all_ids WHERE phone_key IS NULL AND company IS NOT NULL ORDER BY email_key) sub WHERE ec.email_key = sub.email_key AND ec.company IS NULL;
UPDATE email_customers ec SET city = sub.city FROM (SELECT DISTINCT ON (email_key) email_key, city FROM all_ids WHERE phone_key IS NULL AND city IS NOT NULL ORDER BY email_key) sub WHERE ec.email_key = sub.email_key AND ec.city IS NULL;
UPDATE email_customers ec SET country = sub.country FROM (SELECT DISTINCT ON (email_key) email_key, country FROM all_ids WHERE phone_key IS NULL AND country IS NOT NULL ORDER BY email_key) sub WHERE ec.email_key = sub.email_key AND ec.country IS NULL;

-- ═══════════════════════════════════════════════════════════
-- PASS 4: Insert into customer_master
-- ═══════════════════════════════════════════════════════════

INSERT INTO customer_master (phone_key, email_key, phone, name, email, company_name, city, state, country, sources)
SELECT pc.phone_key, pc.email_key, pc.raw_phone, pc.name, pc.email, pc.company, pc.city, pc.state, pc.country, ps.sources
FROM phone_customers pc LEFT JOIN phone_sources ps ON ps.phone_key = pc.phone_key;

INSERT INTO customer_master (phone_key, email_key, phone, name, email, company_name, city, state, country, sources)
SELECT NULL, ec.email_key, NULL, ec.name, ec.email, ec.company, ec.city, ec.state, ec.country, es.sources
FROM email_customers ec LEFT JOIN email_sources es ON es.email_key = ec.email_key;

-- ═══════════════════════════════════════════════════════════
-- PASS 5: Activity counts (phone-only for phone, email-only for email-only)
-- ═══════════════════════════════════════════════════════════

CREATE INDEX idx_cm_phone_key ON customer_master(phone_key);
CREATE INDEX idx_cm_email_key ON customer_master(email_key);

-- 5a) Chats
WITH chat_agg AS (
    SELECT RIGHT(customer_no, 10) as phone_key,
        COUNT(*) as cnt, MIN(created_at) as first_at,
        MAX(GREATEST(last_msg, last_in, last_out, created_at)) as last_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as depts,
        MIN(first_message) as first_msg
    FROM mysql_chats WHERE customer_no IS NOT NULL AND LENGTH(customer_no) >= 7
    GROUP BY RIGHT(customer_no, 10)
)
UPDATE customer_master cm SET total_chats = ca.cnt, first_chat_at = ca.first_at,
    last_chat_at = ca.last_at, chat_departments = ca.depts, first_message = ca.first_msg
FROM chat_agg ca WHERE cm.phone_key = ca.phone_key;

-- 5b) First message text (from ongoing sync)
UPDATE customer_master cm SET first_msg_text = sub.msg
FROM (
    SELECT DISTINCT ON (RIGHT(customer_no, 10))
        RIGHT(customer_no, 10) as phone_key, first_msg_text as msg
    FROM mysql_chats WHERE first_msg_text IS NOT NULL AND customer_no IS NOT NULL
    ORDER BY RIGHT(customer_no, 10), created_at ASC
) sub WHERE cm.phone_key = sub.phone_key;

-- 5c) Tickets: phone for phone-customers, email for email-only
WITH ticket_phone AS (
    SELECT cm.id as cid, t.id as tid, t.updated_at, t.department_name
    FROM mysql_tickets t
    CROSS JOIN LATERAL (
      SELECT translate(t.contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'mobile' as mobile
    ) cs
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(COALESCE(cs.mobile,''),'[^0-9]','','g'), 10)
    WHERE cm.phone_key IS NOT NULL AND cs.mobile IS NOT NULL
      AND LENGTH(REGEXP_REPLACE(cs.mobile,'[^0-9]','','g')) >= 7
      AND t.contact_status ~ '^\{"contacts"'
      AND t.contact_status NOT LIKE '%\u0000%'
      AND octet_length(t.contact_status) = length(t.contact_status)
),
ticket_email AS (
    SELECT cm.id as cid, t.id as tid, t.updated_at, t.department_name
    FROM mysql_tickets t
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(COALESCE(
      CASE WHEN t.contact_status ~ '^\{"contacts"' AND t.contact_status NOT LIKE '%\u0000%' AND octet_length(t.contact_status) = length(t.contact_status)
           THEN translate(t.contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'email' END,
      t.t_from)))
    WHERE cm.phone_key IS NULL
      AND COALESCE(
        CASE WHEN t.contact_status ~ '^\{"contacts"' AND t.contact_status NOT LIKE '%\u0000%' AND octet_length(t.contact_status) = length(t.contact_status)
             THEN translate(t.contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'email' END,
        t.t_from) IS NOT NULL
      AND TRIM(COALESCE(
        CASE WHEN t.contact_status ~ '^\{"contacts"' AND t.contact_status NOT LIKE '%\u0000%' AND octet_length(t.contact_status) = length(t.contact_status)
             THEN translate(t.contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'email' END,
        t.t_from)) != ''
      AND COALESCE(
        CASE WHEN t.contact_status ~ '^\{"contacts"' AND t.contact_status NOT LIKE '%\u0000%' AND octet_length(t.contact_status) = length(t.contact_status)
             THEN translate(t.contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'email' END,
        t.t_from) NOT LIKE '%raynatours.com%'
      AND COALESCE(
        CASE WHEN t.contact_status ~ '^\{"contacts"' AND t.contact_status NOT LIKE '%\u0000%' AND octet_length(t.contact_status) = length(t.contact_status)
             THEN translate(t.contact_status, E'\r\n\t', '   ')::jsonb->'contacts'->0->>'email' END,
        t.t_from) NOT LIKE '%raynab2b.com%'
),
ticket_agg AS (
    SELECT cid, COUNT(DISTINCT tid) as cnt, MIN(updated_at) as first_at, MAX(updated_at) as last_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as depts
    FROM (SELECT * FROM ticket_phone UNION ALL SELECT * FROM ticket_email) x GROUP BY cid
)
UPDATE customer_master cm SET total_tickets = ta.cnt, first_ticket_at = ta.first_at,
    last_ticket_at = ta.last_at, ticket_departments = ta.depts
FROM ticket_agg ta WHERE cm.id = ta.cid;

-- 5d) Tours
WITH tour_phone AS (
    SELECT cm.id as cid, t.id as tid, t.total_sell, t.bill_date FROM rayna_tours t
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(t.guest_contact,'[^0-9]','','g'), 10)
    WHERE cm.phone_key IS NOT NULL AND t.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(t.guest_contact,'[^0-9]','','g')) >= 7
),
tour_email AS (
    SELECT cm.id as cid, t.id as tid, t.total_sell, t.bill_date FROM rayna_tours t
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(t.grnty_email))
    WHERE cm.phone_key IS NULL AND t.grnty_email IS NOT NULL AND TRIM(t.grnty_email) != ''
),
tour_agg AS (
    SELECT cid, COUNT(DISTINCT tid) as cnt, SUM(total_sell) as rev, MIN(bill_date) as f, MAX(bill_date) as l
    FROM (SELECT * FROM tour_phone UNION ALL SELECT * FROM tour_email) x GROUP BY cid
)
UPDATE customer_master cm SET total_tour_bookings = ta.cnt,
    total_booking_revenue = COALESCE(ta.rev, 0), first_booking_at = ta.f, last_booking_at = ta.l
FROM tour_agg ta WHERE cm.id = ta.cid;

-- 5e) Hotels
WITH h_phone AS (
    SELECT cm.id as cid, h.id as hid, h.total_sell, h.bill_date FROM rayna_hotels h
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(h.guest_contact,'[^0-9]','','g'), 10)
    WHERE cm.phone_key IS NOT NULL AND h.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(h.guest_contact,'[^0-9]','','g')) >= 7
),
h_email AS (
    SELECT cm.id as cid, h.id as hid, h.total_sell, h.bill_date FROM rayna_hotels h
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(h.grnty_email))
    WHERE cm.phone_key IS NULL AND h.grnty_email IS NOT NULL AND TRIM(h.grnty_email) != ''
),
h_agg AS (SELECT cid, COUNT(DISTINCT hid) as cnt, SUM(total_sell) as rev, MIN(bill_date) as f, MAX(bill_date) as l
    FROM (SELECT * FROM h_phone UNION ALL SELECT * FROM h_email) x GROUP BY cid)
UPDATE customer_master cm SET total_hotel_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.f), last_booking_at = GREATEST(cm.last_booking_at, a.l)
FROM h_agg a WHERE cm.id = a.cid;

-- 5f) Visas
WITH v_phone AS (
    SELECT cm.id as cid, v.id as vid, v.total_sell, v.bill_date FROM rayna_visas v
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(v.guest_contact,'[^0-9]','','g'), 10)
    WHERE cm.phone_key IS NOT NULL AND v.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(v.guest_contact,'[^0-9]','','g')) >= 7
),
v_email AS (
    SELECT cm.id as cid, v.id as vid, v.total_sell, v.bill_date FROM rayna_visas v
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(v.grnty_email))
    WHERE cm.phone_key IS NULL AND v.grnty_email IS NOT NULL AND TRIM(v.grnty_email) != ''
),
v_agg AS (SELECT cid, COUNT(DISTINCT vid) as cnt, SUM(total_sell) as rev, MIN(bill_date) as f, MAX(bill_date) as l
    FROM (SELECT * FROM v_phone UNION ALL SELECT * FROM v_email) x GROUP BY cid)
UPDATE customer_master cm SET total_visa_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.f), last_booking_at = GREATEST(cm.last_booking_at, a.l)
FROM v_agg a WHERE cm.id = a.cid;

-- 5g) Flights
WITH f_phone AS (
    SELECT cm.id as cid, f.id as fid, f.selling_price, f.bill_date FROM rayna_flights f
    JOIN customer_master cm ON cm.phone_key = RIGHT(REGEXP_REPLACE(f.guest_contact,'[^0-9]','','g'), 10)
    WHERE cm.phone_key IS NOT NULL AND f.guest_contact IS NOT NULL AND LENGTH(REGEXP_REPLACE(f.guest_contact,'[^0-9]','','g')) >= 7
),
f_email AS (
    SELECT cm.id as cid, f.id as fid, f.selling_price, f.bill_date FROM rayna_flights f
    JOIN customer_master cm ON cm.email_key = LOWER(TRIM(f.grnty_email))
    WHERE cm.phone_key IS NULL AND f.grnty_email IS NOT NULL AND TRIM(f.grnty_email) != ''
),
f_agg AS (SELECT cid, COUNT(DISTINCT fid) as cnt, SUM(selling_price) as rev, MIN(bill_date) as f, MAX(bill_date) as l
    FROM (SELECT * FROM f_phone UNION ALL SELECT * FROM f_email) x GROUP BY cid)
UPDATE customer_master cm SET total_flight_bookings = a.cnt,
    total_booking_revenue = cm.total_booking_revenue + COALESCE(a.rev, 0),
    first_booking_at = LEAST(cm.first_booking_at, a.f), last_booking_at = GREATEST(cm.last_booking_at, a.l)
FROM f_agg a WHERE cm.id = a.cid;

-- ═══════════════════════════════════════════════════════════
-- PASS 6: Unified fields + indexes
-- ═══════════════════════════════════════════════════════════

UPDATE customer_master SET
    all_departments = NULLIF(CONCAT_WS(', ', NULLIF(chat_departments,''), NULLIF(ticket_departments,'')), ''),
    first_seen_at = LEAST(first_chat_at, first_ticket_at, first_booking_at, first_message),
    last_seen_at = GREATEST(last_chat_at, last_ticket_at, last_booking_at),
    updated_at = NOW();

CREATE INDEX idx_cm_name ON customer_master(name);
CREATE INDEX idx_cm_phone ON customer_master(phone);
CREATE INDEX idx_cm_email ON customer_master(LOWER(email));
CREATE INDEX idx_cm_country ON customer_master(country);
CREATE INDEX idx_cm_last_seen ON customer_master(last_seen_at);
CREATE UNIQUE INDEX idx_cm_phone_key_uniq ON customer_master(phone_key) WHERE phone_key IS NOT NULL;

DROP TABLE IF EXISTS all_ids, phone_customers, phone_sources, claimed_emails, email_customers, email_sources, junk_vals;

COMMIT;
