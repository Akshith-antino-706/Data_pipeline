-- ═══════════════════════════════════════════════════════════
-- Migration 016: MySQL Sync Target Tables
-- Creates PostgreSQL tables to receive data from remote MySQL
-- Tables: tickets, travel_data, contacts
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Tickets (267K rows in source) ─────────────────────────
CREATE TABLE IF NOT EXISTS mysql_tickets (
    id               INTEGER PRIMARY KEY,
    dt               INTEGER NOT NULL,
    uid              VARCHAR(10),
    sno              VARCHAR(10),
    unique_id        TEXT,
    foreign_id       INTEGER,
    t_from           VARCHAR(100) NOT NULL,
    from_name        VARCHAR(75),
    t_to             VARCHAR(150),
    cc               TEXT,
    bcc              TEXT,
    assoc            TEXT,
    subject          VARCHAR(150) NOT NULL,
    body             TEXT,
    extra            TEXT,
    produc           VARCHAR(30),
    pex              INTEGER DEFAULT 0,
    channel          INTEGER DEFAULT 0,
    time             VARCHAR(40),
    status           INTEGER NOT NULL,
    bill             VARCHAR(50),
    bill_total       VARCHAR(11),
    bill_currency    VARCHAR(5),
    contact_status   TEXT,
    assign_to        INTEGER NOT NULL,
    assign_time      TIMESTAMPTZ,
    aid              INTEGER,
    due              TIMESTAMPTZ,
    travel           TIMESTAMPTZ,
    priority         INTEGER NOT NULL DEFAULT 1,
    attach           TEXT,
    seen             INTEGER NOT NULL DEFAULT 0,
    th               INTEGER NOT NULL DEFAULT 1,
    last_th          TIMESTAMPTZ,
    last_out         TIMESTAMPTZ,
    spam             INTEGER NOT NULL DEFAULT 0,
    confirm_time     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mysql_tickets_dt ON mysql_tickets(dt);
CREATE INDEX IF NOT EXISTS idx_mysql_tickets_updated_at ON mysql_tickets(updated_at);

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

-- ── Contacts (1.1M rows in source) ────────────────────────
CREATE TABLE IF NOT EXISTS mysql_contacts (
    id               INTEGER PRIMARY KEY,
    foreign_id       INTEGER,
    type             VARCHAR(10),
    contact_type     VARCHAR(20) NOT NULL,
    source_id        INTEGER,
    subsource_id     INTEGER DEFAULT 0,
    source_type      VARCHAR(50),
    source_person    INTEGER,
    name             VARCHAR(75),
    company_name     VARCHAR(75),
    designation      VARCHAR(75),
    dob              VARCHAR(20),
    email            VARCHAR(100),
    email2           TEXT,
    pcode            VARCHAR(6),
    mobile           VARCHAR(20),
    mobile2          TEXT,
    phone            VARCHAR(20),
    phone2           TEXT,
    website          VARCHAR(100),
    city             VARCHAR(20),
    cstate           VARCHAR(20),
    country_id       INTEGER,
    country_name     VARCHAR(20),
    pincode          VARCHAR(20),
    address_line1    TEXT,
    address_line2    TEXT,
    hotel_name       VARCHAR(75),
    hotel_category   VARCHAR(20),
    agent_code       VARCHAR(15),
    registration_date TIMESTAMPTZ,
    authorize_status VARCHAR(15),
    authorize_employee VARCHAR(15),
    added_by         INTEGER,
    status           SMALLINT NOT NULL DEFAULT 0,
    rte              SMALLINT NOT NULL DEFAULT 1,
    rtc              SMALLINT NOT NULL,
    rts              SMALLINT NOT NULL,
    opn              INTEGER NOT NULL DEFAULT 0,
    contact_status   VARCHAR(20) NOT NULL DEFAULT 'new',
    calls            INTEGER NOT NULL DEFAULT 0,
    qe               INTEGER NOT NULL DEFAULT 0,
    n_queries        INTEGER,
    l_query          DATE,
    n_bookings       INTEGER,
    l_booking        DATE,
    registered       SMALLINT DEFAULT 0,
    priority         SMALLINT NOT NULL,
    assign_to        INTEGER DEFAULT 0,
    booking_date     TIMESTAMPTZ,
    traveld          INTEGER DEFAULT 0,
    traveld_name     VARCHAR(50),
    traveld_exp      TIMESTAMPTZ,
    s_bounce         VARCHAR(4) DEFAULT '0',
    h_bounce         VARCHAR(4) DEFAULT '0',
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mysql_contacts_source_id ON mysql_contacts(source_id);
CREATE INDEX IF NOT EXISTS idx_mysql_contacts_assign_to ON mysql_contacts(assign_to);
CREATE INDEX IF NOT EXISTS idx_mysql_contacts_l_booking ON mysql_contacts(l_booking);
CREATE INDEX IF NOT EXISTS idx_mysql_contacts_updated_at ON mysql_contacts(updated_at);

-- ── Chats (from second MySQL server — 406K rows in source) ─
CREATE TABLE IF NOT EXISTS mysql_chats (
    id               INTEGER PRIMARY KEY,
    wa_id            VARCHAR(20) NOT NULL,
    wa_name          VARCHAR(25),
    email            VARCHAR(100),
    country          VARCHAR(50),
    receiver         VARCHAR(20) NOT NULL,
    assign_to        INTEGER NOT NULL DEFAULT 0,
    boat             INTEGER,
    status           INTEGER NOT NULL,
    priority         INTEGER NOT NULL DEFAULT 4,
    tags             VARCHAR(510),
    fv               INTEGER NOT NULL DEFAULT 0,
    last_in          TIMESTAMPTZ,
    last_out         TIMESTAMPTZ,
    last_msg         TIMESTAMPTZ,
    last_short       VARCHAR(60),
    seen             INTEGER NOT NULL DEFAULT 1,
    spam             INTEGER NOT NULL DEFAULT 0,
    last_packed      VARCHAR(15) NOT NULL DEFAULT '0',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mysql_chats_receiver ON mysql_chats(receiver);
CREATE INDEX IF NOT EXISTS idx_mysql_chats_assign_to ON mysql_chats(assign_to);
CREATE INDEX IF NOT EXISTS idx_mysql_chats_status ON mysql_chats(status);
CREATE INDEX IF NOT EXISTS idx_mysql_chats_last_msg ON mysql_chats(last_msg);
CREATE INDEX IF NOT EXISTS idx_mysql_chats_created_at ON mysql_chats(created_at);

COMMIT;
