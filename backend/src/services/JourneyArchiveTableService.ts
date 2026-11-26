/**
 * JourneyArchiveTableService — the Journey Archive screen's table, built from the archive files
 * in S3 (never the database). Same shape, filters and sorts as the Performance table
 * (JourneyAnalyticsTableService), so the two screens read alike.
 *
 *   archiveTableRow()   one archived journey → one Performance-style row
 *   archiveTablePage()  search / type / month filter, sort, page + totals for the filtered set
 *   archiveNodeRows()   a journey's per-step rows (its archived journey_node_stats), in flow order
 *   archiveDayStats()   per-day, per-step numbers from the archived email_send_log + unsubscribe_log
 *                       CSVs, streamed — what the "Steps on [day]" picker shows
 *
 * Pure functions plus one streaming CSV reader; the route (routes/journeyArchive.ts) does the S3 I/O.
 */
import { clampInt, MAX_PAGE } from '../utils/validate.js';

type Stat = Record<string, unknown> & { node_id?: string | null };
interface FlowNode { id: string; type?: string; data?: Record<string, unknown> }

/** The parts of an archived journey this module reads (routes/journeyArchive.ts → ArchivedJourneyView). */
export interface ArchiveView {
  journey_id: number;
  completed_month: string;
  manifest: { exported_at?: unknown; last_sent_at?: unknown; tables?: Record<string, unknown>; extras?: { email_templates?: unknown } };
  flow: { name: string | null; journey_type: string; nodes: unknown[] };
  summary: Stat | null;
  nodes: Stat[];
}

export const ARCHIVE_TABLE_DEFAULT_LIMIT = 20;
export const ARCHIVE_TABLE_MAX_LIMIT = 200;
const MAX_SEARCH_LEN = 100;

// Numbers copied from the journey's '__ALL__' rollup row — same columns the Performance table shows.
const ROW_NUMS = ['entries', 'sent', 'delivered', 'failed', 'bounced', 'opened', 'human_opened', 'clicked', 'human_clicked',
  'landed', 'unsubscribed', 'gtm_events', 'booked', 'bot_window_sec'] as const;
const TOTAL_NUMS = ['entries', 'sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'booked'] as const;

export interface ArchiveTableRow {
  journey_id: number;
  journey_name: string;
  journey_status: string;
  journey_type: string;
  completed_month: string;
  last_sent_at: string | null;
  archived_at: string | null;
  archive_bytes: number;
  has_templates: boolean;
  [k: string]: unknown;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function archiveTableRow(v: ArchiveView): ArchiveTableRow {
  const s = v.summary || {};
  const row: ArchiveTableRow = {
    journey_id: v.journey_id,
    journey_name: v.flow.name || `Journey #${v.journey_id}`,
    journey_status: 'completed',
    journey_type: v.flow.journey_type || 'normal',
    completed_month: v.completed_month,
    last_sent_at: str(v.manifest.last_sent_at),
    archived_at: str(v.manifest.exported_at),
    archive_bytes: Object.values(v.manifest.tables || {})
      .reduce<number>((sum, t) => sum + (numOrNull((t as { gz_bytes?: unknown })?.gz_bytes) || 0), 0),
    has_templates: !!v.manifest.extras?.email_templates,
  };
  for (const k of ROW_NUMS) row[k] = numOrNull(s[k]);
  return row;
}

// ── Filter / sort / page ────────────────────────────────────────────────

export interface ArchiveTableQuery {
  search?: unknown; type?: unknown; month?: unknown; sort?: unknown; dir?: unknown; page?: unknown; limit?: unknown;
}

const n0 = (v: unknown) => numOrNull(v) || 0;
const openRate = (r: ArchiveTableRow) => { const d = n0(r.delivered) || n0(r.sent); return d ? n0(r.opened) / d : 0; };
const clickRate = (r: ArchiveTableRow) => (n0(r.opened) ? n0(r.clicked) / n0(r.opened) : 0);
/** When the journey finished: its last send, else the month it was filed under. */
const completedKey = (r: ArchiveTableRow) => r.last_sent_at || `${r.completed_month}-01`;

const SORTS: Record<string, (r: ArchiveTableRow) => number | string> = {
  completed: completedKey,
  entries: r => n0(r.entries),
  sent: r => n0(r.sent),
  delivered: r => n0(r.delivered),
  opened: r => n0(r.opened),
  clicked: r => n0(r.clicked),
  unsubscribed: r => n0(r.unsubscribed),
  booked: r => n0(r.booked),
  openRate,
  clickRate,
  name: r => r.journey_name.toLowerCase(),
};
export const ARCHIVE_TABLE_SORTS = Object.keys(SORTS);

/** Rows matching search / type / month — shared by the page and the CSV export. */
export function filterArchiveRows(rows: ArchiveTableRow[], q: ArchiveTableQuery): ArchiveTableRow[] {
  const search = typeof q.search === 'string' ? q.search.trim().slice(0, MAX_SEARCH_LEN).toLowerCase() : '';
  const month = typeof q.month === 'string' && /^\d{4}-\d{2}$/.test(q.month) ? q.month : '';
  return rows.filter(r =>
    (!search || `${r.journey_name} #${r.journey_id}`.toLowerCase().includes(search)) &&
    (q.type !== 'continuous' || r.journey_type === 'gtm') &&
    (q.type !== 'fixed' || r.journey_type !== 'gtm') &&
    (!month || r.completed_month === month));
}

export function sortArchiveRows(rows: ArchiveTableRow[], q: ArchiveTableQuery): { rows: ArchiveTableRow[]; sort: string; dir: 'asc' | 'desc' } {
  const sort = typeof q.sort === 'string' && Object.hasOwn(SORTS, q.sort) ? q.sort : 'completed';
  const dir: 'asc' | 'desc' = q.dir === 'asc' ? 'asc' : 'desc';
  const key = SORTS[sort];
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
    return c * sign || b.journey_id - a.journey_id;     // stable: newest journey first on ties
  });
  return { rows: sorted, sort, dir };
}

export interface ArchiveTablePage {
  journeys: ArchiveTableRow[];
  total: number;
  page: number;
  limit: number;
  sort: string;
  dir: 'asc' | 'desc';
  /** Sums over every journey matching the filters (not just this page) — the "At a glance" tiles. */
  totals: Record<string, number>;
  /** Every month in the archive, newest first — the month picker's options. */
  months: string[];
}

export function archiveTablePage(all: ArchiveTableRow[], q: ArchiveTableQuery): ArchiveTablePage {
  const matched = filterArchiveRows(all, q);
  const { rows, sort, dir } = sortArchiveRows(matched, q);
  const limit = clampInt(q.limit, ARCHIVE_TABLE_DEFAULT_LIMIT, ARCHIVE_TABLE_MAX_LIMIT);
  const page = clampInt(q.page, 1, MAX_PAGE);
  const totals: Record<string, number> = { journeys: matched.length, archive_bytes: 0 };
  for (const k of TOTAL_NUMS) totals[k] = 0;
  for (const r of matched) {
    for (const k of TOTAL_NUMS) totals[k] += n0(r[k]);
    totals.archive_bytes += r.archive_bytes;
  }
  return {
    journeys: rows.slice((page - 1) * limit, page * limit),
    total: matched.length, page, limit, sort, dir, totals,
    months: [...new Set(all.map(r => r.completed_month))].sort().reverse(),
  };
}

// ── Per-step rows ───────────────────────────────────────────────────────

// Nodes in flow order: walk edges from the trigger; anything unreachable goes last.
function flowOrder(nodes: FlowNode[], edges: Array<{ source: string; target: string }>): string[] {
  const ids = new Set(nodes.map(n => n.id));
  const next: Record<string, string[]> = {};
  for (const e of edges) (next[e.source] ||= []).push(e.target);
  const start = nodes.find(n => n.type === 'trigger') || nodes[0];
  const seen = new Set<string>(); const out: string[] = [];
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id) || !ids.has(id)) continue;
    seen.add(id); out.push(id);
    queue.push(...(next[id] || []));
  }
  return [...out, ...nodes.map(n => n.id).filter(id => !seen.has(id))];
}

/** What each action node sends — same fields the Performance step rows carry for the eye button. */
function templateRefs(nodes: FlowNode[]) {
  const map: Record<string, { template_id: number | null; wa_template_id: number | null; step_channel: string | null }> = {};
  for (const n of nodes) {
    if (n.type !== 'action') continue;
    const channel = String(n.data?.channel || '').toLowerCase() || null;
    const isWa = channel === 'whatsapp';
    const tid = isWa ? 0 : parseInt(String(n.data?.emailTemplateId ?? n.data?.templateId ?? ''), 10);
    const waTid = isWa ? parseInt(String(n.data?.waTemplateId ?? ''), 10) : 0;
    map[n.id] = { template_id: tid || null, wa_template_id: waTid || null, step_channel: channel };
  }
  return map;
}

/**
 * A journey's step rows in flow order, each with its label and template refs. `stats` is either the
 * archived all-time journey_node_stats rows or one day's rows from archiveDayStats().
 */
export function archiveNodeRows(flowNodes: unknown[], flowEdges: unknown[], stats: Stat[]): Stat[] {
  const nodes = (Array.isArray(flowNodes) ? flowNodes : []) as FlowNode[];
  const edges = (Array.isArray(flowEdges) ? flowEdges : []) as Array<{ source: string; target: string }>;
  const order = new Map(flowOrder(nodes, edges).map((id, i) => [id, i]));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const refs = templateRefs(nodes);
  return stats
    .filter(s => s.node_id && s.node_id !== '__ALL__')
    .map(s => {
      const id = String(s.node_id);
      const def = byId.get(id);
      return {
        ...s,
        node_label: (def?.data?.label as string | undefined) || (s.node_label as string | undefined) || id,
        node_type: def?.type || (s.node_type as string | undefined) || 'unknown',
        template_id: refs[id]?.template_id ?? null,
        wa_template_id: refs[id]?.wa_template_id ?? null,
        step_channel: refs[id]?.step_channel ?? null,
      };
    })
    .sort((a, b) => (order.get(String(a.node_id)) ?? 1e9) - (order.get(String(b.node_id)) ?? 1e9));
}

// ── Streaming CSV (Postgres COPY … FORMAT csv, HEADER) ──────────────────

/**
 * Yields one record per CSV row, as an object keyed by the header. Quoted fields may span chunks,
 * contain commas, newlines and doubled quotes; an unquoted empty field is NULL → null.
 */
export async function* csvRecords(chunks: AsyncIterable<Buffer | string>): AsyncGenerator<Record<string, string | null>> {
  let header: string[] | null = null;
  let carry = '';         // text after the last complete record
  let pending = '';       // a record whose quoted field runs over a line break, so far
  const toRecord = (fields: Array<string | null>): Record<string, string | null> | null => {
    if (!header) { header = fields.map(h => h ?? ''); return null; }
    if (fields.length === 1 && fields[0] === null) return null;   // blank line
    const rec: Record<string, string | null> = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = fields[i] ?? null;
    return rec;
  };
  // One whole record → fields. Most send-log rows have no quotes, so a plain split does.
  const fieldsOf = (rec: string): Array<string | null> => {
    if (!rec.includes('"')) return rec.split(',').map(f => (f === '' ? null : f));
    const out: Array<string | null> = [];
    let field = '', quoted = false, wasQuoted = false;
    for (let i = 0; i < rec.length; i++) {
      const c = rec[i];
      if (quoted) {
        if (c !== '"') field += c;
        else if (rec[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (c === '"') { quoted = true; wasQuoted = true; }
      else if (c === ',') { out.push(wasQuoted || field ? field : null); field = ''; wasQuoted = false; }
      else field += c;
    }
    out.push(wasQuoted || field ? field : null);
    return out;
  };
  const quotes = (s: string) => { let n = 0; for (let i = s.indexOf('"'); i !== -1; i = s.indexOf('"', i + 1)) n++; return n; };
  // A line ends a record unless the record so far has an odd number of quotes (inside a quoted field).
  function* lines(text: string): Generator<Record<string, string | null>> {
    const parts = text.split('\n');
    carry = parts.pop() as string;
    for (let line of parts) {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (pending) { pending += `\n${line}`; line = pending; }
      if (line.includes('"') && quotes(line) % 2) { pending = line; continue; }
      pending = '';
      const rec = toRecord(fieldsOf(line));
      if (rec) yield rec;
    }
  }
  for await (const chunk of chunks) yield* lines(carry + (typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
  if (carry || pending) yield* lines(`${carry}\n`);
}

// ── Per-day step numbers ────────────────────────────────────────────────

/** Postgres timestamptz text ("2026-09-29 12:00:01.5+00") → epoch ms, or null. */
export function pgTimeMs(v: string | null | undefined): number | null {
  if (!v) return null;
  let s = v.trim().replace(' ', 'T');
  const tz = /([+-]\d{2})(:?(\d{2}))?$/.exec(s);
  if (tz) s = s.slice(0, tz.index) + `${tz[1]}:${tz[3] || '00'}`;
  else if (!/Z$/.test(s)) s += 'Z';
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

const DUBAI_OFFSET_MS = 4 * 3600 * 1000;                          // Asia/Dubai is UTC+4, no DST
export const dubaiDay = (ms: number) => new Date(ms + DUBAI_OFFSET_MS).toISOString().slice(0, 10);

// A type (not an interface) so it fits the Record-shaped Stat rows archiveNodeRows() takes.
export type DayNodeStats = {
  node_id: string;
  entries: number; sent: number; failed: number;
  opened: number; human_opened: number; clicked: number; human_clicked: number;
  unsubscribed: number;
  // Not in the archive (they come from ses_events / gtm_events, which are not exported): null.
  delivered: null; bounced: null; landed: null; gtm_events: null; booked: null;
};

/** date (Dubai, YYYY-MM-DD) → per-step numbers for steps that sent that day. */
export type DayStats = Map<string, DayNodeStats[]>;

/**
 * Per-day, per-step numbers from the archived send log — the same counts the Performance page
 * computes live for a picked day (JourneyStatsService.computeNodesForDate): people by the Dubai
 * day of sent_at; "real people" = opened/clicked at least `botWindowSec` after sending.
 */
export async function archiveDayStats(
  emailLog: AsyncIterable<Record<string, string | null>>,
  unsubLog: AsyncIterable<Record<string, string | null>> | null,
  botWindowSec: number,
): Promise<DayStats> {
  const W = botWindowSec * 1000;
  type Sets = { entries: Set<string>; sent: Set<string>; failed: Set<string>; opened: Set<string>; human_opened: Set<string>; clicked: Set<string>; human_clicked: Set<string>; unsubscribed: number };
  const cells = new Map<string, Sets>();                           // `${day}\t${node}` → sets of unified_id
  const cell = (day: string, node: string): Sets => {
    const k = `${day}\t${node}`;
    let c = cells.get(k);
    if (!c) {
      c = { entries: new Set(), sent: new Set(), failed: new Set(), opened: new Set(), human_opened: new Set(), clicked: new Set(), human_clicked: new Set(), unsubscribed: 0 };
      cells.set(k, c);
    }
    return c;
  };
  for await (const r of emailLog) {
    const node = r.node_id;
    const sentMs = pgTimeMs(r.sent_at);
    if (!node || sentMs === null) continue;
    const who = r.unified_id ?? r.email ?? r.id ?? '';
    const c = cell(dubaiDay(sentMs), node);
    c.entries.add(who);
    if (r.status === 'failed') c.failed.add(who);
    else if (r.status !== 'queued') c.sent.add(who);
    const openMs = pgTimeMs(r.opened_at);
    if (openMs !== null) { c.opened.add(who); if (openMs - sentMs >= W) c.human_opened.add(who); }
    const clickMs = pgTimeMs(r.clicked_at);
    if (clickMs !== null) { c.clicked.add(who); if (clickMs - sentMs >= W) c.human_clicked.add(who); }
  }
  if (unsubLog) {
    for await (const r of unsubLog) {
      const at = pgTimeMs(r.unsubscribed_at);
      if (r.node_id && at !== null) cell(dubaiDay(at), r.node_id).unsubscribed++;
    }
  }
  const out: DayStats = new Map();
  for (const [k, c] of cells) {
    if (!c.sent.size) continue;                                     // only steps that sent that day
    const [day, node_id] = k.split('\t');
    const list = out.get(day) || [];
    list.push({
      node_id, entries: c.entries.size, sent: c.sent.size, failed: c.failed.size,
      opened: c.opened.size, human_opened: c.human_opened.size, clicked: c.clicked.size, human_clicked: c.human_clicked.size,
      unsubscribed: c.unsubscribed,
      delivered: null, bounced: null, landed: null, gtm_events: null, booked: null,
    });
    out.set(day, list);
  }
  return out;
}

// ── CSV export ──────────────────────────────────────────────────────────

export function archiveTableCsv(rows: ArchiveTableRow[]): string {
  const cell = (v: unknown) => (numOrNull(v) == null ? '' : String(numOrNull(v)));
  const pctOf = (part: unknown, whole: unknown) => { const a = numOrNull(part), b = numOrNull(whole); return a == null || !b ? '' : String(Math.round((a / b) * 1000) / 10); };
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = ['Journey', 'Journey ID', 'Type', 'Completed', 'Archived on', 'People entered', 'Sent', 'Delivered', "Didn't send", 'Opened',
    'Opened (real people)', 'Opened %', 'Clicked', 'Clicked (real people)', 'Clicked % of opened', 'Reached website', 'Bounced',
    'Unsubscribed', 'Website actions', 'Booked', 'Archive size (bytes)'];
  const lines = rows.map(r => [
    q(r.journey_name), r.journey_id, r.journey_type === 'gtm' ? 'Always on' : 'One-time',
    q((r.last_sent_at || '').slice(0, 10) || r.completed_month), q((r.archived_at || '').slice(0, 10)),
    cell(r.entries), cell(r.sent), cell(r.delivered), cell(r.failed), cell(r.opened), cell(r.human_opened),
    pctOf(r.opened, numOrNull(r.delivered) || r.sent), cell(r.clicked), cell(r.human_clicked), pctOf(r.clicked, r.opened),
    cell(r.landed), cell(r.bounced), cell(r.unsubscribed), cell(r.gtm_events), cell(r.booked), r.archive_bytes,
  ].join(','));
  return [headers.join(','), ...lines].join('\n') + '\n';
}
