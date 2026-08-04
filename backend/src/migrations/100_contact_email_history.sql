-- Audit trail of contact email changes (e.g. via the unsubscribe "change email" flow).
-- Each row records one old -> new email transition for a contact (stable unified_id).
-- This is the timeline that lets the send log show which address was active when, without
-- ever rewriting the immutable email_send_log.email snapshots.
--
-- Additive & reversible:  DROP TABLE IF EXISTS contact_email_history;

CREATE TABLE IF NOT EXISTS contact_email_history (
  id          BIGSERIAL   PRIMARY KEY,
  unified_id  INTEGER     NOT NULL REFERENCES unified_contacts(id) ON DELETE CASCADE,
  old_email   TEXT,
  new_email   TEXT        NOT NULL,
  source      TEXT,                                   -- e.g. 'unsubscribe_page'
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ceh_unified   ON contact_email_history (unified_id);
CREATE INDEX IF NOT EXISTS idx_ceh_new_email ON contact_email_history (LOWER(new_email));
CREATE INDEX IF NOT EXISTS idx_ceh_old_email ON contact_email_history (LOWER(old_email));
