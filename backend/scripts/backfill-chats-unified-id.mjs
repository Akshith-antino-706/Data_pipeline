// One-shot: populate public.chats.unified_id by matching against
// public.unified_contacts on phone (normalize_phone, last 10 digits)
// then email (lower(trim(...))). Tiebreak: lowest unified_contacts.id.
// Safe to re-run (only touches rows where unified_id IS NULL).

import 'dotenv/config';
import pg from 'pg';

const u = new URL(process.env.DATABASE_URL);
const c = new pg.Client({
  host: u.hostname, port: Number(u.port || 5432),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 10 * 60 * 1000,
});
await c.connect();

const t0 = Date.now();
try {
  const before = await c.query(`SELECT COUNT(*) FILTER (WHERE unified_id IS NULL) AS null_n, COUNT(*) AS total FROM chats`);
  console.log(`Before: ${before.rows[0].null_n} / ${before.rows[0].total} chats have NULL unified_id`);

  console.log('\nPass 1 — match by phone (normalize_phone, last 10 digits) ...');
  const t1 = Date.now();
  const p1 = await c.query(`
    WITH ranked AS (
      SELECT DISTINCT ON (normalize_phone(mobile))
             normalize_phone(mobile) AS phone_key, id
      FROM unified_contacts
      WHERE mobile IS NOT NULL AND mobile <> ''
        AND normalize_phone(mobile) IS NOT NULL
      ORDER BY normalize_phone(mobile), id
    )
    UPDATE chats c
    SET unified_id = r.id
    FROM ranked r
    WHERE c.unified_id IS NULL
      AND c.wa_id IS NOT NULL
      AND normalize_phone(c.wa_id) = r.phone_key
  `);
  console.log(`  matched ${p1.rowCount} chats by phone in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  console.log('\nPass 2 — match remaining by email (lower(trim)) ...');
  const t2 = Date.now();
  const p2 = await c.query(`
    WITH ranked AS (
      SELECT DISTINCT ON (lower(trim(email)))
             lower(trim(email)) AS email_key, id
      FROM unified_contacts
      WHERE email IS NOT NULL AND email <> ''
      ORDER BY lower(trim(email)), id
    )
    UPDATE chats c
    SET unified_id = r.id
    FROM ranked r
    WHERE c.unified_id IS NULL
      AND c.email IS NOT NULL AND c.email <> ''
      AND lower(trim(c.email)) = r.email_key
  `);
  console.log(`  matched ${p2.rowCount} chats by email in ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  const after = await c.query(`SELECT COUNT(*) FILTER (WHERE unified_id IS NOT NULL) AS filled, COUNT(*) AS total FROM chats`);
  const filled = Number(after.rows[0].filled);
  const total = Number(after.rows[0].total);
  console.log(`\nAfter: ${filled} / ${total} chats have unified_id set  (${(100 * filled / total).toFixed(2)}%)`);
  console.log(`Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('FAILED:', err);
  process.exitCode = 1;
} finally {
  await c.end();
}
