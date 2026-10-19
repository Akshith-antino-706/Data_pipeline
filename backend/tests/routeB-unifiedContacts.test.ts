import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  svc: {
    createContact: vi.fn(), getStats: vi.fn(), getFilterOptions: vi.fn(), getAll: vi.fn(), snapshotDailySegments: vi.fn(),
    getSegmentChanges: vi.fn(), getSegmentDailyLog: vi.fn(), getSegmentCustomers: vi.fn(), getSegmentationTree: vi.fn(),
    recomputeSegmentation: vi.fn(), getById: vi.fn(), updateContact: vi.fn(), deleteContact: vi.fn(),
  },
  rebuild: vi.fn(),
  reg: { isRunning: vi.fn(), run: vi.fn() },
  query: vi.fn(),
  cached: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query, connect: vi.fn() }, query: m.query }));
vi.mock('../src/config/cache.js', () => ({ cached: m.cached, invalidate: m.invalidate, del: vi.fn(), default: {} }));
vi.mock('../src/services/UnifiedContactService.js', () => ({ default: m.svc }));
vi.mock('../src/services/UnifiedContactBuilder.js', () => ({ default: { rebuild: m.rebuild } }));
vi.mock('../src/services/RegistrationContactSync.js', () => ({ default: m.reg }));

import router from '../src/routes/unifiedContacts.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/uc', router);
  app.use((err: Error, _req: Request, res: ExResponse, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/uc`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  for (const f of [...Object.values(m.svc), ...Object.values(m.reg), m.rebuild, m.query, m.cached, m.invalidate]) f.mockReset();
  m.cached.mockImplementation((_k: string, fn: () => unknown) => Promise.resolve(fn()));
  m.invalidate.mockResolvedValue(undefined);
});
const get = (p: string): Promise<Response> => fetch(`${base}${p}`);
const send = (method: string, p: string, body?: unknown): Promise<Response> => fetch(`${base}${p}`, {
  method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
type Opts = Record<string, unknown>;
const lastArg = (f: ReturnType<typeof vi.fn>): Opts => f.mock.calls[f.mock.calls.length - 1][0] as Opts;

describe('GET / (list) pagination + clamping', () => {
  beforeEach(() => { m.svc.getAll.mockResolvedValue({ data: [], total: 0 }); });
  it('defaults page 1 / limit 50 and spreads result', async () => {
    expect(await (await get('/')).json()).toEqual({ success: true, data: [], total: 0 });
    expect(lastArg(m.svc.getAll)).toMatchObject({ page: 1, limit: 50 });
  });
  it('clamps limit to 200 and page/limit to >= 1', async () => {
    await get('/?limit=1000000&page=99999999999');
    expect(lastArg(m.svc.getAll)).toMatchObject({ limit: 200, page: 100000 });
    await get('/?limit=-5&page=-9');
    expect(lastArg(m.svc.getAll)).toMatchObject({ limit: 1, page: 1 });
    await get('/?limit=abc&page=%27');
    expect(lastArg(m.svc.getAll)).toMatchObject({ limit: 50, page: 1 });
  });
  it('trims and caps search at 200 chars', async () => {
    await get(`/?search=${encodeURIComponent(`  x${'y'.repeat(400)}`)}`);
    expect((lastArg(m.svc.getAll).search as string).length).toBeLessThanOrEqual(200);
  });
  it('invalid business/contact types are dropped', async () => {
    await get(`/?businessType=${encodeURIComponent("' OR 1=1")}&contactType=b2b`);
    expect(lastArg(m.svc.getAll).businessType).toBeUndefined();
  });
  it('500 on service error', async () => {
    m.svc.getAll.mockRejectedValue(new Error('x'));
    expect((await get('/')).status).toBe(500);
  });
});

describe('create / update / delete', () => {
  it('POST / → 201', async () => {
    m.svc.createContact.mockResolvedValue({ id: 1 });
    const r = await send('POST', '/', { email: 'a@x.com' });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ success: true, data: { id: 1 } });
  });
  it('POST / → 500 when service rejects (e.g. validation inside service)', async () => {
    m.svc.createContact.mockRejectedValue(new Error('dup'));
    expect((await send('POST', '/', {})).status).toBe(500);
  });
  it('PATCH 404 / 200', async () => {
    m.svc.updateContact.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });
    expect((await send('PATCH', '/3', { name: 'x' })).status).toBe(404);
    expect((await send('PATCH', '/3', { name: 'x' })).status).toBe(200);
    expect(m.svc.updateContact).toHaveBeenCalledWith('3', { name: 'x' });
  });
  it('DELETE 404 / 200 returns id', async () => {
    m.svc.deleteContact.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });
    expect((await send('DELETE', '/3')).status).toBe(404);
    expect(await (await send('DELETE', '/3')).json()).toEqual({ success: true, id: 3 });
  });
});

describe('GET /:id', () => {
  it('404 when missing; injection id is passed through as a string', async () => {
    m.svc.getById.mockResolvedValue(null);
    const inj = "1 OR 1=1";
    expect((await get(`/${encodeURIComponent(inj)}`)).status).toBe(404);
    expect(m.svc.getById).toHaveBeenCalledWith(inj);
  });
  it('static paths are not captured by /:id', async () => {
    m.svc.getFilterOptions.mockResolvedValue({});
    m.svc.getSegmentChanges.mockResolvedValue({});
    expect((await get('/filters')).status).toBe(200);
    expect((await get('/segment-changes')).status).toBe(200);
    expect(m.svc.getById).not.toHaveBeenCalled();
  });
});

describe('sync endpoints', () => {
  it('POST /sync rebuilds and invalidates the dashboard cache', async () => {
    m.rebuild.mockResolvedValue({ contacts: 5 });
    expect(await (await send('POST', '/sync')).json()).toEqual({ success: true, contacts: 5 });
    expect(m.invalidate).toHaveBeenCalledWith('dashboard:*');
  });
  it('POST /sync 500 on failure, no invalidate', async () => {
    m.rebuild.mockRejectedValue(new Error('x'));
    expect((await send('POST', '/sync')).status).toBe(500);
    expect(m.invalidate).not.toHaveBeenCalled();
  });
  it('registration-sync: running → started:false', async () => {
    m.reg.isRunning.mockReturnValue(true);
    expect(await (await send('POST', '/registration-sync')).json()).toMatchObject({ started: false });
    expect(m.reg.run).not.toHaveBeenCalled();
  });
  it('registration-sync: dryRun waits for result', async () => {
    m.reg.isRunning.mockReturnValue(false);
    m.reg.run.mockResolvedValue({ wouldLink: 2 });
    const r = await send('POST', '/registration-sync?dryRun=1&full=true');
    expect(await r.json()).toEqual({ success: true, wouldLink: 2 });
    expect(m.reg.run).toHaveBeenCalledWith({ full: true, dryRun: true });
  });
  it('registration-sync: background run → 202', async () => {
    m.reg.isRunning.mockReturnValue(false);
    m.reg.run.mockResolvedValue({});
    const r = await send('POST', '/registration-sync?full=yes');
    expect(r.status).toBe(202);
    expect(m.reg.run).toHaveBeenCalledWith({ full: false });
  });
});

describe('stats / filters / tree', () => {
  it('stats uses cache only with ?cached=1', async () => {
    m.svc.getStats.mockResolvedValue({ n: 1 });
    await get('/stats');
    expect(m.cached).not.toHaveBeenCalled();
    await get('/stats?cached=1&businessType=B2B');
    expect(m.cached).toHaveBeenCalledWith('contacts:stats:B2B', expect.any(Function), 600);
  });
  it('stats 500 on error', async () => {
    m.svc.getStats.mockRejectedValue(new Error('x'));
    expect((await get('/stats')).status).toBe(500);
  });
  it('segmentation-tree spreads result', async () => {
    m.svc.getSegmentationTree.mockResolvedValue({ tree: [] });
    expect(await (await get('/segmentation-tree?product=x')).json()).toEqual({ success: true, tree: [] });
  });
  it('recompute + snapshot POSTs', async () => {
    m.svc.recomputeSegmentation.mockResolvedValue({ a: 1 });
    m.svc.snapshotDailySegments.mockRejectedValue(new Error('x'));
    expect((await send('POST', '/recompute-segmentation')).status).toBe(200);
    expect((await send('POST', '/snapshot-daily')).status).toBe(500);
  });
});

describe('GET /sources-breakdown', () => {
  it('ignores malformed / injection dates', async () => {
    m.query.mockResolvedValue({ rows: [{ source: 'a', count: 2 }, { source: 'b', count: 3 }] });
    const r = await get(`/sources-breakdown?from=${encodeURIComponent("2024-01-01' OR 1=1")}&to=bad`);
    expect(await r.json()).toEqual({ success: true, data: { from: null, to: null, total: 5, sources: [{ source: 'a', count: 2 }, { source: 'b', count: 3 }] } });
    expect(m.query.mock.calls[0][1]).toEqual([]);
  });
  it('parameterises valid dates and honours ?fresh', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await get('/sources-breakdown?from=2024-01-01&to=2024-01-31&fresh=1');
    expect(m.query.mock.calls[0][1]).toEqual(['2024-01-01', '2024-01-31']);
    expect(m.cached).not.toHaveBeenCalled();
  });
  it('500 on query error', async () => {
    m.query.mockRejectedValue(new Error('x'));
    expect((await get('/sources-breakdown?fresh=1')).status).toBe(500);
  });
});

describe('segment activity / customers', () => {
  it('segment-activity defaults days 30', async () => {
    m.svc.getSegmentDailyLog.mockResolvedValue({ logs: [] });
    await get('/segment-activity?days=abc');
    expect(lastArg(m.svc.getSegmentDailyLog)).toMatchObject({ days: 30 });
  });
  it('segment-customers defaults page 1 / limit 25, huge limit clamped to 500', async () => {
    m.svc.getSegmentCustomers.mockResolvedValue({ data: [] });
    await get('/segment-customers');
    expect(lastArg(m.svc.getSegmentCustomers)).toMatchObject({ page: 1, limit: 25 });
    await get('/segment-customers?limit=5000000');
    expect(lastArg(m.svc.getSegmentCustomers)).toMatchObject({ limit: 500 });
  });
  it('segment-activity/download builds CSV', async () => {
    m.svc.getSegmentDailyLog.mockResolvedValue({ logs: [{ log_date: '2024-01-05T00:00', segment_label: 'S', total_count: 1 }] });
    const r = await get('/segment-activity/download?days=7');
    expect(r.headers.get('content-disposition')).toContain('segment_activity_7d.csv');
    expect((await r.text()).split('\n')[1].startsWith('2024-01-05,S,1')).toBe(true);
  });
  it('segment-customers/download escapes quotes in names', async () => {
    m.svc.getSegmentCustomers.mockResolvedValue({ data: [{ name: 'A "B"', email: 'a@x.com', booking_status: 'P' }] });
    const text = await (await get('/segment-customers/download')).text();
    expect(text).toContain('"A ""B"""');
  });
  // FIXED (was BUG) unifiedContacts.ts:192 — only `name` has its quotes doubled; email/mobile/country/sources are
  // wrapped in quotes without escaping, so a value containing `"` breaks the CSV row.
  it('segment-customers/download escapes quotes in every quoted field', async () => {
    m.svc.getSegmentCustomers.mockResolvedValue({ data: [{ name: 'n', email: 'x"y@x.com', booking_status: 'P' }] });
    const text = await (await get('/segment-customers/download')).text();
    expect(text).toContain('"x""y@x.com"');
  });
});

describe('GET /:id/recommendations', () => {
  it('400 for non-numeric or zero id, no query', async () => {
    for (const id of ['abc', '0', encodeURIComponent("' OR 1=1")]) {
      expect((await get(`/${id}/recommendations`)).status, id).toBe(400);
    }
    expect(m.query).not.toHaveBeenCalled();
  });
  it('returns null when no recommendation', async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect(await (await get('/5/recommendations')).json()).toEqual({ recommendation: null });
    expect(m.query.mock.calls[0][1]).toEqual([5]);
  });
  it('hydrates products in order and drops missing ids', async () => {
    m.query.mockImplementation((sql: string) => {
      if (sql.includes('user_product_recommendations')) return Promise.resolve({ rows: [{ product_ids: ['2', '1', '9'], based_on_product_id: 7, recommendation_type: 't' }] });
      if (sql.includes('ANY')) return Promise.resolve({ rows: [{ product_id: 1, name: 'one' }, { product_id: 2, name: 'two' }] });
      return Promise.resolve({ rows: [{ name: 'base' }] });
    });
    const body = await (await get('/5/recommendations')).json() as { recommendation: { products: Array<{ product_id: number }>; basedOnProductName: string } };
    expect(body.recommendation.products.map(p => p.product_id)).toEqual([2, 1]);
    expect(body.recommendation.basedOnProductName).toBe('base');
  });
});

describe('GET /:id/journeys', () => {
  it('groups node engagement per journey', async () => {
    m.query.mockImplementation((sql: string) => {
      if (sql.includes('journey_entries')) return Promise.resolve({ rows: [{ journey_id: 1 }, { journey_id: 2 }] });
      return Promise.resolve({ rows: [{ journey_id: 1, node_id: 'n', delivered: '1', opened: '0', clicked: '2' }] });
    });
    const body = await (await get('/u1/journeys')).json() as { data: Array<{ nodes: Array<{ delivered: boolean; opened: boolean; clicked: boolean }> }> };
    expect(body.data[0].nodes).toHaveLength(1);
    expect(body.data[0].nodes[0]).toMatchObject({ delivered: true, opened: false, clicked: true });
    expect(body.data[1].nodes).toEqual([]);
    expect(m.query.mock.calls[0][1]).toEqual(['u1']);
  });
  it('500 on DB error', async () => {
    m.query.mockRejectedValue(new Error('x'));
    expect((await get('/u1/journeys')).status).toBe(500);
  });
});
