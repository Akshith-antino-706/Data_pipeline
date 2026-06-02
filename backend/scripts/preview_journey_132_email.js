/**
 * Preview the Day 1 Welcome email that journey 132 is currently sending.
 * Uses the EXACT same render path workers.js uses — so what you see is
 * what your customers are getting.
 *
 * Run: node backend/scripts/preview_journey_132_email.js
 * Then open: backend/scripts/journey_132_preview.html in a browser.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderDayHtml } from '../src/services/JourneyService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const TEMPLATE_ID = 1;
  const CONTACT_ID  = 1;         // any id works for preview
  const JOURNEY_ID  = 132;
  const NODE_ID     = 'node_1';

  console.log(`Rendering template ${TEMPLATE_ID} (journey=${JOURNEY_ID}, node=${NODE_ID}) ...`);
  const { html, subject } = await renderDayHtml(TEMPLATE_ID, CONTACT_ID, {
    journeyId: JOURNEY_ID,
    nodeId:    NODE_ID,
  });

  const outPath = path.join(__dirname, 'journey_132_preview.html');
  fs.writeFileSync(outPath, html, 'utf8');

  console.log(`\n✓ Rendered`);
  console.log(`  Subject: "${subject}"`);
  console.log(`  HTML size: ${html.length} bytes`);
  console.log(`  Output: ${outPath}`);
  console.log(`\nOpen it:`);
  console.log(`  open ${outPath}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
