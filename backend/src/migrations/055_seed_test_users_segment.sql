-- 055: Seed TEST_USERS segment + memberships
--
-- Why: The Segmentation UI's "Test Users" tile and the /api/v3/test-sends/recipients
-- endpoint both read from segment_definitions ⨝ segment_customers ⨝ unified_contacts
-- WHERE segment_name='TEST_USERS'. In local this segment was inserted ad-hoc and
-- carried 5 hardcoded testers; prod was missing both the definition row and the
-- membership rows, so the tile read empty.
--
-- This migration is idempotent (ON CONFLICT) and uses email-based lookups so
-- prod's different unified_id sequence does not matter.
--
-- The 5 testers (Akshith Y V at antino, Akshith at raynatours, Anket, Vaibhav,
-- Alok) match the hardcoded TEST_EMAILS list in JourneyService.js.

BEGIN;

-- 1. Segment definition (idempotent on segment_name).
INSERT INTO segment_definitions (
  segment_number, stage_id, segment_name, segment_description,
  customer_type, priority, sql_criteria
) VALUES (
  99, 15, 'TEST_USERS',
  'Internal test users — Akshith, Anket, Vaibhav, Alok. Use this segment to test new email templates without sending to real customers.',
  'B2C', 'HIGH',
  $$unified_id IN (SELECT unified_id FROM unified_contacts WHERE LOWER(email) IN ('akshith@antino.com','akshith@raynatours.com','anket@raynatours.com','vaibhav@raynatours.com','alok@raynatours.com'))$$
)
ON CONFLICT (segment_number) DO UPDATE
  SET segment_name        = EXCLUDED.segment_name,
      segment_description = EXCLUDED.segment_description,
      customer_type       = EXCLUDED.customer_type,
      priority            = EXCLUDED.priority,
      sql_criteria        = EXCLUDED.sql_criteria,
      updated_at          = NOW();

-- 2. Memberships — link every unified_contacts row whose email matches the
--    5 testers to the TEST_USERS segment. ON CONFLICT keeps the row active.
INSERT INTO segment_customers (segment_id, customer_id, is_active, assigned_at, assigned_by, confidence)
SELECT
  (SELECT segment_id FROM segment_definitions WHERE segment_name = 'TEST_USERS'),
  uc.unified_id,
  TRUE,
  NOW(),
  'migration-055',
  1.0
FROM unified_contacts uc
WHERE LOWER(uc.email) IN (
  'akshith@antino.com',
  'akshith@raynatours.com',
  'anket@raynatours.com',
  'vaibhav@raynatours.com',
  'alok@raynatours.com'
)
ON CONFLICT (customer_id, segment_id) DO UPDATE
  SET is_active = TRUE;

COMMIT;

-- Sanity check (run manually after the migration):
--   SELECT sc.customer_id, LOWER(uc.email) AS email
--     FROM segment_customers sc
--     JOIN segment_definitions sd ON sd.segment_id = sc.segment_id
--     JOIN unified_contacts uc    ON uc.unified_id = sc.customer_id
--    WHERE sd.segment_name = 'TEST_USERS' AND sc.is_active = TRUE
--    ORDER BY uc.email;
