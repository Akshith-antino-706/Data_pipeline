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
