import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));

import { _internals as rank } from '../src/services/Day6DestinationRankingService.js';
import { _internals as render } from '../src/services/Day6DestinationRenderer.js';
import type { Day6Ranking, DestinationSpotlight } from '../src/services/Day6DestinationDataService.js';
import type { ProductCandidate } from '../src/types/dayTemplates.js';

type Ctx = Parameters<typeof rank.validateRanking>[1];
type Buttons = Parameters<typeof render.generateHeroButtons>[0];
type Stats = Parameters<typeof render.generateStats>[0];
type Items = Parameters<typeof render.generateGridItems>[0];
type Ratings = Parameters<typeof render.generateRatings>[0];

const cand = (...ids: number[]): ProductCandidate[] => ids.map(id => ({ product_id: id, name: `P${id}`, category: 'cat' } as ProductCandidate));
const dest: DestinationSpotlight = {
  name: 'Singapore', country: 'Singapore', productCity: ['singapore'], cruiseCategory: 'sg-cruise', visaKey: null,
  heroImage: 'h', flagHtml: '', titleSplit: { title: 'S', subtitle: 's' }, taglines: ['a', 'b', 'c'],
  holidayPagePath: '/h', activitiesPath: '/a',
};
const ctx = (): Ctx => ({ dest, holidayCandidates: cand(1, 2, 3, 4, 5), activityCandidates: cand(11, 12, 13, 14), cruiseCandidates: cand(21) });

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }); });

describe('Day6 candidate fetchers', () => {
  it('holiday: wraps a single city in an array param', async () => {
    query.mockResolvedValueOnce({ rows: cand(1) });
    await expect(rank.fetchHolidayCandidates('dubai')).resolves.toEqual(cand(1));
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/type = 'holiday'/);
    expect(String(sql)).toMatch(/ANY\(\$1::text\[\]\)/);
    expect(params).toEqual([['dubai']]);
  });
  it('activity: passes city arrays through', async () => {
    await rank.fetchActivityCandidates(['singapore', 'singapore city']);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/type = 'activities'/);
    expect(params).toEqual([['singapore', 'singapore city']]);
  });
  it('cruise: null/empty category short-circuits without a query', async () => {
    await expect(rank.fetchCruiseCandidates(null)).resolves.toEqual([]);
    await expect(rank.fetchCruiseCandidates('')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  it('cruise: parameterised category', async () => {
    await rank.fetchCruiseCandidates("x'; DROP TABLE products; --");
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).not.toContain('DROP');
    expect(params).toEqual(["x'; DROP TABLE products; --"]);
  });
});

describe('Day6 buildPrompt', () => {
  it('includes candidate ids and destination name; empty pools say none', () => {
    const p = rank.buildPrompt(ctx());
    expect(p.user + p.system).toContain('product_id=21');
    expect(p.user + p.system).toContain('Singapore');
    const e = rank.buildPrompt({ dest, holidayCandidates: [], activityCandidates: [], cruiseCandidates: [] });
    expect(e.user + e.system).toContain('(none available)');
  });
});

describe('Day6 validateRanking', () => {
  const good = (): Day6Ranking => ({ holiday_ids: [1, 2, 3, 4], activity_ids: [11, 12], cruise_ids: [], tagline_index: 2 });
  it('accepts valid', () => { expect(() => rank.validateRanking(good(), ctx())).not.toThrow(); });
  it.each([null, undefined, 'x'])('rejects non-object %j', (v) => {
    expect(() => rank.validateRanking(v as unknown as Day6Ranking, ctx())).toThrow('ranking is not an object');
  });
  it('arrays required', () => {
    expect(() => rank.validateRanking({ ...good(), holiday_ids: null }, ctx())).toThrow('holiday_ids must be an array');
  });
  it('empty holiday/activity rejected when candidates exist; cruise allowed empty', () => {
    expect(() => rank.validateRanking({ ...good(), holiday_ids: [] }, ctx())).toThrow('empty but candidates exist');
    expect(() => rank.validateRanking({ ...good(), activity_ids: [] }, { ...ctx(), activityCandidates: [] })).not.toThrow();
  });
  it('duplicates and unknown ids rejected; string ids coerced', () => {
    expect(() => rank.validateRanking({ ...good(), holiday_ids: [1, 1] }, ctx())).toThrow('duplicate');
    expect(() => rank.validateRanking({ ...good(), cruise_ids: [99] }, ctx())).toThrow('99 not in candidates');
    expect(() => rank.validateRanking({ ...good(), holiday_ids: ['1', '2'] as unknown as number[] }, ctx())).not.toThrow();
  });
  it.each([-1, 3, 1.5, 'abc', Number.NaN])('tagline_index %j out of range', (i) => {
    expect(() => rank.validateRanking({ ...good(), tagline_index: i as unknown as number }, ctx())).toThrow('out of range');
  });
  it.each([0, 2, null, undefined])('tagline_index %j ok', (i) => {
    expect(() => rank.validateRanking({ ...good(), tagline_index: i }, ctx())).not.toThrow();
  });
  it('no taglines -> any index out of range', () => {
    expect(() => rank.validateRanking({ ...good(), tagline_index: 0 }, { ...ctx(), dest: { ...dest, taglines: [] } })).toThrow('[0, -1]');
  });
  // BUG: there is no upper bound on the id arrays, though only SLOT_COUNT (4) are used — 5 holiday ids pass
  // (Day6DestinationRankingService.ts:196).
  it('rejects more than SLOT_COUNT holiday ids', () => {
    expect(() => rank.validateRanking({ ...good(), holiday_ids: [1, 2, 3, 4, 5] }, ctx())).toThrow();
  });
});

describe('Day6 buildFallbackRanking', () => {
  it('takes up to SLOT_COUNT of each and validates', () => {
    const fb = rank.buildFallbackRanking(ctx());
    expect(rank.SLOT_COUNT).toBe(4);
    expect(fb.holiday_ids).toEqual([1, 2, 3, 4]);
    expect(fb.cruise_ids).toEqual([21]);
    expect(fb.tagline_index).toBe(0);
    expect(() => rank.validateRanking(fb, ctx())).not.toThrow();
  });
  it('empty pools -> empty arrays', () => {
    const fb = rank.buildFallbackRanking({ holidayCandidates: [], activityCandidates: [], cruiseCandidates: [] });
    expect([fb.holiday_ids, fb.activity_ids, fb.cruise_ids]).toEqual([[], [], []]);
  });
});

describe('Day6 renderer', () => {
  it('generateHeroButtons: gap cells between buttons only', () => {
    const b = [{ text: 'One', link: 'l1' }, { text: 'Two', link: 'l2' }, { text: 'Drei', link: 'l3' }] as unknown as Buttons;
    const html = render.generateHeroButtons(b);
    expect(html.match(/btn-gap/g)).toHaveLength(2);
    expect(render.generateHeroButtons([] as unknown as Buttons)).toBe('');
  });
  it('generateStats: border on all but last', () => {
    const s = [{ value: '1', label: 'a' }, { value: '2', label: 'b' }] as unknown as Stats;
    expect(render.generateStats(s).match(/border-right/g)).toHaveLength(1);
    expect(render.generateStats([] as unknown as Stats)).toBe('');
  });
  it('generateGridItems: one card per item with the button text', () => {
    const items = [{ image: 'i', category: 'C', title: 'T', duration: '3D', price: 'AED 9', link: 'l' }, { image: 'i', category: 'C', title: 'Ü', duration: '', price: '', link: 'l' }] as unknown as Items;
    const html = render.generateGridItems(items, 'Book →');
    expect(html.match(/grid-cell/g)).toHaveLength(2);
    expect(html.match(/Book →/g)).toHaveLength(2);
    expect(render.generateGridItems([] as unknown as Items, 'x')).not.toContain('grid-cell');
  });
  it('generateRatings: one card per platform', () => {
    const r = { platforms: [{ name: 'G', logo: 'l', stars: '★', rating: '5', reviews: '1', borderColor: '#a', bgColor: '#b', starColor: '#c' }] } as unknown as Ratings;
    const html = render.generateRatings(r);
    expect(html.match(/rating-cell/g)).toHaveLength(1);
    expect(html).toContain('border:1px solid #a');
  });
});
