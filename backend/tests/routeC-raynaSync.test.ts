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

import raynaRouter from '../src/routes/raynaSync.js';

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
  total_mapped: '8', customers_with_bookings: '4', total_customers: '10',
  total_tours: '5', total_hotels: '1', total_visas: '1', total_flights: '0', total_packages: '0', total_others: '0',
  mapped_tours: '3', mapped_hotels: '1', mapped_visas: '0', mapped_flights: '0', mapped_packages: '0', mapped_others: '0',
  count: '7', c: '2', latest: null,
};
beforeEach(() => {
  vi.clearAllMocks();
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
  interface Stats { overall: { totalCustomers: number; matchRate: string | number }; coverage: { tours: { total: number; mapped: number } }; cronJobs: { name: string; nextRun: string | null }[]; dataOverview: Record<string, number> }
  it('returns the aggregate payload with next-run times', async () => {
    const r = await call<Stats>('/mapping-stats');
    expect(r.status).toBe(200);
    expect(r.body.overall).toMatchObject({ totalCustomers: 10, matchRate: '40.00' });
    expect(r.body.coverage.tours).toEqual({ total: 5, mapped: 3 });
    expect(r.body.cronJobs.length).toBeGreaterThan(10);
    for (const j of r.body.cronJobs) expect(Number.isNaN(Date.parse(String(j.nextRun)))).toBe(false);
    expect(r.body.dataOverview.users).toBe(7);
    expect(mysqlQuery).toHaveBeenCalledTimes(3);
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
