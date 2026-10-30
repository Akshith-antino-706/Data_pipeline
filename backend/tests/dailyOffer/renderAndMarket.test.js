import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct } from '../../src/services/dailyOffer/feed.js';
import { pickForLoopDay } from '../../src/services/dailyOffer/picker.js';
import {
  buildTemplate, buildSubject, applyMarket, renderProblems, priceFor, formatMoney, effectiveMarket, DAILY_OFFER_MARKER,
} from '../../src/services/dailyOffer/render.js';
import { resolveMarketByMobileCountry, resolveMarket } from '../../src/utils/marketPlan.js';
import { raw, sampleProducts } from './fixtures.js';

const RATES = { AED: 1, INR: 25.95, SAR: 1.02, USD: 0.2723, GBP: 0.204, IRR: 11000 };
const snap = (pick) => pick.groups.flatMap(g => g.products).map(p => ({ key: p.key, name: p.name, prices: p.prices }));

// ── Market by mobile country ──

test('market: mobile country only', () => {
  assert.deepEqual(resolveMarketByMobileCountry('India'), { plan: 'IN', currency: 'INR' });
  assert.deepEqual(resolveMarketByMobileCountry('UAE'), { plan: 'AE', currency: 'AED' });
  assert.deepEqual(resolveMarketByMobileCountry('United Arab Emirates'), { plan: 'AE', currency: 'AED' });
  assert.deepEqual(resolveMarketByMobileCountry('Saudi Arabia'), { plan: 'SA', currency: 'SAR' });
  assert.deepEqual(resolveMarketByMobileCountry('United Kingdom'), { plan: 'default', currency: 'GBP' });
  assert.deepEqual(resolveMarketByMobileCountry(''), { plan: 'default', currency: 'AED' });
  assert.deepEqual(resolveMarketByMobileCountry(null), { plan: 'default', currency: 'AED' });
});

test('market: existing resolveMarket is unchanged (is_indian still wins there)', () => {
  assert.deepEqual(resolveMarket({ mobile_country: 'UAE', is_indian: true }), { plan: 'IN', currency: 'INR' });
});

// ── Prices ──

test('price: market row, strike + save % only for a real discount', () => {
  const p = normalizeProduct(raw({ sale: 13.24, price: 142.04 })).prices;
  const out = priceFor(p, effectiveMarket({ plan: 'AE', currency: 'AED' }, RATES));
  assert.equal(formatMoney(out.sale, out.currency), 'AED 13.24');
  assert.equal(formatMoney(out.strike, out.currency), 'AED 142.04');
  assert.equal(out.savePct, 91);
  const flat = priceFor(normalizeProduct(raw({ sale: 270 })).prices, effectiveMarket({ plan: 'AE', currency: 'AED' }, RATES));
  assert.equal(flat.strike, null);
  assert.equal(flat.savePct, 0);
});

test('price: a 0 market price falls back to the default price (never "SAR 0")', () => {
  const p = normalizeProduct(raw({ sale: 28, saleSA: 0 })).prices;
  const out = priceFor(p, effectiveMarket({ plan: 'SA', currency: 'SAR' }, RATES));
  assert.ok(out.sale > 0);
  assert.equal(formatMoney(out.sale, out.currency), 'SAR 28.56');
});

test('price: India converts to whole rupees', () => {
  const p = normalizeProduct(raw({ sale: 270 })).prices;
  const out = priceFor(p, effectiveMarket({ plan: 'IN', currency: 'INR' }, RATES));
  assert.equal(formatMoney(out.sale, out.currency), '₹7,007');
});

test('price: missing or extreme exchange rate → AED, correctly labelled', () => {
  assert.equal(effectiveMarket({ plan: 'IN', currency: 'INR' }, {}).currency, 'AED');
  assert.equal(effectiveMarket({ plan: 'default', currency: 'IRR' }, RATES).currency, 'AED');
});

test('money format', () => {
  assert.equal(formatMoney(1796, 'AED'), 'AED 1,796');
  assert.equal(formatMoney(35.5, 'USD'), '$35.50');
  assert.equal(formatMoney(55, 'GBP'), '£55');
});

// ── Template ──

test('template: marker first, tokens in place, no {{…}} placeholders, footer kept', () => {
  const pick = pickForLoopDay(sampleProducts().map(normalizeProduct), 1);
  const html = buildTemplate(pick);
  assert.ok(html.startsWith(DAILY_OFFER_MARKER));
  assert.equal((html.match(/%%DO_PRICE:/g) || []).length, pick.count);
  assert.ok(!/\{\{/.test(html));
  assert.ok(html.includes('raynatourslogo.png'));
  assert.ok(html.includes('https://promotions.raynatours.com/unsubscribe'));
  assert.ok(html.includes('https://www.raynatours.com/visas'));
  assert.match(buildSubject(pick), /– from %%DO_FROM%%$/);
});

test('template: every market renders clean; India in ₹, UAE in AED, subject filled', () => {
  const pick = pickForLoopDay(sampleProducts().map(normalizeProduct), 3);
  const tpl = { html: buildTemplate(pick), subject: buildSubject(pick) };
  const india = applyMarket(tpl, snap(pick), { plan: 'IN', currency: 'INR' }, RATES);
  const uae = applyMarket(tpl, snap(pick), { plan: 'AE', currency: 'AED' }, RATES);
  for (const r of [india, uae]) assert.deepEqual(renderProblems(r), []);
  assert.match(india.subject, /from ₹/);
  assert.match(uae.subject, /from AED /);
  assert.ok(india.html.includes('Save '), 'discounted activities show the Save badge');
  assert.ok(india.html.includes('text-decoration:line-through'));
});

test('template: a product without any price is caught before sending', () => {
  const pick = pickForLoopDay(sampleProducts().map(normalizeProduct), 5);
  const products = snap(pick);
  products[0] = { ...products[0], prices: { default: { price: 0, sale: 0 } } };
  const out = applyMarket({ html: buildTemplate(pick), subject: buildSubject(pick) }, products, { plan: 'AE', currency: 'AED' }, RATES);
  assert.ok(renderProblems(out).some(p => p.includes('without a price')));
});

test('template: names are HTML-escaped', () => {
  const ps = sampleProducts().map(normalizeProduct);
  const c = ps.find(p => p.type === 'cruise');
  c.name = 'Fish & Chips <Cruise>';
  c.rank = -1;
  const html = buildTemplate(pickForLoopDay(ps, 5));
  assert.ok(html.includes('Fish &amp; Chips &lt;Cruise&gt;'));
});
