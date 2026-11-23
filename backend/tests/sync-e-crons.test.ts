import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };

const m = vi.hoisted(() => {
  process.env.CONTACT_MARKET_BATCH = '2';
  process.env.URL_HEALTH_DELAY_MS = '0';
  process.env.URL_HEALTH_MAX_RETRIES = '1';
  process.env.REC_CRON_MAX_PER_TYPE = '7';
  return {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>(),
    computeCategoryPicks: vi.fn<(cat: string) => Promise<{ source: string; productIds: number[]; candidates: number }>>(),
    computeForUser: vi.fn<(a: { unifiedId: number; recommendationType: string; topN: number }) => Promise<object | null>>(),
    gtmTriggerEvents: vi.fn<(j: object) => Promise<string[]>>(),
    gtmFanout: vi.fn<(j: object) => Promise<number>>(),
    getById: vi.fn<(id: number) => Promise<{ conditions?: unknown[] } | null>>(),
    buildSegmentSQL: vi.fn<(c: unknown[], o: object) => { sql: string; params: unknown[] }>(),
  };
});

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/services/CategoryPicksService.js', () => ({
  computeCategoryPicks: m.computeCategoryPicks,
  CATEGORY_MAP: { activities: ['Tours', "Kid's Fun", 'Shared'], holidays: ['Holiday', 'Shared'], cruises: ['Cruise'] },
}));
vi.mock('../src/services/RecommendationRankingService.js', () => ({ computeForUser: m.computeForUser }));
vi.mock('../src/services/JourneyService.js', () => ({
  default: { _gtmTriggerEvents: m.gtmTriggerEvents, _gtmFanout: m.gtmFanout },
}));
vi.mock('../src/services/CustomSegmentService.js', () => ({
  default: { getById: m.getById, buildSegmentSQL: m.buildSegmentSQL },
}));

import { runContactMarketRefresh } from '../src/crons/contactMarketRefresh.js';
import { runDailyCategoryPicksCompute } from '../src/crons/dailyCategoryPicksCompute.js';
import { runDailyContinuousReEnroll } from '../src/crons/dailyContinuousReEnroll.js';
import { runDailyJourneyReSnapshot } from '../src/crons/dailyJourneyReSnapshot.js';
import { runDailyPastTripCompute } from '../src/crons/dailyPastTripCompute.js';
import { runDailyRecommendationCompute } from '../src/crons/dailyRecommendationCompute.js';
import { runFxRatesSync } from '../src/crons/fxRatesSync.js';
import { runWeeklyProductUrlHealthCheck } from '../src/crons/weeklyProductUrlHealthCheck.js';

const fetchMock = vi.fn<typeof fetch>();
const sqlCalls = (re: RegExp) => m.query.mock.calls.filter(([sql]) => re.test(sql));

beforeEach(() => {
  m.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  for (const fn of [m.computeCategoryPicks, m.computeForUser, m.gtmTriggerEvents, m.gtmFanout, m.getById, m.buildSegmentSQL]) fn.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ─────────────────────────── contactMarketRefresh ───────────────────────────
describe('runContactMarketRefresh', () => {
  it('resolves each distinct mobile_country/country once, batches until rowCount < BATCH, is_indian last', async () => {
    const updates: unknown[][] = [];
    const counts = [2, 1, 0, 0, 0, 0, 0];   // first UPDATE loops once (2 == BATCH)
    m.query.mockImplementation(async (sql: string, params?: unknown[]): Promise<Result> => {
      if (sql.includes('SELECT DISTINCT mobile_country')) return { rows: [{ mobile_country: 'India' }, { mobile_country: 'Saudi Arabia' }] };
      if (sql.includes('SELECT DISTINCT country')) return { rows: [{ country: 'United Arab Emirates' }] };
      updates.push(params ?? []);
      return { rows: [], rowCount: counts.shift() ?? 0 };
    });
    const r = await runContactMarketRefresh();
    expect(r).toEqual({ ok: true, mobileCountries: 2, countryFallbacks: 1, changed: 3 });
    expect(updates).toEqual([
      ['India', 'IN', 'INR'], ['India', 'IN', 'INR'],
      ['Saudi Arabia', 'SA', 'SAR'],
      ['United Arab Emirates', 'AE', 'AED'],
      ['default', 'AED'],
      ['IN', 'INR'],
    ]);
    const last = sqlCalls(/UPDATE unified_contacts/).at(-1)![0];
    expect(last).toContain('is_indian = true');
    expect(last).toContain('LIMIT 2');
  });

  it('empty table → only the blank + is_indian passes run', async () => {
    const r = await runContactMarketRefresh();
    expect(r).toEqual({ ok: true, mobileCountries: 0, countryFallbacks: 0, changed: 0 });
    expect(sqlCalls(/UPDATE unified_contacts/)).toHaveLength(2);
  });

  it('a DB error propagates (caller cron logs it)', async () => {
    m.query.mockRejectedValue(new Error('db down'));
    await expect(runContactMarketRefresh()).rejects.toThrow('db down');
  });
});

// ─────────────────────────── dailyCategoryPicksCompute ───────────────────────────
describe('runDailyCategoryPicksCompute', () => {
  it('computes the 3 categories in order and isolates a failure', async () => {
    m.computeCategoryPicks.mockImplementation(async (cat: string) => {
      if (cat === 'holidays') throw new Error('claude 529');
      return { source: 'claude', productIds: [1, 2], candidates: 9 };
    });
    const r = await runDailyCategoryPicksCompute();
    expect(m.computeCategoryPicks.mock.calls.map(c => c[0])).toEqual(['activities', 'holidays', 'cruises']);
    expect(r).toEqual([
      { category: 'activities', ok: true, source: 'claude' },
      { category: 'holidays', ok: false, error: 'claude 529' },
      { category: 'cruises', ok: true, source: 'claude' },
    ]);
  });
});

// ─────────────────────────── dailyContinuousReEnroll ───────────────────────────
describe('runDailyContinuousReEnroll', () => {
  it('skips event-triggered journeys, fans out per-user ones, counts errors', async () => {
    m.query.mockResolvedValue({ rows: [
      { journey_id: 1, name: 'event' }, { journey_id: 2, name: 'peruser' },
      { journey_id: 3, name: 'none-new' }, { journey_id: 4, name: 'boom' },
    ] });
    m.gtmTriggerEvents.mockImplementation(async (j: object) => ((j as { journey_id: number }).journey_id === 1 ? ['purchase'] : []));
    m.gtmFanout.mockImplementation(async (j: object) => {
      const id = (j as { journey_id: number }).journey_id;
      if (id === 4) throw new Error('fanout fail');
      return id === 2 ? 5 : 0;
    });
    const r = await runDailyContinuousReEnroll();
    expect(r).toEqual({ perUserJourneys: 2, added: 5, eventSkipped: 1, errors: 1 });
    expect(m.gtmFanout).toHaveBeenCalledTimes(3);
    expect(m.query.mock.calls[0][0]).toContain("journey_type = 'gtm'");
  });

  it('no active journeys → all zeros', async () => {
    expect(await runDailyContinuousReEnroll()).toEqual({ perUserJourneys: 0, added: 0, eventSkipped: 0, errors: 0 });
  });
});

// ─────────────────────────── dailyJourneyReSnapshot ───────────────────────────
describe('runDailyJourneyReSnapshot', () => {
  const journeys = [
    { journey_id: 10, name: 'std', recommendation_type: 'on_trip', segment_id: 3, custom_segment_id: null, audience: 'indian', nodes: [{ id: 'node_1' }] },
    { journey_id: 11, name: 'custom', recommendation_type: 'future_trip', segment_id: null, custom_segment_id: 8, audience: 'rest', nodes: null },
    { journey_id: 12, name: 'noseg', recommendation_type: 'on_trip', segment_id: null, custom_segment_id: null, audience: null, nodes: [] },
    { journey_id: 13, name: 'missing', recommendation_type: 'on_trip', segment_id: null, custom_segment_id: 99, audience: null, nodes: [] },
  ];

  it('re-enrolls via standard + custom segments with audience filters, skips missing segments', async () => {
    m.query.mockImplementation(async (sql: string): Promise<Result> => {
      if (sql.includes('FROM journey_flows')) return { rows: journeys };
      if (sql.includes('INSERT INTO journey_entries')) return { rows: [], rowCount: sql.includes('segment_customers') ? 4 : 2 };
      return { rows: [], rowCount: 1 };
    });
    m.getById.mockImplementation(async (id: number) => (id === 8 ? { conditions: [{ f: 'x' }] } : null));
    m.buildSegmentSQL.mockReturnValue({ sql: 'SELECT uc.id, uc.is_indian FROM unified_contacts uc WHERE x = $1', params: ['v'] });

    const r = await runDailyJourneyReSnapshot();
    expect(r).toEqual([
      { journey_id: 10, added: 4 }, { journey_id: 11, added: 2 },
      { journey_id: 12, added: 0 }, { journey_id: 13, added: 0 },
    ]);
    const ins = sqlCalls(/INSERT INTO journey_entries/);
    expect(ins[0][0]).toContain('AND uc.is_indian = true');
    expect(ins[0][1]).toEqual([10, 'node_1', 3]);
    expect(ins[1][0]).toContain('AND seg.is_indian = false');
    expect(ins[1][1]).toEqual(['v', 11, 'node_0']);   // custom params first, then journey + fallback node
    expect(ins[1][0]).toContain('$2, seg.id, $3');
    expect(m.buildSegmentSQL).toHaveBeenCalledWith([{ f: 'x' }], { select: 'uc.id, uc.is_indian' });
    expect(sqlCalls(/UPDATE journey_flows/).map(c => c[1])).toEqual([[10], [11]]);
  });

  it('one journey failing does not stop the rest', async () => {
    m.query.mockImplementation(async (sql: string): Promise<Result> => {
      if (sql.includes('FROM journey_flows')) return { rows: journeys.slice(0, 1).concat({ ...journeys[0], journey_id: 20 }) };
      if (sql.includes('INSERT') && m.query.mock.calls.filter(([s]) => s.includes('INSERT')).length === 1) throw new Error('deadlock');
      return { rows: [], rowCount: 1 };
    });
    const r = await runDailyJourneyReSnapshot();
    expect(r).toEqual([{ journey_id: 10, error: 'deadlock' }, { journey_id: 20, added: 1 }]);
  });

  it('no eligible journeys → empty result', async () => {
    expect(await runDailyJourneyReSnapshot()).toEqual([]);
  });
});

// ─────────────────────────── dailyPastTripCompute ───────────────────────────
describe('runDailyPastTripCompute', () => {
  it('runs one INSERT…SELECT with the reverse category map (priority cruises>holidays>activities, quotes escaped)', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 42 }).mockResolvedValueOnce({ rows: [{ source: 'claude', count: '40' }] });
    const r = await runDailyPastTripCompute();
    expect(r.inserted).toBe(42);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    const sql = m.query.mock.calls[0][0];
    expect(sql).toContain("VALUES ('Cruise', 'cruises'), ('Holiday', 'holidays'), ('Shared', 'holidays'), ('Tours', 'activities'), ('Kid''s Fun', 'activities')");
    expect(sql).toContain("INTERVAL '30 days'");
    expect(sql).toContain('ON CONFLICT (unified_id, recommendation_type) DO UPDATE');
  });

  it('null rowCount → 0 inserted', async () => {
    m.query.mockResolvedValue({ rows: [] });
    expect((await runDailyPastTripCompute()).inserted).toBe(0);
  });
});

// ─────────────────────────── dailyRecommendationCompute ───────────────────────────
describe('runDailyRecommendationCompute', () => {
  it('runs on_trip, future_trip, past_trip with status map, cap and topN; tallies outcomes', async () => {
    m.query.mockImplementation(async (_sql: string, params?: unknown[]): Promise<Result> => {
      const type = (params ?? [])[0];
      return { rows: type === 'on_trip' ? [{ unified_id: 1 }, { unified_id: 2 }, { unified_id: 3 }] : type === 'past_trip' ? [{ unified_id: 9 }] : [] };
    });
    m.computeForUser.mockImplementation(async ({ unifiedId }) => {
      if (unifiedId === 2) return null;
      if (unifiedId === 3) throw new Error('rate limit');
      return { ok: true };
    });
    const r = await runDailyRecommendationCompute();
    expect(m.query.mock.calls.map(c => c[1])).toEqual([
      ['on_trip', 'ON_TRIP', 7], ['future_trip', 'FUTURE_TRAVEL', 7], ['past_trip', 'PAST_BOOKING', 7],
    ]);
    expect(r).toEqual([
      expect.objectContaining({ recommendationType: 'on_trip', computed: 1, skipped: 1, failed: 1 }),
      expect.objectContaining({ recommendationType: 'future_trip', computed: 0, skipped: 0, failed: 0 }),
      expect.objectContaining({ recommendationType: 'past_trip', computed: 1, skipped: 0, failed: 0 }),
    ]);
    expect(m.computeForUser).toHaveBeenCalledWith({ unifiedId: 1, recommendationType: 'on_trip', topN: 15 });
    expect(m.computeForUser).toHaveBeenCalledWith({ unifiedId: 9, recommendationType: 'past_trip', topN: 5 });
  });

  it('a failing eligibility query aborts only that type', async () => {
    m.query.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ rows: [] });
    const r = await runDailyRecommendationCompute();
    expect(r[0]).toEqual({ recommendationType: 'on_trip', error: 'timeout' });
    expect(r).toHaveLength(3);
  });
});

// ─────────────────────────── fxRatesSync ───────────────────────────
describe('runFxRatesSync', () => {
  const okRes = (rates: Record<string, unknown>) => new Response(JSON.stringify({ result: 'success', rates }));

  it('upserts in-bounds rates, skips out-of-bounds / non-ISO / non-numeric', async () => {
    fetchMock.mockResolvedValue(okRes({ AED: 1, INR: 22.7, SAR: 5, USD: 0.27, EUR: 0.25, BAD1: 3, JPY: 'abc', XYZ: -1, GBP: 0 }));
    const r = await runFxRatesSync();
    expect(r).toEqual({ ok: true, updated: 4, skipped: 5 });
    expect(sqlCalls(/INSERT INTO fx_rates/).map(c => c[1])).toEqual([['AED', 1], ['INR', 22.7], ['USD', 0.27], ['EUR', 0.25]]);
  });

  it('bad response keeps existing rates and writes nothing', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: 'error' })));
    expect(await runFxRatesSync()).toEqual({ ok: false, error: 'bad response: error' });
    expect(m.query).not.toHaveBeenCalled();
  });

  it('network failure → ok:false, no crash', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await runFxRatesSync()).toEqual({ ok: false, error: 'ENOTFOUND' });
  });

  it('one failing upsert does not stop the others', async () => {
    fetchMock.mockResolvedValue(okRes({ INR: 22, USD: 0.27 }));
    m.query.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ rows: [] });
    expect(await runFxRatesSync()).toEqual({ ok: true, updated: 1, skipped: 0 });
  });
});

// ─────────────────────────── weeklyProductUrlHealthCheck ───────────────────────────
describe('runWeeklyProductUrlHealthCheck', () => {
  it('classifies statuses, falls back HEAD→GET on 405, flips only 404/410', async () => {
    const products = [
      { product_id: 1, url: 'https://x/ok' }, { product_id: 2, url: 'https://x/404' },
      { product_id: 3, url: 'https://x/410' }, { product_id: 4, url: 'https://x/500' },
      { product_id: 5, url: 'https://x/405' }, { product_id: 6, url: 'https://x/net' },
    ];
    m.query.mockImplementation(async (sql: string): Promise<Result> => {
      if (sql.includes('SELECT product_id')) return { rows: products };
      if (sql.startsWith('UPDATE products')) return { rows: [], rowCount: 2 };
      return { rows: [] };
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/net')) throw new Error('ECONNREFUSED');
      if (url.endsWith('/405')) return new Response(null, { status: init?.method === 'HEAD' ? 405 : 200 });
      const code = Number(url.split('/').pop()) || 200;
      return new Response(null, { status: code });
    });
    const p = runWeeklyProductUrlHealthCheck();
    await vi.advanceTimersByTimeAsync(5_000);
    const r = await p;
    vi.useRealTimers();
    expect(r).toMatchObject({ checked: 6, ok: 2, dead: 2, transportError: 1, other: 1, flipped: 2 });
    expect(sqlCalls(/^UPDATE products/)[0][1]).toEqual([[2, 3]]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/net'))).toHaveLength(2);   // 1 + MAX_RETRIES
    const meta = sqlCalls(/sync_metadata/)[0];
    expect(meta[1]).toEqual([2, expect.any(Number)]);
  });

  it('nothing to check → no UPDATE, metadata still written; metadata failure swallowed', async () => {
    m.query.mockImplementation(async (sql: string): Promise<Result> => {
      if (sql.includes('sync_metadata')) throw new Error('meta');
      return { rows: [] };
    });
    const r = await runWeeklyProductUrlHealthCheck();
    expect(r).toMatchObject({ checked: 0, ok: 0, dead: 0, flipped: 0 });
    expect(sqlCalls(/^UPDATE products/)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });
});
