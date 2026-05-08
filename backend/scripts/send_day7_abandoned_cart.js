#!/usr/bin/env node
/**
 * Send the Day-7 Abandoned Cart email — GA4 browse-history hydrated, with
 * Anthropic-trending fallback / variant copy, SMTP-delivered.
 *
 * Pipeline:
 *   1. Anthropic ranking ONCE (universal fallback picks + variant copy).
 *   2. For each recipient: GA4 history lookup → backfill from ranking →
 *      render → send. Recipients with their own browse history see those
 *      cards first; fallback fills any remaining slots.
 *
 * Usage:
 *   node backend/scripts/send_day7_abandoned_cart.js <r1,r2,r3> [subject] [--dry-run] [--no-claude]
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
const { rankAbandonedCartFallback, _internals: rankInternals } = await import('../src/services/Day7AbandonedCartRankingService.js');
const { buildDay7AbandonedCartData }  = await import('../src/services/Day7AbandonedCartDataService.js');
const { renderDay7AbandonedCart }     = await import('../src/services/Day7AbandonedCartRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day7-abandoned-cart-dynamic.html');
const RENDERED = path.join(ROOT, 'mail_templates', 'day7-abandoned-cart-rendered.html');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--dry-run')   flags.dryRun = true;
    else if (a === '--no-claude') flags.noClaude = true;
    else                           positional.push(a);
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
  const { recipients, subject: subjArg, dryRun, noClaude } = parseArgs(process.argv.slice(2));
  if (recipients.length === 0 && !dryRun) {
    console.error('Usage: node backend/scripts/send_day7_abandoned_cart.js <r1,r2,...> [subject] [--dry-run] [--no-claude]');
    process.exit(1);
  }
  const subject = subjArg || "You Left Something Behind — Rayna Tours";
  console.log(`Recipients : ${recipients.length > 0 ? recipients.join(', ') : '<dry-run>'}`);

  // 1. RANK ONCE — universal fallback picks + variants
  console.log('\n→ rankAbandonedCartFallback (web-search-driven — runs ONCE for all recipients)');
  let rankingResult;
  if (noClaude) {
    const [activities, holidays, cruises, visas] = await Promise.all([
      rankInternals.fetchCandidates('activities'),
      rankInternals.fetchCandidates('holiday'),
      rankInternals.fetchCandidates('cruise'),
      rankInternals.fetchVisaKeys(),
    ]);
    rankingResult = {
      ranking: rankInternals.buildFallbackRanking({ activities, holidays, cruises, visas }),
      source: 'fallback (--no-claude)',
      rationale: 'Forced via --no-claude flag',
      trendingThemes: [], safetyNotes: [], webSearchCalls: 0,
      candidates: { activities: activities.length, holidays: holidays.length, cruises: cruises.length, visas: visas.length },
    };
  } else {
    rankingResult = await rankAbandonedCartFallback();
  }
  const { ranking, source, rationale, trendingThemes, safetyNotes, webSearchCalls, model, usage, error, candidates } = rankingResult;
  console.log(`  source         : ${source}${model ? ` (${model})` : ''}`);
  console.log(`  candidates     : act=${candidates?.activities ?? '?'} hol=${candidates?.holidays ?? '?'} cru=${candidates?.cruises ?? '?'} visa=${candidates?.visas ?? '?'}`);
  console.log(`  trending themes: ${(trendingThemes || []).join(' | ') || '(none)'}`);
  console.log(`  web searches   : ${webSearchCalls || 0}`);
  console.log(`  rationale      : ${rationale}`);
  if (safetyNotes && safetyNotes.length) {
    console.log(`  ⚠ safety notes :`);
    for (const n of safetyNotes) console.log(`     - ${n}`);
  }
  if (usage) console.log(`  tokens         : in=${usage.input_tokens || '?'} out=${usage.output_tokens || '?'}`);
  if (error) console.log(`  ⚠ error        : ${error}`);
  console.log(`  fallback_ids   : ${(ranking.fallback_ids || []).join(', ')}`);
  console.log(`  visa_key       : ${ranking.fallback_visa_key || '(none)'}`);
  console.log(`  variants       : hero=${ranking.hero_variant_key} urgency=${ranking.urgency_variant_key} final=${ranking.final_variant_key}`);

  // 2. SEND TO EACH RECIPIENT — same ranking, per-user GA4 history + UTM rid
  if (dryRun && recipients.length === 0) {
    console.log('\n[DRY-RUN] no recipients given; rendering preview only.');
    const data = await buildDay7AbandonedCartData({ contactId: null, ranking });
    const html = renderDay7AbandonedCart(TEMPLATE, data);
    fs.writeFileSync(RENDERED, html, 'utf8');
    console.log(`  preview output : ${RENDERED.replace(ROOT + '/', '')}`);
    process.exit(0);
  }

  const results = [];
  for (const recipient of recipients) {
    console.log(`\n────────────── ${recipient} ──────────────`);
    const unifiedId = await lookupUnifiedId(recipient);
    console.log(`  unified_id     : ${unifiedId || 'none'}`);

    const data = await buildDay7AbandonedCartData({ contactId: unifiedId, ranking });
    console.log(`  cards          : ${data.browsed_experiences.length}`);
    for (const card of data.browsed_experiences) {
      console.log(`    - ${card.name.padEnd(45).slice(0,45)}  ${card.price}`);
    }
    const html = renderDay7AbandonedCart(TEMPLATE, data);
    fs.writeFileSync(RENDERED, html, 'utf8');

    const leftoverVars   = [...html.matchAll(/\{\{[\w.]+\}\}/g)];
    const leftoverBlocks = [...html.matchAll(/\{\{[#/](list|if)/g)];
    if (leftoverVars.length > 0 || leftoverBlocks.length > 0) {
      console.error(`  [FAIL] leftover placeholders`);
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
