-- 089_gtm_journey_entries.sql
-- Per-user state for CONTINUOUS (gtm / lifecycle) journeys — the "conveyor belt".
-- One row = one (journey × user × item) progressing independently through the nodes.
--   current_node_id = where the user is now
--   next_fire_at    = that user's private clock (when the cron should fire the next node)
-- Continuous journeys never complete globally; individual rows reach completed/exited.
-- This is ADDITIVE — it does not touch journey_entries (used by fixed/normal journeys).

CREATE TABLE IF NOT EXISTS gtm_journey_entries (
  id               BIGSERIAL PRIMARY KEY,
  journey_id       INTEGER     NOT NULL REFERENCES journey_flows(journey_id) ON DELETE CASCADE,
  unified_id       BIGINT      NOT NULL,
  item_id          TEXT        NOT NULL DEFAULT '_noitem',
  current_node_id  TEXT,
  status           TEXT        NOT NULL DEFAULT 'active',   -- active | completed | exited | paused
  service_type     TEXT,                                    -- Activity/Holiday/Cruise/Yacht/Visa (drives exit + content)
  entered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_fire_at     TIMESTAMPTZ,                             -- due time for the current node (NULL = fire asap)
  last_event_id    TEXT,                                    -- triggering gtm_events.event_id (personalisation)
  last_enqueued_at TIMESTAMPTZ,                             -- guards against double-enqueue across cron ticks
  exit_reason      TEXT,                                    -- purchased | unsubscribed | lead | left_segment | completed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, unified_id, item_id)                 -- 1 progression per user×item; idempotent entry
);

-- Cron lookup: due active rows (partial index keeps it tiny as rows complete/exit)
CREATE INDEX IF NOT EXISTS idx_gje_due
  ON gtm_journey_entries (next_fire_at)
  WHERE status = 'active';

-- Per-journey node distribution / reporting
CREATE INDEX IF NOT EXISTS idx_gje_journey_node
  ON gtm_journey_entries (journey_id, status, current_node_id);

-- Per-user lookups (re-entry / cooldown / suppression checks)
CREATE INDEX IF NOT EXISTS idx_gje_user
  ON gtm_journey_entries (unified_id, journey_id);
