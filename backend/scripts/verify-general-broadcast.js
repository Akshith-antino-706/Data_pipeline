/**
 * Dry-run verification of the general-broadcast journey, end-to-end up to the
 * BullMQ enqueue (which we don't actually invoke since Redis is optional).
 *
 *   node backend/scripts/verify-general-broadcast.js [journeyId=120]
 *
 * Steps:
 *   1. Load the journey, list its action nodes.
 *   2. Take a popularity snapshot (uses simulation if POPULARITY_API_URL unset).
 *   3. Pick one enrolled test user.
 *   4. Render renderForJourneyNode() against the real DB + snapshot.
 *   5. Write the rendered HTML to /tmp and report size, slots filled, broken
 *      placeholders, and the worker-job payload that *would* be enqueued.
 */
import 'dotenv/config';
import fs from 'fs';
import { randomUUID } from 'crypto';
import db from '../src/config/database.js';
import EmailRenderer from '../src/services/EmailRenderer.js';
import PopularityService from '../src/services/PopularityService.js';

const journeyId = parseInt(process.argv[2] || '120');

async function main() {
  // 1. Journey + first action node
  const { rows: [journey] } = await db.query('SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]);
  if (!journey) throw new Error(`journey ${journeyId} not found`);
  console.log(`Journey: ${journey.name}  (audience=${journey.audience}, status=${journey.status})`);

  const actionNodes = (journey.nodes || []).filter(n => n.type === 'action');
  if (actionNodes.length === 0) throw new Error('No action nodes on journey');
  const action = actionNodes[0];
  console.log(`Action node: ${action.id}  → templateId=${action.data?.templateId}  channel=${action.data?.channel}`);

  // 2. Resolve the html_template
  const { rows: [tpl] } = await db.query(
    `SELECT eht.id AS html_template_id, eht.uses_popular_products, eht.product_type, eht.product_limit
       FROM content_templates ct
       JOIN email_html_templates eht ON eht.id = ct.html_template_id
      WHERE ct.id = $1`,
    [parseInt(action.data.templateId)]
  );
  if (!tpl) throw new Error(`content_template ${action.data.templateId} has no linked html_template`);
  console.log(`HTML template: id=${tpl.html_template_id}  uses_popular_products=${tpl.uses_popular_products}  product_type=${tpl.product_type}`);

  // 3. Popularity snapshot for this run
  const runId = randomUUID();
  console.log(`\nRun id: ${runId}`);
  console.log(`Popularity API: ${PopularityService.isConfigured() ? 'configured' : 'simulation mode'}`);

  // Discover themes from the template HTML (mirrors what processJourney does)
  const { rows: [htmlRow] } = await db.query('SELECT html_body FROM email_html_templates WHERE id = $1', [tpl.html_template_id]);
  const themes = [...new Set(
    [...(htmlRow.html_body.matchAll(/<!--\s*SLOT:product_grid\s+([^>]*?)-->/g))].map(m => {
      const a = {}; for (const x of m[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) a[x[1]] = x[2];
      return a.product_type === tpl.product_type ? (a.theme || null) : undefined;
    }).filter(t => t !== undefined)
  )];
  console.log(`Discovered themes: ${themes.map(t => t || '_default').join(', ')}`);

  await PopularityService.snapshot({
    journeyId, nodeId: action.id, runId,
    productType: tpl.product_type, themes,
    limit: tpl.product_limit || undefined,
  });

  const { rows: snap } = await db.query(
    `SELECT theme, position, name, location, price FROM popularity_snapshots
      WHERE journey_id=$1 AND node_id=$2 AND run_id=$3 ORDER BY theme, position`,
    [journeyId, action.id, runId]
  );
  console.log(`\nSnapshot rows (${snap.length}):`);
  for (const r of snap) console.log(`  · [${r.theme || '_'}#${r.position}] ${r.name}  (${r.location})  ${r.price}`);

  // 4. Pick one enrolled entry
  const { rows: entries } = await db.query(
    `SELECT je.entry_id, je.customer_id, uc.name, uc.email
       FROM journey_entries je JOIN unified_contacts uc ON uc.unified_id = je.customer_id
      WHERE je.journey_id = $1 AND je.status='active' LIMIT 1`,
    [journeyId]
  );
  if (entries.length === 0) {
    console.log(`\n⚠ No active entries for journey ${journeyId} — run --enroll=test on the seeder first.`);
    process.exit(0);
  }
  const entry = entries[0];
  console.log(`\nRendering for: ${entry.name} <${entry.email}>  (entry=${entry.entry_id}, uid=${entry.customer_id})`);

  // 5. Render
  const rendered = await EmailRenderer.renderForJourneyNode({
    htmlTemplateId: tpl.html_template_id,
    unifiedId:      entry.customer_id,
    journeyId,
    nodeId:         action.id,
    runId,
  });

  const out = `/tmp/journey-${journeyId}-${entry.entry_id}.html`;
  fs.writeFileSync(out, rendered.html);
  console.log(`\n✓ Rendered → ${out}`);
  console.log(`  subject:      "${rendered.subject}"`);
  console.log(`  html bytes:   ${rendered.html.length.toLocaleString()}`);
  console.log(`  slots filled: ${rendered.slotsFilled}`);

  // Sanity checks
  const remainingSlots = (rendered.html.match(/SLOT:product_grid/g) || []).length;
  const remainingVars  = (rendered.html.match(/\{\{[a-z_]+\}\}/g) || []).length;
  const utmHrefs       = (rendered.html.match(/utm_source=/g) || []).length;
  console.log(`  unfilled SLOTs:   ${remainingSlots}  (should be 0)`);
  console.log(`  unfilled {{vars}}: ${remainingVars}  (template currently has none, so expect 0)`);
  console.log(`  UTM-tagged hrefs: ${utmHrefs}`);

  // 6. Show the worker-job payload that would be enqueued
  const sample = {
    entryId: entry.entry_id, customerId: entry.customer_id,
    journeyId, nodeId: action.id, runId,
    channel: 'email',
    templateId: parseInt(action.data.templateId),
    htmlTemplateId: tpl.html_template_id,
    name: entry.name, email: entry.email, phone: '<from uc>',
    track: 'indian-or-rest', edges: '<edges array>', nodes: '<node map>',
  };
  console.log(`\nWorker-job payload preview:\n${JSON.stringify(sample, null, 2)}`);

  console.log(`\nAll producer-side logic verified. To run the actual send:
  1. Install + start Redis:    brew install redis && brew services start redis
  2. Set CHATHEAD_API_TOKEN in .env (else email runs in simulation mode)
  3. Start workers:            node backend/scripts/start-workers.js
  4. Trigger journey:          curl -X POST 'http://localhost:3001/api/v3/journeys/${journeyId}/process'`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
