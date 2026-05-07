/**
 * Render every day template end-to-end against PopularityService (sim mode if
 * POPULARITY_API_URL is unset) and confirm SLOTs expand.
 *
 *   node backend/scripts/preview_all_days.js
 *
 * Hits the DB to look up each content_template → html_template, takes a
 * popularity snapshot per (journey_id, node_id, run_id), then renders.
 * Writes /tmp/preview-day{N}.html for each.
 */
import 'dotenv/config';
import fs from 'fs';
import { randomUUID } from 'crypto';
import db from '../src/config/database.js';
import EmailRenderer from '../src/services/EmailRenderer.js';
import PopularityService from '../src/services/PopularityService.js';

const JOURNEY_ID = parseInt(process.argv[2] || '120');

async function main() {
  const { rows: [journey] } = await db.query(
    'SELECT name, nodes FROM journey_flows WHERE journey_id = $1', [JOURNEY_ID]);
  if (!journey) throw new Error(`journey ${JOURNEY_ID} not found`);
  console.log(`Journey: ${journey.name}\n`);

  const actionNodes = (journey.nodes || []).filter(n =>
    n.type === 'action' && n.data?.channel === 'email');

  // Pick any active entry for personalization (just need a unified_id).
  const { rows: [entry] } = await db.query(
    `SELECT je.customer_id FROM journey_entries je
       WHERE je.journey_id = $1 AND je.status IN ('active','completed') LIMIT 1`,
    [JOURNEY_ID]);
  const unifiedId = entry?.customer_id || null;
  console.log(`Personalizing as unified_id=${unifiedId || '(none — generic)'}\n`);

  for (const node of actionNodes) {
    const tplId = parseInt(node.data.templateId);
    const { rows: [cfg] } = await db.query(
      `SELECT eht.id AS html_template_id, eht.name AS html_name, eht.uses_popular_products,
              eht.product_type, eht.product_limit, eht.html_body
         FROM content_templates ct
         JOIN email_html_templates eht ON eht.id = ct.html_template_id
        WHERE ct.id = $1`, [tplId]);
    if (!cfg) { console.log(`  ✗ ${node.id}: no html template linked`); continue; }

    const runId = randomUUID();
    let snapshotInfo = '(no snapshot)';
    if (cfg.uses_popular_products) {
      // Discover themes the renderer will look for in this template
      const themes = [...new Set(
        [...cfg.html_body.matchAll(/<!--\s*SLOT:product_grid\s+([^>]*?)-->/g)]
          .map(m => {
            const a = {}; for (const x of m[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) a[x[1]] = x[2];
            return a.product_type === cfg.product_type ? (a.theme || null) : undefined;
          })
          .filter(t => t !== undefined)
      )];
      await PopularityService.snapshot({
        journeyId: JOURNEY_ID, nodeId: node.id, runId,
        productType: cfg.product_type, themes, limit: cfg.product_limit,
      });
      snapshotInfo = `${cfg.product_type} (themes: ${themes.map(t => t || '_default').join(', ')})`;
    }

    const rendered = await EmailRenderer.renderForJourneyNode({
      htmlTemplateId: cfg.html_template_id,
      unifiedId,
      journeyId: JOURNEY_ID, nodeId: node.id, runId,
    });

    const out = `/tmp/preview-${node.id}.html`;
    fs.writeFileSync(out, rendered.html);

    const remainingSlots = (rendered.html.match(/SLOT:product_grid/g) || []).length;
    console.log(`✓ ${cfg.html_name.padEnd(35)}  slots=${rendered.slotsFilled} unfilled=${remainingSlots}  bytes=${rendered.html.length.toLocaleString().padStart(7)}  → ${out}`);
    console.log(`    snapshot: ${snapshotInfo}`);
  }

  console.log('\nOpen the /tmp/preview-*.html files to visually verify all 5 templates render with popular products.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
