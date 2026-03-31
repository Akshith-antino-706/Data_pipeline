-- ═══════════════════════════════════════════════════════════
-- Migration 021: Fresh MySQL Sync Tables (Clean Slate)
-- Drops ALL old mysql_* tables and recreates with only
-- the columns requested: contacts, tickets, chats, departments
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Drop old tables ─────────────────────────────────────────
DROP TABLE IF EXISTS mysql_tickets CASCADE;
DROP TABLE IF EXISTS mysql_travel_data CASCADE;
DROP TABLE IF EXISTS mysql_contacts CASCADE;
DROP TABLE IF EXISTS mysql_chats CASCADE;
DROP TABLE IF EXISTS mysql_departments CASCADE;

-- Clean up old sync metadata
DELETE FROM sync_metadata WHERE table_name IN (
  'mysql_tickets', 'mysql_travel_data', 'mysql_contacts', 'mysql_chats', 'mysql_departments'
);

-- ── Contacts ────────────────────────────────────────────────
-- Source: primary MySQL (95.211.169.194) → contacts table
CREATE TABLE mysql_contacts (
    id               INTEGER PRIMARY KEY,
    contact_type     VARCHAR(20),
    source_type      VARCHAR(50),
    name             VARCHAR(75),
    company_name     VARCHAR(75),
    email            VARCHAR(100),
    dob              VARCHAR(20),
    mobile           VARCHAR(20),
    city             VARCHAR(20),
    cstate           VARCHAR(20),
    updated_at       TIMESTAMPTZ
);

CREATE INDEX idx_mysql_contacts_email ON mysql_contacts(email);
CREATE INDEX idx_mysql_contacts_updated_at ON mysql_contacts(updated_at);

-- ── Tickets ─────────────────────────────────────────────────
-- Source: primary MySQL (95.211.169.194) → tickets table
CREATE TABLE mysql_tickets (
    id               INTEGER PRIMARY KEY,
    t_to             VARCHAR(150),
    t_from           VARCHAR(100),
    from_name        VARCHAR(75),
    subject          VARCHAR(150),
    time             VARCHAR(40),
    updated_at       TIMESTAMPTZ
);

CREATE INDEX idx_mysql_tickets_updated_at ON mysql_tickets(updated_at);

-- ── Chats ───────────────────────────────────────────────────
-- Source: chats MySQL (5.79.64.193) → chats table
CREATE TABLE mysql_chats (
    id               INTEGER PRIMARY KEY,
    wa_id            VARCHAR(20),
    wa_name          VARCHAR(25),
    email            VARCHAR(100),
    country          VARCHAR(50),
    receiver         VARCHAR(20),
    tags             VARCHAR(510),
    first_message    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ
);

CREATE INDEX idx_mysql_chats_wa_id ON mysql_chats(wa_id);
CREATE INDEX idx_mysql_chats_created_at ON mysql_chats(created_at);

-- ── Departments ─────────────────────────────────────────────
-- Source: chats MySQL (5.79.64.193) → departments table
CREATE TABLE mysql_departments (
    id               INTEGER PRIMARY KEY,
    connection       VARCHAR(250),
    name             VARCHAR(95),
    description      TEXT,
    email_id         TEXT,
    created_at       TIMESTAMPTZ
);

-- ── Department Emails ────────────────────────────────────
-- Source: primary MySQL (95.211.169.194) → department_emails + departments joined
-- Note: department IDs differ between the two MySQL servers,
-- so this stores the primary server's department names alongside emails
DROP TABLE IF EXISTS mysql_department_emails CASCADE;
CREATE TABLE mysql_department_emails (
    id               INTEGER PRIMARY KEY,
    did              INTEGER,
    dept_name        VARCHAR(100),
    email            VARCHAR(100),
    status           INTEGER,
    UNIQUE(did, email)
);

CREATE INDEX idx_dept_emails_did ON mysql_department_emails(did);

COMMIT;
