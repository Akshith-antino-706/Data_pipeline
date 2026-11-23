import { Router } from 'express';
import type { Request, Response } from 'express';
import zlib from 'zlib';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireRole } from '../middleware/auth.js';
import type { ArchiveRunOptions } from '../services/JourneyArchiveService.js';
const router = Router();

type CsvRow = Record<string, string | null>;
type Stat = Record<string, unknown> & { node_id?: string | null };

interface ManifestRef { key: string; month: string; journeyId: number }

/** manifest.json written by JourneyArchiveService (only the fields read here). */
interface ArchiveManifestDoc {
  tables?: Record<string, unknown>;
  extras?: { email_templates?: unknown };
  [k: string]: unknown;
}

interface ArchivedJourneyView {
  journey_id: number;
  completed_month: string;
  dir: string;
  manifest: ArchiveManifestDoc;
  flow: {
    name: string | null; description: string | null; status: string | null; journey_type: string;
    custom_segment_id: number | null; segment_id: number | null;
    created_at: string | null; updated_at: string | null; scheduled_start_at: string | null;
    nodes: unknown[]; edges: unknown[];
  };
  summary: Stat | null;
  nodes: Stat[];
}

/** email_templates.json.gz written by JourneyArchiveService.exportEmailTemplates. */
interface TemplatesDoc {
  exported_at?: string;
  templates?: Record<string, unknown>;
  nodes?: Record<string, { template_id?: number | null } & Record<string, unknown>>;
}

// ── Journey archive viewer (read-only) ──
// Completed journeys exported to S3 live under
//   journeys/completed_month=YYYY-MM/journey_id=N/{manifest.json, <table>.csv.gz}
// Only the small files (manifest, journey_flows, journey_node_stats) are read here; the
// big tables (events, send logs, entries) are offered as short-lived signed download links.
// Never touches the database. Off unless ARCHIVE_VIEW_ENABLED=true.
// Credentials come from the default AWS chain (EC2 instance role in prod).
const ENABLED = () => process.env.ARCHIVE_VIEW_ENABLED === 'true';
const BUCKET = process.env.ARCHIVE_S3_BUCKET || 'rayna-journey-archive-022278165625';
const PREFIX = 'journeys/';
const KEY_RE = /^journeys\/completed_month=(\d{4}-\d{2})\/journey_id=(\d+)\/manifest\.json$/;
const DOWNLOAD_TTL = 900;                 // signed links valid 15 min
const CACHE_TTL_MS = 10 * 60 * 1000;      // archives are immutable; list refreshes every 10 min

let _s3: S3Client | undefined;
const s3 = (): S3Client => (_s3 ||= new S3Client({ region: process.env.ARCHIVE_S3_REGION || 'eu-north-1' }));

const cache = new Map<string, { at: number; value: unknown }>();
async function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getObject(key: string): Promise<string> {
  const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!out.Body) throw new Error(`${key}: empty S3 object`);
  const buf = Buffer.from(await out.Body.transformToByteArray());
  return key.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}

// RFC 4180 CSV as written by Postgres COPY ... (FORMAT csv, HEADER true): quoted fields may
// contain commas, newlines and doubled quotes. Unquoted empty field = NULL → null.
function parseCsv(text: string): CsvRow[] {
  const rows: Array<Array<string | null>> = [];
  let row: Array<string | null> = [], field = '', quoted = false, wasQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') { quoted = true; wasQuoted = true; }
    else if (c === ',') { row.push(wasQuoted || field ? field : null); field = ''; wasQuoted = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(wasQuoted || field ? field : null); rows.push(row);
      row = []; field = ''; wasQuoted = false;
    } else field += c;
  }
  if (field || wasQuoted || row.length) { row.push(wasQuoted || field ? field : null); rows.push(row); }
  const [header = [], ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h ?? '', r[i] ?? null])));
}

const toNum = (v: unknown): number | null => (v === null || v === '' ? null : Number(v));
const toJson = (v: string | null | undefined): unknown => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

// journey_node_stats CSV → same shape the Analytics tab gets from /journeys/analytics/:id/nodes.
const STAT_NUMS = ['target_count', 'entries', 'booked', 'exited_booked', 'exited_unsub', 'sent', 'sends_today',
  'delivered', 'bounced', 'opened', 'human_opened', 'clicked', 'human_clicked', 'landed', 'gtm_events',
  'bot_window_sec', 'unsubscribed', 'failed'];
function normalizeStat(r: CsvRow): Stat {
  const out: Stat = { ...r, journey_id: toNum(r.journey_id) };
  for (const k of STAT_NUMS) out[k] = toNum(r[k]);
  out.entry_stats = toJson(r.entry_stats);
  return out;
}

async function listManifests(): Promise<ManifestRef[]> {
  const keys: ManifestRef[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of page.Contents || []) {
      if (!o.Key) continue;
      const m = KEY_RE.exec(o.Key);
      if (m) keys.push({ key: o.Key, month: m[1], journeyId: Number(m[2]) });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function loadJourney({ key, month, journeyId }: ManifestRef): Promise<ArchivedJourneyView> {
  const dir = key.slice(0, -'manifest.json'.length);
  const [manifestText, flowsText, statsText] = await Promise.all([
    getObject(key),
    getObject(`${dir}journey_flows.csv.gz`),
    getObject(`${dir}journey_node_stats.csv.gz`).catch(() => ''),
  ]);
  const manifest = JSON.parse(manifestText) as ArchiveManifestDoc;
  const flow: CsvRow = parseCsv(flowsText)[0] || {};
  const stats = parseCsv(statsText).map(normalizeStat);
  return {
    journey_id: journeyId,
    completed_month: month,
    dir,
    manifest,
    flow: {
      name: flow.name ?? null, description: flow.description ?? null, status: flow.status ?? null, journey_type: flow.journey_type || 'normal',
      custom_segment_id: toNum(flow.custom_segment_id), segment_id: toNum(flow.segment_id),
      created_at: flow.created_at ?? null, updated_at: flow.updated_at ?? null, scheduled_start_at: flow.scheduled_start_at ?? null,
      nodes: (toJson(flow.nodes) as unknown[] | null) || [], edges: (toJson(flow.edges) as unknown[] | null) || [],
    },
    summary: stats.find(s => s.node_id === '__ALL__') || null,
    nodes: stats.filter(s => s.node_id !== '__ALL__'),
  };
}

const getJourney = (ref: ManifestRef): Promise<ArchivedJourneyView> => memo(`journey:${ref.journeyId}:${ref.month}`, () => loadJourney(ref));

async function findRef(journeyId: number): Promise<ManifestRef | null> {
  const refs = await memo('manifests', listManifests);
  // Latest archive wins if a journey were ever archived twice.
  return refs.filter(r => r.journeyId === journeyId).sort((a, b) => b.month.localeCompare(a.month))[0] || null;
}

// ── Manual archive export (admin) — gated by the EXPORT flag, independent of the view flag ──
// POST /export/run?dryRun=1        → preview: which journeys the next run would copy (waits for the answer)
// POST /export/run                 → start a run now in the background (same rules/limits as the cron)
// POST /export/:id[?dryRun=1]      → archive one journey now (if it qualifies)
async function startExport(req: Request, res: Response, opts: ArchiveRunOptions): Promise<unknown> {
  const { archiveConfig, runJourneyArchive, isArchiveRunning } = await import('../services/JourneyArchiveService.js');
  if (!archiveConfig().enabled) return res.status(404).json({ success: false, error: 'Journey archive export is disabled (JOURNEY_ARCHIVE_EXPORT_ENABLED)' });
  if (isArchiveRunning()) return res.status(409).json({ success: false, error: 'An archive run is already in progress' });
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  console.log(`[journey-archive] manual ${dryRun ? 'dry run' : 'run'} by ${req.user?.email || req.user?.userId || '?'}`, opts);
  if (dryRun) return res.json({ success: true, data: await runJourneyArchive({ ...opts, dryRun: true }) });
  runJourneyArchive({ ...opts, dryRun: false }).then(() => cache.clear())
    .catch((err: Error) => console.error('[journey-archive] manual run failed:', err.message));
  return res.status(202).json({ success: true, data: { started: true } });
}
router.post('/export/run', requireRole('admin'), (req, res, next) => startExport(req, res, {}).catch(next));
router.post('/export/:id', requireRole('admin'), (req, res, next) =>
  startExport(req, res, { journeyId: parseInt(String(req.params.id)), maxPerRun: 1 }).catch(next));

router.use((_req, res, next) => {
  if (!ENABLED()) return res.status(404).json({ success: false, error: 'Journey archive view is disabled (ARCHIVE_VIEW_ENABLED)' });
  next();
});

// List of archived journeys with their journey-level stats row.
router.get('/', async (req, res, next) => {
  try {
    if (req.query.fresh) cache.clear();
    const refs = await memo('manifests', listManifests);
    const journeys: ArchivedJourneyView[] = [];
    for (let i = 0; i < refs.length; i += 8) {            // bounded parallel S3 reads
      journeys.push(...await Promise.all(refs.slice(i, i + 8).map(getJourney)));
    }
    res.json({
      success: true,
      data: journeys
        .map(({ flow, nodes: _n, dir: _d, ...j }) => ({ ...j, name: flow.name, status: flow.status, journey_type: flow.journey_type }))
        .sort((a, b) => b.completed_month.localeCompare(a.completed_month) || b.journey_id - a.journey_id),
    });
  } catch (err) { next(err); }
});

// One archived journey: flow (nodes/edges), manifest, journey + per-node stats.
router.get('/:id', async (req, res, next) => {
  try {
    const ref = await findRef(parseInt(req.params.id));
    if (!ref) return res.status(404).json({ success: false, error: 'Journey not found in archive' });
    const { dir: _d, ...j } = await getJourney(ref);
    res.json({ success: true, data: { ...j, has_templates: !!j.manifest?.extras?.email_templates } });
  } catch (err) { next(err); }
});

// The email one node sent: its template (subject + HTML, as archived), the frozen rendered email
// when the journey had one, and the subjects actually sent with counts and send dates.
router.get('/:id/nodes/:nodeId/email', async (req, res, next) => {
  try {
    const ref = await findRef(parseInt(req.params.id));
    if (!ref) return res.status(404).json({ success: false, error: 'Journey not found in archive' });
    const j = await getJourney(ref);
    const doc = await memo(`templates:${ref.journeyId}:${ref.month}`,
      () => getObject(`${j.dir}email_templates.json.gz`).then(t => JSON.parse(t) as TemplatesDoc).catch(() => null));
    if (!doc) return res.status(404).json({ success: false, error: 'Email templates are not archived for this journey yet' });
    const node = doc.nodes?.[req.params.nodeId];
    if (!node) return res.status(404).json({ success: false, error: 'Not an email node of this journey' });
    const template = node.template_id ? doc.templates?.[String(node.template_id)] || null : null;
    res.json({ success: true, data: { node_id: req.params.nodeId, ...node, template, archived_at: doc.exported_at } });
  } catch (err) { next(err); }
});

// Short-lived signed link to download one archived table (gzipped CSV) straight from S3.
router.get('/:id/download/:table', async (req, res, next) => {
  try {
    const ref = await findRef(parseInt(req.params.id));
    if (!ref) return res.status(404).json({ success: false, error: 'Journey not found in archive' });
    const j = await getJourney(ref);
    if (!Object.hasOwn(j.manifest.tables || {}, req.params.table)) {
      return res.status(400).json({ success: false, error: 'Unknown archived table' });
    }
    const url = await getSignedUrl(s3(), new GetObjectCommand({
      Bucket: BUCKET, Key: `${j.dir}${req.params.table}.csv.gz`,
      ResponseContentDisposition: `attachment; filename="journey-${j.journey_id}-${req.params.table}.csv.gz"`,
    }), { expiresIn: DOWNLOAD_TTL });
    console.log(`[journey-archive] download link journey=${j.journey_id} table=${req.params.table} user=${req.user?.email || req.user?.userId || '?'}`);
    res.json({ success: true, data: { url, expires_in: DOWNLOAD_TTL } });
  } catch (err) { next(err); }
});

export { parseCsv };
export default router;
