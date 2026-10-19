import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => {
  // Make sure the module never gets an API key (callClaude must short-circuit).
  delete process.env.ANTHROPIC_API_KEY;
  return {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
    fetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => { throw new Error('network disabled'); }),
  };
});

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.stubGlobal('fetch', m.fetch);

import { AnalyticsInsights, Copywriter } from '../src/services/AIAgents.js';

interface Strat { id: number; name: string; channels: string[] | null; campaign_count: string; avg_delivery: string | null; avg_open: string | null; avg_click: string | null }
const strat = (o: Partial<Strat>): Strat => ({ id: 1, name: 'S', channels: ['email'], campaign_count: '1', avg_delivery: null, avg_open: null, avg_click: null, ...o });

function withStrategies(rows: Strat[]) {
  m.query.mockImplementation(async (sql: string) => (sql.includes('FROM omnichannel_strategies os') ? { rows } : { rows: [] }));
}
const updates = () => m.query.mock.calls.filter(([s]) => s.startsWith('UPDATE omnichannel_strategies'));
const logs = () => m.query.mock.calls.filter(([s]) => s.includes('INSERT INTO ai_agent_logs'));

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.fetch.mockClear();
});

describe('AnalyticsInsights.autoOptimizeStrategies', () => {
  it('no strategies → nothing analysed, no writes', async () => {
    withStrategies([]);
    expect(await AnalyticsInsights.autoOptimizeStrategies()).toEqual({ strategies_analyzed: 0, optimized: [] });
    expect(updates()).toHaveLength(0);
  });

  it('all-null rates produce no suggestions (null is not < 70)', async () => {
    withStrategies([strat({})]);
    const r = await AnalyticsInsights.autoOptimizeStrategies();
    expect(r.strategies_analyzed).toBe(1);
    expect(r.optimized).toEqual([]);
    expect(updates()).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });

  it('all low rates → 3 suggestions, score 40, parameterised update', async () => {
    withStrategies([strat({ id: 9, avg_delivery: '50', avg_open: '10', avg_click: '1' })]);
    const r = await AnalyticsInsights.autoOptimizeStrategies();
    expect(r.optimized[0].score).toBe(40);
    expect(r.optimized[0].suggestions.map(s => s.type)).toEqual(['channel_change', 'content_change', 'flow_change']);
    const [sql, params] = updates()[0];
    expect(sql).toContain('WHERE id = $3');
    expect(params?.[0]).toBe(40);
    expect(params?.[2]).toBe(9);
    expect(logs()).toHaveLength(1);
  });

  it('mixed null + low: only measured rates judged', async () => {
    withStrategies([strat({ avg_delivery: null, avg_open: null, avg_click: '0' })]);
    const r = await AnalyticsInsights.autoOptimizeStrategies();
    expect(r.optimized[0].suggestions.map(s => s.type)).toEqual(['flow_change']);
    expect(r.optimized[0].score).toBe(80);
  });

  it('boundaries: exactly 70 / 15 / 3 are not low', async () => {
    withStrategies([strat({ avg_delivery: '70', avg_open: '15', avg_click: '3' })]);
    expect((await AnalyticsInsights.autoOptimizeStrategies()).optimized).toEqual([]);
  });

  it('just below boundaries are low', async () => {
    withStrategies([strat({ avg_delivery: '69.99', avg_open: '14.999', avg_click: '2.9' })]);
    expect((await AnalyticsInsights.autoOptimizeStrategies()).optimized[0].suggestions).toHaveLength(3);
  });

  it('low open rate ignored when channels lacks email or is null', async () => {
    withStrategies([strat({ id: 1, avg_open: '1', channels: ['whatsapp'] }), strat({ id: 2, avg_open: '1', channels: null })]);
    expect((await AnalyticsInsights.autoOptimizeStrategies()).optimized).toEqual([]);
  });

  it('channel match is case-sensitive ("EMAIL" not matched)', async () => {
    withStrategies([strat({ avg_open: '1', channels: ['EMAIL'] })]);
    expect((await AnalyticsInsights.autoOptimizeStrategies()).optimized).toEqual([]);
  });

  it('empty / non-numeric rate strings are treated as missing (null), never "low"', async () => {
    withStrategies([strat({ avg_delivery: 'abc', avg_open: '', avg_click: 'NaN' })]);
    const r = await AnalyticsInsights.autoOptimizeStrategies();
    expect(r.optimized.flatMap(o => o.suggestions)).toEqual([]);
  });

  it('zero and negative rates count as low', async () => {
    withStrategies([strat({ avg_delivery: '0', avg_open: '-1', avg_click: '-5' })]);
    expect((await AnalyticsInsights.autoOptimizeStrategies()).optimized[0].score).toBe(40);
  });

  it('never calls the network', async () => {
    withStrategies([strat({ avg_click: '1' })]);
    await AnalyticsInsights.autoOptimizeStrategies();
    expect(m.fetch).not.toHaveBeenCalled();
  });
});

describe('Copywriter._fallbackContent', () => {
  it('picks channel + priority template', () => {
    expect(Copywriter._fallbackContent({ priority: 'Critical' }, 'sms', 'x').body).toContain('20% OFF');
  });
  it('unknown channel → email, unknown/missing priority → Medium', () => {
    expect(Copywriter._fallbackContent({}, 'fax', 'x').subject).toBe('What is New at Rayna Tours');
    expect(Copywriter._fallbackContent({ priority: 'critical' }, 'EMAIL', 'x').subject).toBe('What is New at Rayna Tours');
  });
});
