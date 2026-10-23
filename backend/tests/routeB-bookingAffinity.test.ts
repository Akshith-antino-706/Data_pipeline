import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  ensureTables: vi.fn(), getSummary: vi.fn(), getTopProducts: vi.fn(), searchProducts: vi.fn(),
  getCustomers: vi.fn(), getCustomersCsv: vi.fn(), getCustomerDetail: vi.fn(), isRunning: vi.fn(), build: vi.fn(), getStatus: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/BookingAffinityService.js', () => ({
  default: m, SERVICES: ['tours', 'packages', 'hotels', 'visas', 'flights', 'others'],
}));

import router from '../src/routes/bookingAffinity.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/ba', router);
  app.use((err: Error, _req: Request, res: ExResponse, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ba`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.ensureTables.mockResolvedValue(undefined);
});
const get = (p: string): Promise<Response> => fetch(`${base}${p}`);
type Filters = Record<string, unknown>;

describe('bookingAffinity.ts', () => {
  it('500s every request when ensureTables fails', async () => {
    m.ensureTables.mockRejectedValue(new Error('ddl'));
    expect((await get('/summary')).status).toBe(500);
    expect(m.getSummary).not.toHaveBeenCalled();
  });
  it('status: build status only, no counts', async () => {
    m.getStatus.mockResolvedValue({ status: 'running', builtAt: null });
    expect(await (await get('/status')).json()).toEqual({ success: true, status: 'running', builtAt: null });
    expect(m.getSummary).not.toHaveBeenCalled();
    expect(m.getCustomers).not.toHaveBeenCalled();
  });
  it('summary: default filters', async () => {
    m.getSummary.mockResolvedValue({ total: 1 });
    expect(await (await get('/summary')).json()).toEqual({ success: true, total: 1 });
    expect(m.getSummary).toHaveBeenCalledWith(expect.objectContaining({
      excludeBulk: false, view: 'service', service: null, product: null, search: null,
    }));
  });
  it('parses excludeBulk, view, valid service', async () => {
    m.getSummary.mockResolvedValue({});
    await get('/summary?excludeBulk=true&view=product&service=hotels');
    expect(m.getSummary).toHaveBeenLastCalledWith(expect.objectContaining({ excludeBulk: true, view: 'product', service: 'hotels' }));
    await get('/summary?excludeBulk=yes&view=bogus&service=DROP%20TABLE');
    expect(m.getSummary).toHaveBeenLastCalledWith(expect.objectContaining({ excludeBulk: false, view: 'service', service: null }));
  });
  it('search is trimmed and capped at 100 chars', async () => {
    m.getCustomers.mockResolvedValue({ data: [] });
    await get(`/customers?search=${encodeURIComponent(`  ${'a'.repeat(500)}  `)}`);
    const f = m.getCustomers.mock.calls[0][0] as Filters;
    expect(f.search).toBe('a'.repeat(100));
  });
  it('top-products forwards raw limit', async () => {
    m.getTopProducts.mockResolvedValue([]);
    await get('/top-products?limit=99999999');
    expect(m.getTopProducts.mock.calls[0][1]).toBe('99999999');
  });
  it('products search capped; empty → null', async () => {
    m.searchProducts.mockResolvedValue([]);
    await get('/products');
    expect(m.searchProducts).toHaveBeenLastCalledWith(null, undefined);
    await get(`/products?search=${'b'.repeat(200)}&limit=5`);
    expect(m.searchProducts).toHaveBeenLastCalledWith('b'.repeat(100), '5');
  });
  it('customers.csv sets CSV headers', async () => {
    m.getCustomersCsv.mockResolvedValue('a,b\n1,2');
    const r = await get('/customers.csv');
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('customer_affinity.csv');
    expect(await r.text()).toBe('a,b\n1,2');
  });
  it('customers/:id 400 for non-numeric, 404 when missing, 200 found', async () => {
    expect((await get('/customers/abc')).status).toBe(400);
    expect(m.getCustomerDetail).not.toHaveBeenCalled();
    m.getCustomerDetail.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 5 });
    expect((await get('/customers/5')).status).toBe(404);
    expect(await (await get('/customers/5')).json()).toEqual({ success: true, id: 5 });
  });
  it('customers/:id with "12abc" is parsed leniently to 12', async () => {
    m.getCustomerDetail.mockResolvedValue({ id: 12 });
    expect((await get('/customers/12abc')).status).toBe(200);
    expect(m.getCustomerDetail).toHaveBeenCalledWith(12);
  });
  it('customers 500s on service error', async () => {
    m.getCustomers.mockRejectedValue(new Error('x'));
    expect((await get('/customers')).status).toBe(500);
  });
  it('rebuild: 202 starts a build; already running → started:false', async () => {
    m.isRunning.mockReturnValue(false);
    m.build.mockRejectedValue(new Error('background fail is swallowed'));
    const r = await fetch(`${base}/rebuild`, { method: 'POST' });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ success: true, started: true });
    m.isRunning.mockReturnValue(true);
    m.build.mockClear();
    const r2 = await fetch(`${base}/rebuild`, { method: 'POST' });
    expect((await r2.json() as { started: boolean }).started).toBe(false);
    expect(m.build).not.toHaveBeenCalled();
  });
});
