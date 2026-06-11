-- 085: Stored email QA reports
--
-- After a Test Send, the QA report (grammar, missing content, URLs, spam-risk,
-- errors) + real IMAP placement is generated ONCE and stored here — one row per
-- template (latest). The (i) button on each Content card reads this stored report
-- instead of regenerating it.

CREATE TABLE IF NOT EXISTS email_qa_reports (
  id          BIGSERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  report      JSONB   NOT NULL,   -- analyzeEmail() output
  placement   JSONB,              -- checkInboxPlacement() output (filled on demand)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_qa_reports DROP CONSTRAINT IF EXISTS eqr_unique;
ALTER TABLE email_qa_reports ADD CONSTRAINT eqr_unique UNIQUE (template_id);
