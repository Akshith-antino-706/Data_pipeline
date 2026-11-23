// raynaSync.ts routes. Postgres + MySQL + all sync services are mocked.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[]; rowCount?: number }
const { mockQuery, mysqlQuery, rayna, builder, daily } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
  mysqlQuery: vi.fn<(sql: string, params?: unknown[], pool?: string) => Promise<unknown[]>>(),
  rayna: {
    getSyncStatus: vi.fn<() => Promise<Record<string, unknown>[]>>(),
    getTableCounts: vi.fn<() => Promise<Record<string, number>>>(),
    ingestRecords: vi.fn<(r: unknown[]) => Promise<Record<string, unknown>>>(),
    ingestRecordsDedup: vi.fn<(r: unknown[]) => Promise<Record<string, unknown>>>(),
  },
  builder: { rebuild: vi.fn<() => Promise<Record<string, unknown>>>() },
  daily: { run: vi.fn<() => Promise<Record<string, unknown>>>() },
}));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery }));
vi.mock('../src/services/RaynaSyncService.js', () => ({ default: rayna }));
vi.mock('../src/services/UnifiedContactBuilder.js', () => ({ default: builder }));
vi.mock('../src/services/DailyBillingSync.js', () => ({ default: daily }));

import raynaRouter, { clearMappingStatsCache, MAPPING_STATS_TTL_MS } from '../src/routes/raynaSync.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', raynaRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

// One generic row that satisfies every aggregate the mapping-stats handler reads.
const GENERIC_ROW = {
  // unified_contacts pass
  total_all: '20', total_customers: '10', customers_with_bookings: '4', with_email: '9', with_mobile: '6',
  // per rayna_* pass
  total: '5', mapped: '3', latest: '2026-10-20T01:00:00.000Z',
  // chats / sync_metadata
  count: '7', table_name: 'chats_sync', last_synced_at: '2026-10-19T03:30:00.000Z', rows_synced: 12, sync_status: 'success', error_message: null, sync_duration_ms: 800,
};
beforeEach(() => {
  vi.clearAllMocks();
  clearMappingStatsCache();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [GENERIC_ROW] });
  mysqlQuery.mockResolvedValue([]);
  builder.rebuild.mockResolvedValue({ contacts: 1 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

interface Body { success?: boolean; error?: string; [k: string]: unknown }
async function call<T = Body>(path: string, method = 'GET', raw?: string): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method };
  if (raw !== undefined) { init.body = raw; init.headers = { 'content-type': 'application/json' }; }
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json() as T };
}

describe('GET /status', () => {
  it('overrides stale rayna_* rows with fresh dates and leaves others alone', async () => {
    rayna.getSyncStatus.mockResolvedValue([
      { table_name: 'rayna_tours', sync_status: 'error', error_message: 'billno', last_synced_at: 'old' },
      { table_name: 'rayna_flights', sync_status: 'error', error_message: 'billno', last_synced_at: 'old' },
      { table_name: 'chats', sync_status: 'error', error_message: 'keep' },
    ]);
    rayna.getTableCounts.mockResolvedValue({ rayna_tours: 3 });
    mockQuery.mockResolvedValue({ rows: [
      { t: 'rayna_tours', latest: '2026-10-01T00:00:00.000Z' },
      { t: 'rayna_hotels', latest: '2026-10-05T00:00:00.000Z' },
      { t: 'rayna_flights', latest: null },
    ] });
    const r = await call<{ tables: Record<string, unknown>[]; counts: unknown }>('/status');
    expect(r.status).toBe(200);
    expect(r.body.tables[0]).toMatchObject({ sync_status: 'success', error_message: null, last_synced_at: '2026-10-01T00:00:00.000Z' });
    // empty table falls back to the aggregate max
    expect(r.body.tables[1]).toMatchObject({ last_synced_at: '2026-10-05T00:00:00.000Z', sync_status: 'success' });
    expect(r.body.tables[2]).toEqual({ table_name: 'chats', sync_status: 'error', error_message: 'keep' });
  });
  it('fresh-date query failing keeps stale values', async () => {
    rayna.getSyncStatus.mockResolvedValue([{ table_name: 'rayna_tours', last_synced_at: 'old' }]);
    rayna.getTableCounts.mockResolvedValue({});
    mockQuery.mockRejectedValue(new Error('pg'));
    const r = await call<{ tables: Record<string, unknown>[] }>('/status');
    expect(r.body.tables[0].last_synced_at).toBe('old');
  });
  it('service throwing → 500', async () => {
    rayna.getSyncStatus.mockRejectedValue(new Error('x'));
    expect((await call('/status')).status).toBe(500);
  });
});

describe('GET /mapping-stats', () => {
  interface Stats { overall: { totalCustomers: number; matchRate: string | number }; coverage: { tours: { total: number; mapped: number; lastDataAt: string | null } }; cronJobs: { name: string; nextRun: string | null; meta: { last_synced_at?: string } | null; sourceLatestAt?: string | null }[]; dataOverview: Record<string, number>; mysqlStatus: { table_name: string }[]; cached?: boolean; stale?: boolean }
  it('returns the aggregate payload with next-run times', async () => {
    const r = await call<Stats>('/mapping-stats');
    expect(r.status).toBe(200);
    expect(r.body.overall).toMatchObject({ totalCustomers: 10, customersWithBookings: 4, matchRate: '40.00' });
    expect(r.body.coverage.tours).toEqual({ total: 5, mapped: 3, lastDataAt: '2026-10-20T01:00:00.000Z' });
    expect(r.body.cronJobs.length).toBeGreaterThan(10);
    for (const j of r.body.cronJobs) expect(Number.isNaN(Date.parse(String(j.nextRun)))).toBe(false);
    expect(r.body.dataOverview).toMatchObject({ users: 10, totalUsers: 20, uniqueEmails: 9, phones: 6, travelBookings: 30, chats: 7, tours: 5 });
    // Daily billing freshness comes from the rayna_* MAX(created_at), not sync_metadata.
    const billing = r.body.cronJobs.find(j => j.name === 'daily_billing_sync');
    expect(billing?.meta?.last_synced_at).toBe('2026-10-20T01:00:00.000Z');
    // Chats-related sync_metadata rows are carried as mysqlStatus.
    expect(r.body.mysqlStatus.map(m => m.table_name)).toEqual(['chats_sync']);
    expect(mysqlQuery).toHaveBeenCalledTimes(3);
    expect(r.body.cached).toBeUndefined();
  });
  it('runs one query per source table plus one each for contacts, chats and sync_metadata', async () => {
    await call('/mapping-stats');
    const sqls = mockQuery.mock.calls.map(c => c[0]);
    expect(sqls.filter(q => q.includes('FROM unified_contacts')).length).toBe(1);
    for (const t of ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_packages', 'rayna_others']) {
      expect(sqls.filter(q => q.includes(`FROM ${t}`)).length).toBe(1);
    }
    expect(sqls.filter(q => q.includes('FROM chats')).length).toBe(1);
    expect(sqls.filter(q => q.includes('FROM sync_metadata')).length).toBe(1);
    expect(sqls.length).toBe(9);
    for (const q of sqls) expect(/^\s*SELECT/i.test(q)).toBe(true);
  });
  it('serves the cached payload within the TTL and recomputes with ?fresh=1', async () => {
    await call('/mapping-stats');
    const n = mockQuery.mock.calls.length;
    const second = await call<Stats>('/mapping-stats');
    expect(second.body.cached).toBe(true);
    expect(mockQuery.mock.calls.length).toBe(n);
    const third = await call<Stats>('/mapping-stats?fresh=1');
    expect(third.body.cached).toBeUndefined();
    expect(mockQuery.mock.calls.length).toBe(n * 2);
  });
  it('serves a stale payload immediately and refreshes in the background after the TTL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await call('/mapping-stats');
      vi.setSystemTime(Date.now() + MAPPING_STATS_TTL_MS + 1000);
      const n = mockQuery.mock.calls.length;
      const r = await call<Stats>('/mapping-stats');
      expect(r.body.stale).toBe(true);
      expect(mockQuery.mock.calls.length).toBeGreaterThan(n);
    } finally {
      vi.useRealTimers();
    }
  });
  it('caches per business type', async () => {
    await call('/mapping-stats?businessType=B2B');
    const n = mockQuery.mock.calls.length;
    await call('/mapping-stats?businessType=B2C');
    expect(mockQuery.mock.calls.length).toBeGreaterThan(n);
  });
  it('a slow MySQL source is time-boxed and the page still answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mysqlQuery.mockImplementation(() => new Promise(() => {}));
      const pending = call<Stats>('/mapping-stats');
      await vi.advanceTimersByTimeAsync(3_500);
      const r = await pending;
      expect(r.status).toBe(200);
      const chats = r.body.cronJobs.find(j => j.name === 'chats_sync');
      expect(chats?.sourceLatestAt ?? null).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('a sync_metadata read failure only empties the job metadata', async () => {
    mockQuery.mockImplementation(async (sql: string) => sql.includes('sync_metadata') ? Promise.reject(new Error('no table')) : { rows: [GENERIC_ROW] });
    const r = await call<Stats>('/mapping-stats');
    expect(r.status).toBe(200);
    expect(r.body.mysqlStatus).toEqual([]);
    expect(r.body.cronJobs.find(j => j.name === 'chats_sync')?.meta).toBeNull();
  });
  it('B2B filter is applied', async () => {
    await call('/mapping-stats?businessType=B2B');
    expect(mockQuery.mock.calls.some(c => c[0].includes("contact_type = 'B2B'"))).toBe(true);
    expect(mockQuery.mock.calls.some(c => c[0].includes("is_b2b = '1'"))).toBe(true);
  });
  it('an injection string as businessType is never interpolated', async () => {
    const evil = "B2B' OR '1'='1";
    await call(`/mapping-stats?businessType=${encodeURIComponent(evil)}`);
    for (const [sql] of mockQuery.mock.calls) expect(sql).not.toContain(evil);
  });
  it('remote MySQL failures are tolerated', async () => {
    mysqlQuery.mockRejectedValue(new Error('mysql down'));
    expect((await call('/mapping-stats')).status).toBe(200);
  });
  it('zero customers gives matchRate 0', async () => {
    mockQuery.mockResolvedValue({ rows: [{ ...GENERIC_ROW, total_customers: '0', customers_with_bookings: '0' }] });
    expect((await call<Stats>('/mapping-stats')).body.overall.matchRate).toBe(0);
  });
  it('a core aggregate failing → 500', async () => {
    mockQuery.mockRejectedValue(new Error('pg down'));
    expect((await call('/mapping-stats')).status).toBe(500);
  });
});

describe('POST endpoints', () => {
  it('refresh-mapping runs the mapping SQL via the mocked query', async () => {
    const r = await call('/refresh-mapping', 'POST');
    expect(r.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0].length).toBeGreaterThan(0);
  });
  it('refresh-mapping query failure → 500', async () => {
    mockQuery.mockRejectedValue(new Error('pg'));
    expect((await call('/refresh-mapping', 'POST')).status).toBe(500);
  });

  for (const ep of ['ingest', 'ingest-dedup'] as const) {
    const svcFn = ep === 'ingest' ? rayna.ingestRecords : rayna.ingestRecordsDedup;
    it(`${ep}: empty body / object / empty array → 400`, async () => {
      expect((await call(`/${ep}`, 'POST')).status).toBe(400);
      expect((await call(`/${ep}`, 'POST', '{}')).status).toBe(400);
      expect((await call(`/${ep}`, 'POST', '[]')).status).toBe(400);
      expect(svcFn).not.toHaveBeenCalled();
      expect(builder.rebuild).not.toHaveBeenCalled();
    });
    it(`${ep}: invalid JSON → 400`, async () => {
      const r = await fetch(`${base}/${ep}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[{' });
      expect(r.status).toBe(400);
    });
    it(`${ep}: ingests then rebuilds contacts`, async () => {
      svcFn.mockResolvedValue({ inserted: 2 });
      const recs = [{ BillNo: "1'; DROP TABLE rayna_tours;--" }, { BillNo: '2' }];
      const r = await call(`/${ep}`, 'POST', JSON.stringify(recs));
      expect(r.body).toEqual({ success: true, inserted: 2 });
      expect(svcFn).toHaveBeenCalledWith(recs);
      expect(builder.rebuild).toHaveBeenCalledTimes(1);
    });
    it(`${ep}: service throwing → 500, no rebuild`, async () => {
      svcFn.mockRejectedValue(new Error('bad record'));
      expect((await call(`/${ep}`, 'POST', '[{}]')).status).toBe(500);
      expect(builder.rebuild).not.toHaveBeenCalled();
    });
  }

  it('rebuild-contacts / daily-sync success + failure', async () => {
    expect((await call('/rebuild-contacts', 'POST')).body).toEqual({ success: true, contacts: 1 });
    builder.rebuild.mockRejectedValue(new Error('x'));
    expect((await call('/rebuild-contacts', 'POST')).status).toBe(500);
    daily.run.mockResolvedValue({ rows: 3 });
    expect((await call('/daily-sync', 'POST')).body).toEqual({ success: true, rows: 3 });
    daily.run.mockRejectedValue(new Error('api'));
    expect((await call('/daily-sync', 'POST')).status).toBe(500);
  });
});
