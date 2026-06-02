/**
 * Quick check: is the SES SNS webhook receiving events RIGHT NOW?
 *
 * Run: node backend/scripts/check_webhook_activity.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  console.log(`\n── Webhook activity in last 5 minutes ────────────────────────\n`);

  const last5 = await query(`
    SELECT event_type, COUNT(*) AS n
    FROM ses_events
    WHERE created_at >= NOW() - INTERVAL '5 minutes'
    GROUP BY event_type
    ORDER BY n DESC
  `);
  if (last5.rows.length === 0) {
    console.log('  ❌ NO events in last 5 minutes — webhook may be down');
  } else {
    last5.rows.forEach(r => console.log(`  ${r.event_type.padEnd(12)} ${r.n}`));
  }

  console.log(`\n── Last 5 events received ────────────────────────────────────\n`);
  const recent = await query(`
    SELECT event_type, message_id, email, created_at
    FROM ses_events
    ORDER BY created_at DESC
    LIMIT 5
  `);
  recent.rows.forEach(r => {
    const ago = Math.round((Date.now() - new Date(r.created_at).getTime()) / 1000);
    console.log(`  [${ago}s ago] ${r.event_type} ${r.email}`);
  });

  console.log(`\n── Most recent event timestamp ──`);
  const latest = await query(`SELECT MAX(created_at) AS last FROM ses_events`);
  const lastTs = latest.rows[0].last;
  if (lastTs) {
    const ago = Math.round((Date.now() - new Date(lastTs).getTime()) / 1000);
    console.log(`  Last event: ${ago} seconds ago`);
    if (ago < 60)  console.log(`  ✅ Webhook is ACTIVE`);
    else if (ago < 600) console.log(`  ⚠️  Recent events, but slow trickle (${ago}s old)`);
    else console.log(`  ❌ Last event >${Math.round(ago/60)} min old — webhook may be broken`);
  } else {
    console.log(`  ❌ ses_events table is empty`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
