-- 046: Per-entry track so one journey can run both Indian and Rest tracks in parallel
-- Track values: 'indian' (WhatsApp + Email allowed) | 'rest' (Email only) | 'all' (legacy)
ALTER TABLE journey_entries
  ADD COLUMN IF NOT EXISTS track TEXT DEFAULT 'all'
    CHECK (track IN ('indian','rest','all'));

CREATE INDEX IF NOT EXISTS idx_journey_entries_track ON journey_entries(track);

-- Backfill existing entries from the user's current is_indian flag so we don't misroute
-- if they're mid-journey when we ship.
UPDATE journey_entries je
SET track = CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END
FROM unified_contacts uc
WHERE je.customer_id = uc.unified_id
  AND je.track = 'all';
