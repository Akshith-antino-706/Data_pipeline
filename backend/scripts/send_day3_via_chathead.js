#!/usr/bin/env node
/**
 * Send the Day-3 Visa email to a list of recipients via the Chathead API.
 * Ranks once (one Claude call), then renders+sends per recipient so each
 * gets their own unified_id-based UTM rid.
 *
 * Usage: node backend/scripts/send_day3_via_chathead.js <r1> [r2] ... [--no-claude]
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
const { rankTrendingVisas, _internals: rankInternals } = await import('../src/services/VisaRankingService.js');
const { buildDay3VisaData }    = await import('../src/services/Day3VisaDataService.js');
const { renderDay3Visa }       = await import('../src/services/Day3VisaRenderer.js');

const TEMPLATE     = path.join(ROOT, 'mail_templates', 'day3-visa-dynamic.html');
const SUBJECT      = 'Visa Made Easy: Your Gateway to the World';
const RATINGS_KEYS = ['rayna', 'trustpilot', 'tripadvisor', 'google'];

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
  const args        = process.argv.slice(2);
  const noClaude    = args.includes('--no-claude');
  const recipients  = args.filter(a => a !== '--no-claude' && a.includes('@'));
  if (!recipients.length) {
    console.error('Usage: node backend/scripts/send_day3_via_chathead.js <r1> [r2] ... [--no-claude]');
    process.exit(1);
  }
  if (!ChatheadEmailChannel.isConfigured()) {
    console.error('CHATHEAD_API_TOKEN missing — aborting to avoid silent no-send.');
    process.exit(1);
  }

  console.log(`Recipients (${recipients.length}): ${recipients.join(', ')}`);

  console.log('\n→ rankTrendingVisas (one call, shared across recipients)');
  let rankingResult;
  if (noClaude) {
    const catalog = await rankInternals.loadVisaCatalog();
    rankingResult = { ranking: rankInternals.buildFallbackRanking(catalog), source: 'fallback' };
  } else {
    rankingResult = await rankTrendingVisas();
  }
  const fullRanking = { ...rankingResult.ranking, ratings_keys: RATINGS_KEYS };
  console.log(`  source : ${rankingResult.source}`);

  const results = [];
  for (const to of recipients) {
    const unifiedId = await lookupUnifiedId(to);
    console.log(`\n→ ${to}  unified_id=${unifiedId || 'preview'}`);
    const data = await buildDay3VisaData({ contactId: unifiedId || 'preview', ranking: fullRanking });
    const html = renderDay3Visa(TEMPLATE, data);
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
