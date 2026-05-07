/**
 * Inspect dynamic content in journey templates.
 *
 *   node backend/scripts/inspect-dynamic-content.js [journeyId]
 *
 * Prints, for each action node in the journey:
 *   1. STATIC parts: hero image URL, headline, eyebrow, services links — all
 *      pulled from the raw template HTML so you can see what's hardcoded.
 *   2. DYNAMIC parts: every SLOT marker in the template + the snapshot rows
 *      that filled it for the current bucketed run_id (Anthropic-ranked
 *      products, the queries used, source URLs).
 *
 * Useful answer to "what's actually changing per node fire vs what's stuck
 * in the base template?".
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import PopularityService from '../src/services/PopularityService.js';

const JOURNEY_ID = parseInt(process.argv[2] || '120');

const COLOR = { reset: '\x1b[0m', cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' };
const c = (col, s) => `${COLOR[col]}${s}${COLOR.reset}`;

// Try to identify the hero image and headline text from a template by walking
// the first few <img> + first big-font <td>. Heuristic, not exact.
function inspectTemplateChrome(html) {
  const heroImg = (html.match(/<img[^>]+src="(https?:\/\/[^"]+)"[^>]*alt="[^"]*"[^>]*width="[1-9]\d{2,}/) || [])[1]
                || (html.match(/<img[^>]+src="(https?:\/\/[^"]+(?:hero|banner|cover|main|featured)[^"]*)"/i) || [])[1]
                || null;
  const eyebrow = (html.match(/(?:letter-spacing:\s*\d+(?:\.\d+)?px[^>]*?)>\s*([^<\s][^<]{4,80}[^<\s])\s*<\/td>/i) || [])[1] || null;
  const headline = (html.match(/font-size:\s*(?:3[0-9]|4[0-9])px[^>]*?>\s*([^<\s][^<]{4,140}[^<\s])\s*<\/td>/i) || [])[1] || null;
  const ctaButtons = [...html.matchAll(/<a[^>]+href="(https:\/\/(?:www\.)?raynatours\.com[^"]+)"[^>]*>([^<]{2,40})<\/a>/g)]
    .map(m => ({ url: m[1], label: m[2].trim() }))
    .filter((v, i, a) => a.findIndex(x => x.url === v.url) === i)
    .slice(0, 5);
  return { heroImg, eyebrow, headline, ctaButtons };
}

function extractSlots(html) {
  const re = /<!--\s*SLOT:([\w_]+)\s+([^>]*?)-->/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = {};
    const ar = /(\w+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[2])) !== null) attrs[a[1]] = a[2];
    out.push({ kind: m[1], attrs });
  }
  return out;
}

async function main() {
  const { rows: [journey] } = await db.query(
    `SELECT name, nodes FROM journey_flows WHERE journey_id = $1`, [JOURNEY_ID]);
  if (!journey) throw new Error(`journey ${JOURNEY_ID} not found`);
  console.log(c('bold', `Journey: ${journey.name}  (id=${JOURNEY_ID})`));

  const runId = PopularityService.runIdForBucket(JOURNEY_ID);
  console.log(c('dim', `Today's bucketed run_id: ${runId}\n`));

  const actionNodes = (journey.nodes || []).filter(n => n.type === 'action' && n.data?.channel === 'email');

  for (const node of actionNodes) {
    const tplId = parseInt(node.data.templateId);
    const { rows: [cfg] } = await db.query(
      `SELECT eht.id AS html_template_id, eht.name AS html_name, eht.uses_popular_products,
              eht.product_type, eht.product_limit, eht.html_body
         FROM content_templates ct
         JOIN email_html_templates eht ON eht.id = ct.html_template_id
        WHERE ct.id = $1`, [tplId]);
    if (!cfg) { console.log(`  · ${node.id}: no html template linked`); continue; }

    const chrome = inspectTemplateChrome(cfg.html_body);
    const slots  = extractSlots(cfg.html_body);

    console.log(c('cyan', `━━ ${cfg.html_name}  (node=${node.id}) ━━`));

    console.log(c('bold', '  STATIC (lives in the base template):'));
    console.log(`    Hero image:    ${chrome.heroImg || c('dim', '(none detected)')}`);
    console.log(`    Eyebrow text:  ${chrome.eyebrow ? '"' + chrome.eyebrow + '"' : c('dim', '(none detected)')}`);
    console.log(`    Headline:      ${chrome.headline ? '"' + chrome.headline + '"' : c('dim', '(none detected)')}`);
    if (chrome.ctaButtons.length) {
      console.log(`    Hard-coded CTAs / services links:`);
      for (const b of chrome.ctaButtons) console.log(`      · "${b.label}" → ${b.url}`);
    }

    console.log(c('bold', '  DYNAMIC (changes every node fire):'));
    if (slots.length === 0) {
      console.log(c('dim', '    (no SLOT markers — entire template is static)'));
    } else {
      for (const s of slots) {
        const attrStr = Object.entries(s.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
        console.log(`    SLOT:${s.kind}  ${attrStr}`);
      }
    }

    if (cfg.uses_popular_products) {
      const { rows: snap } = await db.query(
        `SELECT theme, position, name, location, price, raw_payload
           FROM popularity_snapshots
          WHERE journey_id = $1 AND node_id = $2 AND run_id = $3
          ORDER BY theme, position`,
        [JOURNEY_ID, node.id, runId]);
      if (snap.length === 0) {
        console.log(c('yellow', `    ⚠  no popularity_snapshots rows under today's run_id yet`));
        console.log(c('dim',    `       (will be filled at T-60 prewarm cron, or on next processJourney)`));
      } else {
        console.log(c('green', `    ✓  filled by ${snap[0].raw_payload?.ranked_by || '?'} ` +
                              `(${snap[0].raw_payload?.model || '?'}):`));
        for (const r of snap) {
          const themeTag = r.theme && r.theme !== '_default' ? c('dim', ` [${r.theme}]`) : '';
          console.log(`      ${r.position}. ${r.name}${themeTag}` +
                      (r.location ? c('dim', ` — ${r.location}`) : '') +
                      (r.price ? `   ${r.price}` : ''));
        }
        const audit = snap[0].raw_payload || {};
        if (Array.isArray(audit.queries) && audit.queries.length) {
          console.log(c('dim', `      web_search queries:`));
          for (const q of audit.queries) console.log(c('dim', `        · "${q}"`));
        }
        if (Array.isArray(audit.sources) && audit.sources.length) {
          console.log(c('dim', `      top sources:`));
          for (const s of audit.sources.slice(0, 3)) console.log(c('dim', `        · ${s.url}`));
        }
      }
    }
    console.log('');
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
