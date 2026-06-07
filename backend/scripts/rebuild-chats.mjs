// One-shot: drop public.chats in RDS, recreate with new schema,
// and bulk-copy all rows from MySQL rayna_data.chats.
// Safe to re-run (DROP + CREATE).

import 'dotenv/config';
import mysql from 'mysql2/promise';
import pg from 'pg';

const BATCH = 2000;

const toDate = (v) => (v instanceof Date && !isNaN(v) ? v : null);

const my = await mysql.createConnection({
  host: process.env.MYSQL2_HOST,
  port: Number(process.env.MYSQL2_PORT || 3306),
  user: process.env.MYSQL2_USER,
  password: process.env.MYSQL2_PASS,
  database: process.env.MYSQL2_DB,
  connectTimeout: 15000,
  dateStrings: false,
});

const pgUrl = new URL(process.env.DATABASE_URL);
const pgClient = new pg.Client({
  host: pgUrl.hostname,
  port: Number(pgUrl.port || 5432),
  user: decodeURIComponent(pgUrl.username),
  password: decodeURIComponent(pgUrl.password),
  database: pgUrl.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();

const t0 = Date.now();

try {
  const [[srcCount]] = await my.query('SELECT COUNT(*) AS n FROM chats');
  console.log(`MySQL chats source rows: ${srcCount.n}`);

  console.log('Dropping and recreating public.chats ...');
  await pgClient.query('BEGIN');
  await pgClient.query('DROP TABLE IF EXISTS public.chats CASCADE');
  await pgClient.query(`
    CREATE TABLE public.chats (
      id              SERIAL PRIMARY KEY,
      wa_id           VARCHAR(20)  NOT NULL,
      wa_name         VARCHAR(25),
      email           VARCHAR(100),
      country         VARCHAR(50),
      receiver        VARCHAR(20)  NOT NULL,
      boat            INTEGER,
      status          INTEGER      NOT NULL,
      priority        INTEGER      NOT NULL DEFAULT 4,
      tags            VARCHAR(510),
      fv              INTEGER      NOT NULL DEFAULT 0,
      last_in         TIMESTAMP,
      last_out        TIMESTAMP,
      last_msg        TIMESTAMP,
      last_short      VARCHAR(60),
      seen            INTEGER      NOT NULL DEFAULT 1,
      spam            INTEGER      NOT NULL DEFAULT 0,
      last_packed     VARCHAR(15)  NOT NULL DEFAULT '0',
      created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP,
      user_id         INTEGER,
      first_msg_text  TEXT,
      last_msg_at     TIMESTAMP,
      unified_id      BIGINT,
      synced_date     TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_chats_wa_id    ON public.chats(wa_id);
    CREATE INDEX idx_chats_receiver ON public.chats(receiver);
    CREATE INDEX idx_chats_status   ON public.chats(status);
    CREATE INDEX idx_chats_last_msg ON public.chats(last_msg);
    CREATE INDEX idx_chats_user     ON public.chats(user_id);
  `);
  await pgClient.query('COMMIT');
  console.log('Schema created.');

  // 23 columns per row (id is SERIAL, synced_date defaults to now()).
  const cols = [
    'wa_id', 'wa_name', 'email', 'country', 'receiver', 'boat', 'status',
    'priority', 'tags', 'fv', 'last_in', 'last_out', 'last_msg', 'last_short',
    'seen', 'spam', 'last_packed', 'created_at', 'updated_at',
    'user_id', 'first_msg_text', 'last_msg_at', 'unified_id',
  ];
  const colList = cols.join(', ');
  const colCount = cols.length;

  const buildPlaceholders = (rowCount) => {
    const parts = [];
    let p = 1;
    for (let r = 0; r < rowCount; r++) {
      const row = [];
      for (let c = 0; c < colCount; c++) row.push(`$${p++}`);
      parts.push(`(${row.join(',')})`);
    }
    return parts.join(',');
  };

  const insertBatch = async (rows) => {
    if (rows.length === 0) return;
    const sql = `INSERT INTO public.chats (${colList}) VALUES ${buildPlaceholders(rows.length)}`;
    const params = [];
    for (const r of rows) {
      params.push(
        r.wa_id,
        r.wa_name,
        r.email,
        r.country,
        r.receiver,
        r.boat,
        r.status,
        r.priority,
        r.tags,
        r.fv,
        toDate(r.last_in),
        toDate(r.last_out),
        toDate(r.last_msg),
        r.last_short,
        r.seen,
        r.spam,
        r.last_packed,
        toDate(r.created_at),
        toDate(r.updated_at),
        null,                // user_id
        null,                // first_msg_text
        toDate(r.last_msg),  // last_msg_at mirrors last_msg
        null,                // unified_id
      );
    }
    await pgClient.query(sql, params);
  };

  console.log(`Streaming rows from MySQL in batches of ${BATCH} ...`);
  let inserted = 0;
  let lastId = 0;
  // Order by id so we can paginate by keyset (avoids OFFSET cost on 481k rows).
  while (true) {
    const [rows] = await my.query(
      'SELECT id, wa_id, wa_name, email, country, receiver, boat, status, priority, tags, fv, last_in, last_out, last_msg, last_short, seen, spam, last_packed, created_at, updated_at FROM chats WHERE id > ? ORDER BY id ASC LIMIT ?',
      [lastId, BATCH]
    );
    if (rows.length === 0) break;
    await insertBatch(rows);
    inserted += rows.length;
    lastId = rows[rows.length - 1].id;
    if (inserted % 20000 === 0 || rows.length < BATCH) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  inserted ${inserted} / ${srcCount.n}  (lastId=${lastId})  ${elapsed}s`);
    }
  }

  // Verify
  const dstCountRes = await pgClient.query('SELECT COUNT(*)::bigint AS n FROM public.chats');
  const dstCount = Number(dstCountRes.rows[0].n);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s. MySQL=${srcCount.n}  RDS=${dstCount}  diff=${srcCount.n - dstCount}`);

  if (dstCount !== Number(srcCount.n)) {
    console.warn('  ⚠ row counts differ — investigate before considering this complete.');
  } else {
    console.log('  ✓ row counts match.');
  }
} catch (err) {
  try { await pgClient.query('ROLLBACK'); } catch {}
  console.error('FAILED:', err);
  process.exitCode = 1;
} finally {
  await my.end();
  await pgClient.end();
}
