-- 105_journey_node_distribution.sql
--
-- Phase 1 of "journeys?id={id} always fast": move the per-node entry-distribution
-- computation OFF the request path and INTO the journey_node_stats rollup.
--
-- Today getById() runs two GROUP BYs over journey_entries on every detail-page
-- load (activeOnNode + nodeUserStats), which scale with snapshot size (~1.36M
-- rows for journey 369 → ~200ms+ each, on a hot request path, behind a 30-min
-- cache that stampedes on cold/mutation). These columns let JourneyStatsService
-- precompute that distribution in its existing cron, so the page just reads it.
--
-- Additive + reversible: new columns only, defaulted to 0/false. No index is
-- added — the distribution query already uses idx_je_journey_status_node.
-- Existing columns/readers (analytics tab uses SELECT *) are untouched: these
-- carry a dist_ prefix to avoid any collision with the journey-level
-- entries/booked/exited_booked/exited_unsub columns.

ALTER TABLE journey_node_stats
  ADD COLUMN IF NOT EXISTS dist_snapshot            INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_active              INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_waiting             INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_completed           INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_exited_booked       INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dist_exited_unsub        INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final                    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS distribution_computed_at TIMESTAMPTZ;
