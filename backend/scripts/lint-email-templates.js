#!/usr/bin/env node
/**
 * Email template + data service linter
 *
 * Scans for known-bad patterns that have caused production bugs.
 * Run before any email-related change ships:
 *
 *   node backend/scripts/lint-email-templates.js
 *
 * Exits 0 if clean, 1 if any rule fails — wire into CI / pre-commit hook.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..', '..');

const SCAN_DIRS = [
  join(ROOT, 'mail_templates'),
  join(ROOT, 'backend', 'src', 'services'),
  join(ROOT, 'backend', 'src', 'utils'),
];

// Files we shouldn't scan
const SKIP_FILE = (p) =>
  p.includes('-rendered.html') ||      // generated snapshots
  p.endsWith('lint-email-templates.js') ||
  p.endsWith('_fix_mojibake.py');

// Files allowed to define the canonical strings (so the helper itself isn't flagged)
const SOURCE_OF_TRUTH = {
  email:   ['utils/brand.js'],
  phone:   ['utils/brand.js'],
  unsub:   ['utils/brand.js'],
  star:    ['utils/platformRatings.js'],
};

const RULES = [
  {
    id:    'no-legacy-email',
    desc:  'info@raynatours.com is deprecated. Import { CONTACT } from utils/brand.js.',
    regex: /info@raynatours\.com/,
    allow: SOURCE_OF_TRUTH.email,
  },
  {
    id:    'no-legacy-phone',
    desc:  'Old phone numbers must be replaced. Use CONTACT.phone from utils/brand.js.',
    regex: /\+971 ?4 ?000 ?0000|\+971 ?2 ?550 ?3559|\+971 ?2 ?550 ?3591|\+97125503559|tel:\+97125503559/,
    allow: SOURCE_OF_TRUTH.phone,
  },
  {
    id:    'no-broken-stars-plus',
    desc:  'Star strings ending in "+" (e.g. "&#9733;&#9733;&#9733;&#9733;+") render as literal "+". Use the centralized PLATFORMS in utils/platformRatings.js.',
    regex: /&#9733;\s*\+/,
    allow: SOURCE_OF_TRUTH.star,
  },
  {
    id:    'no-dead-unsubscribe',
    desc:  'Unsubscribe links must point to a real URL, not href="#". Use LINKS.unsubscribe from utils/brand.js.',
    regex: /href="#"[^>]*>\s*Unsubscribe|>\s*Unsubscribe\s*<\/a>[^<]*<\/a[^>]*href="#"/i,
    allow: [],
    only:  /-dynamic\.html$/,
  },
  {
    id:    'missing-unsubscribe',
    desc:  'Every dynamic email template must include an Unsubscribe link.',
    regex: /(?!)/, // never matches; this rule uses customCheck below instead
    allow: [],
    customCheck: ({ path, content }) => {
      if (!path.endsWith('-dynamic.html')) return null;
      return /unsubscribe/i.test(content) ? null : 'missing "Unsubscribe" anywhere in template';
    },
  },
  {
    id:    'duplicate-platform-data',
    desc:  'Per-platform rating data (logos, star strings) must come from utils/platformRatings.js — do not redefine.',
    regex: /https:\/\/static\.tacdn\.com\/img2\/brand_refresh\/Tripadvisor_lockup/,
    allow: ['utils/platformRatings.js', 'services/Day3VisaRenderer.js'], // Day3VisaRenderer still has fallback logo lookup
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (!SKIP_FILE(p)) out.push(p);
  }
  return out;
}

function isAllowed(filePath, allow) {
  const rel = relative(ROOT, filePath).replace(/^backend\/src\//, '');
  return allow.some(a => rel.endsWith(a));
}

function lintFile(filePath) {
  const content   = readFileSync(filePath, 'utf8');
  const findings  = [];
  for (const rule of RULES) {
    if (rule.only && !rule.only.test(filePath)) continue;

    if (rule.customCheck) {
      const msg = rule.customCheck({ path: filePath, content });
      if (msg) findings.push({ rule, line: 0, snippet: msg });
      continue;
    }

    if (isAllowed(filePath, rule.allow)) continue;

    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (rule.regex.test(line)) {
        findings.push({ rule, line: i + 1, snippet: line.trim().slice(0, 140) });
      }
    });
  }
  return findings;
}

let failed = 0;
let scanned = 0;
const allFindings = [];

for (const dir of SCAN_DIRS) {
  try {
    for (const file of walk(dir)) {
      scanned++;
      const findings = lintFile(file);
      if (findings.length > 0) {
        allFindings.push({ file, findings });
        failed += findings.length;
      }
    }
  } catch (err) {
    console.error(`[lint] could not scan ${dir}: ${err.message}`);
  }
}

if (allFindings.length === 0) {
  console.log(`✓ Email template lint passed (${scanned} files scanned, ${RULES.length} rules).`);
  process.exit(0);
}

console.error(`✗ Email template lint failed: ${failed} issue(s) across ${allFindings.length} file(s).\n`);
for (const { file, findings } of allFindings) {
  const rel = relative(ROOT, file);
  console.error(`  ${rel}`);
  for (const { rule, line, snippet } of findings) {
    console.error(`    [${rule.id}] line ${line}: ${snippet}`);
    console.error(`      → ${rule.desc}`);
  }
  console.error('');
}
process.exit(1);
