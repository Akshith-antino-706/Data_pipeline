#!/usr/bin/env node
/**
 * Send the Day-4 Holidays email — Anthropic-ranked (web-trending), product-
 * hydrated from the products table, SMTP-delivered.
 *
 * Pipeline:
 *   1. Look up unified_id for UTM rid (best-effort).
 *   2. Day4HolidaysRankingService.rankTrendingHolidays() → web-search-driven
 *      picks: 4 keys per theme (summer/eid/romantic/adventure) + eid_special
 *      + hero_destination.
 *   3. Day4HolidaysDataService.buildDay4HolidaysData() → queries `products`
 *      table for each destination key, hydrates data shape.
 *   4. Day4HolidaysRenderer.renderDay4Holidays() → final HTML.
 *   5. EmailChannel.send → SMTP.
 *
 * Usage:
 *   node backend/scripts/send_day4_holidays.js <recipient> [subject]
 *   node backend/scripts/send_day4_holidays.js --dry-run [recipient]
 *   node backend/scripts/send_day4_holidays.js <recipient> --no-claude
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const db = (await import('../src/config/database.js')).default;
const { EmailChannel }            = await import('../src/services/channels/EmailChannel.js');
const { rankTrendingHolidays, _internals: rankInternals } = await import('../src/services/Day4HolidaysRankingService.js');
const { buildDay4HolidaysData }   = await import('../src/services/Day4HolidaysDataService.js');
const { renderDay4Holidays }      = await import('../src/services/Day4HolidaysRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day4-holidays-dynamic.html');
const RENDERED = path.join(ROOT, 'mail_templates', 'day4-holidays-rendered.html');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')        flags.dryRun = true;
    else if (a === '--no-claude') flags.noClaude = true;
    else                           positional.push(a);
  }
  return { recipient: positional[0], subject: positional[1], ...flags };
}

async function main() {
  const { recipient, subject: subjArg, dryRun, noClaude } = parseArgs(process.argv.slice(2));
  if (!recipient && !dryRun) {
    console.error('Usage: node backend/scripts/send_day4_holidays.js <recipient> [subject] [--dry-run] [--no-claude]');
    process.exit(1);
  }
  const subject = subjArg || 'Dream Holidays, Expertly Planned — Curated Packages from Rayna Tours';

  // 1. unified_id lookup
  let unifiedId = null;
  if (recipient) {
    try {
      const { rows: [u] } = await db.query(
        'SELECT unified_id FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
        [recipient]
      );
      unifiedId = u?.unified_id || null;
    } catch (err) {
      console.warn(`[lookup] unified_contacts skipped: ${err.message}`);
    }
  }
  console.log(`Recipient : ${recipient || '<dry-run>'}  unified_id=${unifiedId || 'none'}`);

  // 2. Rank — web-search-driven Claude
  console.log('\n→ rankTrendingHolidays (web-search-driven, universal)');
  let rankingResult;
  if (noClaude) {
    rankingResult = {
      ranking: rankInternals.buildFallbackRanking(),
      source: 'fallback (--no-claude)',
      rationale: 'Forced via --no-claude flag',
      trendingThemes: [], webSearchCalls: 0,
    };
  } else {
    rankingResult = await rankTrendingHolidays();
  }
  const { ranking, source, rationale, trendingThemes, safetyNotes, webSearchCalls, model, usage, error } = rankingResult;
  console.log(`  source         : ${source}${model ? ` (${model})` : ''}`);
  console.log(`  trending themes: ${(trendingThemes || []).join(' | ') || '(none)'}`);
  console.log(`  web searches   : ${webSearchCalls || 0}`);
  console.log(`  rationale      : ${rationale}`);
  if (safetyNotes && safetyNotes.length) {
    console.log(`  ⚠ safety notes :`);
    for (const n of safetyNotes) console.log(`     - ${n}`);
  }
  if (usage) console.log(`  tokens         : in=${usage.input_tokens || '?'} out=${usage.output_tokens || '?'}`);
  if (error) console.log(`  ⚠ error        : ${error}`);
  console.log(`  summer         : ${ranking.summer_keys.join(', ')}`);
  console.log(`  eid            : ${ranking.eid_keys.join(', ')}`);
  console.log(`  romantic       : ${ranking.romantic_keys.join(', ')}`);
  console.log(`  adventure      : ${ranking.adventure_keys.join(', ')}`);
  console.log(`  eid_special    : ${ranking.eid_special_key}`);
  console.log(`  hero_dest      : ${ranking.hero_destination_key}`);
  console.log(`  hero_variant   : ${ranking.hero_variant_key}`);

  // 3. Build data (queries products table)
  console.log('\n→ buildDay4HolidaysData');
  const data = await buildDay4HolidaysData({ contactId: unifiedId || 'preview', ranking });
  console.log(`  summer         : ${data.summer_escapes.length} cards`);
  console.log(`  eid            : ${data.eid_packages.length} cards`);
  console.log(`  romantic       : ${data.romantic_destinations.length} cards`);
  console.log(`  adventure      : ${data.adventure_destinations.length} cards`);

  // 4. Render
  console.log('\n→ renderDay4Holidays');
  const html = renderDay4Holidays(TEMPLATE, data);
  console.log(`  rendered HTML  : ${html.length.toLocaleString()} chars`);
  fs.writeFileSync(RENDERED, html, 'utf8');
  console.log(`  output         : ${RENDERED.replace(ROOT + '/', '')}`);

  // Verify clean
  const leftovers = [...html.matchAll(/\{\{[\w.#/]+\}\}/g)];
  if (leftovers.length > 0) {
    console.error(`[FAIL] rendered HTML still has placeholders: ${leftovers.slice(0,5).map(m=>m[0]).join(', ')}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n[DRY-RUN] skipping send.');
    process.exit(0);
  }

  // 5. SMTP
  console.log('\n→ EmailChannel.send');
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
