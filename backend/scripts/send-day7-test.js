/**
 * One-off test send of the dynamic day-7 cruise email.
 *
 *   node backend/scripts/send-day7-test.js
 *
 * Renders day7 against journey 120's bucketed run_id (so the same Anthropic
 * snapshot the inspector showed is what gets sent), then sends via the
 * existing EmailChannel (SMTP) to each recipient.
 */
import 'dotenv/config';
import db from '../src/config/database.js';
import EmailRenderer from '../src/services/EmailRenderer.js';
import PopularityService from '../src/services/PopularityService.js';
import { EmailChannel } from '../src/services/channels/EmailChannel.js';

const RECIPIENTS = [
  { email: 'akshith@antino.com',     unifiedId: 1369472 },
  { email: 'anket@raynatours.com',   unifiedId: 90551   },
];

const JOURNEY_ID = 120;
const NODE_ID    = 'node_email_d7';
const HTML_NAME  = 'Day 7 — Cruise';

async function main() {
  const { rows: [tpl] } = await db.query(
    `SELECT id, name FROM email_html_templates WHERE name = $1`, [HTML_NAME]);
  if (!tpl) throw new Error(`html_template "${HTML_NAME}" not found`);

  const runId = PopularityService.runIdForBucket(JOURNEY_ID);
  console.log(`Provider:   ${PopularityService.provider()}`);
  console.log(`Journey:    ${JOURNEY_ID}`);
  console.log(`Node:       ${NODE_ID}`);
  console.log(`Bucket run: ${runId}`);
  console.log(`Template:   ${tpl.name} (id=${tpl.id})\n`);

  // Make sure the snapshot exists for this node (lazy snapshot if missing).
  const { default: JourneyService } = await import('../src/services/JourneyService.js');
  const { rows: [{ ct_id }] } = await db.query(
    `SELECT id AS ct_id FROM content_templates WHERE html_template_id = $1 LIMIT 1`, [tpl.id]);
  await JourneyService._ensureNodeSnapshotted({
    journeyId: JOURNEY_ID, runId, nodeId: NODE_ID, contentTemplateId: ct_id,
  });

  for (const r of RECIPIENTS) {
    const rendered = await EmailRenderer.renderForJourneyNode({
      htmlTemplateId: tpl.id,
      unifiedId: r.unifiedId,
      journeyId: JOURNEY_ID,
      nodeId: NODE_ID,
      runId,
      extraVars: { subject_override: 'Cruise the world with Rayna — handpicked sailings' },
    });

    const sendResult = await EmailChannel.send({
      to:      r.email,
      subject: rendered.subject || 'Cruise the world with Rayna — handpicked sailings',
      html:    rendered.html,
      text:    rendered.plainText,
    });

    console.log(`→ ${r.email}  ` +
                (sendResult.success ? '✓ sent' : '✗ failed') +
                `  slotsFilled=${rendered.slotsFilled}  bytes=${rendered.html.length.toLocaleString()}` +
                (sendResult.externalId ? `  id=${sendResult.externalId}` : '') +
                (sendResult.error ? `  err=${sendResult.error}` : ''));
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
