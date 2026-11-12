import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Never reach a real database: point the pool at a closed port, then replace the module.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';

const PRODUCTS = {
  18:    { product_id: 18,    name: 'Burj Khalifa At the Top', city: 'Dubai', image_url: 'https://img.test/18.jpg',    url: 'https://www.raynatours.com/18',    sale_price: 169, normal_price: 199, market_prices: {} },
  2197:  { product_id: 2197,  name: 'Premium Desert Safari',   city: 'Dubai', image_url: 'https://img.test/2197.jpg',  url: 'https://www.raynatours.com/2197',  sale_price: 120, normal_price: 120, market_prices: {} },
  19390: { product_id: 19390, name: 'Hot Air Balloon Dubai',   city: 'Dubai', image_url: 'https://img.test/19390.jpg', url: 'https://www.raynatours.com/19390', sale_price: 950, normal_price: 1100, market_prices: {} },
};
const fakeQuery = async (sql, params = []) => {
  if (/FROM products/.test(sql)) return { rows: params[0].map(id => PRODUCTS[id]).filter(Boolean) };
  return { rows: [] };   // fx_rates, unified_contacts → nothing (AED, default market)
};
const fakeDb = { query: fakeQuery };
mock.module(new URL('../../src/config/database.js', import.meta.url).href, {
  exports: { default: fakeDb, query: fakeQuery, transaction: async () => { throw new Error('no db in tests'); } },
});

// Cached recommendations per user, as getForUser would return them.
const CACHE = new Map();
mock.module(new URL('../../src/services/RecommendationRankingService.js', import.meta.url).href, {
  exports: { getForUser: async ({ unifiedId }) => CACHE.get(unifiedId) || null },
});

const { expandProductsBlockForUser, countRenderedProducts, MIN_REC_PRODUCTS } =
  await import('../../src/services/RecommendationRenderer.js');
const { renderTemplate } = await import('../../src/utils/placeholderResolver.js');

// Same card markup as the live j14 / j13 templates (trimmed).
const TEMPLATE = '<p>Your trip is coming up</p>{{#products}}<a href="{{product_url}}"><img src="{{product_image}}"></a>'
  + '<b>{{ product_name }}</b> <i>{{ product_city }}</i> {{product_currency}} {{product_price_local}}'
  + '{{#product_strike_price_local}}<s>{{product_currency}} {{product_strike_price_local}}</s>{{/product_strike_price_local}}{{/products}}';

const fill = (unifiedId) => expandProductsBlockForUser({ templateHtml: TEMPLATE, unifiedId, recommendationType: 'future_trip', market: { plan: 'default', currency: 'AED' } });

test('fixed order: cards filled first, then the general fill — every card has its image, name, price and link', async () => {
  CACHE.set(1, { productIds: [18, 2197, 19390], source: 'claude' });
  const filled = await fill(1);
  const html = renderTemplate(filled.html, {});
  for (const p of Object.values(PRODUCTS)) {
    assert.ok(html.includes(`src="${p.image_url}"`), `image for ${p.name}`);
    assert.ok(html.includes(`href="${p.url}"`), `link for ${p.name}`);
    assert.ok(html.includes(`<b>${p.name}</b>`), `name for ${p.name}`);
  }
  assert.ok(html.includes('AED 169') && html.includes('<s>AED 199</s>'), 'price and strike price');
  assert.ok(!html.includes('{{'), 'no placeholder left behind');
  assert.equal(countRenderedProducts(html, filled.productsUsed), 3);
});

test('a non-Liquid template filled in the old order (general fill first) gets empty cards — the check counts 0 of them', async () => {
  CACHE.set(2, { productIds: [18, 2197, 19390], source: 'claude' });
  const blanked = renderTemplate(TEMPLATE, {});            // wipes {{product_*}}
  const filled = await expandProductsBlockForUser({ templateHtml: blanked, unifiedId: 2, recommendationType: 'future_trip', market: { plan: 'default', currency: 'AED' } });
  assert.ok(filled.html.includes('<img src="">'), 'cards came out empty');
  assert.equal(countRenderedProducts(filled.html, filled.productsUsed), 0);
});

test('no recommendations saved for the user → 0 cards, below the minimum, so the email is skipped', async () => {
  const filled = await fill(3);
  assert.equal(filled.productsUsed.length, 0);
  assert.equal(filled.fromCache, false);
  assert.ok(countRenderedProducts(renderTemplate(filled.html, {}), filled.productsUsed) < MIN_REC_PRODUCTS);
});

test('only 2 products available → below the minimum of 3', async () => {
  CACHE.set(4, { productIds: [18, 2197, 999999], source: 'claude' });   // 999999 is not in products
  const filled = await fill(4);
  assert.equal(countRenderedProducts(renderTemplate(filled.html, {}), filled.productsUsed), 2);
  assert.ok(2 < MIN_REC_PRODUCTS);
});

test('a template without a product block comes back byte-for-byte unchanged', async () => {
  CACHE.set(5, { productIds: [18, 2197, 19390], source: 'claude' });
  const plain = '<p>Hello {{USER_FIRST_NAME}}, see you on {{TRAVEL_DATE}}</p>';
  const filled = await expandProductsBlockForUser({ templateHtml: plain, unifiedId: 5, recommendationType: 'on_trip', market: { plan: 'default', currency: 'AED' } });
  assert.equal(filled.html, plain);
});

test('countRenderedProducts only counts cards that really carry a name and an image', () => {
  const products = [
    { product_name: 'A', product_image: 'https://img.test/a.jpg' },
    { product_name: '',  product_image: 'https://img.test/b.jpg' },   // no name
    { product_name: 'C', product_image: '' },                          // no image
    { product_name: 'D', product_image: 'https://img.test/d.jpg' },   // image not in the email
  ];
  assert.equal(countRenderedProducts('<img src="https://img.test/a.jpg"><img src="https://img.test/b.jpg">', products), 1);
  assert.equal(countRenderedProducts('', products), 0);
  assert.equal(countRenderedProducts('<p>x</p>', null), 0);
});
