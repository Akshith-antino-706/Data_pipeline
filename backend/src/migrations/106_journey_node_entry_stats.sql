-- 106_journey_node_entry_stats.sql
--
-- Phase 1b of "journeys?id={id} always fast": store the journey-level entryStats
-- object (the je + action_sent CTE getById ran live on every load, ~10.5s on J369)
-- as JSON on the rollup's __ALL__ row, so getById reads it instead of computing it.
--
-- We store the whole object as JSON (rather than columns) so the read path gets
-- EXACT semantics — including fields not otherwise derivable from the rollup
-- (converted, pre_existing_unsub) — with zero drift. JourneyStatsService runs the
-- identical query off-request in its cron and writes the result here.
--
-- Additive + reversible: one nullable column, only meaningful on the __ALL__ row.

ALTER TABLE journey_node_stats
  ADD COLUMN IF NOT EXISTS entry_stats JSONB;
