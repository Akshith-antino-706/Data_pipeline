-- 118_daily_send_counts.sql
-- Daily totals of messages SENT per channel (Dubai calendar day), so the Home
-- "Messages sent, last 14 days" chart reads 14 tiny rows instead of counting
-- millions of log rows.
--
-- Scope (agreed with the product owner): this migration ONLY creates this new
-- table. It does not alter, read or write any other table. The table is filled
-- by src/crons/dailySendCounts.ts, which only READS the send logs and only
-- WRITES to daily_send_counts.
CREATE TABLE IF NOT EXISTS daily_send_counts (
  day          DATE        NOT NULL,          -- Dubai calendar day
  channel      TEXT        NOT NULL CHECK (channel IN ('email', 'whatsapp', 'sms')),
  sent         BIGINT      NOT NULL DEFAULT 0,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, channel)
);
