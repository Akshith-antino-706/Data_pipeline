-- 103_sms_send_log.sql
-- Per-message SMS send log — the SMS analogue of whatsapp_send_log.
-- Additive, idempotent, no foreign keys. Powers the SMS Test Send (Phase 1)
-- and, later, journey SMS sends + DLR tracking. Nothing else is modified.

CREATE TABLE IF NOT EXISTS sms_send_log (
  id                BIGSERIAL PRIMARY KEY,
  unified_id        BIGINT,
  phone             TEXT NOT NULL,
  contact_name      TEXT,
  template_id       INTEGER,
  dlt_template_id   TEXT,                              -- DLT id actually sent (content_templates.external_template_id)
  sender_mask       TEXT,                              -- GUPSHUP_SMS_SENDER_ID at send time
  provider          TEXT,                              -- 'gupshup-sms'
  external_id       TEXT,                              -- Gupshup message id (DLRs will join on this later)
  journey_id        INTEGER,                           -- loose journey link, no FK
  node_id           TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',    -- queued|sent|delivered|failed|blocked|simulated
  source            TEXT,                              -- 'test-send' | 'journey' | 'gtm_journey'
  error             TEXT,
  message_body      TEXT,                              -- rendered text actually sent (audit)
  sent_at           TIMESTAMPTZ DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_send_log_external_id ON sms_send_log(external_id);
CREATE INDEX IF NOT EXISTS idx_sms_send_log_journey     ON sms_send_log(journey_id, node_id);
CREATE INDEX IF NOT EXISTS idx_sms_send_log_phone       ON sms_send_log(phone);
CREATE INDEX IF NOT EXISTS idx_sms_send_log_status      ON sms_send_log(status);
CREATE INDEX IF NOT EXISTS idx_sms_send_log_sent_at     ON sms_send_log(sent_at DESC NULLS LAST);
