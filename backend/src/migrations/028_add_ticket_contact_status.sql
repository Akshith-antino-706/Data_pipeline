-- Add contact_status column to mysql_tickets (JSON blob with linked contact details)
ALTER TABLE mysql_tickets ADD COLUMN IF NOT EXISTS contact_status TEXT;
