// chatheadWebhook.ts — one-to-one WhatsApp status webhook. DB and Redis mocked.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[] }
const { mockQuery, redis } = vi.hoisted(() => {
  const list: string[] = [];
  const multi = { lpush: vi.fn((_k: string, v: string) => { list.unshift(v); return multi; }), ltrim: vi.fn(() => multi), exec: vi.fn(() => Promise.resolve([])) };
  return {
    mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
    redis: { list, multi: vi.fn(() => multi), lrange: vi.fn((_k: string, s: number, e: number) => Promise.resolve(list.slice(s, e + 1))) },
  };
});
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/queue/index.js', () => ({ getConnection: () => redis }));

import webhookRouter, { parseEvents } from '../src/routes/chatheadWebhook.js';

const WAMID = 'wamid.HBgMOTE4NDEyMDE0NDcxFQIAERgSRDM5QkE4ODI1Q0E0NjM1RDgwAA==';
const EVENTS = [
  { type: 'status', status: 'sent', message_id: WAMID },
  { type: 'status', status: 'delivered', message_id: WAMID },
  { type: 'status', status: 'read', message_id: WAMID },
  { type: 'status', status: 'failed', message_id: WAMID, reason: 'reason text' },
];

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use('/api/webhooks/chathead',
    express.json(),
    express.text({ type: ['application/x-ndjson', 'application/jsonl'] }),
    webhookRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhooks/chathead`;
});
afterAll(() => { server.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  redis.list.length = 0;
  process.env.CHATHEAD_WEBHOOK_TOKEN = 'secret-token';
  mockQuery.mockReset().mockResolvedValue({ rows: [{ id: 7, moved: true }] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

const post = (body: string, type = 'application/json', token = 'secret-token') =>
  fetch(`${base}/wa-status?token=${token}`, { method: 'POST', headers: { 'Content-Type': type }, body });

describe('POST /api/webhooks/chathead/wa-status', () => {
  it('is off (503) until CHATHEAD_WEBHOOK_TOKEN is set, and rejects a wrong token (401)', async () => {
    delete process.env.CHATHEAD_WEBHOOK_TOKEN;
    expect((await post(JSON.stringify(EVENTS[0]))).status).toBe(503);
    process.env.CHATHEAD_WEBHOOK_TOKEN = 'secret-token';
    expect((await post(JSON.stringify(EVENTS[0]), 'application/json', 'nope')).status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('applies each sample event to whatsapp_send_log by wamid', async () => {
    for (const evt of EVENTS) {
      const r = await post(JSON.stringify(evt));
      expect(r.status).toBe(200);
      const j = await r.json() as { results: Array<{ result: string }> };
      expect(j.results[0].result).toBe('updated');
    }
    const params = mockQuery.mock.calls.map(c => c[1] as unknown[]);
    expect(params.map(p => [p[0], p[1]])).toEqual(EVENTS.map(e => [WAMID, e.status]));
    expect(params[3][2]).toBe('reason text');                 // failed carries its reason
    expect(params.map(p => p[4])).toEqual([1, 2, 3, 1.5]);   // forward-only ranks
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/WHERE wamid = \$1/);
  });

  it('accepts the file format: one JSON object per line', async () => {
    const body = EVENTS.map(e => JSON.stringify(e)).join('\n');
    const r = await post(body, 'application/x-ndjson');
    expect((await r.json() as { received: number }).received).toBe(4);
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('answers 200 for unknown wamids, flags bad events, and keeps every event for checking', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await post(JSON.stringify([EVENTS[1], { type: 'status', status: 'weird', message_id: WAMID }, { status: 'read' }]));
    expect(r.status).toBe(200);
    const j = await r.json() as { results: Array<{ result: string }> };
    expect(j.results.map(x => x.result)).toEqual(['unmatched', 'invalid', 'invalid']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const recent = await fetch(`${base}/wa-status/recent?token=secret-token`).then(x => x.json()) as { data: Array<{ result: string }> };
    expect(recent.data).toHaveLength(3);
  });

  it('a body that is not JSON is a 400', async () => {
    expect((await post('hello', 'application/x-ndjson')).status).toBe(400);
  });
});

describe('parseEvents', () => {
  it('reads an object, an array, and JSON lines', () => {
    expect(parseEvents(EVENTS[0])).toHaveLength(1);
    expect(parseEvents(EVENTS)).toHaveLength(4);
    expect(parseEvents(EVENTS.map(e => JSON.stringify(e)).join('\r\n'))).toHaveLength(4);
    expect(parseEvents('')).toBeNull();
  });
});
