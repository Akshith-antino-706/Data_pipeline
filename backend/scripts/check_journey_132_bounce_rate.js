/**
 * Real-time bounce/delivery rate for journey 132 specifically.
 * Compares to the last-7-day baseline (77% bounce) to detect DNS fix.
 *
 * Run: node backend/scripts/check_journey_132_bounce_rate.js
 */

import 'dotenv/config';
import { query } from '../src/config/database.js';

async function main() {
  const JOURNEY_ID = 132;

  console.log(`\n── Journey ${JOURNEY_ID}: send + event status ──────────────────────\n`);

  // 1. Total sends recorded for this journey
  const sendStats = await query(`
    SELECT
      COUNT(*)                                          AS total_sent,
      COUNT(*) FILTER (WHERE external_id IS NOT NULL)   AS with_external_id,
      COUNT(*) FILTER (WHERE external_id IS NULL)       AS null_external_id
    FROM email_send_log
    WHERE journey_id = $1 AND status = 'sent'
  `, [JOURNEY_ID]);

  const s = sendStats.rows[0];
  console.log(`  Total sent (status='sent'):  ${s.total_sent}`);
  console.log(`  With external_id:             ${s.with_external_id}`);
  console.log(`  NULL external_id (untracked): ${s.null_external_id}`);

  // 2. Event breakdown for THIS journey's external_ids
  const events = await query(`
    SELECT se.event_type, COUNT(*) AS n
    FROM email_send_log esl
    JOIN ses_events se ON se.message_id = esl.external_id
    WHERE esl.journey_id = $1 AND esl.external_id IS NOT NULL
    GROUP BY se.event_type
    ORDER BY n DESC
  `, [JOURNEY_ID]);

  console.log(`\n── SES events for journey ${JOURNEY_ID} sends ──`);
  if (events.rows.length === 0) {
    console.log('  (no events yet — SES typically takes 10s-2min to send first events)');
  } else {
    events.rows.forEach(r => console.log(`  ${r.event_type.padEnd(12)} ${r.n}`));
  }

  // 3. Compute rates
  const counts = Object.fromEntries(events.rows.map(r => [r.event_type, parseInt(r.n)]));
  const delivered = counts.Delivery   || 0;
  const bounced   = counts.Bounce     || 0;
  const complaint = counts.Complaint  || 0;
  const trackable = parseInt(s.with_external_id);

  console.log(`\n── Rates for journey ${JOURNEY_ID} ──`);
  if (trackable > 0) {
    const deliveryRate = (delivered / trackable * 100).toFixed(2);
    const bounceRate   = (bounced   / trackable * 100).toFixed(2);
    const complaintRate = (complaint / trackable * 100).toFixed(3);
    console.log(`  Delivery rate:  ${deliveryRate}%  (${delivered} of ${trackable} trackable sends)`);
    console.log(`  Bounce rate:    ${bounceRate}%  (${bounced} bounces)`);
    console.log(`  Complaint rate: ${complaintRate}% (${complaint} complaints)`);
  } else {
    console.log('  (no trackable sends — externalId is NULL on all journey 132 sends)');
  }

  // 4. Compare to 7-day baseline
  console.log(`\n── Baseline (last 7 days, all sends) ──`);
  const baseline = await query(`
    SELECT event_type, COUNT(*) AS n
    FROM ses_events
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY event_type
  `);
  const baseCounts = Object.fromEntries(baseline.rows.map(r => [r.event_type, parseInt(r.n)]));
  const baseTotal  = (baseCounts.Bounce || 0) + (baseCounts.Delivery || 0) + (baseCounts.Complaint || 0);
  if (baseTotal > 0) {
    const baseDeliveryPct = ((baseCounts.Delivery || 0) / baseTotal * 100).toFixed(2);
    const baseBouncePct   = ((baseCounts.Bounce   || 0) / baseTotal * 100).toFixed(2);
    console.log(`  Delivery: ${baseDeliveryPct}%  Bounce: ${baseBouncePct}%`);
  }

  console.log(`\n── DNS fix verdict ──`);
  if (trackable === 0) {
    console.log(`  ❌ Cannot tell — externalId=null on all journey 132 sends. Check AWS SES console directly.`);
  } else if (parseInt(bounced) === 0 && parseInt(delivered) > 100) {
    console.log(`  ✅ DNS likely FIXED — zero bounces with ${delivered} deliveries.`);
  } else if (bounced / trackable > 0.5) {
    console.log(`  ❌ DNS NOT fixed — bounce rate still > 50%.`);
  } else if (bounced / trackable < 0.2) {
    console.log(`  ✅ DNS likely FIXED — bounce rate is < 20% (was 77% in baseline).`);
  } else {
    console.log(`  ⚠️  Partial / mixed — bounce rate is ${(bounced/trackable*100).toFixed(1)}% (baseline was 77%).`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
