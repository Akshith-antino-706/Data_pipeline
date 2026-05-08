/**
 * Send a local HTML file (e.g. mail_templates/*.html) via SMTP through EmailChannel.
 *
 * Auto-injects UTM params into every raynatours.com href:
 *   utm_source=email & utm_medium=email & utm_campaign=<file-basename> [& rid=<unified_id>]
 *
 * Usage: node scripts/send_file_template_via_smtp.js <htmlPath> <recipient> [subject]
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { EmailChannel } from '../src/services/channels/EmailChannel.js';
import db from '../src/config/database.js';

const UTM_SOURCE = 'email';
const UTM_MEDIUM = 'email';

function injectUTM(html, campaign, rid) {
  const params = new URLSearchParams({
    utm_source: UTM_SOURCE,
    utm_medium: UTM_MEDIUM,
    utm_campaign: campaign,
  });
  if (rid) params.set('rid', String(rid));
  const utmQs = params.toString();

  return html.replace(/href="(https?:\/\/(?:www\.)?raynatours\.com[^"]*)"/g, (_m, url) => {
    if (/[?&]utm_source=/.test(url)) return `href="${url}"`;
    const sep = url.includes('?') ? '&' : '?';
    return `href="${url}${sep}${utmQs}"`;
  });
}

async function main() {
  const [, , htmlPath, recipient, subjectArg] = process.argv;
  if (!htmlPath || !recipient) {
    console.error('Usage: node send_file_template_via_smtp.js <htmlPath> <recipient> [subject]');
    process.exit(1);
  }

  const abs = resolve(htmlPath);
  const rawHtml = await readFile(abs, 'utf8');
  const subject = subjectArg || 'Cruise Spotlight: Sail the World in Style';
  const campaign = basename(abs, extname(abs));

  // Look up unified_id for rid attribution (best-effort — null if no match)
  let unifiedId = null;
  try {
    const { rows: [user] } = await db.query(
      'SELECT unified_id FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
      [recipient]
    );
    unifiedId = user?.unified_id || null;
  } catch (err) {
    console.log(`[UTM] unified_contacts lookup skipped: ${err.message}`);
  }

  const html = injectUTM(rawHtml, campaign, unifiedId);

  // Count tagged links for visibility
  const taggedCount = (html.match(/utm_source=email/g) || []).length;

  console.log(`File: ${abs}`);
  console.log(`Recipient: ${recipient}  (rid=${unifiedId || 'none'})`);
  console.log(`Subject: ${subject}`);
  console.log(`Campaign: ${campaign}  |  Links tagged: ${taggedCount}`);
  console.log(`HTML body: ${html.length.toLocaleString()} chars`);
  console.log(`Provider: ${EmailChannel.config.provider} (from: ${EmailChannel.config.fromEmail})`);

  const start = Date.now();
  const result = await EmailChannel.send({ to: recipient, subject, html });
  const ms = Date.now() - start;

  console.log(`\nResult in ${ms}ms:`, result);
  process.exit(result.success ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
