-- 082: Persisted per-node lifecycle status
--
-- node_statuses caches the computed lifecycle status of each node
-- ({ node_0: 'completed', node_1: 'sending', node_2: 'waiting', ... }) so the
-- frontend can render node state without recomputing on every poll. Written by
-- getJourneyDetail() whenever the journey is active.

ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS node_statuses JSONB DEFAULT '{}';
