#!/usr/bin/env node
/**
 * Send the Day-5 Activities email — Anthropic-ranked (web-trending),
 * product-hydrated, SMTP-delivered.
 *
 * Pipeline:
 *   1. Anthropic ranking ONCE (universal picks).
 *   2. For each recipient: look up unified_id, build data, render, send.
 *
 * Usage:
 *   node backend/scripts/send_day5_activities.js <r1,r2,r3> [subject] [--dry-run] [--no-claude]
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
const { EmailChannel }              = await import('../src/services/channels/EmailChannel.js');
const { rankTrendingActivities, _internals: rankInternals } = await import('../src/services/Day5ActivitiesRankingService.js');
const { buildDay5ActivitiesData }   = await import('../src/services/Day5ActivitiesDataService.js');
const { renderDay5Activities }      = await import('../src/services/Day5ActivitiesRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day5-activities-dynamic.html');
const RENDERED = path.join(ROOT, 'mail_templates', 'day5-activities-rendered.html');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run')        flags.dryRun = true;
    else if (a === '--no-claude') flags.noClaude = true;
    else                           positional.push(a);
  }
  // Recipients: comma-separated or multiple positional emails
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
  const { recipients, subject: subjArg, dryRun, noClaude } = parseArgs(process.argv.slice(2));
  if (recipients.length === 0 && !dryRun) {
    console.error('Usage: node backend/scripts/send_day5_activities.js <recipient1,recipient2,...> [subject] [--dry-run] [--no-claude]');
    process.exit(1);
  }
  const subject = subjArg || 'World-Class Activities, Instantly Booked — Rayna Tours';
  console.log(`Recipients : ${recipients.length > 0 ? recipients.join(', ') : '<dry-run>'}`);

  // 1. RANK ONCE — universal picks
  console.log('\n→ rankTrendingActivities (web-search-driven, universal — runs ONCE for all recipients)');
  let rankingResult;
  if (noClaude) {
    rankingResult = {
      ranking:       rankInternals.buildFallbackRanking(),
      source:        'fallback (--no-claude)',
      rationale:     'Forced via --no-claude flag',
      trendingThemes:[], webSearchCalls: 0,
    };
  } else {
    rankingResult = await rankTrendingActivities();
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
  console.log(`  cities         : ${ranking.city_keys.join(', ')}`);
  console.log(`  thrill         : ${ranking.thrill_keys.join(', ')}`);
  console.log(`  family         : ${ranking.family_keys.join(', ')}`);
  console.log(`  icons          : ${ranking.icons_keys.join(', ')}`);
  console.log(`  water          : ${ranking.water_keys.join(', ')}`);
  console.log(`  wildlife       : ${ranking.wildlife_keys.join(', ')}`);
  console.log(`  hero_activity  : ${ranking.hero_activity_key}`);
  console.log(`  variants       : hero=${ranking.hero_variant_key} offer=${ranking.limited_offer_variant_key}`);

  // 2. SEND TO EACH RECIPIENT — same ranking, per-user UTM rid
  if (dryRun && recipients.length === 0) {
    console.log('\n[DRY-RUN] no recipients given; rendering preview only.');
    const data = await buildDay5ActivitiesData({ contactId: 'preview', ranking });
    const html = renderDay5Activities(TEMPLATE, data);
    fs.writeFileSync(RENDERED, html, 'utf8');
    console.log(`  preview output : ${RENDERED.replace(ROOT + '/', '')}`);
    process.exit(0);
  }

  const results = [];
  for (const recipient of recipients) {
    console.log(`\n────────────── ${recipient} ──────────────`);
    const unifiedId = await lookupUnifiedId(recipient);
    console.log(`  unified_id     : ${unifiedId || 'none'}`);

    const data = await buildDay5ActivitiesData({ contactId: unifiedId || 'preview', ranking });
    const html = renderDay5Activities(TEMPLATE, data);
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

  // 3. SUMMARY
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
