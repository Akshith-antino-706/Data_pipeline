import 'dotenv/config';
import { query } from '../src/config/database.js';
const r = await query(`
  SELECT node_id, COUNT(*) AS sent_today
  FROM email_send_log
  WHERE journey_id = 132 AND sent_at >= CURRENT_DATE
    AND node_id IN ('node_3','node_5','node_7','node_9','node_11')
  GROUP BY node_id
  ORDER BY node_id
`);
console.log('Sent today by node:');
r.rows.forEach(row => console.log(`  ${row.node_id}: ${row.sent_today}`));
if (r.rows.length === 0) console.log('  (none)');
process.exit(0);
