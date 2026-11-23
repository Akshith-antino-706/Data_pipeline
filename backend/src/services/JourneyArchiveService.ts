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
import type { PoolClient } from 'pg';
import pool from '../config/database.js';

/** journey_flows node/edge — only the fields the archive reads. */
interface ArchiveNode { id: string; type?: string; data?: { channel?: string; label?: string; emailTemplateId?: string | number; templateId?: string | number; sendHour?: number | string | null } }
interface ArchiveEdge { source: string; target: string }

interface ArchiveJourney {
  journey_id: number | string;
  name: string;
  nodes: ArchiveNode[] | null;
  edges: ArchiveEdge[] | null;
  custom_segment_id?: number | string | null;
  updated_at?: Date | string;
}

interface NodeCount { node_id: string | null; n: number }
interface ArchivedEntry { dir: string; hasTemplates?: boolean }
interface TableExport { rows: number; gz_bytes: number }
interface TemplatesExport { gz_bytes: number; templates: number; nodes: number }

export interface ArchiveConfig {
  enabled: boolean;
  dryRun: boolean;
  minAgeDays: number;
  maxPerRun: number;
  maxMinutes: number;
  includeTest: boolean;
  maxEmails: number;
  retryHours: number;
}

/** Per-run overrides (admin route): undefined values fall back to the env config. */
export interface ArchiveRunOptions { dryRun?: boolean; maxPerRun?: number; maxMinutes?: number; journeyId?: number | string }

interface ArchiveManifest {
  journey_id: number;
  name: string;
  source: string;
  exported_at: string;
  last_sent_at: string;
  completed_month: string;
  duration_ms: number;
  tables: Record<string, TableExport>;
  extras: { email_templates: TemplatesExport & { backfilled_at?: string } };
}

export interface ArchiveRunSummary {
  skipped?: string;
  dryRun?: boolean;
  minAgeDays?: number;
  alreadyArchived?: number;
  candidates?: number;
  seconds?: number;
  archived: Array<{ journey_id: number | string; month: string; seconds: number }>;
  failed: Array<{ journey_id: number | string; error: string }>;
  tooRecent: Array<{ journey_id: number | string; last_sent_at: Date | string | undefined }>;
  tooBig: Array<{ journey_id: number | string; emails: number }>;
  backedOff: Array<{ journey_id: number | string; failed_at: string }>;
  wouldArchive: Array<{ journey_id: number | string; name: string; last_sent_at: Date | string | undefined; month: string; emails: number }>;
  templatesBackfilled: Array<{ journey_id: number; dryRun?: boolean; templates?: number; nodes?: number }>;
}

const BUCKET = () => process.env.ARCHIVE_S3_BUCKET || 'rayna-journey-archive-022278165625';
const MANIFEST_RE = /^journeys\/completed_month=\d{4}-\d{2}\/journey_id=(\d+)\/manifest\.json$/;
const TEMPLATES_FILE = 'email_templates.json.gz';
const COPY_TIMEOUT = '600s';          // per chunk; a cold 750k-row email node took ~160s
const DUBAI_MS = 4 * 3600 * 1000;
const LAST_SENT_TIMEOUT = '30s';

// journey_id → time of its last failure. In memory: a restart (deploy) clears it, which only
// means one more attempt. Keeps a journey that keeps failing from using up every night's run.
const _failedAt = new Map<number, number>();

let _s3: S3Client | undefined;
const s3 = (): S3Client => (_s3 ||= new S3Client({ region: process.env.ARCHIVE_S3_REGION || 'eu-north-1' }));

export function archiveConfig(env: NodeJS.ProcessEnv = process.env): ArchiveConfig {
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
  };
}

// Run fn(client) inside a READ ONLY transaction on its own pooled connection. On any error the
// connection is destroyed rather than returned (it may be mid-COPY); the server then rolls back.
async function readOnly<T>(fn: (client: PoolClient) => Promise<T>, timeout = '60s'): Promise<T> {
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
async function archivedJourneys(): Promise<Map<number, ArchivedEntry>> {
  const out = new Map<number, ArchivedEntry>();
  const templates = new Set<string>();
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: 'journeys/', ContinuationToken: token }));
    for (const o of page.Contents || []) {
      if (!o.Key) continue;
      const m = MANIFEST_RE.exec(o.Key);
      if (m) out.set(Number(m[1]), { dir: o.Key.slice(0, -'manifest.json'.length) });
      if (o.Key.endsWith(`/${TEMPLATES_FILE}`)) templates.add(o.Key.slice(0, -TEMPLATES_FILE.length));
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  for (const v of out.values()) v.hasTemplates = templates.has(v.dir);
  return out;
}

async function candidateJourneys(cfg: ArchiveConfig): Promise<ArchiveJourney[]> {
  const { rows } = await readOnly(c => c.query<ArchiveJourney>(
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
function flowOrder(nodes: ArchiveNode[] | null = [], edges: ArchiveEdge[] | null = []): string[] {
  const next: Record<string, string[]> = {};
  for (const e of edges || []) (next[e.source] ||= []).push(e.target);
  const ids = new Set((nodes || []).map(n => n.id));
  const start = (nodes || []).find(n => n.type === 'trigger')?.id || nodes?.[0]?.id;
  const out: string[] = []; const seen = new Set<string>(); const queue: string[] = start ? [start] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !ids.has(id)) continue;
    seen.add(id); out.push(id); queue.push(...(next[id] || []));
  }
  return [...out, ...[...ids].filter(id => !seen.has(id))];
}

const nodeCounts = (table: string, jid: number | string): Promise<NodeCount[]> => readOnly(async c =>
  (await c.query<{ node_id: string | null; n: string }>(`SELECT node_id, COUNT(*)::bigint AS n FROM ${table} WHERE journey_id = $1 GROUP BY node_id`, [jid]))
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
async function lastSentAt(j: ArchiveJourney, emailCounts: NodeCount[], log: (m: string) => void = () => {}): Promise<Date | string | undefined> {
  const withRows = new Set(emailCounts.filter(r => r.node_id && r.n > 0).map(r => r.node_id));
  const lastNode = flowOrder(j.nodes, j.edges).filter(id => withRows.has(id)).pop();
  if (!lastNode) return j.updated_at;                      // no emails (WA/SMS-only) → completion time
  try {
    const { rows: [r] } = await readOnly(async c => {
      await c.query('SET LOCAL enable_seqscan = off');
      return c.query<{ last: Date | null }>(
        `SELECT MAX(sent_at + interval '0') AS last FROM email_send_log WHERE journey_id = $1 AND node_id = $2`,
        [j.journey_id, lastNode]);
    }, LAST_SENT_TIMEOUT);
    return r?.last || j.updated_at;
  } catch (err) {
    if ((err as { code?: string }).code !== '57014') throw err;   // 57014 = statement timeout
    log(`  #${j.journey_id}: last-send lookup over ${LAST_SENT_TIMEOUT} on ${lastNode} — using completion time ${new Date(j.updated_at ?? Date.now()).toISOString()}`);
    return j.updated_at;
  }
}

const dubaiMonth = (ts: Date | string | undefined): string => new Date(new Date(ts ?? Date.now()).getTime() + DUBAI_MS).toISOString().slice(0, 7);

// Stream every chunk of one table into ONE gzipped CSV in S3. Each chunk is its own COPY in its
// own READ ONLY transaction (short snapshots); only the first chunk writes the header row.
async function exportTable(key: string, table: string, chunks: string[]): Promise<TableExport> {
  let bytes = 0;
  const counter = new Transform({ transform(buf: Buffer, _e, cb) { bytes += buf.length; cb(null, buf); } });
  const gzip = zlib.createGzip({ level: 6 });
  gzip.on('error', () => {}); counter.on('error', () => {});   // surfaced via upload / COPY instead
  gzip.pipe(counter);
  const upload = new Upload({
    client: s3(), params: { Bucket: BUCKET(), Key: key, Body: counter, ContentType: 'application/gzip' },
    partSize: 8 * 1024 * 1024, queueSize: 2,
  });
  const done = upload.done();
  // If the upload dies mid-table, abort the running COPY instead of letting it stall on backpressure.
  const uploadFailed = new Promise<never>((_, reject) => { done.catch(reject); });
  uploadFailed.catch(() => {});
  let rows = 0;
  try {
    for (let i = 0; i < chunks.length; i++) {
      rows += await readOnly(c => Promise.race([uploadFailed, new Promise<number>((resolve, reject) => {
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
    gzip.destroy(err as Error);
    await upload.abort().catch(() => {});
    throw err;
  }
  const head = await s3().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
  if (head.ContentLength !== bytes) throw new Error(`${table}: S3 size ${head.ContentLength} ≠ streamed ${bytes}`);
  return { rows, gz_bytes: bytes };
}

const lit = (v: unknown): string => `'${String(v).replace(/'/g, "''")}'`;
const csvCell = (v: unknown): string => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

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
async function exportEmailTemplates(j: ArchiveJourney, dir: string): Promise<TemplatesExport> {
  const jid = Number(j.journey_id);
  const emailNodes = (j.nodes || []).filter(n => n.type === 'action' && (n.data?.channel || 'email').toLowerCase() === 'email');
  const tidByNode = Object.fromEntries(emailNodes.map(n => [n.id, parseInt(String(n.data?.emailTemplateId ?? n.data?.templateId)) || null]));
  const tids = [...new Set(Object.values(tidByNode).filter(Boolean))];

  const templates = !tids.length ? [] : (await readOnly(c => c.query<{ id: number } & Record<string, unknown>>(
    `SELECT ct.id, ct.name, ct.channel, ct.status, ct.subject, ct.body, ct.body_plain, ct.version,
            ct.html_template_id, ct.created_at, ct.updated_at,
            eht.name AS html_name, eht.html_body, eht.subject_line AS html_subject_line,
            eht.engine AS html_engine, eht.updated_at AS html_updated_at
       FROM content_templates ct
       LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
      WHERE ct.id = ANY($1)`, [tids]))).rows;
  const stored = (await readOnly(c => c.query<{ node_id: string; template_id: number | null; subject: string | null; html: string | null; source: string | null; created_at: Date }>(
    'SELECT node_id, template_id, subject, html, source, created_at FROM journey_node_emails WHERE journey_id = $1', [jid]))).rows;
  // Subjects can be personalised, so keep the 5 most-sent per node plus node totals.
  const sends = (await readOnly(c => c.query<{ node_id: string; subject: string | null; emails: number; first_sent_at: Date; last_sent_at: Date; node_emails: number; node_first_sent_at: Date; node_last_sent_at: Date }>(
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

  const nodes: Record<string, unknown> = {};
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
async function backfillEmailTemplates(jid: number, dir: string): Promise<TemplatesExport> {
  const { rows: [j] } = await readOnly(c => c.query<ArchiveJourney>(
    'SELECT journey_id, name, nodes, edges FROM journey_flows WHERE journey_id = $1', [jid]));
  if (!j) throw new Error('journey no longer in journey_flows');
  const res = await exportEmailTemplates(j, dir);
  const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET(), Key: `${dir}manifest.json` }));
  if (!out.Body) throw new Error('manifest.json has no body');
  const manifest = JSON.parse(await out.Body.transformToString()) as ArchiveManifest;
  manifest.extras = { ...(manifest.extras || {}), email_templates: { ...res, backfilled_at: new Date().toISOString() } };
  await s3().send(new PutObjectCommand({
    Bucket: BUCKET(), Key: `${dir}manifest.json`, Body: JSON.stringify(manifest, null, 2), ContentType: 'application/json',
  }));
  return res;
}

const ARCHIVE_TABLES = ['journey_flows', 'custom_segments', 'journey_node_stats', 'unsubscribe_log', 'journey_entries',
  'journey_events', 'email_send_log', 'whatsapp_send_log', 'sms_send_log'];
const PER_NODE = new Set(['journey_events', 'email_send_log']);

async function exportJourney(j: ArchiveJourney, lastSent: Date | string | undefined, emailCounts: NodeCount[], log: (m: string) => void): Promise<ArchiveManifest> {
  const started = Date.now();
  const jid = Number(j.journey_id);
  if (!Number.isInteger(jid)) throw new Error(`bad journey id ${j.journey_id}`);
  const month = dubaiMonth(lastSent);
  const dir = `journeys/completed_month=${month}/journey_id=${jid}/`;
  const tables: Record<string, TableExport> = {};

  for (const table of ARCHIVE_TABLES) {
    let chunks: string[]; let expected: number | undefined;
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

  const templatesRes = await exportEmailTemplates(j, dir);
  log(`  email templates: ${templatesRes.templates} template(s) for ${templatesRes.nodes} email node(s), ${templatesRes.gz_bytes} bytes gz`);

  const { rows: cols } = await readOnly(c => c.query<{ table_name: string; ordinal_position: number; column_name: string; data_type: string }>(
    `SELECT table_name, ordinal_position, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1, 2`, [ARCHIVE_TABLES]));
  const colsCsv = ['table_name,ordinal_position,column_name,data_type',
    ...cols.map(r => [r.table_name, r.ordinal_position, r.column_name, r.data_type].map(csvCell).join(','))].join('\n') + '\n';
  await s3().send(new PutObjectCommand({ Bucket: BUCKET(), Key: `${dir}_columns.csv`, Body: colsCsv, ContentType: 'text/csv' }));

  const manifest: ArchiveManifest = {
    journey_id: jid,
    name: j.name,
    source: 'prod raynadb (journey archive cron, read-only)',
    exported_at: new Date().toISOString(),
    last_sent_at: new Date(lastSent ?? Date.now()).toISOString(),
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
export async function runJourneyArchive(opts: ArchiveRunOptions = {}, log: (m: string) => void = (m) => console.log(`[JourneyArchive] ${m}`)): Promise<ArchiveRunSummary> {
  if (_running) return { skipped: 'already running', archived: [], failed: [], tooRecent: [], tooBig: [], backedOff: [], wouldArchive: [], templatesBackfilled: [] };
  _running = true;
  const cfg: ArchiveConfig & ArchiveRunOptions = { ...archiveConfig(), ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  const started = Date.now();
  const summary: ArchiveRunSummary = { dryRun: cfg.dryRun, minAgeDays: cfg.minAgeDays, archived: [], failed: [], tooRecent: [], tooBig: [], backedOff: [], wouldArchive: [], templatesBackfilled: [] };
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
        const ageDays = (Date.now() - new Date(last ?? Date.now()).getTime()) / 86400000;
        if (ageDays < cfg.minAgeDays) {
          summary.tooRecent.push({ journey_id: j.journey_id, last_sent_at: last });
          continue;
        }
        const emails = emailCounts.reduce((s, r) => s + r.n, 0);
        if (cfg.dryRun) {
          summary.wouldArchive.push({ journey_id: j.journey_id, name: j.name, last_sent_at: last, month: dubaiMonth(last), emails });
          log(`would archive #${j.journey_id} "${j.name}" — last send ${new Date(last ?? Date.now()).toISOString()}, ${emails} emails`);
          continue;
        }
        log(`archiving #${j.journey_id} "${j.name}" (last send ${new Date(last ?? Date.now()).toISOString()}, ${emails} emails)`);
        const m = await exportJourney(j, last, emailCounts, log);
        summary.archived.push({ journey_id: j.journey_id, month: m.completed_month, seconds: Math.round((Date.now() - t0) / 1000) });
        _failedAt.delete(Number(j.journey_id));
        log(`✓ #${j.journey_id} archived to ${m.completed_month} in ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (err) {
        const message = (err as Error).message;
        summary.failed.push({ journey_id: j.journey_id, error: message });
        _failedAt.set(Number(j.journey_id), Date.now());
        console.error(`[JourneyArchive] ✗ #${j.journey_id} failed: ${message} (no manifest written — retried after ${cfg.retryHours}h)`);
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
        const message = (err as Error).message;
        summary.failed.push({ journey_id: id, error: `templates: ${message}` });
        console.error(`[JourneyArchive] ✗ #${id} templates backfill failed: ${message} (retried next run)`);
      }
    }
  } finally {
    _running = false;
    summary.seconds = Math.round((Date.now() - started) / 1000);
  }
  log(`done in ${summary.seconds}s — archived ${summary.archived.length}, would archive ${summary.wouldArchive.length}, templates added ${summary.templatesBackfilled.length}, failed ${summary.failed.length}, too recent ${summary.tooRecent.length}, too big ${summary.tooBig.length}, backed off ${summary.backedOff.length}`);
  return summary;
}

// ── Nightly report email ──
// One email per cron run to JOURNEY_ARCHIVE_REPORT_EMAILS (comma-separated; unset = no email),
// so a night that archived nothing, or failed, is seen the next morning instead of days later.

type ReportSendFn = (m: { to: string; subject: string; html: string }) => Promise<{ success: boolean; error?: string; reason?: string } | null | undefined>;

export function archiveReportRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...new Set((env.JOURNEY_ARCHIVE_REPORT_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

const escHtml = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const isoDay = (ts: Date | string | undefined): string => (ts ? new Date(ts).toISOString().slice(0, 10) : '—');

/** Subject + HTML for one run's summary. ok = something was archived and nothing failed. */
export function archiveReport(s: ArchiveRunSummary, now: Date = new Date()): { subject: string; html: string; ok: boolean } {
  const day = new Date(now.getTime() + DUBAI_MS).toISOString().slice(0, 10);
  const pending = Math.max(0, (s.candidates ?? 0) - s.archived.length);
  const ok = !s.skipped && s.failed.length === 0 && (s.archived.length > 0 || (s.candidates ?? 0) === 0 || !!s.dryRun);
  const status = s.skipped ? `not run (${s.skipped})`
    : s.dryRun ? `dry run: nothing copied, ${s.wouldArchive.length} would be archived`
      : `${s.archived.length} archived, ${s.failed.length} failed`;
  const subject = `${ok ? '✅' : '⚠️'} Journey archive ${day}: ${status}, ${pending} still waiting`;

  const section = (title: string, rows: string[]): string => rows.length
    ? `<h3 style="margin:18px 0 6px;font:600 14px Arial,sans-serif;">${escHtml(title)} (${rows.length})</h3><ul style="margin:0;padding-left:18px;font:13px/20px Arial,sans-serif;">${rows.map(r => `<li>${r}</li>`).join('')}</ul>`
    : '';
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#fff;color:#000;">
<h2 style="margin:0 0 8px;font:600 18px Arial,sans-serif;">Journey archive: ${escHtml(day)}</h2>
<p style="margin:0 0 4px;font:14px/22px Arial,sans-serif;"><b>${escHtml(status)}</b>. Run took ${s.seconds ?? 0}s.</p>
<p style="margin:0;font:13px/20px Arial,sans-serif;color:#555;">Already in S3: ${s.alreadyArchived ?? 0} · waiting: ${pending} · min age ${s.minAgeDays ?? '—'} days</p>
${section('Archived', s.archived.map(a => `#${escHtml(a.journey_id)} → ${escHtml(a.month)} in ${a.seconds}s`))}
${section('Failed (tried again after the back-off)', s.failed.map(f => `#${escHtml(f.journey_id)}: ${escHtml(f.error)}`))}
${section('Skipped: over JOURNEY_ARCHIVE_MAX_EMAILS', s.tooBig.map(t => `#${escHtml(t.journey_id)}: ${t.emails.toLocaleString('en-US')} emails`))}
${section('Waiting after an earlier failure', s.backedOff.map(b => `#${escHtml(b.journey_id)} (failed ${escHtml(b.failed_at)})`))}
${section('Would archive (dry run)', s.wouldArchive.map(w => `#${escHtml(w.journey_id)} ${escHtml(w.name)}: ${w.emails.toLocaleString('en-US')} emails, last send ${isoDay(w.last_sent_at)}`))}
${section('Email templates added', s.templatesBackfilled.map(t => `#${escHtml(t.journey_id)}`))}
<p style="margin:22px 0 0;font:11px Arial,sans-serif;color:#888;">Rayna data pipeline · internal report</p>
</body></html>`;
  return { subject, html, ok };
}

/** Email the run summary. Never throws; returns how many were sent. */
export async function sendArchiveReport(s: ArchiveRunSummary, { send, env = process.env, log = console }: { send?: ReportSendFn; env?: NodeJS.ProcessEnv; log?: Pick<Console, 'log' | 'warn'> } = {}): Promise<number> {
  const to = archiveReportRecipients(env);
  if (!to.length) return 0;
  const sender = send || (await import('./channels/JourneyEmailSender.js')).sendJourneyEmail;
  const { subject, html } = archiveReport(s);
  let sent = 0;
  for (const email of to) {
    try {
      const r = await sender({ to: email, subject, html });
      if (r?.success) sent += 1;
      else log.warn(`[JourneyArchive] report to ${email} failed: ${r?.error || r?.reason || 'unknown'}`);
    } catch (e) {
      log.warn(`[JourneyArchive] report to ${email} failed: ${(e as Error).message}`);
    }
  }
  log.log(`[JourneyArchive] report sent to ${sent}/${to.length}`);
  return sent;
}

/** The nightly cron: one run, then the report — also when the run itself crashed (S3, DB). */
export async function runJourneyArchiveWithReport(): Promise<void> {
  let summary: ArchiveRunSummary;
  try {
    summary = await runJourneyArchive();
  } catch (err) {
    console.error('[Cron:JourneyArchive] Error:', (err as Error).message);
    summary = { skipped: `crashed: ${(err as Error).message}`, archived: [], failed: [], tooRecent: [], tooBig: [], backedOff: [], wouldArchive: [], templatesBackfilled: [] };
  }
  await sendArchiveReport(summary);
}

export default { runJourneyArchive, runJourneyArchiveWithReport, archiveConfig, isArchiveRunning, sendArchiveReport };
