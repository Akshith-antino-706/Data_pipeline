-- ═══════════════════════════════════════════════════════════
-- Migration 016: MySQL Sync Target Tables
-- Creates PostgreSQL tables to receive data from remote MySQL
-- Tables: travel_data (tickets/contacts/chats tables removed 2026-11-11 — never populated)
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Travel Data (2.1M rows in source) ─────────────────────
CREATE TABLE IF NOT EXISTS mysql_travel_data (
    id               INTEGER PRIMARY KEY,
    bill_serial      BIGINT NOT NULL,
    bill_number      BIGINT NOT NULL,
    bill_type        VARCHAR(50),
    service_name     TEXT,
    guest_name       VARCHAR(50),
    nationality      VARCHAR(30),
    contact          VARCHAR(70),
    email            VARCHAR(50) NOT NULL,
    age              VARCHAR(10),
    business_provider VARCHAR(70),
    start_date       DATE,
    last_date        DATE,
    bill_made_by     VARCHAR(25),
    added_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    type             VARCHAR(10),
    sent             INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mysql_travel_data_added_date ON mysql_travel_data(added_date);

COMMIT;
