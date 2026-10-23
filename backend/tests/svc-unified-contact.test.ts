import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [{}] })),
  cached: vi.fn(async <T>(_key: string, fn: () => Promise<T>) => fn()),
  invalidate: vi.fn(async () => undefined),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: m.cached, invalidate: m.invalidate }));

import UnifiedContactService from '../src/services/UnifiedContactService.js';

const INJECTIONS = [
  "2024-01-01' OR '1'='1",
  "2024-01-01'; DROP TABLE unified_contacts; --",
  "'; DELETE FROM rayna_tours; --",
];

const allSql = () => m.query.mock.calls.map(([s]) => s).join('\n');

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [{}] });
  m.cached.mockClear();
});

describe('UnifiedContactService._computeSegmentationTree — date validation', () => {
  it.each(INJECTIONS)('rejects injected dateFrom %j without querying', async (bad) => {
    await expect(UnifiedContactService._computeSegmentationTree({ dateFrom: bad })).rejects.toThrow('Invalid dateFrom');
    expect(m.query).not.toHaveBeenCalled();
    expect(allSql()).not.toContain(bad);
  });

  it.each(INJECTIONS)('rejects injected dateTo %j without querying', async (bad) => {
    await expect(UnifiedContactService._computeSegmentationTree({ dateFrom: '2024-01-01', dateTo: bad })).rejects.toThrow('Invalid dateTo');
    expect(m.query).not.toHaveBeenCalled();
  });

  it.each([
    '2024/01/01', '01-01-2024', '2024-1-1', '2024-01-01T00:00:00Z', ' 2024-01-01', '2024-01-01 ',
    '2024-01-01\n', '２０２４-01-01', 'yesterday', '20240101',
  ])('rejects non-YYYY-MM-DD %j', async (bad) => {
    await expect(UnifiedContactService._computeSegmentationTree({ dateFrom: bad })).rejects.toThrow(/Invalid dateFrom/);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('rejects wrong types (number, Date, array)', async () => {
    for (const bad of [20240101, new Date('2024-01-01'), ['2024-01-01']]) {
      // Values reach this method from query strings / JSON, so wrong types are realistic.
      const filters = { dateFrom: bad } as unknown as Parameters<typeof UnifiedContactService._computeSegmentationTree>[0];
      await expect(UnifiedContactService._computeSegmentationTree(filters)).rejects.toThrow(/Invalid dateFrom/);
    }
    expect(m.query).not.toHaveBeenCalled();
  });

  it('rejects shape-valid but impossible calendar dates', async () => {
    await expect(UnifiedContactService._computeSegmentationTree({ dateFrom: '2024-13-45' })).rejects.toThrow(/Invalid dateFrom/);
    await expect(UnifiedContactService._computeSegmentationTree({ dateTo: '2023-02-29' })).rejects.toThrow(/Invalid dateTo/);
  });

  it('valid dates are embedded in the revenue SQL', async () => {
    await UnifiedContactService._computeSegmentationTree({ dateFrom: '2024-01-01', dateTo: '2024-01-31' });
    expect(m.query).toHaveBeenCalled();
    const sql = allSql();
    expect(sql).toContain("bill_date >= '2024-01-01'");
    expect(sql).toContain("bill_date <= '2024-01-31'::date + INTERVAL '1 day'");
  });

  it('empty strings / undefined mean "no date filter"', async () => {
    await UnifiedContactService._computeSegmentationTree({ dateFrom: '', dateTo: undefined });
    expect(allSql()).not.toContain('bill_date >=');
  });

  it('businessType is whitelisted, injection dropped', async () => {
    await UnifiedContactService._computeSegmentationTree({ businessType: "B2C'; DROP TABLE x; --" });
    expect(allSql()).not.toContain('DROP');
    expect(allSql()).not.toContain('WHERE contact_type =');
    m.query.mockClear();
    await UnifiedContactService._computeSegmentationTree({ businessType: 'b2b' });
    expect(allSql()).toContain("WHERE contact_type = 'B2B'");
  });

  it('getSegmentationTree with an injected date never reaches the pool', async () => {
    await expect(UnifiedContactService.getSegmentationTree({ dateFrom: INJECTIONS[1] })).rejects.toThrow();
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe('getStats revenue', () => {
  it('excludes cancelled bookings from revenue (matches Total Confirmed Revenue)', async () => {
    m.query.mockResolvedValue({ rows: [{ total_revenue: '100', total_bookings: 2, conversations_7d: 0 }] });
    await UnifiedContactService.getStats({});
    const revSql = m.query.mock.calls.map(c => String(c[0])).find(s => s.includes('total_revenue')) ?? '';
    expect(revSql).toMatch(/SUM\(selling_price\) FILTER \(WHERE is_cancel <> '1'\)/);
    expect(revSql).not.toMatch(/COALESCE\(SUM\(selling_price\), 0\)/);
  });
});

describe('UnifiedContactService.getById / getBookings — booking paging', () => {
  it('getById fetches only the latest N rows per type (default 20) and exact aggregate counts', async () => {
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM unified_contacts WHERE id')) return { rows: [{ id: 42, name: 'Zed' }] };
      if (sql.includes('AS tour_cnt')) return { rows: [{ tour_cnt: 57, pkg_cnt: 0, htl_cnt: 2, vis_cnt: 0, oth_cnt: 0, flt_cnt: 0, revenue: '1234.5', tour_rev: '1000', pkg_rev: '0', htl_rev: '234.5', vis_rev: '0', oth_rev: '0', flt_rev: '0', cancelled_cnt: 1, cancelled_revenue: '50' }] };
      return { rows: [{ bill_no: 'B1' }] };
    });
    const c = await UnifiedContactService.getById(42);
    expect(c).toMatchObject({ total_tour_bookings: 57, total_hotel_bookings: 2, total_booking_revenue: 1234.5, bookings_per_type: 20, cancelled_count: 1 });
    expect(c?.revenue_by_type).toEqual({ tours: 1000, packages: 0, hotels: 234.5, visas: 0, others: 0, flights: 0 });
    const detailCalls = m.query.mock.calls.filter(([sql]) => sql.includes('ORDER BY travel_date DESC NULLS LAST LIMIT $2'));
    expect(detailCalls).toHaveLength(6);
    for (const [, params] of detailCalls) expect(params).toEqual([42, 20]);
    expect(allSql()).not.toContain('LIMIT 500');
  });

  it('getById caps perType at 500 (the legacy popup size)', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('FROM unified_contacts WHERE id') ? { rows: [{ id: 1 }] } : { rows: [{}] });
    await UnifiedContactService.getById(1, 5000);
    const detailCalls = m.query.mock.calls.filter(([sql]) => sql.includes('LIMIT $2'));
    for (const [, params] of detailCalls) expect(params).toEqual([1, 500]);
  });

  it('getBookings pages one table with LIMIT/OFFSET and a separate exact count', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: '45' }] } : { rows: [{ bill_no: 'B9' }] });
    const r = await UnifiedContactService.getBookings(42, 'hotels', 3, 20);
    expect(r).toEqual({ rows: [{ bill_no: 'B9' }], total: 45, page: 3, limit: 20, totalPages: 3 });
    const page = m.query.mock.calls.find(([sql]) => sql.includes('OFFSET'));
    expect(page?.[0]).toContain('FROM rayna_hotels WHERE unified_id = $1');
    expect(page?.[1]).toEqual([42, 20, 40]);
    const count = m.query.mock.calls.find(([sql]) => sql.includes('COUNT(*)'));
    expect(count?.[0]).toContain('FROM rayna_hotels');
  });

  it('getBookings refuses unknown types before any query and clamps bad paging', async () => {
    await expect(UnifiedContactService.getBookings(42, "tours; DROP TABLE x; --")).rejects.toThrow('Unknown booking type');
    expect(m.query).not.toHaveBeenCalled();
    m.query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: '0' }] } : { rows: [] });
    const r = await UnifiedContactService.getBookings(42, 'tours', -5, 99999);
    expect(r).toMatchObject({ page: 1, limit: 100, total: 0, totalPages: 1 });
  });
});

describe('UnifiedContactService.getSegmentDailyLog — split caches, audience-aware revenue', () => {
  it('caches the log by days/segment and the live counts by audience, independently', async () => {
    m.query.mockResolvedValue({ rows: [] });
    m.cached.mockClear();
    await UnifiedContactService.getSegmentDailyLog({ days: 7, segment: 'ON_TRIP', businessType: 'B2B' });
    const keys = m.cached.mock.calls.map(c => c[0]);
    expect(keys).toEqual(['dashboard:activity:logs:7:ON_TRIP', 'dashboard:activity:live:B2B']);
  });
  it('includeLive=false skips the contacts × bookings join; fresh bypasses the cache', async () => {
    m.query.mockResolvedValue({ rows: [] });
    m.cached.mockClear();
    const r = await UnifiedContactService.getSegmentDailyLog({ days: 7, includeLive: false, fresh: true });
    expect(r.liveToday).toEqual([]);
    expect(m.cached).not.toHaveBeenCalled();
    const sqls = m.query.mock.calls.map(c => String(c[0]));
    expect(sqls.some(q => q.includes('FROM segment_daily_log'))).toBe(true);
    expect(sqls.some(q => q.includes('rayna_tours'))).toBe(false);
  });
  it('the live revenue subquery honours the audience filter (B2B revenue is B2B only)', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await UnifiedContactService._computeLiveToday('B2B');
    const [sql, params] = m.query.mock.calls.at(-1)!;
    expect(String(sql)).toContain('AND uc2.contact_type = $1');
    expect(String(sql)).toContain('AND uc.contact_type = $1');
    expect(params).toEqual(['B2B']);
    expect(/^\s*SELECT/i.test(String(sql))).toBe(true);
  });
});

describe('UnifiedContactService.getQuickStats', () => {
  it('runs only a contact count and the 7-day conversations count, audience-filtered and parameterised', async () => {
    m.query.mockReset();
    m.query.mockImplementation(async (sql: string) => ({ rows: [sql.includes('conversations_7d') ? { conversations_7d: 3 } : { total_contacts: 42 }] }));
    const r = await UnifiedContactService.getQuickStats({ businessType: 'B2B' });
    expect(r).toEqual({ total_contacts: 42, conversations_7d: 3 });
    expect(m.query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of m.query.mock.calls) {
      expect(/^\s*SELECT/i.test(String(sql))).toBe(true);
      expect(params).toEqual(['B2B']);
      expect(String(sql)).not.toMatch(/rayna_|DISTINCT country|multi_source/);
    }
  });
});
