import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config/database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { default: { query }, query };
});

import { _internals as rank } from '../src/services/Day4HolidaysRankingService.js';
import { _internals as data } from '../src/services/Day4HolidaysDataService.js';
import { renderDay4Holidays } from '../src/services/Day4HolidaysRenderer.js';
import type { Day4Ranking } from '../src/services/Day4HolidaysDataService.js';

type RenderData = Parameters<typeof renderDay4Holidays>[1];
const catalog = data.HOLIDAY_DESTINATIONS;
const keysFor = (theme: string) => Object.entries(catalog).filter(([, v]) => v.themes.includes(theme)).map(([k]) => k);
const notIn = (theme: string) => Object.keys(catalog).find(k => !catalog[k]?.themes.includes(theme));

describe('Day4 constants & listFor', () => {
  it('SLOT_COUNT 4, hero variants fixed', () => {
    expect(rank.SLOT_COUNT).toBe(4);
    expect(rank.VARIANT_OPTIONS.hero_variant_key).toEqual(['dream_holidays', 'expertly_curated']);
  });
  it('listFor returns one padded line per destination with that theme', () => {
    const lines = rank.listFor('summer');
    expect(lines).toHaveLength(keysFor('summer').length);
    for (const l of lines) expect(l).toMatch(/^ {2}- \S+\s+\| .+ \| .+$/);
  });
  it.each(['', 'SUMMER', 'nope'])('unknown/wrong-case theme %j -> []', (t) => {
    expect(rank.listFor(t)).toEqual([]);
  });
});

describe('Day4 buildPrompt', () => {
  it('returns system/user mentioning catalog keys', () => {
    const { system, user } = rank.buildPrompt();
    expect(typeof system).toBe('string');
    const all = system + user;
    expect(all).toContain(keysFor('summer')[0]);
  });
});

describe('Day4 buildFallbackRanking + validateRanking', () => {
  it('fallback is valid', () => {
    const fb = rank.buildFallbackRanking();
    expect(fb.summer_keys).toHaveLength(4);
    expect(fb.eid_special_key).toBe(fb.eid_keys[0]);
    expect(fb.hero_destination_key).toBe(fb.summer_keys[0]);
    expect(() => rank.validateRanking(fb)).not.toThrow();
  });
  const good = (): Day4Ranking => rank.buildFallbackRanking();
  it.each([null, undefined, 'x', 0])('rejects non-object %j', (v) => {
    expect(() => rank.validateRanking(v as unknown as Day4Ranking)).toThrow('ranking is not an object');
  });
  it('rejects non-array slot', () => {
    expect(() => rank.validateRanking({ ...good(), eid_keys: 'x' as unknown as string[] })).toThrow('eid_keys must be an array');
  });
  it('rejects wrong length and duplicates', () => {
    const g = good();
    expect(() => rank.validateRanking({ ...g, summer_keys: g.summer_keys.slice(0, 3) })).toThrow('expected 4');
    const s = g.summer_keys;
    expect(() => rank.validateRanking({ ...g, summer_keys: [s[0]!, s[0]!, s[1]!, s[2]!] })).toThrow('duplicate');
  });
  it('rejects unknown key and wrong theme', () => {
    const g = good();
    expect(() => rank.validateRanking({ ...g, summer_keys: ['atlantis', ...g.summer_keys.slice(1)] })).toThrow('unknown key "atlantis"');
    const wrong = notIn('summer');
    if (wrong) expect(() => rank.validateRanking({ ...g, summer_keys: [wrong, ...g.summer_keys.slice(1)] })).toThrow('not tagged with theme');
  });
  it('rejects missing/unknown eid_special_key and hero_destination_key', () => {
    expect(() => rank.validateRanking({ ...good(), eid_special_key: '' })).toThrow('eid_special_key invalid');
    expect(() => rank.validateRanking({ ...good(), hero_destination_key: 'zzz' })).toThrow('hero_destination_key invalid');
  });
  it('rejects bad hero variant, allows absent', () => {
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: 'DREAM_HOLIDAYS' })).toThrow('hero_variant_key');
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: undefined })).not.toThrow();
  });
  // BUG: catalog lookups use plain `catalog[key]`, so inherited names like "constructor" pass
  // the eid_special_key / hero_destination_key existence checks (Day4HolidaysRankingService.ts:149).
  it.fails('rejects Object.prototype names as hero_destination_key', () => {
    expect(() => rank.validateRanking({ ...good(), hero_destination_key: 'constructor' })).toThrow();
  });
});

describe('renderDay4Holidays', () => {
  const d = (o: Record<string, unknown>) => o as unknown as RenderData;
  it('substitutes scalars, dotted and indexed paths', () => {
    const out = renderDay4Holidays('<p>{{a}} {{b.c}} {{arr.1.n}}</p>', d({ a: 'A', b: { c: 'C' }, arr: [{ n: 'x' }, { n: 'ü' }] }));
    expect(out).toBe('<p>A C ü</p>');
  });
  it('leaves unknown placeholders intact', () => {
    expect(renderDay4Holidays('<p>{{missing}} {{b.zz}}</p>', d({ b: {} }))).toBe('<p>{{missing}} {{b.zz}}</p>');
  });
  it('renders falsy-but-defined values (0, empty string)', () => {
    expect(renderDay4Holidays('<p>[{{z}}][{{e}}]</p>', d({ z: 0, e: '' }))).toBe('<p>[0][]</p>');
  });
  it('{{#list}} repeats per item, empty/non-array -> removed', () => {
    const tpl = '<ul>{{#list xs}}<li>{{n}}</li>{{/list}}</ul>';
    expect(renderDay4Holidays(tpl, d({ xs: [{ n: 1 }, { n: 2 }] }))).toBe('<ul><li>1</li><li>2</li></ul>');
    expect(renderDay4Holidays(tpl, d({ xs: [] }))).toBe('<ul></ul>');
    expect(renderDay4Holidays(tpl, d({ xs: 'nope' }))).toBe('<ul></ul>');
  });
  it('{{#loop}} groups into rows of 2', () => {
    const tpl = '<table>{{#loop xs}}<tr>{{#each row}}<td>{{n}}</td>{{/each}}</tr>{{/loop}}</table>';
    expect(renderDay4Holidays(tpl, d({ xs: [{ n: 1 }, { n: 2 }, { n: 3 }] }))).toBe('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>');
  });
  it('list item missing key keeps placeholder (then top-level pass may fill it)', () => {
    const tpl = '<i>{{#list xs}}{{title}}{{/list}}</i>';
    expect(renderDay4Holidays(tpl, d({ xs: [{}], title: 'T' }))).toBe('<i>T</i>');
  });
  it('object values stringify as [object Object] (current behaviour)', () => {
    expect(renderDay4Holidays('<p>{{b}}</p>', d({ b: { c: 1 } }))).toBe('<p>[object Object]</p>');
  });
});
