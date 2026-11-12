import { describe, it, expect, vi, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({ query: vi.fn(), rank: vi.fn(), render: vi.fn(), send: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));
vi.mock('../src/services/RecommendationRankingService.js', () => ({ rankRecommendations: m.rank }));
vi.mock('../src/services/RecommendationRenderer.js', () => ({ renderRecommendationEmail: m.render }));
vi.mock('../src/services/channels/EmailChannel.js', () => ({ EmailChannel: { send: m.send } }));

import recRouter from '../src/routes/recommendations.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', recRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; error?: string; hint?: string; html?: string; subject?: string; to?: string; simulated?: boolean; productIds?: number[] }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}

const ranking = { productIds: [1, 2], source: 'fallback', rationale: 'r', candidates: 2 };
const tpl = { id: 3, subject: 'Subj', body: '<p>b</p>', name: 'T', html_body: '<p>h</p>' };
let savedAllow: string | undefined;
beforeEach(() => {
  savedAllow = process.env.REC_TEST_ALLOWLIST;
  delete process.env.REC_TEST_ALLOWLIST;
  for (const f of Object.values(m)) f.mockReset();
  m.query.mockResolvedValue({ rows: [tpl] });
  m.rank.mockResolvedValue(ranking);
  m.render.mockResolvedValue({ html: '<html/>', productsUsed: [{ product_id: 1, product_name: 'P', product_price: 10 }] });
  m.send.mockResolvedValue({ success: true, simulated: true, provider: 'mock', externalId: 'e1' });
});
afterEach(() => {
  if (savedAllow === undefined) delete process.env.REC_TEST_ALLOWLIST; else process.env.REC_TEST_ALLOWLIST = savedAllow;
});

describe('GET /rank', () => {
  it('400 without city', async () => {
    expect((await call('GET', '/rank')).status).toBe(400);
  });
  it('clamps topN to 1..10 and defaults to 5', async () => {
    await call('GET', '/rank?city=Dubai&topN=999');
    expect(m.rank).toHaveBeenLastCalledWith({ destinationCity: 'Dubai', excludeProductId: null, topN: 10 });
    await call('GET', '/rank?city=Dubai&topN=-3');
    expect(m.rank).toHaveBeenLastCalledWith({ destinationCity: 'Dubai', excludeProductId: null, topN: 1 });
    await call('GET', '/rank?city=Dubai&topN=abc&excludeProductId=9');
    expect(m.rank).toHaveBeenLastCalledWith({ destinationCity: 'Dubai', excludeProductId: '9', topN: 5 });
  });
  it('spreads ranking into the response', async () => {
    const r = await call('GET', '/rank?city=Dubai');
    expect(r.body.success).toBe(true);
    expect(r.body.productIds).toEqual([1, 2]);
  });
  it('500 when ranking throws', async () => {
    m.rank.mockRejectedValue(new Error('claude'));
    expect((await call('GET', '/rank?city=Dubai')).status).toBe(500);
  });
});

describe('GET /preview', () => {
  it('400 without city or with non-numeric templateId', async () => {
    expect((await call('GET', '/preview?templateId=3')).status).toBe(400);
    expect((await call('GET', '/preview?city=Dubai&templateId=abc')).status).toBe(400);
    expect(m.query).not.toHaveBeenCalled();
  });
  it('404 when template is missing', async () => {
    m.query.mockResolvedValue({ rows: [] });
    const r = await call('GET', '/preview?city=Dubai&templateId=3');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Template 3 not found');
  });
  it('renders with html_body and does not send email', async () => {
    const r = await call('GET', '/preview?city=Dubai&templateId=3');
    expect(r.status).toBe(200);
    expect(r.body.html).toBe('<html/>');
    expect(r.body.subject).toBe('Subj');
    expect(m.render).toHaveBeenCalledWith(expect.objectContaining({ templateHtml: '<p>h</p>' }));
    expect(m.send).not.toHaveBeenCalled();
  });
});

describe('POST /test-send', () => {
  it('400 on empty body', async () => {
    expect((await call('POST', '/test-send')).status).toBe(400);
  });
  it('403 for a recipient outside the allowlist', async () => {
    const r = await call('POST', '/test-send', { to: 'attacker@evil.com', city: 'Dubai', templateId: 3 });
    expect(r.status).toBe(403);
    expect(r.body.hint).toContain('akshith@raynatours.com');
    expect(m.send).not.toHaveBeenCalled();
  });
  it('honours REC_TEST_ALLOWLIST, case-insensitively', async () => {
    process.env.REC_TEST_ALLOWLIST = ' QA@Example.com , other@x.com';
    const r = await call('POST', '/test-send', { to: 'qa@EXAMPLE.com ', city: 'Dubai', templateId: 3 });
    expect(r.status).toBe(200);
    expect(r.body.to).toBe('qa@example.com');
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'qa@example.com', subject: '[TEST] Subj' }));
  });
  it('400 for missing city / templateId after the allowlist check', async () => {
    expect((await call('POST', '/test-send', { to: 'akshith@raynatours.com', templateId: 3 })).status).toBe(400);
    expect((await call('POST', '/test-send', { to: 'akshith@raynatours.com', city: 'Dubai', templateId: 'x' })).status).toBe(400);
  });
  it('404 for unknown template', async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect((await call('POST', '/test-send', { to: 'akshith@raynatours.com', city: 'Dubai', templateId: 3 })).status).toBe(404);
  });
  it('still answers when the send-log insert fails', async () => {
    m.query.mockResolvedValueOnce({ rows: [tpl] }).mockRejectedValueOnce(new Error('schema drift'));
    const r = await call('POST', '/test-send', { to: 'akshith@raynatours.com', city: 'Dubai', templateId: 3 });
    expect(r.status).toBe(200);
    expect(r.body.simulated).toBe(true);
  });
  it('500 when the email channel throws', async () => {
    m.send.mockRejectedValue(new Error('smtp'));
    expect((await call('POST', '/test-send', { to: 'akshith@raynatours.com', city: 'Dubai', templateId: 3 })).status).toBe(500);
  });
  // FIXED (was BUG) (src/routes/recommendations.ts:156-158): `city` from the request body is interpolated
  // unescaped into the HTML banner of the sent email (HTML injection into a real inbox).
  it('escapes the city in the TEST banner', async () => {
    await call('POST', '/test-send', { to: 'akshith@raynatours.com', city: '<script>x</script>', templateId: 3 });
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({ html: expect.not.stringContaining('<script>x</script>') as string }));
  });
});
