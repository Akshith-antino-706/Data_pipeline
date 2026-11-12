import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';
import type { RegRecord, RegDbRow, RegSyncResult, RegSyncError } from '../src/types/syncRegistration.js';

type Result = { rows: unknown[]; rowCount?: number };
type QueryFn = (sql: string, params?: unknown[]) => Promise<Result>;

const m = vi.hoisted(() => ({
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>(),
  release: vi.fn(),
  poolQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>(),
  transaction: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.poolQuery, connect: m.connect },
  query: m.poolQuery,
  transaction: m.transaction,
}));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

import { runRegistrationDataSync } from '../src/crons/registrationDataSync.js';

const client = { query: m.clientQuery, release: m.release } as unknown as PoolClient;

// Fake DB state
let columns: Record<string, string[]>;
let dbRows: Record<string, RegDbRow[]>;
let api: Record<string, RegRecord[]>;
const fetchMock = vi.fn<typeof fetch>();

const clientImpl: QueryFn = async (sql, params) => {
  if (sql.startsWith('LOCK')) return { rows: [] };
  if (sql.includes('information_schema.columns')) {
    const t = String((params ?? [])[0]);
    return { rows: (columns[t] ?? []).map(column_name => ({ column_name })) };
  }
  const sel = /SELECT \* FROM (\w+)/.exec(sql);
  if (sel) return { rows: dbRows[sel[1]] ?? [] };
  return { rows: [], rowCount: 1 };
};

const ok = (records: RegRecord[], count = records.length): Response =>
  new Response(JSON.stringify({ data: { records, count } }), { status: 200 });

const calls = (re: RegExp) => m.clientQuery.mock.calls.filter(([sql]) => re.test(sql));
const isErr = (r: RegSyncResult | RegSyncError): r is RegSyncError => 'error' in r;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T21:00:00Z'));   // 01:00 on 20 Oct in Dubai
  columns = {
    affiliate_data: ['id', 'affiliateId', 'Name', 'Mobile', 'IsActive', 'CreatedDate', 'Email', 'City', 'Country'],
    guestuser_data: ['id', 'GuestUserId', 'Name'],
    agent_data: ['id', 'AgentID', 'Name'],
  };
  dbRows = {};
  api = {};
  m.clientQuery.mockReset().mockImplementation(clientImpl);
  m.poolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  m.release.mockReset();
  m.transaction.mockReset().mockImplementation(async (fn: (c: PoolClient) => Promise<unknown>) => fn(client));
  m.connect.mockReset().mockResolvedValue(client);
  fetchMock.mockReset().mockImplementation(async (_url, init) => {
    const { type } = JSON.parse(String(init?.body)) as { type: string };
    return ok(api[type] ?? []);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runRegistrationDataSync — window & API call', () => {
  it('uses the Dubai calendar day (not UTC) and a 7-day window, one POST per type', async () => {
    const r = await runRegistrationDataSync();
    expect(r.toDate).toBe('2026-10-20');
    expect(r.fromDate).toBe('2026-10-13');
    expect(r.dryRun).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { type: string; fromDate: string; toDate: string });
    expect(bodies.map(b => b.type)).toEqual(['affiliate', 'guestuser', 'agent']);
    for (const b of bodies) expect(b).toMatchObject({ fromDate: '2026-10-13', toDate: '2026-10-20' });
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
  });

  it('empty API result → zero counts, no transaction, success metadata written per type', async () => {
    const r = await runRegistrationDataSync();
    expect(r.results).toEqual([
      { type: 'affiliate', fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
      { type: 'guestuser', fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
      { type: 'agent', fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 },
    ]);
    expect(m.transaction).not.toHaveBeenCalled();
    const meta = m.poolQuery.mock.calls.filter(([sql]) => sql.includes('sync_metadata'));
    expect(meta.map(([, p]) => (p ?? [])[0])).toEqual(['registration_affiliate_sync', 'registration_guestuser_sync', 'registration_agent_sync']);
    expect(meta.every(([, p]) => (p ?? [])[2] === 'success')).toBe(true);
  });
});

describe('runRegistrationDataSync — inserts', () => {
  it('inserts new rows in the loader text format and locks the table', async () => {
    api.affiliate = [{
      AffiliateID: 101, name: 'Asha', mobile: ' +0971501234567 ', isactive: true,
      createddate: '2026-10-18T10:20:30.5', email: null, city: '50 123 4567', Unknown: 'x',
    }];
    const r = await runRegistrationDataSync();
    expect(r.results[0]).toEqual({ type: 'affiliate', fetched: 1, inserted: 1, updated: 0, unchanged: 0, skipped: 0 });
    expect(calls(/^LOCK TABLE affiliate_data IN SHARE ROW EXCLUSIVE MODE/)).toHaveLength(1);
    const [sql, params] = calls(/^INSERT INTO affiliate_data/)[0];
    expect(sql).toContain('"affiliateId", "Name", "Mobile", "IsActive", "CreatedDate", "Email", "City", synced_at');
    expect(sql).not.toContain('Unknown');
    expect(params).toEqual(['101', 'Asha', '971501234567', '1', '2026-10-18 10:20:30.500000', 'NULL', '50 123 4567']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('(ignored): Unknown'));
    const meta = m.poolQuery.mock.calls.find(([sql2, p]) => sql2.includes('sync_metadata') && (p ?? [])[0] === 'registration_affiliate_sync');
    expect(meta?.[1]).toEqual(['registration_affiliate_sync', 1, 'success', null, expect.any(Number)]);
  });

  it('chunks inserts at 200 rows per statement', async () => {
    api.agent = Array.from({ length: 450 }, (_, i) => ({ AgentID: i + 1, Name: `A${i}` }));
    const r = await runRegistrationDataSync();
    expect(r.results[2]).toMatchObject({ fetched: 450, inserted: 450 });
    const ins = calls(/^INSERT INTO agent_data/);
    expect(ins.map(([, p]) => (p ?? []).length)).toEqual([400, 400, 100]);
  });

  it('insert columns are the union of keys across the batch (missing → NULL)', async () => {
    api.affiliate = [
      { AffiliateID: 1, name: 'A' },
      { AffiliateID: 2, city: 'Dubai' },
    ];
    await runRegistrationDataSync();
    const [sql, params] = calls(/^INSERT INTO affiliate_data/)[0];
    expect(sql).toContain('"affiliateId", "Name", "City", synced_at');
    expect(params).toEqual(['1', 'A', 'NULL', '2', 'NULL', 'Dubai']);
  });
});

describe('runRegistrationDataSync — updates', () => {
  it('formatting-only differences are unchanged; real edits UPDATE by db id', async () => {
    dbRows.affiliate_data = [
      { id: '1', affiliateId: '101', Name: 'Asha', Mobile: '971501234567', IsActive: '1', CreatedDate: '2026-10-18 10:20:30' },
      { id: '2', affiliateId: '102', Name: 'Old', Mobile: 'NULL', IsActive: '0', CreatedDate: 'NULL' },
    ];
    api.affiliate = [
      { affiliateId: '101', Name: 'Asha', Mobile: '+971501234567', IsActive: 'true', CreatedDate: '2026-10-18T10:20:30' },
      { affiliateId: '102', Name: 'New', Mobile: '0501', IsActive: false, CreatedDate: null },
    ];
    const r = await runRegistrationDataSync();
    expect(r.results[0]).toMatchObject({ fetched: 2, inserted: 0, updated: 1, unchanged: 1, skipped: 0 });
    const [sql, params] = calls(/^UPDATE affiliate_data/)[0];
    expect(sql).toBe('UPDATE affiliate_data SET "Name" = $2, "Mobile" = $3, updated_at = now(), synced_at = now() WHERE id = $1');
    expect(params).toEqual(['2', 'New', '501']);
    expect(calls(/^INSERT/)).toHaveLength(0);
  });

  it('skips a row that would overwrite more than 3 non-empty values', async () => {
    dbRows.affiliate_data = [{ id: '9', affiliateId: '7', Name: 'a', Mobile: '1', Email: 'e', City: 'c', Country: 'k' }];
    api.affiliate = [{ affiliateId: '7', Name: 'b', Mobile: '2', Email: 'f', City: 'd', Country: 'k' }];
    const r = await runRegistrationDataSync();
    expect(r.results[0]).toMatchObject({ skipped: 1, updated: 0 });
    expect(calls(/^UPDATE/)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('would overwrite 4 values'));
  });

  it('exactly 3 overwrites is still applied', async () => {
    dbRows.affiliate_data = [{ id: '9', affiliateId: '7', Name: 'a', Mobile: '1', Email: 'e' }];
    api.affiliate = [{ affiliateId: '7', Name: 'b', Mobile: '2', Email: 'f' }];
    const r = await runRegistrationDataSync();
    expect(r.results[0]).toMatchObject({ updated: 1, skipped: 0 });
  });
});

describe('runRegistrationDataSync — failures are isolated per type', () => {
  it('duplicate ids in the table → that type errors, others still run', async () => {
    dbRows.guestuser_data = [{ id: '1', GuestUserId: '5' }, { id: '2', GuestUserId: '5' }];
    api.guestuser = [{ GuestUserId: 5, Name: 'x' }];
    api.agent = [{ AgentID: 1, Name: 'y' }];
    const r = await runRegistrationDataSync();
    const g = r.results[1];
    expect(isErr(g) && g.error).toContain('guestuser_data has duplicate GuestUserId 5');
    expect(r.results[2]).toMatchObject({ type: 'agent', inserted: 1 });
    const meta = m.poolQuery.mock.calls.find(([, p]) => (p ?? [])[0] === 'registration_guestuser_sync');
    expect(meta?.[1]).toEqual(['registration_guestuser_sync', 0, 'error', expect.stringContaining('duplicate'), expect.any(Number)]);
  });

  it('records without the key field → error', async () => {
    api.agent = [{ Name: 'nokey' }];
    const r = await runRegistrationDataSync();
    const a = r.results[2];
    expect(isErr(a) && a.error).toBe('API records have no "AgentID" field');
  });

  it('HTTP errors retry 3 times (5s, 10s backoff) then report the error', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(new Date('2026-10-19T21:00:00Z'));
    fetchMock.mockImplementation(async (_u, init) => {
      const { type } = JSON.parse(String(init?.body)) as { type: string };
      return type === 'affiliate' ? new Response('down', { status: 503 }) : ok([]);
    });
    const p = runRegistrationDataSync();
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await p;
    const a = r.results[0];
    expect(isErr(a) && a.error).toBe('HTTP 503 down');
    expect(fetchMock.mock.calls.filter(([, i]) => String(i?.body).includes('"affiliate"'))).toHaveLength(3);
    expect(r.results[1]).toMatchObject({ type: 'guestuser', fetched: 0 });
  });

  it('count mismatch in the payload is treated as a bad response', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    fetchMock.mockImplementation(async () => ok([{ AgentID: 1 }], 5));
    const p = runRegistrationDataSync();
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(r.results.every(x => isErr(x) && x.error === 'unexpected payload')).toBe(true);
  });

  it('a sync_metadata write failure is swallowed', async () => {
    m.poolQuery.mockRejectedValue(new Error('meta down'));
    const r = await runRegistrationDataSync();
    expect(r.results).toHaveLength(3);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('sync_metadata write failed'), 'meta down');
  });
});

describe('runRegistrationDataSync — dryRun', () => {
  it('reports counts but writes nothing, uses a plain connection and releases it', async () => {
    dbRows.affiliate_data = [{ id: '2', affiliateId: '102', Name: 'Old' }];
    api.affiliate = [{ affiliateId: 101, Name: 'N' }, { affiliateId: 102, Name: 'New' }];
    const r = await runRegistrationDataSync({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.results[0]).toMatchObject({ inserted: 1, updated: 1 });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.connect).toHaveBeenCalledTimes(1);
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(calls(/^(LOCK|INSERT|UPDATE)/)).toHaveLength(0);
    expect(m.poolQuery).not.toHaveBeenCalled();
  });
});
