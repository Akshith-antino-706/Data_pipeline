-- 062: data_files + chathead_broadcasts tables
--
-- ChatHead v1 send flow:
--   1. Build a .data file (NDJSON of recipients: {id, d, name})  →  row in data_files
--   2. POST /broadcast/data/add/  (Filedata=@x.data, client=rayna)
--   3. GET  /broadcast/add/       (data_file=x.data, template_id, channel, ...)
--
-- Since ChatHead's POST returns an empty 200 (no filename echo, no id) and GET
-- returns ambiguous "Valid data" instead of "Broadcast Added!" + broadcast_id,
-- we have to keep our own ledger of what we sent.
--
-- Idempotent — all CREATEs use IF NOT EXISTS.

BEGIN;

-- ── .data files we've built + uploaded to ChatHead ──────────────────────
CREATE TABLE IF NOT EXISTS data_files (
  id              SERIAL      PRIMARY KEY,
  filename        TEXT        NOT NULL UNIQUE,                 -- e.g. akshith.data
  contact_count   INTEGER     NOT NULL,
  contacts        JSONB       NOT NULL,                        -- [{ id, d, name }] — NDJSON rows as JSON array
  file_bytes      INTEGER,
  upload_status   TEXT        NOT NULL DEFAULT 'pending',      -- pending | uploaded | failed
  upload_response TEXT,                                         -- raw response (empty for ChatHead v1)
  uploaded_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_files_status ON data_files(upload_status);


-- ── Broadcasts we've triggered ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chathead_broadcasts (
  id                     SERIAL      PRIMARY KEY,
  data_file_id           INTEGER     REFERENCES data_files(id) ON DELETE SET NULL,
  api_version            TEXT        NOT NULL DEFAULT 'v1',     -- v1 | legacy_xhr
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
  fired_at               TIMESTAMPTZ DEFAULT NOW(),
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chathead_broadcasts_channel  ON chathead_broadcasts(channel_id);
CREATE INDEX IF NOT EXISTS idx_chathead_broadcasts_template ON chathead_broadcasts(template_id);
CREATE INDEX IF NOT EXISTS idx_chathead_broadcasts_status   ON chathead_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_chathead_broadcasts_datafile ON chathead_broadcasts(data_file_id);

COMMIT;
