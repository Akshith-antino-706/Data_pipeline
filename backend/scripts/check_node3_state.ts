import 'dotenv/config';
import { query } from '../src/config/database.js';
const r = await query(`
  SELECT
    current_node_id,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE next_fire_at <= NOW())             AS due_now,
    COUNT(*) FILTER (WHERE next_fire_at >= '2026-06-04')      AS delayed_to_june4,
    MIN(next_fire_at)                                          AS earliest,
    MAX(next_fire_at)                                          AS latest
  FROM journey_entries
  WHERE journey_id = 132 AND status = 'active' AND current_node_id = 'node_3'
  GROUP BY current_node_id
`);
console.log('node_3 state:', r.rows);

// Also check how many node_3 sends completed today
const sent = await query(`
  SELECT COUNT(*) AS sent_today
  FROM email_send_log
  WHERE journey_id = 132 AND node_id = 'node_3' AND status = 'sent'
    AND sent_at >= CURRENT_DATE
`);
console.log('node_3 sent today:', sent.rows[0]);
process.exit(0);
