-- ═══════════════════════════════════════════════════════════
-- Migration 021: Fresh MySQL Sync Tables (Clean Slate)
-- Drops ALL old mysql_* tables and recreates with only
-- the columns requested: departments, department emails
-- (contacts/tickets/chats tables removed 2026-11-11 — never populated)
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Drop old tables ─────────────────────────────────────────
DROP TABLE IF EXISTS mysql_travel_data CASCADE;
DROP TABLE IF EXISTS mysql_departments CASCADE;

-- Clean up old sync metadata
DELETE FROM sync_metadata WHERE table_name IN ('mysql_travel_data', 'mysql_departments');

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
