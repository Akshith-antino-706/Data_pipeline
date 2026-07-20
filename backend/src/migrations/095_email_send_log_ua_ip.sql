-- Phase 2 (bot filtering): capture the User-Agent + IP of each email open/click so
-- email-security scanners (SafeLinks, Mimecast, Proofpoint, Barracuda, Apple/Gmail
-- proxies) can be identified by UA/IP — the definitive signal, independent of timing
-- or destination.
--
-- Additive & nullable → metadata-only on PostgreSQL (no table rewrite, no lock of
-- consequence) even on the ~17M-row / 6.4 GB email_send_log. Historical rows stay NULL
-- (UA/IP was never captured before); only NEW opens/clicks populate them.
--
-- FULLY REVERSIBLE — to roll back, drop the columns (instant, metadata-only, and it
-- removes ONLY these columns; every existing row and all other data is untouched):
--   ALTER TABLE email_send_log
--     DROP COLUMN IF EXISTS open_ua,  DROP COLUMN IF EXISTS open_ip,
--     DROP COLUMN IF EXISTS click_ua, DROP COLUMN IF EXISTS click_ip;

ALTER TABLE email_send_log
  ADD COLUMN IF NOT EXISTS open_ua   text,
  ADD COLUMN IF NOT EXISTS open_ip   text,
  ADD COLUMN IF NOT EXISTS click_ua  text,
  ADD COLUMN IF NOT EXISTS click_ip  text;
