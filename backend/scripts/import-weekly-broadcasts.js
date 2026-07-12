import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;

const SOURCE_DIR = '/Users/avinashkumar/Downloads';

const TEMPLATES = [
  { file: 'email_1_visa_asia_monday.html',                name: 'Weekly Broadcast — Monday (Visa: Asia)' },
  { file: 'email_2_holiday_sea_tuesday.html',             name: 'Weekly Broadcast — Tuesday (Holiday: South East Asia)' },
  { file: 'email_3_visa_europe_wednesday.html',           name: 'Weekly Broadcast — Wednesday (Visa: Europe & Long-haul)' },
  { file: 'email_4_cruise_thursday.html',                 name: 'Weekly Broadcast — Thursday (Cruises)' },
  { file: 'email_5_holiday_uae_centralasia_friday.html',  name: 'Weekly Broadcast — Friday (Holiday: UAE & Central Asia)' },
  { file: 'email_6_activities_dubai_abudhabi_saturday.html', name: 'Weekly Broadcast — Saturday (Activities: Dubai & Abu Dhabi)' },
  { file: 'email_7_visa_gcc_africa_sunday.html',          name: 'Weekly Broadcast — Sunday (Visa: GCC & Africa)' },
];

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

const client = new Client({
  host: 'raynadb.cx2ygcy4akh9.eu-north-1.rds.amazonaws.com',
  port: 5432,
  database: 'postgres',
  user: 'raynadb',
  password: 'raynadevdb',
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// Mode: 'upsert' updates body + subject if name exists, inserts otherwise.
const inserted = [];
const updated  = [];

for (const t of TEMPLATES) {
  const html    = await readFile(`${SOURCE_DIR}/${t.file}`, 'utf8');
  const subject = extractTitle(html) || t.name;

  const exists = await client.query(
    'SELECT id, status FROM content_templates WHERE name = $1',
    [t.name]
  );

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
      INSERT INTO content_templates (name, channel, subject, body, created_by)
      VALUES ($1, 'email', $2, $3, 'script:import-weekly-broadcasts')
      RETURNING id, name, status, length(body) AS body_bytes
    `, [t.name, subject, html]);
    inserted.push(rows[0]);
  }
}

if (inserted.length) {
  console.log('Inserted:');
  inserted.forEach(r => console.log(`  #${r.id}  [${r.status}]  ${r.body_bytes}B  ${r.name}`));
}
if (updated.length) {
  console.log('Updated (body + subject overwritten):');
  updated.forEach(r => console.log(`  #${r.id}  [${r.status}]  ${r.body_bytes}B  ${r.name}`));
}

await client.end();
