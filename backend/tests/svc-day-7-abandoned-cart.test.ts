import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));

import { _internals as rank } from '../src/services/Day7AbandonedCartRankingService.js';
import { _internals as render } from '../src/services/Day7AbandonedCartRenderer.js';
import type { Day7Ranking } from '../src/services/Day7AbandonedCartDataService.js';
import type { ProductCandidate } from '../src/types/dayTemplates.js';

type Pools = Parameters<typeof rank.validateRanking>[1];
type Ctx = Parameters<typeof render.getValue>[1];

const c = (id: number, city: string | null = 'Paris', country: string | null = 'France'): ProductCandidate =>
  ({ product_id: id, name: `P${id}`, type: 't', city, country } as ProductCandidate);
const pools = (): Pools => ({
  activities: [c(1), c(2)], holidays: [c(10)], cruises: [c(20)],
  visas: [{ key: 'schengen', country_label: 'Schengen' }],
});
const good = (): Day7Ranking => ({ fallback_ids: [1, 10, 20], fallback_visa_key: 'schengen', hero_variant_key: 'almost_yours', urgency_variant_key: 'limited', final_variant_key: 'dont_wait' });

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }); });

describe('Day7 fetchers', () => {
  it('fetchCandidates parameterises type + limit and drops blocked cities/countries (case/space-insensitive)', async () => {
    query.mockResolvedValueOnce({ rows: [c(1), c(2, ' DUBAI '), c(3, 'Abu Dhabi', 'dubai'), c(4, null, null)] });
    const rows = await rank.fetchCandidates('activities');
    expect(rows.map(r => r.product_id)).toEqual([1, 4]);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/WHERE type = \$1/);
    expect(params).toEqual(['activities', 20]);
  });
  it('fetchCandidates honours explicit limit (including 0)', async () => {
    await rank.fetchCandidates('cruise', 0);
    expect(query.mock.calls[0]?.[1]).toEqual(['cruise', 0]);
  });
  it('fetchVisaKeys filters blocked country labels', async () => {
    query.mockResolvedValueOnce({ rows: [{ key: 'uae', country_label: 'Dubai' }, { key: 'sch', country_label: 'Schengen' }] });
    await expect(rank.fetchVisaKeys()).resolves.toEqual([{ key: 'sch', country_label: 'Schengen' }]);
    expect(String(query.mock.calls[0]?.[0])).toMatch(/FROM visa_products WHERE enabled = TRUE/);
  });
});

describe('Day7 buildPrompt', () => {
  it('lists pools; empty pools say none available', () => {
    const p = rank.buildPrompt(pools());
    expect(p.system + p.user).toContain('product_id=10');
    expect(p.system + p.user).toContain('"schengen"');
    const e = rank.buildPrompt({ activities: [], holidays: [], cruises: [], visas: [] });
    expect(e.system + e.user).toContain('(none available)');
  });
});

describe('Day7 validateRanking', () => {
  it('accepts valid (incl. string ids)', () => {
    expect(() => rank.validateRanking(good(), pools())).not.toThrow();
    expect(() => rank.validateRanking({ ...good(), fallback_ids: ['2', '10', '20'] }, pools())).not.toThrow();
  });
  it.each([null, undefined, 'x'])('rejects non-object %j', (v) => {
    expect(() => rank.validateRanking(v as unknown as Day7Ranking, pools())).toThrow('ranking is not an object');
  });
  it.each([[undefined, 0], [[1, 10], 2], [[1, 10, 20, 30], 4]])('fallback_ids %j wrong length', (ids, n) => {
    expect(() => rank.validateRanking({ ...good(), fallback_ids: ids }, pools())).toThrow(`(got ${n})`);
  });
  it('each slot must come from the right pool', () => {
    expect(() => rank.validateRanking({ ...good(), fallback_ids: [10, 10, 20] }, pools())).toThrow('fallback_ids[0]=10 not in activities');
    expect(() => rank.validateRanking({ ...good(), fallback_ids: [1, 1, 20] }, pools())).toThrow('fallback_ids[1]');
    expect(() => rank.validateRanking({ ...good(), fallback_ids: [1, 10, null] }, pools())).toThrow('fallback_ids[2]=0');
    expect(() => rank.validateRanking({ ...good(), fallback_ids: ['abc', 10, 20] }, pools())).toThrow('NaN');
  });
  it('variant / visa keys validated when present', () => {
    expect(() => rank.validateRanking({ ...good(), fallback_visa_key: 'SCHENGEN' }, pools())).toThrow('not in visa pool');
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: 'x' }, pools())).toThrow('hero_variant_key');
    expect(() => rank.validateRanking({ ...good(), urgency_variant_key: 'x' }, pools())).toThrow('urgency_variant_key');
    expect(() => rank.validateRanking({ ...good(), final_variant_key: 'x' }, pools())).toThrow('final_variant_key');
    expect(() => rank.validateRanking({ fallback_ids: [1, 10, 20], fallback_visa_key: null }, pools())).not.toThrow();
  });
});

describe('Day7 buildFallbackRanking', () => {
  it('takes first of each pool and is valid', () => {
    const fb = rank.buildFallbackRanking(pools());
    expect(fb.fallback_ids).toEqual([1, 10, 20]);
    expect(fb.fallback_visa_key).toBe('schengen');
    expect(rank.HERO_VARIANT_KEYS).toContain(fb.hero_variant_key);
    expect(rank.URGENCY_VARIANT_KEYS).toContain(fb.urgency_variant_key);
    expect(rank.FINAL_VARIANT_KEYS).toContain(fb.final_variant_key);
    expect(() => rank.validateRanking(fb, pools())).not.toThrow();
  });
  it('empty pools keep null slots and visa -> null', () => {
    const fb = rank.buildFallbackRanking({ activities: [c(1)], holidays: [], cruises: [], visas: [] });
    expect(fb.fallback_ids).toEqual([1, null, null]);
    expect(fb.fallback_visa_key).toBeNull();
  });
  // BUG: when a middle pool is empty, `.filter(Number.isFinite)` shifts later ids into the wrong
  // slot (cruise id lands in the holiday slot) (Day7AbandonedCartRankingService.ts:231-235).
  it('keeps slot positions when the holidays pool is empty', () => {
    const fb = rank.buildFallbackRanking({ activities: [c(1)], holidays: [], cruises: [c(20)], visas: [] });
    expect(fb.fallback_ids[1]).not.toBe(20);
  });
});

describe('Day7 renderer getValue', () => {
  const ctx: Ctx = { a: { b: 'x', z: 0 }, s: 'top', '.': 'dot' };
  it('resolves dotted paths, falsy values and "."', () => {
    expect(render.getValue('a.b', ctx)).toBe('x');
    expect(render.getValue('a.z', ctx)).toBe(0);
    expect(render.getValue('.', ctx)).toBe('dot');
    expect(render.getValue('missing', ctx)).toBeUndefined();
    expect(render.getValue('a.b.c.d', ctx)).toBeUndefined();
  });
  it('falls back to _parent scope', () => {
    const child: Ctx = { n: 1, _parent: ctx };
    expect(render.getValue('s', child)).toBe('top');
    expect(render.getValue('a.b', child)).toBe('x');
  });
});

describe('Day7 renderer replaceVars', () => {
  it('replaces {{x}}, {{{x}}} and {{.}}; leaves unknown placeholders', () => {
    expect(render.replaceVars('{{a}}|{{{b}}}|{{.}}|{{nope}}', { a: '<i>', b: '<b>', '.': 7 })).toBe('<i>|<b>|7|{{nope}}');
  });
  it('null value renders "null" (only undefined is skipped)', () => {
    expect(render.replaceVars('[{{a}}]', { a: null })).toBe('[null]');
  });
  it('unicode and empty template', () => {
    expect(render.replaceVars('{{n}}', { n: 'مرحبا' })).toBe('مرحبا');
    expect(render.replaceVars('', {})).toBe('');
  });
});

describe('Day7 renderer processBlocks', () => {
  it('{{#list}} over objects and primitives with parent scope', () => {
    const out = render.processBlocks('{{#list xs}}<{{n}}-{{t}}>{{/list}}|{{#list ps}}[{{.}}]{{/list}}', { xs: [{ n: 1 }, { n: 2 }], t: 'T', ps: ['a', 0] });
    expect(out).toBe('<1-T><2-T>|[a][0]');
  });
  it('{{#if}} truthiness: empty array/0/""/missing false', () => {
    const tpl = '{{#if v}}Y{{/if}}';
    for (const v of [[], 0, '', null, undefined, false]) expect(render.processBlocks(tpl, { v })).toBe('');
    for (const v of [[1], 1, 'x', {}, true]) expect(render.processBlocks(tpl, { v })).toBe('Y');
  });
  it('nested ifs and lists', () => {
    const tpl = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}{{#list xs}}{{#list ys}}{{.}}{{/list}};{{/list}}';
    expect(render.processBlocks(tpl, { a: 1, b: 0, xs: [{ ys: [1, 2] }, { ys: [] }] })).toBe('A12;;');
  });
  it('list on non-array renders nothing', () => {
    expect(render.processBlocks('x{{#list v}}Z{{/list}}y', { v: 'str' })).toBe('xy');
  });
  it('unclosed block: opening tag is dropped, body kept', () => {
    expect(render.processBlocks('{{#if a}}open', { a: 1 })).toBe('open');
  });
});
