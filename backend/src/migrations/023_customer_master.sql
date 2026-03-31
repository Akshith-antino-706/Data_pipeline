-- ═══════════════════════════════════════════════════════════
-- Migration 023: Customer Master Table
-- Base: mysql_chats (unique customers by customer_no)
-- LEFT JOIN contacts (last 10 digits phone match + email)
-- LEFT JOIN tickets (by email)
-- ═══════════════════════════════════════════════════════════

BEGIN;

DROP TABLE IF EXISTS customer_master CASCADE;

CREATE TABLE customer_master (
    id                  SERIAL PRIMARY KEY,
    customer_no         VARCHAR(20),
    name                VARCHAR(75),
    email               VARCHAR(100),
    phone               VARCHAR(20),
    company_name        VARCHAR(75),
    city                VARCHAR(20),
    state               VARCHAR(20),
    country             VARCHAR(50),
    dob                 VARCHAR(20),
    contact_type        VARCHAR(20),
    contact_id          INTEGER,
    total_chats         INTEGER DEFAULT 0,
    first_chat_at       TIMESTAMPTZ,
    last_chat_at        TIMESTAMPTZ,
    chat_departments    TEXT,
    total_tickets       INTEGER DEFAULT 0,
    first_ticket_at     TIMESTAMPTZ,
    last_ticket_at      TIMESTAMPTZ,
    ticket_departments  TEXT,
    all_departments     TEXT,
    first_seen_at       TIMESTAMPTZ,
    last_seen_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

WITH
-- Base: unique chat customers
chat_base AS (
    SELECT
        customer_no,
        MIN(wa_name) as wa_name,
        MIN(NULLIF(TRIM(email), '')) as email,
        MIN(country) as country,
        COUNT(*) as total_chats,
        MIN(created_at) as first_chat_at,
        MAX(created_at) as last_chat_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as chat_departments
    FROM mysql_chats
    GROUP BY customer_no
),
-- Deduplicated contacts by email
contacts_by_email AS (
    SELECT DISTINCT ON (LOWER(TRIM(email)))
        id, name, email, NULLIF(TRIM(mobile), '') as mobile,
        company_name, city, cstate, dob, contact_type
    FROM mysql_contacts
    WHERE email IS NOT NULL AND TRIM(email) != ''
    ORDER BY LOWER(TRIM(email)), id
),
-- Deduplicated contacts by last 10 digits of phone
contacts_by_phone AS (
    SELECT DISTINCT ON (RIGHT(TRIM(mobile), 10))
        id, name, NULLIF(TRIM(email), '') as email, TRIM(mobile) as mobile,
        company_name, city, cstate, dob, contact_type,
        RIGHT(TRIM(mobile), 10) as phone_key
    FROM mysql_contacts
    WHERE mobile IS NOT NULL AND TRIM(mobile) != ''
      AND LENGTH(TRIM(mobile)) >= 7
      AND TRIM(mobile) NOT IN ('0', '00', '000', '0000000000', 'na', 'NA')
    ORDER BY RIGHT(TRIM(mobile), 10), id
),
-- Pre-aggregated tickets by email
ticket_agg AS (
    SELECT
        LOWER(TRIM(t_from)) as email,
        COUNT(*) as total_tickets,
        MIN(updated_at) as first_ticket_at,
        MAX(updated_at) as last_ticket_at,
        STRING_AGG(DISTINCT department_name, ', ' ORDER BY department_name) as ticket_departments
    FROM mysql_tickets
    WHERE t_from IS NOT NULL AND TRIM(t_from) != ''
    GROUP BY LOWER(TRIM(t_from))
)

INSERT INTO customer_master (
    customer_no, name, email, phone, company_name, city, state, country,
    dob, contact_type, contact_id,
    total_chats, first_chat_at, last_chat_at, chat_departments,
    total_tickets, first_ticket_at, last_ticket_at, ticket_departments,
    all_departments, first_seen_at, last_seen_at
)
SELECT
    cb.customer_no,
    COALESCE(ce.name, cp.name, cb.wa_name),
    COALESCE(cb.email, ce.email, cp.email),
    cb.customer_no,
    COALESCE(ce.company_name, cp.company_name),
    COALESCE(ce.city, cp.city),
    COALESCE(ce.cstate, cp.cstate),
    cb.country,
    COALESCE(ce.dob, cp.dob),
    COALESCE(ce.contact_type, cp.contact_type),
    COALESCE(ce.id, cp.id),

    cb.total_chats,
    cb.first_chat_at,
    cb.last_chat_at,
    cb.chat_departments,

    COALESCE(ta.total_tickets, 0),
    ta.first_ticket_at,
    ta.last_ticket_at,
    ta.ticket_departments,

    NULLIF(CONCAT_WS(', ',
        NULLIF(cb.chat_departments, ''),
        NULLIF(ta.ticket_departments, '')
    ), ''),
    LEAST(cb.first_chat_at, ta.first_ticket_at),
    GREATEST(cb.last_chat_at, ta.last_ticket_at)

FROM chat_base cb

-- LEFT JOIN: contact by email
LEFT JOIN contacts_by_email ce
    ON cb.email IS NOT NULL
    AND LOWER(cb.email) = LOWER(TRIM(ce.email))

-- LEFT JOIN: contact by phone last 10 digits (fallback when no email match)
LEFT JOIN contacts_by_phone cp
    ON ce.id IS NULL
    AND RIGHT(cb.customer_no, 10) = cp.phone_key

-- LEFT JOIN: tickets by email (from chat email or contact email)
LEFT JOIN ticket_agg ta
    ON COALESCE(cb.email, ce.email, cp.email) IS NOT NULL
    AND ta.email = LOWER(TRIM(COALESCE(cb.email, ce.email, cp.email)));

-- Indexes
CREATE INDEX idx_cm_customer_no ON customer_master(customer_no);
CREATE INDEX idx_cm_email ON customer_master(email);
CREATE INDEX idx_cm_phone ON customer_master(phone);
CREATE INDEX idx_cm_contact_id ON customer_master(contact_id);
CREATE INDEX idx_cm_last_seen ON customer_master(last_seen_at);

COMMIT;
