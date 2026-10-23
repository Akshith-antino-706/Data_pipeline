import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

// No real database / redis / queue: everything the router touches is mocked.
const m = vi.hoisted(() => ({
  query: vi.fn(),
  cached: vi.fn(),
  cacheDel: vi.fn(),
  queueCounts: vi.fn(),
  toCsv: vi.fn(),
  runAll: vi.fn(),
  js: {
    getAll: vi.fn(), getOpsDashboard: vi.fn(), getJourneysActiveOnDate: vi.fn(), getJourneyNodeBreakdown: vi.fn(),
    getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), addNode: vi.fn(), updateNode: vi.fn(),
    deleteNode: vi.fn(), getNodeSendLog: vi.fn(), generateFromStrategy: vi.fn(), startJourney: vi.fn(),
    processJourney: vi.fn(), pauseJourney: vi.fn(), enrollSegment: vi.fn(), getEntries: vi.fn(),
    getJourneyTimeline: vi.fn(), getJourneyAnalytics: vi.fn(), getJourneyCampaignAnalytics: vi.fn(),
    checkConversions: vi.fn(), getEnrollments: vi.fn(), calculateNextFireAt: vi.fn(),
  },
  generateDailyAITemplates: vi.fn(),
  getOrGenerateNodeEmail: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query, connect: vi.fn() }, query: m.query }));
vi.mock('../src/config/cache.js', () => ({ cached: m.cached, del: m.cacheDel, default: { cached: m.cached, del: m.cacheDel } }));
vi.mock('../src/services/queue/index.js', () => ({ queueCounts: m.queueCounts }));
vi.mock('../src/services/SkipLogService.js', () => ({ default: { toCsv: m.toCsv } }));
vi.mock('../src/services/ConversionDetector.js', () => ({ default: { runAll: m.runAll } }));
vi.mock('../src/services/JourneyService.js', () => ({
  default: m.js,
  generateDailyAITemplates: m.generateDailyAITemplates,
  getOrGenerateNodeEmail: m.getOrGenerateNodeEmail,
}));

import journeysRouter from '../src/routes/journeys.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', journeysRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { data?: unknown; error?: string; success?: boolean; results?: unknown[] }
const get = async (p: string): Promise<{ status: number; body: Body }> => {
  const r = await fetch(base + p);
  return { status: r.status, body: (await r.json()) as Body };
};
const send = async (method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> => {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Body };
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(m.js)) fn.mockReset();
  m.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  m.cached.mockReset().mockImplementation((_k: string, fn: () => unknown) => Promise.resolve(fn()));
  m.cacheDel.mockReset().mockResolvedValue(undefined);
  m.js.processJourney.mockResolvedValue({ processed: 0, enqueued: 0 });
});

describe('GET /', () => {
  it('passes parsed paging and filters to the service', async () => {
    m.js.getAll.mockResolvedValue({ journeys: [], total: 0 });
    const r = await get('/?status=active&audience=indian&page=3&limit=7');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ journeys: [], total: 0 });
    expect(m.js.getAll).toHaveBeenCalledWith({ status: 'active', audience: 'indian', page: 3, limit: 7 });
  });
  it('falls back to page 1 / limit 20 for non-numeric paging', async () => {
    m.js.getAll.mockResolvedValue({});
    await get('/?page=abc&limit=;DROP');
    expect(m.js.getAll).toHaveBeenCalledWith({ status: undefined, audience: undefined, page: 1, limit: 20 });
  });
  it('returns 500 when the service throws', async () => {
    m.js.getAll.mockRejectedValue(new Error('boom'));
    const r = await get('/');
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('boom');
  });
});

describe('GET /queue-counts', () => {
  it('reports null for a queue whose count fails instead of 500', async () => {
    m.queueCounts.mockImplementation((q: string) => (q === 'sms' ? Promise.reject(new Error('x')) : Promise.resolve({ waiting: 1 })));
    const r = await get('/queue-counts');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ email: { waiting: 1 }, whatsapp: { waiting: 1 }, sms: null });
  });
});

describe('GET /dashboard', () => {
  it('uses the cache by default', async () => {
    m.js.getOpsDashboard.mockResolvedValue({ a: 1 });
    const r = await get('/dashboard');
    expect(r.body).toEqual({ success: true, data: { a: 1 } });
    expect(m.cached).toHaveBeenCalledWith('journey:ops-dashboard', expect.any(Function), 1800);
  });
  it('bypasses the cache with ?fresh=1', async () => {
    m.js.getOpsDashboard.mockResolvedValue({ a: 2 });
    await get('/dashboard?fresh=1');
    expect(m.cached).not.toHaveBeenCalled();
    expect(m.js.getOpsDashboard).toHaveBeenCalledTimes(1);
  });
  it('is not treated as a journey id', async () => {
    m.js.getOpsDashboard.mockResolvedValue({});
    await get('/dashboard');
    expect(m.js.getById).not.toHaveBeenCalled();
  });
});

describe('GET /analytics/table', () => {
  it('parameterises the status filter (injection string is a bind value)', async () => {
    const evil = "active' OR 1=1 --";
    const r = await get(`/analytics/table?status=${encodeURIComponent(evil)}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ journeys: [], meta: null });
    expect(m.query).toHaveBeenCalledWith(expect.not.stringContaining(evil), [evil]);
  });

  it('keeps the original full-list response when no paging params are sent', async () => {
    m.query.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('journey_stats_meta') ? { rows: [{ journeys_run: 2 }] } : { rows: [{ journey_id: 1 }, { journey_id: 2 }] },
    ));
    const r = await get('/analytics/table?status=active');
    expect(r.body.data).toEqual({ journeys: [{ journey_id: 1 }, { journey_id: 2 }], meta: { journeys_run: 2 } });
    const sqls = m.query.mock.calls.map(c => String(c[0]));
    expect(sqls.some(s => /LIMIT|OFFSET|COUNT\(/i.test(s))).toBe(false);
  });

  it('returns one page with total when page/limit/search/sort are sent', async () => {
    m.query.mockImplementation((sql: string) => {
      if (sql.includes('journey_stats_meta')) return Promise.resolve({ rows: [{ journeys_run: 9 }] });
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ total: '57' }] });
      return Promise.resolve({ rows: [{ journey_id: 21 }] });
    });
    const r = await get('/analytics/table?status=paused&page=2&limit=20&search=visa&sort=openRate&dir=asc&type=fixed');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      journeys: [{ journey_id: 21 }], total: 57, page: 2, limit: 20, sort: 'openRate', dir: 'asc', meta: { journeys_run: 9 },
    });
    const rowsCall = m.query.mock.calls.find(c => String(c[0]).includes('LIMIT'));
    expect(rowsCall?.[1]).toEqual(['paused', '%visa%', 20, 20]);
    for (const [sql] of m.query.mock.calls) {
      expect(String(sql).trim()).toMatch(/^SELECT\b/i);
      expect(String(sql)).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i);
    }
  });

  it('clamps an oversized limit and a bad page', async () => {
    m.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('COUNT(*)') ? { rows: [{ total: 3 }] } : { rows: [] }));
    const r = await get('/analytics/table?page=-4&limit=99999');
    expect(r.body.data).toMatchObject({ page: 1, limit: 200, total: 3 });
  });
});

describe('GET /analytics/:id/nodes', () => {
  it('attaches template ids from the flow to each node row', async () => {
    m.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM journey_node_stats')) return Promise.resolve({ rows: [{ node_id: 'n1' }, { node_id: 'n2' }] });
      if (sql.includes('SELECT nodes FROM journey_flows')) {
        return Promise.resolve({ rows: [{ nodes: [{ id: 'n1', type: 'action', data: { emailTemplateId: '42' } }, { id: 'n2', type: 'wait', data: {} }] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/analytics/5/nodes');
    expect(r.body.data).toEqual([{ node_id: 'n1', template_id: 42 }, { node_id: 'n2', template_id: null }]);
  });
});

describe('GET /active-on-date', () => {
  it('passes a valid date through and caches per date', async () => {
    m.js.getJourneysActiveOnDate.mockResolvedValue([]);
    await get('/active-on-date?date=2026-01-02');
    expect(m.cached).toHaveBeenCalledWith('journey:active-on-date:2026-01-02', expect.any(Function), 60);
    expect(m.js.getJourneysActiveOnDate).toHaveBeenCalledWith('2026-01-02');
  });
  // FIXED (was BUG) (src/routes/journeys.ts:255-257): an invalid ?date= is resolved to "today" for the
  // cache key, but the RAW invalid string is still passed to the service, so the result for
  // the garbage date is cached under today's key. The service should receive the resolved date.
  it('does not pass an invalid date string to the service', async () => {
    m.js.getJourneysActiveOnDate.mockResolvedValue([]);
    await get(`/active-on-date?date=${encodeURIComponent("x'; DROP TABLE t;--")}`);
    expect(m.js.getJourneysActiveOnDate).not.toHaveBeenCalledWith("x'; DROP TABLE t;--");
  });
});

describe('GET /skip-log.csv', () => {
  it('serves CSV inline, or as an attachment with ?download=1', async () => {
    m.toCsv.mockResolvedValue('a,b\n1,2\n');
    let r = await fetch(`${base}/skip-log.csv`);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('inline');
    expect(await r.text()).toBe('a,b\n1,2\n');
    r = await fetch(`${base}/skip-log.csv?download=1`);
    expect(r.headers.get('content-disposition')).toContain('attachment');
    await r.text();
  });
});

describe('GET /:id', () => {
  it('returns the journey from the cache path', async () => {
    m.js.getById.mockResolvedValue({ journey_id: 7 });
    const r = await get('/7');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ journey_id: 7 });
    expect(m.cached).toHaveBeenCalledWith('journey:detail:7', expect.any(Function), expect.any(Function));
  });
  it('?fresh=1 bypasses the cache', async () => {
    m.js.getById.mockResolvedValue({ journey_id: 7 });
    await get('/7?fresh=1');
    expect(m.js.getById).toHaveBeenCalledWith(7, { fresh: true });
    expect(m.cached).not.toHaveBeenCalled();
  });
  it('404 when not found', async () => {
    m.js.getById.mockResolvedValue(null);
    const r = await get('/999');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Journey not found');
  });
  it('500 when the service throws', async () => {
    m.js.getById.mockRejectedValue(new Error('db down'));
    expect((await get('/1')).status).toBe(500);
  });
  // FIXED (was BUG) (src/routes/journeys.ts:398): a non-numeric id is parseInt'd to NaN and handed to the
  // service (cache key "journey:detail:NaN") instead of being rejected with 400.
  it('rejects a non-numeric id with 400', async () => {
    m.js.getById.mockResolvedValue(null);
    const r = await get('/abc');
    expect(r.status).toBe(400);
  });
});

describe('mutations', () => {
  it('POST / creates (201) and forwards the body', async () => {
    m.js.create.mockResolvedValue({ journey_id: 1 });
    const r = await send('POST', '/', { name: 'J' });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ journey_id: 1 });
    expect(m.js.create).toHaveBeenCalledWith({ name: 'J' });
  });
  it('POST / with empty body still reaches the service; a throw → 500', async () => {
    m.js.create.mockRejectedValue(new Error('name required'));
    const r = await send('POST', '/');
    expect(r.status).toBe(500);
    expect(m.js.create).toHaveBeenCalledWith({});
  });
  it('PUT /:id invalidates the detail + timeline cache on success', async () => {
    m.js.update.mockResolvedValue({ ok: true });
    const r = await send('PUT', '/12', { name: 'x' });
    expect(r.status).toBe(200);
    expect(m.js.update).toHaveBeenCalledWith(12, { name: 'x' });
    await vi.waitFor(() => expect(m.cacheDel).toHaveBeenCalledWith('journey:detail:12', 'journey:timeline:12'));
  });
  it('a failed mutation does not invalidate the cache', async () => {
    m.js.delete.mockRejectedValue(new Error('nope'));
    const r = await send('DELETE', '/12');
    expect(r.status).toBe(500);
    await new Promise(res => setTimeout(res, 20));
    expect(m.cacheDel).not.toHaveBeenCalled();
  });
  it('DELETE /:id returns success', async () => {
    m.js.delete.mockResolvedValue(undefined);
    const r = await send('DELETE', '/3');
    expect(r.body).toEqual({ success: true });
    expect(m.js.delete).toHaveBeenCalledWith(3);
  });
  it('POST /:id/nodes passes node and afterNodeId', async () => {
    m.js.addNode.mockResolvedValue({ id: 'n9' });
    const r = await send('POST', '/4/nodes', { node: { type: 'action' }, afterNodeId: 'n1' });
    expect(r.status).toBe(201);
    expect(m.js.addNode).toHaveBeenCalledWith(4, { type: 'action' }, 'n1');
  });
  it('PATCH and DELETE /:id/nodes/:nodeId pass the raw node id', async () => {
    m.js.updateNode.mockResolvedValue({});
    m.js.deleteNode.mockResolvedValue({});
    await send('PATCH', '/4/nodes/n%3B1', { label: 'L' });
    expect(m.js.updateNode).toHaveBeenCalledWith(4, 'n;1', { label: 'L' });
    await send('DELETE', '/4/nodes/n2');
    expect(m.js.deleteNode).toHaveBeenCalledWith(4, 'n2');
  });
  it('POST /:id/start responds then processes in the background', async () => {
    m.js.startJourney.mockResolvedValue({ status: 'active' });
    const r = await send('POST', '/8/start');
    expect(r.body.data).toEqual({ status: 'active' });
    expect(m.js.startJourney).toHaveBeenCalledWith(8, { manual: true });
    await vi.waitFor(() => expect(m.js.processJourney).toHaveBeenCalledTimes(2));
  });
  it('POST /:id/process uses ?batch or default 100', async () => {
    await send('POST', '/8/process?batch=5');
    expect(m.js.processJourney).toHaveBeenLastCalledWith(8, 5);
    await send('POST', '/8/process?batch=abc');
    expect(m.js.processJourney).toHaveBeenLastCalledWith(8, 100);
  });
  it('POST /generate-from-strategy/:strategyId → 201', async () => {
    m.js.generateFromStrategy.mockResolvedValue({ journey_id: 2 });
    const r = await send('POST', '/generate-from-strategy/9');
    expect(r.status).toBe(201);
    expect(m.js.generateFromStrategy).toHaveBeenCalledWith(9);
  });
  it('POST /generate-daily-templates returns 500 JSON when generation throws', async () => {
    m.generateDailyAITemplates.mockRejectedValue(new Error('claude down'));
    const r = await send('POST', '/generate-daily-templates');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'claude down' });
  });
});

describe('POST /:id/reset-entries', () => {
  it('moves entries to a node when nodeId is given (bind params)', async () => {
    m.query.mockResolvedValue({ rows: [], rowCount: 4 });
    const r = await send('POST', '/6/reset-entries', { nodeId: 'n3' });
    expect(r.body.data).toEqual({ reset: 4, movedTo: 'n3' });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('current_node_id = $2'), [6, 'n3']);
  });
  it('clears run ids when no nodeId is given', async () => {
    m.query.mockResolvedValue({ rows: [], rowCount: 2 });
    const r = await send('POST', '/6/reset-entries', {});
    expect(r.body.data).toEqual({ reset: 2 });
  });
});

describe('GET /:id/snapshot-status', () => {
  for (const [count, state, outCount] of [[-1, 'building', 0], [-2, 'failed', 0], [15, 'done', 15]] as const) {
    it(`snapshot_count ${count} → ${state}`, async () => {
      m.query.mockResolvedValue({ rows: [{ journey_id: 1, name: 'J', snapshot_count: count, status: 'draft' }] });
      const r = await get('/1/snapshot-status');
      expect(r.body.data).toEqual({ journeyId: 1, name: 'J', state, count: outCount, status: 'draft' });
    });
  }
  it('404 when the journey is missing', async () => {
    expect((await get('/1/snapshot-status')).status).toBe(404);
  });
});

describe('node endpoints that read the flow', () => {
  it('test-send: 404 journey / 404 node', async () => {
    expect((await send('POST', '/1/nodes/n1/test-send')).status).toBe(404);
    m.query.mockResolvedValue({ rows: [{ nodes: [{ id: 'other' }], edges: [] }] });
    const r = await send('POST', '/1/nodes/n1/test-send');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Node not found');
  });
  it('preview-dynamic: 404 journey, 400 node without template', async () => {
    expect((await get('/1/nodes/n1/preview-dynamic')).status).toBe(404);
    m.query.mockResolvedValue({ rows: [{ nodes: [{ id: 'n1', data: {} }] }] });
    const r = await get('/1/nodes/n1/preview-dynamic');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Node has no email template');
  });
  it('preview-dynamic: 500 when the template is not a dynamic Day template', async () => {
    m.query.mockResolvedValue({ rows: [{ nodes: [{ id: 'n1', data: { templateId: '5' } }] }] });
    m.getOrGenerateNodeEmail.mockResolvedValue(null);
    const r = await get('/1/nodes/n1/preview-dynamic');
    expect(r.status).toBe(500);
    expect(m.getOrGenerateNodeEmail).toHaveBeenCalledWith({ journeyId: 1, nodeId: 'n1', templateId: 5, contactId: 'preview' });
  });
  it('reset-fire-times: 404 for a missing journey', async () => {
    expect((await send('POST', '/1/reset-fire-times')).status).toBe(404);
  });
  it('retry-blocked: returns 0 without updating when nothing is blocked', async () => {
    const r = await send('POST', '/1/nodes/n1/retry-blocked');
    expect(r.body.data).toEqual({ retried: 0 });
    expect(m.query).toHaveBeenCalledTimes(1);
  });
});

describe('simple pass-through reads', () => {
  it('GET /:id/entries parses paging', async () => {
    m.js.getEntries.mockResolvedValue({ entries: [] });
    await get('/2/entries?page=2&limit=x&status=active');
    expect(m.js.getEntries).toHaveBeenCalledWith(2, { page: 2, limit: 50, status: 'active' });
    await get('/2/entries?q=%20vaibhav%20');
    expect(m.js.getEntries).toHaveBeenLastCalledWith(2, { page: 1, limit: 50, status: undefined, q: 'vaibhav' });
  });
  it('GET /:id/node-breakdown 404 when missing', async () => {
    m.js.getJourneyNodeBreakdown.mockResolvedValue(null);
    expect((await get('/2/node-breakdown')).status).toBe(404);
  });
  it('POST /detect-conversions spreads the result', async () => {
    m.runAll.mockResolvedValue({ converted: 3 });
    const r = await send('POST', '/detect-conversions');
    expect(r.body).toEqual({ success: true, converted: 3 });
  });
  it('POST /process-all processes each active journey', async () => {
    m.query.mockResolvedValue({ rows: [{ journey_id: 1 }, { journey_id: 2 }] });
    const r = await send('POST', '/process-all');
    expect(r.body.results).toEqual([{ journey_id: 1, processed: 0, enqueued: 0 }, { journey_id: 2, processed: 0, enqueued: 0 }]);
  });
});
