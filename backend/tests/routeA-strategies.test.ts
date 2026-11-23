import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  ss: { getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), getBySegment: vi.fn() },
  optimizeStrategy: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/StrategyService.js', () => ({ StrategyService: m.ss }));
vi.mock('../src/services/AIService.js', () => ({ AIService: { optimizeStrategy: m.optimizeStrategy } }));

import strategiesRouter from '../src/routes/strategies.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', strategiesRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; data?: unknown; error?: string }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
beforeEach(() => { for (const f of Object.values(m.ss)) f.mockReset(); m.optimizeStrategy.mockReset(); });

describe('strategies routes', () => {
  it('GET / lists', async () => {
    m.ss.getAll.mockResolvedValue([{ id: 1 }]);
    expect((await call('GET', '/')).body).toEqual({ success: true, data: [{ id: 1 }] });
  });
  it('GET / 500 on error', async () => {
    m.ss.getAll.mockRejectedValue(new Error('x'));
    expect((await call('GET', '/')).status).toBe(500);
  });
  it('GET /:id 404 when not found', async () => {
    m.ss.getById.mockResolvedValue(null);
    const r = await call('GET', '/77');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Strategy not found');
  });
  it('GET /:id 200', async () => {
    m.ss.getById.mockResolvedValue({ id: 2 });
    expect((await call('GET', '/2')).body.data).toEqual({ id: 2 });
    expect(m.ss.getById).toHaveBeenCalledWith('2');
  });
  it('POST / requires name and segmentLabel', async () => {
    expect((await call('POST', '/')).status).toBe(400);
    expect((await call('POST', '/', { name: 'n' })).status).toBe(400);
    expect((await call('POST', '/', { segmentLabel: 's' })).status).toBe(400);
    expect(m.ss.create).not.toHaveBeenCalled();
  });
  it('POST / 201 and only whitelisted fields are forwarded', async () => {
    m.ss.create.mockResolvedValue({ id: 3 });
    const r = await call('POST', '/', { name: 'n', segmentLabel: 's', channels: ['email'], isAdmin: true });
    expect(r.status).toBe(201);
    expect(m.ss.create).toHaveBeenCalledWith({ name: 'n', description: undefined, segmentLabel: 's', channels: ['email'], flowSteps: undefined });
  });
  it('PUT /:id 404 when nothing updated, 200 otherwise', async () => {
    m.ss.update.mockResolvedValue(null);
    expect((await call('PUT', '/4', {})).status).toBe(404);
    m.ss.update.mockResolvedValue({ id: 4 });
    const r = await call('PUT', '/4', { name: 'z' });
    expect(r.status).toBe(200);
    expect(m.ss.update).toHaveBeenLastCalledWith('4', { name: 'z' });
  });
  it('GET /segment/:label decodes the label', async () => {
    m.ss.getBySegment.mockResolvedValue([]);
    await call('GET', `/segment/${encodeURIComponent("VIP'; --")}`);
    expect(m.ss.getBySegment).toHaveBeenCalledWith("VIP'; --");
  });
  it('POST /:id/optimize 404 / 200 / 500', async () => {
    m.optimizeStrategy.mockResolvedValue(null);
    expect((await call('POST', '/5/optimize')).status).toBe(404);
    m.optimizeStrategy.mockResolvedValue({ ok: 1 });
    expect((await call('POST', '/5/optimize')).body).toEqual({ success: true, data: { ok: 1 } });
    expect(m.optimizeStrategy).toHaveBeenLastCalledWith(5);
    m.optimizeStrategy.mockRejectedValue(new Error('ai'));
    expect((await call('POST', '/5/optimize')).status).toBe(500);
  });
});
