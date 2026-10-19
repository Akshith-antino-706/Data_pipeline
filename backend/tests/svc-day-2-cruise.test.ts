import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));

import { _internals as rank } from '../src/services/Day2CruiseRankingService.js';
import { _internals as render } from '../src/services/Day2CruiseRenderer.js';
import type { Day2Ranking } from '../src/services/Day2CruiseDataService.js';

type Sets = Parameters<typeof rank.validateRanking>[1];
type Products = Parameters<typeof rank.buildFallbackRanking>[0];
type Cities = Parameters<typeof render.generateCityRows>[0];
type Packages = Parameters<typeof render.generateSaverPackageRows>[0];
type Regional = Parameters<typeof render.generateRegionalCruiseRows>[0];
type Lines = Parameters<typeof render.generateCruiseLineRows>[0];

const sets = (): Sets => ({
  productIds: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
  departureCityKeys: new Set(['dxb', 'auh', 'mct', 'doh', 'bah']),
  cruiseLineKeys: new Set(['msc', 'royal', 'costa', 'celebrity', 'ncl']),
  heroVariantKeys: new Set(['horizon', 'sunset']),
  regionalCopyKeys: new Set(['mediterranean', 'asia']),
});
const good = (): Day2Ranking => ({
  saver_product_ids: [1, 2, 3], regional_product_ids: [4, 5, 6, 7],
  cruise_line_keys: ['msc', 'royal', 'costa', 'celebrity'],
  departure_city_keys: ['dxb', 'auh', 'mct', 'doh'],
  hero_variant_key: 'horizon', regional_copy_variant_key: 'asia',
});

beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [] }); });

describe('Day2 loadCruiseProducts', () => {
  it('selects cruise products ordered by price, limited to 50', async () => {
    query.mockResolvedValueOnce({ rows: [{ product_id: 1 }] });
    await expect(rank.loadCruiseProducts()).resolves.toEqual([{ product_id: 1 }]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/type = 'cruise'/);
    expect(sql).toMatch(/LIMIT 50/);
  });
});

describe('Day2 buildPrompt', () => {
  it('includes product ids and keys', () => {
    const products = [{ product_id: 42, name: 'Med Cruise', category: 'x', city: 'Rome', country: 'IT', sale_price: '100', normal_price: '200', currency: 'AED', url: 'u', image_url: 'i' }] as unknown as Products;
    const p = rank.buildPrompt(products, { dxb: { name: 'Dubai' } }, { msc: { name: 'MSC' } }, { horizon: {} }, { asia: {} });
    expect(p.user).toContain('42');
    expect(p.user).toContain('dxb');
    expect(p.user).toContain('msc');
    expect(typeof p.system).toBe('string');
  });
  it('tolerates empty inputs', () => {
    expect(() => rank.buildPrompt([], {}, {}, {}, {})).not.toThrow();
  });
});

describe('Day2 validateRanking', () => {
  it('accepts a valid ranking', () => { expect(() => rank.validateRanking(good(), sets())).not.toThrow(); });
  it('accepts string ids (coerced with Number)', () => {
    expect(() => rank.validateRanking({ ...good(), saver_product_ids: ['1', '2', '3'] }, sets())).not.toThrow();
  });
  it('accepts 5 departure cities', () => {
    expect(() => rank.validateRanking({ ...good(), departure_city_keys: ['dxb', 'auh', 'mct', 'doh', 'bah'] }, sets())).not.toThrow();
  });
  it.each([null, undefined, 0, 'x'])('rejects non-object %j', (v) => {
    expect(() => rank.validateRanking(v as unknown as Day2Ranking, sets())).toThrow('ranking is not an object');
  });
  it.each([[[1, 2]], [[1, 2, 3, 4]], [[]]])('saver must be length 3: %j', (ids) => {
    expect(() => rank.validateRanking({ ...good(), saver_product_ids: ids }, sets())).toThrow('saver_product_ids must be array of 3');
  });
  it('rejects unknown saver id', () => {
    expect(() => rank.validateRanking({ ...good(), saver_product_ids: [1, 2, 99] }, sets())).toThrow('unknown product 99');
  });
  it('rejects regional of wrong length / unknown id', () => {
    expect(() => rank.validateRanking({ ...good(), regional_product_ids: [4, 5, 6] }, sets())).toThrow('regional_product_ids must be array of 4');
    expect(() => rank.validateRanking({ ...good(), regional_product_ids: [4, 5, 6, -1] }, sets())).toThrow('unknown product -1');
  });
  it('rejects overlap between saver and regional', () => {
    expect(() => rank.validateRanking({ ...good(), regional_product_ids: [3, 5, 6, 7] }, sets())).toThrow('appears in both');
  });
  it('rejects bad cruise lines', () => {
    expect(() => rank.validateRanking({ ...good(), cruise_line_keys: ['msc'] }, sets())).toThrow('cruise_line_keys must be array of 4');
    expect(() => rank.validateRanking({ ...good(), cruise_line_keys: ['MSC', 'royal', 'costa', 'celebrity'] }, sets())).toThrow('unknown cruise_line_key: MSC');
  });
  it('rejects fewer than 4 departure cities and unknown keys', () => {
    expect(() => rank.validateRanking({ ...good(), departure_city_keys: ['dxb', 'auh', 'mct'] }, sets())).toThrow('departure_city_keys');
    expect(() => rank.validateRanking({ ...good(), departure_city_keys: ['dxb', 'auh', 'mct', 'zzz'] }, sets())).toThrow('unknown departure_city_key: zzz');
  });
  it('rejects bad variant keys but allows absent ones', () => {
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: 'x' }, sets())).toThrow('unknown hero_variant_key');
    expect(() => rank.validateRanking({ ...good(), regional_copy_variant_key: 'x' }, sets())).toThrow('unknown regional_copy_variant_key');
    expect(() => rank.validateRanking({ ...good(), hero_variant_key: undefined, regional_copy_variant_key: undefined }, sets())).not.toThrow();
  });
  // BUG: no upper bound / dedupe on departure_city_keys ("array of 4-5" in the message),
  // so 6 keys or duplicate keys pass (Day2CruiseRankingService.ts:146).
  it.fails('rejects more than 5 or duplicate departure cities', () => {
    expect(() => rank.validateRanking({ ...good(), departure_city_keys: ['dxb', 'dxb', 'dxb', 'dxb'] }, sets())).toThrow();
  });
  // BUG: duplicates inside saver_product_ids are not rejected (Day2CruiseRankingService.ts:122).
  it.fails('rejects duplicate saver ids', () => {
    expect(() => rank.validateRanking({ ...good(), saver_product_ids: [1, 1, 1] }, sets())).toThrow();
  });
});

describe('Day2 buildFallbackRanking', () => {
  const prods = (n: number): Products => Array.from({ length: n }, (_, i) => ({ product_id: i + 1 })) as unknown as Products;
  it('splits cheapest products into saver(3) + regional(4)', () => {
    const fb = rank.buildFallbackRanking(prods(8), ['dxb', 'auh', 'mct', 'doh', 'bah', 'x'], ['msc', 'royal', 'costa', 'celebrity', 'ncl']);
    expect(fb.saver_product_ids).toEqual([1, 2, 3]);
    expect(fb.regional_product_ids).toEqual([4, 5, 6, 7]);
    expect(fb.departure_city_keys).toHaveLength(5);
    expect(fb.cruise_line_keys).toHaveLength(4);
    expect(fb.hero_product_id).toBe(1);
    expect(() => rank.validateRanking(fb, sets())).not.toThrow();
  });
  it('no products -> empty arrays and null hero', () => {
    const fb = rank.buildFallbackRanking([], [], []);
    expect(fb.saver_product_ids).toEqual([]);
    expect(fb.hero_product_id).toBeNull();
  });
  it('product_id 0 is falsy so hero becomes null (current behaviour)', () => {
    expect(rank.buildFallbackRanking(prods(0).concat([{ product_id: 0 }] as unknown as Products), [], []).hero_product_id).toBeNull();
  });
});

const city = (name: string, full = false): Cities[number] => ({ name, sub_text: 's', flag_url: 'f', flag_alt: 'a', link: `https://${name}`, is_full_width: full } as unknown as Cities[number]);
const countRows = (html: string) => (html.match(/<tr>/g) || []).length;

describe('Day2 generateCityRows', () => {
  it('empty -> just the wrapper table', () => {
    const html = render.generateCityRows([]);
    expect(html.startsWith('<table')).toBe(true);
    expect(html.endsWith('</table>')).toBe(true);
    expect(html).not.toContain('city-col');
  });
  it('two regular cities share a row with no padding cell', () => {
    const html = render.generateCityRows([city('a'), city('b')]);
    expect(html).not.toContain('<td width="50%">&nbsp;</td>');
    expect(html).toContain('padding-right: 6px;');
    expect(html).toContain('padding-left: 6px;');
  });
  it('odd count pads the last row', () => {
    const html = render.generateCityRows([city('a'), city('b'), city('c')]);
    expect(html.match(/<td width="50%">&nbsp;<\/td>/g)).toHaveLength(1);
  });
  it('full-width city renders colspan=2', () => {
    const html = render.generateCityRows([city('a'), city('b'), city('wide', true)]);
    expect(html).toContain('city-col-last');
    expect(html).toContain('https://wide');
  });
  it('balanced tags for mixed layouts', () => {
    const html = render.generateCityRows([city('a'), city('w', true), city('b'), city('c')]);
    expect(countRows(html)).toBeGreaterThan(0);
    expect((html.match(/<tr[ >]/g) || []).length).toBe((html.match(/<\/tr>/g) || []).length);
  });
  // BUG: left/right column and row closing use the global index parity (i % 2), not the
  // position within the current row. After a full-width card at index 0, cities 1 and 2 are
  // put into separate rows (Day2CruiseRenderer.ts:62 and :91).
  it.fails('pairs the two cards that follow a leading full-width card into one row', () => {
    const html = render.generateCityRows([city('w', true), city('a'), city('b')]);
    expect(html).not.toContain('<td width="50%">&nbsp;</td>');
  });
});

describe('Day2 generateSaverPackageRows', () => {
  it('renders one block per package', () => {
    const pk = [{ image: 'i', title: 'T1', region: 'R', description: 'd', price: 'AED 1', link: 'l1' }, { image: 'i', title: 'T2', region: 'R', description: 'd', price: 'AED 2', link: 'l2' }] as unknown as Packages;
    const html = render.generateSaverPackageRows(pk);
    expect(html.match(/saver-img-col/g)).toHaveLength(2);
    expect(html).toContain('href="l2"');
  });
  it('empty -> empty string', () => { expect(render.generateSaverPackageRows([] as unknown as Packages)).toBe(''); });
});

describe('Day2 generateRegionalCruiseRows', () => {
  const item = (t: string) => ({ image: 'i', title: t, tag: 'tag', description: 'd', link: `l-${t}` });
  it('odd items pad last cell', () => {
    const html = render.generateRegionalCruiseRows({ items: [item('a'), item('b'), item('c')] } as unknown as Regional);
    expect(html.match(/med-col /g)).toHaveLength(3);
    expect(html.match(/<td width="50%">&nbsp;<\/td>/g)).toHaveLength(1);
  });
  it('empty items -> bare table', () => {
    expect(render.generateRegionalCruiseRows({ items: [] } as unknown as Regional)).not.toContain('<tr>');
  });
});

describe('Day2 generateCruiseLineRows', () => {
  it('renders all lines and handles empty', () => {
    const lines = [{ name: 'MSC', destinations: 'Med', image: 'i', link: 'l' }, { name: 'Costa', destinations: 'Asia', image: 'i', link: 'l' }, { name: 'Ñ', destinations: 'x', image: 'i', link: 'l' }] as unknown as Lines;
    const html = render.generateCruiseLineRows(lines);
    expect(html).toContain('MSC');
    expect(html).toContain('Ñ');
    expect(render.generateCruiseLineRows([] as unknown as Lines)).not.toContain('<tr>');
  });
});
