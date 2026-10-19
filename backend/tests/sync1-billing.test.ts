import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  invalidate: vi.fn<(p: string) => Promise<void>>(async () => undefined),
  snapshot: vi.fn<() => Promise<{ segments: number }>>(async () => ({ segments: 3 })),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.query },
  query: m.query,
  transaction: async <T>(fn: (c: { query: typeof m.clientQuery }) => Promise<T>) => fn({ query: m.clientQuery }),
}));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery: vi.fn(), default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: m.invalidate }));
vi.mock('../src/services/UnifiedContactService.js', () => ({ default: { snapshotDailySegments: m.snapshot } }));

import DailyBillingSync from '../src/services/DailyBillingSync.js';
import RaynaSyncService from '../src/services/RaynaSyncService.js';
import type { BillingApiRecord } from '../src/types/syncC.js';

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const rec = (o: Partial<BillingApiRecord> = {}): BillingApiRecord => ({
  BillSerial: 1, BillNo: 'B1', BillType: 'Tours', IsB2B: 0, ServiceId: 9, TravelDate: '2026-01-02T10:00:00',
  ServiceName: 'Desert', SellingPrice: '12.5', IsCancel: 0, Guest_Name: 'A', Nationality: 'IN',
  Guest_Contact: '971', Guest_Email: 'a@x.com', Guest_Age: 30, BookingDate: '01/01/2026', ...o,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  m.clientQuery.mockReset();
  m.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  m.invalidate.mockReset();
  m.invalidate.mockResolvedValue(undefined);
  m.snapshot.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('DailyBillingSync.fetchFromAPI', () => {
  it('POSTs the yesterday-bookings api name with a timeout signal', async () => {
    fetchMock.mockResolvedValueOnce(json([rec()]));
    const out = await DailyBillingSync.fetchFromAPI();
    expect(out).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init!.method).toBe('POST');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init!.body))).toMatchObject({ apiname: 'getallyesterdaybookingdatedata' });
  });

  it('throws with status and body on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 502 }));
    await expect(DailyBillingSync.fetchFromAPI()).rejects.toThrow('API returned 502: nope');
  });

  it('throws when the API returns an object instead of an array', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'bad token' }));
    await expect(DailyBillingSync.fetchFromAPI()).rejects.toThrow('did not return an array');
  });
});

describe('DailyBillingSync.upsertRecords / upsertBatch', () => {
  it('routes bill types case-insensitively and unknown/empty types to rayna_others', async () => {
    const r = await DailyBillingSync.upsertRecords([
      rec({ BillType: ' HOTELAMENDMENT ' }), rec({ BillType: 'intlvisa' }), rec({ BillType: null }),
      rec({ BillType: 'weird' }), rec({ BillType: 'OnlineTour' }),
    ]);
    expect(r).toEqual({ rayna_hotels: 1, rayna_visas: 1, rayna_others: 2, rayna_tours: 1 });
  });

  it('maps and cleans values: date trimmed, price parsed, NUL bytes stripped, nulls → empty', async () => {
    await DailyBillingSync.upsertRecords([rec({ SellingPrice: 'abc', Guest_Name: 'Jo\0hn', Nationality: null, BillSerial: null })]);
    const [sql, params] = m.clientQuery.mock.calls[0]!;
    expect(sql).toContain('ON CONFLICT (service_id, bill_serial)');
    expect(sql).not.toMatch(/service_id = EXCLUDED|bill_serial = EXCLUDED/);
    expect(sql).toContain('updated_date = NOW()');
    expect(params).toHaveLength(15);
    expect(params![0]).toBe('');            // bill_serial
    expect(params![5]).toBe('2026-01-02');  // travel_date
    expect(params![7]).toBe(0);             // selling_price
    expect(params![9]).toBe('John');        // guest_name
    expect(params![10]).toBe('');           // nationality
  });

  it('batches 500 rows per transaction with sequential placeholders', async () => {
    const r = await DailyBillingSync.upsertRecords(Array.from({ length: 501 }, (_, i) => rec({ BillSerial: i })));
    expect(m.clientQuery).toHaveBeenCalledTimes(2);
    const [sql1, p1] = m.clientQuery.mock.calls[0]!;
    expect(p1).toHaveLength(500 * 15);
    expect(sql1).toContain('$7500)');
    expect(m.clientQuery.mock.calls[1]![1]).toHaveLength(15);
    expect(r).toEqual({ rayna_tours: 501 });
  });

  it('upsertBatch with no rows runs nothing', async () => {
    await DailyBillingSync.upsertBatch({ query: m.clientQuery } as unknown as Parameters<typeof DailyBillingSync.upsertBatch>[0], 'rayna_tours', []);
    expect(m.clientQuery).not.toHaveBeenCalled();
  });

  // Regression (fixed): two API records with the same (ServiceId, BillSerial) in one batch make
  // Postgres fail with "ON CONFLICT DO UPDATE command cannot affect row a second time",
  // aborting the whole daily sync. No in-batch dedupe (DailyBillingSync.ts:126-142).
  it('dedupes rows with the same conflict key inside a batch', async () => {
    await DailyBillingSync.upsertRecords([rec({ BillSerial: 1, ServiceId: 9 }), rec({ BillSerial: 1, ServiceId: 9, SellingPrice: '20' })]);
    expect(m.clientQuery.mock.calls[0]![1]).toHaveLength(15);
  });
});

describe('DailyBillingSync.run', () => {
  it('returns early with no DB work when the API has no records', async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    const r = await DailyBillingSync.run();
    expect(r).toMatchObject({ fetched: 0, newContacts: 0 });
    expect(m.query).not.toHaveBeenCalled();
    expect(m.snapshot).not.toHaveBeenCalled();
  });

  it('full pipeline: upsert, contacts, snapshot, cache invalidate', async () => {
    fetchMock.mockResolvedValueOnce(json([rec()]));
    m.query.mockImplementation(async (sql) => {
      if (/INSERT INTO unified_contacts \(email/.test(sql)) return { rows: [], rowCount: 2 };
      if (/INSERT INTO unified_contacts \(mobile/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const r = await DailyBillingSync.run();
    expect(r).toMatchObject({ fetched: 1, newContacts: 3, upserted: { rayna_tours: 1 } });
    expect(m.invalidate).toHaveBeenCalledWith('dashboard:*');
    expect(m.snapshot).toHaveBeenCalledTimes(1);
  });

  it('cache invalidation failure is swallowed', async () => {
    fetchMock.mockResolvedValueOnce(json([rec()]));
    m.invalidate.mockRejectedValueOnce(new Error('redis down'));
    await expect(DailyBillingSync.run()).resolves.toMatchObject({ fetched: 1 });
  });

  it('snapshot failure propagates so the retry cron re-runs', async () => {
    fetchMock.mockResolvedValueOnce(json([rec()]));
    m.snapshot.mockRejectedValueOnce(new Error('snap fail'));
    await expect(DailyBillingSync.run()).rejects.toThrow('snap fail');
  });
});

describe('DailyBillingSync.incrementalContactUpdate / helpers', () => {
  it('links all 6 rayna tables by email then mobile and refreshes names of affected ids', async () => {
    m.query.mockImplementation(async (sql) => {
      if (/SELECT DISTINCT unified_id/.test(sql)) return { rows: [{ unified_id: 5 }, { unified_id: 6 }] };
      if (/latest_booking/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await DailyBillingSync.incrementalContactUpdate();
    const sqls = m.query.mock.calls.map(([s]) => s);
    expect(sqls.filter(s => /SET unified_id = uc.id/.test(s))).toHaveLength(12);
    const names = m.query.mock.calls.find(([s]) => /latest_booking/.test(s))!;
    expect(names[1]).toEqual([[5, 6]]);
    // full recompute (null) → no id filter params
    const status = m.query.mock.calls.find(([s]) => /SET booking_status = sub.status/.test(s))!;
    expect(status[1]).toEqual([]);
  });

  it('new email contacts skip ones already present; phone-only skips rows with an email', async () => {
    await DailyBillingSync.incrementalContactUpdate();
    const [emailSql, phoneSql] = m.query.mock.calls.map(([s]) => s);
    expect(emailSql).toContain('WHERE NOT EXISTS');
    expect(emailSql).toContain("'no', 'no'");
    expect(phoneSql).toContain("guest_email NOT LIKE '%@%'");
  });

  it('updateLatestNames does nothing for an empty id list', async () => {
    await expect(DailyBillingSync.updateLatestNames([])).resolves.toBe(0);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('recomputeSegmentation scoped to ids uses $1 filters everywhere', async () => {
    await DailyBillingSync.recomputeSegmentation([1, 2]);
    const calls = m.query.mock.calls;
    expect(calls).toHaveLength(5);
    calls.forEach(([s, p]) => { expect(s).toContain('$1'); expect(p).toEqual([[1, 2]]); });
  });

  it('recomputeSegmentation(null) recomputes everyone without params', async () => {
    await DailyBillingSync.recomputeSegmentation(null);
    m.query.mock.calls.forEach(([s]) => expect(s).not.toContain('ANY($1)'));
    expect(m.query.mock.calls.some(([s]) => /product_tier/.test(s) && /ILIKE '%yacht%'/.test(s))).toBe(true);
  });
});

describe('RaynaSyncService', () => {
  it('getTable / mapRow', () => {
    expect(RaynaSyncService.getTable('Package')).toBe('rayna_packages');
    expect(RaynaSyncService.getTable(undefined)).toBe('rayna_others');
    expect(RaynaSyncService.mapRow({ SellingPrice: '7.25', TravelDate: '2026-03-04 00:00' })).toMatchObject({
      selling_price: 7.25, travel_date: '2026-03-04', bill_serial: '', guest_email: '',
    });
    expect(RaynaSyncService.mapRow({}).selling_price).toBe(0);
  });

  it('ingestRecords inserts per table in batches and records metadata', async () => {
    const r = await RaynaSyncService.ingestRecords([rec(), rec({ BillType: 'visa' })]);
    expect(r.tables).toEqual({ rayna_tours: 1, rayna_visas: 1 });
    expect(m.clientQuery).toHaveBeenCalledTimes(2);
    expect(m.clientQuery.mock.calls[0]![0]).toMatch(/^INSERT INTO rayna_tours/);
    const meta = m.query.mock.calls.find(([s]) => /sync_metadata/.test(s))!;
    expect(meta[1]!.slice(0, 3)).toEqual(['rayna_billing_ingest', 2, 'success']);
  });

  it('ingestRecordsDedup skips rows that already exist', async () => {
    m.clientQuery.mockImplementation(async (sql) => {
      if (/^SELECT 1/.test(sql)) return { rows: m.clientQuery.mock.calls.filter(([s]) => /^SELECT 1/.test(s)).length === 1 ? [{}] : [] };
      return { rows: [], rowCount: 1 };
    });
    const r = await RaynaSyncService.ingestRecordsDedup([rec({ BillSerial: 1 }), rec({ BillSerial: 2 })]);
    expect(r).toMatchObject({ totalInserted: 1, totalReceived: 2, tables: { rayna_tours: 1 } });
    const exists = m.clientQuery.mock.calls.find(([s]) => /^SELECT 1/.test(s))!;
    expect(exists[1]).toHaveLength(15);
    expect(exists[0]).toContain('$15');
  });

  it('metadata write failure is swallowed', async () => {
    m.query.mockRejectedValue(new Error('down'));
    await expect(RaynaSyncService.ingestRecords([rec()])).resolves.toMatchObject({ totalInserted: 1 });
  });
});
