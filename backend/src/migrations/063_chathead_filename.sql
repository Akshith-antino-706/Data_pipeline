-- 063: store ChatHead's server-side filename (which is what we must reference in
-- the broadcast call). ChatHead prepends a unix timestamp to whatever filename
-- we uploaded (e.g. ak_test.data → 1780487805ak_test.data) and returns it in
-- the upload response. data_files.filename stays as the logical/user-friendly
-- name; data_files.chathead_filename is what we pass to /broadcast/add/?data_file=…
--
-- Idempotent.

BEGIN;

ALTER TABLE data_files ADD COLUMN IF NOT EXISTS chathead_filename TEXT;
CREATE INDEX IF NOT EXISTS idx_data_files_chathead_filename ON data_files(chathead_filename);

COMMIT;
