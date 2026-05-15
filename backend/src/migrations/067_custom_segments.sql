-- Migration 067: Custom Dynamic Segments
-- Allows users to create reusable segments with JSONB filter conditions.
-- Membership is computed in real-time (no materialized table) for freshness.

CREATE TABLE IF NOT EXISTS custom_segments (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  color         TEXT DEFAULT '#3b82f6',
  icon          TEXT DEFAULT 'Filter',
  conditions    JSONB NOT NULL DEFAULT '[]',
  cached_count  INTEGER DEFAULT 0,
  cached_at     TIMESTAMPTZ,
  created_by    TEXT DEFAULT 'admin',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_custom_segments_active
  ON custom_segments(is_active) WHERE is_active = true;
