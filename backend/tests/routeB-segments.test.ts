import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  seg: {
    getSegmentOverview: vi.fn(), getSegmentByType: vi.fn(), getSegmentCustomers: vi.fn(),
    getSegmentNationalities: vi.fn(), getSegmentGenders: vi.fn(),
  },
  eng: {
    getFunnelOverview: vi.fn(), getFullPageData: vi.fn(), getSummaryStats: vi.fn(), runSegmentation: vi.fn(),
    getSegmentDetail: vi.fn(), getSegmentCustomers: vi.fn(), getConversionMetrics: vi.fn(),
  },
  query: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query, connect: vi.fn() }, query: m.query }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn(), del: vi.fn(), default: {} }));
vi.mock('../src/services/SegmentService.js', () => ({ SegmentService: m.seg, default: m.seg }));
vi.mock('../src/services/SegmentEngine.js', () => ({ default: m.eng }));

import segmentsRouter from '../src/routes/segments.js';
import segmentsV3Router from '../src/routes/segmentsV3.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/v2', segmentsRouter);
  app.use('/v3', segmentsV3Router);
  app.use((err: Error, _req: Request, res: ExResponse, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  for (const f of [...Object.values(m.seg), ...Object.values(m.eng), m.query]) f.mockReset();
});
const get = (p: string): Promise<Response> => fetch(`${base}${p}`);
const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;

describe('segments.ts (v2)', () => {
  it('GET / and /by-type wrap service data', async () => {
    m.seg.getSegmentOverview.mockResolvedValue([{ a: 1 }]);
    m.seg.getSegmentByType.mockResolvedValue({ B2B: [] });
    expect(await json(await get('/v2/'))).toEqual({ success: true, data: [{ a: 1 }] });
    expect(await json(await get('/v2/by-type'))).toEqual({ success: true, data: { B2B: [] } });
  });
  it('500s when the service throws', async () => {
    m.seg.getSegmentOverview.mockRejectedValue(new Error('db'));
    expect((await get('/v2/')).status).toBe(500);
  });
  it('defaults page/limit and spreads the result', async () => {
    m.seg.getSegmentCustomers.mockResolvedValue({ data: [], total: 0 });
    const r = await get('/v2/Loyal/customers');
    expect(await json(r)).toEqual({ success: true, data: [], total: 0 });
    expect(m.seg.getSegmentCustomers).toHaveBeenCalledWith('Loyal', expect.objectContaining({ page: 1, limit: 50 }));
  });
  it('non-numeric page/limit fall back to defaults', async () => {
    m.seg.getSegmentCustomers.mockResolvedValue({});
    await get('/v2/x/customers?page=abc&limit=%27%3B--');
    expect(m.seg.getSegmentCustomers).toHaveBeenCalledWith('x', expect.objectContaining({ page: 1, limit: 50 }));
  });
  it('passes huge limit/page through unclamped (no route-level cap)', async () => {
    m.seg.getSegmentCustomers.mockResolvedValue({});
    await get('/v2/x/customers?page=99999999&limit=1000000');
    expect(m.seg.getSegmentCustomers).toHaveBeenCalledWith('x', expect.objectContaining({ page: 99999999, limit: 1000000 }));
  });
  it('decodes injection labels and passes them verbatim', async () => {
    m.seg.getSegmentNationalities.mockResolvedValue([]);
    m.seg.getSegmentGenders.mockResolvedValue([]);
    const inj = "x' OR 1=1--";
    expect((await get(`/v2/${encodeURIComponent(inj)}/nationalities`)).status).toBe(200);
    expect(m.seg.getSegmentNationalities).toHaveBeenCalledWith(inj);
    expect((await get('/v2/a/genders')).status).toBe(200);
  });
});

describe('segmentsV3.ts', () => {
  it('funnel / page-data / summary / run return { data }', async () => {
    m.eng.getFunnelOverview.mockResolvedValue([1]);
    m.eng.getFullPageData.mockResolvedValue({ p: 1 });
    m.eng.getSummaryStats.mockResolvedValue({ s: 1 });
    m.eng.runSegmentation.mockResolvedValue({ ok: true });
    expect(await json(await get('/v3/funnel'))).toEqual({ data: [1] });
    expect(await json(await get('/v3/page-data'))).toEqual({ data: { p: 1 } });
    expect(await json(await get('/v3/summary'))).toEqual({ data: { s: 1 } });
    expect(await json(await fetch(`${base}/v3/run`, { method: 'POST' }))).toEqual({ data: { ok: true } });
  });
  it('run → 500 on failure', async () => {
    m.eng.runSegmentation.mockRejectedValue(new Error('x'));
    expect((await fetch(`${base}/v3/run`, { method: 'POST' })).status).toBe(500);
  });
  it('GET /:id → 404 when missing, NaN for non-numeric ids', async () => {
    m.eng.getSegmentDetail.mockResolvedValue(null);
    expect((await get('/v3/abc')).status).toBe(404);
    expect(Number.isNaN(m.eng.getSegmentDetail.mock.calls[0][0])).toBe(true);
  });
  it('GET /:id returns detail', async () => {
    m.eng.getSegmentDetail.mockResolvedValue({ id: 3 });
    expect(await json(await get('/v3/3'))).toEqual({ data: { id: 3 } });
    expect(m.eng.getSegmentDetail).toHaveBeenCalledWith(3);
  });
  it('GET /:id/customers defaults and passes huge values unclamped', async () => {
    m.eng.getSegmentCustomers.mockResolvedValue({ rows: [] });
    expect(await json(await get('/v3/5/customers'))).toEqual({ rows: [] });
    expect(m.eng.getSegmentCustomers).toHaveBeenCalledWith(5, expect.objectContaining({ page: 1, limit: 25 }));
    await get('/v3/5/customers?page=-3&limit=9999999');
    expect(m.eng.getSegmentCustomers).toHaveBeenLastCalledWith(5, expect.objectContaining({ page: -3, limit: 9999999 }));
  });
  it('GET /:id/conversions 500s on error', async () => {
    m.eng.getConversionMetrics.mockRejectedValue(new Error('x'));
    expect((await get('/v3/1/conversions')).status).toBe(500);
  });

  describe('GET /general', () => {
    const rows = (n: number) => ({ rows: [{ n }] });
    it('returns counts + journeys with no business filter', async () => {
      m.query.mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('journey_flows') ? { rows: [{ journey_id: 1 }] } : rows(4)));
      const r = await get('/v3/general');
      expect(r.status).toBe(200);
      expect(await json(r)).toEqual({ data: { emailEligible: 4, waEligible: 4, totalContacts: 4, journeys: [{ journey_id: 1 }] } });
      expect(m.query.mock.calls[0][1]).toEqual([]);
    });
    it('parameterises a valid businessType', async () => {
      m.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('journey_flows') ? { rows: [] } : rows(1)));
      await get('/v3/general?businessType=B2B');
      expect(m.query.mock.calls[0][1]).toEqual(['B2B']);
    });
    it('ignores an injection businessType', async () => {
      m.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('journey_flows') ? { rows: [] } : rows(1)));
      await get(`/v3/general?businessType=${encodeURIComponent("B2B' OR 1=1")}`);
      expect(m.query.mock.calls[0][1]).toEqual([]);
      expect(String(m.query.mock.calls[0][0])).not.toContain('OR 1=1');
    });
    it('500s when a query fails', async () => {
      m.query.mockRejectedValue(new Error('db'));
      expect((await get('/v3/general')).status).toBe(500);
    });
  });
});
