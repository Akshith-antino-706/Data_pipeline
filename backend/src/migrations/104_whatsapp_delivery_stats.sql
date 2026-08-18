-- 104_whatsapp_delivery_stats.sql
-- Delivery-stats sync for WhatsApp broadcasts. Additive, idempotent.
-- ChatHead's session-less reports give per-broadcast counters (reports/get) and
-- per-recipient outcomes (reports/list?type=failed). We store the aggregate on
-- chathead_broadcasts and the per-recipient bits on whatsapp_send_log. No table
-- is dropped or rewritten; existing send behaviour is untouched.

BEGIN;

-- ── Aggregate delivery counters (from broadcast/reports/get) ──
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS total_count      INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS sent_count       INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS failed_count     INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS delivered_count  INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS opened_count     INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS clicked_count    INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS replied_count    INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS soft_bounce      INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS hard_bounce      INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS complaints       INTEGER;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS report_status    TEXT;          -- pending | in_progress | finished
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS last_synced_at   TIMESTAMPTZ;
ALTER TABLE chathead_broadcasts ADD COLUMN IF NOT EXISTS counters_changed_at TIMESTAMPTZ; -- last time any counter moved (drives 'finished' by stability, not a sum)
CREATE INDEX IF NOT EXISTS idx_chb_report_status ON chathead_broadcasts(report_status);

-- ── Per-recipient delivery + message preview (whatsapp_send_log already has
--    status / delivered_at / read_at; we add the report-derived fields) ──
ALTER TABLE whatsapp_send_log ADD COLUMN IF NOT EXISTS wamid               TEXT;         -- WhatsApp message id (proof it reached Meta)
ALTER TABLE whatsapp_send_log ADD COLUMN IF NOT EXISTS delivery_reason     TEXT;         -- drop reason (e.g. ecosystem engagement)
ALTER TABLE whatsapp_send_log ADD COLUMN IF NOT EXISTS delivery_checked_at TIMESTAMPTZ;
ALTER TABLE whatsapp_send_log ADD COLUMN IF NOT EXISTS preview             TEXT;         -- rendered template content sent

COMMIT;
