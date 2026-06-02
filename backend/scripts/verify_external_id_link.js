/**
 * Read-only diagnostic: are email_send_log.external_id and ses_events.message_id
 * the same string? Without that, the DELIVERED/BOUNCED join in JourneyService
 * always returns 0.
 *
 * Run: node backend/scripts/verify_external_id_link.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  console.log('\n── Sample of recent email_send_log rows ───────────────────────');
  const esl = await query(`
    SELECT id, external_id, provider, status, sent_at
    FROM email_send_log
    WHERE external_id IS NOT NULL
    ORDER BY sent_at DESC NULLS LAST
    LIMIT 5
  `);
  esl.rows.forEach(r => console.log(`  [${r.provider}] external_id="${r.external_id}" status=${r.status}`));

  console.log('\n── Sample of recent ses_events rows ───────────────────────────');
  const ses = await query(`
    SELECT event_type, message_id, email, created_at
    FROM ses_events
    ORDER BY created_at DESC NULLS LAST
    LIMIT 5
  `);
  ses.rows.forEach(r => console.log(`  [${r.event_type}] message_id="${r.message_id}" email=${r.email}`));

  console.log('\n── Join attempt: how many email_send_log rows have a matching ses_event? ──');
  const match = await query(`
    SELECT
      COUNT(*) FILTER (WHERE esl.external_id IS NOT NULL)            AS esl_with_external_id,
      COUNT(*) FILTER (WHERE se.message_id IS NOT NULL)              AS matched_in_ses_events,
      COUNT(*) FILTER (WHERE se.event_type = 'Delivery')             AS matched_deliveries
    FROM email_send_log esl
    LEFT JOIN ses_events se ON se.message_id = esl.external_id
    WHERE esl.sent_at >= NOW() - INTERVAL '7 days'
  `);
  console.log('  Last 7 days:', match.rows[0]);

  console.log('\n── Event-type breakdown over last 7 days ──────────────────────');
  const breakdown = await query(`
    SELECT event_type, COUNT(*) AS n
    FROM ses_events
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY event_type
    ORDER BY n DESC
  `);
  breakdown.rows.forEach(r => console.log(`  ${r.event_type.padEnd(12)} ${r.n}`));

  console.log('\n── Sends with NO ses_event at all (last 7 days) ──────────────');
  const orphans = await query(`
    SELECT COUNT(*) AS orphan_count
    FROM email_send_log esl
    LEFT JOIN ses_events se ON se.message_id = esl.external_id
    WHERE esl.sent_at >= NOW() - INTERVAL '7 days'
      AND esl.external_id IS NOT NULL
      AND se.id IS NULL
  `);
  console.log(`  Orphans (sent but zero events): ${orphans.rows[0].orphan_count}`);

  console.log('\n── Format check: do strings look like SES UUIDs? ──────────────');
  // SES message-ids look like: 0107018fXXXXXXXX-uuid-1234-region-XXXXXXX-000000
  const sesPattern = /^[0-9a-f]{16}-[0-9a-f-]{36}-\d{6}$/;
  esl.rows.forEach(r => {
    const isSesShape = sesPattern.test(r.external_id);
    console.log(`  external_id "${r.external_id?.slice(0, 80)}" → looks like SES id? ${isSesShape ? 'YES' : 'NO'}`);
  });

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
