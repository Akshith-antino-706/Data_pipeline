// gtm.ts routes NOT covered by route-notImplemented.test.ts. DB + GTMService mocked.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[] }
const { mockQuery, gtm } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
  gtm: {
    getContainerSnippet: vi.fn<(id: unknown) => unknown>(),
    getDataLayerScripts: vi.fn<() => unknown>(),
    recordEvent: vi.fn<(b: unknown) => Promise<unknown>>(),
    getEventAnalytics: vi.fn<(q: unknown) => Promise<unknown>>(),
    getExportData: vi.fn<(q: unknown) => Promise<unknown[]>>(),
    getSpecialOccasions: vi.fn<() => Promise<unknown>>(),
    createSpecialOccasion: vi.fn<(b: unknown) => Promise<unknown>>(),
  },
}));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/GTMService.js', () => ({ default: gtm }));

import gtmRouter from '../src/routes/gtm.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', gtmRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockQuery.mockResolvedValue({ rows: [] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T; headers: Headers }> {
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json() as T, headers: r.headers };
}
const postJson = (body: string): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('GET /snippet', () => {
  it('uses ?containerId when given', async () => {
    gtm.getContainerSnippet.mockReturnValue({ head: 'h' });
    const r = await call<{ head: string }>('/snippet?containerId=GTM-X1');
    expect(r.body).toEqual({ head: 'h' });
    expect(gtm.getContainerSnippet).toHaveBeenCalledWith('GTM-X1');
  });
  it('falls back to env, then the built-in default', async () => {
    gtm.getContainerSnippet.mockReturnValue({});
    vi.stubEnv('GTM_CONTAINER_ID', 'GTM-ENV');
    await call('/snippet');
    expect(gtm.getContainerSnippet).toHaveBeenLastCalledWith('GTM-ENV');
    vi.stubEnv('GTM_CONTAINER_ID', '');
    await call('/snippet');
    expect(gtm.getContainerSnippet).toHaveBeenLastCalledWith('GTM-RAYNA001');
  });
  it('service rejecting an injection-y id → 400', async () => {
    gtm.getContainerSnippet.mockImplementation(() => { throw new Error('Invalid container id'); });
    const r = await call<{ error: string }>(`/snippet?containerId=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Invalid container id');
  });
});

describe('GET /datalayer', () => {
  it('returns the scripts', async () => {
    gtm.getDataLayerScripts.mockReturnValue({ a: 1 });
    expect((await call('/datalayer')).body).toEqual({ a: 1 });
  });
});

describe('/events CORS + POST happy path', () => {
  it('answers a cross-origin preflight', async () => {
    const r = await fetch(`${base}/events`, { method: 'OPTIONS', headers: { origin: 'https://www.raynatours.com', 'access-control-request-method': 'POST' } });
    expect(r.status).toBeLessThan(300);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://www.raynatours.com');
  });
  it('POST records the event → 201', async () => {
    gtm.recordEvent.mockResolvedValue({ event_id: 1 });
    const r = await call<{ event_id: number }>('/events', postJson('{"event_name":"page_view"}'));
    expect(r.status).toBe(201);
    expect(gtm.recordEvent).toHaveBeenCalledWith({ event_name: 'page_view' });
  });
});

describe('GET /events/:eventName', () => {
  it('parameterises the event name', async () => {
    mockQuery.mockResolvedValue({ rows: [{ event_id: 1 }] });
    const evil = "x' OR 1=1;--";
    const r = await call<{ data: unknown[] }>(`/events/${encodeURIComponent(evil)}`);
    expect(r.body.data).toEqual([{ event_id: 1 }]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain(evil);
    expect(params).toEqual([evil]);
  });
  it('DB error → 500', async () => {
    mockQuery.mockRejectedValue(new Error('db'));
    expect((await call('/events/x')).status).toBe(500);
  });
});

describe('GET /contact/:unifiedId', () => {
  it('returns summary + events with total', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ event_name: 'a', count: 2 }] }).mockResolvedValueOnce({ rows: [{ event_id: 1 }, { event_id: 2 }] });
    const r = await call<{ summary: unknown[]; events: unknown[]; total: number }>('/contact/123');
    expect(r.body.total).toBe(2);
    expect(mockQuery.mock.calls.every(c => c[1]?.[0] === '123')).toBe(true);
  });
  it('one query failing → 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('x'));
    expect((await call('/contact/1')).status).toBe(500);
  });
});

describe('analytics / export / occasions', () => {
  it('analytics passes the query through', async () => {
    gtm.getEventAnalytics.mockResolvedValue({ total: 5 });
    await call('/analytics?days=7');
    expect(gtm.getEventAnalytics).toHaveBeenCalledWith({ days: '7' });
  });
  it('analytics error → 500', async () => {
    gtm.getEventAnalytics.mockRejectedValue(new Error('x'));
    expect((await call('/analytics')).status).toBe(500);
  });
  it('export wraps rows', async () => {
    gtm.getExportData.mockResolvedValue([{ a: 1 }]);
    expect((await call('/export')).body).toEqual({ rows: [{ a: 1 }], count: 1, format: 'bigquery_compatible' });
  });
  it('export error → 500', async () => {
    gtm.getExportData.mockRejectedValue(new Error('x'));
    expect((await call('/export')).status).toBe(500);
  });
  it('occasions GET / error', async () => {
    gtm.getSpecialOccasions.mockResolvedValue([{ id: 1 }]);
    expect((await call('/occasions')).body).toEqual([{ id: 1 }]);
    gtm.getSpecialOccasions.mockRejectedValue(new Error('x'));
    expect((await call('/occasions')).status).toBe(500);
  });
  it('occasions POST → 201; empty body reaches the service; service error → 500', async () => {
    gtm.createSpecialOccasion.mockResolvedValue({ id: 2 });
    expect((await call('/occasions', postJson('{"name":"Eid"}'))).status).toBe(201);
    await call('/occasions', { method: 'POST' });
    expect(gtm.createSpecialOccasion).toHaveBeenLastCalledWith(undefined);
    gtm.createSpecialOccasion.mockRejectedValue(new Error('name required'));
    expect((await call('/occasions', postJson('{}'))).status).toBe(500);
  });
  it('occasions POST invalid JSON → 400 without calling the service', async () => {
    const r = await fetch(`${base}/occasions`, postJson('{nope'));
    expect(r.status).toBe(400);
    expect(gtm.createSpecialOccasion).not.toHaveBeenCalled();
  });
});
