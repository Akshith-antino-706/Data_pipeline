CREATE TABLE IF NOT EXISTS utm_visits (
  id           BIGSERIAL PRIMARY KEY,
  log_id       BIGINT REFERENCES email_send_log(id) ON DELETE SET NULL,
  unified_id   BIGINT,
  email        TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  rid          TEXT,
  destination_url TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_utm_visits_log_id     ON utm_visits(log_id);
CREATE INDEX IF NOT EXISTS idx_utm_visits_unified_id ON utm_visits(unified_id);
CREATE INDEX IF NOT EXISTS idx_utm_visits_created_at ON utm_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utm_visits_campaign   ON utm_visits(utm_campaign);
