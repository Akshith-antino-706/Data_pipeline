-- ═══════════════════════════════════════════════════════════
-- Migration 022: Rename columns to business-friendly names
-- and add department_name to chats (derived from departments)
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── Contacts: source_type → department_name ───────────────
ALTER TABLE mysql_contacts RENAME COLUMN source_type TO department_name;

-- ── Tickets: t_to → department_name ───────────────────────
ALTER TABLE mysql_tickets RENAME COLUMN t_to TO department_name;

-- ── Chats: wa_id → customer_no, receiver → department_number, add department_name ──
ALTER TABLE mysql_chats RENAME COLUMN wa_id TO customer_no;
ALTER TABLE mysql_chats RENAME COLUMN receiver TO department_number;
ALTER TABLE mysql_chats ADD COLUMN department_name VARCHAR(95);

-- Update index to match renamed column
DROP INDEX IF EXISTS idx_mysql_chats_wa_id;
CREATE INDEX idx_mysql_chats_customer_no ON mysql_chats(customer_no);

COMMIT;
