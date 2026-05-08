#!/usr/bin/env node
/**
 * Send the Day-1 Welcome email — Anthropic-ranked (web-search), DB-hydrated,
 * SMTP-delivered.
 *
 * Pipeline:
 *   1. Look up the recipient's unified_id (used as UTM rid).
 *   2. Day1WelcomeRankingService.rankTrendingWelcome() → web-search-driven
 *      picks of 4 keys per section (Holidays, Cruises, Visas, Activities)
 *      + variant choices. Falls back if API key missing or Claude fails.
 *   3. Day1WelcomeDataService.buildDay1WelcomeData(...) → hydrates the keys
 *      into the renderer's data shape.
 *   4. Day1WelcomeRenderer.renderDay1Welcome(template, data) → final HTML.
 *   5. EmailChannel.send → SMTP via backend/.env.
 *
 * Usage:
 *   node backend/scripts/send_day1_welcome.js <recipient> [subject]
 *   node backend/scripts/send_day1_welcome.js --dry-run [recipient]
 *   node backend/scripts/send_day1_welcome.js <recipient> --no-claude
 *   node backend/scripts/send_day1_welcome.js <recipient> --print-prompt
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
const { rankTrendingWelcome, _internals: rankInternals } = await import('../src/services/Day1WelcomeRankingService.js');
const { buildDay1WelcomeData } = await import('../src/services/Day1WelcomeDataService.js');
const { renderDay1Welcome }    = await import('../src/services/Day1WelcomeRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day1-welcome-dynamic.html');
const RENDERED = path.join(ROOT, 'mail_templates', 'day1-welcome-rendered.html');

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
    console.error('Usage: node backend/scripts/send_day1_welcome.js <recipient> [subject] [--dry-run] [--no-claude] [--print-prompt]');
    process.exit(1);
  }

  const subject = subjArg || 'Welcome to Rayna Tours — Your Dream Holiday Starts Here';

  // 1. Lookup
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

  // 2. Print prompt (optional)
  if (printPrompt) {
    const { _internals: dataInternals } = await import('../src/services/Day1WelcomeDataService.js');
    const visaRows = await rankInternals.loadVisaCatalog();
    const { system, user } = rankInternals.buildPrompt(
      rankInternals.listFromMap(dataInternals.HOLIDAY_DESTINATIONS),
      rankInternals.listFromMap(dataInternals.CRUISE_DESTINATIONS),
      rankInternals.listFromMap(dataInternals.ACTIVITY_DESTINATIONS),
      visaRows,
    );
    console.log('\n──── SYSTEM PROMPT ────\n' + system);
    console.log('\n──── USER PROMPT ────\n' + user);
    console.log('\n──────────────────────\n');
  }

  // 3. Rank
  console.log('\n→ rankTrendingWelcome (web-search-driven)');
  let rankingResult;
  if (noClaude) {
    const { _internals: dataInternals } = await import('../src/services/Day1WelcomeDataService.js');
    const visaRows = await rankInternals.loadVisaCatalog();
    const visaMap = Object.fromEntries(visaRows.map(r => [r.key, r]));
    rankingResult = {
      ranking: rankInternals.buildFallbackRanking({
        holidayMap:  dataInternals.HOLIDAY_DESTINATIONS,
        cruiseMap:   dataInternals.CRUISE_DESTINATIONS,
        activityMap: dataInternals.ACTIVITY_DESTINATIONS,
        visaMap,
      }),
      source: 'fallback (--no-claude)',
      rationale: 'Forced via --no-claude flag',
      trendingThemes: [],
      webSearchCalls: 0,
    };
  } else {
    rankingResult = await rankTrendingWelcome();
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
  console.log(`  holidays       : ${ranking.holiday_keys.join(', ')}`);
  console.log(`  cruises        : ${ranking.cruise_keys.join(', ')}`);
  console.log(`  visas          : ${ranking.visa_keys.join(', ')}`);
  console.log(`  activities     : ${ranking.activity_keys.join(', ')}`);
  console.log(`  variants       : hero=${ranking.hero_variant_key} exclusive=${ranking.exclusive_variant_key}`);

  // 4. Build + render
  console.log('\n→ buildDay1WelcomeData');
  const data = await buildDay1WelcomeData({
    contactId: unifiedId || 'preview',
    ranking,
  });

  console.log('\n→ renderDay1Welcome');
  const html = renderDay1Welcome(TEMPLATE, data);
  console.log(`  rendered HTML  : ${html.length.toLocaleString()} chars`);
  fs.writeFileSync(RENDERED, html, 'utf8');
  console.log(`  output         : ${RENDERED.replace(ROOT + '/', '')}`);

  if (dryRun) {
    console.log('\n[DRY-RUN] skipping send.');
    process.exit(0);
  }

  // 5. Send
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
