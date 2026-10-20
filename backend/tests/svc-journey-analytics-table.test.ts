import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[] };
const m = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));

import {
  buildAnalyticsTableQuery, getAnalyticsTablePage, wantsPaging, ANALYTICS_TABLE_SORTS,
} from '../src/services/JourneyAnalyticsTableService.js';

const WRITE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|MERGE)\b/i;

beforeEach(() => { m.query.mockReset(); });

describe('wantsPaging', () => {
  it('is false with no new params (old behaviour) and true with any of them', () => {
    expect(wantsPaging({})).toBe(false);
    expect(wantsPaging({ status: 'active' })).toBe(false);
    expect(wantsPaging({ page: '' })).toBe(false);
    for (const k of ['page', 'limit', 'search', 'sort', 'dir', 'type']) expect(wantsPaging({ [k]: '1' })).toBe(true);
  });
});

describe('buildAnalyticsTableQuery', () => {
  it('defaults to page 1, 20 rows, entries desc', () => {
    const b = buildAnalyticsTableQuery({});
    expect(b).toMatchObject({ page: 1, limit: 20, sort: 'entries', dir: 'desc' });
    expect(b.rowsParams).toEqual([20, 0]);
    expect(b.countParams).toEqual([]);
    expect(b.rowsSql).toMatch(/ORDER BY COALESCE\(s\.entries, 0\) DESC, s\.journey_id DESC LIMIT \$1 OFFSET \$2$/);
  });

  it('clamps limit to 1..200 and page to >= 1', () => {
    expect(buildAnalyticsTableQuery({ limit: '5000' }).limit).toBe(200);
    expect(buildAnalyticsTableQuery({ limit: '0' }).limit).toBe(20);
    expect(buildAnalyticsTableQuery({ limit: 'abc' }).limit).toBe(20);
    expect(buildAnalyticsTableQuery({ page: '-3' }).page).toBe(1);
    const b = buildAnalyticsTableQuery({ page: '3', limit: '50' });
    expect(b.rowsParams).toEqual([50, 100]);
  });

  it('only ever builds SELECT statements, with user text as bind values', () => {
    const evil = "x'; DROP TABLE journey_node_stats; --";
    const b = buildAnalyticsTableQuery({ status: evil, search: evil, sort: evil, dir: evil, type: evil });
    for (const sql of [b.rowsSql, b.countSql]) {
      expect(sql.trim()).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(WRITE);
      expect(sql).not.toContain(evil);
      expect(sql).not.toContain(';');
    }
    expect(b.sort).toBe('entries');
    expect(b.dir).toBe('desc');
    expect(b.countParams[0]).toBe(evil);
  });

  it('escapes LIKE wildcards in search and matches name or #id', () => {
    const b = buildAnalyticsTableQuery({ search: '  50%_off  ' });
    expect(b.countParams).toEqual(['%50\\%\\_off%']);
    expect(b.countSql).toContain(`ILIKE $1 OR ('#' || s.journey_id::text) ILIKE $1`);
  });

  it('filters by type and accepts every whitelisted sort', () => {
    expect(buildAnalyticsTableQuery({ type: 'continuous' }).countSql).toContain(`= 'gtm'`);
    expect(buildAnalyticsTableQuery({ type: 'fixed' }).countSql).toContain(`<> 'gtm'`);
    expect(buildAnalyticsTableQuery({ type: 'other' }).countSql).not.toContain('gtm');
    for (const s of ANALYTICS_TABLE_SORTS) {
      const b = buildAnalyticsTableQuery({ sort: s, dir: 'asc' });
      expect(b.sort).toBe(s);
      expect(b.rowsSql).toContain(' ASC, s.journey_id DESC');
    }
  });
});

describe('getAnalyticsTablePage', () => {
  it('returns rows plus the COUNT total', async () => {
    m.query.mockImplementation(async (sql) => (sql.includes('COUNT(*)') ? { rows: [{ total: '42' }] } : { rows: [{ journey_id: 7 }] }));
    const r = await getAnalyticsTablePage({ status: 'active', page: '2', limit: '20' });
    expect(r).toEqual({ journeys: [{ journey_id: 7 }], total: 42, page: 2, limit: 20, sort: 'entries', dir: 'desc' });
    expect(m.query).toHaveBeenCalledTimes(2);
    expect(m.query.mock.calls[0][1]).toEqual(['active', 20, 20]);
    expect(m.query.mock.calls[1][1]).toEqual(['active']);
    for (const [sql] of m.query.mock.calls) expect(sql).not.toMatch(WRITE);
  });

  it('treats a missing count as 0', async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect((await getAnalyticsTablePage({ page: '1' })).total).toBe(0);
  });
});
