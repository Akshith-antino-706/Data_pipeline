#!/usr/bin/env node
/**
 * Send the Day-3 Visa email — Anthropic-ranked, DB-hydrated, SMTP-delivered.
 *
 * Pipeline:
 *   1. Look up the recipient's unified_id (used as UTM rid + Claude context).
 *   2. VisaRankingService.rankVisasForContact(...) → asks Claude to pick which
 *      visas to feature for this contact. Falls back to a deterministic
 *      ranking if the API key is missing or Claude fails.
 *   3. Day3VisaDataService.buildDay3VisaData(...) → hydrates the ranked keys
 *      from visa_products + variant copy maps into the renderer's data shape.
 *   4. Day3VisaRenderer.renderDay3Visa(template, data) → final HTML.
 *   5. EmailChannel.send → SMTP via your backend/.env config.
 *
 * Usage:
 *   node backend/scripts/send_day3_visa.js <recipient> [subject]
 *   node backend/scripts/send_day3_visa.js --dry-run [recipient]
 *   node backend/scripts/send_day3_visa.js <recipient> --no-claude    # force fallback ranking
 *   node backend/scripts/send_day3_visa.js <recipient> --print-prompt # show Claude prompt
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
const { EmailChannel }       = await import('../src/services/channels/EmailChannel.js');
const { rankTrendingVisas, _internals: rankInternals } = await import('../src/services/VisaRankingService.js');
const { buildDay3VisaData }  = await import('../src/services/Day3VisaDataService.js');
const { renderDay3Visa }     = await import('../src/services/Day3VisaRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day3-visa-dynamic.html');
const RENDERED = path.join(ROOT, 'mail_templates', 'day3-visa-rendered.html');

// Constant — ratings are layout, not personalisation
const RATINGS_KEYS = ['rayna', 'trustpilot', 'tripadvisor', 'google'];

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')          flags.dryRun = true;
    else if (a === '--no-claude')   flags.noClaude = true;
    else if (a === '--print-prompt') flags.printPrompt = true;
    else                             positional.push(a);
  }
  return { recipient: positional[0], subject: positional[1], ...flags };
}

async function main() {
  const { recipient, subject: subjArg, dryRun, noClaude, printPrompt } = parseArgs(process.argv.slice(2));

  if (!recipient && !dryRun) {
    console.error('Usage: node backend/scripts/send_day3_visa.js <recipient> [subject] [--dry-run] [--no-claude] [--print-prompt]');
    process.exit(1);
  }

  const subject = subjArg || 'Visa Made Easy: Your Gateway to the World';

  // 1. Look up unified_id for UTM rid + Claude context
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

  // 2. (Optional) print the Claude prompt to inspect
  if (printPrompt) {
    const catalog = await rankInternals.loadVisaCatalog();
    const { system, user } = rankInternals.buildPrompt(catalog);
    console.log('\n──── SYSTEM PROMPT ────\n' + system);
    console.log('\n──── USER PROMPT ────\n' + user);
    console.log('\n──────────────────────\n');
  }

  // 3. Rank — Claude searches the web for trending destinations.
  //    NOTE: this ranking is universal, not contact-personalised.
  console.log('\n→ rankTrendingVisas (web-search-driven)');
  let rankingResult;
  if (noClaude) {
    const catalog = await rankInternals.loadVisaCatalog();
    rankingResult = {
      ranking: rankInternals.buildFallbackRanking(catalog),
      source: 'fallback (--no-claude)',
      rationale: 'Forced via --no-claude flag',
      trendingThemes: [],
      webSearchCalls: 0,
    };
  } else {
    rankingResult = await rankTrendingVisas();
  }
  const { ranking, source, rationale, trendingThemes, safetyNotes, webSearchCalls, model, usage, error } = rankingResult;
  console.log(`  source         : ${source}${model ? ` (${model})` : ''}`);
  console.log(`  trending themes: ${(trendingThemes || []).join(' | ') || '(none)'}`);
  if (safetyNotes && safetyNotes.length) {
    console.log(`  ⚠ safety notes :`);
    for (const n of safetyNotes) console.log(`     - ${n}`);
  }
  console.log(`  web searches   : ${webSearchCalls || 0}`);
  console.log(`  rationale      : ${rationale}`);
  if (usage) console.log(`  tokens         : in=${usage.input_tokens || '?'} out=${usage.output_tokens || '?'}`);
  if (error) console.log(`  ⚠ error        : ${error}`);
  console.log(`  intl           : ${ranking.international_keys.join(', ')}`);
  console.log(`  evisa          : ${ranking.evisa_keys.join(', ')}`);
  console.log(`  popular        : ${ranking.popular_keys.join(', ')}`);
  console.log(`  variants       : hero=${ranking.hero_variant_key} cta=${ranking.cta_variant_key}`);

  // Inject the constant ratings_keys (Claude doesn't pick those)
  const fullRanking = { ...ranking, ratings_keys: RATINGS_KEYS };

  // 4. Build data
  console.log('\n→ buildDay3VisaData');
  const data = await buildDay3VisaData({
    contactId: unifiedId || 'preview',
    ranking: fullRanking,
  });
  console.log(`  hero variant      : ${ranking.hero_variant_key}`);
  console.log(`  international     : ${data.international_travel.visas.length}`);
  console.log(`  evisas            : ${data.evisa_section.items.length}`);
  console.log(`  popular           : ${data.popular_destinations.items.length}`);

  // 5. Render
  console.log('\n→ renderDay3Visa');
  const html = renderDay3Visa(TEMPLATE, data);
  console.log(`  rendered HTML     : ${html.length.toLocaleString()} chars`);
  fs.writeFileSync(RENDERED, html, 'utf8');
  console.log(`  output            : ${RENDERED.replace(ROOT + '/', '')}`);

  if (dryRun) {
    console.log('\n[DRY-RUN] skipping send.');
    process.exit(0);
  }

  // 6. Send via SMTP
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
