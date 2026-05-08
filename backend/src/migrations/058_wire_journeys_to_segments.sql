-- 058: Wire each existing journey to its segment via journey_flows.segment_id
--
-- Why: Every per-segment journey (On Trip, Future Travel, Active Enquiry, …)
-- was created with segment_id=NULL — they were named after segments but the
-- FK column was never populated, so the Segmentation page couldn't surface
-- which journey belongs to which segment, and JourneyService.enrollSegment
-- (which gates on segment_id) couldn't run for any of them.
--
-- This migration sets segment_id on each journey by name match. Idempotent —
-- the UPDATE only writes the column we care about, leaving everything else
-- untouched. Re-running is a no-op.
--
-- Holiday Occasion (festive) and General Broadcast (cross-status) intentionally
-- stay NULL because they don't target a single booking-status segment.

BEGIN;

UPDATE journey_flows j
   SET segment_id = sd.segment_id, updated_at = NOW()
  FROM segment_definitions sd
 WHERE j.segment_id IS DISTINCT FROM sd.segment_id
   AND (
        (j.name = 'On Trip — Upsell Journey'              AND sd.segment_name = 'ON_TRIP')
     OR (j.name = 'Future Travel — Pre-Trip Journey'      AND sd.segment_name = 'FUTURE_TRAVEL')
     OR (j.name = 'Active Enquiry — Conversion Sprint'    AND sd.segment_name = 'ACTIVE_ENQUIRY')
     OR (j.name = 'Past Enquiry — Win Back Journey'       AND sd.segment_name = 'PAST_ENQUIRY')
     OR (j.name = 'Past Booking — Cross-Sell & Loyalty'   AND sd.segment_name = 'PAST_BOOKING')
     OR (j.name = 'Prospect — Awareness Nurture'          AND sd.segment_name = 'PROSPECT')
     OR (j.name = 'B2B Active Partner — Nurture Journey'  AND sd.segment_name = 'B2B_ACTIVE_PARTNER')
     OR (j.name = 'B2B Dormant Partner — Reactivation Journey' AND sd.segment_name = 'B2B_DORMANT_PARTNER')
     OR (j.name = 'B2B New Lead — Onboarding Journey'     AND sd.segment_name = 'B2B_NEW_LEAD')
     OR (j.name = 'B2B Prospect — Outreach Journey'       AND sd.segment_name = 'B2B_PROSPECT')
   );

COMMIT;

-- Sanity check (run manually):
--   SELECT j.journey_id, j.name, j.status, sd.segment_name
--     FROM journey_flows j
--     LEFT JOIN segment_definitions sd ON sd.segment_id = j.segment_id
--    ORDER BY j.journey_id;
