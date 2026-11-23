import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] }));
  const clientQuery = vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [], rowCount: 0 }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return { query, clientQuery, release, connect };
});

vi.mock('../src/config/database.js', () => ({
  default: { query: m.query, connect: m.connect },
  query: m.query,
  transaction: vi.fn(),
}));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import SegmentEngine, { clearSegmentCustomerCounts } from '../src/services/SegmentEngine.js';

beforeEach(() => {
  clearSegmentCustomerCounts();
  m.query.mockReset();
  m.clientQuery.mockReset();
  m.release.mockReset();
  m.connect.mockClear();
  m.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

const countThenRows = (count: string) => {
  m.query.mockResolvedValueOnce({ rows: [{ count }] });
  m.query.mockResolvedValueOnce({ rows: [{ customer_id: 1 }] });
};

describe('SegmentEngine.getSegmentCustomers', () => {
  it('defaults: page 1, limit 25, sorted by sc.assigned_at DESC', async () => {
    countThenRows('51');
    const res = await SegmentEngine.getSegmentCustomers(7);
    const [sql, params] = m.query.mock.calls[1];
    expect(sql).toContain('ORDER BY sc.assigned_at DESC');
    expect(params).toEqual([7, 25, 0]);
    expect(res).toMatchObject({ total: 51, page: 1, limit: 25, totalPages: 3 });
  });

  it('whitelists sortBy and falls back on injection attempt', async () => {
    countThenRows('0');
    await SegmentEngine.getSegmentCustomers(1, { sortBy: 'email; DROP TABLE customers', sortDir: 'asc' });
    const sql = m.query.mock.calls[1][0];
    expect(sql).not.toContain('DROP');
    expect(sql).toContain('ORDER BY sc.assigned_at ASC');
  });

  it('allowed non-default column is prefixed with c.', async () => {
    countThenRows('0');
    await SegmentEngine.getSegmentCustomers(1, { sortBy: 'total_revenue', sortDir: 'sideways' });
    expect(m.query.mock.calls[1][0]).toContain('ORDER BY c.total_revenue DESC');
  });

  it('sortBy is case-sensitive (EMAIL not allowed)', async () => {
    countThenRows('0');
    await SegmentEngine.getSegmentCustomers(1, { sortBy: 'EMAIL' });
    expect(m.query.mock.calls[1][0]).toContain('ORDER BY sc.assigned_at');
  });

  it('search is parameterised (incl. unicode / quotes)', async () => {
    countThenRows('2');
    await SegmentEngine.getSegmentCustomers(3, { search: "Zoë' OR 1=1 --", page: 2, limit: 10 });
    const [countSql, countParams] = m.query.mock.calls[0];
    expect(countSql).not.toContain('1=1');
    expect(countParams).toEqual([3, "%Zoë' OR 1=1 --%"]);
    expect(m.query.mock.calls[1][1]).toEqual([3, "%Zoë' OR 1=1 --%", 10, 10]);
    expect(m.query.mock.calls[1][0]).toContain('LIMIT $3 OFFSET $4');
  });

  it('empty search string adds no filter', async () => {
    countThenRows('0');
    await SegmentEngine.getSegmentCustomers(3, { search: '' });
    expect(m.query.mock.calls[0][1]).toEqual([3]);
  });

  it('page 0 is clamped to 1 (OFFSET 0) and bad limits fall back / are capped', async () => {
    countThenRows('0');
    await SegmentEngine.getSegmentCustomers(3, { page: 0, limit: 10 });
    expect(m.query.mock.calls[1][1]).toEqual([3, 10, 0]);
    // the count is now cached per (segment, search) for a minute: later pages only run the page query
    m.query.mockClear();
    m.query.mockResolvedValue({ rows: [] });
    await SegmentEngine.getSegmentCustomers(3, { page: -2, limit: 0 });
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(m.query.mock.calls[0][1]).toEqual([3, 25, 0]);
    m.query.mockClear();
    m.query.mockResolvedValue({ rows: [] });
    await SegmentEngine.getSegmentCustomers(3, { page: 2, limit: 10000 });
    expect(m.query.mock.calls[0][1]).toEqual([3, 500, 500]);
  });

  it('total 0 → totalPages 0', async () => {
    countThenRows('0');
    expect((await SegmentEngine.getSegmentCustomers(1)).totalPages).toBe(0);
  });
});

describe('SegmentEngine.runSegmentation', () => {
  it('runs each segment in its own transaction and sums assignments', async () => {
    m.query.mockResolvedValueOnce({ rows: [
      { segment_id: 1, segment_name: 'A', sql_criteria: 'total_bookings > 0' },
      { segment_id: 2, segment_name: 'B', sql_criteria: 'bad sql' },
    ] });
    m.query.mockResolvedValue({ rows: [] });
    m.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('bad sql')) throw new Error('syntax error');
      if (sql.includes('INSERT INTO segment_customers')) return { rows: [], rowCount: 4 };
      return { rows: [], rowCount: 0 };
    });
    await SegmentEngine.runSegmentation();
    const clientSqls = m.clientQuery.mock.calls.map(c => c[0]);
    expect(clientSqls.filter(s => s === 'BEGIN')).toHaveLength(2);
    expect(clientSqls).toContain('COMMIT');
    expect(clientSqls).toContain('ROLLBACK');
    expect(m.release).toHaveBeenCalledTimes(2);
  });

  it('no segments → no client connections', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await SegmentEngine.runSegmentation();
    expect(m.connect).not.toHaveBeenCalled();
  });
});

describe('SegmentEngine.getConversionMetrics', () => {
  it('passes undefined segmentId straight through as a param', async () => {
    m.query.mockResolvedValue({ rows: [] });
    await SegmentEngine.getConversionMetrics();
    expect(m.query.mock.calls[0][1]).toEqual([undefined]);
  });
});
