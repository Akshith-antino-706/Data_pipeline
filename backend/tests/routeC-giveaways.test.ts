// Giveaway routes. The BullMQ queue helpers and the Redis connection are mocked.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const { enqueue, counts, recent, lrange } = vi.hoisted(() => ({
  enqueue: vi.fn<(p: Record<string, unknown>) => Promise<{ id: string }>>(),
  counts: vi.fn<() => Promise<Record<string, number>>>(),
  recent: vi.fn<(limit: number) => Promise<unknown[]>>(),
  lrange: vi.fn<(key: string, start: number, stop: number) => Promise<string[]>>(),
}));
vi.mock('../src/services/giveaway/giveawayQueue.js', () => ({
  enqueueGiveawayEmail: enqueue, giveawayQueueCounts: counts, recentGiveawayJobs: recent,
}));
vi.mock('../src/services/queue/index.js', () => ({ getConnection: () => ({ lrange }) }));

import giveawaysRouter from '../src/routes/giveaways.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', giveawaysRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  enqueue.mockResolvedValue({ id: 'job-1' });
  counts.mockResolvedValue({ waiting: 1 });
  recent.mockResolvedValue([]);
  lrange.mockResolvedValue([]);
});

interface Body { ok?: boolean; error?: string; jobId?: string; sample?: Record<string, unknown>; events?: unknown[]; counts?: unknown }
async function call(path: string, method = 'GET', body?: unknown, raw?: string): Promise<{ status: number; body: Body }> {
  const init: RequestInit = { method };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  if (init.body !== undefined) init.headers = { 'content-type': 'application/json' };
  const r = await fetch(`${base}${path}`, init);
  const text = await r.text();
  let parsed: Body = {};
  try { parsed = JSON.parse(text) as Body; } catch { /* non-JSON */ }
  return { status: r.status, body: parsed };
}

describe('POST /email', () => {
  it('no body → 400', async () => {
    expect((await call('/email', 'POST')).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('missing to.email → 400', async () => {
    expect((await call('/email', 'POST', { id: 'a', to: {} })).status).toBe(400);
    expect((await call('/email', 'POST', { to: { email: 'a@b.co' } })).status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('invalid JSON → 400', async () => {
    expect((await call('/email', 'POST', undefined, '{x')).status).toBe(400);
  });
  it('enqueues a valid message untouched (injection strings included)', async () => {
    const msg = { id: "g1'; DROP TABLE x;--", to: { email: 'a@b.co' }, subject: '<script>' };
    const r = await call('/email', 'POST', msg);
    expect(r.body).toEqual({ ok: true, queued: true, jobId: 'job-1' });
    expect(enqueue).toHaveBeenCalledWith(msg);
  });
  it('queue failure → 500', async () => {
    enqueue.mockRejectedValue(new Error('redis down'));
    const r = await call('/email', 'POST', { id: 'a', to: { email: 'a@b.co' } });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('redis down');
  });
});

describe('POST /email/test', () => {
  it('empty body enqueues a sensible sample', async () => {
    const r = await call('/email/test', 'POST');
    expect(r.status).toBe(200);
    const sample = enqueue.mock.calls[0][0];
    expect(sample.type).toBe('winner');
    expect(sample.to).toEqual({ email: 'test@example.com', name: 'Test User' });
    expect(String(sample.id)).toMatch(/^test-\d+$/);
  });
  it('honours overrides', async () => {
    await call('/email/test', 'POST', { id: 'x', type: 'loser', email: 'e@f.co', name: 'N' });
    expect(enqueue.mock.calls[0][0]).toMatchObject({ id: 'x', type: 'loser', to: { email: 'e@f.co', name: 'N' } });
  });
  it('queue failure → 500', async () => {
    enqueue.mockRejectedValue(new Error('x'));
    expect((await call('/email/test', 'POST')).status).toBe(500);
  });
});

describe('GET /stats, /log, /mq-log', () => {
  it('stats returns counts / 500 on error', async () => {
    expect((await call('/stats')).body.counts).toEqual({ waiting: 1 });
    counts.mockRejectedValue(new Error('x'));
    expect((await call('/stats')).status).toBe(500);
  });
  it('log clamps limit to 1..200', async () => {
    await call('/log?limit=9999');
    expect(recent).toHaveBeenLastCalledWith(200);
    await call('/log?limit=-4');
    expect(recent).toHaveBeenLastCalledWith(1);
    await call('/log');
    expect(recent).toHaveBeenLastCalledWith(50);
  });
  it('mq-log parses events and drops malformed entries', async () => {
    lrange.mockResolvedValue(['{"id":"a"}', '{broken', '{"id":"b"}']);
    const r = await call('/mq-log?limit=3');
    expect(r.body.events).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(lrange).toHaveBeenCalledWith('giveaway:mq:events', 0, 2);
  });
  it('mq-log redis failure → 500', async () => {
    lrange.mockRejectedValue(new Error('redis'));
    expect((await call('/mq-log')).status).toBe(500);
  });

  // FIXED (was BUG) (src/routes/giveaways.ts:74 and :86): parseInt('abc') is NaN and Math.min/Math.max
  // propagate NaN, so a non-numeric ?limit reaches BullMQ/Redis as NaN instead of a default.
  it('log falls back to a finite limit for ?limit=abc', async () => {
    await call('/log?limit=abc');
    expect(Number.isFinite(recent.mock.calls[0][0])).toBe(true);
  });
  it('mq-log falls back to a finite range for ?limit=abc', async () => {
    await call('/mq-log?limit=abc');
    expect(Number.isFinite(lrange.mock.calls[0][2])).toBe(true);
  });
});
