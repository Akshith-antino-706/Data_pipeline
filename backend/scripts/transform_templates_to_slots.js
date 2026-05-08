/**
 * One-shot transform: replace the hardcoded product-grid blocks in
 * day2/day4/day5 templates with `<!-- SLOT:product_grid ... -->` markers
 * that EmailRenderer.expandProductSlots fills from popularity_snapshots.
 *
 * Run once: node backend/scripts/transform_templates_to_slots.js
 *
 * The script anchors on a known-unique product name inside each grid (e.g.
 * "Jebel Jais Zipline"), then walks balanced <table>/</table> tags to find
 * the exact outer-grid <table>...</table> span to replace.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', 'mail_templates');

function findGridContaining(html, anchorText) {
  const anchorIdx = html.indexOf(anchorText);
  if (anchorIdx < 0) throw new Error(`Anchor not found: ${anchorText}`);

  // Walk backwards to find the nearest preceding outer <table ...> opener.
  // The "outer" grid is the one with style="width: 100%; border-collapse: collapse"
  // immediately wrapping a <tr><td width="50%"... layout.
  const openMarker = 'style="width: 100%; border-collapse: collapse"';
  let openMarkerIdx = html.lastIndexOf(openMarker, anchorIdx);
  if (openMarkerIdx < 0) throw new Error(`Open marker not found before ${anchorText}`);

  // Step back to the actual `<table` start.
  const tableStart = html.lastIndexOf('<table', openMarkerIdx);
  if (tableStart < 0) throw new Error(`<table start not found for ${anchorText}`);

  // Walk forward from tableStart, balancing <table>/</table> until depth returns to 0.
  let depth = 0;
  let i = tableStart;
  const re = /<\s*\/?\s*table\b/gi;
  re.lastIndex = i;
  let last;
  while ((last = re.exec(html)) !== null) {
    const tag = last[0];
    if (/^<\s*table/i.test(tag)) depth++;
    else depth--;
    if (depth === 0) {
      const end = html.indexOf('>', last.index);
      if (end < 0) throw new Error(`Unterminated </table> after ${anchorText}`);
      return { start: tableStart, end: end + 1 };
    }
  }
  throw new Error(`Unbalanced table for ${anchorText}`);
}

function replaceGrid(html, anchorText, slotComment) {
  const { start, end } = findGridContaining(html, anchorText);
  return html.slice(0, start) + slotComment + html.slice(end);
}

function transform(filename, replacements) {
  const fullPath = path.join(ROOT, filename);
  const original = fs.readFileSync(fullPath, 'utf8');
  let html = original;

  for (const r of replacements) {
    html = replaceGrid(html, r.anchor, r.slot);
  }

  if (html === original) {
    console.log(`  ${filename}: no changes`);
    return;
  }

  fs.writeFileSync(fullPath, html);
  console.log(`  ${filename}: replaced ${replacements.length} grid(s) (${original.length}→${html.length} bytes)`);
}

// ────────────────────────────────────────────────────────────────

// v1 transforms: day5 only. day5 has two clean 2x2 grids of activity cards —
// the perfect fit for the popular-products SLOT mechanism. day2 (cruise) and
// day4 (holiday) use heterogeneous per-card layouts (hero cards, dividers,
// custom descriptions) and need per-card token substitution rather than
// grid-level replacement; that's deferred to v2.

console.log('Transforming product-card grids → SLOT markers');

transform('day5-activities-emailer.html', [
  { anchor: 'Jebel Jais Zipline',                  // "Thrill & Adventure Picks"
    slot:   '<!-- SLOT:product_grid product_type="activity" theme="thrill" count="4" cols="2" -->' },
  { anchor: 'IMG Worlds of Adventure',             // "Family Fun Favorites"
    slot:   '<!-- SLOT:product_grid product_type="activity" theme="family" count="4" cols="2" -->' },
  { anchor: 'Burj Khalifa At The Top',             // "Must-Visit Icons"
    slot:   '<!-- SLOT:product_grid product_type="activity" theme="icons" count="4" cols="2" -->' },
  { anchor: 'Dhow Cruise Dinner - Marina',         // "Cruises, Waterparks & Islands"
    slot:   '<!-- SLOT:product_grid product_type="activity" theme="cruises_and_islands" count="4" cols="2" -->' },
  { anchor: 'Dubai Aquarium &amp; Underwater Zoo', // "Wildlife Wonders"
    slot:   '<!-- SLOT:product_grid product_type="activity" theme="wildlife" count="4" cols="2" -->' },
]);

console.log('Done.');
