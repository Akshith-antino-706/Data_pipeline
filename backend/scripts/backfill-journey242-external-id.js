// One-shot backfill for journey 242: populate email_send_log.external_id
// from ses_events.message_id by matching lower(email) + nearest created_at
// within a [sent_at -10min, sent_at +30min] window.
//
// Idempotent: only touches rows where external_id IS NULL.
// Batched by id with a cursor (lastId) so we process every row exactly once,
// even if it stays NULL because no SES event matched.

import pg from 'pg';
const { Client } = pg;

const BATCH = 5000;
const JOURNEY = 242;

const c = new Client({
  host: 'raynadb.cx2ygcy4akh9.eu-north-1.rds.amazonaws.com',
  port: 5432, database: 'postgres', user: 'raynadb', password: 'raynadevdb',
  ssl: { rejectUnauthorized: false },
});
await c.connect();

let lastId = 0;
let totalUpdated = 0;
let totalScanned = 0;
let batchNum = 0;
const start = Date.now();

while (true) {
  batchNum++;
  const r = await c.query(`
    WITH batch AS (
      SELECT id, lower(email) AS email, sent_at
        FROM email_send_log
       WHERE journey_id = $1
         AND sent_at IS NOT NULL
         AND id > $2
       ORDER BY id
       LIMIT $3
    ),
    matched AS (
      SELECT b.id,
             (SELECT se.message_id FROM ses_events se
               WHERE lower(se.email) = b.email
                 AND se.message_id IS NOT NULL
                 AND se.created_at BETWEEN b.sent_at - INTERVAL '10 minutes'
                                       AND b.sent_at + INTERVAL '30 minutes'
               ORDER BY ABS(EXTRACT(EPOCH FROM (se.created_at - b.sent_at)))
               LIMIT 1) AS msgid
        FROM batch b
    ),
    upd AS (
      UPDATE email_send_log esl
         SET external_id = m.msgid
        FROM matched m
       WHERE esl.id = m.id
         AND m.msgid IS NOT NULL
         AND esl.external_id IS NULL
      RETURNING esl.id
    )
    SELECT (SELECT COUNT(*) FROM batch)::int AS scanned,
           (SELECT COUNT(*) FROM upd)::int   AS updated,
           (SELECT MAX(id)  FROM batch)::bigint AS max_id;
  `, [JOURNEY, lastId, BATCH]);

  const { scanned, updated, max_id } = r.rows[0];
  if (!scanned || !max_id) break;
  totalScanned += scanned;
  totalUpdated += updated;
  lastId = Number(max_id);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`batch=${batchNum} lastId=${lastId} scanned=${scanned} updated_in_batch=${updated} total_updated=${totalUpdated} total_scanned=${totalScanned} elapsed=${elapsed}s`);
}

console.log(`\nDONE. Total scanned: ${totalScanned}, total updated: ${totalUpdated}, time: ${((Date.now()-start)/1000).toFixed(1)}s`);
await c.end();
