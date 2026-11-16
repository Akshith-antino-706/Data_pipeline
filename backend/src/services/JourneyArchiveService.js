/**
 * JourneyArchiveService — copies completed FIXED journeys to S3 (copy only, never deletes).
 *
 * Picks journeys with status 'completed', journey_type <> 'gtm', whose last email was sent
 * at least JOURNEY_ARCHIVE_MIN_AGE_DAYS ago and that are not in S3 yet, and writes them as
 *   journeys/completed_month=YYYY-MM/journey_id=N/<table>.csv.gz + _columns.csv + manifest.json
 * — the layout the Journey Archive screen (routes/journeyArchive.js) reads.
 *
 * Read-only on the database: every query runs in its own READ ONLY transaction with a
 * statement timeout; the big tables are streamed per node with COPY → gzip → S3 multipart,
 * so memory stays flat. manifest.json is written LAST, only after every table's row count
 * checks out — a journey without a manifest is invisible to the screen and is redone on the
 * next run (that is also the "already archived?" marker; no tracking table in the DB).
 */
import zlib from 'zlib';
import { Transform } from 'stream';
import { to as copyTo } from 'pg-copy-streams';
import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import pool from '../config/database.js';

const BUCKET = () => process.env.ARCHIVE_S3_BUCKET || 'rayna-journey-archive-022278165625';
const MANIFEST_RE = /^journeys\/completed_month=\d{4}-\d{2}\/journey_id=(\d+)\/manifest\.json$/;
const COPY_TIMEOUT = '600s';          // per chunk; a cold 750k-row email node took ~160s
const DUBAI_MS = 4 * 3600 * 1000;

let _s3;
const s3 = () => (_s3 ||= new S3Client({ region: process.env.ARCHIVE_S3_REGION || 'eu-north-1' }));

export function archiveConfig(env = process.env) {
  return {
    enabled:     env.JOURNEY_ARCHIVE_EXPORT_ENABLED === 'true',
    dryRun:      env.JOURNEY_ARCHIVE_DRY_RUN !== 'false',          // safe default: log only
    minAgeDays:  Math.max(1, parseInt(env.JOURNEY_ARCHIVE_MIN_AGE_DAYS || '20', 10)),
    maxPerRun:   Math.max(1, parseInt(env.JOURNEY_ARCHIVE_MAX_PER_RUN || '5', 10)),
    maxMinutes:  Math.max(5, parseInt(env.JOURNEY_ARCHIVE_MAX_MINUTES || '90', 10)),
    includeTest: env.JOURNEY_ARCHIVE_INCLUDE_TEST === 'true',
  };
}

// Run fn(client) inside a READ ONLY transaction on its own pooled connection. On any error the
// connection is destroyed rather than returned (it may be mid-COPY); the server then rolls back.
async function readOnly(fn, timeout = '60s') {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = '${timeout}'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '120s'`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    broken = true;
    throw err;
  } finally {
    client.release(broken);
  }
}

async function archivedJourneyIds() {
  const ids = new Set();
  let token;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: 'journeys/', ContinuationToken: token }));
    for (const o of page.Contents || []) {
      const m = MANIFEST_RE.exec(o.Key);
      if (m) ids.add(Number(m[1]));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return ids;
}

async function candidateJourneys(cfg) {
  const { rows } = await readOnly(c => c.query(
    `SELECT journey_id, name, nodes, edges, custom_segment_id, updated_at
       FROM journey_flows
      WHERE status = 'completed'
        AND COALESCE(journey_type, 'normal') <> 'gtm'
        AND updated_at < NOW() - make_interval(days => $1)
        AND ($2 OR test_mode IS NOT TRUE)
      ORDER BY updated_at ASC`,
    [cfg.minAgeDays, cfg.includeTest]
  ));
  return rows;
}

// Node ids in flow order (walk edges from the trigger) — the last action node holds the last send.
function flowOrder(nodes = [], edges = []) {
  const next = {};
  for (const e of edges || []) (next[e.source] ||= []).push(e.target);
  const ids = new Set((nodes || []).map(n => n.id));
  const start = (nodes || []).find(n => n.type === 'trigger')?.id || nodes?.[0]?.id;
  const out = []; const seen = new Set(); const queue = start ? [start] : [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !ids.has(id)) continue;
    seen.add(id); out.push(id); queue.push(...(next[id] || []));
  }
  return [...out, ...[...ids].filter(id => !seen.has(id))];
}

const nodeCounts = (table, jid) => readOnly(async c =>
  (await c.query(`SELECT node_id, COUNT(*)::bigint AS n FROM ${table} WHERE journey_id = $1 GROUP BY node_id`, [jid]))
    .rows.map(r => ({ node_id: r.node_id, n: Number(r.n) })), '300s');

// Last email of the journey = max(sent_at) on the last node (in flow order) that sent emails.
async function lastSentAt(j, emailCounts) {
  const withRows = new Set(emailCounts.filter(r => r.node_id && r.n > 0).map(r => r.node_id));
  const lastNode = flowOrder(j.nodes, j.edges).filter(id => withRows.has(id)).pop();
  if (!lastNode) return j.updated_at;                      // no emails (WA/SMS-only) → completion time
  const { rows: [r] } = await readOnly(c => c.query(
    'SELECT MAX(sent_at) AS last FROM email_send_log WHERE journey_id = $1 AND node_id = $2', [j.journey_id, lastNode]
  ), '300s');
  return r?.last || j.updated_at;
}

const dubaiMonth = (ts) => new Date(new Date(ts).getTime() + DUBAI_MS).toISOString().slice(0, 7);

// Stream every chunk of one table into ONE gzipped CSV in S3. Each chunk is its own COPY in its
// own READ ONLY transaction (short snapshots); only the first chunk writes the header row.
async function exportTable(key, table, chunks) {
  let bytes = 0;
  const counter = new Transform({ transform(buf, _e, cb) { bytes += buf.length; cb(null, buf); } });
  const gzip = zlib.createGzip({ level: 6 });
  gzip.on('error', () => {}); counter.on('error', () => {});   // surfaced via upload / COPY instead
  gzip.pipe(counter);
  const upload = new Upload({
    client: s3(), params: { Bucket: BUCKET(), Key: key, Body: counter, ContentType: 'application/gzip' },
    partSize: 8 * 1024 * 1024, queueSize: 2,
  });
  const done = upload.done();
  // If the upload dies mid-table, abort the running COPY instead of letting it stall on backpressure.
  const uploadFailed = new Promise((_, reject) => done.catch(reject));
  uploadFailed.catch(() => {});
  let rows = 0;
  try {
    for (let i = 0; i < chunks.length; i++) {
      rows += await readOnly(c => Promise.race([uploadFailed, new Promise((resolve, reject) => {
        const stream = c.query(copyTo(
          `COPY (SELECT * FROM ${table} WHERE ${chunks[i]}) TO STDOUT WITH (FORMAT csv, HEADER ${i === 0})`));
        stream.on('error', reject);
        stream.on('end', () => resolve(stream.rowCount));
        stream.pipe(gzip, { end: false });
      })]), COPY_TIMEOUT);
    }
    gzip.end();
    await done;
  } catch (err) {
    gzip.destroy(err);
    await upload.abort().catch(() => {});
    throw err;
  }
  const head = await s3().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
  if (head.ContentLength !== bytes) throw new Error(`${table}: S3 size ${head.ContentLength} ≠ streamed ${bytes}`);
  return { rows, gz_bytes: bytes };
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const csvCell = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const ARCHIVE_TABLES = ['journey_flows', 'custom_segments', 'journey_node_stats', 'unsubscribe_log', 'journey_entries',
  'journey_events', 'email_send_log', 'whatsapp_send_log', 'sms_send_log'];
const PER_NODE = new Set(['journey_events', 'email_send_log']);

async function exportJourney(j, lastSent, emailCounts, log) {
  const started = Date.now();
  const jid = Number(j.journey_id);
  if (!Number.isInteger(jid)) throw new Error(`bad journey id ${j.journey_id}`);
  const month = dubaiMonth(lastSent);
  const dir = `journeys/completed_month=${month}/journey_id=${jid}/`;
  const tables = {};

  for (const table of ARCHIVE_TABLES) {
    let chunks; let expected;
    if (PER_NODE.has(table)) {
      const counts = table === 'email_send_log' ? emailCounts : await nodeCounts(table, jid);
      chunks = counts.map(r => `journey_id = ${jid} AND ${r.node_id == null ? 'node_id IS NULL' : `node_id = ${lit(r.node_id)}`}`);
      expected = counts.reduce((s, r) => s + r.n, 0);
    } else if (table === 'custom_segments') {
      chunks = [j.custom_segment_id ? `id = ${Number(j.custom_segment_id)}` : 'false'];
    } else {
      chunks = [`journey_id = ${jid}`];
    }
    if (!chunks.length) chunks = ['false'];                 // header-only file
    const res = await exportTable(`${dir}${table}.csv.gz`, table, chunks);
    // Rows are never deleted from these tables, but late events (opens, unsubscribes) can still
    // be inserted between the count and the COPY — so the copy may hold more, never fewer.
    if (expected != null && res.rows < expected) throw new Error(`${table}: copied ${res.rows} < counted ${expected}`);
    tables[table] = res;
    log(`  ${table}: ${res.rows} rows, ${res.gz_bytes} bytes gz`);
  }

  const { rows: cols } = await readOnly(c => c.query(
    `SELECT table_name, ordinal_position, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1, 2`, [ARCHIVE_TABLES]));
  const colsCsv = ['table_name,ordinal_position,column_name,data_type',
    ...cols.map(r => [r.table_name, r.ordinal_position, r.column_name, r.data_type].map(csvCell).join(','))].join('\n') + '\n';
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: `${dir}_columns.csv`, Body: colsCsv, ContentType: 'text/csv' }));

  const manifest = {
    journey_id: jid,
    name: j.name,
    source: 'prod raynadb (journey archive cron, read-only)',
    exported_at: new Date().toISOString(),
    last_sent_at: new Date(lastSent).toISOString(),
    completed_month: month,
    duration_ms: Date.now() - started,
    tables,
  };
  await s3().send(new PutObjectCommand({
    Bucket: BUCKET(), Key: `${dir}manifest.json`, Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json',
  }));
  return manifest;
}

let _running = false;
export const isArchiveRunning = () => _running;

/**
 * One archive run. opts: { dryRun, maxPerRun, maxMinutes, journeyId } override the env config.
 * Returns a summary; never throws for a single journey's failure (it is retried next run).
 */
export async function runJourneyArchive(opts = {}, log = (m) => console.log(`[JourneyArchive] ${m}`)) {
  if (_running) return { skipped: 'already running' };
  _running = true;
  const cfg = { ...archiveConfig(), ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  const started = Date.now();
  const summary = { dryRun: cfg.dryRun, minAgeDays: cfg.minAgeDays, archived: [], failed: [], tooRecent: [], wouldArchive: [] };
  try {
    const done = await archivedJourneyIds();
    let list = (await candidateJourneys(cfg)).filter(j => !done.has(Number(j.journey_id)));
    if (cfg.journeyId) list = list.filter(j => Number(j.journey_id) === Number(cfg.journeyId));
    summary.alreadyArchived = done.size;
    summary.candidates = list.length;
    log(`${cfg.dryRun ? 'DRY RUN — ' : ''}${list.length} candidate journey(s) not yet in S3 (min age ${cfg.minAgeDays}d, max ${cfg.maxPerRun}/run)`);

    for (const j of list) {
      if (summary.archived.length + summary.wouldArchive.length >= cfg.maxPerRun) break;
      if (Date.now() - started > cfg.maxMinutes * 60000) { log(`time budget of ${cfg.maxMinutes} min reached — stopping`); break; }
      const t0 = Date.now();
      try {
        const emailCounts = await nodeCounts('email_send_log', j.journey_id);
        const last = await lastSentAt(j, emailCounts);
        const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
        if (ageDays < cfg.minAgeDays) {
          summary.tooRecent.push({ journey_id: j.journey_id, last_sent_at: last });
          continue;
        }
        const emails = emailCounts.reduce((s, r) => s + r.n, 0);
        if (cfg.dryRun) {
          summary.wouldArchive.push({ journey_id: j.journey_id, name: j.name, last_sent_at: last, month: dubaiMonth(last), emails });
          log(`would archive #${j.journey_id} "${j.name}" — last send ${new Date(last).toISOString()}, ${emails} emails`);
          continue;
        }
        log(`archiving #${j.journey_id} "${j.name}" (last send ${new Date(last).toISOString()}, ${emails} emails)`);
        const m = await exportJourney(j, last, emailCounts, log);
        summary.archived.push({ journey_id: j.journey_id, month: m.completed_month, seconds: Math.round((Date.now() - t0) / 1000) });
        log(`✓ #${j.journey_id} archived to ${m.completed_month} in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (err) {
        summary.failed.push({ journey_id: j.journey_id, error: err.message });
        console.error(`[JourneyArchive] ✗ #${j.journey_id} failed: ${err.message} (no manifest written — retried next run)`);
      }
    }
  } finally {
    _running = false;
    summary.seconds = Math.round((Date.now() - started) / 1000);
  }
  log(`done in ${summary.seconds}s — archived ${summary.archived.length}, would archive ${summary.wouldArchive.length}, failed ${summary.failed.length}, too recent ${summary.tooRecent.length}`);
  return summary;
}

export default { runJourneyArchive, archiveConfig, isArchiveRunning };
