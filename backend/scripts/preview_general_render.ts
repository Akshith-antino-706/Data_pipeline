/**
 * Offline preview of the SLOT-expansion pipeline. No DB / no Redis required.
 *
 *   node backend/scripts/preview_general_render.js [outPath=/tmp/day5-preview.html]
 *
 * Reads mail_templates/day5-activities-emailer.html, fetches simulated popular
 * products via PopularityService (no API key needed), expands every
 * <!-- SLOT:product_grid ... --> marker through EmailRenderer.expandProductSlots,
 * does the {{first_name}}/{{utm_link}}/{{unsubscribe_link}} substitutions, and
 * writes the rendered HTML to disk. Open it in a browser to visually verify.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import EmailRenderer from '../src/services/EmailRenderer.js';
import PopularityService from '../src/services/PopularityService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(HERE, '..', '..', 'mail_templates', 'day5-activities-emailer.html');
const OUT_PATH = process.argv[2] || '/tmp/day5-preview.html';

const THEMES = ['thrill', 'family', 'icons', 'cruises_and_islands', 'wildlife'];

async function main() {
  const html_in = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  // Build an in-memory snapshot stand-in that mirrors what
  // PopularityService.snapshot() would write to popularity_snapshots if a
  // journey run were active. We bypass DB by directly building the per-theme
  // grouped map and patching getSnapshot for this preview only.
  const grouped = new Map();
  for (const theme of THEMES) {
    const products = await PopularityService.fetchTopProducts({
      productType: 'activity', limit: 4, theme,
    });
    grouped.set(theme, products.map((p, i) => ({ position: i + 1, ...p })));
  }
  // Patch getSnapshot for this run only — no DB calls inside expandProductSlots.
  const originalGetSnapshot = PopularityService.getSnapshot;
  PopularityService.getSnapshot = async ({ productType }) => {
    if (productType !== 'activity') return new Map();
    return grouped;
  };

  // Mock user vars (no DB lookup either).
  const utmLink = 'https://www.raynatours.com/?utm_source=preview&utm_medium=email&utm_campaign=day5_general';
  let html = html_in;
  const vars = {
    first_name: 'Akshith',
    full_name: 'Akshith Kumar',
    utm_link: utmLink,
    unsubscribe_link: 'https://www.raynatours.com/unsubscribe?uid=preview',
  };
  for (const [k, v] of Object.entries(vars)) {
    html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }

  const { html: filled, slotsFilled } = await EmailRenderer.expandProductSlots({
    html,
    journeyId: 0, nodeId: 'preview', runId: randomUUID(),
    fallbackProductType: 'activity',
    utmLink,
  });

  const finalHtml = EmailRenderer.injectUTMLinks(filled, utmLink);

  fs.writeFileSync(OUT_PATH, finalHtml);
  console.log(`✓ Rendered preview → ${OUT_PATH}`);
  console.log(`  slots filled: ${slotsFilled}/${THEMES.length}`);
  console.log(`  bytes: ${html_in.length} (template) → ${finalHtml.length} (rendered)`);

  PopularityService.getSnapshot = originalGetSnapshot;
}

main().catch(err => { console.error(err); process.exit(1); });
