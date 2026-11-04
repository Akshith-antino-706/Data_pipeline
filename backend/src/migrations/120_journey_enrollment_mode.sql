-- 120: Continuous-journey DELIVERY MODE — who does one event reach?
--
-- Until now every journey was per-user: an event enrolled the ONE person who fired it,
-- and the segment acted as a gate on that person. 'segment_broadcast' inverts it — the
-- segment IS the audience, the event is only the starting gun, and the person who fired
-- it need not belong to the segment at all.
--
-- Safe on a live table: both columns have defaults, and 'per_user' is exactly how every
-- existing journey already behaves, so no row changes meaning.

ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS enrollment_mode TEXT NOT NULL DEFAULT 'per_user';

-- Minimum minutes between two broadcasts of the same journey. A trigger that fires often
-- (giveaway 'participation' runs ~19×/day) would otherwise mail the whole segment on every
-- single event. 0 disables the guard.
ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS broadcast_cooldown_min INTEGER NOT NULL DEFAULT 60;

-- Stamped by the atomic cooldown claim in ContinuousJourneyService.enterSegment, so two
-- events arriving together can never both fan out.
ALTER TABLE journey_flows
  ADD COLUMN IF NOT EXISTS last_broadcast_at TIMESTAMPTZ;

ALTER TABLE journey_flows
  DROP CONSTRAINT IF EXISTS journey_flows_enrollment_mode_chk;
ALTER TABLE journey_flows
  ADD CONSTRAINT journey_flows_enrollment_mode_chk
  CHECK (enrollment_mode IN ('per_user', 'segment_broadcast'));

-- Partial: broadcast journeys are a handful among hundreds, and they're the only ones
-- ever filtered on this column.
CREATE INDEX IF NOT EXISTS idx_journey_flows_enrollment_mode
  ON journey_flows (enrollment_mode)
  WHERE enrollment_mode = 'segment_broadcast';
