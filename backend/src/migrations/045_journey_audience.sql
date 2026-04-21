-- 045: Journey audience split + conversion tracking
-- Splits journey flows into Indian (WhatsApp + Email) and Rest-of-World (Email only) tracks.
-- Also adds columns needed for per-node conversion checks.

-- ── Audience routing ─────────────────────────────────────────
ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience IN ('indian','rest','all'));

CREATE INDEX IF NOT EXISTS idx_journey_flows_audience ON journey_flows(audience);

-- Existing flows stay as 'all' so nothing breaks until they're explicitly re-audienced
-- via the new UI.

-- ── Per-node conversion tracking on entries ──────────────────
-- converted_at is stamped when the engine sees a post-entry booking or segment change.
-- last_conversion_check is used to avoid re-checking within the same cron tick.
ALTER TABLE journey_entries
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_conversion_check TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_journey_entries_converted_at ON journey_entries(converted_at);
