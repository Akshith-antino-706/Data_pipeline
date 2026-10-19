import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  enrichAllCustomers: vi.fn(), getEnrichmentStats: vi.fn(), cleanPhone: vi.fn(), cleanEmail: vi.fn(), inferGender: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/DataCleaningService.js', () => ({ DataCleaningService: m, default: m }));

import router from '../src/routes/enrichment.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/e', router);
  app.use((err: Error, _req: Request, res: ExResponse, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/e`;
});
afterAll(() => { server.close(); });
beforeEach(() => { for (const f of Object.values(m)) f.mockReset(); });
const postJson = (p: string, body?: unknown): Promise<Response> => fetch(`${base}${p}`, {
  method: 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('enrichment routes', () => {
  it('POST /run wraps the result; 500 on failure', async () => {
    m.enrichAllCustomers.mockResolvedValueOnce({ updated: 3 }).mockRejectedValueOnce(new Error('x'));
    expect(await (await postJson('/run')).json()).toEqual({ success: true, data: { updated: 3 } });
    expect((await postJson('/run')).status).toBe(500);
  });
  it('GET /stats', async () => {
    m.getEnrichmentStats.mockResolvedValue({ n: 1 });
    expect(await (await fetch(`${base}/stats`)).json()).toEqual({ success: true, data: { n: 1 } });
  });
  it('POST /preview adds inferred nationality/country from phone country info', async () => {
    m.cleanPhone.mockReturnValue({ cleaned: '+971', countryInfo: { nationality: 'Emirati', country: 'UAE' } });
    m.cleanEmail.mockReturnValue({ cleaned: 'a@x.com' });
    m.inferGender.mockReturnValue('male');
    const r = await postJson('/preview', { phone: '0501', email: 'A@x.com', name: 'Ali' });
    const body = await r.json() as { data: Record<string, unknown> };
    expect(body.data.inferredNationality).toBe('Emirati');
    expect(body.data.inferredCountry).toBe('UAE');
    expect(m.inferGender).toHaveBeenCalledWith('Ali');
  });
  it('POST /preview without country info omits inferred fields; empty body ok', async () => {
    m.cleanPhone.mockReturnValue(null);
    m.cleanEmail.mockReturnValue(null);
    m.inferGender.mockReturnValue(null);
    const body = await (await postJson('/preview', {})).json() as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty('inferredNationality');
    expect(m.cleanPhone).toHaveBeenCalledWith(undefined);
  });
  it('POST /preview 500s when a cleaner throws on a wrong type', async () => {
    m.cleanPhone.mockImplementation(() => { throw new TypeError('bad'); });
    expect((await postJson('/preview', { phone: { $ne: 1 } })).status).toBe(500);
  });
  // BUG enrichment.ts:25 — no body → destructuring undefined req.body → 500 instead of a handled response.
  it.fails('POST /preview with no body does not 500', async () => {
    m.cleanPhone.mockReturnValue(null);
    expect((await postJson('/preview')).status).toBeLessThan(500);
  });
});
