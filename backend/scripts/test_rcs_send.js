/**
 * RCS smoke test — sends an approved Gupshup RCS template to a test phone.
 *
 * Usage:
 *   node backend/scripts/test_rcs_send.js <phone> [templateCode] [customParam]
 *
 * Examples:
 *   node backend/scripts/test_rcs_send.js 919876543210
 *   node backend/scripts/test_rcs_send.js 919876543210 test_raynapromo
 *   node backend/scripts/test_rcs_send.js 919876543210 test12345 Akshith
 *
 * Defaults:
 *   templateCode = test_raynapromo (no params)
 *   if you pass test12345, the third arg becomes the {{custom_param}} value
 *
 * What it does:
 *   1. Verifies env config (GUPSHUP_RCS_BOT_ID + SMS userid/password)
 *   2. Calls GupshupService.sendRCS — which inserts rcs_messages row, posts to
 *      the legacy GatewayAPI, then updates the row with external_id + status
 *   3. Prints the response + the rcs_messages row so you can confirm tracking
 *
 * After running:
 *   - If success + the test phone has RCS enabled → message arrives in
 *     Google Messages within a few seconds
 *   - If success + no RCS on device → fallback SMS arrives (only if a
 *     fallbackSMS was provided; this script does pass one)
 *   - Check rcs_messages.status via psql to see DLR transitions as Gupshup
 *     posts them to the /webhook/rcs route
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import GupshupService from '../src/services/GupshupService.js';

const [, , phoneArg, templateArg, paramArg] = process.argv;

if (!phoneArg) {
  console.error('Usage: node backend/scripts/test_rcs_send.js <phone> [templateCode] [customParam]');
  process.exit(1);
}

const phone = phoneArg;
const templateCode = templateArg || 'test_raynapromo';
const customParams = paramArg ? { custom_param: paramArg } : null;

async function main() {
  console.log('─'.repeat(60));
  console.log('RCS smoke test');
  console.log('─'.repeat(60));
  console.log(`  phone        : ${phone}`);
  console.log(`  templateCode : ${templateCode}`);
  console.log(`  customParams : ${customParams ? JSON.stringify(customParams) : '(none)'}`);
  console.log(`  bot_id       : ${process.env.GUPSHUP_RCS_BOT_ID || '(unset)'}`);
  console.log(`  configured?  : ${GupshupService.isRCSConfigured() ? 'yes (will hit Gupshup)' : 'no (simulation mode)'}`);
  console.log('─'.repeat(60));

  const result = await GupshupService.sendRCS({
    to: phone,
    templateCode,
    customParams,
  });

  console.log('\nsendRCS result:');
  console.log(JSON.stringify(result, null, 2));

  if (result.messageId) {
    const { rows: [row] } = await db.query(
      `SELECT id, external_id, status, error_code, error_reason, template_code,
              sent_at, delivered_at, read_at, failed_at
       FROM rcs_messages WHERE id = $1`,
      [result.messageId]
    );
    console.log('\nrcs_messages row:');
    console.log(JSON.stringify(row, null, 2));
  }

  console.log('\nNext steps:');
  console.log(`  - Watch rcs_messages.status update as DLR callbacks fire:`);
  console.log(`      SELECT id, external_id, status, delivered_at, read_at, failed_at, error_code`);
  console.log(`      FROM rcs_messages WHERE id = ${result.messageId};`);
  console.log(`  - User replies / button taps will land in rcs_events.`);
  console.log(`  - For DLRs to reach our backend, the Gupshup console's RCS`);
  console.log(`    "Chatbot Webhook" must point at <publicUrl>/api/v3/gupshup/webhook/rcs`);

  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
