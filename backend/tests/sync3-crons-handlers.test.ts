import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type QResult = { rows: unknown[]; rowCount?: number | null };
type QueryFn = (sql: string, params?: unknown[]) => Promise<QResult>;
interface FakeClient { query: ReturnType<typeof vi.fn<QueryFn>>; release: ReturnType<typeof vi.fn<() => void>> }

const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>>(),
  connect: vi.fn(),
  transaction: vi.fn(),
  computeCategoryPicks: vi.fn<(c: string) => Promise<{ source: string; productIds: number[]; candidates: number }>>(),
  computeForUser: vi.fn<(a: { unifiedId: number; recommendationType: string; topN: number }) => Promise<unknown>>(),
  gtmTriggerEvents: vi.fn<(j: unknown) => Promise<string[] | null>>(),
  gtmFanout: vi.fn<(j: unknown) => Promise<number | null>>(),
  resolveMarket: vi.fn<(c: Record<string, string>) => { plan: string; currency: string }>(),
  segGetById: vi.fn<(id: number) => Promise<{ conditions: unknown[] } | null>>(),
  segBuild: vi.fn<(c: unknown[], o: unknown) => { sql: string; params: unknown[] }>(),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.query, connect: m.connect },
  query: m.query,
  transaction: m.transaction,
}));
vi.mock('../src/services/CategoryPicksService.js', () => ({
  computeCategoryPicks: m.computeCategoryPicks,
  CATEGORY_MAP: { cruises: ['Cruise'], holidays: ['Holiday', "Kid's Tour"], activities: ['Tour', 'Cruise'] },
}));
vi.mock('../src/services/RecommendationRankingService.js', () => ({ computeForUser: m.computeForUser }));
vi.mock('../src/services/JourneyService.js', () => ({
  default: { _gtmTriggerEvents: m.gtmTriggerEvents, _gtmFanout: m.gtmFanout },
}));
vi.mock('../src/utils/marketPlan.js', () => ({ resolveMarket: m.resolveMarket }));
vi.mock('../src/services/CustomSegmentService.js', () => ({
  default: { getById: m.segGetById, buildSegmentSQL: m.segBuild },
}));

const fetchMock = vi.fn<(url: string, init?: Record<string, unknown>) => Promise<Response>>();

const bodyType = (init?: Record<string, unknown>): string => (JSON.parse(String(init?.body)) as { type: string }).type;
const jsonRes = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
});

function fakeClient(handler: QueryFn): FakeClient {
  return { query: vi.fn<QueryFn>(handler), release: vi.fn<() => void>() };
}

// ─────────────────────────── registrationDataSync ───────────────────────────
describe('registrationDataSync', () => {
  const okEmpty = () => jsonRes({ data: { records: [], count: 0 } });

  it('fetches the last 7 Dubai days for all three types and records success', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T21:00:00Z')); // 01:00 on the 19th in Dubai
    fetchMock.mockImplementation(async () => okEmpty());
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const r = await runRegistrationDataSync();
    expect(r.toDate).toBe('2026-10-19');
    expect(r.fromDate).toBe('2026-10-12');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const types = fetchMock.mock.calls.map(c => bodyType(c[1]));
    expect(types).toEqual(['affiliate', 'guestuser', 'agent']);
    const meta = m.query.mock.calls.filter(c => c[0].includes('sync_metadata'));
    expect(meta.map(c => c[1]?.[0])).toEqual(['registration_affiliate_sync', 'registration_guestuser_sync', 'registration_agent_sync']);
    expect(meta.every(c => c[1]?.[2] === 'success')).toBe(true);
  });

  it('retries a failing API 3 times with backoff, records an error, and keeps going with other types', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockImplementation(async (_u, init) => {
      const type = bodyType(init);
      if (type === 'affiliate') return new Response('boom', { status: 500 });
      return okEmpty();
    });
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const p = runRegistrationDataSync();
    await vi.advanceTimersByTimeAsync(5000 + 10000 + 10);
    const r = await p;
    expect(fetchMock.mock.calls.filter(c => String(c[1]?.body).includes('affiliate'))).toHaveLength(3);
    expect(r.results[0]).toMatchObject({ type: 'affiliate' });
    expect('error' in r.results[0] ? r.results[0].error : '').toContain('HTTP 500');
    expect(r.results).toHaveLength(3);
    const errMeta = m.query.mock.calls.find(c => c[1]?.[0] === 'registration_affiliate_sync');
    expect(errMeta?.[1]?.[2]).toBe('error');
    expect(errSpy).toHaveBeenCalled();
  });

  it('treats a count/records mismatch as an unexpected payload', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockImplementation(async () => jsonRes({ data: { records: [{}], count: 5 } }));
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const p = runRegistrationDataSync({ dryRun: true });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(r.results.every(x => 'error' in x && x.error === 'unexpected payload')).toBe(true);
    // dry run never writes sync_metadata
    expect(m.query).not.toHaveBeenCalled();
  });

  it('sync_metadata write failure is only a warning', async () => {
    fetchMock.mockImplementation(async () => okEmpty());
    m.query.mockRejectedValue(new Error('db down'));
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const r = await runRegistrationDataSync();
    expect(r.results).toHaveLength(3);
    expect(warnSpy).toHaveBeenCalled();
  });

  function recordsFor(type: string): Record<string, unknown>[] {
    if (type !== 'affiliate') return [];
    return [
      { AffiliateId: 1, Name: 'New', Phone: ' +0971501234567 ', Created: '2026-10-10T08:00:00.5', Extra: 'x' },
      { AffiliateId: 2, Name: 'Same', Phone: '971', Created: '2026-10-10T08:00:00', Extra: 'x' },
      { AffiliateId: 3, Name: 'Changed', Phone: '971', Created: '2026-10-10T08:00:00', Extra: 'x' },
      { AffiliateId: 4, Name: 'A', Phone: '1', Created: '2026-01-01T00:00:00', Email: 'a@x.io', Extra: 'x' },
    ];
  }
  const COLS = ['id', 'affiliateId', 'Name', 'Phone', 'Created', 'Email'].map(column_name => ({ column_name }));
  const EXISTING = [
    { id: 'r2', affiliateId: '2', Name: 'Same', Phone: '971', Created: '2026-10-10 08:00:00' },
    { id: 'r3', affiliateId: '3', Name: 'Old', Phone: '971', Created: '2026-10-10 08:00:00' },
    { id: 'r4', affiliateId: '4', Name: 'Z', Phone: '9', Created: '2025-01-01 00:00:00', Email: 'b@x.io' },
  ];
  const regHandler = (existing: unknown[]): QueryFn => async (sql) => {
    if (sql.includes('information_schema')) return { rows: COLS };
    if (sql.startsWith('SELECT *')) return { rows: existing };
    return { rows: [], rowCount: 1 };
  };
  const fetchRecords = () => fetchMock.mockImplementation(async (_u, init) => {
    const recs = recordsFor(bodyType(init));
    return jsonRes({ data: { records: recs, count: recs.length } });
  });

  it('dry run: classifies insert / unchanged / update / skipped (>3 overwrites) without writing', async () => {
    fetchRecords();
    // r4 would overwrite 4 non-empty values → skipped for manual review
    const client = fakeClient(regHandler(EXISTING));
    m.connect.mockResolvedValue(client);
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const r = await runRegistrationDataSync({ dryRun: true });
    const aff = r.results[0];
    expect(aff).toMatchObject({ type: 'affiliate', fetched: 4, inserted: 1, updated: 1, unchanged: 1, skipped: 1 });
    expect(client.query.mock.calls.some(c => /LOCK|UPDATE|INSERT/.test(c[0]))).toBe(false);
    expect(client.release).toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
    // unknown API field logged
    expect(warnSpy.mock.calls.some(c => String(c[0]).includes('Extra'))).toBe(true);
  });

  it('real run: locks the table, writes UPDATEs and a normalised INSERT inside a transaction', async () => {
    fetchRecords();
    const client = fakeClient(regHandler(EXISTING));
    m.transaction.mockImplementation(async (fn: (c: FakeClient) => Promise<void>) => fn(client));
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    await runRegistrationDataSync();
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls[0]).toBe('LOCK TABLE affiliate_data IN SHARE ROW EXCLUSIVE MODE');
    const ins = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO affiliate_data'));
    expect(ins?.[1]).toEqual(['1', 'New', '971501234567', '2026-10-10 08:00:00.500000']);
    const upd = client.query.mock.calls.filter(c => c[0].startsWith('UPDATE affiliate_data'));
    expect(upd.map(c => c[1]?.[0])).toEqual(['r3']);
  });

  it('refuses to sync a table that already holds duplicate ids', async () => {
    fetchRecords();
    const client = fakeClient(regHandler([EXISTING[0], { ...EXISTING[0], id: 'dup' }]));
    m.transaction.mockImplementation(async (fn: (c: FakeClient) => Promise<void>) => fn(client));
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const r = await runRegistrationDataSync();
    expect('error' in r.results[0] ? r.results[0].error : '').toContain('duplicate');
  });

  it('errors when the API records lack the id field', async () => {
    fetchMock.mockImplementation(async (_u, init) => {
      const t = bodyType(init);
      return t === 'agent' ? jsonRes({ data: { records: [{ foo: 1 }], count: 1 } }) : okEmpty();
    });
    const { runRegistrationDataSync } = await import('../src/crons/registrationDataSync.js');
    const r = await runRegistrationDataSync();
    expect(r.results[2]).toEqual({ type: 'agent', error: 'API records have no "AgentID" field' });
  });
});

// ─────────────────────────── fxRatesSync ───────────────────────────
describe('fxRatesSync', () => {
  it('upserts valid rates and skips out-of-bounds / non-ISO codes', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: 'success', rates: { AED: 1, INR: 22.7, USD: 5, EUR: 0.25, xx: 3, ZZZ: -1, ABC: 'n/a' } }));
    const { runFxRatesSync } = await import('../src/crons/fxRatesSync.js');
    const r = await runFxRatesSync();
    expect(r).toEqual({ ok: true, updated: 3, skipped: 4 });
    expect(m.query.mock.calls.map(c => c[1]?.[0])).toEqual(['AED', 'INR', 'EUR']);
  });

  it('keeps existing rates when the API says error', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: 'error' }));
    const { runFxRatesSync } = await import('../src/crons/fxRatesSync.js');
    expect(await runFxRatesSync()).toEqual({ ok: false, error: 'bad response: error' });
    expect(m.query).not.toHaveBeenCalled();
  });

  it('survives network failure and malformed JSON', async () => {
    const { runFxRatesSync } = await import('../src/crons/fxRatesSync.js');
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect((await runFxRatesSync()).ok).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect((await runFxRatesSync()).ok).toBe(false);
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it('a single upsert failure is logged and does not stop the rest', async () => {
    fetchMock.mockResolvedValue(jsonRes({ result: 'success', rates: { AED: 1, EUR: 0.25 } }));
    m.query.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ rows: [] });
    const { runFxRatesSync } = await import('../src/crons/fxRatesSync.js');
    expect(await runFxRatesSync()).toEqual({ ok: true, updated: 1, skipped: 0 });
  });
});

// ─────────────────────────── contactMarketRefresh ───────────────────────────
describe('contactMarketRefresh', () => {
  it('resolves each distinct mobile_country / country once, then defaults and is_indian override last', async () => {
    m.resolveMarket.mockImplementation(c => (c.mobile_country === 'IN' || c.country === 'India') ? { plan: 'IN', currency: 'INR' } : { plan: 'AE', currency: 'AED' });
    m.query.mockImplementation(async (sql) => {
      if (sql.includes('DISTINCT mobile_country')) return { rows: [{ mobile_country: 'IN' }, { mobile_country: 'AE' }] };
      if (sql.includes('DISTINCT country')) return { rows: [{ country: 'India' }] };
      return { rows: [], rowCount: 2 };
    });
    const { runContactMarketRefresh } = await import('../src/crons/contactMarketRefresh.js');
    const r = await runContactMarketRefresh();
    expect(r).toEqual({ ok: true, mobileCountries: 2, countryFallbacks: 1, changed: 10 });
    const updates = m.query.mock.calls.filter(c => c[0].includes('UPDATE unified_contacts'));
    expect(updates).toHaveLength(5);
    expect(updates[3][1]).toEqual(['default', 'AED']);
    expect(updates[4][0]).toContain('is_indian = true');
    expect(updates[4][1]).toEqual(['IN', 'INR']);
  });

  it('a DB error propagates (server.ts wrapper logs it)', async () => {
    m.query.mockRejectedValue(new Error('down'));
    const { runContactMarketRefresh } = await import('../src/crons/contactMarketRefresh.js');
    await expect(runContactMarketRefresh()).rejects.toThrow('down');
  });
});

// ─────────────────────────── dailyCategoryPicksCompute ───────────────────────────
describe('dailyCategoryPicksCompute', () => {
  it('computes all three categories; one failure is logged and does not stop the others', async () => {
    m.computeCategoryPicks.mockImplementation(async (c) => {
      if (c === 'holidays') throw new Error('claude 529');
      return { source: 'claude', productIds: [1, 2], candidates: 9 };
    });
    const { runDailyCategoryPicksCompute } = await import('../src/crons/dailyCategoryPicksCompute.js');
    const r = await runDailyCategoryPicksCompute();
    expect(r).toEqual([
      { category: 'activities', ok: true, source: 'claude' },
      { category: 'holidays', ok: false, error: 'claude 529' },
      { category: 'cruises', ok: true, source: 'claude' },
    ]);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────── dailyContinuousReEnroll ───────────────────────────
describe('dailyContinuousReEnroll', () => {
  it('skips event-triggered journeys, fans out per-user ones, and counts errors', async () => {
    m.query.mockResolvedValue({ rows: [{ journey_id: 1, name: 'evt' }, { journey_id: 2, name: 'seg' }, { journey_id: 3, name: 'bad' }, { journey_id: 4, name: 'zero' }] });
    m.gtmTriggerEvents.mockImplementation(async (j) => ((j as { journey_id: number }).journey_id === 1 ? ['purchase'] : []));
    m.gtmFanout.mockImplementation(async (j) => {
      const id = (j as { journey_id: number }).journey_id;
      if (id === 3) throw new Error('boom');
      return id === 2 ? 7 : null;
    });
    const { runDailyContinuousReEnroll } = await import('../src/crons/dailyContinuousReEnroll.js');
    expect(await runDailyContinuousReEnroll()).toEqual({ perUserJourneys: 2, added: 7, eventSkipped: 1, errors: 1 });
    expect(m.gtmFanout).toHaveBeenCalledTimes(3);
    expect(m.query.mock.calls[0][0]).toContain("journey_type = 'gtm'");
  });
});

// ─────────────────────────── dailyJourneyReSnapshot ───────────────────────────
describe('dailyJourneyReSnapshot', () => {
  it('handles custom-segment, standard-segment, no-segment and failing journeys', async () => {
    m.segGetById.mockImplementation(async (id) => (id === 99 ? null : { conditions: [] }));
    m.segBuild.mockReturnValue({ sql: 'SELECT 1', params: ['p1'] });
    m.query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM journey_flows')) return { rows: [
        { journey_id: 1, name: 'c', recommendation_type: 'on_trip', custom_segment_id: 5, audience: 'indian', nodes: [{ id: 'n1' }] },
        { journey_id: 2, name: 's', recommendation_type: 'future_trip', segment_id: 8, audience: 'rest', nodes: null },
        { journey_id: 3, name: 'none', recommendation_type: 'on_trip' },
        { journey_id: 4, name: 'missing', recommendation_type: 'on_trip', custom_segment_id: 99 },
        { journey_id: 5, name: 'err', recommendation_type: 'on_trip', segment_id: 1 },
      ] };
      if (sql.includes('INSERT INTO journey_entries') && params?.[0] === 5) throw new Error('insert failed');
      if (sql.includes('INSERT INTO journey_entries')) return { rows: [], rowCount: 4 };
      return { rows: [], rowCount: 1 };
    });
    const { runDailyJourneyReSnapshot } = await import('../src/crons/dailyJourneyReSnapshot.js');
    const r = await runDailyJourneyReSnapshot();
    expect(r).toEqual([
      { journey_id: 1, added: 4 }, { journey_id: 2, added: 4 }, { journey_id: 3, added: 0 },
      { journey_id: 4, added: 0 }, { journey_id: 5, error: 'insert failed' },
    ]);
    const inserts = m.query.mock.calls.filter(c => c[0].includes('INSERT INTO journey_entries'));
    expect(inserts[0][0]).toContain('seg.is_indian = true');
    expect(inserts[0][1]).toEqual(['p1', 1, 'n1']);
    expect(inserts[1][0]).toContain('uc.is_indian = false');
    expect(inserts[1][1]).toEqual([2, 'node_0', 8]);
  });
});

// ─────────────────────────── dailyPastTripCompute ───────────────────────────
describe('dailyPastTripCompute', () => {
  it('builds the reverse category map (priority cruises>holidays>activities, quotes escaped) in one SQL', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 12 }).mockResolvedValueOnce({ rows: [{ source: 'claude', count: '12' }] });
    const { runDailyPastTripCompute } = await import('../src/crons/dailyPastTripCompute.js');
    const r = await runDailyPastTripCompute();
    expect(r.inserted).toBe(12);
    const sql = m.query.mock.calls[0][0];
    expect(sql).toContain("VALUES ('Cruise', 'cruises'), ('Holiday', 'holidays'), ('Kid''s Tour', 'holidays'), ('Tour', 'activities')");
    expect(sql).not.toContain("('Cruise', 'activities')");
  });

  it('null rowCount counts as 0', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: null }).mockResolvedValueOnce({ rows: [] });
    const { runDailyPastTripCompute } = await import('../src/crons/dailyPastTripCompute.js');
    expect((await runDailyPastTripCompute()).inserted).toBe(0);
  });
});

// ─────────────────────────── dailyRecommendationCompute ───────────────────────────
describe('dailyRecommendationCompute', () => {
  it('computes per type, counting computed / skipped / failed; a type-level DB error aborts only that type', async () => {
    m.query.mockImplementation(async (_sql, params) => {
      if (params?.[0] === 'future_trip') throw new Error('timeout');
      return { rows: [{ unified_id: 1 }, { unified_id: 2 }, { unified_id: 3 }] };
    });
    m.computeForUser.mockImplementation(async ({ unifiedId }) => {
      if (unifiedId === 2) return null;
      if (unifiedId === 3) throw new Error('claude');
      return { ok: true };
    });
    const { runDailyRecommendationCompute } = await import('../src/crons/dailyRecommendationCompute.js');
    const r = await runDailyRecommendationCompute();
    expect(r[0]).toMatchObject({ recommendationType: 'on_trip', computed: 1, skipped: 1, failed: 1 });
    expect(r[1]).toEqual({ recommendationType: 'future_trip', error: 'timeout' });
    expect(r[2]).toMatchObject({ recommendationType: 'past_trip', computed: 1 });
    expect(m.query.mock.calls[0][1]).toEqual(['on_trip', 'ON_TRIP', 2000]);
    expect(m.computeForUser.mock.calls[0][0]).toEqual({ unifiedId: 1, recommendationType: 'on_trip', topN: 15 });
    expect(m.computeForUser.mock.calls.find(c => c[0].recommendationType === 'past_trip')?.[0].topN).toBe(5);
  });
});

// ─────────────────────────── weeklyProductUrlHealthCheck ───────────────────────────
describe('weeklyProductUrlHealthCheck', () => {
  it('flips only definitive 404/410, retries transport errors, falls back HEAD→GET on 405', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    m.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT product_id')) return { rows: [
        { product_id: 1, url: 'https://x/ok' }, { product_id: 2, url: 'https://x/dead' },
        { product_id: 3, url: 'https://x/gone' }, { product_id: 4, url: 'https://x/net' },
        { product_id: 5, url: 'https://x/head' }, { product_id: 6, url: 'https://x/5xx' },
      ] };
      if (sql.includes('UPDATE products')) return { rows: [], rowCount: 2 };
      return { rows: [] };
    });
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/ok')) return new Response(null, { status: 200 });
      if (url.endsWith('/dead')) return new Response(null, { status: 404 });
      if (url.endsWith('/gone')) return new Response(null, { status: 410 });
      if (url.endsWith('/net')) throw new Error('ECONNREFUSED');
      if (url.endsWith('/head')) return new Response(null, { status: init?.method === 'HEAD' ? 405 : 200 });
      return new Response(null, { status: 503 });
    });
    const { runWeeklyProductUrlHealthCheck } = await import('../src/crons/weeklyProductUrlHealthCheck.js');
    const p = runWeeklyProductUrlHealthCheck();
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(r).toMatchObject({ checked: 6, ok: 2, dead: 2, transportError: 1, other: 1, flipped: 2 });
    expect(fetchMock.mock.calls.filter(c => c[0].endsWith('/net'))).toHaveLength(4); // 1 + 3 retries
    const upd = m.query.mock.calls.find(c => c[0].includes('UPDATE products'));
    expect(upd?.[1]).toEqual([[2, 3]]);
    expect(m.query.mock.calls.some(c => c[0].includes('sync_metadata'))).toBe(true);
  });

  it('skips the UPDATE when nothing is dead; metadata failure only warns', async () => {
    m.query.mockImplementation(async (sql) => {
      if (sql.includes('sync_metadata')) throw new Error('meta');
      return { rows: [] };
    });
    const { runWeeklyProductUrlHealthCheck } = await import('../src/crons/weeklyProductUrlHealthCheck.js');
    const r = await runWeeklyProductUrlHealthCheck();
    expect(r.flipped).toBe(0);
    expect(m.query.mock.calls.some(c => c[0].includes('UPDATE products'))).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });
});
