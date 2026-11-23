import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  prod: {
    getAll: vi.fn(), getCategories: vi.fn(), getById: vi.fn(), getForSegment: vi.fn(),
    generateProductEmailHTML: vi.fn(), generateProductWAMessage: vi.fn(),
  },
  aff: {
    runAll: vi.fn(), syncProducts: vi.fn(), refreshAffinity: vi.fn(), getUserAffinity: vi.fn(),
    getRecommendations: vi.fn(), getTemplateProducts: vi.fn(),
  },
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/ProductService.js', () => ({ default: m.prod }));
vi.mock('../src/services/ProductAffinityService.js', () => ({ default: m.aff }));

import productsRouter from '../src/routes/products.js';
import affinityRouter from '../src/routes/productAffinity.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/p', productsRouter);
  app.use('/a', affinityRouter);
  app.use((err: Error, _req: Request, res: ExResponse, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => { for (const f of [...Object.values(m.prod), ...Object.values(m.aff)]) f.mockReset(); });
const get = (p: string): Promise<Response> => fetch(`${base}${p}`);
const post = (p: string, body?: unknown): Promise<Response> => fetch(`${base}${p}`, {
  method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('products.ts', () => {
  it('GET / returns products + count and forwards query', async () => {
    m.prod.getAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect(await (await get('/p/?category=tours')).json()).toEqual({ products: [{ id: 1 }, { id: 2 }], count: 2 });
    expect(m.prod.getAll).toHaveBeenCalledWith({ category: 'tours' });
  });
  it('GET / 500s with the error message', async () => {
    m.prod.getAll.mockRejectedValue(new Error('db gone'));
    const r = await get('/p/');
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'db gone' });
  });
  it('GET /categories is not captured by /:id', async () => {
    m.prod.getCategories.mockResolvedValue([{ c: 'x' }]);
    expect(await (await get('/p/categories')).json()).toEqual([{ c: 'x' }]);
    expect(m.prod.getById).not.toHaveBeenCalled();
  });
  it('GET /:id 404 / 200 / injection passthrough', async () => {
    m.prod.getById.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x' });
    expect((await get(`/p/${encodeURIComponent("1' OR '1'='1")}`)).status).toBe(404);
    expect(m.prod.getById).toHaveBeenCalledWith("1' OR '1'='1");
    expect((await get('/p/5')).status).toBe(200);
  });
  it('GET /segment/:label default limit 3, numeric limit, huge clamped to 50', async () => {
    m.prod.getForSegment.mockResolvedValue([]);
    expect(await (await get('/p/segment/Loyal')).json()).toEqual({ products: [], count: 0, segment: 'Loyal' });
    expect(m.prod.getForSegment).toHaveBeenLastCalledWith('Loyal', 3);
    await get('/p/segment/Loyal?limit=abc');
    expect(m.prod.getForSegment).toHaveBeenLastCalledWith('Loyal', 3);
    await get('/p/segment/Loyal?limit=999999');
    expect(m.prod.getForSegment).toHaveBeenLastCalledWith('Loyal', 50);
  });
  it('POST /generate-email applies defaults', async () => {
    m.prod.getForSegment.mockResolvedValue([{ id: 1 }]);
    m.prod.generateProductEmailHTML.mockReturnValue('<html/>');
    m.prod.generateProductWAMessage.mockReturnValue('wa');
    const r = await post('/p/generate-email', { segmentLabel: 'S' });
    expect(await r.json()).toEqual({ html: '<html/>', waMessage: 'wa', products: [{ id: 1 }], productCount: 1 });
    expect(m.prod.getForSegment).toHaveBeenCalledWith('S', 3);
    expect(m.prod.generateProductEmailHTML).toHaveBeenCalledWith(expect.objectContaining({ heading: 'Explore Amazing Experiences', segmentLabel: 'S' }));
  });
  it('POST /generate-wa 500s on service failure', async () => {
    m.prod.getForSegment.mockRejectedValue(new Error('x'));
    expect((await post('/p/generate-wa', { segmentLabel: 'S' })).status).toBe(500);
  });
  it('POST /generate-wa passes productCount through', async () => {
    m.prod.getForSegment.mockResolvedValue([]);
    m.prod.generateProductWAMessage.mockReturnValue('m');
    expect(await (await post('/p/generate-wa', { segmentLabel: 'S', productCount: 5 })).json()).toEqual({ message: 'm', products: [], productCount: 0 });
    expect(m.prod.getForSegment).toHaveBeenCalledWith('S', 5);
  });
  // FIXED (was BUG) products.ts:84 (and :56) — with no JSON body, destructuring undefined req.body throws → 500
  // instead of a 400 validation error.
  it('POST /generate-wa with no body is a 4xx, not 500', async () => {
    expect((await post('/p/generate-wa')).status).toBeLessThan(500);
    expect(m.prod.getForSegment).not.toHaveBeenCalled();
  });
});

describe('productAffinity.ts', () => {
  it('sync endpoints spread service results', async () => {
    m.aff.runAll.mockResolvedValue({ a: 1 });
    m.aff.syncProducts.mockResolvedValue({ b: 2 });
    m.aff.refreshAffinity.mockResolvedValue({ c: 3 });
    expect(await (await post('/a/sync')).json()).toEqual({ success: true, a: 1 });
    expect(await (await post('/a/sync-products')).json()).toEqual({ success: true, b: 2 });
    expect(await (await post('/a/refresh')).json()).toEqual({ success: true, c: 3 });
  });
  it('sync 500s on error', async () => {
    m.aff.runAll.mockRejectedValue(new Error('x'));
    expect((await post('/a/sync')).status).toBe(500);
  });
  it('GET /user/:id defaults limit 10 and parses id', async () => {
    m.aff.getUserAffinity.mockResolvedValue([]);
    await get('/a/user/42');
    expect(m.aff.getUserAffinity).toHaveBeenCalledWith(42, 10);
    await get('/a/user/42?limit=3');
    expect(m.aff.getUserAffinity).toHaveBeenLastCalledWith(42, 3);
  });
  it('GET /user/:id with a non-numeric id is a 400 and never reaches the service', async () => {
    m.aff.getUserAffinity.mockResolvedValue([]);
    expect((await get('/a/user/abc')).status).toBe(400);
    expect(m.aff.getUserAffinity).not.toHaveBeenCalled();
  });
  it('recommendations default 6, huge limit clamped to 50', async () => {
    m.aff.getRecommendations.mockResolvedValue({ products: [] });
    expect(await (await get('/a/user/1/recommendations')).json()).toEqual({ success: true, products: [] });
    expect(m.aff.getRecommendations).toHaveBeenCalledWith(1, 6);
    await get('/a/user/1/recommendations?limit=100000');
    expect(m.aff.getRecommendations).toHaveBeenLastCalledWith(1, 50);
  });
  it('template-products 500 on error', async () => {
    m.aff.getTemplateProducts.mockRejectedValue(new Error('x'));
    expect((await get('/a/user/1/template-products')).status).toBe(500);
  });
});
