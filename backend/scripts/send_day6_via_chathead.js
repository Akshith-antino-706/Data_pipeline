#!/usr/bin/env node
/**
 * Send the Day-6 Destination Spotlight email via the Chathead API.
 * Ranks once per destination (one Claude call), then renders+sends per
 * recipient so each gets their own unified_id-based UTM rid.
 *
 * Usage: node backend/scripts/send_day6_via_chathead.js <r1> [r2] ... [--destination=<key>] [--no-claude]
 *
 *   --destination=<key>  defaults to "singapore" — see DESTINATION_CATALOG keys
 *   --no-claude          skip Claude rank, use fallback picks
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
const { rankDestinationSpotlight, _internals: rankInternals } = await import('../src/services/Day6DestinationRankingService.js');
const { buildDay6DestinationData, _internals: dataInternals } = await import('../src/services/Day6DestinationDataService.js');
const { renderDay6Destination } = await import('../src/services/Day6DestinationRenderer.js');

const TEMPLATE = path.join(ROOT, 'mail_templates', 'day6-destination-dynamic.html');

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

function parseArgs(argv) {
  const recipients = [];
  let destinationKey = 'singapore';
  let noClaude = false;
  for (const a of argv) {
    if (a === '--no-claude') noClaude = true;
    else if (a.startsWith('--destination=')) destinationKey = a.split('=')[1];
    else if (a.includes('@')) recipients.push(a);
  }
  return { recipients, destinationKey, noClaude };
}

async function main() {
  const { recipients, destinationKey, noClaude } = parseArgs(process.argv.slice(2));
  if (!recipients.length) {
    console.error('Usage: node backend/scripts/send_day6_via_chathead.js <r1> [r2] ... [--destination=<key>] [--no-claude]');
    process.exit(1);
  }
  if (!ChatheadEmailChannel.isConfigured()) {
    console.error('CHATHEAD_API_TOKEN missing — aborting to avoid silent no-send.');
    process.exit(1);
  }

  const dest = dataInternals.DESTINATION_CATALOG[destinationKey];
  if (!dest) {
    console.error(`[ERROR] unknown destination key: ${destinationKey}`);
    console.error(`Available: ${Object.keys(dataInternals.DESTINATION_CATALOG).join(', ')}`);
    process.exit(1);
  }

  const SUBJECT = `${dest.name}, Your Way — Rayna Tours`;
  console.log(`Destination : ${destinationKey} (${dest.name}, ${dest.country})`);
  console.log(`Recipients (${recipients.length}): ${recipients.join(', ')}`);

  console.log('\n→ rankDestinationSpotlight (one call, shared across recipients)');
  let rankingResult;
  if (noClaude) {
    rankingResult = { ranking: rankInternals.buildFallbackRanking({ destinationKey }), source: 'fallback' };
  } else {
    rankingResult = await rankDestinationSpotlight({ destinationKey });
  }
  const { ranking, source } = rankingResult;
  console.log(`  source : ${source}`);

  const results = [];
  for (const to of recipients) {
    const unifiedId = await lookupUnifiedId(to);
    console.log(`\n→ ${to}  unified_id=${unifiedId || 'preview'}`);
    const data = await buildDay6DestinationData({ contactId: unifiedId || 'preview', destinationKey, ranking });
    const html = renderDay6Destination(TEMPLATE, data);
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
