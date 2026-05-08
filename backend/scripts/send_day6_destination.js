#!/usr/bin/env node
/**
 * Send the Day-6 Destination Spotlight email — Anthropic-ranked
 * (web-trending, per-destination), product-hydrated, SMTP-delivered.
 *
 * Pipeline:
 *   1. Look up unified_id (UTM rid).
 *   2. Day6DestinationRankingService.rankDestinationSpotlight({ destinationKey })
 *      → web-search-driven product picks for ONE destination.
 *   3. Day6DestinationDataService.buildDay6DestinationData() → hydrates
 *      data shape from `products` + `visa_products` tables.
 *   4. Day6DestinationRenderer.renderDay6Destination() → final HTML.
 *   5. EmailChannel.send → SMTP.
 *
 * Usage:
 *   node backend/scripts/send_day6_destination.js <recipient> [subject] \
 *        [--destination=<key>] [--dry-run] [--no-claude]
 *
 *   Default destination: singapore.
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
const { EmailChannel }                = await import('../src/services/channels/EmailChannel.js');
const { rankDestinationSpotlight, _internals: rankInternals } = await import('../src/services/Day6DestinationRankingService.js');
const { buildDay6DestinationData, _internals: dataInternals } = await import('../src/services/Day6DestinationDataService.js');
const { renderDay6Destination }       = await import('../src/services/Day6DestinationRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day6-destination-dynamic.html');
const RENDERED = path.join(ROOT, 'mail_templates', 'day6-destination-rendered.html');

function parseArgs(argv) {
  const positional = [];
  const flags = { destinationKey: 'singapore' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')                 flags.dryRun = true;
    else if (a === '--no-claude')          flags.noClaude = true;
    else if (a.startsWith('--destination=')) flags.destinationKey = a.split('=')[1];
    else                                    positional.push(a);
  }
  const recipients = positional.length > 0
    ? positional[0].split(',').map(s => s.trim()).filter(Boolean)
    : [];
  return { recipients, subject: positional[1], ...flags };
}

async function lookupUnifiedId(email) {
  if (!email) return null;
  try {
    const { rows: [u] } = await db.query(
      'SELECT unified_id FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
      [email]
    );
    return u?.unified_id || null;
  } catch (err) {
    console.warn(`[lookup] unified_contacts skipped: ${err.message}`);
    return null;
  }
}

async function main() {
  const { recipients, subject: subjArg, destinationKey, dryRun, noClaude } = parseArgs(process.argv.slice(2));
  if (recipients.length === 0 && !dryRun) {
    console.error('Usage: node backend/scripts/send_day6_destination.js <r1,r2,...> [subject] [--destination=singapore] [--dry-run] [--no-claude]');
    process.exit(1);
  }

  const dest = dataInternals.DESTINATION_CATALOG[destinationKey];
  if (!dest) {
    console.error(`[ERROR] unknown destination key: ${destinationKey}`);
    console.error(`Valid keys: ${Object.keys(dataInternals.DESTINATION_CATALOG).join(', ')}`);
    process.exit(1);
  }
  const subject = subjArg || `${dest.name}, Your Way — Rayna Tours`;
  console.log(`Recipients  : ${recipients.length > 0 ? recipients.join(', ') : '<dry-run>'}`);
  console.log(`Destination : ${destinationKey} (${dest.name}, ${dest.country})`);

  // 1. RANK ONCE — universal picks
  console.log('\n→ rankDestinationSpotlight (web-search-driven — runs ONCE for all recipients)');
  let rankingResult;
  if (noClaude) {
    const [holidayCandidates, activityCandidates, cruiseCandidates] = await Promise.all([
      rankInternals.fetchHolidayCandidates(dest.productCity),
      rankInternals.fetchActivityCandidates(dest.productCity),
      rankInternals.fetchCruiseCandidates(dest.cruiseCategory),
    ]);
    rankingResult = {
      ranking: rankInternals.buildFallbackRanking({ holidayCandidates, activityCandidates, cruiseCandidates }),
      source:  'fallback (--no-claude)',
      rationale:      'Forced via --no-claude flag',
      trendingThemes: [], safetyNotes: [], webSearchCalls: 0,
      candidates:     { holiday: holidayCandidates.length, activity: activityCandidates.length, cruise: cruiseCandidates.length },
    };
  } else {
    rankingResult = await rankDestinationSpotlight({ destinationKey });
  }
  const { ranking, source, rationale, trendingThemes, safetyNotes, webSearchCalls, model, usage, error, candidates } = rankingResult;
  console.log(`  source         : ${source}${model ? ` (${model})` : ''}`);
  console.log(`  candidates     : holiday=${candidates?.holiday ?? '?'} activity=${candidates?.activity ?? '?'} cruise=${candidates?.cruise ?? '?'}`);
  console.log(`  trending themes: ${(trendingThemes || []).join(' | ') || '(none)'}`);
  console.log(`  web searches   : ${webSearchCalls || 0}`);
  console.log(`  rationale      : ${rationale}`);
  if (safetyNotes && safetyNotes.length) {
    console.log(`  ⚠ safety notes :`);
    for (const n of safetyNotes) console.log(`     - ${n}`);
  }
  if (usage) console.log(`  tokens         : in=${usage.input_tokens || '?'} out=${usage.output_tokens || '?'}`);
  if (error) console.log(`  ⚠ error        : ${error}`);
  console.log(`  holiday_ids    : ${(ranking.holiday_ids  || []).join(', ')}`);
  console.log(`  activity_ids   : ${(ranking.activity_ids || []).join(', ')}`);
  console.log(`  cruise_ids     : ${(ranking.cruise_ids   || []).join(', ') || '(none)'}`);
  console.log(`  tagline_index  : ${ranking.tagline_index ?? 0}`);

  // 2. SEND TO EACH RECIPIENT — same ranking, per-user UTM rid
  if (dryRun && recipients.length === 0) {
    console.log('\n[DRY-RUN] no recipients given; rendering preview only.');
    const data = await buildDay6DestinationData({ contactId: 'preview', destinationKey, ranking });
    const html = renderDay6Destination(TEMPLATE, data);
    fs.writeFileSync(RENDERED, html, 'utf8');
    console.log(`  preview output : ${RENDERED.replace(ROOT + '/', '')}`);
    process.exit(0);
  }

  const results = [];
  for (const recipient of recipients) {
    console.log(`\n────────────── ${recipient} ──────────────`);
    const unifiedId = await lookupUnifiedId(recipient);
    console.log(`  unified_id     : ${unifiedId || 'none'}`);

    const data = await buildDay6DestinationData({ contactId: unifiedId || 'preview', destinationKey, ranking });
    const html = renderDay6Destination(TEMPLATE, data);
    fs.writeFileSync(RENDERED, html, 'utf8');

    const leftovers = [...html.matchAll(/\{\{[\w.]+\}\}/g)];
    if (leftovers.length > 0) {
      console.error(`  [FAIL] leftover placeholders: ${leftovers.slice(0,5).map(m=>m[0]).join(', ')}`);
      results.push({ recipient, success: false, error: 'placeholders left' });
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY-RUN] would send (${html.length.toLocaleString()} chars).`);
      results.push({ recipient, success: true, dryRun: true });
      continue;
    }

    const start = Date.now();
    const result = await EmailChannel.send({ to: recipient, subject, html });
    const ms = Date.now() - start;
    console.log(`  result         : ${result.success ? 'OK' : 'FAIL'} in ${ms}ms — ${result.externalId || result.error || ''}`);
    results.push({ recipient, ...result, ms });
  }

  console.log('\n────────────── SUMMARY ──────────────');
  for (const r of results) {
    console.log(`  ${r.success ? '✓' : '✗'}  ${r.recipient.padEnd(30)}  ${r.dryRun ? '[dry-run]' : (r.externalId || r.error || '')}`);
  }
  const ok = results.every(r => r.success);
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error(`[ERROR] ${err.stack || err}`);
  process.exit(1);
});
