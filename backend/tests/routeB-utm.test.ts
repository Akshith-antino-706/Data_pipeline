import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  buildUTM: vi.fn(), getSegmentsList: vi.fn(), generateForSegment: vi.fn(), generateForAllSegments: vi.fn(),
  generateForCampaign: vi.fn(), getAnalytics: vi.fn(), recordClick: vi.fn(), recordConversion: vi.fn(),
  trackClick: vi.fn(), generateUserLinks: vi.fn(), getUserLinks: vi.fn(), getUserLinkStats: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/UTMService.js', () => ({ default: m }));

import router from '../src/routes/utm.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/utm', router);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/utm`;
});
afterAll(() => { server.close(); });
beforeEach(() => { for (const f of Object.values(m)) f.mockReset(); });
const post = (p: string, body?: unknown): Promise<Response> => fetch(`${base}${p}`, {
  method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('utm.ts', () => {
  it('POST /build returns utm_url; 500 on throw', async () => {
    m.buildUTM.mockReturnValueOnce('https://x?utm=1').mockImplementationOnce(() => { throw new Error('bad url'); });
    expect(await (await post('/build', { base_url: 'https://x' })).json()).toEqual({ utm_url: 'https://x?utm=1' });
    const r = await post('/build', {});
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'bad url' });
  });
  it('GET /segments', async () => {
    m.getSegmentsList.mockResolvedValue([1]);
    expect(await (await fetch(`${base}/segments`)).json()).toEqual({ data: [1] });
  });
  it('POST /segment/:label decodes label and tolerates no body', async () => {
    m.generateForSegment.mockResolvedValue([]);
    const r = await post(`/segment/${encodeURIComponent('Loyal Fans')}`);
    expect(r.status).toBe(200);
    expect(m.generateForSegment).toHaveBeenCalledWith('Loyal Fans', { journeyId: undefined, nodeId: undefined });
  });
  it('POST /segment/:label with a malformed %-sequence 400s (express rejects the param)', async () => {
    const r = await post('/segment/%E0%A4%A');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(m.generateForSegment).not.toHaveBeenCalled();
  });
  it('POST /generate-all sums links_generated', async () => {
    m.generateForAllSegments.mockResolvedValue([{ links_generated: 2 }, { links_generated: 3 }]);
    expect(await (await post('/generate-all', { journeyId: 1 })).json()).toEqual({
      segments_processed: 2, total_links: 5, results: [{ links_generated: 2 }, { links_generated: 3 }],
    });
    expect(m.generateForAllSegments).toHaveBeenCalledWith({ journeyId: 1, nodeId: undefined });
  });
  it('POST /campaign/:id passes id; 500 on error', async () => {
    m.generateForCampaign.mockResolvedValueOnce({ ok: 1 }).mockRejectedValueOnce(new Error('nf'));
    expect(await (await post("/campaign/1'--")).json()).toEqual({ ok: 1 });
    expect(m.generateForCampaign).toHaveBeenCalledWith("1'--", { journeyId: undefined, nodeId: undefined });
    expect((await post('/campaign/1')).status).toBe(500);
  });
  it('GET /analytics forwards query', async () => {
    m.getAnalytics.mockResolvedValue({ a: 1 });
    await fetch(`${base}/analytics?from=2024-01-01`);
    expect(m.getAnalytics).toHaveBeenCalledWith({ from: '2024-01-01' });
  });
  it('POST /:id/click records; 500 on error', async () => {
    m.recordClick.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    expect(await (await post('/7/click')).json()).toEqual({ recorded: true });
    expect((await post('/7/click')).status).toBe(500);
  });
  it('POST /:id/conversion with revenue', async () => {
    m.recordConversion.mockResolvedValue(undefined);
    expect((await post('/7/conversion', { revenue: 99 })).status).toBe(200);
    expect(m.recordConversion).toHaveBeenCalledWith('7', 99);
  });
  // BUG utm.ts:94 — `(req.body as {...}).revenue` with no JSON body: req.body is undefined in
  // Express 5, so the property read throws and a revenue-less conversion is reported as 500.
  it.fails('POST /:id/conversion without a body records the conversion', async () => {
    m.recordConversion.mockResolvedValue(undefined);
    expect((await post('/7/conversion')).status).toBe(200);
  });
  it('GET /track/:token redirects 302, 404 when unknown, 500 on error', async () => {
    m.trackClick.mockResolvedValueOnce({ destination_url: 'https://example.com/x' })
      .mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'));
    const r = await fetch(`${base}/track/tok`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://example.com/x');
    expect((await fetch(`${base}/track/tok`, { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(`${base}/track/tok`, { redirect: 'manual' })).status).toBe(500);
  });
  it('user-links endpoints', async () => {
    m.generateUserLinks.mockResolvedValue({ n: 1 });
    m.getUserLinks.mockResolvedValue({ rows: [] });
    m.getUserLinkStats.mockRejectedValue(new Error('x'));
    expect(await (await post('/user-links/c1', { a: 1 })).json()).toEqual({ n: 1 });
    expect(m.generateUserLinks).toHaveBeenCalledWith('c1', { a: 1 });
    expect(await (await fetch(`${base}/user-links?limit=99999999`)).json()).toEqual({ rows: [] });
    expect(m.getUserLinks).toHaveBeenCalledWith({ limit: '99999999' });
    expect((await fetch(`${base}/user-links-stats`)).status).toBe(500);
  });
});
