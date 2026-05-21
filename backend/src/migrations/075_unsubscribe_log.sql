-- Unsubscribe log: records every unsubscribe click with contact details and source context
CREATE TABLE IF NOT EXISTS unsubscribe_log (
  id                SERIAL PRIMARY KEY,
  unified_id        INTEGER REFERENCES unified_contacts(id) ON DELETE SET NULL,
  email             TEXT,
  journey_id        INTEGER,
  node_id           TEXT,
  campaign          TEXT,
  source_log_id     INTEGER,           -- email_send_log.id that contained the unsubscribe link
  unsubscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unsubscribe_log_unified_id ON unsubscribe_log(unified_id);
CREATE INDEX IF NOT EXISTS idx_unsubscribe_log_unsubscribed_at ON unsubscribe_log(unsubscribed_at DESC);
