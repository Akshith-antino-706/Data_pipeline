import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HydrateProductRow } from '../src/types/productsReco.js';

const { query, getRates } = vi.hoisted(() => ({ query: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>(), getRates: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query }, query }));
vi.mock('../src/utils/currency.js', () => ({ getRates }));

import { hydrateProducts, renderRecommendationEmail, injectPerUserProducts } from '../src/services/RecommendationRenderer.js';

const row = (id: number, extra: Partial<HydrateProductRow> = {}): HydrateProductRow => ({
  product_id: id, name: `Prod ${id}`, category: 'tours', city: 'Paris', country: 'France',
  image_url: `https://img/${id}.jpg`, url: `https://p/${id}`, sale_price: '100', normal_price: '125',
  market_prices: null, ...extra,
});

let productRows: HydrateProductRow[] = [];
let cachedRec: Record<string, unknown> | null = null;
let contactRow: Record<string, unknown> | null = null;

beforeEach(() => {
  productRows = [];
  cachedRec = null;
  contactRow = null;
  delete process.env.FX_MAX_DISPLAY_RATE;
  getRates.mockReset();
  getRates.mockResolvedValue({ AED: 1, INR: 22.5, USD: 0.27, IRR: 11000 });
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM products')) return { rows: productRows };
    if (sql.includes('user_product_recommendations')) return { rows: cachedRec ? [cachedRec] : [] };
    if (sql.includes('unified_contacts')) return { rows: contactRow ? [contactRow] : [] };
    return { rows: [] };
  });
});

describe('hydrateProducts', () => {
  it.each([[[]], [null], [undefined], ['1,2']])('non-array/empty %j -> [] without querying', async (ids) => {
    await expect(hydrateProducts(ids as unknown as number[])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('casts ids to numbers in the parameter and preserves input order, dropping missing ids', async () => {
    productRows = [row(2), row(1)];
    const out = await hydrateProducts(['1', 3, 2]);
    expect(out.map(p => p.product_id)).toEqual([1, 2]);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(String(sql)).toMatch(/ANY\(\$1::int\[\]\)/);
    expect(params).toEqual([[1, 3, 2]]);
  });

  it('default market: price, strike and discount in AED (formatted strings, *_local are aliases)', async () => {
    productRows = [row(1)];
    const [p] = await hydrateProducts([1]);
    expect(p).toMatchObject({ product_price: '100', product_strike_price: '125', product_discount_percent: 20, product_currency: 'AED', product_price_local: '100', product_strike_price_local: '125', product_rating: '4.7' });
  });

  it('no strike when normal <= sale; null prices -> empty strings', async () => {
    productRows = [row(1, { normal_price: '100' }), row(2, { sale_price: null, normal_price: null })];
    const [a, b] = await hydrateProducts([1, 2]);
    expect(a?.product_strike_price).toBe('');
    expect(a?.product_discount_percent).toBe('');
    expect(b).toMatchObject({ product_price: '', product_strike_price: '', product_price_local: '' });
  });

  it('defaults for missing name/url/category/image/city', async () => {
    productRows = [row(1, { name: '', url: '', category: null, image_url: '', city: null })];
    const [p] = await hydrateProducts([1]);
    expect(p).toMatchObject({ product_name: '', product_url: 'https://www.raynatours.com', product_category: 'Activity', product_image: '', product_city: '' });
  });

  it('converts plan prices into the market currency (case-insensitive) with thousands separators', async () => {
    productRows = [row(1, { market_prices: { default: { sale_price: 100, price: 200 }, IN: { sale_price: 90, price: 100 } } })];
    const [p] = await hydrateProducts([1], { plan: 'IN', currency: 'inr' });
    // Every price key is market-aware now: product_price carries the converted plan price too.
    expect(p).toMatchObject({ product_currency: 'INR', product_price_local: '2,025', product_strike_price_local: '2,250', product_price: '2,025', product_strike_price: '2,250' });
    // Discount % comes from the plan's own AED figures (90 vs 100), not the default plan.
    expect(p?.product_discount_percent).toBe(10);
  });

  it.each([['XYZ'], ['IRR']])('unknown or hyper-devalued currency %s falls back to AED', async (cur) => {
    productRows = [row(1)];
    const [p] = await hydrateProducts([1], { plan: 'default', currency: cur });
    expect(p?.product_currency).toBe('AED');
    expect(p?.product_price_local).toBe('100');
  });

  it('FX_MAX_DISPLAY_RATE raises the threshold', async () => {
    process.env.FX_MAX_DISPLAY_RATE = '20000';
    productRows = [row(1)];
    const [p] = await hydrateProducts([1], { plan: 'default', currency: 'IRR' });
    expect(p?.product_currency).toBe('IRR');
    expect(p?.product_price_local).toBe('1,100,000');
  });

  it('null market -> default plan AED', async () => {
    productRows = [row(1)];
    const [p] = await hydrateProducts([1], null);
    expect(p?.product_currency).toBe('AED');
  });

  it('non-numeric prices are treated as missing', async () => {
    productRows = [row(1, { sale_price: 'abc', normal_price: 'n/a' })];
    const [p] = await hydrateProducts([1]);
    expect(p?.product_price).toBe('');
  });
});

describe('renderRecommendationEmail', () => {
  it('requires templateHtml', async () => {
    await expect(renderRecommendationEmail({ templateHtml: '' })).rejects.toThrow('templateHtml is required');
    await expect(renderRecommendationEmail()).rejects.toThrow('templateHtml is required');
  });

  it('expands products block, strike conditional and top-level vars; strips leftovers', async () => {
    productRows = [row(1), row(2, { normal_price: '50' })];
    const tpl = 'Hi {{ customer_name }}!{{#products}}<li>{{product_name}}:{{product_price}}{{#product_strike_price}}<s>{{product_strike_price}}</s>{{/product_strike_price}}</li>{{/products}}{{unknown_var}}';
    const { html, productsUsed } = await renderRecommendationEmail({ templateHtml: tpl, ranking: { productIds: [1, 2] }, vars: { customer_name: 'Zoë' } });
    expect(html).toBe('Hi Zoë!<li>Prod 1:100<s>125</s></li><li>Prod 2:100</li>');
    expect(productsUsed).toHaveLength(2);
  });

  it('accepts snake_case product_ids and missing ranking', async () => {
    productRows = [row(7)];
    const a = await renderRecommendationEmail({ templateHtml: '{{#products}}{{product_id}}{{/products}}', ranking: { product_ids: [7] } });
    expect(a.html).toBe('7');
    const b = await renderRecommendationEmail({ templateHtml: 'x{{#products}}y{{/products}}z' });
    expect(b.html).toBe('xz');
  });

  it('{{#if}} keeps body only for truthy vars', async () => {
    const tpl = '{{#if coupon_code}}Use {{coupon_code}}{{/if}}.';
    expect((await renderRecommendationEmail({ templateHtml: tpl, vars: { coupon_code: 'SAVE10' } })).html).toBe('Use SAVE10.');
    expect((await renderRecommendationEmail({ templateHtml: tpl, vars: { coupon_code: '' } })).html).toBe('.');
    expect((await renderRecommendationEmail({ templateHtml: tpl })).html).toBe('.');
  });

  it('null var substitutes as empty string', async () => {
    const r = await renderRecommendationEmail({ templateHtml: '[{{a}}]', vars: { a: null } as unknown as Record<string, string> });
    expect(r.html).toBe('[]');
  });

  // BUG: values are passed as a *string* replacement to String.replace, so "$&", "$'" etc. are
  // interpreted as replacement patterns instead of literal text (RecommendationRenderer.ts:159,
  // same in _renderProductCard :140).
  it('inserts values containing "$&" literally', async () => {
    const r = await renderRecommendationEmail({ templateHtml: 'Code: {{coupon_code}}', vars: { coupon_code: 'A$&B' } });
    expect(r.html).toBe('Code: A$&B');
  });
});

describe('injectPerUserProducts', () => {
  it('requires templateHtml', async () => {
    await expect(injectPerUserProducts({ templateHtml: '' })).rejects.toThrow('templateHtml is required');
  });

  it('missing unifiedId/type -> collapses products block without DB lookups for recs', async () => {
    const r = await injectPerUserProducts({ templateHtml: 'a{{#products}}X{{/products}}b{{name}}', vars: { name: 'N' } });
    expect(r).toEqual({ html: 'abN', productsUsed: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it('no cached row -> source no_cached_row, fromCache false; market from contact', async () => {
    contactRow = { country: 'India', mobile_country: null, is_indian: true, market_plan: null, currency_code: null };
    const r = await injectPerUserProducts({ templateHtml: '{{currency}}|{{destination}}', unifiedId: 5, recommendationType: 'on_trip' });
    expect(r).toMatchObject({ html: 'INR|', source: 'no_cached_row', fromCache: false });
    const sqls = query.mock.calls.map(c => String(c[0]));
    expect(sqls.some(s => s.includes('user_product_recommendations'))).toBe(true);
    const contactCall = query.mock.calls.find(c => String(c[0]).includes('unified_contacts'));
    expect(contactCall?.[1]).toEqual([5]);
  });

  it('uses cached products, destination fallback, and explicit market override', async () => {
    cachedRec = { unified_id: 5, recommendation_type: 'on_trip', product_ids: [3], destination_city: 'Paris', source: 'claude' };
    productRows = [row(3)];
    const r = await injectPerUserProducts({ templateHtml: '{{destination}} {{currency}}{{#products}} {{product_name}}{{/products}}', unifiedId: 5, recommendationType: 'on_trip', market: { plan: 'default', currency: 'AED' } });
    expect(r).toMatchObject({ html: 'Paris AED Prod 3', source: 'claude', fromCache: true });
    expect(query.mock.calls.some(c => String(c[0]).includes('unified_contacts'))).toBe(false);
  });

  it('contact lookup failure -> defaults to AED market', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('unified_contacts')) throw new Error('db down');
      return { rows: [] };
    });
    const r = await injectPerUserProducts({ templateHtml: '{{currency}}', unifiedId: 1, recommendationType: 'past_trip' });
    expect(r.html).toBe('AED');
  });
});

describe('isRecipientAllowedForRec', () => {
  const load = async (env: string | undefined) => {
    vi.resetModules();
    if (env === undefined) delete process.env.REC_JOURNEY_ALLOWLIST; else process.env.REC_JOURNEY_ALLOWLIST = env;
    const mod = await import('../src/services/RecommendationRenderer.js');
    delete process.env.REC_JOURNEY_ALLOWLIST;
    return mod.isRecipientAllowedForRec;
  };
  it.each([undefined, '', ' , ,'])('empty allowlist %j allows everyone, even null', async (env) => {
    const allowed = await load(env);
    expect(allowed(null)).toBe(true);
    expect(allowed('anyone@x.com')).toBe(true);
  });
  it('set allowlist is trimmed and case-insensitive', async () => {
    const allowed = await load(' A@x.com ,b@y.com');
    expect(allowed('a@X.COM')).toBe(true);
    expect(allowed('  b@y.com ')).toBe(true);
    expect(allowed('c@z.com')).toBe(false);
    expect(allowed('')).toBe(false);
    expect(allowed(undefined)).toBe(false);
  });
});
