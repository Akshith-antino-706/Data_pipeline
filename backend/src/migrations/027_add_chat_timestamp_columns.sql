-- Add last_in, last_out, last_msg, department_name columns to mysql_chats
ALTER TABLE mysql_chats ADD COLUMN IF NOT EXISTS last_in TIMESTAMPTZ;
ALTER TABLE mysql_chats ADD COLUMN IF NOT EXISTS last_out TIMESTAMPTZ;
ALTER TABLE mysql_chats ADD COLUMN IF NOT EXISTS last_msg TIMESTAMPTZ;
ALTER TABLE mysql_chats ADD COLUMN IF NOT EXISTS department_name VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_mysql_chats_last_msg ON mysql_chats(last_msg);

-- Add department_name to contacts and tickets if missing
ALTER TABLE mysql_contacts ADD COLUMN IF NOT EXISTS department_name VARCHAR(100);
ALTER TABLE mysql_tickets ADD COLUMN IF NOT EXISTS department_name VARCHAR(100);
