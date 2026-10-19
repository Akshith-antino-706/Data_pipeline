import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));

import analyticsRouter from '../src/routes/analytics.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', analyticsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

beforeEach(() => { mockQuery.mockReset(); });

const LIST_ROUTES = [
  '/chat-hourly', '/chat-daily', '/scorecard', '/whatsapp-depts', '/email-depts', '/top-agents/whatsapp',
  '/top-agents/email', '/ticket-products', '/travel-services', '/travel-nationalities', '/travel-types',
  '/segments', '/segment-stats', '/channels',
];

describe('list endpoints', () => {
  for (const p of LIST_ROUTES) {
    it(`GET ${p} returns the rows array`, async () => {
      mockQuery.mockResolvedValue({ rows: [{ a: 1 }, { a: 2 }] });
      const r = await fetch(base + p);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual([{ a: 1 }, { a: 2 }]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
    it(`GET ${p} → 500 when the query fails`, async () => {
      mockQuery.mockRejectedValue(new Error('relation does not exist'));
      const r = await fetch(base + p);
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: 'relation does not exist' });
    });
  }
  it('ignores query-string input entirely (no params reach SQL)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await fetch(`${base}/channels?name=${encodeURIComponent("'; DROP TABLE channels;--")}`).then(r => r.text());
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM channels ORDER BY name');
  });
});

describe('GET /kpis', () => {
  it('returns the single KPI row as an object', async () => {
    mockQuery.mockResolvedValue({ rows: [{ total_chats: '5' }] });
    const r = await fetch(`${base}/kpis`);
    expect(await r.json()).toEqual({ total_chats: '5' });
  });
  it('responds 200 with an empty body when no row comes back', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await fetch(`${base}/kpis`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('');
  });
  it('500 on error', async () => {
    mockQuery.mockRejectedValue(new Error('x'));
    expect((await fetch(`${base}/kpis`).then(async r => { await r.text(); return r; })).status).toBe(500);
  });
  it('unknown route → 404', async () => {
    const r = await fetch(`${base}/nope`);
    await r.text();
    expect(r.status).toBe(404);
  });
});
