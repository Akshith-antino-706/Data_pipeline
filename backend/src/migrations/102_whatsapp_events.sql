-- Phase 2 groundwork: WhatsApp delivery tracking. Additive + isolated + reversible.
--   DROP INDEX IF EXISTS idx_wsl_external;
-- (The wa_events table this file used to create was removed on 2026-11-11 — never populated.)

BEGIN;

-- Fast lookup of a send row by the provider's message/broadcast id (for status updates).
CREATE INDEX IF NOT EXISTS idx_wsl_external ON whatsapp_send_log (external_id);

COMMIT;
