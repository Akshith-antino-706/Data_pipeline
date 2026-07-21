-- Journey Dashboard → Analytics tab: precomputed per-journey / per-node rollup.
--
-- WHY: the node-wise analytics table must show many journeys at once. Computing the
-- metrics live means aggregating over email_send_log (~17M rows / 6.4GB), ses_events,
-- gtm_events and journey_entries for EVERY journey on EVERY dashboard load — seconds
-- per journey, so a full table would time out (the same 504 we fixed on the detail
-- screen, multiplied by N). Big journeys (242, 243, 332) make it worse.
--
-- This table is a CACHE: one row per (journey_id, node_id), plus a per-journey rollup
-- row keyed node_id = '__ALL__'. A 30-min cron recomputes it in the BACKGROUND (one
-- journey at a time). The dashboard then reads a few-thousand-row table with NO joins
-- and NO scans of email_send_log → milliseconds, independent of journey size. All
-- display fields are denormalized in so the read path is a single flat SELECT.
--
-- ISOLATION: additive only. No existing table is altered. Nothing reads or writes this
-- table except the new aggregator/endpoints, so no other flow is affected.
--
-- FULLY REVERSIBLE — every value here is derived from source tables and recomputable.
-- To roll back (instant, loses only the cache which the cron would rebuild):
--   DROP TABLE IF EXISTS journey_node_stats;
--   DROP TABLE IF EXISTS journey_stats_meta;

CREATE TABLE IF NOT EXISTS journey_node_stats (
  journey_id      integer     NOT NULL,
  node_id         text        NOT NULL,          -- '__ALL__' = per-journey rollup row

  -- Denormalized display fields (snapshotted each refresh so reads need no joins)
  journey_name    text,
  journey_status  text,
  node_label      text,
  node_type       text,
  channel         text,

  -- Audience / lifecycle (journey_entries)
  target_count    integer     NOT NULL DEFAULT 0, -- only meaningful on the '__ALL__' row
  entries         integer     NOT NULL DEFAULT 0,
  booked          integer     NOT NULL DEFAULT 0,
  exited_booked   integer     NOT NULL DEFAULT 0,
  exited_unsub    integer     NOT NULL DEFAULT 0,

  -- Sends / delivery (email_send_log + ses_events)
  sent            integer     NOT NULL DEFAULT 0,
  sends_today     integer     NOT NULL DEFAULT 0, -- Dubai (Asia/Dubai) calendar day
  delivered       integer     NOT NULL DEFAULT 0,
  bounced         integer     NOT NULL DEFAULT 0,

  -- Engagement (email_send_log; human_* are bot-filtered, landed joins gtm_events)
  opened          integer     NOT NULL DEFAULT 0,
  human_opened    integer     NOT NULL DEFAULT 0,
  clicked         integer     NOT NULL DEFAULT 0,
  human_clicked   integer     NOT NULL DEFAULT 0,
  landed          integer     NOT NULL DEFAULT 0,

  -- Website events (gtm_events)
  gtm_events      integer     NOT NULL DEFAULT 0,

  bot_window_sec  integer     NOT NULL DEFAULT 15, -- window used for human_* at compute time
  computed_at     timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (journey_id, node_id)
);

-- Filter by status ('active' / 'completed' / …) on the dashboard table.
CREATE INDEX IF NOT EXISTS idx_jns_status ON journey_node_stats (journey_status);
-- Surface stalest journeys first when scheduling refreshes.
CREATE INDEX IF NOT EXISTS idx_jns_computed_at ON journey_node_stats (computed_at);

-- Single-row table holding the last full-refresh time (for the "updated X min ago" badge).
CREATE TABLE IF NOT EXISTS journey_stats_meta (
  id           boolean     PRIMARY KEY DEFAULT true,  -- enforce a single row
  last_run_at  timestamptz,
  last_run_ms  integer,
  journeys_run integer,
  CONSTRAINT journey_stats_meta_singleton CHECK (id)
);
