import { test, expect } from 'vitest';
import { normalizeProduct } from '../../src/services/dailyOffer/feed.js';
import { pickForLoopDay } from '../../src/services/dailyOffer/picker.js';
import {
  buildTemplate, buildSubject, applyMarket, renderProblems, priceFor, formatMoney, effectiveMarket, DAILY_OFFER_MARKER,
} from '../../src/services/dailyOffer/render.js';
import type { OfferPick, OfferPrice, SnapshotProduct } from '../../src/services/dailyOffer/types.js';
import { resolveMarketByMobileCountry, resolveMarket } from '../../src/utils/marketPlan.js';
import { raw, sampleProducts } from './fixtures.js';

const RATES: Record<string, number> = { AED: 1, INR: 25.95, SAR: 1.02, USD: 0.2723, GBP: 0.204, IRR: 11000 };
const snap = (pick: OfferPick): SnapshotProduct[] =>
  pick.groups.flatMap(g => g.products).map(p => ({ key: p.key, name: p.name, prices: p.prices }));

/** priceFor's result, failing the test when there is none. */
function priced(out: OfferPrice | null): OfferPrice {
  if (!out) throw new Error('expected a price');
  return out;
}

// ── Market by mobile country ──

test('market: mobile country only', () => {
  expect(resolveMarketByMobileCountry('India')).toEqual({ plan: 'IN', currency: 'INR' });
  expect(resolveMarketByMobileCountry('UAE')).toEqual({ plan: 'AE', currency: 'AED' });
  expect(resolveMarketByMobileCountry('United Arab Emirates')).toEqual({ plan: 'AE', currency: 'AED' });
  expect(resolveMarketByMobileCountry('Saudi Arabia')).toEqual({ plan: 'SA', currency: 'SAR' });
  expect(resolveMarketByMobileCountry('United Kingdom')).toEqual({ plan: 'default', currency: 'GBP' });
  expect(resolveMarketByMobileCountry('')).toEqual({ plan: 'default', currency: 'AED' });
  expect(resolveMarketByMobileCountry(null)).toEqual({ plan: 'default', currency: 'AED' });
});

test('market: existing resolveMarket is unchanged (is_indian still wins there)', () => {
  expect(resolveMarket({ mobile_country: 'UAE', is_indian: true })).toEqual({ plan: 'IN', currency: 'INR' });
});

// ── Prices ──

test('price: market row, strike + save % only for a real discount', () => {
  const p = normalizeProduct(raw({ sale: 13.24, price: 142.04 })).prices;
  const out = priced(priceFor(p, effectiveMarket({ plan: 'AE', currency: 'AED' }, RATES)));
  expect(formatMoney(out.sale, out.currency)).toBe('AED 13.24');
  expect(formatMoney(out.strike ?? 0, out.currency)).toBe('AED 142.04');
  expect(out.savePct).toBe(91);
  const flat = priced(priceFor(normalizeProduct(raw({ sale: 270 })).prices, effectiveMarket({ plan: 'AE', currency: 'AED' }, RATES)));
  expect(flat.strike).toBe(null);
  expect(flat.savePct).toBe(0);
});

test('price: a 0 market price falls back to the default price (never "SAR 0")', () => {
  const p = normalizeProduct(raw({ sale: 28, saleSA: 0 })).prices;
  const out = priced(priceFor(p, effectiveMarket({ plan: 'SA', currency: 'SAR' }, RATES)));
  expect(out.sale).toBeGreaterThan(0);
  expect(formatMoney(out.sale, out.currency)).toBe('SAR 28.56');
});

test('price: India converts to whole rupees', () => {
  const p = normalizeProduct(raw({ sale: 270 })).prices;
  const out = priced(priceFor(p, effectiveMarket({ plan: 'IN', currency: 'INR' }, RATES)));
  expect(formatMoney(out.sale, out.currency)).toBe('₹7,007');
});

test('price: missing or extreme exchange rate → AED, correctly labelled', () => {
  expect(effectiveMarket({ plan: 'IN', currency: 'INR' }, {}).currency).toBe('AED');
  expect(effectiveMarket({ plan: 'default', currency: 'IRR' }, RATES).currency).toBe('AED');
});

test('money format', () => {
  expect(formatMoney(1796, 'AED')).toBe('AED 1,796');
  expect(formatMoney(35.5, 'USD')).toBe('$35.50');
  expect(formatMoney(55, 'GBP')).toBe('£55');
});

// ── Template ──

test('template: marker first, tokens in place, no {{…}} placeholders, footer kept', () => {
  const pick = pickForLoopDay(sampleProducts().map(normalizeProduct), 1);
  const html = buildTemplate(pick);
  expect(html.startsWith(DAILY_OFFER_MARKER)).toBe(true);
  expect((html.match(/%%DO_PRICE:/g) || []).length).toBe(pick.count);
  expect(/\{\{/.test(html)).toBe(false);
  expect(html).toContain('raynatourslogo.png');
  expect(html).toContain('https://promotions.raynatours.com/unsubscribe');
  expect(html).toContain('https://www.raynatours.com/visas');
  expect(buildSubject(pick)).toMatch(/– from %%DO_FROM%%$/);
});

test('template: every market renders clean; India in ₹, UAE in AED, subject filled', () => {
  const pick = pickForLoopDay(sampleProducts().map(normalizeProduct), 3);
  const tpl = { html: buildTemplate(pick), subject: buildSubject(pick) };
  const india = applyMarket(tpl, snap(pick), { plan: 'IN', currency: 'INR' }, RATES);
  const uae = applyMarket(tpl, snap(pick), { plan: 'AE', currency: 'AED' }, RATES);
  for (const r of [india, uae]) expect(renderProblems(r)).toEqual([]);
  expect(india.subject).toMatch(/from ₹/);
  expect(uae.subject).toMatch(/from AED /);
  expect(india.html, 'discounted activities show the Save badge').toContain('Save ');
  expect(india.html).toContain('text-decoration:line-through');
});

test('template: a product without any price is caught before sending', () => {
  const pick = pickForLoopDay(sampleProducts().map(normalizeProduct), 5);
  const products = snap(pick);
  products[0] = { ...products[0], prices: { default: { price: 0, sale: 0 } } };
  const out = applyMarket({ html: buildTemplate(pick), subject: buildSubject(pick) }, products, { plan: 'AE', currency: 'AED' }, RATES);
  expect(renderProblems(out).some(p => p.includes('without a price'))).toBe(true);
});

test('template: names are HTML-escaped', () => {
  const ps = sampleProducts().map(normalizeProduct);
  const c = ps.find(p => p.type === 'cruise');
  if (!c) throw new Error('fixture has no cruise');
  c.name = 'Fish & Chips <Cruise>';
  c.rank = -1;
  const html = buildTemplate(pickForLoopDay(ps, 5));
  expect(html).toContain('Fish &amp; Chips &lt;Cruise&gt;');
});
