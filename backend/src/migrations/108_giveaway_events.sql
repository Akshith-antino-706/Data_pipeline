-- Giveaway events captured from the RabbitMQ consumer.
-- Serves two consumers: (1) segmentation (filter contacts by giveaway activity),
-- (2) journeys (the event `type` triggers a continuous giveaway journey).
CREATE TABLE IF NOT EXISTS giveaway_events (
  id           TEXT PRIMARY KEY,            -- payload.id (natural idempotency)
  version      INT,
  type         TEXT,                        -- participation | eligible | winner | loser
  tenant_id    TEXT,
  giveaway_id  TEXT,                        -- payload.giveawayId
  unified_id   BIGINT,                      -- → unified_contacts(id)
  email        TEXT,
  name         TEXT,                        -- recipient name (printed)
  giveaway     TEXT,                        -- giveaway name (printed)
  mechanic     TEXT,                        -- 'leaderboard' | 'points'  (control flag)
  rank         INT,                         -- leaderboard position (printed)
  prize        TEXT,                        -- prize won (printed)
  value        NUMERIC,                     -- prize value (printed)
  code         TEXT,                        -- voucher / redemption code (printed)
  expiry       DATE,                        -- code / offer expiry (printed)
  prize_type   TEXT,                        -- 'voucher' | …  (control flag)
  offer        TEXT,                        -- consolation offer text (printed)
  subject      TEXT,
  body         TEXT,
  body_format  TEXT,
  created_at   TIMESTAMPTZ,                 -- producer createdAt
  received_at  TIMESTAMPTZ DEFAULT now(),   -- when we consumed it
  journey_id   BIGINT,
  node_id      TEXT,
  raw_payload  JSONB
);

CREATE INDEX IF NOT EXISTS idx_giveaway_events_type       ON giveaway_events (type);
CREATE INDEX IF NOT EXISTS idx_giveaway_events_unified    ON giveaway_events (unified_id);
CREATE INDEX IF NOT EXISTS idx_giveaway_events_giveaway   ON giveaway_events (giveaway_id);
CREATE INDEX IF NOT EXISTS idx_giveaway_events_created    ON giveaway_events (created_at);
