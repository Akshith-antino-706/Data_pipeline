-- Add per-node unsubscribe count to the analytics rollup.
--
-- The dashboard Analytics tab shows which email node drove opt-outs. journey_node_stats
-- already carries per-node engagement; this adds `unsubscribed`, sourced per node from
-- unsubscribe_log (journey_id + node_id) by JourneyStatsService. Existing rows default to 0
-- until the next rollup refresh recomputes them.
--
-- Additive & reversible:  ALTER TABLE journey_node_stats DROP COLUMN IF EXISTS unsubscribed;

ALTER TABLE journey_node_stats
  ADD COLUMN IF NOT EXISTS unsubscribed integer NOT NULL DEFAULT 0;
