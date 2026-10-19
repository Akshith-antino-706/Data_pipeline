import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const cs = vi.hoisted(() => ({
  getAll: vi.fn(), getPerformanceSummary: vi.fn(), getById: vi.fn(), create: vi.fn(), execute: vi.fn(), processQueue: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/CampaignService.js', () => ({ CampaignService: cs }));

import campaignsRouter from '../src/routes/campaigns.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', campaignsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; data?: unknown; error?: string; rows?: unknown[] }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
beforeEach(() => { for (const f of Object.values(cs)) f.mockReset(); });

const valid = { name: 'C', segmentLabel: 'S', channel: 'email', templateId: 3 };

describe('GET /', () => {
  it('spreads the service result and parses paging', async () => {
    cs.getAll.mockResolvedValue({ rows: [1], total: 1 });
    const r = await call('GET', '/?status=draft&channel=email&page=2&limit=5');
    expect(r.body).toEqual({ success: true, rows: [1], total: 1 });
    expect(cs.getAll).toHaveBeenCalledWith({ status: 'draft', channel: 'email', page: 2, limit: 5 });
  });
  it('defaults non-numeric paging', async () => {
    cs.getAll.mockResolvedValue({});
    await call('GET', '/?page=-x&limit=abc');
    expect(cs.getAll).toHaveBeenCalledWith({ status: undefined, channel: undefined, page: 1, limit: 20 });
  });
  it('500 on service error', async () => {
    cs.getAll.mockRejectedValue(new Error('x'));
    expect((await call('GET', '/')).status).toBe(500);
  });
});

describe('GET /performance', () => {
  it('is routed before /:id', async () => {
    cs.getPerformanceSummary.mockResolvedValue({ sent: 1 });
    const r = await call('GET', '/performance');
    expect(r.body).toEqual({ success: true, data: { sent: 1 } });
    expect(cs.getById).not.toHaveBeenCalled();
  });
});

describe('GET /:id', () => {
  it('200 with data', async () => {
    cs.getById.mockResolvedValue({ id: 1 });
    expect((await call('GET', '/1')).body).toEqual({ success: true, data: { id: 1 } });
  });
  it('404 when missing; injection id is passed as a plain string', async () => {
    cs.getById.mockResolvedValue(null);
    const evil = "1' OR '1'='1";
    const r = await call('GET', `/${encodeURIComponent(evil)}`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, error: 'Campaign not found' });
    expect(cs.getById).toHaveBeenCalledWith(evil);
  });
});

describe('POST /', () => {
  it('201 on valid input', async () => {
    cs.create.mockResolvedValue({ id: 9 });
    const r = await call('POST', '/', { ...valid, extra: 'ignored' });
    expect(r.status).toBe(201);
    expect(cs.create).toHaveBeenCalledWith({ ...valid, strategyId: undefined, filterCriteria: undefined, scheduledAt: undefined });
  });
  it('400 on empty body', async () => {
    const r = await call('POST', '/');
    expect(r.status).toBe(400);
    expect(cs.create).not.toHaveBeenCalled();
  });
  for (const k of ['name', 'segmentLabel', 'channel', 'templateId'] as const) {
    it(`400 when ${k} is missing or empty`, async () => {
      expect((await call('POST', '/', { ...valid, [k]: '' })).status).toBe(400);
    });
  }
  it('500 when create throws', async () => {
    cs.create.mockRejectedValue(new Error('fk'));
    expect((await call('POST', '/', valid)).status).toBe(500);
  });
});

describe('POST /:id/execute and /process-queue', () => {
  it('execute parses the id', async () => {
    cs.execute.mockResolvedValue({ queued: 3 });
    const r = await call('POST', '/12/execute');
    expect(r.body).toEqual({ success: true, data: { queued: 3 } });
    expect(cs.execute).toHaveBeenCalledWith(12);
  });
  // FIXED (was BUG) (src/routes/campaigns.ts:53): non-numeric id becomes NaN and is executed instead of 400.
  it('execute rejects a non-numeric id with 400', async () => {
    cs.execute.mockResolvedValue({});
    expect((await call('POST', '/abc/execute')).status).toBe(400);
  });
  it('process-queue uses ?batch or default 100', async () => {
    cs.processQueue.mockResolvedValue({});
    await call('POST', '/process-queue?batch=7');
    expect(cs.processQueue).toHaveBeenLastCalledWith(7);
    await call('POST', '/process-queue?batch=zz');
    expect(cs.processQueue).toHaveBeenLastCalledWith(100);
  });
});
