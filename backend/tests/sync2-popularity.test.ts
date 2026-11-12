import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import PopularityService from '../src/services/PopularityService.js';

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status });

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('POPULARITY_API_URL', '');
  vi.stubEnv('POPULARITY_API_AUTH', '');
  vi.stubEnv('POPULARITY_API_KEY', '');
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.fetch.mockReset();
  vi.stubGlobal('fetch', m.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('runIdForBucket', () => {
  it('is deterministic per journey + UTC day and UUID-shaped (v5, RFC variant)', () => {
    const a = PopularityService.runIdForBucket(12, '2026-10-19T00:05:00Z');
    expect(PopularityService.runIdForBucket(12, '2026-10-19T23:59:59Z')).toBe(a);
    expect(PopularityService.runIdForBucket(12, '2026-10-20T00:00:00Z')).not.toBe(a);
    expect(PopularityService.runIdForBucket(13, '2026-10-19T00:05:00Z')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(PopularityService.newRunId()).not.toBe(PopularityService.newRunId());
  });
});

describe('provider()', () => {
  it('anthropic > http > simulation, and REPLACE_ME counts as unset', () => {
    expect(PopularityService.provider()).toBe('simulation');
    expect(PopularityService.isConfigured()).toBe(false);
    vi.stubEnv('POPULARITY_API_URL', 'http://pop.local/api');
    expect(PopularityService.provider()).toBe('http');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-REPLACE_ME');
    expect(PopularityService.provider()).toBe('http');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-real');
    expect(PopularityService.provider()).toBe('anthropic');
  });
});

describe('simulation products', () => {
  it('uses per-type default limits and filters by theme', async () => {
    expect(await PopularityService.fetchTopProducts({ productType: 'activity' })).toHaveLength(8);
    expect(await PopularityService.fetchTopProducts({ productType: 'cruise' })).toHaveLength(6);
    const fam = await PopularityService.fetchTopProducts({ productType: 'activity', theme: 'family', limit: 10 });
    expect(fam).toHaveLength(4);
    expect(fam[0]).toMatchObject({ product_id: null, name: 'IMG Worlds of Adventure', raw_payload: { simulated: true, theme: 'family' } });
    expect(await PopularityService.fetchTopProducts({ productType: 'nope' })).toEqual([]);
    expect(m.fetch).not.toHaveBeenCalled();
  });
});

describe('_parseRankedIndices', () => {
  it.each([
    ['{"ranked_indices":[2,0,1]}', [2, 0, 1]],
    ['```json\n{"ranked_indices":["1", 5, -1, 99]}\n```', [1, 5]],
    ['Here you go: {"ranked_indices": [3, 4]} hope it helps', [3, 4]],
    ['"ranked_indices": [7, 8, x', []],
    ['"ranked_indices": [7, 8, 100]', [7, 8]],
    ['nothing useful', []],
  ])('%j → %j', (text, out) => {
    expect(PopularityService._parseRankedIndices(text, 10)).toEqual(out);
  });
});

describe('_anthropicRank via fetchTopProducts', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-real'));

  const reply = (text: string): Response => json({
    stop_reason: 'end_turn', usage: { input_tokens: 1 },
    content: [
      { type: 'server_tool_use', name: 'web_search', input: { query: 'top dubai 2026' } },
      { type: 'web_search_tool_result', content: [{ url: 'https://a', title: 'A' }, null] },
      { type: 'text', text: 'thinking', citations: [{ url: 'https://c', title: 'C', cited_text: 'x'.repeat(300) }] },
      { type: 'text', text },
    ],
  });

  it('pool <= limit: returns catalog without calling the API', async () => {
    expect(await PopularityService.fetchTopProducts({ productType: 'activity', theme: 'icons', limit: 4 })).toHaveLength(4);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('dedupes indices, attaches the audit trail and pads from catalog order', async () => {
    m.fetch.mockResolvedValueOnce(reply('{"ranked_indices":[3,3,1]}'));
    const out = await PopularityService.fetchTopProducts({ productType: 'cruise', limit: 4, country: 'India' });
    const [url, init] = m.fetch.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(init!.body)) as { model: string; tools: Array<{ max_uses: number }>; messages: Array<{ content: string }> };
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.tools[0]!.max_uses).toBe(3);
    expect(body.messages[0]!.content).toContain('most popular RIGHT NOW for India');
    expect(out.map(p => p.name)).toEqual(['Aroya Gulf-to-Red-Sea Cruise', 'Royal Caribbean Western Med', 'Costa Smeralda Mediterranean Cruise', 'MSC Euribia North Europe']);
    expect(out[0]!.raw_payload).toMatchObject({ ranked_by: 'anthropic', rank: 1, queries: ['top dubai 2026'], sources: [{ url: 'https://a', title: 'A' }], stop_reason: 'end_turn' });
    expect((out[0]!.raw_payload as { citations: Array<{ cited_text: string }> }).citations[0]!.cited_text).toHaveLength(240);
    expect(out[1]!.raw_payload).toMatchObject({ rank: 2 });
    expect(out[2]!.raw_payload).toEqual({ ranked_by: 'catalog_fallback' });
  });

  it.each([
    ['HTTP error', () => new Response('rate limited', { status: 429 })],
    ['no text block', () => json({ content: [] })],
    ['unparseable indices', () => json({ content: [{ type: 'text', text: 'I cannot' }] })],
  ])('%s → falls back to simulation order', async (_l, res) => {
    m.fetch.mockResolvedValueOnce(res());
    const out = await PopularityService.fetchTopProducts({ productType: 'cruise', limit: 2 });
    expect(out.map(p => p.raw_payload)).toEqual([{ simulated: true, theme: null }, { simulated: true, theme: null }]);
  });
});

describe('http provider', () => {
  it('builds the URL from the template, adds missing params, sends auth and normalises', async () => {
    vi.stubEnv('POPULARITY_API_URL', 'http://pop.local/{type}/top?limit={limit}');
    vi.stubEnv('POPULARITY_API_KEY', 'k1');
    m.fetch.mockResolvedValueOnce(json({ data: [
      { id: 7, title: 'T', city: 'Dubai', sale_price: 1234.5, image: 'i', link: 'l' },
      { product_id: 8, name: 'N', price: 'From AED 9' },
      { name: 'Z' },
    ] }));
    const out = await PopularityService.fetchTopProducts({ productType: 'activity', limit: 2, country: 'AE', theme: 'icons' });
    const [url, init] = m.fetch.mock.calls[0]!;
    expect(url).toBe('http://pop.local/activity/top?limit=2&type=activity&country=AE&theme=icons');
    expect(init!.headers).toMatchObject({ Authorization: 'Bearer k1' });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ product_id: 7, name: 'T', category: 'activity', location: 'Dubai', price: 'From AED 1,234.5', image_url: 'i', product_url: 'l' });
    expect(out[1]!.price).toBe('From AED 9');
  });

  it('throws on non-2xx (no silent fallback for the http provider)', async () => {
    vi.stubEnv('POPULARITY_API_URL', 'http://pop.local/x');
    vi.stubEnv('POPULARITY_API_AUTH', 'Basic abc');
    m.fetch.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    await expect(PopularityService.fetchTopProducts({ productType: 'cruise' })).rejects.toThrow('Popularity API 503: nope');
    expect(m.fetch.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Basic abc' });
  });

  it('_normalize accepts array / products / items / garbage; _formatPrice handles currency and zero', () => {
    expect(PopularityService._normalize([{ name: 'a' }], { productType: 'x', theme: null })).toHaveLength(1);
    expect(PopularityService._normalize({ items: [{}, {}] }, { productType: 'x', theme: null })).toHaveLength(2);
    expect(PopularityService._normalize(null, { productType: 'x', theme: null })).toEqual([]);
    expect(PopularityService._formatPrice({ price_aed: 0 })).toBe('');
    expect(PopularityService._formatPrice({ starting_price: 2000, currency: 'USD' })).toBe('From USD 2,000');
  });
});

describe('snapshot / getSnapshot', () => {
  it('validates required fields', async () => {
    await expect(PopularityService.snapshot({ journeyId: 1, nodeId: 'n', runId: 'r' })).rejects.toThrow('snapshot requires');
  });

  it('writes one multi-row INSERT with 15 params per row, themes keyed _default, positions per theme', async () => {
    const rows = await PopularityService.snapshot({ journeyId: 1, nodeId: 'n1', runId: 'r1', productType: 'activity', themes: [null, 'wildlife'], limit: 2 });
    expect(rows.map(r => [r.theme, r.position])).toEqual([['_default', 1], ['_default', 2], ['wildlife', 1], ['wildlife', 2]]);
    const [sql, params] = m.query.mock.calls[0]!;
    expect(sql).toContain('ON CONFLICT (journey_id, node_id, run_id, product_type, theme, position) DO NOTHING');
    expect(sql).toContain('($46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60)');
    expect(params).toHaveLength(60);
    expect(params!.slice(0, 7)).toEqual([1, 'n1', 'r1', 'activity', '_default', 1, null]);
    expect(params![14]).toBe('{"simulated":true,"theme":"thrill"}');
  });

  it('no products → no INSERT', async () => {
    expect(await PopularityService.snapshot({ journeyId: 1, nodeId: 'n', runId: 'r', productType: 'unknown' })).toEqual([]);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('getSnapshot groups rows by theme, null → _default', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ theme: null, position: 1 }, { theme: 'family', position: 1 }, { theme: '', position: 2 }] });
    const map = await PopularityService.getSnapshot({ journeyId: 1, nodeId: 'n', runId: 'r', productType: 'activity' });
    expect([...map.keys()]).toEqual(['_default', 'family']);
    expect(map.get('_default')).toHaveLength(2);
    expect(m.query.mock.calls[0]![1]).toEqual([1, 'n', 'r', 'activity']);
  });
});
