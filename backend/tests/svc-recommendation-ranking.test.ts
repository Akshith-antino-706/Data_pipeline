import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RecoCandidateRow } from '../src/types/productsReco.js';

const { query, findFor, journeyCategoryFor, getPicksForCategory } = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>(), findFor: vi.fn(), journeyCategoryFor: vi.fn(), getPicksForCategory: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));
vi.mock('../src/services/BookingLookupService.js', () => ({ findFor, default: { findFor } }));
vi.mock('../src/services/CategoryPicksService.js', () => ({ journeyCategoryFor, getPicksForCategory }));

import { rankRecommendations, getForUser, computeForUser } from '../src/services/RecommendationRankingService.js';

const cand = (id: number): RecoCandidateRow => ({ product_id: id, name: `P${id}`, category: 'tours', city: 'X', country: 'Y', image_url: 'i', url: 'u', sale_price: String(1000 - id), normal_price: null });
const many = (n: number, start = 1) => Array.from({ length: n }, (_, i) => cand(start + i));

const fetchMock = vi.fn<typeof fetch>();
const savedKey = process.env.ANTHROPIC_API_KEY;
let cityRows: RecoCandidateRow[] = [];
let frozen: unknown[] = [];

beforeEach(() => {
  cityRows = many(12);
  frozen = [];
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('journey_node_rankings') && sql.trim().startsWith('SELECT')) return { rows: frozen };
    if (sql.includes('FROM products') && sql.includes('LOWER(TRIM(city)) = LOWER(TRIM($1))') && sql.includes('LIMIT $4')) return { rows: cityRows };
    return { rows: [] };
  });
  findFor.mockReset(); journeyCategoryFor.mockReset(); getPicksForCategory.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  delete process.env.ANTHROPIC_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
});

const claudeReply = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });

describe('rankRecommendations', () => {
  it.each(['', undefined])('requires destinationCity (%j)', async (c) => {
    await expect(rankRecommendations({ destinationCity: c })).rejects.toThrow('destinationCity is required');
  });

  it('no API key -> fallback with top-N candidates; never calls fetch', async () => {
    const r = await rankRecommendations({ destinationCity: 'CityNoKey', topN: 3 });
    expect(r.productIds).toEqual([1, 2, 3]);
    expect(r.source).toBe('fallback');
    expect(r.rationale).toMatch(/ANTHROPIC_API_KEY not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes city, excluded id (as string), category block-list and limit as params', async () => {
    await rankRecommendations({ destinationCity: 'CityParams', excludeProductId: 77 });
    const [, params] = query.mock.calls[0] ?? [];
    expect(params).toEqual(['CityParams', '77', expect.arrayContaining(['visa', 'hotels', 'transfers']), 100]);
  });

  it('no candidates anywhere -> empty fallback', async () => {
    cityRows = [];
    const r = await rankRecommendations({ destinationCity: 'Nowhere' });
    expect(r).toMatchObject({ productIds: [], source: 'fallback', candidates: 0 });
  });

  it('memory cache: second identical call does not re-query; city key is case-insensitive', async () => {
    await rankRecommendations({ destinationCity: 'CacheCity' });
    const n = query.mock.calls.length;
    await rankRecommendations({ destinationCity: 'cachecity' });
    expect(query.mock.calls.length).toBe(n);
    await rankRecommendations({ destinationCity: 'CacheCity', topN: 2 });
    expect(query.mock.calls.length).toBeGreaterThan(n);
  });

  it('Claude picks are filtered to candidates, coerced, and topped up from fallback', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    fetchMock.mockResolvedValueOnce(claudeReply('```json\n{"product_ids": ["5", 999, 3], "rationale": "nice {x}"}\n```'));
    const r = await rankRecommendations({ destinationCity: 'ClaudeCity', topN: 4 });
    expect(r.source).toBe('claude');
    expect(r.productIds).toEqual([5, 3, 1, 2]);
    expect(r.rationale).toBe('nice {x} (topped up with 2 fallback)');
  });

  it('Claude returning only invalid ids -> fallback', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    fetchMock.mockResolvedValueOnce(claudeReply('{"product_ids":[999]}'));
    const r = await rankRecommendations({ destinationCity: 'BadIds', topN: 2 });
    expect(r).toMatchObject({ productIds: [1, 2], source: 'fallback' });
  });

  it.each([
    ['prose only', 'no json here', /No opening brace/],
    ['truncated', '{"product_ids":[1,2', /Unbalanced JSON/],
    ['no ids', '{"rationale":"x"}', /no product_ids/],
  ])('Claude reply %s -> fallback with error rationale', async (_n, text, re) => {
    process.env.ANTHROPIC_API_KEY = 'k';
    fetchMock.mockResolvedValueOnce(claudeReply(text));
    const r = await rankRecommendations({ destinationCity: `Err-${_n}`, topN: 1 });
    expect(r.source).toBe('fallback');
    expect(r.rationale).toMatch(re);
  });

  it('non-retryable HTTP 400 -> fallback mentioning status', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    const r = await rankRecommendations({ destinationCity: 'Http400', topN: 1 });
    expect(r.rationale).toMatch(/Anthropic 400: bad/);
  });

  it('freeze path returns an existing frozen ranking without ranking again', async () => {
    const existing = { productIds: [42], source: 'claude', candidates: 1, rationale: 'frozen' };
    frozen = [{ ranking: existing }];
    const r = await rankRecommendations({ destinationCity: 'Any', journeyId: 1, nodeId: 'n1' });
    expect(r).toEqual(existing);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([1, 'n1', 'recommendation']);
  });

  it('freeze path inserts with ON CONFLICT DO NOTHING then re-reads', async () => {
    const r = await rankRecommendations({ destinationCity: 'Freeze', journeyId: 2, nodeId: 'n2', topN: 2 });
    const insert = query.mock.calls.find(c => String(c[0]).includes('INSERT INTO journey_node_rankings'));
    expect(String(insert?.[0])).toMatch(/DO NOTHING/);
    expect(insert?.[1]?.[0]).toBe(2);
    expect(JSON.parse(String(insert?.[1]?.[3]))).toEqual(r);
    expect(r.productIds).toEqual([1, 2]);
  });
});

describe('getForUser', () => {
  it.each([[{}], [{ unifiedId: 1 }], [{ recommendationType: 'on_trip' }]])('missing args %j -> null, no query', async (a) => {
    await expect(getForUser(a)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it('no row -> null; filters expired rows in SQL', async () => {
    await expect(getForUser({ unifiedId: 1, recommendationType: 'on_trip' })).resolves.toBeNull();
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/expires_at > NOW\(\)/);
    expect(params).toEqual([1, 'on_trip']);
  });
  it('maps row to camelCase; non-array product_ids falls back', async () => {
    query.mockResolvedValueOnce({ rows: [{ unified_id: 1, recommendation_type: 'on_trip', based_on_booking_id: null, based_on_product_id: 5, destination_city: 'Paris', product_ids: [1, 2], source: 'claude', rationale: 'r', computed_at: 'c', expires_at: 'e' }] });
    await expect(getForUser({ unifiedId: 1, recommendationType: 'on_trip' })).resolves.toMatchObject({ unifiedId: 1, basedOnProductId: 5, destinationCity: 'Paris', productIds: [1, 2] });
    query.mockResolvedValueOnce({ rows: [{ unified_id: 1, product_ids: null }] });
    await expect(getForUser({ unifiedId: 1, recommendationType: 'x' })).resolves.toMatchObject({ productIds: [] });
  });
});

describe('computeForUser', () => {
  it('validates inputs', async () => {
    await expect(computeForUser({ recommendationType: 'on_trip' })).rejects.toThrow('unifiedId is required');
    await expect(computeForUser({ unifiedId: 1, recommendationType: 'ON_TRIP' })).rejects.toThrow('Unknown recommendationType');
    await expect(computeForUser({ unifiedId: 1 })).rejects.toThrow('Unknown recommendationType');
    expect(query).not.toHaveBeenCalled();
  });

  it('on_trip without booking falls back to Dubai and upserts', async () => {
    findFor.mockResolvedValueOnce(null);
    const r = await computeForUser({ unifiedId: 9, recommendationType: 'on_trip', topN: 2 });
    expect(r).toMatchObject({ destinationCity: 'Dubai', productIds: [1, 2], source: 'fallback' });
    const up = query.mock.calls.find(c => String(c[0]).includes('INSERT INTO user_product_recommendations'));
    expect(up?.[1]?.slice(0, 7)).toEqual([9, 'on_trip', null, null, 'Dubai', '[1,2]', 'fallback']);
  });

  it('future_trip uses booking city and excludes booked product', async () => {
    findFor.mockResolvedValueOnce({ destinationCity: 'Rome', productId: 3, bookingId: 'B1' });
    await computeForUser({ unifiedId: 9, recommendationType: 'future_trip', topN: 1 });
    expect(query.mock.calls[0]?.[1]?.slice(0, 2)).toEqual(['Rome', '3']);
    const up = query.mock.calls.find(c => String(c[0]).includes('INSERT INTO user_product_recommendations'));
    expect(up?.[1]?.slice(2, 5)).toEqual(['B1', 3, 'Rome']);
  });

  it('past_trip: no picks -> null, no upsert', async () => {
    journeyCategoryFor.mockReturnValue(null);
    getPicksForCategory.mockResolvedValueOnce(null);
    await expect(computeForUser({ unifiedId: 9, recommendationType: 'past_trip' })).resolves.toBeNull();
    expect(getPicksForCategory).toHaveBeenCalledWith('activities');
    expect(query.mock.calls.some(c => String(c[0]).includes('INSERT'))).toBe(false);
  });

  it('past_trip: picks first mappable category and upserts', async () => {
    query.mockImplementationOnce(async () => ({ rows: [{ category: 'misc', n: '5' }, { category: 'cruise-x', n: '2' }] }));
    journeyCategoryFor.mockImplementation((c: string) => (c === 'cruise-x' ? 'cruises' : null));
    getPicksForCategory.mockResolvedValueOnce({ productIds: [7, 8], source: 'claude', rationale: 'r' });
    const r = await computeForUser({ unifiedId: 9, recommendationType: 'past_trip', cacheDays: 0 });
    expect(r).toMatchObject({ journeyCategory: 'cruises', productIds: [7, 8], destinationCity: 'multi-city' });
    expect(query.mock.calls[0]?.[1]).toEqual([9]);
    const up = query.mock.calls.find(c => String(c[0]).includes('INSERT INTO user_product_recommendations'));
    expect(up?.[1]?.slice(0, 4)).toEqual([9, 'cruise-x', '[7,8]', 'claude']);
    expect(String(up?.[1]?.[4])).toContain('max-booked=cruise-x');
  });
});
