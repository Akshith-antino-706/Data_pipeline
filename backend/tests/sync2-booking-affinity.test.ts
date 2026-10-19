import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  cq: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  release: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({
  default: { query: m.query, connect: async () => ({ query: m.cq, release: m.release }) },
  query: m.query,
  transaction: vi.fn(),
}));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('fs/promises', () => ({ readFile: vi.fn(async () => '-- migration 115 (mocked)') }));

import BookingAffinityService, { SERVICES } from '../src/services/BookingAffinityService.js';

const flat = (s: string): string => s.replace(/\s+/g, ' ');

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.cq.mockReset();
  m.cq.mockResolvedValue({ rows: [] });
  m.release.mockClear();
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});

describe('buildWhere', () => {
  it('empty filters → no WHERE', () => {
    expect(BookingAffinityService.buildWhere({})).toEqual({ sql: '', params: [] });
  });

  it('combines type, bulk, period, view and search with numbered params', () => {
    const w = BookingAffinityService.buildWhere({ businessType: 'b2b', excludeBulk: true, period: 'month', view: 'product', product: 'safari', search: '50%_off\\' });
    expect(w.sql).toBe('WHERE contact_type = $1 AND NOT is_bulk AND bookings_30d > 0 AND product_1_key = $2 AND (name ILIKE $3 OR email ILIKE $3 OR mobile ILIKE $3 OR product_1_name ILIKE $3 OR product_2_name ILIKE $3 OR product_3_name ILIKE $3)');
    expect(w.params).toEqual(['B2B', 'safari', '%50\\%\\_off\\\\%']);
  });

  it('ignores unknown business types, the all period, unknown periods and mismatched view filters', () => {
    const w = BookingAffinityService.buildWhere({ businessType: 'robots', period: 'all', view: 'service', product: 'x' });
    expect(w).toEqual({ sql: '', params: [] });
    expect(BookingAffinityService.buildWhere({ period: "1d; DROP" }).sql).toBe('');
    expect(BookingAffinityService.buildWhere({ view: 'service', service: 'tours' })).toEqual({ sql: 'WHERE service_1 = $1', params: ['tours'] });
  });
});

describe('queries', () => {
  it('getTopProducts clamps the limit and appends AND to an existing WHERE', async () => {
    await BookingAffinityService.getTopProducts({ businessType: 'B2C' }, '999');
    await BookingAffinityService.getTopProducts({}, 'abc');
    const [a, b] = m.query.mock.calls;
    expect(flat(a![0])).toContain('WHERE contact_type = $1 AND product_1_key IS NOT NULL');
    expect(a![0]).toContain('LIMIT 50');
    expect(flat(b![0])).toContain('user_affinity_top3 WHERE product_1_key IS NOT NULL');
    expect(b![0]).toContain('LIMIT 12');
  });

  it('getTopProducts ignores view/search from the filters', async () => {
    await BookingAffinityService.getTopProducts({ view: 'service', service: 'tours', search: 'x' });
    expect(m.query.mock.calls[0]![1]).toEqual([]);
  });

  it('searchProducts escapes LIKE wildcards and clamps to 1..100', async () => {
    await BookingAffinityService.searchProducts('a_b', 0);
    expect(m.query.mock.calls[0]![1]).toEqual(['%a\\_b%']);
    expect(m.query.mock.calls[0]![0]).toContain('LIMIT 20');
    await BookingAffinityService.searchProducts(null, -5);
    expect(m.query.mock.calls[1]![0]).toContain('LIMIT 1');
    expect(m.query.mock.calls[1]![0]).not.toContain('WHERE');
  });

  it.each([
    ['bookings', 'week', 'ORDER BY bookings_7d DESC, affinity_score DESC, unified_id'],
    ['revenue', undefined, 'ORDER BY revenue_all DESC, affinity_score DESC, unified_id'],
    ['last', 'year', 'ORDER BY last_booking_date DESC NULLS LAST, affinity_score DESC, unified_id'],
    ['score; DROP TABLE x', 'bogus', 'ORDER BY affinity_score DESC, bookings_all DESC, unified_id'],
  ])('customerQuery sort=%s period=%s', (sort, period, order) => {
    const q = BookingAffinityService.customerQuery({ sort, period });
    expect(flat(q.select)).toContain(order);
    expect(q.select).not.toContain('DROP');
  });

  it('getCustomers paginates with clamped limit/page', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)::int AS n') ? { rows: [{ n: 7 }] } : { rows: [{ unified_id: 1 }] });
    const r = await BookingAffinityService.getCustomers({ limit: '500', page: '3' });
    expect(r).toEqual({ total: 7, customers: [{ unified_id: 1 }] });
    expect(m.query.mock.calls.find(([s]) => s.includes('OFFSET'))![0]).toContain('LIMIT 200 OFFSET 400');
    m.query.mockClear();
    await BookingAffinityService.getCustomers({ page: '-2' });
    expect(m.query.mock.calls.find(([s]) => s.includes('OFFSET'))![0]).toContain('LIMIT 25 OFFSET 0');
  });

  it('getSummary fills every service (0 when missing) and totals', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('service_1 AS service') ? { rows: [{ service: 'tours', customers: 5 }, { service: 'visas', customers: 2 }] } : { rows: [] });
    const r = await BookingAffinityService.getSummary({});
    expect(r.totalCustomers).toBe(7);
    expect(r.topService).toEqual(SERVICES.map(s => ({ service: s, customers: s === 'tours' ? 5 : s === 'visas' ? 2 : 0 })));
  });

  it('getCustomerDetail returns null when the customer is missing', async () => {
    expect(await BookingAffinityService.getCustomerDetail(1)).toBeNull();
    expect(m.query.mock.calls.every(c => (c[1] as unknown[])[0] === 1)).toBe(true);
  });
});

describe('getStatus', () => {
  it('reports a stale "running" (no lock held) as an interrupted error', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('sync_metadata')
      ? { rows: [{ sync_status: 'running', last_synced_at: 't', sync_duration_ms: 5, error_message: null }] }
      : { rows: [{ built_at: 'b' }] });
    m.cq.mockResolvedValueOnce({ rows: [{ free: true }] });
    const s = await BookingAffinityService.getStatus();
    expect(s).toMatchObject({ status: 'error', builtAt: 'b', lastDurationMs: 5 });
    expect(s.lastError).toContain('interrupted');
    expect(m.cq.mock.calls[1]![0]).toContain('pg_advisory_unlock');
    expect(m.release).toHaveBeenCalled();
  });

  it('keeps "running" while another process holds the lock', async () => {
    m.query.mockImplementation(async (sql: string) => sql.includes('sync_metadata') ? { rows: [{ sync_status: 'running' }] } : { rows: [] });
    m.cq.mockResolvedValueOnce({ rows: [{ free: false }] });
    expect((await BookingAffinityService.getStatus()).status).toBe('running');
  });
});

describe('getCustomersCsv', () => {
  it('writes the header and quotes cells containing commas, quotes or newlines', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ unified_id: 1, name: 'Doe, "J"', email: null, is_bulk: false, first_booking_date: new Date('2026-01-05T00:00:00Z'), product_1_name: 'a\nb' }] });
    const csv = await BookingAffinityService.getCustomersCsv({});
    const [head, line] = csv.split('\n');
    expect(head!.startsWith('Unified ID,Name,Email,Mobile')).toBe(true);
    expect(line).toBe('1,"Doe, ""J""",,,,,false,,,,2026-01-05,,,,,,,,,,,,"a');
    expect(m.query.mock.calls[0]![0]).toContain('LIMIT 100000');
  });

  // BUG (CSV/formula injection): a customer name such as "=HYPERLINK(...)" is written raw, so
  // Excel/Sheets evaluate it when staff open the export (src/services/BookingAffinityService.ts:74-78,
  // csvCell does not neutralise leading = + - @).
  it.fails('neutralises spreadsheet formulas in exported cells', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ unified_id: 1, name: '=HYPERLINK("http://evil","x")' }] });
    const line = (await BookingAffinityService.getCustomersCsv({})).split('\n')[1]!;
    expect(line.split(',')[1]!.replace(/^"/, '').startsWith('=')).toBe(false);
  });
});

describe('build()', () => {
  const route = (opts: { lock?: boolean; failOn?: string } = {}): void => {
    m.cq.mockImplementation(async (sql: string) => {
      if (opts.failOn && sql.includes(opts.failOn)) throw new Error(`fail ${opts.failOn}`);
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: opts.lock ?? true }] };
      if (sql.includes('AS today')) return { rows: [{ today: '2026-10-19' }] };
      if (sql.includes('grouped_pct')) return { rows: [{ grouped_pct: '80.5', excluded_pct: '3.0' }] };
      if (sql.includes('INSERT INTO user_affinity_top3')) return { rows: [], rowCount: 11 };
      return { rows: [], rowCount: 1 };
    });
  };
  const sqls = (): string[] => m.cq.mock.calls.map(c => flat(c[0]));

  it('skips when another build holds the advisory lock (no status write, no unlock)', async () => {
    route({ lock: false });
    expect(await BookingAffinityService.build()).toEqual({ skipped: true });
    expect(sqls().some(s => s.includes('pg_advisory_unlock'))).toBe(false);
    expect(m.query.mock.calls.some(([s]) => s.includes('sync_metadata'))).toBe(false);
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(BookingAffinityService.isRunning()).toBe(false);
  });

  it('builds with half-life scoring, bill dedupe, bulk rule, and swaps inside one transaction', async () => {
    route();
    const r = await BookingAffinityService.build();
    expect(r).toMatchObject({ customers: 11, groupedPct: 80.5, excludedPct: 3, asOf: '2026-10-19' });
    const all = sqls();
    const joined = all.join('\n');
    expect(joined).toContain("10 * power(0.5::float8, GREATEST(DATE '2026-10-19' - b.booking_day, 0)::float8 / 180)");
    expect(joined).toContain("COALESCE(NULLIF(trim(bill_no), ''), 'id:' || id) AS bill_key");
    expect(joined).toContain('GROUP BY unified_id, service, bill_key, lower(clean_name)');
    expect(joined).toContain("c.bookings_all >= 50 OR COALESCE(c.email, '') ~* '@rayna[a-z0-9-]*\\.[a-z.]+$'");
    expect(joined).toContain("b.booking_day >= DATE '2026-10-19' - 30");
    for (const s of SERVICES) expect(joined).toContain(`FROM rayna_${s}`);
    const begin = all.indexOf('BEGIN');
    const commit = all.indexOf('COMMIT');
    const deletes = all.map((s, i) => [s, i] as const).filter(([s]) => s.startsWith('DELETE FROM')).map(([, i]) => i);
    expect(deletes).toHaveLength(4);
    expect(deletes.every(i => i > begin && i < commit)).toBe(true);
    expect(all.some(s => s.includes('TRUNCATE'))).toBe(false);
    expect(all.at(-2)).toContain('DROP TABLE IF EXISTS _aff_bill_product');
    expect(all.at(-1)).toContain('pg_advisory_unlock');
    const statuses = m.query.mock.calls.filter(([s]) => s.includes('sync_metadata')).map(c => c[1]![3]);
    expect(statuses).toEqual(['running', 'success']);
    expect(m.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back, records the error, unlocks and rethrows when a write fails', async () => {
    route({ failOn: 'INSERT INTO user_service_affinity' });
    await expect(BookingAffinityService.build()).rejects.toThrow('fail INSERT INTO user_service_affinity');
    const all = sqls();
    expect(all).toContain('ROLLBACK');
    expect(all).not.toContain('COMMIT');
    expect(all.at(-1)).toContain('pg_advisory_unlock');
    const last = m.query.mock.calls.filter(([s]) => s.includes('sync_metadata')).at(-1)!;
    expect(last[1]![3]).toBe('error');
    expect(last[1]![4]).toBe('fail INSERT INTO user_service_affinity');
    expect(BookingAffinityService.isRunning()).toBe(false);
  });
});
