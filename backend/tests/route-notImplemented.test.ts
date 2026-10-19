import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Router } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const { mockQuery, recordEvent } = vi.hoisted(() => ({ mockQuery: vi.fn(), recordEvent: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/MySQLSyncService.js', () => ({ default: {} }));
vi.mock('../src/services/GTMService.js', () => ({ default: { recordEvent } }));
vi.mock('child_process', () => ({ spawn: vi.fn(() => { throw new Error('spawn must not be called in tests'); }) }));

import mysqlSyncRouter from '../src/routes/mysqlSync.js';
import gtmRouter from '../src/routes/gtm.js';

const servers: Server[] = [];
async function mount(router: Router): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  const s = app.listen(0, '127.0.0.1');
  servers.push(s);
  await once(s, 'listening');
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
let mysqlBase = '';
let gtmBase = '';
beforeAll(async () => { mysqlBase = await mount(mysqlSyncRouter); gtmBase = await mount(gtmRouter); });
afterAll(() => { for (const s of servers) s.close(); });

interface ErrorBody { success: boolean; error: string }

describe('unimplemented endpoints return 501', () => {
  for (const [label, url] of [
    ['mysqlSync GET /status', () => `${mysqlBase}/status`],
    ['mysqlSync GET /discover-schema', () => `${mysqlBase}/discover-schema`],
    ['gtm GET /tracking-bundle', () => `${gtmBase}/tracking-bundle`],
  ] as const) {
    it(label, async () => {
      const r = await fetch(url());
      expect(r.status).toBe(501);
      const body = await r.json() as ErrorBody;
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/not implemented/i);
    });
    it(`${label} ignores query strings`, async () => {
      expect((await fetch(`${url()}?x=1&y=%27%20OR%201%3D1`)).status).toBe(501);
    });
  }
  it('does not touch the DB', () => { expect(mockQuery).not.toHaveBeenCalled(); });
});

describe('gtm GET /events input handling', () => {
  it('falls back to limit=50 for non-numeric limit and parameterises eventName', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const evil = "x' OR '1'='1";
    const r = await fetch(`${gtmBase}/events?limit=abc&eventName=${encodeURIComponent(evil)}`);
    expect(r.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain(evil);
    expect(params).toEqual([evil, 50]);
  });

  it('500s with JSON when the DB fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    expect((await fetch(`${gtmBase}/events`)).status).toBe(500);
  });
});

describe('gtm POST /events', () => {
  it('returns 500 (not crash) when recording throws on an empty body', async () => {
    recordEvent.mockRejectedValueOnce(new Error('event_name required'));
    const r = await fetch(`${gtmBase}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(500);
  });

  it('rejects malformed JSON with a 4xx', async () => {
    const r = await fetch(`${gtmBase}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    expect(r.status).toBe(400);
    expect(recordEvent).toHaveBeenCalledTimes(1);
  });
});
