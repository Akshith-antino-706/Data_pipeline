import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import zlib from 'zlib';
import { Readable } from 'stream';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import {
  archiveTableRow, archiveTablePage, archiveNodeRows, archiveDayStats, archiveTableCsv, csvRecords, pgTimeMs, dubaiDay,
} from '../src/services/JourneyArchiveTableService.js';
import type { ArchiveView } from '../src/services/JourneyArchiveTableService.js';

async function* chunks(...parts: string[]) { for (const p of parts) yield Buffer.from(p); }
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const x of it) out.push(x); return out; }
async function* records(rows: Array<Record<string, string | null>>) { for (const r of rows) yield r; }

const view = (id: number, over: Partial<ArchiveView> & { stats?: Record<string, unknown> } = {}): ArchiveView => ({
  journey_id: id,
  completed_month: over.completed_month ?? '2026-09',
  manifest: over.manifest ?? { exported_at: '2026-11-20T18:00:00Z', last_sent_at: '2026-09-29T12:00:00Z', tables: { a: { gz_bytes: 100 }, b: { gz_bytes: '50' } }, extras: { email_templates: {} } },
  flow: over.flow ?? { name: `Journey ${id}`, journey_type: 'normal', nodes: [] },
  summary: { node_id: '__ALL__', entries: 10, sent: 10, delivered: 8, opened: 4, clicked: 1, unsubscribed: 1, booked: 0, ...over.stats },
  nodes: [],
});

describe('csvRecords (Postgres COPY csv)', () => {
  it('reads plain rows, NULLs and quoted fields with commas, quotes and line breaks split across chunks', async () => {
    const rows = await collect(csvRecords(chunks(
      'id,subject,note\r\n1,plain,\n2,"a, b ""q""",x\n3,"line one\nli',
      'ne two",y\n4,"",z',
    )));
    expect(rows).toEqual([
      { id: '1', subject: 'plain', note: null },
      { id: '2', subject: 'a, b "q"', note: 'x' },
      { id: '3', subject: 'line one\nline two', note: 'y' },
      { id: '4', subject: '', note: 'z' },
    ]);
  });
});

describe('pgTimeMs / dubaiDay', () => {
  it('reads Postgres timestamptz text and puts it on the Dubai calendar day', () => {
    expect(pgTimeMs('2026-09-29 12:51:21.979+00')).toBe(Date.parse('2026-09-29T12:51:21.979Z'));
    expect(pgTimeMs('2026-10-02 02:06:01.837598+00')).toBe(Date.parse('2026-10-02T02:06:01.837Z'));
    expect(pgTimeMs('2026-09-29 16:00:00+04')).toBe(Date.parse('2026-09-29T12:00:00Z'));
    expect(pgTimeMs(null)).toBeNull();
    expect(pgTimeMs('nonsense')).toBeNull();
    expect(dubaiDay(Date.parse('2026-09-29T20:30:00Z'))).toBe('2026-09-30');   // 00:30 Dubai next day
  });
});

describe('archiveTableRow / archiveTablePage', () => {
  const all = [
    view(1, { flow: { name: 'Cruise Day', journey_type: 'normal', nodes: [] }, stats: { sent: 100, opened: 50 }, manifest: { last_sent_at: '2026-09-01T10:00:00Z', tables: {} } }),
    view(2, { flow: { name: 'Visa Offers', journey_type: 'normal', nodes: [] }, completed_month: '2026-10', stats: { sent: 300, opened: 30 }, manifest: { last_sent_at: '2026-10-05T10:00:00Z', tables: {} } }),
    view(3, { flow: { name: 'GTM cart', journey_type: 'gtm', nodes: [] }, completed_month: '2026-08', stats: { sent: 5 }, manifest: { last_sent_at: '2026-08-01T10:00:00Z', tables: {} } }),
  ].map(archiveTableRow);

  it('builds a Performance-style row with archive facts', () => {
    const r = archiveTableRow(view(9));
    expect(r).toMatchObject({ journey_id: 9, journey_name: 'Journey 9', journey_status: 'completed', journey_type: 'normal',
      sent: 10, delivered: 8, archive_bytes: 150, has_templates: true, last_sent_at: '2026-09-29T12:00:00Z', archived_at: '2026-11-20T18:00:00Z' });
  });

  it('defaults to newest finished first and filters by search, type and month', () => {
    expect(archiveTablePage(all, {}).journeys.map(r => r.journey_id)).toEqual([2, 1, 3]);
    expect(archiveTablePage(all, { search: 'visa' }).journeys.map(r => r.journey_id)).toEqual([2]);
    expect(archiveTablePage(all, { search: '#3' }).journeys.map(r => r.journey_id)).toEqual([3]);
    expect(archiveTablePage(all, { type: 'continuous' }).journeys.map(r => r.journey_id)).toEqual([3]);
    expect(archiveTablePage(all, { type: 'fixed' }).total).toBe(2);
    expect(archiveTablePage(all, { month: '2026-09' }).journeys.map(r => r.journey_id)).toEqual([1]);
    expect(archiveTablePage(all, { month: "x' OR 1" }).total).toBe(3);   // bad month ignored
  });

  it('sorts by the same keys as Performance and pages', () => {
    expect(archiveTablePage(all, { sort: 'sent', dir: 'asc' }).journeys.map(r => r.journey_id)).toEqual([3, 1, 2]);
    expect(archiveTablePage(all, { sort: 'openRate' }).journeys.map(r => r.journey_id)).toEqual([1, 2, 3]);
    expect(archiveTablePage(all, { sort: 'name', dir: 'asc' }).journeys.map(r => r.journey_id)).toEqual([1, 3, 2]);
    expect(archiveTablePage(all, { sort: 'DROP TABLE' }).sort).toBe('completed');
    const p = archiveTablePage(all, { limit: 2, page: 2 });
    expect(p).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(p.journeys.map(r => r.journey_id)).toEqual([3]);
  });

  it('totals cover every match (not just the page) and months cover the whole archive', () => {
    const p = archiveTablePage(all, { type: 'fixed', limit: 1 });
    expect(p.totals).toMatchObject({ journeys: 2, sent: 400, opened: 80 });
    expect(p.months).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('CSV has one line per row and quotes names', () => {
    const csv = archiveTableCsv([archiveTableRow(view(5, { flow: { name: 'Say "hi", all', journey_type: 'normal', nodes: [] } }))]);
    const [head, line] = csv.trim().split('\n');
    expect(head.startsWith('Journey,Journey ID,Type,Completed,Archived on')).toBe(true);
    expect(line.startsWith('"Say ""hi"", all",5,One-time,"2026-09-29","2026-11-20",10,10,8')).toBe(true);
  });
});

describe('archiveNodeRows', () => {
  it('orders steps by the flow, labels them and attaches email / WhatsApp templates', () => {
    const nodes = [
      { id: 'node_2', type: 'action', data: { label: 'WhatsApp', channel: 'whatsapp', waTemplateId: '77', templateId: 5 } },
      { id: 'node_0', type: 'trigger', data: { label: 'Entry' } },
      { id: 'node_1', type: 'action', data: { label: 'Email', channel: 'email', emailTemplateId: '362' } },
    ];
    const edges = [{ source: 'node_0', target: 'node_1' }, { source: 'node_1', target: 'node_2' }];
    const rows = archiveNodeRows(nodes, edges, [
      { node_id: '__ALL__', sent: 9 }, { node_id: 'node_2', sent: 2 }, { node_id: 'node_1', sent: 7 },
    ]);
    expect(rows.map(r => [r.node_id, r.node_label, r.template_id, r.wa_template_id, r.step_channel])).toEqual([
      ['node_1', 'Email', 362, null, 'email'],
      ['node_2', 'WhatsApp', null, 77, 'whatsapp'],
    ]);
  });
});

describe('archiveDayStats', () => {
  it('counts people per Dubai day and step, like the live per-day numbers', async () => {
    const t = (iso: string) => iso.replace('T', ' ').replace('Z', '+00');
    const log = [
      // day 1 (Dubai): u1 opened after 60s (real), u2 opened after 2s (scanner) and clicked, u3 failed
      { unified_id: '1', node_id: 'n1', status: 'opened', sent_at: t('2026-09-29T10:00:00Z'), opened_at: t('2026-09-29T10:01:00Z'), clicked_at: null },
      { unified_id: '2', node_id: 'n1', status: 'clicked', sent_at: t('2026-09-29T10:00:00Z'), opened_at: t('2026-09-29T10:00:02Z'), clicked_at: t('2026-09-29T10:05:00Z') },
      { unified_id: '3', node_id: 'n1', status: 'failed', sent_at: t('2026-09-29T10:00:00Z'), opened_at: null, clicked_at: null },
      // 21:00 UTC = next Dubai day
      { unified_id: '4', node_id: 'n1', status: 'sent', sent_at: t('2026-09-29T21:00:00Z'), opened_at: null, clicked_at: null },
      { unified_id: '5', node_id: null, status: 'sent', sent_at: t('2026-09-29T10:00:00Z'), opened_at: null, clicked_at: null },
    ];
    const unsub = [
      { node_id: 'n1', unsubscribed_at: t('2026-09-29T12:00:00Z') },
      { node_id: 'n1', unsubscribed_at: t('2026-10-03T12:00:00Z') },   // a day with no sends → not shown
    ];
    const days = await archiveDayStats(records(log), records(unsub), 15);
    expect([...days.keys()].sort()).toEqual(['2026-09-29', '2026-09-30']);
    expect(days.get('2026-09-29')).toEqual([expect.objectContaining({
      node_id: 'n1', entries: 3, sent: 2, failed: 1, opened: 2, human_opened: 1, clicked: 1, human_clicked: 1, unsubscribed: 1, delivered: null, landed: null,
    })]);
    expect(days.get('2026-09-30')?.[0]).toMatchObject({ sent: 1, opened: 0 });
  });
});

// ── Routes (S3 mocked) ─────────────────────────────────────────────────

const s3Files = vi.hoisted(() => new Map<string, string | Buffer>());
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client { async send(cmd: { input: { Prefix?: string; Key?: string } }) {
    if (cmd.input.Prefix !== undefined) return { Contents: [...s3Files.keys()].map(Key => ({ Key })), IsTruncated: false };
    const body = s3Files.get(cmd.input.Key as string);
    if (body === undefined) throw new Error('NoSuchKey');
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    return { Body: Object.assign(Readable.from([buf]), { transformToByteArray: async () => new Uint8Array(buf) }) };
  } }
  class ListObjectsV2Command { constructor(public input: unknown) {} }
  class GetObjectCommand { constructor(public input: unknown) {} }
  return { S3Client, ListObjectsV2Command, GetObjectCommand };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed.example/x' }));

const dir = 'journeys/completed_month=2026-09/journey_id=467/';
const gz = (s: string) => zlib.gzipSync(Buffer.from(s));
s3Files.set(`${dir}manifest.json`, JSON.stringify({ journey_id: 467, exported_at: '2026-11-25T18:23:30Z', last_sent_at: '2026-09-29T12:51:21Z', tables: { email_send_log: { rows: 2, gz_bytes: 10 }, unsubscribe_log: { rows: 0, gz_bytes: 5 } } }));
s3Files.set(`${dir}journey_flows.csv.gz`, gz(`journey_id,name,status,journey_type,nodes,edges\n467,29th Sept - Emailer,completed,normal,"[{""id"":""node_0"",""type"":""trigger""},{""id"":""node_1"",""type"":""action"",""data"":{""label"":""KL"",""channel"":""email"",""emailTemplateId"":""9""}}]","[{""source"":""node_0"",""target"":""node_1""}]"\n`));
s3Files.set(`${dir}journey_node_stats.csv.gz`, gz('journey_id,node_id,sent,opened,clicked,delivered\n467,__ALL__,2,1,0,\n467,node_1,2,1,0,\n'));
s3Files.set(`${dir}email_send_log.csv.gz`, gz('id,unified_id,status,sent_at,opened_at,clicked_at,node_id\n1,10,sent,2026-09-29 12:51:21+00,,,node_1\n2,11,opened,2026-09-29 12:51:22+00,2026-09-29 13:00:00+00,,node_1\n'));
s3Files.set(`${dir}unsubscribe_log.csv.gz`, gz('id,node_id,unsubscribed_at\n'));

let server: Server;
let base = '';
beforeAll(async () => {
  process.env.ARCHIVE_VIEW_ENABLED = 'true';
  const { default: router } = await import('../src/routes/journeyArchive.js');
  const app = express();
  app.use('/', router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; data?: Record<string, unknown> & Array<Record<string, unknown>>; error?: string }
const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: (await r.json()) as Body }; };

describe('journey-archive routes', () => {
  it('GET /table pages the archive like the Performance table (and is not read as a journey id)', async () => {
    const { status, body } = await get('/table?sort=sent');
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ total: 1, page: 1, sort: 'sent', months: ['2026-09'], meta: { archived: 1, last_archived_at: '2026-11-25T18:23:30Z' } });
    expect((body.data!.journeys as unknown as Array<Record<string, unknown>>)[0]).toMatchObject({ journey_id: 467, journey_name: '29th Sept - Emailer', sent: 2 });
  });

  it('GET /:id/nodes gives flow-ordered steps with their template; ?date= reads the archived send log', async () => {
    const all = await get('/467/nodes');
    expect(all.body.data).toEqual([expect.objectContaining({ node_id: 'node_1', node_label: 'KL', template_id: 9, sent: 2 })]);
    const day = await get('/467/nodes?date=2026-09-29');
    expect(day.body.data).toEqual([expect.objectContaining({ node_id: 'node_1', sent: 2, opened: 1, human_opened: 1, template_id: 9 })]);
    expect((await get('/467/nodes?date=2026-09-30')).body.data).toEqual([]);
    expect((await get('/999/nodes')).status).toBe(404);
  });

  it('GET /table.csv downloads the filtered list', async () => {
    const r = await fetch(`${base}/table.csv?search=sept`);
    expect(r.headers.get('content-type')).toContain('text/csv');
    const lines = (await r.text()).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"29th Sept - Emailer",467');
  });
});
