-- 043: Email HTML templates table — stores production HTML email designs

CREATE TABLE IF NOT EXISTS email_html_templates (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'static',
  category        TEXT,
  html_body       TEXT NOT NULL,
  placeholders    TEXT[] DEFAULT '{}',
  preview_text    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eht_type ON email_html_templates(type);
CREATE INDEX IF NOT EXISTS idx_eht_category ON email_html_templates(category);

-- Add html_template_id FK to content_templates
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS html_template_id BIGINT REFERENCES email_html_templates(id);
