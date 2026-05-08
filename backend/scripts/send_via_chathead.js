/**
 * Render a content_templates row via EmailRenderer (with personalization for a
 * specific unified_id) and send it through the Chathead email API.
 *
 * Usage: node scripts/send_via_chathead.js <templateId> <recipientEmail> [unifiedId]
 */
import 'dotenv/config';
import EmailRenderer from '../src/services/EmailRenderer.js';
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
  const [, , templateIdArg, recipient, unifiedIdArg] = process.argv;
  if (!templateIdArg || !recipient) {
    console.error('Usage: node send_via_chathead.js <templateId> <recipient> [unifiedId]');
    process.exit(1);
  }
  const templateId = parseInt(templateIdArg);

  // Resolve recipient in unified_contacts for personalization + rid attribution
  let unifiedId = unifiedIdArg ? parseInt(unifiedIdArg) : null;
  if (!unifiedId) {
    const { rows: [u] } = await db.query(
      'SELECT unified_id FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
      [recipient]
    );
    unifiedId = u?.unified_id || null;
  }

  // Build UTM-tagged link so clicks in the email attribute back correctly
  const { rows: [tpl] } = await db.query('SELECT name FROM content_templates WHERE id = $1', [templateId]);
  if (!tpl) throw new Error(`Template ${templateId} not found`);
  const utmBase = 'https://www.raynatours.com/?utm_source=chathead&utm_medium=email&utm_campaign=' +
    encodeURIComponent(tpl.name);
  const utmLink = unifiedId ? `${utmBase}&rid=${unifiedId}` : utmBase;

  console.log(`Rendering template ${templateId} for unified_id=${unifiedId || 'null (generic)'}`);
  const rendered = await EmailRenderer.render(templateId, unifiedId, { utm_link: utmLink });

  console.log(`Sending via Chathead → ${recipient}`);
  console.log(`Subject: ${rendered.subject}`);
  console.log(`HTML length: ${rendered.html.length} chars`);

  // POST form-encoded — GET would blow past URL limits on a full HTML body
  const form = new URLSearchParams();
  form.append('from', FROM);
  form.append('from_name', FROM_NAME);
  form.append('destination', recipient);
  form.append('subject', rendered.subject);
  form.append('body', rendered.html);

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

  // Chathead returns 200 with empty body when auth/route is wrong — assert on the explicit success payload
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok || body?.status !== 'success') {
    console.error('Send did not succeed — chathead did not return {"status":"success"}');
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
