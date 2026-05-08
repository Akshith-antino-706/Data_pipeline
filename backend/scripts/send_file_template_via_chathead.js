/**
 * Send a local HTML file (e.g. mail_templates/*.html) through Chathead.
 * Form-encoded POST to /index.php with Bearer auth — verified-working shape.
 *
 * Usage: node scripts/send_file_template_via_chathead.js <htmlPath> <recipient> [subject]
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const API_URL   = process.env.CHATHEAD_API_URL || 'http://chathead.io/apis/email/send/index.php';
const API_TOKEN = process.env.CHATHEAD_API_TOKEN;
const FROM      = 'explore@promotions.raynatours.com';
const FROM_NAME = 'Rayna Tours';

if (!API_TOKEN) {
  console.error('CHATHEAD_API_TOKEN missing from env — chathead POST silently drops unauthenticated requests');
  process.exit(1);
}

async function main() {
  const [, , htmlPath, recipient, subjectArg] = process.argv;
  if (!htmlPath || !recipient) {
    console.error('Usage: node send_file_template_via_chathead.js <htmlPath> <recipient> [subject]');
    process.exit(1);
  }

  const abs = resolve(htmlPath);
  const html = await readFile(abs, 'utf8');
  const subject = subjectArg || 'Rayna Tours';

  console.log(`File: ${abs}`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Subject: ${subject}`);
  console.log(`HTML body: ${html.length.toLocaleString()} chars`);

  const form = new URLSearchParams();
  form.append('from',        FROM);
  form.append('from_name',   FROM_NAME);
  form.append('destination', recipient);
  form.append('subject',     subject);
  form.append('body',        html);

  const start = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${API_TOKEN}`,
    },
    body: form.toString(),
  });
  const text = await res.text();
  const ms = Date.now() - start;

  let body = null;
  try { body = JSON.parse(text); } catch { /* keep raw text */ }
  const ok = res.ok && body?.status === 'success';

  console.log(`\nHTTP ${res.status} in ${ms}ms`);
  console.log('Response:', text || '(empty body — silent drop)');
  console.log(ok ? 'OK' : `FAIL (${body?.msg || `HTTP ${res.status}`})`);

  process.exit(ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
