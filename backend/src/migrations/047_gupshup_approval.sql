-- 047: Gupshup WhatsApp + SMS template approval tracking
-- WhatsApp: Meta-approved via Gupshup's template API (APPROVED → can send)
-- SMS (India): DLT-registered via TRAI (content template ID required per send)

ALTER TABLE content_templates
  ADD COLUMN IF NOT EXISTS external_provider TEXT,                              -- 'gupshup' | null
  ADD COLUMN IF NOT EXISTS external_template_id TEXT,                           -- Gupshup template ID (WA) or DLT content template ID (SMS)
  ADD COLUMN IF NOT EXISTS external_status TEXT DEFAULT 'not_submitted'
    CHECK (external_status IN ('not_submitted','pending','approved','rejected','paused','disabled','error')),
  ADD COLUMN IF NOT EXISTS external_category TEXT,                              -- WA: MARKETING/UTILITY/AUTHENTICATION | SMS: transactional/promotional/service
  ADD COLUMN IF NOT EXISTS external_language TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS external_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS external_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_payload JSONB;                              -- raw provider response for debugging

CREATE INDEX IF NOT EXISTS idx_content_templates_external_status ON content_templates(external_status);
CREATE INDEX IF NOT EXISTS idx_content_templates_external_id ON content_templates(external_template_id);

-- Audit trail for every approval-state transition (submit / webhook / manual sync)
CREATE TABLE IF NOT EXISTS template_approval_events (
  id               BIGSERIAL PRIMARY KEY,
  template_id      BIGINT REFERENCES content_templates(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,                                               -- 'gupshup'
  event_type       TEXT NOT NULL,                                               -- 'submitted' | 'status_update' | 'status_checked' | 'send_blocked'
  previous_status  TEXT,
  new_status       TEXT,
  details          JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_approval_events_template ON template_approval_events(template_id, created_at DESC);

-- Existing WA/SMS templates default to 'not_submitted' — nothing is sendable via
-- Gupshup until each is submitted and approved. Email is unaffected (uses SMTP).
