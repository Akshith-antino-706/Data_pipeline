-- 059: Dedupe TEST_USERS membership + journey enrollment by email
--
-- Why: anket@raynatours.com (and potentially other testers in other envs)
-- has multiple unified_contacts rows. Migrations 055 + 057 enrolled every
-- matching unified_id, so the journey shows 6 entries while the Segmentation
-- "Test Users" tile reads /api/v3/test-sends/recipients which dedupes by
-- email and shows 5. This migration aligns both at 5 by keeping the
-- smallest (oldest) unified_id per email and pruning the rest.
--
-- Idempotent — once dedupe is done, re-runs touch zero rows.

BEGIN;

-- Per-email canonical unified_id = MIN(unified_id)
WITH canonical AS (
  SELECT LOWER(email) AS email, MIN(unified_id) AS keep_id
    FROM unified_contacts
   WHERE LOWER(email) IN (
           'akshith@antino.com',
           'akshith@raynatours.com',
           'anket@raynatours.com',
           'vaibhav@raynatours.com',
           'alok@raynatours.com',
           'manoj@raynatours.com'
         )
   GROUP BY LOWER(email)
),
duplicate_ids AS (
  SELECT uc.unified_id
    FROM unified_contacts uc
    JOIN canonical c ON c.email = LOWER(uc.email)
   WHERE uc.unified_id <> c.keep_id
)
-- Prune duplicate journey_entries first (FK from journey_entries.customer_id)
DELETE FROM journey_entries
 WHERE customer_id IN (SELECT unified_id FROM duplicate_ids)
   AND journey_id IN (
         SELECT journey_id FROM journey_flows
          WHERE name = 'Test Users — Day 1..Day 7 Sequence'
       );

WITH canonical AS (
  SELECT LOWER(email) AS email, MIN(unified_id) AS keep_id
    FROM unified_contacts
   WHERE LOWER(email) IN (
           'akshith@antino.com',
           'akshith@raynatours.com',
           'anket@raynatours.com',
           'vaibhav@raynatours.com',
           'alok@raynatours.com',
           'manoj@raynatours.com'
         )
   GROUP BY LOWER(email)
),
duplicate_ids AS (
  SELECT uc.unified_id
    FROM unified_contacts uc
    JOIN canonical c ON c.email = LOWER(uc.email)
   WHERE uc.unified_id <> c.keep_id
)
DELETE FROM segment_customers
 WHERE customer_id IN (SELECT unified_id FROM duplicate_ids)
   AND segment_id = (
         SELECT segment_id FROM segment_definitions
          WHERE segment_name = 'TEST_USERS'
       );

-- Reconcile journey_flows.total_entries with the actual journey_entries count
UPDATE journey_flows j
   SET total_entries = (SELECT COUNT(*) FROM journey_entries je WHERE je.journey_id = j.journey_id),
       updated_at = NOW()
 WHERE j.name = 'Test Users — Day 1..Day 7 Sequence';

COMMIT;

-- Sanity check (run manually):
--   SELECT j.journey_id, j.name, j.total_entries,
--          (SELECT COUNT(*) FROM journey_entries je WHERE je.journey_id = j.journey_id) AS actual_entries,
--          (SELECT COUNT(*) FROM segment_customers sc
--             JOIN segment_definitions sd ON sd.segment_id = sc.segment_id
--            WHERE sd.segment_name = 'TEST_USERS' AND sc.is_active = TRUE) AS active_members
--     FROM journey_flows j
--    WHERE j.name = 'Test Users — Day 1..Day 7 Sequence';
