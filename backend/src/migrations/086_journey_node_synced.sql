-- 086: Per-node audience-refresh throttle.
--
-- Supports the dynamic-audience journey model: instead of snapshotting the
-- segment once at creation, the audience is re-evaluated at each action (send)
-- node. node_synced_at remembers the last refresh time per node (plus a special
-- '_exit' key for the journey-wide stale-exit pass) so the heavy segment query
-- runs at most once per node per run.
--   e.g. { "node_2": "2026-06-14T...", "node_4": "...", "_exit": "..." }

ALTER TABLE journey_flows ADD COLUMN IF NOT EXISTS node_synced_at JSONB DEFAULT '{}';
