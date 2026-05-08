/**
 * One-shot transform: append a "Popular Right Now" section with a single
 * SLOT:product_grid marker to day1, day2, day3, day4 templates.
 *
 * Inserted right BEFORE the "Follow Us O[n/N]" footer row, so it stays inside
 * the existing email frame (same width, padding, fonts) and renders just above
 * the social-icons block.
 *
 * Run once: node backend/scripts/append_popular_section.js
 *
 * Idempotent — looks for an existing SLOT marker first and skips if present.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', 'mail_templates');

/**
 * Build the "Popular Right Now" block. Sized to match the day5 themed-section
 * chrome (heading + subhead + 2x2 product grid via SLOT marker).
 */
function popularBlock({ kicker, headline, subhead, productType, theme, count = 4 }) {
  const themeAttr = theme ? ` theme="${theme}"` : '';
  return `            <tr>
              <td align="center" style="padding: 44px 24px 8px; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #1a1a1a;">
                ${kicker}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 0 24px 10px; font-family: Georgia, serif; font-size: 36px; line-height: 40px; color: #1a1a1a;">
                ${headline}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 0 40px 22px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 21px; color: #7a7570;">
                ${subhead}
              </td>
            </tr>
            <tr>
              <td style="padding: 0 16px 0">
                <!-- SLOT:product_grid product_type="${productType}"${themeAttr} count="${count}" cols="2" -->
              </td>
            </tr>

`;
}

function insertBeforeFooter(html, block) {
  if (html.includes('SLOT:product_grid')) {
    // Already has at least one SLOT — assume the popular section was previously
    // appended, do nothing. (day5 falls into this branch and is unchanged.)
    return { html, changed: false, reason: 'already has SLOT marker(s)' };
  }

  // Find the "Follow Us" footer text (case-insensitive: matches "Follow Us on" or "Follow Us On").
  const m = html.match(/Follow Us [Oo]n/);
  if (!m) return { html, changed: false, reason: 'no Follow Us anchor' };
  const anchorIdx = m.index;

  // Walk backwards to find the enclosing `<tr` opener so we insert the new
  // block as a sibling row, not in the middle of one.
  const trIdx = html.lastIndexOf('<tr', anchorIdx);
  if (trIdx < 0) return { html, changed: false, reason: 'no enclosing <tr>' };

  // The line probably starts with whitespace — preserve indentation by snapping
  // back to the start of the line.
  let lineStart = html.lastIndexOf('\n', trIdx) + 1;
  if (lineStart < 0) lineStart = 0;

  return {
    html: html.slice(0, lineStart) + block + html.slice(lineStart),
    changed: true,
  };
}

function transform(filename, slotConfig) {
  const fullPath = path.join(ROOT, filename);
  const original = fs.readFileSync(fullPath, 'utf8');
  const block = popularBlock(slotConfig);
  const { html, changed, reason } = insertBeforeFooter(original, block);
  if (!changed) {
    console.log(`  ${filename}: skipped (${reason})`);
    return;
  }
  fs.writeFileSync(fullPath, html);
  console.log(`  ${filename}: appended ${slotConfig.productType}${slotConfig.theme ? '/'+slotConfig.theme : ''} SLOT  (${original.length}→${html.length} bytes)`);
}

// ────────────────────────────────────────────────────────────────

console.log('Appending "Popular Right Now" SLOT to day1–day4 templates…');

transform('day1-welcome-emailer.html', {
  kicker:   'Trending This Week',
  headline: 'Popular Activities Right Now',
  subhead:  'Hand-picked experiences other travellers are booking — from skyline thrills to family adventures.',
  productType: 'activity',
  count: 4,
});

transform('day2-cruise-emailer.html', {
  kicker:   'Sailings Loved by Travellers',
  headline: 'Popular Cruise Picks',
  subhead:  'The most-booked cruise sailings this season — Mediterranean, Red Sea, Northern Europe.',
  productType: 'cruise',
  count: 4,
});

transform('day3-visa-emailer.html', {
  kicker:   'Plan Your Next Trip',
  headline: 'Popular Activities Right Now',
  subhead:  'Once your visa is sorted, these are the experiences travellers can\'t stop booking.',
  productType: 'activity',
  count: 4,
});

transform('day4-holidays-emailer.html', {
  kicker:   'Most-Booked Holidays',
  headline: 'Popular Holiday Packages',
  subhead:  'The packages travellers are picking right now — curated, fully managed, ready to book.',
  productType: 'holiday',
  count: 4,
});

console.log('Done.');
