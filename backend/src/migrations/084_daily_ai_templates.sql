-- 084: Daily AI-rendered master templates
--
-- A daily cron renders all 7 dynamic Day templates ONCE per day (Claude ranking)
-- and stores the full HTML here — one row per (template, day). This is the SOURCE:
--   • /content "Preview AI"  → reads today's row (no live Claude)
--   • journey node sends      → copy today's row into journey_node_emails (frozen
--                               per-node snapshot, preserves history)
--
-- Claude is called 7×/day total instead of per journey-node.

CREATE TABLE IF NOT EXISTS daily_ai_templates (
  id          BIGSERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  render_date DATE    NOT NULL,
  subject     TEXT,
  html        TEXT    NOT NULL,
  source      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE daily_ai_templates DROP CONSTRAINT IF EXISTS dat_unique;
ALTER TABLE daily_ai_templates ADD CONSTRAINT dat_unique UNIQUE (template_id, render_date);

CREATE INDEX IF NOT EXISTS idx_dat_template_date ON daily_ai_templates(template_id, render_date);
