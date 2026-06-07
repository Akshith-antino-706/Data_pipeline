-- 083: Stored rendered email HTML per node
--
-- Instead of freezing just the ranking JSON, we store the WHOLE rendered email
-- HTML per (journey, node). The first touch (send or preview) renders it once
-- (Claude or fallback) and stores it here; every subsequent send AND the preview
-- return this exact stored HTML — so preview is byte-identical to what's sent.
--
-- source: 'claude' | 'fallback' | 'fallback_no_api_key'

CREATE TABLE IF NOT EXISTS journey_node_emails (
  id          BIGSERIAL PRIMARY KEY,
  journey_id  BIGINT NOT NULL,
  node_id     TEXT   NOT NULL,
  template_id INTEGER,
  subject     TEXT,
  html        TEXT   NOT NULL,
  source      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE journey_node_emails DROP CONSTRAINT IF EXISTS jne_unique;
ALTER TABLE journey_node_emails ADD CONSTRAINT jne_unique UNIQUE (journey_id, node_id);

CREATE INDEX IF NOT EXISTS idx_jne_journey_node ON journey_node_emails(journey_id, node_id);
