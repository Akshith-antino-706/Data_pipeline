/**
 * Deterministic LOCAL test for the WhatsApp branch in the CONTINUOUS/GTM engine.
 *
 * It calls GtmJourneyService.processJob() DIRECTLY for one entry parked on a
 * WhatsApp node — bypassing the 1-minute cron. That's the whole point: the cron
 * is claimed by whichever backend wins the race (and the EC2 prod backend runs
 * OLD code), so a cron-driven test is non-deterministic. Calling processJob
 * directly runs THIS repo's code, every time.
 *
 * Usage:
 *   cd backend
 *   node scripts/test_gtm_whatsapp.mjs <journeyId> <unifiedId> <whatsappNodeId>
 *
 * Example — journey 372, node_2 uses template 1239 "Apology" (APPROVED), to Rocky:
 *   node scripts/test_gtm_whatsapp.mjs 372 1624845 node_2
 *
 * ⚠  Sends a REAL WhatsApp via ChatHead to the contact's mobile.
 * ⚠  Run with the LOCAL BACKEND STOPPED so nothing else touches the test entry.
 * ⚠  Use an APPROVED template node (1239 "Apology"), NOT 1151 "Demo Campaign"
 *    (empty template_code → ChatHead accepts but WhatsApp won't deliver).
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import GtmJourneyService from '../src/services/GtmJourneyService.js';

const [journeyId, unifiedId, nodeId] = process.argv.slice(2);
if (!journeyId || !unifiedId || !nodeId) {
  console.error('Usage: node scripts/test_gtm_whatsapp.mjs <journeyId> <unifiedId> <whatsappNodeId>');
  process.exit(1);
}
const ITEM = '_watest'; // isolated item_id so this never collides with real entries

async function main() {
  // 1. Show the node we're about to fire
  const { rows: [jf] } = await db.query('SELECT name, journey_type, nodes FROM journey_flows WHERE journey_id=$1', [journeyId]);
  if (!jf) throw new Error(`journey ${journeyId} not found`);
  const node = (jf.nodes || []).find(n => n.id === nodeId);
  console.log(`\njourney ${journeyId} "${jf.name}" (type=${jf.journey_type})`);
  console.log(`node ${nodeId}: channel=${node?.data?.channel} waChannelId=${node?.data?.waChannelId} waTemplateId=${node?.data?.waTemplateId} (${node?.data?.waTemplateName || ''})`);
  if (node?.data?.channel !== 'whatsapp') console.warn('⚠  This node is NOT a whatsapp node — the WA branch will be skipped and it will email.');

  const { rows: [c] } = await db.query('SELECT id, name, mobile, email FROM unified_contacts WHERE id=$1', [unifiedId]);
  if (!c) throw new Error(`contact ${unifiedId} not found`);
  console.log(`contact ${c.id} ${c.name} mobile=${c.mobile}\n`);

  // 2. Create/reset an isolated test entry parked at the WhatsApp node
  const { rows: [e] } = await db.query(
    `INSERT INTO gtm_journey_entries (journey_id, unified_id, item_id, current_node_id, status, next_fire_at, entered_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'active',NOW(),NOW(),NOW(),NOW())
     ON CONFLICT (journey_id, unified_id, item_id)
     DO UPDATE SET current_node_id=$4, status='active', next_fire_at=NOW(),
                   last_enqueued_at=NULL, exit_reason=NULL, updated_at=NOW()
     RETURNING id`,
    [Number(journeyId), Number(unifiedId), ITEM, nodeId]
  );
  const entryId = e.id;
  console.log(`test entry id=${entryId} parked at ${nodeId} — calling processJob directly...\n`);

  // 3. Run THIS repo's code (the new WhatsApp branch), no cron involved
  await GtmJourneyService.processJob({ entryId, journeyId: Number(journeyId), unifiedId: Number(unifiedId), eventId: null, nodeId, itemId: ITEM });

  // 4. Report — a WhatsApp row (source=gtm_journey) proves the fix works
  const { rows: wa } = await db.query(
    `SELECT phone, status, source, template_id, template_name, external_id, error, sent_at
     FROM whatsapp_send_log WHERE journey_id=$1 AND unified_id=$2 ORDER BY id DESC LIMIT 3`,
    [Number(journeyId), Number(unifiedId)]
  );
  console.log('\n=== whatsapp_send_log (newest first) ===');
  console.log(wa.length ? wa : '(no WhatsApp rows — the WA branch did NOT send; this means old code, a non-whatsapp node, or missing config)');

  const { rows: [ent] } = await db.query('SELECT current_node_id, status FROM gtm_journey_entries WHERE id=$1', [entryId]);
  console.log('\nentry after processJob:', ent, '\n');
  process.exit(0);
}
main().catch(err => { console.error('\nTEST FAILED:', err); process.exit(1); });
