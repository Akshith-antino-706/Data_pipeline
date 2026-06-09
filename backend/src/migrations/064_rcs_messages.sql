-- 064: RCS send/event tracking for Gupshup RBM.
--
-- Three tables, no FKs (so the migration is safe to run before journey_entries
-- exists in a fresh DB, and so phone numbers can be tracked even when no
-- customer record is linked yet).
--
--   rcs_messages — every outbound RCS template/freeform send + its DLR lifecycle
--   rcs_events   — every inbound event from the Gupshup callback (P2A messages,
--                  button taps, URL/dialer actions). Status-only DLRs (sent/
--                  delivered/read/failed) are NOT stored here; they update the
--                  matching rcs_messages row instead.
--   rcs_optouts  — STOP keyword + 423 error_code opt-outs. Send path must check
--                  this table before queueing any RCS message to a phone.
--
-- Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS rcs_messages (
  id                  BIGSERIAL PRIMARY KEY,
  external_id         TEXT,                      -- Gupshup gsId returned by send
  bot_id              TEXT NOT NULL,             -- GUPSHUP_RCS_BOT_ID at send time
  destination         TEXT NOT NULL,             -- recipient phone (e.g. 919XXXXXXXXX)
  template_code       TEXT,                      -- NULL for freeform messages
  custom_params       JSONB,                     -- variables substituted into the template
  fallback_sms        TEXT,                      -- SMS used by Gupshup if RCS unavailable
  status              TEXT NOT NULL DEFAULT 'queued',
                                                 -- queued|submitted|sent|delivered|read|failed
  error_code          TEXT,                      -- e.g. 404, 423, 429
  error_reason        TEXT,
  entry_id            TEXT,                      -- journey_entries.entry_id (loose, no FK)
  node_id             TEXT,                      -- journey node id
  customer_id         BIGINT,                    -- unified_contacts.id (loose, no FK)
  request_payload     JSONB,                     -- the JSON we sent to Gupshup
  response_payload    JSONB,                     -- raw response from Gupshup
  sent_at             TIMESTAMPTZ DEFAULT NOW(),
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcs_messages_external_id ON rcs_messages(external_id);
CREATE INDEX IF NOT EXISTS idx_rcs_messages_destination ON rcs_messages(destination);
CREATE INDEX IF NOT EXISTS idx_rcs_messages_status      ON rcs_messages(status);
CREATE INDEX IF NOT EXISTS idx_rcs_messages_entry       ON rcs_messages(entry_id);
CREATE INDEX IF NOT EXISTS idx_rcs_messages_sent_at     ON rcs_messages(sent_at);


CREATE TABLE IF NOT EXISTS rcs_events (
  id                  BIGSERIAL PRIMARY KEY,
  external_message_id TEXT,                      -- context.gsId — the OUR-message that triggered this reply
  source_phone        TEXT NOT NULL,             -- user's phone
  event_type          TEXT NOT NULL,             -- text|image|video|location|button_reply|url_action|dialer_action|contact
  payload             JSONB NOT NULL,            -- raw payload.payload from the callback
  raw                 JSONB,                     -- full callback body for replay/debug
  received_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcs_events_external_message_id ON rcs_events(external_message_id);
CREATE INDEX IF NOT EXISTS idx_rcs_events_source_phone        ON rcs_events(source_phone);
CREATE INDEX IF NOT EXISTS idx_rcs_events_event_type          ON rcs_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rcs_events_received_at         ON rcs_events(received_at);


CREATE TABLE IF NOT EXISTS rcs_optouts (
  phone               TEXT PRIMARY KEY,
  opted_out_at        TIMESTAMPTZ DEFAULT NOW(),
  source              TEXT,                      -- 'error_423' | 'stop_keyword' | 'manual'
  raw_payload         JSONB
);

COMMIT;
