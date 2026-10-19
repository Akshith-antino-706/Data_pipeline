import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BillingApiRecord } from '../src/types/syncC.js';

type Result = { rows: unknown[]; rowCount: number | null };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  transaction: vi.fn(),
  invalidate: vi.fn<(p: string) => Promise<void>>(),
  snapshot: vi.fn<() => Promise<{ segments: number }>>(),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.query },
  query: m.query,
  transaction: m.transaction,
}));
vi.mock('../src/config/cache.js', () => ({ invalidate: m.invalidate, cached: vi.fn() }));
vi.mock('../src/services/UnifiedContactService.js', () => ({ default: { snapshotDailySegments: m.snapshot } }));

import DailyBillingSync from '../src/services/DailyBillingSync.js';

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const rec = (over: Partial<BillingApiRecord> = {}): BillingApiRecord => ({
  BillSerial: 1, BillNo: 'B1', BillType: 'Tours', IsB2B: '0', ServiceId: 10,
  TravelDate: '2026-05-01T00:00:00', ServiceName: 'Desert Safari', SellingPrice: '120.5',
  IsCancel: '0', Guest_Name: 'Ann', Nationality: 'India', Guest_Contact: '971501234567',
  Guest_Email: 'ann@x.com', Guest_Age: 30, BookingDate: '01/04/2026',
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  m.clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  m.transaction.mockReset().mockImplementation(async (fn: (c: { query: typeof m.clientQuery }) => Promise<unknown>) => fn({ query: m.clientQuery }));
  m.invalidate.mockReset().mockResolvedValue(undefined);
  m.snapshot.mockReset().mockResolvedValue({ segments: 4 });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('DailyBillingSync.fetchFromAPI', () => {
  it('POSTs the yesterday apiname and returns the array', async () => {
    fetchMock.mockResolvedValue(jsonResponse([rec()]));
    const out = await DailyBillingSync.fetchFromAPI();
    expect(out).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ apiname: 'getallyesterdaybookingdatedata' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns an empty array when the API sends []', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await expect(DailyBillingSync.fetchFromAPI()).resolves.toEqual([]);
  });

  it('throws with status and body on a non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));
    await expect(DailyBillingSync.fetchFromAPI()).rejects.toThrow('API returned 502: boom');
  });

  it('throws when the API returns an error object instead of an array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad token' }));
    await expect(DailyBillingSync.fetchFromAPI()).rejects.toThrow('did not return an array');
  });

  it('propagates network failures', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(DailyBillingSync.fetchFromAPI()).rejects.toThrow('ECONNRESET');
  });
});

describe('DailyBillingSync.upsertRecords', () => {
  it('routes bill types to tables case/space-insensitively; unknown and null go to rayna_others', async () => {
    const out = await DailyBillingSync.upsertRecords([
      rec({ BillType: ' TOURS ' }), rec({ BillType: 'onlinetour' }), rec({ BillType: 'Package' }),
      rec({ BillType: 'HotelAmendment' }), rec({ BillType: 'intlvisa' }), rec({ BillType: 'ticket' }),
      rec({ BillType: 'spaceship' }), rec({ BillType: null }),
    ]);
    expect(out).toEqual({ rayna_tours: 2, rayna_packages: 1, rayna_hotels: 1, rayna_visas: 1, rayna_others: 3 });
    const tables = m.clientQuery.mock.calls.map(([sql]) => /INSERT INTO (\w+)/.exec(sql)![1]);
    expect(new Set(tables)).toEqual(new Set(['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_others']));
  });

  it('returns {} and runs no transaction for no records', async () => {
    await expect(DailyBillingSync.upsertRecords([])).resolves.toEqual({});
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('splits into 500-row batches, one transaction each', async () => {
    const records = Array.from({ length: 1001 }, (_, i) => rec({ BillSerial: i }));
    const out = await DailyBillingSync.upsertRecords(records);
    expect(out).toEqual({ rayna_tours: 1001 });
    expect(m.transaction).toHaveBeenCalledTimes(3);
    const sizes = m.clientQuery.mock.calls.map(([, p]) => (p ?? []).length / 15);
    expect(sizes).toEqual([500, 500, 1]);
  });

  it('maps fields: price parsing, date slicing, null bytes stripped, missing values blank', async () => {
    await DailyBillingSync.upsertRecords([
      rec({ SellingPrice: 'abc', TravelDate: '2026-05-01T10:00:00', Guest_Name: 'A\0nn', Guest_Email: null, Guest_Age: null }),
    ]);
    const [sql, params] = m.clientQuery.mock.calls[0]!;
    expect(sql).toContain('ON CONFLICT (service_id, bill_serial)');
    expect(sql).not.toMatch(/service_id = EXCLUDED|bill_serial = EXCLUDED/);
    expect(params).toHaveLength(15);
    expect(params![5]).toBe('2026-05-01');
    expect(params![7]).toBe(0);
    expect(params![9]).toBe('Ann');
    expect(params![12]).toBe('');
    expect(params![13]).toBe('');
    expect(params!.some(v => typeof v === 'number' && Number.isNaN(v))).toBe(false);
    expect(params!.map(String)).not.toContain('undefined');
  });

  it('propagates a failed batch', async () => {
    m.clientQuery.mockRejectedValue(new Error('unique violation'));
    await expect(DailyBillingSync.upsertRecords([rec()])).rejects.toThrow('unique violation');
  });
});

describe('DailyBillingSync.upsertBatch', () => {
  it('does nothing for an empty batch', async () => {
    const client = { query: m.clientQuery };
    await DailyBillingSync.upsertBatch(client as unknown as Parameters<typeof DailyBillingSync.upsertBatch>[0], 'rayna_tours', []);
    expect(m.clientQuery).not.toHaveBeenCalled();
  });
});

describe('DailyBillingSync.incrementalContactUpdate', () => {
  it('returns new email + phone contacts and links all six tables', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 3 }).mockResolvedValueOnce({ rows: [], rowCount: 2 });
    await expect(DailyBillingSync.incrementalContactUpdate()).resolves.toBe(5);
    const sqls = m.query.mock.calls.map(([s]) => s);
    for (const t of ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_others', 'rayna_flights']) {
      expect(sqls.some(s => s.includes(`UPDATE ${t} rt SET unified_id`))).toBe(true);
    }
  });

  it('treats null rowCounts as 0 (no NaN)', async () => {
    m.query.mockResolvedValue({ rows: [], rowCount: null });
    await expect(DailyBillingSync.incrementalContactUpdate()).resolves.toBe(0);
  });

  it('passes the affected ids to the latest-name refresh', async () => {
    m.query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT DISTINCT unified_id') ? { rows: [{ unified_id: 7 }, { unified_id: 9 }], rowCount: 2 } : { rows: [], rowCount: 0 });
    await DailyBillingSync.incrementalContactUpdate();
    const call = m.query.mock.calls.find(([s]) => s.includes('latest_booking'));
    expect(call?.[1]).toEqual([[7, 9]]);
  });
});

describe('DailyBillingSync.updateLatestNames', () => {
  it('returns 0 without querying for empty input', async () => {
    await expect(DailyBillingSync.updateLatestNames([])).resolves.toBe(0);
    expect(m.query).not.toHaveBeenCalled();
  });
  it('returns rowCount (null → 0)', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 4 });
    await expect(DailyBillingSync.updateLatestNames([1])).resolves.toBe(4);
    m.query.mockResolvedValueOnce({ rows: [], rowCount: null });
    await expect(DailyBillingSync.updateLatestNames([1])).resolves.toBe(0);
  });
});

describe('DailyBillingSync.recomputeSegmentation', () => {
  it('without ids: updates all contacts with no $1 params', async () => {
    await DailyBillingSync.recomputeSegmentation(null);
    for (const [sql, params] of m.query.mock.calls) {
      expect(sql).not.toContain('ANY($1)');
      expect(params === undefined || (Array.isArray(params) && params.length === 0)).toBe(true);
    }
  });
  it('with ids: every statement is scoped by ANY($1)', async () => {
    await DailyBillingSync.recomputeSegmentation([1, 2]);
    expect(m.query.mock.calls.length).toBeGreaterThan(0);
    for (const [sql, params] of m.query.mock.calls) {
      expect(sql).toContain('ANY($1)');
      expect(params).toEqual([[1, 2]]);
    }
  });
  it('empty array behaves like null', async () => {
    await DailyBillingSync.recomputeSegmentation([]);
    expect(m.query.mock.calls.every(([s]) => !s.includes('ANY($1)'))).toBe(true);
  });
});

describe('DailyBillingSync.run', () => {
  it('returns zeros and touches nothing when the API is empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const out = await DailyBillingSync.run();
    expect(out).toMatchObject({ fetched: 0, upserted: {}, newContacts: 0 });
    expect(m.query).not.toHaveBeenCalled();
    expect(m.snapshot).not.toHaveBeenCalled();
  });

  it('runs the full pipeline and invalidates dashboard caches', async () => {
    fetchMock.mockResolvedValue(jsonResponse([rec(), rec({ BillType: 'visa' })]));
    const out = await DailyBillingSync.run();
    expect(out.fetched).toBe(2);
    expect(out.upserted).toEqual({ rayna_tours: 1, rayna_visas: 1 });
    expect(m.snapshot).toHaveBeenCalledOnce();
    expect(m.invalidate).toHaveBeenCalledWith('dashboard:*');
    expect(Number.isFinite(out.durationMs)).toBe(true);
  });

  it('swallows cache-invalidation errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse([rec()]));
    m.invalidate.mockRejectedValue(new Error('redis down'));
    await expect(DailyBillingSync.run()).resolves.toMatchObject({ fetched: 1 });
  });

  it('propagates snapshot failures so the retry cron re-runs', async () => {
    fetchMock.mockResolvedValue(jsonResponse([rec()]));
    m.snapshot.mockRejectedValue(new Error('snapshot failed'));
    await expect(DailyBillingSync.run()).rejects.toThrow('snapshot failed');
    expect(m.invalidate).not.toHaveBeenCalled();
  });

  it('propagates API errors before touching the DB', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(DailyBillingSync.run()).rejects.toThrow('API returned 500');
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
