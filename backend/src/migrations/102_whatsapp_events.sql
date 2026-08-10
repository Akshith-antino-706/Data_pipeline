-- Phase 2 groundwork: WhatsApp delivery tracking. Additive + isolated + reversible.
--   DROP TABLE IF EXISTS wa_events;
--   DROP INDEX IF EXISTS idx_wsl_external;

BEGIN;

-- Fast lookup of a send row by the provider's message/broadcast id (for status updates).
CREATE INDEX IF NOT EXISTS idx_wsl_external ON whatsapp_send_log (external_id);

-- Raw WhatsApp delivery/read callbacks (the WhatsApp analogue of ses_events for email).
-- Drives whatsapp_send_log.status → delivered/read and gives an audit trail.
CREATE TABLE IF NOT EXISTS wa_events (
  id           BIGSERIAL   PRIMARY KEY,
  event_type   TEXT        NOT NULL,          -- sent | delivered | read | failed
  phone        TEXT,
  external_id  TEXT,                           -- provider message/broadcast id → whatsapp_send_log.external_id
  status       TEXT,
  error        TEXT,
  raw_payload  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wae_external ON wa_events (external_id);
CREATE INDEX IF NOT EXISTS idx_wae_phone    ON wa_events (phone);
CREATE INDEX IF NOT EXISTS idx_wae_created  ON wa_events (created_at);

COMMIT;
