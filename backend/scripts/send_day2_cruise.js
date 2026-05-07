#!/usr/bin/env node
/**
 * Send the Day-2 Cruise email to a single recipient via SMTP.
 *
 * Pipeline:
 *   1. Look up the recipient's unified_id (best-effort, used as UTM rid)
 *   2. Build the data.json payload via Day2CruiseDataService.buildDay2CruiseData
 *      using a hard-coded test ranking (replace with Anthropic output later)
 *   3. Render the HTML with Day2CruiseRenderer.renderDay2Cruise
 *   4. Send via EmailChannel.send (your existing SMTP config in .env)
 *
 * Usage:
 *   node backend/scripts/send_day2_cruise.js <recipient> [subject]
 *
 * Examples:
 *   node backend/scripts/send_day2_cruise.js akshith@raynatours.com
 *   node backend/scripts/send_day2_cruise.js akshith@raynatours.com "Cruise picks for you"
 *
 * Flags:
 *   --dry-run        Render only, write to mail_templates/day2-cruise-rendered.html, do not send
 *   --ranking <path> Read ranking JSON from a file instead of using the test default
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

// Load .env from backend/ regardless of where this script is invoked from.
// MUST come before importing modules that read env vars at top-level.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const db = (await import('../src/config/database.js')).default;
const { EmailChannel }       = await import('../src/services/channels/EmailChannel.js');
const { buildDay2CruiseData} = await import('../src/services/Day2CruiseDataService.js');
const { renderDay2Cruise }   = await import('../src/services/Day2CruiseRenderer.js');
const TEMPLATE   = path.join(ROOT, 'mail_templates', 'day2-cruise-dynamic.html');
const RENDERED   = path.join(ROOT, 'mail_templates', 'day2-cruise-rendered.html');

// ── default ranking (stand-in for Anthropic) ─────────────────────────────
// Real product_ids verified to exist in `products` (type='cruise').
const DEFAULT_RANKING = {
  saver_product_ids:    [900965, 900972, 900983],
  regional_product_ids: [900981, 900983, 900984, 900986],
  cruise_line_keys:     ['msc', 'costa', 'royal_caribbean', 'genting_dreams'],
  departure_city_keys:  ['abu_dhabi', 'dubai', 'saudi_arabia', 'singapore', 'europe'],
  hero_variant_key:           'horizon',
  regional_copy_variant_key:  'mediterranean',
  hero_product_id:            900965,  // use this product's image_url as hero bg
};

// ── arg parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')      flags.dryRun = true;
    else if (a === '--ranking') flags.rankingPath = argv[++i];
    else                         positional.push(a);
  }
  return { recipient: positional[0], subject: positional[1], ...flags };
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const { recipient, subject: subjectArg, dryRun, rankingPath } = parseArgs(process.argv.slice(2));

  if (!recipient && !dryRun) {
    console.error('Usage: node backend/scripts/send_day2_cruise.js <recipient> [subject] [--dry-run] [--ranking <path>]');
    process.exit(1);
  }

  const subject = subjectArg || 'Cruise Spotlight: Sail the World in Style';

  // 1. Look up recipient's unified_id for UTM rid (best-effort)
  let unifiedId = null;
  if (recipient) {
    try {
      const { rows: [user] } = await db.query(
        'SELECT unified_id FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
        [recipient]
      );
      unifiedId = user?.unified_id || null;
    } catch (err) {
      console.warn(`[lookup] unified_contacts skipped: ${err.message}`);
    }
  }

  // 2. Build the data payload
  const ranking = rankingPath
    ? JSON.parse(fs.readFileSync(rankingPath, 'utf8'))
    : DEFAULT_RANKING;

  console.log(`→ buildDay2CruiseData(contactId=${unifiedId || 'none'}, ranking=${rankingPath || 'DEFAULT'})`);
  const data = await buildDay2CruiseData({
    contactId: unifiedId || 'preview',
    ranking,
  });
  console.log(`  hero variant     : ${ranking.hero_variant_key}`);
  console.log(`  savers           : ${data.saver_packages.length}`);
  console.log(`  regional cruises : ${data.regional_cruises.items.length}`);
  console.log(`  cruise lines     : ${data.cruise_lines.length}`);
  console.log(`  departure cities : ${data.departure_cities.length}`);

  // 3. Render
  console.log(`→ renderDay2Cruise(${TEMPLATE.replace(ROOT + '/', '')})`);
  const html = renderDay2Cruise(TEMPLATE, data);
  console.log(`  rendered HTML    : ${html.length.toLocaleString()} chars`);

  // Always write a copy for inspection
  fs.writeFileSync(RENDERED, html, 'utf8');
  console.log(`  output           : ${RENDERED.replace(ROOT + '/', '')}`);

  if (dryRun) {
    console.log('\n[DRY-RUN] skipping send.');
    process.exit(0);
  }

  // 4. Send via SMTP
  console.log(`\n→ EmailChannel.send`);
  console.log(`  provider : ${EmailChannel.config.provider} (from: ${EmailChannel.config.fromEmail})`);
  console.log(`  to       : ${recipient}`);
  console.log(`  subject  : ${subject}`);

  const start = Date.now();
  const result = await EmailChannel.send({ to: recipient, subject, html });
  const ms = Date.now() - start;

  console.log(`\nResult in ${ms}ms:`, result);
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  console.error(`[ERROR] ${err.stack || err}`);
  process.exit(1);
});
