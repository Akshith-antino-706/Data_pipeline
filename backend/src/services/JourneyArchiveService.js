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
import { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import pool from '../config/database.js';

const BUCKET = () => process.env.ARCHIVE_S3_BUCKET || 'rayna-journey-archive-022278165625';
const MANIFEST_RE = /^journeys\/completed_month=\d{4}-\d{2}\/journey_id=(\d+)\/manifest\.json$/;
const TEMPLATES_FILE = 'email_templates.json.gz';
const COPY_TIMEOUT = '600s';          // per chunk; a cold 750k-row email node took ~160s
const DUBAI_MS = 4 * 3600 * 1000;
const LAST_SENT_TIMEOUT = '30s';

// journey_id → time of its last failure. In memory: a restart (deploy) clears it, which only
// means one more attempt. Keeps a journey that keeps failing from using up every night's run.
const _failedAt = new Map();

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
    // Journeys with more emails than this are skipped (logged as too big) — copying one that size
    // would hold the DB for hours. Raise it to archive a specific big journey on purpose.
    maxEmails:   Math.max(1, parseInt(env.JOURNEY_ARCHIVE_MAX_EMAILS || '3000000', 10)),
    // A journey that failed is not tried again for this long, so it can't use up every night's run.
    retryHours:  Math.max(1, parseInt(env.JOURNEY_ARCHIVE_RETRY_HOURS || '72', 10)),
    // Big tables copied at the same time, each on its own READ ONLY connection (1 = one by one).
    parallel:    Math.min(3, Math.max(1, parseInt(env.JOURNEY_ARCHIVE_PARALLEL || '3', 10))),
    // gzip level: 1 is ~3× faster than 6 for files ~25% bigger (S3 cost stays negligible).
    gzipLevel:   Math.min(9, Math.max(1, parseInt(env.JOURNEY_ARCHIVE_GZIP_LEVEL || '1', 10))),
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

// Archived journeys: journey_id → { dir, hasTemplates } (a journey counts once its manifest exists).
async function archivedJourneys() {
  const out = new Map();
  const templates = new Set();
  let token;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: 'journeys/', ContinuationToken: token }));
    for (const o of page.Contents || []) {
      const m = MANIFEST_RE.exec(o.Key);
      if (m) out.set(Number(m[1]), { dir: o.Key.slice(0, -'manifest.json'.length) });
      if (o.Key.endsWith(`/${TEMPLATES_FILE}`)) templates.add(o.Key.slice(0, -TEMPLATES_FILE.length));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  for (const v of out.values()) v.hasTemplates = templates.has(v.dir);
  return out;
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
//
// A plain MAX(sent_at) lets Postgres walk the sent_at index backwards from TODAY until it meets this
// journey — tens of millions of rows for an old journey, so it hit the 5-min timeout every night
// (#242, #245, #268, #307). `sent_at + interval '0'` stops that shortcut and enable_seqscan = off
// keeps it off a full-table scan, so it reads only this node's rows via idx_esl_journey_node.
// Still bounded to LAST_SENT_TIMEOUT: past it, the journey's completion time is used instead — safe,
// because a fixed journey sends nothing after it completes, and candidates are already completed
// at least minAgeDays ago. Only the archive month can differ (completion vs. last send).
async function lastSentAt(j, emailCounts, log = () => {}) {
  const withRows = new Set(emailCounts.filter(r => r.node_id && r.n > 0).map(r => r.node_id));
  const lastNode = flowOrder(j.nodes, j.edges).filter(id => withRows.has(id)).pop();
  if (!lastNode) return j.updated_at;                      // no emails (WA/SMS-only) → completion time
  try {
    const { rows: [r] } = await readOnly(async c => {
      await c.query('SET LOCAL enable_seqscan = off');
      return c.query(
        `SELECT MAX(sent_at + interval '0') AS last FROM email_send_log WHERE journey_id = $1 AND node_id = $2`,
        [j.journey_id, lastNode]);
    }, LAST_SENT_TIMEOUT);
    return r?.last || j.updated_at;
  } catch (err) {
    if (err.code !== '57014') throw err;                   // 57014 = statement timeout
    log(`  #${j.journey_id}: last-send lookup over ${LAST_SENT_TIMEOUT} on ${lastNode} — using completion time ${new Date(j.updated_at).toISOString()}`);
    return j.updated_at;
  }
}

const dubaiMonth = (ts) => new Date(new Date(ts).getTime() + DUBAI_MS).toISOString().slice(0, 7);

// Stream every chunk of one table into ONE gzipped CSV in S3. Each chunk is its own COPY in its
// own READ ONLY transaction (short snapshots); only the first chunk writes the header row.
async function exportTable(key, table, chunks, { gzipLevel = 1, tap = null } = {}) {
  const t0 = Date.now();
  let bytes = 0;
  const counter = new Transform({ transform(buf, _e, cb) { bytes += buf.length; cb(null, buf); } });
  const gzip = zlib.createGzip({ level: gzipLevel });
  gzip.on('error', () => {}); counter.on('error', () => {});   // surfaced via upload / COPY instead
  gzip.pipe(counter);
  const upload = new Upload({
    client: s3(), params: { Bucket: BUCKET(), Key: key, Body: counter, ContentType: 'application/gzip' },
    partSize: 16 * 1024 * 1024, queueSize: 4,
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
        if (tap) stream.on('data', buf => tap.push(buf));
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
  return { rows, gz_bytes: bytes, seconds: Math.round((Date.now() - t0) / 1000) };
}

/**
 * Reads the CSV that COPY streams for email_send_log and keeps, per (node, subject), the email
 * count and first/last sent_at — the "subjects sent" summary of the archive preview — so it no
 * longer needs its own second read of email_send_log. Rows without sent_at are ignored, as in
 * the query it replaces. Fed raw COPY output (header row first, RFC 4180 quoting).
 */
class SubjectTally {
  constructor() {
    this.cols = null; this.field = ''; this.row = []; this.quoted = false; this.pendingQuote = false;
    this.groups = new Map();   // node_id → Map(subject → { emails, first, last }) (times in ms)
  }
  push(buf) {
    const text = buf.toString('utf8');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.quoted) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (c === '"') { this.field += '"'; continue; }
          this.quoted = false;                          // closing quote: fall through to c
        } else if (c === '"') { this.pendingQuote = true; continue; }
        else { this.field += c; continue; }
      }
      if (c === '"') this.quoted = true;
      else if (c === ',') { this.row.push(this.field); this.field = ''; }
      else if (c === '\n') { this.row.push(this.field); this.field = ''; this._row(this.row); this.row = []; }
      else if (c !== '\r') this.field += c;
    }
  }
  _row(row) {
    if (!this.cols) { this.cols = { node: row.indexOf('node_id'), subject: row.indexOf('subject'), sent: row.indexOf('sent_at') }; return; }
    const sentText = row[this.cols.sent];
    if (!sentText) return;
    const sent = Date.parse(sentText.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    const node = row[this.cols.node]; const subject = row[this.cols.subject] || null;
    let bySubject = this.groups.get(node);
    if (!bySubject) this.groups.set(node, bySubject = new Map());
    const g = bySubject.get(subject);
    if (!g) bySubject.set(subject, { emails: 1, first: sent, last: sent });
    else { g.emails++; if (sent < g.first) g.first = sent; if (sent > g.last) g.last = sent; }
  }
  /** Same rows the old SQL returned: top 5 subjects per node + node totals. */
  rows() {
    const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
    const out = [];
    for (const [node_id, bySubject] of this.groups) {
      const all = [...bySubject.entries()].map(([subject, g]) => ({ subject, ...g })).sort((a, b) => b.emails - a.emails);
      const node_emails = all.reduce((n, g) => n + g.emails, 0);
      const node_first = Math.min(...all.map(g => g.first));
      const node_last = Math.max(...all.map(g => g.last));
      for (const g of all.slice(0, 5)) {
        out.push({ node_id, subject: g.subject, emails: g.emails, first_sent_at: iso(g.first), last_sent_at: iso(g.last),
          node_emails, node_first_sent_at: iso(node_first), node_last_sent_at: iso(node_last) });
      }
    }
    return out;
  }
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const csvCell = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/**
 * The emails each node sent, for the archive screen's preview (eye button):
 *  - templates: the content_templates row of every email node's template (+ its linked
 *    email_html_templates row) as it stands NOW — templates are personalised per contact at
 *    send time, so the template itself is what can be kept. updated_at is kept so the screen
 *    can warn when a template was edited after the journey's last send.
 *  - nodes: per email node — template id, the frozen rendered email if journey_node_emails has
 *    one (exact HTML sent), and the subjects actually sent with counts and first/last send time.
 * Written as one gzipped JSON next to the tables.
 */
async function exportEmailTemplates(j, dir, sendRows = null) {
  const jid = Number(j.journey_id);
  const emailNodes = (j.nodes || []).filter(n => n.type === 'action' && (n.data?.channel || 'email').toLowerCase() === 'email');
  const tidByNode = Object.fromEntries(emailNodes.map(n => [n.id, parseInt(n.data?.emailTemplateId ?? n.data?.templateId) || null]));
  const tids = [...new Set(Object.values(tidByNode).filter(Boolean))];

  const templates = !tids.length ? [] : (await readOnly(c => c.query(
    `SELECT ct.id, ct.name, ct.channel, ct.status, ct.subject, ct.body, ct.body_plain, ct.version,
            ct.html_template_id, ct.created_at, ct.updated_at,
            eht.name AS html_name, eht.html_body, eht.subject_line AS html_subject_line,
            eht.engine AS html_engine, eht.updated_at AS html_updated_at
       FROM content_templates ct
       LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
      WHERE ct.id = ANY($1)`, [tids]))).rows;
  const stored = (await readOnly(c => c.query(
    'SELECT node_id, template_id, subject, html, source, created_at FROM journey_node_emails WHERE journey_id = $1', [jid]))).rows;
  // Subjects can be personalised, so keep the 5 most-sent per node plus node totals. The full
  // export passes them in (tallied from its email_send_log copy); the backfill still queries.
  const sends = sendRows || (await readOnly(c => c.query(
    `SELECT node_id, subject, emails, first_sent_at, last_sent_at, node_emails, node_first_sent_at, node_last_sent_at
       FROM (SELECT node_id, subject, COUNT(*)::int AS emails, MIN(sent_at) AS first_sent_at, MAX(sent_at) AS last_sent_at,
                    SUM(COUNT(*)) OVER (PARTITION BY node_id)::int AS node_emails,
                    MIN(MIN(sent_at)) OVER (PARTITION BY node_id) AS node_first_sent_at,
                    MAX(MAX(sent_at)) OVER (PARTITION BY node_id) AS node_last_sent_at,
                    ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY COUNT(*) DESC) AS rn
               FROM email_send_log
              WHERE journey_id = $1 AND sent_at IS NOT NULL
              GROUP BY node_id, subject) s
      WHERE rn <= 5 ORDER BY node_id, emails DESC`, [jid]), COPY_TIMEOUT)).rows;

  const nodes = {};
  for (const n of emailNodes) {
    const s = sends.filter(r => r.node_id === n.id);
    const st = stored.find(r => r.node_id === n.id);
    nodes[n.id] = {
      label: n.data?.label || n.id,
      template_id: tidByNode[n.id],
      send_hour: n.data?.sendHour || null,
      emails: s[0]?.node_emails ?? 0,
      first_sent_at: s[0]?.node_first_sent_at ?? null,
      last_sent_at: s[0]?.node_last_sent_at ?? null,
      subjects: s.map(r => ({ subject: r.subject, emails: r.emails, first_sent_at: r.first_sent_at, last_sent_at: r.last_sent_at })),
      stored_email: st ? { subject: st.subject, html: st.html, source: st.source, created_at: st.created_at } : null,
    };
  }
  const doc = {
    journey_id: jid,
    exported_at: new Date().toISOString(),
    templates: Object.fromEntries(templates.map(t => [t.id, t])),
    nodes,
  };
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(doc)));
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: `${dir}${TEMPLATES_FILE}`, Body: body, ContentType: 'application/gzip' }));
  return { gz_bytes: body.length, templates: templates.length, nodes: emailNodes.length };
}

// Add the templates file to a journey archived before it existed, and note it in the manifest.
async function backfillEmailTemplates(jid, dir) {
  const { rows: [j] } = await readOnly(c => c.query(
    'SELECT journey_id, name, nodes, edges FROM journey_flows WHERE journey_id = $1', [jid]));
  if (!j) throw new Error('journey no longer in journey_flows');
  const res = await exportEmailTemplates(j, dir);
  const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: `${dir}manifest.json` }));
  const manifest = JSON.parse(await out.Body.transformToString());
  manifest.extras = { ...(manifest.extras || {}), email_templates: { ...res, backfilled_at: new Date().toISOString() } };
  await s3().send(new PutObjectCommand({
    Bucket: BUCKET(), Key: `${dir}manifest.json`, Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json',
  }));
  return res;
}

const ARCHIVE_TABLES = ['journey_flows', 'custom_segments', 'journey_node_stats', 'unsubscribe_log', 'journey_entries',
  'journey_events', 'email_send_log', 'whatsapp_send_log', 'sms_send_log'];
const PER_NODE = new Set(['journey_events', 'email_send_log']);
const BIG_TABLES = new Set(['journey_entries', 'journey_events', 'email_send_log']);

async function exportJourney(j, lastSent, emailCounts, log, cfg = archiveConfig()) {
  const started = Date.now();
  const jid = Number(j.journey_id);
  if (!Number.isInteger(jid)) throw new Error(`bad journey id ${j.journey_id}`);
  const month = dubaiMonth(lastSent);
  const dir = `journeys/completed_month=${month}/journey_id=${jid}/`;
  const tables = {};

  const tally = new SubjectTally();
  const exportOne = async (table) => {
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
    const res = await exportTable(`${dir}${table}.csv.gz`, table, chunks,
      { gzipLevel: cfg.gzipLevel, tap: table === 'email_send_log' ? tally : null });
    // Rows are never deleted from these tables, but late events (opens, unsubscribes) can still
    // be inserted between the count and the COPY — so the copy may hold more, never fewer.
    if (expected != null && res.rows < expected) throw new Error(`${table}: copied ${res.rows} < counted ${expected}`);
    tables[table] = res;
    log(`  ${table}: ${res.rows} rows, ${res.gz_bytes} bytes gz, ${res.seconds}s`);
  };
  // The big tables run side by side (cfg.parallel at a time); the small ones one by one.
  const big = ARCHIVE_TABLES.filter(t => BIG_TABLES.has(t));
  for (const t of ARCHIVE_TABLES.filter(t => !BIG_TABLES.has(t))) await exportOne(t);
  for (let i = 0; i < big.length; i += cfg.parallel) await Promise.all(big.slice(i, i + cfg.parallel).map(exportOne));

  const templatesRes = await exportEmailTemplates(j, dir, tally.rows());
  log(`  email templates: ${templatesRes.templates} template(s) for ${templatesRes.nodes} email node(s), ${templatesRes.gz_bytes} bytes gz`);

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
    extras: { email_templates: templatesRes },
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
  const summary = { dryRun: cfg.dryRun, minAgeDays: cfg.minAgeDays, archived: [], failed: [], tooRecent: [], tooBig: [], backedOff: [], wouldArchive: [], templatesBackfilled: [] };
  try {
    const done = await archivedJourneys();
    let list = (await candidateJourneys(cfg)).filter(j => !done.has(Number(j.journey_id)));
    if (cfg.journeyId) list = list.filter(j => Number(j.journey_id) === Number(cfg.journeyId));
    summary.alreadyArchived = done.size;
    summary.candidates = list.length;
    log(`${cfg.dryRun ? 'DRY RUN — ' : ''}${list.length} candidate journey(s) not yet in S3 (min age ${cfg.minAgeDays}d, max ${cfg.maxPerRun}/run)`);

    for (const j of list) {
      if (summary.archived.length + summary.wouldArchive.length >= cfg.maxPerRun) break;
      if (Date.now() - started > cfg.maxMinutes * 60000) { log(`time budget of ${cfg.maxMinutes} min reached — stopping`); break; }
      const failedAt = _failedAt.get(Number(j.journey_id));
      if (failedAt && !cfg.journeyId && Date.now() - failedAt < cfg.retryHours * 3600000) {
        summary.backedOff.push({ journey_id: j.journey_id, failed_at: new Date(failedAt).toISOString() });
        continue;
      }
      const t0 = Date.now();
      try {
        const emailCounts = await nodeCounts('email_send_log', j.journey_id);
        const total = emailCounts.reduce((s, r) => s + r.n, 0);
        if (total > cfg.maxEmails) {
          summary.tooBig.push({ journey_id: j.journey_id, emails: total });
          log(`skip #${j.journey_id} "${j.name}" — ${total} emails is over JOURNEY_ARCHIVE_MAX_EMAILS (${cfg.maxEmails})`);
          continue;
        }
        const last = await lastSentAt(j, emailCounts, log);
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
        const m = await exportJourney(j, last, emailCounts, log, cfg);
        summary.archived.push({ journey_id: j.journey_id, month: m.completed_month, seconds: Math.round((Date.now() - t0) / 1000) });
        _failedAt.delete(Number(j.journey_id));
        log(`✓ #${j.journey_id} archived to ${m.completed_month} in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (err) {
        summary.failed.push({ journey_id: j.journey_id, error: err.message });
        _failedAt.set(Number(j.journey_id), Date.now());
        console.error(`[JourneyArchive] ✗ #${j.journey_id} failed: ${err.message} (no manifest written — retried after ${cfg.retryHours}h)`);
      }
    }

    // Journeys archived before the templates file existed (e.g. #267) get it added — small reads
    // plus one per-node subject summary, within the same per-run limits.
    const missing = [...done].filter(([id, v]) => !v.hasTemplates && (!cfg.journeyId || id === Number(cfg.journeyId)));
    for (const [id, v] of missing) {
      if (summary.templatesBackfilled.length >= cfg.maxPerRun) break;
      if (Date.now() - started > cfg.maxMinutes * 60000) break;
      if (cfg.dryRun) { log(`would add email templates to archived #${id}`); summary.templatesBackfilled.push({ journey_id: id, dryRun: true }); continue; }
      try {
        const r = await backfillEmailTemplates(id, v.dir);
        summary.templatesBackfilled.push({ journey_id: id, templates: r.templates, nodes: r.nodes });
        log(`✓ #${id} email templates added: ${r.templates} template(s), ${r.nodes} email node(s)`);
      } catch (err) {
        summary.failed.push({ journey_id: id, error: `templates: ${err.message}` });
        console.error(`[JourneyArchive] ✗ #${id} templates backfill failed: ${err.message} (retried next run)`);
      }
    }
  } finally {
    _running = false;
    summary.seconds = Math.round((Date.now() - started) / 1000);
  }
  log(`done in ${summary.seconds}s — archived ${summary.archived.length}, would archive ${summary.wouldArchive.length}, templates added ${summary.templatesBackfilled.length}, failed ${summary.failed.length}, too recent ${summary.tooRecent.length}, too big ${summary.tooBig.length}, backed off ${summary.backedOff.length}`);
  return summary;
}

export default { runJourneyArchive, archiveConfig, isArchiveRunning };
