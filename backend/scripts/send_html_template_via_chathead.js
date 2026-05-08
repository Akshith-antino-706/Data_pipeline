/**
 * Send an HTML template from email_html_templates (the DB-stored, hand-crafted
 * full-design layouts) through the Chathead email API.
 *
 * Usage: node scripts/send_html_template_via_chathead.js <htmlTemplateId> <recipient> [subject]
 */
import 'dotenv/config';
import db from '../src/config/database.js';

const API_URL = process.env.CHATHEAD_API_URL || 'http://chathead.io/apis/email/send/index.php';
const API_TOKEN = process.env.CHATHEAD_API_TOKEN;
const FROM = 'explore@promotions.raynatours.com';
const FROM_NAME = 'Rayna Tours';

if (!API_TOKEN) {
  console.error('CHATHEAD_API_TOKEN missing from env — chathead POST silently drops unauthenticated requests');
  process.exit(1);
}

async function main() {
  const [, , htmlIdArg, recipient, subjectArg] = process.argv;
  if (!htmlIdArg || !recipient) {
    console.error('Usage: node send_html_template_via_chathead.js <htmlTemplateId> <recipient> [subject]');
    process.exit(1);
  }
  const htmlId = parseInt(htmlIdArg);

  // 1. Pull the HTML template + look up the recipient for personalization
  const { rows: [tpl] } = await db.query(
    'SELECT name, html_body, preview_text FROM email_html_templates WHERE id = $1',
    [htmlId]
  );
  if (!tpl) throw new Error(`html_template ${htmlId} not found`);

  const { rows: [user] } = await db.query(
    'SELECT unified_id, name FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
    [recipient]
  );

  // 2. Build vars for {{placeholder}} substitution
  const utmLink = `https://www.raynatours.com/?utm_source=chathead&utm_medium=email&utm_campaign=${encodeURIComponent(tpl.name)}` +
    (user?.unified_id ? `&rid=${user.unified_id}` : '');
  const firstName = user?.name ? user.name.split(' ')[0] : 'there';

  const vars = {
    first_name: firstName,
    full_name: user?.name || 'Valued Traveller',
    utm_link: utmLink,
    unsubscribe_link: `https://www.raynatours.com/unsubscribe?uid=${user?.unified_id || ''}`,
  };

  // 3. Substitute {{...}} placeholders + append UTM params to every raynatours.com href
  let html = tpl.html_body;
  for (const [k, v] of Object.entries(vars)) {
    html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  // Mirror EmailRenderer.injectUTMLinks: tag every raynatours link with the UTM params
  try {
    const u = new URL(utmLink);
    const utmParams = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (k.startsWith('utm_') || k === 'rid') utmParams.append(k, v);
    }
    const utmQs = utmParams.toString();
    if (utmQs) {
      html = html.replace(/href="(https?:\/\/(?:www\.)?raynatours\.com[^"]*)"/g, (_m, url) => {
        if (/[?&]utm_source=/.test(url)) return `href="${url}"`;
        const sep = url.includes('?') ? '&' : '?';
        return `href="${url}${sep}${utmQs}"`;
      });
    }
  } catch { /* utmLink not a URL */ }

  const subject = subjectArg || tpl.preview_text || tpl.name;

  console.log(`Template: ${tpl.name}  (id=${htmlId})`);
  console.log(`Recipient: ${recipient}  (matched user: ${user ? `${user.name} / unified_id=${user.unified_id}` : 'no match — generic'})`);
  console.log(`Subject: ${subject}`);
  console.log(`HTML body: ${html.length.toLocaleString()} chars`);

  // 4. POST form-encoded with Bearer auth. Verified 2026-04-27: this is the only
  // shape that actually delivers. Endpoint must be /index.php and Authorization
  // header is required — without either, the server 200s and drops the request.
  const form = new URLSearchParams();
  form.append('from', FROM);
  form.append('from_name', FROM_NAME);
  form.append('destination', recipient);
  form.append('subject', subject);
  form.append('body', html);

  const start = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${API_TOKEN}`,
    },
    body: form.toString(),
  });
  const text = await res.text();
  const ms = Date.now() - start;

  console.log(`\nHTTP ${res.status} in ${ms}ms`);
  console.log('Response:', text);

  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok || body?.status !== 'success') {
    console.error('Send did not succeed — chathead did not return {"status":"success"}');
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
