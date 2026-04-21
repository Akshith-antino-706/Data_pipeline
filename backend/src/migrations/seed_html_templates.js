/**
 * seed_html_templates — Ingest raw HTML email files into `email_html_templates`
 * and create matching `content_templates` rows linked via `html_template_id`.
 *
 * Idempotent: upserts on name, so re-running updates html_body/subject/etc.
 * Run: node src/migrations/seed_html_templates.js
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '../../../mail_templates');

// One entry per production template. Add new templates here.
const TEMPLATES = [
  {
    file: 'day5-activities-emailer.html',
    html_name: 'Day 5 — Activities & Experiences',
    html_type: 'static',
    html_category: 'activities',
    preview_text: 'World-class activities & experiences, instantly booked.',
    placeholders: ['first_name'],
    content_templates: [
      {
        name: 'PROSPECT — Day 9 Activities Offer',
        segment_label: 'PROSPECT',
        subject: '20% off your first activity — exclusive offer',
        variables: ['first_name', 'offer_tag'],
      },
    ],
  },
];

async function upsertHtmlTemplate(t, html) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO email_html_templates (name, type, category, html_body, placeholders, preview_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (name) DO UPDATE SET
       type = EXCLUDED.type,
       category = EXCLUDED.category,
       html_body = EXCLUDED.html_body,
       placeholders = EXCLUDED.placeholders,
       preview_text = EXCLUDED.preview_text,
       updated_at = NOW()
     RETURNING id`,
    [t.html_name, t.html_type, t.html_category, html, t.placeholders, t.preview_text]
  );
  return row.id;
}

async function upsertContentTemplate(ct, htmlId) {
  // content_templates has no UNIQUE(name) — use name+channel to dedupe.
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM content_templates WHERE name = $1 AND channel = 'email' LIMIT 1`,
    [ct.name]
  );
  if (existing) {
    await pool.query(
      `UPDATE content_templates
       SET subject = $2, body = $3, segment_label = $4, variables = $5,
           html_template_id = $6, status = 'approved', updated_at = NOW()
       WHERE id = $1`,
      [existing.id, ct.subject, ct.subject, ct.segment_label, ct.variables, htmlId]
    );
    return { id: existing.id, action: 'updated' };
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO content_templates (name, channel, status, segment_label, subject, body, variables, html_template_id)
     VALUES ($1, 'email', 'approved', $2, $3, $4, $5, $6)
     RETURNING id`,
    [ct.name, ct.segment_label, ct.subject, ct.subject, ct.variables, htmlId]
  );
  return { id: row.id, action: 'inserted' };
}

async function main() {
  console.log('Seeding email HTML templates…');
  for (const t of TEMPLATES) {
    const html = await readFile(join(TEMPLATE_DIR, t.file), 'utf-8');
    const htmlId = await upsertHtmlTemplate(t, html);
    console.log(`  ✓ ${t.html_name}  (id=${htmlId}, ${(html.length/1024).toFixed(1)}KB)`);
    for (const ct of t.content_templates) {
      const res = await upsertContentTemplate(ct, htmlId);
      console.log(`      · content_template "${ct.name}"  (id=${res.id}, ${res.action})`);
    }
  }

  const { rows: [counts] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM email_html_templates) AS html_count,
      (SELECT COUNT(*) FROM content_templates WHERE html_template_id IS NOT NULL) AS linked_count
  `);
  console.log(`\nDone. ${counts.html_count} HTML template(s), ${counts.linked_count} content_template(s) linked.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
