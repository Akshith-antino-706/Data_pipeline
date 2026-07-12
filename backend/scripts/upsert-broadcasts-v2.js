// One-shot upsert: new trust-badge versions of the 7 weekly broadcasts + 1 new
// standalone trust-social-proof template. Run once via `node scripts/upsert-broadcasts-v2.js`.
// After this lands, future imports can use the existing import-weekly-broadcasts.js
// once the on-disk sources are refreshed.

import { readFile } from 'node:fs/promises';
import pg from 'pg';
const { Client } = pg;

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

const TEMPLATES = [
  { name: 'Weekly Broadcast — Monday (Visa: Asia)',                        file: '/private/tmp/broadcast_templates_v2/email_1_visa_asia_monday.html' },
  { name: 'Weekly Broadcast — Tuesday (Holiday: South East Asia)',         file: '/private/tmp/broadcast_templates_v2/email_2_holiday_sea_tuesday.html' },
  { name: 'Weekly Broadcast — Wednesday (Visa: Europe & Long-haul)',       file: '/private/tmp/broadcast_templates_v2/email_3_visa_europe_wednesday.html' },
  { name: 'Weekly Broadcast — Thursday (Cruises)',                         file: '/private/tmp/broadcast_templates_v2/email_4_cruise_thursday.html' },
  { name: 'Weekly Broadcast — Friday (Holiday: UAE & Central Asia)',       file: '/private/tmp/broadcast_templates_v2/email_5_holiday_uae_centralasia_friday.html' },
  { name: 'Weekly Broadcast — Saturday (Activities: Dubai & Abu Dhabi)',   file: '/private/tmp/broadcast_templates_v2/email_6_activities_dubai_abudhabi_saturday.html' },
  { name: 'Weekly Broadcast — Sunday (Visa: GCC & Africa)',                file: '/private/tmp/broadcast_templates_v2/email_7_visa_gcc_africa_sunday.html' },
  { name: 'Trust & Social Proof — Verified Ratings',                       file: '/private/tmp/broadcast_templates_v2/email_trust_social_proof.html' },
];

const client = new Client({
  host: 'raynadb.cx2ygcy4akh9.eu-north-1.rds.amazonaws.com',
  port: 5432, database: 'postgres', user: 'raynadb', password: 'raynadevdb',
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const inserted = [];
const updated  = [];

for (const t of TEMPLATES) {
  const html    = await readFile(t.file, 'utf8');
  const subject = extractTitle(html) || t.name;

  const exists = await client.query('SELECT id, status FROM content_templates WHERE name = $1', [t.name]);

  if (exists.rows.length) {
    const { rows } = await client.query(`
      UPDATE content_templates
         SET body = $1, subject = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, status, length(body) AS body_bytes
    `, [html, subject, exists.rows[0].id]);
    updated.push(rows[0]);
  } else {
    const { rows } = await client.query(`
      INSERT INTO content_templates (name, channel, subject, body, status, created_by, approved_by, approved_at)
      VALUES ($1, 'email', $2, $3, 'approved', 'script:upsert-broadcasts-v2', 'akshith@raynatours.com', NOW())
      RETURNING id, name, status, length(body) AS body_bytes
    `, [t.name, subject, html]);
    inserted.push(rows[0]);
  }
}

if (updated.length) {
  console.log('Updated:');
  updated.forEach(r => console.log(`  #${r.id}  [${r.status}]  ${r.body_bytes}B  ${r.name}`));
}
if (inserted.length) {
  console.log('Inserted:');
  inserted.forEach(r => console.log(`  #${r.id}  [${r.status}]  ${r.body_bytes}B  ${r.name}`));
}

await client.end();
