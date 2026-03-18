-- =============================================================
-- Migration 002: Channels lookup table
-- Maps WhatsApp phone numbers to department names
-- Connection values verified against actual chats.receiver data
-- =============================================================

BEGIN;

DROP TABLE IF EXISTS channels CASCADE;

CREATE TABLE channels (
    id          SERIAL          PRIMARY KEY,
    type        TEXT            NOT NULL,
    connection  TEXT            NOT NULL,
    name        TEXT            NOT NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ── Exact matches (11-digit landline numbers from CSV that exist in DB) ──
INSERT INTO channels (type, connection, name) VALUES
  ('whatsapp', '97142087556',   'B2B UAE Marketing'),
  ('whatsapp', '97142087511',   'Corporate Sales'),
  ('whatsapp', '97142087458',   'Chat Head Support'),
  ('whatsapp', '97142087491',   'RaynaTours Yacht Sales'),
  ('whatsapp', '97142087112',   'Customer Support'),
  ('whatsapp', '97142087188',   'Corporate Marketing'),
  ('whatsapp', '97142087223',   'Balloon Flights Sales'),
  ('whatsapp', '97142087471',   'Deep Sea Adventure'),
  ('whatsapp', '97142087423',   'Drive The Thrill Sales'),
  ('whatsapp', '97142087245',   'TopUp Support'),
  ('whatsapp', '97142087557',   'B2B UAE Sales'),
  ('whatsapp', '97142087113',   'Guest Experience'),
  ('whatsapp', '97142087405',   'Online Travel Portal'),
  ('whatsapp', '97142087151',   'B2C Outbound Sales'),
  ('whatsapp', '97126263304',   'Abu Dhabi Sales'),
  ('whatsapp', '97142087545',   'Micro Web. Int. Visa'),
  ('whatsapp', '97142087568',   'Travel Desk Support'),
  ('whatsapp', '97142087560',   'To and Fro Support'),
  ('whatsapp', '97142087591',   'Safari Coordination'),
  ('whatsapp', '97142087445',   'Dubai Visa Sales'),
  ('whatsapp', '97142087260',   'SEA Thailand UAE'),
  ('whatsapp', '97142087261',   'SEA Vietnam UAE'),
  ('whatsapp', '97142087262',   'SEA Indonesia UAE'),
  ('whatsapp', '97142087477',   'SEA UAE'),
  ('whatsapp', '97142087549',   'B2B UAE Seacation'),

  -- ── Mobile numbers: scientific notation resolved against DB ──
  -- CSV had 9.71562E+11 → DB has 971562754248
  ('whatsapp', '971562754248',  'Int. Visa - UAE Sales / B2C Marketing'),
  -- CSV had 9.71506E+11 → DB has 971506153614
  ('whatsapp', '971506153614',  'Seacation Marketing'),
  -- CSV had 9.71503E+11 → DB has 971503385341
  ('whatsapp', '971503385341',  'Seacation Sales'),
  -- CSV had 9.18484E+11 → DB has 918484030717
  ('whatsapp', '918484030717',  'Int. Visa - India Sales'),
  -- CSV had 9.71565E+11 → DB has 971565481752
  ('whatsapp', '971565481752',  'B2C Sales'),
  -- CSV had 9.19561E+11 → DB has 919561018777
  ('whatsapp', '919561018777',  'B2C Holidays From India'),
  -- CSV had 9.66568E+11 → DB has 966565813998 (closest match for Saudi)
  ('whatsapp', '966565813998',  'Saudi Arabia Sales'),
  -- CSV had 9.66566E+11 → DB has 966567513998
  ('whatsapp', '966567513998',  'B2C KSA'),
  -- CSV had 9.71567E+11 → DB has 971566893137
  ('whatsapp', '971566893137',  'B2C Events & Concerts'),
  -- CSV had 9.71505E+11 → DB has 971504708595
  ('whatsapp', '971504708595',  'B2C Outbound Marketing'),

  -- ── 971561 prefix: two DB numbers, map to known CSV entries ──
  -- CSV had 9.71562E+11 for B2C Marketing but 971561 numbers also exist
  ('whatsapp', '971561793788',  'Rayna Tours Holidays'),
  ('whatsapp', '971561794005',  'Rayna Properties Marketing'),

  -- ── India 912066 numbers: CSV had 9.12067E+11 (multiple depts share this) ──
  -- Multiple India departments routed through these numbers
  ('whatsapp', '912066838833',  'B2B India Marketing'),
  ('whatsapp', '912066838834',  'B2B India Sales'),
  ('whatsapp', '912066838835',  'Rayna Holidays From India'),
  ('whatsapp', '912066838851',  'SEA India'),
  ('whatsapp', '912066838852',  'SEA Thailand'),
  ('whatsapp', '912066838811',  'Costa Cruise India'),
  ('whatsapp', '912066838823',  'B2C Domestic Support');

-- ── Also store channels from CSV that don't have active chats (for reference) ──
INSERT INTO channels (type, connection, name) VALUES
  ('whatsapp', '97142087255',   'Rayna Social Media Support'),
  ('whatsapp', '97142087277',   'Seacation Sales (Landline)'),
  ('whatsapp', '97142087404',   'Rayna B2B Africa Sales'),
  ('whatsapp', '97142087172',   'Rayna Arabia Marketing'),
  ('whatsapp', '97142087595',   'Rayna Events'),
  ('whatsapp', '97142087454',   'TD Corporate Support'),
  ('whatsapp', '97142087187',   'Corporate - Int. Visa'),
  ('whatsapp', '97142087588',   'Concierge4u Support'),
  ('whatsapp', '97142087235',   'B2B Visa Sales'),
  ('whatsapp', '97142087246',   'Digital Concierge'),
  ('whatsapp', '97142087466',   'Desert Safari Dubai'),
  ('whatsapp', '97142087567',   'Travel Concierge Support'),
  ('whatsapp', '97172281534',   'RAK Sales Support'),
  ('whatsapp', '97180086877',   'VIP Concierge Desk'),
  ('whatsapp', '97142087580',   'Rayna Middle East & Turkey'),
  ('whatsapp', '97142087574',   'Saudi Inbound Support'),
  ('whatsapp', '97142087590',   'B2B UAE Dutch Oriental'),
  ('whatsapp', '97142087457',   'Cloud Api'),
  ('whatsapp', '97142087433',   'B2C Sales Support');

-- ── Indexes ───────────────────────────────────────────────────
CREATE UNIQUE INDEX idx_channels_uniq ON channels (type, connection, name);
CREATE INDEX idx_channels_lookup ON channels (type, connection);

COMMIT;
