import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import { AIService } from '../src/services/AIService.js';
import { CATEGORY_MAP, journeyCategoryFor, computeCategoryPicks, getPicksForCategory } from '../src/services/CategoryPicksService.js';

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status });
const claude = (text: string): Response => json({ content: [{ type: 'text', text }] });

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.fetch.mockReset();
  vi.stubGlobal('fetch', m.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('AIService.generateContent', () => {
  it('without an API key uses the rule-based template and never calls fetch', async () => {
    const r = await AIService.generateContent({ channel: 'sms', segmentLabel: 'Dormant' });
    expect(r).toMatchObject({ aiGenerated: false, aiModel: 'rule-based', subject: null, ctaText: 'Learn More' });
    expect(r.body).toContain('we miss you');
    expect(m.fetch).not.toHaveBeenCalled();
    expect(m.query.mock.calls[0]![1]).toEqual(['Dormant']);
  });

  it('unknown channel falls back to email, unknown segment to _default', () => {
    const r = AIService._generateFallbackContent('fax', 'Nobody', {}, 'x');
    expect(r.subject).toBe('Dubai Awaits You, {{first_name}}!');
  });

  it('with a key: posts to the Messages API with segment context and parses embedded JSON', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    m.query.mockResolvedValueOnce({ rows: [{ size: 42, top_nationality: 'IN' }] });
    m.fetch.mockResolvedValueOnce(claude('Sure!\n{"subject":"S","body":"B","ctaText":"C","ctaUrl":"https://raynatours.com/x"}\nThanks'));
    const r = await AIService.generateContent({ channel: 'email', segmentLabel: 'VIP', goal: 'upsell' });
    const [url, init] = m.fetch.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init!.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01' });
    const prompt = (JSON.parse(String(init!.body)) as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(prompt).toContain('Size: 42 customers');
    expect(prompt).toContain('Top nationality: IN');
    expect(prompt).toContain('GOAL: upsell');
    expect(r).toMatchObject({ subject: 'S', body: 'B', aiGenerated: true });
  });

  it.each([
    ['no JSON in reply', () => claude('no json here')],
    ['malformed JSON', () => claude('{"subject": oops}')],
    ['empty content', () => json({})],
  ])('falls back to templates on %s', async (_l, res) => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    m.fetch.mockResolvedValueOnce(res());
    expect(await AIService.generateContent({ channel: 'push', segmentLabel: 'High Value' })).toMatchObject({ aiGenerated: false, subject: '🌟 VIP Offer Just For You' });
  });

  it('falls back when fetch rejects', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    m.fetch.mockRejectedValueOnce(new Error('network'));
    expect((await AIService.generateContent({ channel: 'whatsapp', segmentLabel: 'x' })).ctaText).toBe('Book Now');
  });
});

describe('AIService.optimizeStrategy', () => {
  it('returns null for missing strategy', async () => {
    expect(await AIService.optimizeStrategy(1)).toBeNull();
  });

  it('scores 85 when there is nothing to suggest', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: 1, campaign_results: [{ channel: 'email', sent: 100, delivered: 100, read: 50, clicked: 10, bounced: 0 }], flow_steps: [{}, {}] }] });
    const r = await AIService.optimizeStrategy(1);
    expect(r).toEqual({ strategyId: 1, score: 85, suggestions: [] });
    expect(m.query.mock.calls[1]![1]).toEqual([1, 85, '[]']);
  });

  it('applies bounce / delivery / open / click thresholds and subtracts 15 per suggestion', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: 2, flow_steps: [{}], campaign_results: [
      { channel: 'email', sent: 100, delivered: 80, read: 10, clicked: 1, bounced: 6 },
      { channel: 'sms', sent: 0, delivered: 0, read: 0, clicked: 0, bounced: 0 },
      null,
    ] }] });
    const r = (await AIService.optimizeStrategy(2))!;
    expect(r.suggestions.map(s => s.type)).toEqual(['content_change', 'channel_change', 'content_change', 'content_change', 'flow_change']);
    expect(r.suggestions[0]!.message).toContain('6.0%');
    expect(r.suggestions[1]!.message).toContain('80.0%');
    expect(r.score).toBe(25);
    const inserts = m.query.mock.calls.filter(([s]) => s.includes('ai_optimization_log'));
    expect(inserts).toHaveLength(5);
  });

  it('never scores below 0', async () => {
    const bad = { channel: 'email', sent: 10, delivered: 1, read: 0, clicked: 0, bounced: 9 };
    m.query.mockResolvedValueOnce({ rows: [{ id: 3, campaign_results: [bad, bad], flow_steps: [{}] }] });
    expect((await AIService.optimizeStrategy(3))!.score).toBe(0);
  });
});

describe('CategoryPicksService', () => {
  const cand = (id: number, bookings: number) => ({ product_id: id, name: `P${id}`, category: 'city-tours', city: 'Dubai', sale_price: 100, normal_price: 120, bookings_30d: bookings });
  const candidates = [cand(1, 9), cand(2, 8), cand(3, 7), cand(4, 6), cand(5, 5), cand(6, 4)];
  const routeCandidates = (rows: unknown[]): void => {
    m.query.mockImplementation(async (sql: string) => sql.includes('bookings_30d AS') || sql.includes('WITH bookings_30d') ? { rows } : { rows: [] });
  };
  const upsertParams = (): unknown[] => m.query.mock.calls.find(([s]) => s.includes('INSERT INTO daily_category_picks'))![1]!;

  it('journeyCategoryFor gives cruises precedence over activities', () => {
    expect(journeyCategoryFor('sightseeing-cruises')).toBe('cruises');
    expect(journeyCategoryFor('events-and-occasions')).toBe('holidays');
    expect(journeyCategoryFor('theme-parks')).toBe('activities');
    expect(journeyCategoryFor('unknown')).toBeNull();
    expect(journeyCategoryFor(null)).toBeNull();
  });

  it('rejects unknown categories before querying', async () => {
    await expect(computeCategoryPicks('spa')).rejects.toThrow('Unknown category: spa');
    expect(m.query).not.toHaveBeenCalled();
  });

  it('no candidates: no Claude call, no upsert', async () => {
    const r = await computeCategoryPicks('cruises');
    expect(r).toMatchObject({ source: 'no_candidates', productIds: [] });
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(m.query.mock.calls[0]![1]).toEqual([CATEGORY_MAP.cruises, 30]);
    expect(m.query.mock.calls[0]![0]).toContain("FROM rayna_others");
  });

  it('without an API key falls back to the top-N trending ids', async () => {
    routeCandidates(candidates);
    const r = await computeCategoryPicks('activities');
    expect(r).toMatchObject({ source: 'fallback_trending', productIds: [1, 2, 3, 4, 5], candidates: 6 });
    expect(upsertParams()).toEqual(['activities', '[1,2,3,4,5]', 'fallback_trending', 'Fallback after Claude error: ANTHROPIC_API_KEY not set', 6]);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('keeps only valid Claude ids, de-duplicates the padding and pads from trending', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk');
    routeCandidates(candidates);
    m.fetch.mockResolvedValueOnce(claude('```json\n{"product_ids":[6, 999, "3"],"rationale":"mix {of} things"}\n```'));
    const r = await computeCategoryPicks('activities');
    expect(r).toMatchObject({ source: 'claude', productIds: [6, 3, 1, 2, 4], rationale: 'mix {of} things' });
    const prompt = (JSON.parse(String(m.fetch.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(prompt).toContain('booked_30d=9');
    expect(prompt).toContain('CITIES REPRESENTED: Dubai');
  });

  it('non-2xx from Anthropic falls back (no retry on HTTP errors)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk');
    routeCandidates(candidates);
    m.fetch.mockResolvedValueOnce(new Response('overloaded', { status: 529 }));
    const r = await computeCategoryPicks('activities', { topN: 2 });
    expect(r).toMatchObject({ source: 'fallback_trending', productIds: [1, 2] });
    expect(r.rationale).toContain('Anthropic 529: overloaded');
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });

  it('missing product_ids array is treated as a failure', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk');
    routeCandidates(candidates);
    m.fetch.mockResolvedValueOnce(claude('{"rationale":"x"}'));
    expect((await computeCategoryPicks('activities')).source).toBe('fallback_trending');
  });

  it('getPicksForCategory: unknown → null, empty → null, maps row', async () => {
    expect(await getPicksForCategory('nope')).toBeNull();
    expect(await getPicksForCategory('holidays')).toBeNull();
    m.query.mockResolvedValueOnce({ rows: [{ product_ids: null, source: 's', rationale: 'r', computed_date: '2026-10-19', computed_at: 't' }] });
    expect(await getPicksForCategory('holidays')).toEqual({ category: 'holidays', productIds: [], source: 's', rationale: 'r', computedDate: '2026-10-19', computedAt: 't' });
  });
});
