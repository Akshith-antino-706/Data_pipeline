-- 056: Seed the TEST_USERS journey — 7-day Day 1..Day 7 send sequence
--
-- Why: User asked for a journey targeting the TEST_USERS segment so the
-- 5 hardcoded testers (Akshith / Anket / Vaibhav / Alok) can be enrolled
-- and walked through the full Day 1..Day 7 email sequence on demand.
-- Mirrors the existing per-segment journey pattern (e.g. journey 110)
-- but points each action node at the new content_templates rows 1..7
-- (seeded by migration 054).
--
-- Idempotent: deletes any prior row with this name first (journey_flows
-- has no UNIQUE constraint on name), then inserts the fresh definition.

BEGIN;

DELETE FROM journey_flows WHERE name = 'Test Users — Day 1..Day 7 Sequence';

INSERT INTO journey_flows (
  name, description, segment_id, status, nodes, edges,
  audience, conversion_event, max_follow_ups, stop_on_conversion,
  is_looping, goal_type, goal_value, created_by
)
SELECT
  'Test Users — Day 1..Day 7 Sequence',
  'Internal QA journey: walks the 5 TEST_USERS through Day 1..Day 7 emails on a 1-day cadence. Bypasses real-customer guards.',
  (SELECT segment_id FROM segment_definitions WHERE segment_name = 'TEST_USERS'),
  'active',
  $$[
    {"id":"trigger-1","type":"trigger","position":{"x":250,"y":0},
     "data":{"label":"TEST_USERS segment entry","triggerType":"segment_entry","segmentLabel":"TEST_USERS"}},

    {"id":"action-day1","type":"action","position":{"x":250,"y":100},
     "data":{"label":"Day 1: Welcome to Rayna Tours","channel":"email","templateId":"1"}},
    {"id":"wait-1","type":"wait","position":{"x":250,"y":200},
     "data":{"label":"Wait 1 day","waitDays":1}},

    {"id":"action-day2","type":"action","position":{"x":250,"y":300},
     "data":{"label":"Day 2: Cruise Spotlight","channel":"email","templateId":"2"}},
    {"id":"wait-2","type":"wait","position":{"x":250,"y":400},
     "data":{"label":"Wait 1 day","waitDays":1}},

    {"id":"action-day3","type":"action","position":{"x":250,"y":500},
     "data":{"label":"Day 3: Visa Made Easy","channel":"email","templateId":"3"}},
    {"id":"wait-3","type":"wait","position":{"x":250,"y":600},
     "data":{"label":"Wait 1 day","waitDays":1}},

    {"id":"action-day4","type":"action","position":{"x":250,"y":700},
     "data":{"label":"Day 4: Dream Holidays","channel":"email","templateId":"4"}},
    {"id":"wait-4","type":"wait","position":{"x":250,"y":800},
     "data":{"label":"Wait 1 day","waitDays":1}},

    {"id":"action-day5","type":"action","position":{"x":250,"y":900},
     "data":{"label":"Day 5: Top Activities","channel":"email","templateId":"5"}},
    {"id":"wait-5","type":"wait","position":{"x":250,"y":1000},
     "data":{"label":"Wait 1 day","waitDays":1}},

    {"id":"action-day6","type":"action","position":{"x":250,"y":1100},
     "data":{"label":"Day 6: Destination Spotlight","channel":"email","templateId":"6"}},
    {"id":"wait-6","type":"wait","position":{"x":250,"y":1200},
     "data":{"label":"Wait 1 day","waitDays":1}},

    {"id":"action-day7","type":"action","position":{"x":250,"y":1300},
     "data":{"label":"Day 7: You Left Something Behind","channel":"email","templateId":"7"}}
  ]$$::jsonb,
  $$[
    {"id":"e_trigger-1_action-day1","source":"trigger-1","target":"action-day1"},
    {"id":"e_action-day1_wait-1","source":"action-day1","target":"wait-1"},
    {"id":"e_wait-1_action-day2","source":"wait-1","target":"action-day2"},
    {"id":"e_action-day2_wait-2","source":"action-day2","target":"wait-2"},
    {"id":"e_wait-2_action-day3","source":"wait-2","target":"action-day3"},
    {"id":"e_action-day3_wait-3","source":"action-day3","target":"wait-3"},
    {"id":"e_wait-3_action-day4","source":"wait-3","target":"action-day4"},
    {"id":"e_action-day4_wait-4","source":"action-day4","target":"wait-4"},
    {"id":"e_wait-4_action-day5","source":"wait-4","target":"action-day5"},
    {"id":"e_action-day5_wait-5","source":"action-day5","target":"wait-5"},
    {"id":"e_wait-5_action-day6","source":"wait-5","target":"action-day6"},
    {"id":"e_action-day6_wait-6","source":"action-day6","target":"wait-6"},
    {"id":"e_wait-6_action-day7","source":"wait-6","target":"action-day7"}
  ]$$::jsonb,
  'all',
  'purchase',
  7,
  TRUE,
  FALSE,
  'engagement',
  'completed_day7',
  'migration-056';

COMMIT;

-- Sanity check (run manually):
--   SELECT j.journey_id, j.name, sd.segment_name, j.status,
--          jsonb_array_length(j.nodes) AS node_count,
--          jsonb_array_length(j.edges) AS edge_count
--     FROM journey_flows j
--     LEFT JOIN segment_definitions sd ON sd.segment_id = j.segment_id
--    WHERE j.name = 'Test Users — Day 1..Day 7 Sequence';
