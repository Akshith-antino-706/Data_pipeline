-- WhatsApp (ChatHead) infrastructure — Phase 1.
--
-- Fully ADDITIVE + ISOLATED: three brand-new tables. Nothing existing is touched
-- (email_send_log, unified_contacts, journey_flows are all untouched), so WhatsApp
-- can never slow or break the email/journey paths.
--
-- FULLY REVERSIBLE:
--   DROP TABLE IF EXISTS whatsapp_send_log;
--   DROP TABLE IF EXISTS chathead_broadcasts;
--   DROP TABLE IF EXISTS data_files;

BEGIN;

-- ── .data files we build + upload to ChatHead (NDJSON of {id, d(phone), name}) ──
CREATE TABLE IF NOT EXISTS data_files (
  id                SERIAL      PRIMARY KEY,
  filename          TEXT        NOT NULL UNIQUE,               -- logical name, e.g. auto-<unix>.data
  chathead_filename TEXT,                                       -- server name ChatHead returns (timestamp-prefixed)
  contact_count     INTEGER     NOT NULL,
  contacts          JSONB       NOT NULL,                       -- [{ id, d, name }]
  file_bytes        INTEGER,
  upload_status     TEXT        NOT NULL DEFAULT 'pending',     -- pending | uploaded | failed
  upload_response   TEXT,
  uploaded_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_data_files_status            ON data_files(upload_status);
CREATE INDEX IF NOT EXISTS idx_data_files_chathead_filename ON data_files(chathead_filename);

-- ── Broadcasts we've triggered (our own ledger — ChatHead's API echoes little) ──
CREATE TABLE IF NOT EXISTS chathead_broadcasts (
  id                     SERIAL      PRIMARY KEY,
  data_file_id           INTEGER     REFERENCES data_files(id) ON DELETE SET NULL,
  api_version            TEXT        NOT NULL DEFAULT 'v1',
  name                   TEXT        NOT NULL,
  channel_id             INTEGER     NOT NULL,
  channel_name           TEXT,
  template_id            INTEGER     NOT NULL,
  template_name          TEXT,
  subject                TEXT,
  send_time              TIMESTAMPTZ,
  request_payload        JSONB       NOT NULL,
  response_payload       JSONB,
  chathead_broadcast_id  INTEGER,
  status                 TEXT        NOT NULL DEFAULT 'queued', -- queued | submitted | succeeded | failed | unknown
  -- Journey attribution (nullable — set only when a journey WhatsApp node fires this):
  journey_id             INTEGER,
  node_id                TEXT,
  source                 TEXT        DEFAULT 'manual',          -- manual | test-send | journey
  fired_at               TIMESTAMPTZ DEFAULT NOW(),
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chb_channel   ON chathead_broadcasts(channel_id);
CREATE INDEX IF NOT EXISTS idx_chb_template  ON chathead_broadcasts(template_id);
CREATE INDEX IF NOT EXISTS idx_chb_status    ON chathead_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_chb_datafile  ON chathead_broadcasts(data_file_id);
CREATE INDEX IF NOT EXISTS idx_chb_journey   ON chathead_broadcasts(journey_id, node_id);

-- ── Per-recipient WhatsApp send log (the WhatsApp analogue of email_send_log) ──
-- One row per message → each send is an independent record. Kept SEPARATE from
-- email_send_log so WhatsApp volume/writes never touch the 17M-row email table.
CREATE TABLE IF NOT EXISTS whatsapp_send_log (
  id             BIGSERIAL   PRIMARY KEY,
  unified_id     INTEGER,                                       -- contact (nullable for ad-hoc test numbers)
  phone          TEXT        NOT NULL,                          -- recipient (digits, no +)
  contact_name   TEXT,
  channel_id     INTEGER,                                       -- ChatHead WhatsApp channel
  template_id    INTEGER,
  template_name  TEXT,
  journey_id     INTEGER,
  node_id        TEXT,
  broadcast_id   INTEGER     REFERENCES chathead_broadcasts(id) ON DELETE SET NULL,
  external_id    TEXT,                                          -- provider message/broadcast id
  status         TEXT        NOT NULL DEFAULT 'queued',         -- queued | sent | delivered | read | failed
  source         TEXT        DEFAULT 'test-send',               -- test-send | journey | broadcast
  error          TEXT,
  sent_at        TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wsl_unified   ON whatsapp_send_log(unified_id);
CREATE INDEX IF NOT EXISTS idx_wsl_phone     ON whatsapp_send_log(phone);
CREATE INDEX IF NOT EXISTS idx_wsl_journey   ON whatsapp_send_log(journey_id, node_id);
CREATE INDEX IF NOT EXISTS idx_wsl_status    ON whatsapp_send_log(status);
CREATE INDEX IF NOT EXISTS idx_wsl_created   ON whatsapp_send_log(created_at);

COMMIT;
