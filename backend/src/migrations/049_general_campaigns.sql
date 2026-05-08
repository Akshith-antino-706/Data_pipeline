-- 049: Popular-product injection for journey nodes + journey-run popularity snapshots
--
-- Sends now flow through BullMQ: processJourney() finds entries due to fire,
-- enqueues a per-entry job, and a worker does the actual render + send +
-- journey_events insert + entry advance. To scale to 1.6M+ entries.
--
-- For nodes whose template is configured with uses_popular_products=true,
-- the popular-products list is fetched once per processJourney run and
-- frozen into popularity_snapshots so every entry fired in that run renders
-- the same products.

-- ── 1. email_html_templates: declare popular-product slots ────
ALTER TABLE email_html_templates
  ADD COLUMN IF NOT EXISTS uses_popular_products BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS product_type          TEXT,             -- 'activity' | 'cruise' | 'holiday'
  ADD COLUMN IF NOT EXISTS product_limit         INTEGER;          -- top-N to fetch (e.g., 8 for day5, 6 for day2, 15 for day4)

-- ── 2. popularity_snapshots: frozen products per journey-run ──
-- One row per product slot. Many journey entries in the same run all read
-- the snapshot whose run_id matches their job payload.
CREATE TABLE IF NOT EXISTS popularity_snapshots (
  id              BIGSERIAL    PRIMARY KEY,
  journey_id      BIGINT       NOT NULL REFERENCES journey_flows(journey_id) ON DELETE CASCADE,
  node_id         TEXT         NOT NULL,                            -- id of the node within journey_flows.nodes
  run_id          UUID         NOT NULL,                            -- one UUID per processJourney run
  product_type    TEXT         NOT NULL,                            -- 'activity' | 'cruise' | 'holiday'
  theme           TEXT,                                             -- optional sub-grouping (e.g., 'thrill','family')
  position        INTEGER      NOT NULL,                            -- 1-based slot order inside (product_type, theme)
  product_id      TEXT,                                             -- upstream product id (string for flexibility)
  name            TEXT,
  category        TEXT,
  location        TEXT,
  duration        TEXT,
  price           TEXT,                                             -- preformatted "From AED 370"
  image_url       TEXT,
  product_url     TEXT,
  raw_payload     JSONB,                                            -- raw API row for debugging
  fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, node_id, run_id, product_type, theme, position)
);

CREATE INDEX IF NOT EXISTS idx_popularity_snapshots_lookup
  ON popularity_snapshots (journey_id, node_id, run_id);

-- ── 3. journey_entries: track BullMQ enqueue state ────────────
-- last_run_id lets the producer skip entries already enqueued in the current
-- run, so a re-trigger of processJourney() inside the same run is idempotent.
ALTER TABLE journey_entries
  ADD COLUMN IF NOT EXISTS last_run_id        UUID,
  ADD COLUMN IF NOT EXISTS last_enqueued_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bullmq_job_id      TEXT;

CREATE INDEX IF NOT EXISTS idx_journey_entries_run
  ON journey_entries (journey_id, last_run_id);
