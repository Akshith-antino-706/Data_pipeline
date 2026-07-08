-- 091_email_send_log_created_at_index.sql
-- Adds a created_at index for the /send-log/summary time-window query.
-- Without this the 30-day WHERE clause still triggers a full table scan on
-- email_send_log (millions of rows) and times out at the gateway (504).

CREATE INDEX IF NOT EXISTS idx_esl_created_at
  ON email_send_log(created_at DESC);
