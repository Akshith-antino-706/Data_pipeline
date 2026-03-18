-- ═══════════════════════════════════════════════════════════
-- Migration 015: BigQuery Sync Metadata
-- Tracks incremental sync state per table
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS sync_metadata (
    table_name       TEXT PRIMARY KEY,
    last_synced_at   TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    rows_synced      INTEGER DEFAULT 0,
    sync_status      TEXT DEFAULT 'idle',       -- idle | running | success | error
    error_message    TEXT,
    sync_duration_ms INTEGER,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
