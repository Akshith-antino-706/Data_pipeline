import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  getCountPreview: vi.fn(), getAll: vi.fn(), create: vi.fn(), getById: vi.fn(),
  update: vi.fn(), delete: vi.fn(), getCustomers: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/CustomSegmentService.js', () => ({ default: m }));

import router from '../src/routes/customSegments.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/cs', router);
  app.use((err: Error, _req: Request, res: ExResponse, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cs`;
});
afterAll(() => { server.close(); });
beforeEach(() => { for (const f of Object.values(m)) f.mockReset(); });

const send = (method: string, p: string, body?: unknown): Promise<Response> => fetch(`${base}${p}`, {
  method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('POST /preview-count', () => {
  it('400s without a conditions array', async () => {
    for (const b of [{}, { conditions: 'x' }, { conditions: { a: 1 } }, { conditions: null }]) {
      expect((await send('POST', '/preview-count', b)).status, JSON.stringify(b)).toBe(400);
    }
    expect(m.getCountPreview).not.toHaveBeenCalled();
  });
  it('returns the count', async () => {
    m.getCountPreview.mockResolvedValue(12);
    const r = await send('POST', '/preview-count', { conditions: [], operator: 'OR' });
    expect(await r.json()).toEqual({ success: true, count: 12 });
    expect(m.getCountPreview).toHaveBeenCalledWith([], 'OR');
  });
  it('500s on service error', async () => {
    m.getCountPreview.mockRejectedValue(new Error('bad sql'));
    expect((await send('POST', '/preview-count', { conditions: [] })).status).toBe(500);
  });
  // BUG customSegments.ts:13 — no body → req.body undefined → destructure TypeError → 500, not 400.
  it.fails('400s (not 500) when there is no body at all', async () => {
    expect((await send('POST', '/preview-count')).status).toBe(400);
  });
});

describe('GET /', () => {
  it('passes ?status through', async () => {
    m.getAll.mockResolvedValue([]);
    expect(await (await send('GET', '/?status=draft')).json()).toEqual({ success: true, data: [] });
    expect(m.getAll).toHaveBeenCalledWith({ status: 'draft' });
  });
});

describe('POST /', () => {
  it('400s without name or conditions', async () => {
    for (const b of [{}, { name: 'x' }, { conditions: [] }, { name: '', conditions: [] }, { name: 'x', conditions: 'a' }]) {
      expect((await send('POST', '/', b)).status, JSON.stringify(b)).toBe(400);
    }
    expect(m.create).not.toHaveBeenCalled();
  });
  it('creates and only forwards known fields', async () => {
    m.create.mockResolvedValue({ id: 1 });
    const r = await send('POST', '/', { name: 'n', conditions: [], evil: 'x', id: 99 });
    expect(r.status).toBe(200);
    const arg = m.create.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe('n');
    expect(arg).not.toHaveProperty('evil');
    expect(arg).not.toHaveProperty('id');
  });
});

describe('/:id', () => {
  it('GET 404 when missing; non-numeric id becomes NaN', async () => {
    m.getById.mockResolvedValue(null);
    expect((await send('GET', '/abc')).status).toBe(404);
    expect(Number.isNaN(m.getById.mock.calls[0][0])).toBe(true);
  });
  it('GET returns data', async () => {
    m.getById.mockResolvedValue({ id: 4 });
    expect(await (await send('GET', '/4')).json()).toEqual({ success: true, data: { id: 4 } });
  });
  it('PUT 404 when missing / 200 when updated', async () => {
    m.update.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 2 });
    expect((await send('PUT', '/2', { name: 'x' })).status).toBe(404);
    expect((await send('PUT', '/2', { name: 'x' })).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(2, { name: 'x' });
  });
  it('DELETE calls the service; 500 on error', async () => {
    m.delete.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'));
    expect((await send('DELETE', '/9')).status).toBe(200);
    expect((await send('DELETE', '/9')).status).toBe(500);
    expect(m.delete).toHaveBeenCalledWith(9);
  });
  it('GET /:id/customers: defaults, 404, unclamped huge limit', async () => {
    m.getCustomers.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce(null).mockResolvedValueOnce({});
    expect(await (await send('GET', '/3/customers')).json()).toEqual({ success: true, data: [] });
    expect(m.getCustomers).toHaveBeenCalledWith(3, { page: 1, limit: 25, search: undefined });
    expect((await send('GET', '/3/customers')).status).toBe(404);
    await send('GET', '/3/customers?limit=10000000&page=x');
    expect(m.getCustomers).toHaveBeenLastCalledWith(3, { page: 1, limit: 10000000, search: undefined });
  });
});
