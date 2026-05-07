#!/usr/bin/env node
/**
 * Send the Day-4 Holidays email to a list of recipients via the Chathead API.
 * Ranks once (one Claude call), then renders+sends per recipient so each
 * gets their own unified_id-based UTM rid.
 *
 * Usage: node backend/scripts/send_day4_via_chathead.js <r1> [r2] [r3] ...
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const db                          = (await import('../src/config/database.js')).default;
const { ChatheadEmailChannel }    = await import('../src/services/channels/ChatheadEmailChannel.js');
const { rankTrendingHolidays }    = await import('../src/services/Day4HolidaysRankingService.js');
const { buildDay4HolidaysData }   = await import('../src/services/Day4HolidaysDataService.js');
const { renderDay4Holidays }      = await import('../src/services/Day4HolidaysRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day4-holidays-dynamic.html');
const SUBJECT  = 'Dream Holidays, Expertly Planned — Curated Packages from Rayna Tours';

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
    console.error('Usage: node backend/scripts/send_day4_via_chathead.js <r1> [r2] ...');
    process.exit(1);
  }

  console.log(`Recipients (${recipients.length}): ${recipients.join(', ')}`);
  if (!ChatheadEmailChannel.isConfigured()) {
    console.error('CHATHEAD_API_TOKEN missing — would simulate. Aborting to avoid silent no-send.');
    process.exit(1);
  }

  console.log('\n→ rankTrendingHolidays (one call, shared across recipients)');
  const { ranking, source, model, trendingThemes, webSearchCalls } = await rankTrendingHolidays();
  console.log(`  source : ${source}${model ? ` (${model})` : ''}`);
  console.log(`  themes : ${(trendingThemes || []).join(' | ') || '(none)'}`);
  console.log(`  web    : ${webSearchCalls || 0} searches`);
  console.log(`  picks  : summer=[${ranking.summer_keys.join(',')}] eid=[${ranking.eid_keys.join(',')}] romantic=[${ranking.romantic_keys.join(',')}] adventure=[${ranking.adventure_keys.join(',')}] hero=${ranking.hero_destination_key}`);

  const results = [];
  for (const to of recipients) {
    const unifiedId = await lookupUnifiedId(to);
    console.log(`\n→ ${to}  unified_id=${unifiedId || 'preview'}`);
    const data = await buildDay4HolidaysData({ contactId: unifiedId || 'preview', ranking });
    const html = renderDay4Holidays(TEMPLATE, data);
    const leftovers = [...html.matchAll(/\{\{[\w.#/]+\}\}/g)];
    if (leftovers.length > 0) {
      console.error(`  [FAIL] placeholders left: ${leftovers.slice(0,5).map(m=>m[0]).join(', ')}`);
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
