-- 057: Enroll the 5 TEST_USERS into the Day 1..Day 7 journey
--
-- Why: The journey row was inserted by 056 but had 0 enrollments, so the
-- Journey detail page showed empty Total Entries / Active Now. This
-- migration enrolls every unified_contacts row whose email matches one
-- of the 5 hardcoded testers (akshith@antino, akshith@raynatours, anket,
-- vaibhav, alok) into the journey at its trigger node. Mirrors the SQL
-- that JourneyService.enrollAll({ mode: 'test_users' }) generates so the
-- entries are indistinguishable from a manual Enroll click.
--
-- Idempotent: NOT EXISTS skips already-enrolled testers.

BEGIN;

WITH target_journey AS (
  SELECT journey_id FROM journey_flows
   WHERE name = 'Test Users — Day 1..Day 7 Sequence'
   LIMIT 1
),
inserted AS (
  INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track)
  SELECT
    (SELECT journey_id FROM target_journey),
    uc.unified_id,
    'trigger-1',
    CASE WHEN COALESCE(uc.is_indian, false) THEN 'indian' ELSE 'rest' END
  FROM unified_contacts uc
  WHERE LOWER(uc.email) IN (
          'akshith@antino.com',
          'akshith@raynatours.com',
          'anket@raynatours.com',
          'vaibhav@raynatours.com',
          'alok@raynatours.com'
        )
    AND uc.email IS NOT NULL AND uc.email <> ''
    AND COALESCE(uc.email_unsubscribed, 'No') <> 'Yes'
    AND uc.email ~ '^[^@]+@[^@]+\.[^@]+$'
    AND NOT EXISTS (
      SELECT 1 FROM journey_entries je
       WHERE je.journey_id = (SELECT journey_id FROM target_journey)
         AND je.customer_id = uc.unified_id
    )
  RETURNING entry_id
)
UPDATE journey_flows
   SET total_entries = total_entries + (SELECT COUNT(*) FROM inserted)
 WHERE journey_id = (SELECT journey_id FROM target_journey)
   AND (SELECT COUNT(*) FROM inserted) > 0;

COMMIT;

-- Sanity check (run manually):
--   SELECT je.entry_id, je.current_node_id, je.status, je.track,
--          LOWER(uc.email) AS email
--     FROM journey_entries je
--     JOIN journey_flows j  ON j.journey_id  = je.journey_id
--     JOIN unified_contacts uc ON uc.unified_id = je.customer_id
--    WHERE j.name = 'Test Users — Day 1..Day 7 Sequence'
--    ORDER BY uc.email;
