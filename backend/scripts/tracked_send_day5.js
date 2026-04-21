/**
 * Send Day 5 email to a single user with FULL click tracking:
 *   - Generates utm_tracking row for the campaign (if missing)
 *   - Generates a unique per-user tracking token (user_utm_links)
 *   - All raynatours.com hrefs in the email are REPLACED with our tracker URL
 *     (http://<tracker-host>/api/v3/utm/track/<token>) — click records in DB,
 *     then redirects to destination_url (carries utm_* + rid for GTM).
 *
 * Usage:
 *   node scripts/tracked_send_day5.js <email> [--campaign-id=479] [--tracker-host=http://localhost:3001]
 */

import crypto from 'crypto';
import { readFile } from 'fs/promises';
import EmailRenderer from '../src/services/EmailRenderer.js';
import { EmailChannel } from '../src/services/channels/EmailChannel.js';
import UTMService from '../src/services/UTMService.js';
import { query } from '../src/config/database.js';

const argv = process.argv.slice(2);
const RECIPIENT = argv.find(a => !a.startsWith('--')) || 'akshith@antino.com';
const CAMPAIGN_ID = parseInt((argv.find(a => a.startsWith('--campaign-id=')) || '').split('=')[1] || '479');
const TRACKER_HOST = (argv.find(a => a.startsWith('--tracker-host=')) || '').split('=')[1] || 'http://localhost:3001';

async function ensureUtmForCampaign(campaignId) {
  const { rows: [utm] } = await query(
    'SELECT utm_id, full_url FROM utm_tracking WHERE campaign_id = $1 LIMIT 1', [campaignId]
  );
  if (utm) return utm;
  console.log(`→ generating utm_tracking row for campaign ${campaignId}…`);
  await UTMService.generateForCampaign(campaignId);
  const { rows: [fresh] } = await query(
    'SELECT utm_id, full_url FROM utm_tracking WHERE campaign_id = $1 LIMIT 1', [campaignId]
  );
  return fresh;
}

async function ensureUserToken(utmId, campaignId, user) {
  const { rows: [existing] } = await query(
    `SELECT token, destination_url FROM user_utm_links
     WHERE utm_id = $1 AND unified_id = $2 LIMIT 1`,
    [utmId, user.unified_id]
  );
  if (existing) return existing;

  // Build destination URL — activities landing + utm + rid
  const { rows: [camp] } = await query('SELECT name, segment_label, channel FROM campaigns WHERE id = $1', [campaignId]);
  const destParams = new URLSearchParams({
    utm_source: 'AI_marketer',
    utm_medium: camp.channel,
    utm_campaign: `${camp.name}_${camp.segment_label}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    utm_content: `${camp.channel}_camp${campaignId}`,
    rid: String(user.unified_id),
  });
  const destinationUrl = `https://www.raynatours.com/activities?${destParams.toString()}`;

  const token = crypto.randomBytes(15).toString('base64url').slice(0, 12);
  await query(
    `INSERT INTO user_utm_links (utm_id, campaign_id, unified_id, customer_email, customer_name, token, destination_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [utmId, campaignId, user.unified_id, user.email, user.name, token, destinationUrl]
  );
  console.log(`→ created tracking token ${token} for ${user.email} (rid=${user.unified_id})`);
  return { token, destination_url: destinationUrl };
}

function replaceHrefsWithTracker(html, trackerUrl) {
  // Replace every raynatours.com href with the single tracker URL
  return html.replace(
    /href="https?:\/\/(?:www\.)?raynatours\.com[^"]*"/g,
    `href="${trackerUrl}"`
  );
}

async function main() {
  // 1) Look up user
  const { rows: [user] } = await query(
    `SELECT unified_id, name, email FROM unified_contacts WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [RECIPIENT]
  );
  if (!user) throw new Error(`User ${RECIPIENT} not in unified_contacts`);
  console.log(`✓ user: ${user.name} <${user.email}> (unified_id=${user.unified_id})`);

  // 2) Ensure utm_tracking + per-user token
  const utm = await ensureUtmForCampaign(CAMPAIGN_ID);
  console.log(`✓ utm_id=${utm.utm_id}`);
  const link = await ensureUserToken(utm.utm_id, CAMPAIGN_ID, user);
  const trackerUrl = `${TRACKER_HOST}/api/v3/utm/track/${link.token}`;
  console.log(`✓ tracker: ${trackerUrl}`);
  console.log(`✓ destination after redirect: ${link.destination_url}`);

  // 3) Render Day 5 with the destination URL as utm_link (so GTM params stay consistent
  //    if anyone inspects links before click), then post-process to swap hrefs to tracker
  const { rows: [tpl] } = await query(`
    SELECT ct.id FROM content_templates ct
    JOIN email_html_templates eht ON eht.id = ct.html_template_id
    WHERE eht.category = 'activities' ORDER BY ct.id LIMIT 1
  `);
  const rendered = await EmailRenderer.render(tpl.id, user.unified_id, { utm_link: link.destination_url });
  const trackedHtml = replaceHrefsWithTracker(rendered.html, trackerUrl);

  const linksInRendered = (rendered.html.match(/href="https?:\/\/(?:www\.)?raynatours\.com[^"]*"/g) || []).length;
  const linksInTracked  = (trackedHtml.match(new RegExp(`href="${trackerUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length;
  console.log(`✓ replaced ${linksInTracked}/${linksInRendered} hrefs with tracker URL`);

  // 4) Send
  const result = await EmailChannel.send({
    to: user.email,
    subject: rendered.subject,
    html: trackedHtml,
    text: rendered.plainText,
  });
  console.log(`\n→ SEND: ${JSON.stringify(result)}`);

  // 5) Show tracking state for verification
  const { rows: [before] } = await query(
    `SELECT click_count, first_clicked_at, last_clicked_at FROM user_utm_links WHERE token = $1`,
    [link.token]
  );
  console.log(`\nTracking state (before any click):`);
  console.log(`  user_utm_links.token=${link.token}  clicks=${before.click_count}  first=${before.first_clicked_at}  last=${before.last_clicked_at}`);
  const { rows: [utmRow] } = await query('SELECT clicks, conversions FROM utm_tracking WHERE utm_id = $1', [utm.utm_id]);
  console.log(`  utm_tracking.utm_id=${utm.utm_id}  clicks=${utmRow.clicks}  conversions=${utmRow.conversions}`);

  console.log(`\n========================================`);
  console.log(`HOW TO VERIFY:`);
  console.log(`1. Open the email in your Outlook / browser.`);
  console.log(`2. Click any CTA (e.g. "Browse Activities" or any product tile).`);
  console.log(`3. Your click hits: ${trackerUrl}`);
  console.log(`4. Backend records it and redirects you to:`);
  console.log(`     ${link.destination_url}`);
  console.log(`5. GTM on raynatours.com reads the 'rid' param (=${user.unified_id}) and identifies you.`);
  console.log(`6. Re-run this SQL to see clicks:`);
  console.log(`     SELECT token, click_count, first_clicked_at, last_clicked_at FROM user_utm_links WHERE token='${link.token}';`);
  console.log(`     SELECT * FROM utm_tracking WHERE utm_id=${utm.utm_id};`);
  console.log(`========================================`);
  process.exit(result.success ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
