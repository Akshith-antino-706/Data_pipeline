import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { default: { query }, query };
});

import { _internals as rank } from '../src/services/Day5ActivitiesRankingService.js';
import { _internals as data } from '../src/services/Day5ActivitiesDataService.js';
import { _internals as render } from '../src/services/Day5ActivitiesRenderer.js';
import type { Day5Ranking } from '../src/services/Day5ActivitiesDataService.js';

const good = (): Day5Ranking => rank.buildFallbackRanking();

describe('Day5 constants', () => {
  it('slot counts and variants', () => {
    expect(rank.SLOT_COUNT_THEME).toBe(4);
    expect(rank.SLOT_COUNT_CITY).toBe(4);
    expect(rank.VARIANT_OPTIONS.limited_offer_variant_key).toEqual(['raynow', 'early10']);
  });
});

describe('Day5 buildPrompt', () => {
  it('mentions city keys and catalog keys', () => {
    const { system, user } = rank.buildPrompt();
    const all = `${system}\n${user}`;
    expect(all).toContain(Object.keys(data.TOP_CITIES)[0]);
    expect(all).toContain(Object.keys(data.ACTIVITY_CATALOG)[0]);
  });
});

describe('Day5 buildFallbackRanking / validateRanking', () => {
  it('fallback is valid', () => {
    const fb = good();
    expect(fb.city_keys).toHaveLength(4);
    expect(fb.hero_activity_key).toBe(fb.thrill_keys[0]);
    expect(() => rank.validateRanking(fb)).not.toThrow();
  });
  it.each([null, undefined, 1, 'x'])('rejects non-object %j', (v) => {
    expect(() => rank.validateRanking(v as unknown as Day5Ranking)).toThrow('ranking is not an object');
  });
  it('city_keys: missing / wrong length / duplicates / unknown', () => {
    const g = good();
    expect(() => rank.validateRanking({ ...g, city_keys: undefined as unknown as string[] })).toThrow('(got 0)');
    expect(() => rank.validateRanking({ ...g, city_keys: g.city_keys.slice(0, 2) })).toThrow('(got 2)');
    const c = g.city_keys;
    expect(() => rank.validateRanking({ ...g, city_keys: [c[0]!, c[0]!, c[1]!, c[2]!] })).toThrow('duplicates');
    expect(() => rank.validateRanking({ ...g, city_keys: ['narnia', c[1]!, c[2]!, c[3]!] })).toThrow('unknown "narnia"');
  });
  it('themed slots: non-array, length, duplicate, unknown, wrong theme', () => {
    const g = good();
    expect(() => rank.validateRanking({ ...g, water_keys: null as unknown as string[] })).toThrow('water_keys must be an array');
    expect(() => rank.validateRanking({ ...g, family_keys: [] })).toThrow('(got 0)');
    const t = g.thrill_keys;
    expect(() => rank.validateRanking({ ...g, thrill_keys: [t[0]!, t[0]!, t[1]!, t[2]!] })).toThrow('duplicates');
    expect(() => rank.validateRanking({ ...g, thrill_keys: ['nope', t[1]!, t[2]!, t[3]!] })).toThrow('unknown "nope"');
    const wrong = Object.keys(data.ACTIVITY_CATALOG).find(k => !data.ACTIVITY_CATALOG[k]!.themes.includes('wildlife'));
    if (wrong) expect(() => rank.validateRanking({ ...g, wildlife_keys: [wrong, ...g.wildlife_keys.slice(1)] })).toThrow('not tagged with theme "wildlife"');
  });
  it('optional keys: invalid values rejected, empty accepted', () => {
    expect(() => rank.validateRanking({ ...good(), hero_activity_key: 'zzz' })).toThrow('hero_activity_key invalid');
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: 'X' })).toThrow('hero_variant_key');
    expect(() => rank.validateRanking({ ...good(), limited_offer_variant_key: 'RAYNOW' })).toThrow('limited_offer_variant_key');
    expect(() => rank.validateRanking({ ...good(), hero_activity_key: '', hero_variant_key: '', limited_offer_variant_key: '' })).not.toThrow();
  });
  // BUG: `cities[k]` follows the prototype chain, so "toString" counts as a known city
  // (Day5ActivitiesRankingService.ts:162).
  it('rejects Object.prototype names as city keys', () => {
    const c = good().city_keys;
    expect(() => rank.validateRanking({ ...good(), city_keys: ['toString', c[1]!, c[2]!, c[3]!] })).toThrow();
  });
});

describe('Day5 renderer getValue', () => {
  it.each([
    [{ a: { b: 1 } }, 'a.b', 1],
    [{ a: [{ n: 'x' }] }, 'a.0.n', 'x'],
    [{ a: null }, 'a.b', undefined],
    [null, 'a', undefined],
    [undefined, 'a', undefined],
    [{ a: 0 }, 'a', 0],
    [{ 'ü': 'ok' }, 'ü', 'ok'],
  ])('getValue(%j, %j) -> %j', (obj, p, out) => {
    expect(render.getValue(obj, p)).toEqual(out);
  });
  it('empty path reads key ""', () => { expect(render.getValue({ '': 5 }, '')).toBe(5); });
});

describe('Day5 renderer processLoops', () => {
  it('plain loop with @last', () => {
    const tpl = '<!-- @loop xs --><b>{{item.n}}</b>{{#if @last}}.{{else}},{{/if}}<!-- @endloop -->';
    expect(render.processLoops(tpl, { xs: [{ n: 1 }, { n: 2 }, { n: 3 }] })).toBe('<b>1</b>,<b>2</b>,<b>3</b>.');
  });
  it('missing / null item fields render empty, 0 renders', () => {
    const tpl = '<!-- @loop xs -->[{{item.a}}]<!-- @endloop -->';
    expect(render.processLoops(tpl, { xs: [{}, { a: null }, { a: 0 }] })).toBe('[][][0]');
  });
  it('non-array or missing path removes block', () => {
    const tpl = 'A<!-- @loop xs -->x<!-- @endloop -->B';
    expect(render.processLoops(tpl, { xs: 'no' })).toBe('AB');
    expect(render.processLoops(tpl, {})).toBe('AB');
    expect(render.processLoops(tpl, null)).toBe('AB');
  });
  it('chunk-loop splits into chunks with @last per chunk', () => {
    const tpl = '<!-- @chunk-loop g.xs 2 --><tr><!-- @loop chunk --><td>{{item.n}}{{#if @last}}!{{else}}{{/if}}</td><!-- @endloop --></tr><!-- @endchunkloop -->';
    expect(render.processLoops(tpl, { g: { xs: [{ n: 1 }, { n: 2 }, { n: 3 }] } })).toBe('<tr><td>1</td><td>2!</td></tr><tr><td>3!</td></tr>');
  });
  it('chunk-loop over empty array -> empty', () => {
    const tpl = '<!-- @chunk-loop xs 3 -->X<!-- @endchunkloop -->';
    expect(render.processLoops(tpl, { xs: [] })).toBe('');
  });
  it('template without loops is returned unchanged', () => {
    expect(render.processLoops('{{item.x}} plain', {})).toBe('{{item.x}} plain');
  });
  it('chunk-loop with size 0 does not hang (treated as size 1)', () => {
    const tpl = '<!-- @chunk-loop xs 0 --><tr><!-- @loop chunk --><td>{{item.n}}</td><!-- @endloop --></tr><!-- @endchunkloop -->';
    expect(render.processLoops(tpl, { xs: [{ n: 1 }, { n: 2 }] })).toBe('<tr><td>1</td></tr><tr><td>2</td></tr>');
  });
});
