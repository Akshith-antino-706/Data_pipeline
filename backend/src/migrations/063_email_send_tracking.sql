-- 063_email_send_tracking.sql
-- Tracks every email send from test-send routes (and future campaign sends)
-- Status lifecycle: queued → sent/failed → opened → clicked

CREATE TABLE IF NOT EXISTS email_send_log (
  id             BIGSERIAL PRIMARY KEY,
  unified_id     BIGINT,                   -- FK to unified_contacts(id), nullable
  email          TEXT NOT NULL,
  contact_name   TEXT,
  subject        TEXT,
  template_label TEXT,                      -- e.g. 'Day 1 - Welcome'
  day_number     SMALLINT,                  -- 1-7 for daily sequence sends
  source         TEXT NOT NULL DEFAULT 'test-send',  -- test-send | campaign | journey
  external_id    TEXT,                      -- provider's message ID (smtp messageId, sendgrid id)
  provider       TEXT,                      -- smtp | sendgrid | simulated
  status         TEXT NOT NULL DEFAULT 'queued',     -- queued | sent | failed | opened | clicked
  error_message  TEXT,
  sent_at        TIMESTAMPTZ,
  opened_at      TIMESTAMPTZ,
  clicked_at     TIMESTAMPTZ,
  duration_ms    INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esl_unified_id   ON email_send_log(unified_id) WHERE unified_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esl_email        ON email_send_log(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_esl_status       ON email_send_log(status);
CREATE INDEX IF NOT EXISTS idx_esl_sent_at      ON email_send_log(sent_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_esl_external_id  ON email_send_log(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esl_day_number   ON email_send_log(day_number) WHERE day_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esl_source       ON email_send_log(source);
