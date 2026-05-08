-- 060: Add manoj@raynatours.com as the 6th tester
--
-- Why: User asked to add manoj@raynatours.com to the test recipient list.
-- Mirror what 055 (segment seed) and 057 (journey enrollment) did for the
-- original 5 testers — look up manoj's unified_id by email and link him
-- into segment_customers (TEST_USERS) and journey_entries (Day 1..Day 7).
--
-- Also worth noting: the hardcoded TEST_EMAILS list inside
-- backend/src/services/JourneyService.js is updated in the same change so
-- ad-hoc enrollAll({ mode: 'test_users' }) calls pick him up too.
--
-- Idempotent — both inserts guard with NOT EXISTS / ON CONFLICT.

BEGIN;

-- 1. segment_customers — link manoj's unified_id to the TEST_USERS segment.
INSERT INTO segment_customers (segment_id, customer_id, is_active, assigned_at, assigned_by, confidence)
SELECT
  (SELECT segment_id FROM segment_definitions WHERE segment_name = 'TEST_USERS'),
  uc.unified_id,
  TRUE,
  NOW(),
  'migration-060',
  1.0
FROM unified_contacts uc
WHERE LOWER(uc.email) = 'manoj@raynatours.com'
ON CONFLICT (customer_id, segment_id) DO UPDATE
  SET is_active = TRUE;

-- 2. journey_entries — enroll manoj at the trigger node of the TEST_USERS journey.
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
  WHERE LOWER(uc.email) = 'manoj@raynatours.com'
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
