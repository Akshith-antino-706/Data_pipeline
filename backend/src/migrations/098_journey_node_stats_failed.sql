-- Add per-node failed-send count to the analytics rollup.
--
-- Additive & reversible:  ALTER TABLE journey_node_stats DROP COLUMN IF EXISTS failed;

ALTER TABLE journey_node_stats
  ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0;
