#!/usr/bin/env node
/**
 * Send the Day-2 Cruise email to a list of recipients via the Chathead API.
 * Day 2 uses a static DEFAULT_RANKING (no per-recipient ranking call), so we
 * render once per recipient (UTM rid differs) and POST through ChatheadEmailChannel.
 *
 * Usage: node backend/scripts/send_day2_via_chathead.js <r1> [r2] [r3] ...
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const db                       = (await import('../src/config/database.js')).default;
const { ChatheadEmailChannel } = await import('../src/services/channels/ChatheadEmailChannel.js');
const { buildDay2CruiseData }  = await import('../src/services/Day2CruiseDataService.js');
const { renderDay2Cruise }     = await import('../src/services/Day2CruiseRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day2-cruise-dynamic.html');
const SUBJECT  = 'Cruise Spotlight: Sail the World in Style';

const DEFAULT_RANKING = {
  saver_product_ids:    [900965, 900972, 900983],
  regional_product_ids: [900981, 900983, 900984, 900986],
  cruise_line_keys:     ['msc', 'costa', 'royal_caribbean', 'genting_dreams'],
  departure_city_keys:  ['abu_dhabi', 'saudi_arabia', 'singapore', 'europe'],
  hero_variant_key:           'horizon',
  regional_copy_variant_key:  'mediterranean',
  hero_product_id:            900965,
};

async function lookupUnifiedId(email) {
  try {
    const { rows: [u] } = await db.query(
      'SELECT unified_id FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
      [email]
    );
    return u?.unified_id || null;
  } catch (err) {
    console.warn(`[lookup] ${email}: ${err.message}`);
    return null;
  }
}

async function main() {
  const recipients = process.argv.slice(2).filter(Boolean);
  if (!recipients.length) {
    console.error('Usage: node backend/scripts/send_day2_via_chathead.js <r1> [r2] ...');
    process.exit(1);
  }
  if (!ChatheadEmailChannel.isConfigured()) {
    console.error('CHATHEAD_API_TOKEN missing — aborting to avoid silent no-send.');
    process.exit(1);
  }

  console.log(`Recipients (${recipients.length}): ${recipients.join(', ')}`);

  const results = [];
  for (const to of recipients) {
    const unifiedId = await lookupUnifiedId(to);
    console.log(`\n→ ${to}  unified_id=${unifiedId || 'preview'}`);
    const data = await buildDay2CruiseData({
      contactId: unifiedId || 'preview',
      ranking:   DEFAULT_RANKING,
    });
    const html = renderDay2Cruise(TEMPLATE, data);
    const leftovers = [...html.matchAll(/\{\{[\w.#/]+\}\}/g)];
    if (leftovers.length > 0) {
      console.error(`  [FAIL] placeholders left: ${leftovers.slice(0, 5).map(m => m[0]).join(', ')}`);
      results.push({ to, success: false, error: 'unrendered placeholders' });
      continue;
    }
    console.log(`  bytes  : ${html.length.toLocaleString()}`);
    const t0 = Date.now();
    const r  = await ChatheadEmailChannel.send({ to, subject: SUBJECT, html });
    console.log(`  result : success=${r.success} status=${r.status || '-'} ${r.durationMs ?? Date.now() - t0}ms ${r.error ? `error=${r.error}` : ''}`);
    results.push({ to, success: r.success, error: r.error || null });
  }

  console.log('\n──── Summary ────');
  let okCount = 0;
  for (const r of results) {
    console.log(`  ${r.success ? 'OK ' : 'FAIL'}  ${r.to}${r.error ? `  (${r.error})` : ''}`);
    if (r.success) okCount++;
  }
  console.log(`${okCount}/${results.length} delivered.`);
  process.exit(okCount === results.length ? 0 : 1);
}

main().catch(err => {
  console.error(`[ERROR] ${err.stack || err}`);
  process.exit(1);
});
