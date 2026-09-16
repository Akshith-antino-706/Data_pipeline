-- Tracks the reason a contact was unsubscribed, per channel (email/whatsapp/sms/push).
-- One row per unified_contacts record; re-running an unsubscribe action updates the existing row.
-- Revert: DROP TABLE IF EXISTS unsubscribe_reason;
BEGIN;

CREATE TABLE IF NOT EXISTS unsubscribe_reason (
  id SERIAL PRIMARY KEY,
  unified_id INTEGER NOT NULL REFERENCES unified_contacts(id) ON DELETE CASCADE,
  email TEXT,
  whatsapp TEXT,
  sms TEXT,
  push_notification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (unified_id)
);

CREATE INDEX IF NOT EXISTS idx_unsubscribe_reason_unified_id ON unsubscribe_reason(unified_id);

COMMIT;
