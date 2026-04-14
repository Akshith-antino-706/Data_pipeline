-- 039: Daily segment activity log — tracks entries, exits, reach per segment per day

CREATE TABLE IF NOT EXISTS segment_daily_log (
  id              BIGSERIAL PRIMARY KEY,
  log_date        DATE NOT NULL,
  segment_label   TEXT NOT NULL,
  -- Counts at end of day
  total_count     INTEGER DEFAULT 0,
  -- Movement
  entered         INTEGER DEFAULT 0,
  exited          INTEGER DEFAULT 0,
  converted       INTEGER DEFAULT 0,
  -- Reach (messages sent)
  emails_sent     INTEGER DEFAULT 0,
  whatsapp_sent   INTEGER DEFAULT 0,
  push_sent       INTEGER DEFAULT 0,
  total_reached   INTEGER DEFAULT 0,
  -- Journey stats
  journey_active  INTEGER DEFAULT 0,
  journey_completed INTEGER DEFAULT 0,
  -- Revenue
  revenue         NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(log_date, segment_label)
);

CREATE INDEX IF NOT EXISTS idx_sdl_date ON segment_daily_log(log_date DESC);
CREATE INDEX IF NOT EXISTS idx_sdl_segment ON segment_daily_log(segment_label);
