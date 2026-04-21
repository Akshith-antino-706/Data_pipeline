/**
 * Render the Day 5 template for a real user, diff against the source file,
 * and print UTM verification stats. Optional flag --send <email> to SMTP-send it.
 *
 * Usage:
 *   node scripts/verify_day5.js                            # render + diff only
 *   node scripts/verify_day5.js --send akshith@antino.com  # render + diff + send
 */

import { readFile, writeFile } from 'fs/promises';
import EmailRenderer from '../src/services/EmailRenderer.js';
import { EmailChannel } from '../src/services/channels/EmailChannel.js';
import { query } from '../src/config/database.js';

const SOURCE = new URL('../../mail_templates/day5-activities-emailer.html', import.meta.url);
const OUT = '/tmp/day5_rendered.html';

function buildUtmLink(campaignName, segment, campaignId, unifiedId) {
  const params = new URLSearchParams({
    utm_source: 'AI_marketer',
    utm_medium: 'email',
    utm_campaign: `${campaignName}_${segment}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    utm_content: `email_camp${campaignId}`,
    rid: String(unifiedId),
  });
  return `https://www.raynatours.com/activities?${params.toString()}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const sendIdx = argv.indexOf('--send');
  const sendTo = sendIdx >= 0 ? argv[sendIdx + 1] : null;

  const source = await readFile(SOURCE, 'utf-8');

  const { rows: [tpl] } = await query(`
    SELECT ct.id, ct.name, ct.segment_label
    FROM content_templates ct
    JOIN email_html_templates eht ON eht.id = ct.html_template_id
    WHERE eht.category = 'activities'
    ORDER BY ct.id LIMIT 1
  `);
  if (!tpl) throw new Error('No activities content_template found. Did you run the seed script?');

  // Pick a real user if sending; otherwise a sample id for rendering only
  const recipient = sendTo || 'akshith@antino.com';
  const { rows: [user] } = await query(
    `SELECT unified_id, name, email FROM unified_contacts WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [recipient]
  );
  const unifiedId = user?.unified_id || 1369472;

  const utmLink = buildUtmLink(tpl.name, tpl.segment_label, 999, unifiedId);
  const rendered = await EmailRenderer.render(tpl.id, unifiedId, { utm_link: utmLink });
  await writeFile(OUT, rendered.html);

  // Strip the appended UTM query params from rendered to diff against source
  const stripped = rendered.html.replace(
    /(href="https?:\/\/(?:www\.)?raynatours\.com[^"?]*)\?utm_source=[^"]*"/g,
    '$1"'
  );
  const linksInSource  = (source.match(/href="https?:\/\/(?:www\.)?raynatours\.com[^"]*"/g) || []).length;
  const linksInRender  = (rendered.html.match(/href="https?:\/\/(?:www\.)?raynatours\.com[^"]*"/g) || []).length;
  const utmifiedLinks  = (rendered.html.match(/href="https?:\/\/(?:www\.)?raynatours\.com[^"]*utm_source=[^"]*"/g) || []).length;
  const byteMatch      = stripped === source;

  console.log('Template      :', tpl.name, '(content_template id=' + tpl.id + ')');
  console.log('Recipient     :', recipient, '(unified_id=' + unifiedId + ')');
  console.log('Source bytes  :', source.length, '  Rendered bytes:', rendered.html.length);
  console.log('Subject       :', rendered.subject);
  console.log('');
  console.log('UTM coverage  :', `${utmifiedLinks}/${linksInRender} raynatours.com links carry utm_source`);
  console.log('Link parity   :', linksInSource === linksInRender ? 'OK' : `MISMATCH (source=${linksInSource}, render=${linksInRender})`);
  console.log('Byte parity   :', byteMatch ? 'OK (render == source after stripping UTM)' : 'DIFF detected');
  console.log('Sample link   :', (rendered.html.match(/href="https:\/\/www\.raynatours\.com\/dubai\/burj-khalifa[^"]*"/) || ['(none)'])[0]);
  console.log('');
  console.log('Rendered HTML written to', OUT);

  if (sendTo) {
    console.log('\nSending via SMTP…');
    const result = await EmailChannel.send({
      to: sendTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.plainText,
    });
    console.log('Send result  :', JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
