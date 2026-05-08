/**
 * Set up the "General Broadcast — Activities" journey end-to-end.
 *
 *   node backend/scripts/seed-general-broadcast-journey.js                # idempotent setup
 *   node backend/scripts/seed-general-broadcast-journey.js --enroll=test  # also enroll the 4 test users
 *   node backend/scripts/seed-general-broadcast-journey.js --enroll=sample --size=100
 *   node backend/scripts/seed-general-broadcast-journey.js --enroll=full  # ⚠️  enrolls ALL email-eligible contacts
 *
 * Journey shape (4 nodes, 1/3/7/14 cadence):
 *   trigger
 *     → wait 1d → Email D+1  (Activities)      product_type=activity
 *     → wait 2d → Email D+3  (Holidays)        product_type=holiday
 *     → wait 4d → Email D+7  (Cruise)          product_type=cruise
 *     → wait 7d → Email D+14 (Destinations)    product_type=destination
 *     → goal (booking)
 *
 * What it does (idempotent):
 *   1. Re-reads each day-named template from mail_templates/ and upserts into
 *      email_html_templates with uses_popular_products=true.
 *   2. Upserts one content_templates row per day (channel=email, segment=general).
 *   3. Upserts the journey_flows row with the 4-email shape above.
 *   4. Optionally enrolls recipients via JourneyService.enrollAll().
 *
 * Popularity ranking is provider-driven by env (see PopularityService.provider()):
 *   ANTHROPIC_API_KEY  → web_search re-ranks the catalog at each node fire
 *   POPULARITY_API_URL → external REST endpoint
 *   neither            → deterministic catalog order (simulation)
 *
 * After enrollment, run:
 *   node backend/scripts/start-workers.js          # in one terminal
 *   curl -X POST localhost:3001/api/v3/journeys/<id>/process    # or wait for cron
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../src/config/database.js';
import JourneyService from '../src/services/JourneyService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, '..', '..', 'mail_templates');
const JOURNEY_NAME = 'General Broadcast — Activities';

// 4-node general broadcast journey on a 1/3/7/14 cadence.
// Each template carries a single (or themed) <!-- SLOT:product_grid --> marker;
// PopularityService snapshots once per (journey, node, run) keyed by product_type
// — Anthropic web_search ranks the catalog when ANTHROPIC_API_KEY is set.
const DAY_TEMPLATES = [
  { day: 1,  file: 'day1-activities-emailer.html',
    htmlName: 'Day 1 — Activities',
    category: 'activities',
    contentName: 'General Broadcast — Day 1 (Activities)',
    subject: 'Popular activities right now — picked for you',
    usesPopular: true, productType: 'activity',    productLimit: 4 },
  { day: 3,  file: 'day3-holidays-emailer.html',
    htmlName: 'Day 3 — Holidays',
    category: 'holiday',
    contentName: 'General Broadcast — Day 3 (Holidays)',
    subject: 'Holiday packages worth talking about',
    usesPopular: true, productType: 'holiday',     productLimit: 4 },
  { day: 7,  file: 'day7-cruise-emailer.html',
    htmlName: 'Day 7 — Cruise',
    category: 'cruise',
    contentName: 'General Broadcast — Day 7 (Cruise)',
    subject: 'Cruise the world with Rayna — handpicked sailings',
    usesPopular: true, productType: 'cruise',      productLimit: 4 },
  { day: 14, file: 'day14-destinations-emailer.html',
    htmlName: 'Day 14 — Destinations',
    category: 'destinations',
    contentName: 'General Broadcast — Day 14 (Destinations)',
    subject: 'Where to next? Top destinations trending right now',
    usesPopular: true, productType: 'destination', productLimit: 6 },
];

// Wait deltas between consecutive emails (D+1 → D+3 = 2d, D+3 → D+7 = 4d, …).
// Deltas are paired with DAY_TEMPLATES[1..] in upsertJourney() below.
const WAIT_DELTAS = [2, 4, 7];

async function upsertHtmlTemplate(t) {
  const html = fs.readFileSync(path.join(TEMPLATE_DIR, t.file), 'utf8');
  const { rows: [row] } = await db.query(
    `INSERT INTO email_html_templates
       (name, type, category, html_body, placeholders, preview_text,
        uses_popular_products, product_type, product_limit)
     VALUES ($1, 'static', $2, $3, ARRAY['first_name'], $4, $5, $6, $7)
     ON CONFLICT (name) DO UPDATE SET
       html_body = EXCLUDED.html_body,
       category = EXCLUDED.category,
       uses_popular_products = EXCLUDED.uses_popular_products,
       product_type = EXCLUDED.product_type,
       product_limit = EXCLUDED.product_limit,
       updated_at = NOW()
     RETURNING id`,
    [t.htmlName, t.category, html, t.subject,
     t.usesPopular || false,
     t.usesPopular ? (t.productType || null) : null,
     t.usesPopular ? (t.productLimit || null) : null]
  );
  console.log(`✓ html  id=${row.id}  ${t.htmlName}  bytes=${html.length.toLocaleString()}  popular=${!!t.usesPopular}`);
  return row.id;
}

async function upsertContentTemplate(t, htmlTemplateId) {
  const { rows: [existing] } = await db.query(
    `SELECT id FROM content_templates WHERE name = $1 AND channel = 'email' LIMIT 1`,
    [t.contentName]
  );
  if (existing) {
    await db.query(
      `UPDATE content_templates SET
         html_template_id = $2, subject = $3, body = $3,
         segment_label = 'general', status = 'approved', updated_at = NOW()
       WHERE id = $1`,
      [existing.id, htmlTemplateId, t.subject]
    );
    console.log(`  · content updated  id=${existing.id}  → html_template_id=${htmlTemplateId}`);
    return existing.id;
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO content_templates (name, channel, status, segment_label, subject, body, variables, html_template_id)
     VALUES ($1, 'email', 'approved', 'general', $2, $2, ARRAY['first_name'], $3)
     RETURNING id`,
    [t.contentName, t.subject, htmlTemplateId]
  );
  console.log(`  · content inserted id=${row.id}`);
  return row.id;
}

async function upsertJourney(dayContentIds) {
  // 4-node email drip on a 1/3/7/14 cadence — D+1 fires immediately after the
  // first wait, then D+3, D+7, D+14. Wait deltas come from WAIT_DELTAS.
  //   trigger
  //     → wait 1d → Email D+1 (Activities — Anthropic-ranked top picks)
  //     → wait 2d → Email D+3 (Holidays)
  //     → wait 4d → Email D+7 (Cruise)
  //     → wait 7d → Email D+14 (Destinations — city spotlight)
  //     → goal (booking)
  const yStep = 110;
  const nodes = [
    { id: 'node_trigger', type: 'trigger', position: { x: 250, y: 0 },
      data: { label: 'Manual enrollment', trigger: 'manual', track: 'all' } },
  ];
  const edges = [];

  const dayLabel = {
    1:  'Email: D+1 — Activities (popular now)',
    3:  'Email: D+3 — Holiday packages',
    7:  'Email: D+7 — Cruise picks',
    14: 'Email: D+14 — Top destinations',
  };

  // First wait is always 1 day — gets us from enrollment to D+1.
  // Subsequent waits use WAIT_DELTAS in order: D+1→D+3 (2d), D+3→D+7 (4d), D+7→D+14 (7d).
  const waitsBeforeEmail = [1, ...WAIT_DELTAS];

  let prevId = 'node_trigger';
  let y = 0;
  for (const [i, { day, contentId }] of dayContentIds.entries()) {
    const waitDays = waitsBeforeEmail[i];
    y += yStep;
    const waitId  = `node_wait_d${day}`;
    const emailId = `node_email_d${day}`;
    nodes.push({ id: waitId, type: 'wait', position: { x: 250, y },
      data: { label: `Wait ${waitDays} day${waitDays === 1 ? '' : 's'}`, waitDays, track: 'all' } });
    y += yStep;
    nodes.push({ id: emailId, type: 'action', position: { x: 250, y },
      data: { label: dayLabel[day] || `Email D+${day}`, channel: 'email', templateId: contentId, track: 'all' } });
    edges.push({ id: `e_${prevId}_${waitId}`,  source: prevId,  target: waitId  });
    edges.push({ id: `e_${waitId}_${emailId}`, source: waitId,  target: emailId });
    prevId = emailId;
  }

  // Goal — booking conversion auto-exits the entry.
  y += yStep;
  nodes.push({ id: 'node_goal', type: 'goal', position: { x: 250, y },
    data: { label: 'Booking made', goalType: 'booking', track: 'all' } });
  edges.push({ id: `e_${prevId}_node_goal`, source: prevId, target: 'node_goal' });

  const { rows: [existing] } = await db.query(
    'SELECT journey_id FROM journey_flows WHERE name = $1 LIMIT 1', [JOURNEY_NAME]
  );

  const description =
    '4-touch general broadcast on a 1/3/7/14 day cadence (Activities → Holidays → Cruise → Destinations). ' +
    'Each node fires once per processJourney run and snapshots Anthropic-ranked popular products into popularity_snapshots; ' +
    'all entries in the same run see identical content. Booking goal auto-exits.';

  if (existing) {
    await db.query(
      `UPDATE journey_flows SET
         description = $4,
         audience = 'all',
         status = 'active',
         nodes = $2::jsonb,
         edges = $3::jsonb,
         goal_type = 'booking',
         updated_at = NOW()
       WHERE journey_id = $1`,
      [existing.journey_id, JSON.stringify(nodes), JSON.stringify(edges), description]
    );
    console.log(`✓ journey_flows updated          journey_id=${existing.journey_id}`);
    return existing.journey_id;
  }

  const { rows: [row] } = await db.query(
    `INSERT INTO journey_flows (name, description, audience, status, nodes, edges, goal_type, created_by)
     VALUES ($1, $2, 'all', 'active', $3::jsonb, $4::jsonb, 'booking', 'seed-script')
     RETURNING journey_id`,
    [JOURNEY_NAME, description, JSON.stringify(nodes), JSON.stringify(edges)]
  );
  console.log(`✓ journey_flows inserted         journey_id=${row.journey_id}`);
  return row.journey_id;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(a => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    })
  );

  const dayContentIds = [];
  for (const t of DAY_TEMPLATES) {
    const htmlId = await upsertHtmlTemplate(t);
    const ctId   = await upsertContentTemplate(t, htmlId);
    dayContentIds.push({ day: t.day, contentId: ctId });
  }
  const jId  = await upsertJourney(dayContentIds);

  if (args.enroll) {
    let result;
    if (args.enroll === 'test') {
      result = await JourneyService.enrollAll({ journeyId: jId, channel: 'email', mode: 'test_users' });
    } else if (args.enroll === 'sample') {
      const size = parseInt(args.size || '100');
      result = await JourneyService.enrollAll({ journeyId: jId, channel: 'email', mode: 'sample', sampleSize: size });
    } else if (args.enroll === 'full') {
      result = await JourneyService.enrollAll({ journeyId: jId, channel: 'email', mode: 'full' });
    } else {
      throw new Error(`Unknown --enroll mode: ${args.enroll} (use test|sample|full)`);
    }
    console.log(`✓ enrolled ${result.enrolled} customer(s) into journey_id=${jId} (mode=${result.mode}, channel=${result.channel})`);
  }

  console.log(`\nNext:`);
  console.log(`  1. Start workers:    node backend/scripts/start-workers.js`);
  console.log(`  2. Trigger send:     curl -X POST 'http://localhost:3001/api/v3/journeys/${jId}/process'`);
  console.log(`     (or wait for the daily cron)`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
