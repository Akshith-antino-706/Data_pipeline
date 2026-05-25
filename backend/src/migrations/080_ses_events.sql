-- SES webhook events table — stores bounce, complaint, delivery, open, click events
CREATE TABLE IF NOT EXISTS ses_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  email TEXT,
  message_id TEXT,
  bounce_type TEXT,
  complaint_type TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ses_events_email ON ses_events(email);
CREATE INDEX IF NOT EXISTS idx_ses_events_type ON ses_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ses_events_message_id ON ses_events(message_id);
