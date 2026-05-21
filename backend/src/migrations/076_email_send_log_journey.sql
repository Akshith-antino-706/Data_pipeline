-- Add journey_id and node_id to email_send_log so opens can be counted per journey node
ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS journey_id INTEGER;
ALTER TABLE email_send_log ADD COLUMN IF NOT EXISTS node_id    TEXT;

CREATE INDEX IF NOT EXISTS idx_esl_journey_node ON email_send_log(journey_id, node_id)
  WHERE journey_id IS NOT NULL;
