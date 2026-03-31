-- 024: Rayna External API Sync Tables (Tours, Hotels, Visas, Flights)
-- Source: http://raynaacico.dyndns.tv:8091/{tours,hotel,visa,flight}-sync

-- ── Tours ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rayna_tours (
  id              SERIAL PRIMARY KEY,
  billno          TEXT NOT NULL,
  bill_date       TIMESTAMPTZ,
  tour_date       TIMESTAMPTZ,
  modified_date   TIMESTAMPTZ,
  guest_name      TEXT,
  guest_contact   TEXT,
  nationality     TEXT,
  country_name    TEXT,
  agent_name      TEXT,
  group_name      TEXT,
  tours_name      TEXT,
  profit_center   TEXT,
  grnty_email     TEXT,
  status          TEXT,
  adult           INTEGER DEFAULT 0,
  child           INTEGER DEFAULT 0,
  infant          INTEGER DEFAULT 0,
  total_sell      NUMERIC(12,2) DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(billno, tours_name, tour_date)
);

CREATE INDEX IF NOT EXISTS idx_rayna_tours_billno ON rayna_tours(billno);
CREATE INDEX IF NOT EXISTS idx_rayna_tours_bill_date ON rayna_tours(bill_date);
CREATE INDEX IF NOT EXISTS idx_rayna_tours_guest ON rayna_tours(guest_name);
CREATE INDEX IF NOT EXISTS idx_rayna_tours_modified ON rayna_tours(modified_date);

-- ── Hotels ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rayna_hotels (
  id              SERIAL PRIMARY KEY,
  billno          TEXT NOT NULL,
  bill_date       TIMESTAMPTZ,
  check_in_date   TIMESTAMPTZ,
  modified_date   TIMESTAMPTZ,
  guest_name      TEXT,
  guest_contact   TEXT,
  country_name    TEXT,
  agent_name      TEXT,
  hotel_name      TEXT,
  profit_center   TEXT,
  grnty_email     TEXT,
  no_of_rooms     INTEGER DEFAULT 1,
  total_sell      NUMERIC(12,2) DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(billno, hotel_name, check_in_date)
);

CREATE INDEX IF NOT EXISTS idx_rayna_hotels_billno ON rayna_hotels(billno);
CREATE INDEX IF NOT EXISTS idx_rayna_hotels_bill_date ON rayna_hotels(bill_date);
CREATE INDEX IF NOT EXISTS idx_rayna_hotels_guest ON rayna_hotels(guest_name);

-- ── Visas ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rayna_visas (
  id              SERIAL PRIMARY KEY,
  billno          TEXT NOT NULL,
  bill_date       TIMESTAMPTZ,
  modified_date   TIMESTAMPTZ,
  guest_name      TEXT,
  guest_contact   TEXT,
  nationality     TEXT,
  country_name    TEXT,
  agent_name      TEXT,
  visa_type       TEXT NOT NULL DEFAULT 'UNKNOWN',
  profit_center   TEXT,
  grnty_email     TEXT,
  status          TEXT,
  total_sell      NUMERIC(12,2) DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(billno, guest_name, visa_type)
);

CREATE INDEX IF NOT EXISTS idx_rayna_visas_billno ON rayna_visas(billno);
CREATE INDEX IF NOT EXISTS idx_rayna_visas_bill_date ON rayna_visas(bill_date);

-- ── Flights ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rayna_flights (
  id              SERIAL PRIMARY KEY,
  billno          TEXT NOT NULL,
  bill_date       TIMESTAMPTZ,
  modified_date   TIMESTAMPTZ,
  guest_name      TEXT,
  guest_contact   TEXT,
  passenger_name  TEXT,
  nationality     TEXT,
  agent_name      TEXT,
  airport_name    TEXT,
  flight_no       TEXT,
  from_datetime   TIMESTAMPTZ,
  profit_center   TEXT,
  grnty_email     TEXT,
  status          TEXT,
  selling_price   NUMERIC(12,2) DEFAULT 0,
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(billno, passenger_name, flight_no)
);

CREATE INDEX IF NOT EXISTS idx_rayna_flights_billno ON rayna_flights(billno);
CREATE INDEX IF NOT EXISTS idx_rayna_flights_bill_date ON rayna_flights(bill_date);
CREATE INDEX IF NOT EXISTS idx_rayna_flights_guest ON rayna_flights(guest_name);
