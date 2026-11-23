import { describe, it, expect, vi } from 'vitest';
import type { HydrateProductRow } from '../../src/types/productsReco.js';

// Fake database + recommendation services — nothing reaches a real DB or Claude.
const { PRODUCTS, fakeQuery, CACHE } = vi.hoisted(() => {
  const PRODUCTS: Record<number, Partial<HydrateProductRow>> = {
    18:    { product_id: 18,    name: 'Burj Khalifa At the Top', city: 'Dubai', image_url: 'https://img.test/18.jpg',    url: 'https://www.raynatours.com/18',    sale_price: '169', normal_price: '199', market_prices: {} },
    2197:  { product_id: 2197,  name: 'Premium Desert Safari',   city: 'Dubai', image_url: 'https://img.test/2197.jpg',  url: 'https://www.raynatours.com/2197',  sale_price: '120', normal_price: '120', market_prices: {} },
    19390: { product_id: 19390, name: 'Hot Air Balloon Dubai',   city: 'Dubai', image_url: 'https://img.test/19390.jpg', url: 'https://www.raynatours.com/19390', sale_price: '950', normal_price: '1100', market_prices: {} },
  };
  const fakeQuery = async (sql: string, params: unknown[] = []) => {
    if (/FROM products/.test(sql)) return { rows: (params[0] as number[]).map(id => PRODUCTS[id]).filter(Boolean) };
    return { rows: [] };   // fx_rates, unified_contacts → nothing (AED, default market)
  };
  return { PRODUCTS, fakeQuery, CACHE: new Map<number, { productIds: number[]; source: string }>() };
});
vi.mock('../../src/config/database.js', () => ({ default: { query: fakeQuery }, query: fakeQuery }));
// Saved picks per user; no bookings and nothing to build — the resolver's order is in resolver.test.ts.
vi.mock('../../src/services/RecommendationRankingService.js', () => ({
  getForUser: async ({ unifiedId }: { unifiedId: number }) => CACHE.get(unifiedId) || null,
  computeForUser: async () => null,
}));
vi.mock('../../src/services/BookingLookupService.js', () => ({ findFor: async () => null }));

const { expandProductsBlockForUser, countRenderedProducts, MIN_REC_PRODUCTS } = await import('../../src/services/RecommendationRenderer.js');
const { renderTemplate } = await import('../../src/utils/placeholderResolver.js');

// Same card markup as the live j14 / j13 templates (trimmed).
const TEMPLATE = '<p>Your trip is coming up</p>{{#products}}<a href="{{product_url}}"><img src="{{product_image}}"></a>'
  + '<b>{{ product_name }}</b> <i>{{ product_city }}</i> {{product_currency}} {{product_price_local}}'
  + '{{#product_strike_price_local}}<s>{{product_currency}} {{product_strike_price_local}}</s>{{/product_strike_price_local}}{{/products}}';
const AED = { plan: 'default', currency: 'AED' };
const fill = (unifiedId: number, templateHtml = TEMPLATE) =>
  expandProductsBlockForUser({ templateHtml, unifiedId, recommendationType: 'future_trip', market: AED });

describe('recommendation emails — product cards', () => {
  it('fixed order: cards filled first, then the general fill — every card has its image, name, price and link', async () => {
    CACHE.set(1, { productIds: [18, 2197, 19390], source: 'claude' });
    const filled = await fill(1);
    const html = renderTemplate(filled.html, {});
    for (const p of Object.values(PRODUCTS)) {
      expect(html).toContain(`src="${p.image_url}"`);
      expect(html).toContain(`href="${p.url}"`);
      expect(html).toContain(`<b>${p.name}</b>`);
    }
    expect(html).toContain('AED 169');
    expect(html).toContain('<s>AED 199</s>');
    expect(html).not.toContain('{{');
    expect(countRenderedProducts(html, filled.productsUsed)).toBe(3);
  });

  it('a non-Liquid template filled in the old order (general fill first) gets empty cards — the check counts 0 of them', async () => {
    CACHE.set(2, { productIds: [18, 2197, 19390], source: 'claude' });
    const filled = await fill(2, renderTemplate(TEMPLATE, {}));   // wipes {{product_*}} first
    expect(filled.html).toContain('<img src="">');
    expect(countRenderedProducts(filled.html, filled.productsUsed)).toBe(0);
  });

  it('no recommendations saved for the user → 0 cards, below the minimum, so the email is skipped', async () => {
    const filled = await fill(3);
    expect(filled.productsUsed).toHaveLength(0);
    expect(filled.fromCache).toBe(false);
    expect(countRenderedProducts(renderTemplate(filled.html, {}), filled.productsUsed)).toBeLessThan(MIN_REC_PRODUCTS);
  });

  it('only 2 products available → below the minimum of 3', async () => {
    CACHE.set(4, { productIds: [18, 2197, 999999], source: 'claude' });   // 999999 is not in products
    const filled = await fill(4);
    expect(countRenderedProducts(renderTemplate(filled.html, {}), filled.productsUsed)).toBe(2);
    expect(MIN_REC_PRODUCTS).toBe(3);
  });

  it('a template without a product block comes back byte-for-byte unchanged', async () => {
    CACHE.set(5, { productIds: [18, 2197, 19390], source: 'claude' });
    const plain = '<p>Hello {{USER_FIRST_NAME}}, see you on {{TRAVEL_DATE}}</p>';
    const filled = await expandProductsBlockForUser({ templateHtml: plain, unifiedId: 5, recommendationType: 'on_trip', market: AED });
    expect(filled.html).toBe(plain);
  });

  it('countRenderedProducts only counts cards that really carry a name and an image', () => {
    const products = [
      { product_name: 'A', product_image: 'https://img.test/a.jpg' },
      { product_name: '',  product_image: 'https://img.test/b.jpg' },   // no name
      { product_name: 'C', product_image: '' },                          // no image
      { product_name: 'D', product_image: 'https://img.test/d.jpg' },   // image not in the email
    ];
    expect(countRenderedProducts('<img src="https://img.test/a.jpg"><img src="https://img.test/b.jpg">', products)).toBe(1);
    expect(countRenderedProducts('', products)).toBe(0);
    expect(countRenderedProducts('<p>x</p>', null)).toBe(0);
  });
});
