import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import { StrategyService } from '../src/services/StrategyService.js';
import { SegmentService } from '../src/services/SegmentService.js';

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
});

describe('StrategyService', () => {
  it('getAll parses PG array strings into channel arrays', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: 1, channels: '{email,whatsapp}' }, { id: 2, channels: ['sms'] }, { id: 3, channels: null }, { id: 4, channels: '{}' }] });
    const rows = await StrategyService.getAll();
    expect(rows.map(r => r.channels)).toEqual([['email', 'whatsapp'], ['sms'], [], []]);
  });

  it('getById returns null and skips the campaigns query when missing', async () => {
    expect(await StrategyService.getById(5)).toBeNull();
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('getById merges campaigns', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: 5, channels: '{push}' }] }).mockResolvedValueOnce({ rows: [{ id: 9 }] });
    expect(await StrategyService.getById(5)).toEqual({ id: 5, channels: ['push'], campaigns: [{ id: 9 }] });
    expect(m.query.mock.calls[1]![1]).toEqual([5]);
  });

  it('create stringifies flowSteps and defaults to []', async () => {
    await StrategyService.create({ name: 'n', description: 'd', segmentLabel: 'S', channels: ['email'], createdBy: 'me' });
    expect(m.query.mock.calls[0]![1]).toEqual(['n', 'd', 'S', ['email'], '[]', 'me']);
  });

  it('update builds numbered SET clauses only for provided fields', async () => {
    await StrategyService.update(42, { name: 'x', flowSteps: [{ a: 1 }], status: 'active' });
    const [sql, params] = m.query.mock.calls[0]!;
    expect(sql).toBe('UPDATE omnichannel_strategies SET name = $1, flow_steps = $2::jsonb, status = $3 WHERE id = $4 RETURNING *');
    expect(params).toEqual(['x', '[{"a":1}]', 'active', 42]);
  });

  it('update with nothing to change returns null without querying', async () => {
    expect(await StrategyService.update(1, {})).toBeNull();
    expect(m.query).not.toHaveBeenCalled();
  });

  it('getBySegment passes the label as a parameter', async () => {
    await StrategyService.getBySegment("x' OR 1=1");
    expect(m.query.mock.calls[0]![0]).not.toContain("x' OR 1=1");
    expect(m.query.mock.calls[0]![1]).toEqual(["x' OR 1=1"]);
  });
});

describe('SegmentService.getSegmentCustomers', () => {
  const run = async (opts: Parameters<typeof SegmentService.getSegmentCustomers>[1], total = '120') => {
    m.query.mockImplementation(async (sql: string) => sql.includes('COUNT(*) AS total') ? { rows: [{ total }] } : { rows: [{ email: 'a' }] });
    const out = await SegmentService.getSegmentCustomers('VIP', opts);
    const data = m.query.mock.calls.find(([s]) => !s.includes('COUNT(*) AS total'))!;
    return { out, sql: data[0], params: data[1]! };
  };

  it('defaults: page 1, limit 50, frequency DESC, totalPages rounded up', async () => {
    const { out, sql, params } = await run({});
    expect(sql).toContain('ORDER BY frequency DESC NULLS LAST');
    expect(sql).toContain('LIMIT $2 OFFSET $3');
    expect(params).toEqual(['VIP', 50, 0]);
    expect(out).toMatchObject({ total: 120, page: 1, limit: 50, totalPages: 3 });
  });

  it('search is a parameterised ILIKE and shifts the limit placeholders', async () => {
    const { sql, params } = await run({ search: "o'neil", page: 3, limit: 10 });
    expect(sql).toContain('(full_name ILIKE $2 OR email ILIKE $2)');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual(['VIP', "%o'neil%", 10, 20]);
  });

  it('channel filter adds the right reachability flag', async () => {
    expect((await run({ channel: 'whatsapp' })).sql).toContain('can_whatsapp = TRUE');
    m.query.mockReset();
    expect((await run({ channel: 'fax' })).sql).not.toContain('= TRUE');
  });

  it('whitelists sortBy and sortDir (no injection)', async () => {
    const { sql } = await run({ sortBy: 'email; DROP TABLE x', sortDir: 'asc; --' });
    expect(sql).toContain('ORDER BY frequency DESC NULLS LAST');
    expect(sql).not.toContain('DROP');
    m.query.mockReset();
    expect((await run({ sortBy: 'monetary', sortDir: 'ASC' })).sql).toContain('ORDER BY monetary ASC');
  });

  it('nationality / gender lookups are parameterised', async () => {
    await SegmentService.getSegmentNationalities('A');
    await SegmentService.getSegmentGenders('B');
    expect(m.query.mock.calls.map(c => c[1])).toEqual([['A'], ['B']]);
  });
});
