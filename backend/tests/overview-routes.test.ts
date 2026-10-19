import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const { mockQuery, mockQueueCounts, mockLinkStats } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueueCounts: vi.fn(),
  mockLinkStats: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/queue/index.js', () => ({ queueCounts: mockQueueCounts }));
vi.mock('../src/services/UTMService.js', () => ({ default: { getUserLinkStats: mockLinkStats } }));

import overviewRouter, { parseRange } from '../src/routes/overview.js';

type Json = Record<string, unknown>;
let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use('/', overviewRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

beforeEach(() => {
  mockQuery.mockReset();
  mockQueueCounts.mockReset();
  mockLinkStats.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mockQueueCounts.mockResolvedValue({ waiting: 1, active: 2, delayed: 0, completed: 5, failed: 1, paused: 0 });
  mockLinkStats.mockResolvedValue({ campaigns: [], totals: undefined });
});

const get = async (p: string): Promise<{ status: number; body: Json }> => {
  const r = await fetch(base + p);
  return { status: r.status, body: (await r.json()) as Json };
};
const sqlCalls = (): string[] => mockQuery.mock.calls.map(c => String(c[0]));
const paramsCalls = (): unknown[][] => mockQuery.mock.calls.map(c => (Array.isArray(c[1]) ? c[1] as unknown[] : []));
const hasNaN = (v: unknown): boolean => JSON.stringify(v).includes('NaN') || (typeof v === 'object' && v !== null && Object.values(v).some(hasNaN)) || (typeof v === 'number' && Number.isNaN(v));

describe('GET /home', () => {
  it('returns all sections with zeros (not NaN) on empty data', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { status, body } = await get('/home');
    expect(status).toBe(200);
    expect(body.sentToday).toEqual({ available: true, email: 0, whatsapp: 0, sms: 0, total: 0 });
    expect(body.delivery7d).toEqual({ available: true, sent: 0, delivered: 0, deliveredPct: 0 });
    expect(body.conversions30d).toEqual({ available: true, count: 0 });
    expect(body.runningJourneys).toEqual({ available: true, total: 0, journeys: [] });
    expect(body.sendingToday).toEqual({ available: true, journeys: [], total: 0 });
    const series = body.series14d as { available: boolean; days: { total: number }[] };
    expect(series.days).toHaveLength(14);
    expect(series.days.every(d => d.total === 0)).toBe(true);
    expect(hasNaN(body)).toBe(false);
  });

  it('sums channel counts from string rows', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('journey_flows jf WHERE jf.status')) return Promise.resolve({ rows: [{ journey_id: '7', name: 'J', status: 'active', joined: '12' }] });
      return Promise.resolve({ rows: [{ n: '3' }] });
    });
    const { body } = await get('/home');
    expect(body.sentToday).toMatchObject({ email: 3, whatsapp: 3, sms: 3, total: 9 });
    expect(body.delivery7d).toMatchObject({ sent: 9, delivered: 9, deliveredPct: 100 });
    expect(body.runningJourneys).toMatchObject({ available: true, journeys: [{ id: 7, name: 'J', status: 'active', joined: 12 }] });
  });

  it('one failing section is marked unavailable while the others still return', async () => {
    mockQuery.mockImplementation((sql: string) =>
      sql.includes('journey_entries') ? Promise.reject(new Error('relation does not exist')) : Promise.resolve({ rows: [{ n: '1' }] }));
    const { status, body } = await get('/home');
    expect(status).toBe(200);
    expect(body.conversions30d).toEqual({ available: false, reason: 'unavailable' });
    expect(body.runningJourneys).toEqual({ available: false, reason: 'unavailable' });
    expect(body.sendingToday).toEqual({ available: false, reason: 'unavailable' });
    expect(body.sentToday).toMatchObject({ available: true, total: 3 });
  });
});

describe('GET /insights', () => {
  it('returns totals, previous period, trend, funnel and journeys with zeros', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { status, body } = await get('/insights?from=2026-01-01&to=2026-01-10');
    expect(status).toBe(200);
    expect(body.range).toEqual({ from: '2026-01-01', to: '2026-01-10', days: 10 });
    expect(body.totals).toEqual({ available: true, sent: 0, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0 });
    expect(body.previous).toMatchObject({ available: true, from: '2025-12-22', to: '2025-12-31', sent: 0 });
    expect(body.funnel).toEqual({ available: true, channel: 'email', sent: 0, opened: 0, clicked: 0, converted: 0 });
    expect(body.weeklyTrend).toEqual({ available: true, weeks: [] });
    expect(body.journeys).toEqual({ available: true, rows: [] });
    expect(hasNaN(body)).toBe(false);
  });

  it('clamps bad dates and over-long ranges', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { body } = await get('/insights?from=garbage&to=2026-13-45');
    expect((body.range as { days: number }).days).toBe(30);
    const r = parseRange('2000-01-01', '2026-01-01');
    expect(r.days).toBe(366);
    const swapped = parseRange('2026-02-10', '2026-02-01');
    expect(swapped).toEqual({ from: '2026-02-01', to: '2026-02-01', days: 1 });
  });

  it('computes journey rates and survives a failing section', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('WITH s AS')) return Promise.resolve({ rows: [{ journey_id: '5', name: 'Welcome', status: 'active', sent: '10', opened: '4', clicked: '1', unsubscribed: '0' }] });
      if (sql.includes('unsubscribe_log')) return Promise.reject(new Error('boom'));
      return Promise.resolve({ rows: [] });
    });
    const { body } = await get('/insights');
    expect(body.journeys).toEqual({ available: true, rows: [{ id: 5, name: 'Welcome', status: 'active', sent: 10, opened: 4, clicked: 1, unsubscribed: 0, openRate: 40, clickRate: 10 }] });
    expect(body.totals).toEqual({ available: false, reason: 'unavailable' });
    expect(body.funnel).toMatchObject({ available: true });
  });
});

describe('GET /status', () => {
  it('returns data sources, queues and failed sends', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('sync_metadata')) return Promise.resolve({ rows: [{ table_name: 'bookings', sync_status: 'success', last_synced_at: '2026-10-19T00:00:00Z', rows_synced: 10, sync_duration_ms: null, error_message: null, updated_at: null }] });
      return Promise.resolve({ rows: [{ channel: 'sms', id: '9', recipient: '971500', reason: 'bad', ts: '2026-10-19T01:00:00Z', journey_id: null }] });
    });
    const { body } = await get('/status');
    expect(body.dataSources).toEqual({ available: true, sources: [{ name: 'bookings', status: 'success', lastSyncedAt: '2026-10-19T00:00:00Z', lastRunAt: null, rows: 10, durationMs: 0, error: null }] });
    const queues = body.queues as { available: boolean; queues: { channel: string; waiting: number }[] };
    expect(queues.available).toBe(true);
    expect(queues.queues.map(q => q.channel)).toEqual(['email', 'whatsapp', 'sms', 'rcs', 'welcome', 'gtmJourney']);
    expect(body.failedSends).toEqual({ available: true, rows: [{ channel: 'sms', id: 9, recipient: '971500', reason: 'bad', time: '2026-10-19T01:00:00Z', journeyId: null }] });
  });

  it('queues unavailable when Redis is down, DB sections still return', async () => {
    mockQueueCounts.mockRejectedValue(new Error('ECONNREFUSED'));
    mockQuery.mockResolvedValue({ rows: [] });
    const { status, body } = await get('/status');
    expect(status).toBe(200);
    expect(body.queues).toEqual({ available: false, reason: 'unavailable' });
    expect(body.dataSources).toEqual({ available: true, sources: [] });
    expect(body.failedSends).toEqual({ available: true, rows: [] });
  });
});

describe('GET /messages', () => {
  it('returns paged unified log with total', async () => {
    mockQuery.mockImplementation((sql: string) => sql.includes(' AS total')
      ? Promise.resolve({ rows: [{ total: '42' }] })
      : Promise.resolve({ rows: [{ channel: 'email', id: '1', recipient: 'a@b.c', contact_name: null, label: 'Hi', status: 'sent', error: null, journey_id: '3', node_id: 'n1', ts: '2026-10-19T00:00:00Z', opened_at: null, clicked_at: null }] }));
    const { body } = await get('/messages');
    expect(body).toMatchObject({ page: 1, limit: 50, days: 30, channel: 'all', total: 42 });
    expect(body.messages).toEqual({ available: true, rows: [{ channel: 'email', id: 1, recipient: 'a@b.c', contactName: null, label: 'Hi', status: 'sent', error: null, journeyId: 3, nodeId: 'n1', time: '2026-10-19T00:00:00Z', openedAt: null, clickedAt: null }] });
  });

  it('clamps page/limit and ignores invalid channel/status/journeyId', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { body } = await get('/messages?limit=99999&page=-3&channel=fax&status=evil&journeyId=1abc&days=5000');
    expect(body).toMatchObject({ page: 1, limit: 200, days: 90, channel: 'all', total: 0 });
    for (const params of paramsCalls()) expect(params).not.toContain('evil');
  });

  it('applies filters as bound parameters', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await get(`/messages?channel=sms&status=failed&journeyId=12&q=${encodeURIComponent("x'; DROP TABLE t;--")}&page=2&limit=10`);
    const sql = sqlCalls().join('\n');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('email_send_log');
    expect(paramsCalls()[0]).toEqual([30, 'failed', 12, "%x'; DROP TABLE t;--%", 20, 10, 10]);
  });

  it('total null when the count section fails', async () => {
    mockQuery.mockImplementation((sql: string) => sql.includes(' AS total') ? Promise.reject(new Error('timeout')) : Promise.resolve({ rows: [] }));
    const { status, body } = await get('/messages');
    expect(status).toBe(200);
    expect(body.total).toBeNull();
    expect(body.messages).toEqual({ available: true, rows: [] });
  });
});

describe('GET /website', () => {
  it('fills every day with zeros and reuses UTMService', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { body } = await get('/website?from=2026-10-01&to=2026-10-03');
    expect(body.eventsPerDay).toEqual({ available: true, days: [{ date: '2026-10-01', events: 0 }, { date: '2026-10-02', events: 0 }, { date: '2026-10-03', events: 0 }] });
    expect(body.lastHour).toEqual({ available: true, count: 0 });
    expect(body.utmLinks).toEqual({ available: true, totals: { links: 0, clickedLinks: 0, clicks: 0, campaigns: 0, uniqueUsers: 0 }, campaigns: [] });
    expect(mockLinkStats).toHaveBeenCalledTimes(1);
    expect(hasNaN(body)).toBe(false);
  });

  it('UTM failure does not break GTM sections', async () => {
    mockLinkStats.mockRejectedValue(new Error('no table'));
    mockQuery.mockResolvedValue({ rows: [{ event_name: 'page_view', count: '5', unique_users: '2', page_url: '/x', n: '1', d: '2026-10-01' }] });
    const { body } = await get('/website?from=2026-10-01&to=2026-10-01');
    expect(body.utmLinks).toEqual({ available: false, reason: 'unavailable' });
    expect(body.topEvents).toEqual({ available: true, events: [{ name: 'page_view', count: 5, uniqueUsers: 2 }] });
    expect(body.topPages).toEqual({ available: true, pages: [{ url: '/x', count: 5 }] });
  });
});

describe('read-only SQL', () => {
  it('every SQL sent through the pool starts with SELECT or WITH', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    for (const p of ['/home', '/insights', '/status', '/messages?channel=email&status=opened&q=a', '/messages', '/website']) await get(p);
    const sqls = sqlCalls();
    expect(sqls.length).toBeGreaterThan(20);
    for (const s of sqls) expect(s.trimStart()).toMatch(/^(SELECT|WITH)\b/i);
  });
});
