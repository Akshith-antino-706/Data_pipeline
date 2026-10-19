import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));

import { _internals as rank } from '../src/services/Day1WelcomeRankingService.js';
import { _internals as render } from '../src/services/Day1WelcomeRenderer.js';

type Maps = Parameters<typeof rank.validateRanking>[1];
type DestMap = Maps['holidayMap'];
type Stats = Parameters<typeof render.generateStats>[0];
type Sections = Parameters<typeof render.generateCategories>[0];
type Ratings = Parameters<typeof render.generateRatings>[0];

const destMap = (prefix: string, n: number): DestMap => {
  const out: Record<string, { name: string; default_link: string }> = {};
  for (let i = 1; i <= n; i++) out[`${prefix}${i}`] = { name: `${prefix.toUpperCase()} ${i}`, default_link: `https://x/${prefix}${i}` };
  return out as unknown as DestMap;
};
const visaMap = (n: number): Maps['visaMap'] => {
  const out: Maps['visaMap'] = {};
  for (let i = 1; i <= n; i++) out[`v${i}`] = { key: `v${i}`, name: `Visa ${i}`, country_label: null, region: null };
  return out;
};
const maps = (): Maps => ({ holidayMap: destMap('h', 5), cruiseMap: destMap('c', 5), activityMap: destMap('a', 5), visaMap: visaMap(5) });
const good = (): Record<string, unknown> => ({
  holiday_keys: ['h1', 'h2', 'h3', 'h4'], cruise_keys: ['c1', 'c2', 'c3', 'c4'],
  activity_keys: ['a1', 'a2', 'a3', 'a4'], visa_keys: ['v1', 'v2', 'v3', 'v4'],
  hero_variant_key: 'perfect_trip', exclusive_variant_key: 'raynow',
});

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }); });

describe('Day1 ranking constants', () => {
  it('SLOT_COUNT is 4 and variant options are fixed', () => {
    expect(rank.SLOT_COUNT).toBe(4);
    expect(rank.VARIANT_OPTIONS.hero_variant_key).toEqual(['perfect_trip', 'curated_for_you']);
    expect(rank.VARIANT_OPTIONS.exclusive_variant_key).toEqual(['raynow', 'welcome_off']);
  });
});

describe('Day1 loadVisaCatalog', () => {
  it('queries enabled visa_products and returns rows', async () => {
    query.mockResolvedValueOnce({ rows: [{ key: 'uae', name: 'UAE', country_label: 'UAE', region: null }] });
    const rows = await rank.loadVisaCatalog();
    expect(rows).toHaveLength(1);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/FROM visa_products/);
    expect(String(sql)).toMatch(/enabled = TRUE/);
    expect(params).toBeUndefined();
  });
  it('propagates DB errors', async () => {
    query.mockRejectedValueOnce(new Error('boom'));
    await expect(rank.loadVisaCatalog()).rejects.toThrow('boom');
  });
});

describe('Day1 listFromMap', () => {
  it('maps entries to {key,name,link}', () => {
    expect(rank.listFromMap(destMap('h', 2))).toEqual([
      { key: 'h1', name: 'H 1', link: 'https://x/h1' },
      { key: 'h2', name: 'H 2', link: 'https://x/h2' },
    ]);
  });
  it('empty map -> []', () => { expect(rank.listFromMap({})).toEqual([]); });
});

describe('Day1 buildPrompt', () => {
  it('returns system + user strings containing catalog keys', () => {
    const m = maps();
    const p = rank.buildPrompt(rank.listFromMap(m.holidayMap), rank.listFromMap(m.cruiseMap), rank.listFromMap(m.activityMap), Object.values(m.visaMap));
    expect(typeof p.system).toBe('string');
    expect(p.user).toContain('h1');
    expect(p.user).toContain('v5');
  });
  it('tolerates empty catalogs', () => {
    const p = rank.buildPrompt([], [], [], []);
    expect(typeof p.user).toBe('string');
  });
});

describe('Day1 validateRanking', () => {
  it('accepts a valid ranking', () => { expect(() => rank.validateRanking(good(), maps())).not.toThrow(); });
  it('accepts missing variant keys (optional)', () => {
    const r = good(); delete r.hero_variant_key; delete r.exclusive_variant_key;
    expect(() => rank.validateRanking(r, maps())).not.toThrow();
  });
  it.each([null, undefined, 'str', 5])('rejects non-object %j', (v) => {
    expect(() => rank.validateRanking(v as unknown as Record<string, unknown>, maps())).toThrow('ranking is not an object');
  });
  it('rejects non-array section', () => {
    expect(() => rank.validateRanking({ ...good(), cruise_keys: 'c1' }, maps())).toThrow('cruise_keys must be an array');
  });
  it.each([[[]], [['h1', 'h2', 'h3']], [['h1', 'h2', 'h3', 'h4', 'h5']]])('rejects wrong length %j', (arr) => {
    expect(() => rank.validateRanking({ ...good(), holiday_keys: arr }, maps())).toThrow(/expected 4/);
  });
  it('rejects duplicates', () => {
    expect(() => rank.validateRanking({ ...good(), activity_keys: ['a1', 'a1', 'a2', 'a3'] }, maps())).toThrow('duplicate');
  });
  it('rejects unknown key (case-sensitive)', () => {
    expect(() => rank.validateRanking({ ...good(), visa_keys: ['V1', 'v2', 'v3', 'v4'] }, maps())).toThrow('unknown key: "V1"');
  });
  it('rejects bad variant', () => {
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: 'nope' }, maps())).toThrow(/hero_variant_key="nope"/);
    expect(() => rank.validateRanking({ ...good(), exclusive_variant_key: 'RAYNOW' }, maps())).toThrow(/exclusive_variant_key/);
  });
  it('empty-string variant is treated as absent', () => {
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: '' }, maps())).not.toThrow();
  });
  // BUG: `map[k]` looks through the prototype chain, so inherited names like "toString" pass
  // validation as if they were catalog keys (Day1WelcomeRankingService.ts:159).
  it.fails('rejects Object.prototype names as keys', () => {
    expect(() => rank.validateRanking({ ...good(), holiday_keys: ['toString', 'h2', 'h3', 'h4'] }, maps())).toThrow();
  });
});

describe('Day1 buildFallbackRanking', () => {
  it('takes first 4 keys of each map and passes validation', () => {
    const m = maps();
    const fb = rank.buildFallbackRanking(m);
    expect(fb.holiday_keys).toEqual(['h1', 'h2', 'h3', 'h4']);
    expect(fb.visa_keys).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(fb.hero_variant_key).toBe('perfect_trip');
    expect(() => rank.validateRanking(fb as unknown as Record<string, unknown>, m)).not.toThrow();
  });
  it('short maps produce short arrays (which then fail validation)', () => {
    const m: Maps = { holidayMap: destMap('h', 2), cruiseMap: {}, activityMap: destMap('a', 4), visaMap: visaMap(4) };
    const fb = rank.buildFallbackRanking(m);
    expect(fb.holiday_keys).toEqual(['h1', 'h2']);
    expect(fb.cruise_keys).toEqual([]);
    expect(() => rank.validateRanking(fb as unknown as Record<string, unknown>, m)).toThrow();
  });
});

describe('Day1 renderer generateStats', () => {
  const stats = [{ value: '1M+', label: 'Guests' }, { value: '4.8', label: 'Rating' }, { value: '★ ünï', label: 'Ünicode' }] as unknown as Stats;
  it('renders one cell per stat with border on all but the last', () => {
    const html = render.generateStats(stats);
    expect(html.match(/<td /g)).toHaveLength(3);
    expect(html.match(/border-right/g)).toHaveLength(2);
    expect(html).toContain('★ ünï');
  });
  it('empty -> empty string', () => { expect(render.generateStats([] as unknown as Stats)).toBe(''); });
  it('single stat has no border', () => {
    expect(render.generateStats([{ value: '1', label: 'x' }] as unknown as Stats)).not.toContain('border-right');
  });
  it('does not escape HTML (current behaviour)', () => {
    expect(render.generateStats([{ value: '<b>x</b>', label: 'y' }] as unknown as Stats)).toContain('<b>x</b>');
  });
});

describe('Day1 renderer generateCategories', () => {
  it('renders sections and items', () => {
    const sections = [{ icon: '🏝', title: 'Holidays', link: 'https://h', items: [
      { name: 'Bali', image: 'https://i/b.jpg', link: 'https://b' },
      { name: 'Paris', image: 'https://i/p.jpg', link: 'https://p' },
    ] }] as unknown as Sections;
    const html = render.generateCategories(sections);
    expect(html).toContain('Holidays');
    expect(html).toContain('href="https://h"');
    expect(html.match(/class="service-col /g)).toHaveLength(2);
    expect(html).toContain('alt="Bali"');
  });
  it('empty sections -> empty string', () => { expect(render.generateCategories([] as unknown as Sections)).toBe(''); });
  it('section with no items still renders header', () => {
    const html = render.generateCategories([{ icon: '', title: 'T', link: 'l', items: [] }] as unknown as Sections);
    expect(html).toContain('<tr></tr>');
  });
});

describe('Day1 renderer generateRatings', () => {
  const r = (p: string): Ratings[number] => ({ platform: p, logo: `https://l/${p}`, stars: '★★★★★', rating: '4.9', reviews: '10k', styles: { border: '#111', bg: '#222', starColor: '#333' } });
  it('pairs ratings into rows', () => {
    const html = render.generateRatings([r('A'), r('B'), r('C'), r('D')]);
    expect(html.match(/class="ratings-col"/g)).toHaveLength(4);
    expect(html).not.toContain('<td></td>');
  });
  it('odd count pads the last row with empty td', () => {
    const html = render.generateRatings([r('A'), r('B'), r('C')]);
    expect(html.match(/<td><\/td>/g)).toHaveLength(1);
    expect(html).toContain('border: 1px solid #111');
  });
  it('empty -> empty string', () => { expect(render.generateRatings([])).toBe(''); });
});
