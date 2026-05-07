/**
 * Send a local HTML file (e.g. mail_templates/*.html) through Chathead.
 *
 * Usage: node scripts/send_file_template_via_chathead.js <htmlPath> <recipient> [subject]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_URL = 'http://chathead.io/apis/email/send/';
const FROM = 'travelguide@newsletter.raynatours.com';
const FROM_NAME = 'Rayna Tours';

async function main() {
  const [, , htmlPath, recipient, subjectArg] = process.argv;
  if (!htmlPath || !recipient) {
    console.error('Usage: node send_file_template_via_chathead.js <htmlPath> <recipient> [subject]');
    process.exit(1);
  }

  const abs = resolve(htmlPath);
  const html = await readFile(abs, 'utf8');
  const subject = subjectArg || 'Cruise Spotlight: Sail the World in Style';

  console.log(`File: ${abs}`);
  console.log(`Recipient: ${recipient}`);
  console.log(`Subject: ${subject}`);
  console.log(`HTML body: ${html.length.toLocaleString()} chars`);

  const payload = {
    from: FROM,
    from_name: FROM_NAME,
    destination: recipient,
    subject,
    body: html,
  };

  const start = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const ms = Date.now() - start;

  console.log(`\nHTTP ${res.status} in ${ms}ms`);
  console.log('Response:', text || '(empty — Chathead does not echo on POST, treat 200 as success)');

  process.exit(res.ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
