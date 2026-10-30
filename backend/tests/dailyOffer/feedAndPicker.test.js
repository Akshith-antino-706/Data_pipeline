import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFeed, fetchFeed, normalizeProduct, isUsable, FeedError } from '../../src/services/dailyOffer/feed.js';
import { pickForLoopDay, nextLoopDay, isPlainTransfer, takeFresh } from '../../src/services/dailyOffer/picker.js';
import { raw, feedBody, fullFeed, sampleProducts } from './fixtures.js';

const NOW = new Date('2026-11-01T05:30:00Z');   // 9:30 AM Dubai
const products = () => sampleProducts().map(normalizeProduct);

// ── Feed ──

test('feed: valid today feed is accepted and trimmed to needed fields', () => {
  const { products: ps } = validateFeed(fullFeed(NOW), { now: NOW });
  assert.ok(ps.length >= 1600);
  assert.deepEqual(Object.keys(ps[0]).sort(), ['available', 'category', 'city', 'cityOrder', 'country', 'countryOrder', 'image', 'key', 'name', 'prices', 'productId', 'rank', 'rankInCity', 'slug', 'subtitle', 'type', 'url'].sort());
});

test('feed: not built today → feed_not_today', () => {
  const body = fullFeed(NOW);
  body.generatedAt = '2026-10-31T01:00:00Z';
  assert.throws(() => validateFeed(body, { now: NOW }), e => e instanceof FeedError && e.reason === 'feed_not_today');
});

test('feed: prices not updated today → prices_not_today', () => {
  const body = fullFeed(NOW);
  delete body.marketPricesAt;
  assert.throws(() => validateFeed(body, { now: NOW }), e => e.reason === 'prices_not_today');
});

test('feed: too few rows → feed_too_small', () => {
  assert.throws(() => validateFeed(feedBody(sampleProducts(), NOW), { now: NOW }), e => e.reason === 'feed_too_small');
});

test('feed: no products list → feed_invalid', () => {
  assert.throws(() => validateFeed({ generatedAt: NOW.toISOString() }, { now: NOW }), e => e.reason === 'feed_invalid');
});

test('feed: HTTP error and timeout are reported, not thrown raw', async () => {
  await assert.rejects(fetchFeed({ url: 'x', now: NOW, fetchImpl: async () => ({ ok: false, status: 503 }) }), e => e.reason === 'feed_http_error');
  const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await assert.rejects(fetchFeed({ url: 'x', now: NOW, timeoutMs: 20, fetchImpl: hang }), e => e.reason === 'feed_timeout');
});

test('feed: product key includes type (visa and holiday ids can clash)', () => {
  const a = normalizeProduct(raw({ type: 'visa', productId: 340 }));
  const b = normalizeProduct(raw({ type: 'holiday', productId: 340 }));
  assert.notEqual(a.key, b.key);
});

test('feed: unusable products — unavailable, no image, zero price', () => {
  assert.equal(isUsable(normalizeProduct(raw({ status: 'unavailable' }))), false);
  assert.equal(isUsable(normalizeProduct(raw({ image: '' }))), false);
  assert.equal(isUsable(normalizeProduct(raw({ sale: 0 }))), false);
  assert.equal(isUsable(normalizeProduct(raw({}))), true);
});

// ── Loop ──

test('loop: next day wraps 8 → 1, nothing sent yet → 1', () => {
  assert.equal(nextLoopDay(null), 1);
  assert.equal(nextLoopDay(1), 2);
  assert.equal(nextLoopDay(8), 1);
  assert.equal(nextLoopDay(99), 1);
});

// ── Visa ──

test('visa day 1: fixed UAE/USA/Schengen first, then ranked 1–7 without Schengen twice', () => {
  const pick = pickForLoopDay(products(), 1);
  const names = pick.groups[0].products.map(p => p.name);
  assert.deepEqual(names.slice(0, 3), ['Dubai Visa', 'US Visa', 'Schengen Visa']);
  assert.deepEqual(names.slice(3), ['Visa 1', 'Visa 2', 'Visa 3', 'Visa 4', 'Visa 5', 'Visa 6', 'Visa 7']);
  assert.equal(pick.count, 10);
  assert.equal(new Set(pick.productKeys).size, 10);
});

test('visa days 4 and 8 use ranks 8–14 and 15–21', () => {
  assert.deepEqual(pickForLoopDay(products(), 4).groups[0].products.slice(3).map(p => p.name), ['Visa 8', 'Visa 9', 'Visa 10', 'Visa 11', 'Visa 12', 'Visa 13', 'Visa 14']);
  assert.deepEqual(pickForLoopDay(products(), 8).groups[0].products.slice(3).map(p => p.name).at(-1), 'Visa 21');
});

test('visa: an unavailable fixed visa is left out and reported', () => {
  const ps = products().map(p => p.slug === 'usa-visa' ? { ...p, available: false } : p);
  const pick = pickForLoopDay(ps, 1);
  assert.deepEqual(pick.missingFixedVisas, ['usa-visa']);
  assert.equal(pick.count, 9);
});

// ── Holidays ──

test('holiday multi: top 5 countries × 3', () => {
  const pick = pickForLoopDay(products(), 2);
  assert.deepEqual(pick.groups.map(g => g.title), ['HolCountry1', 'HolCountry2', 'HolCountry3', 'HolCountry4', 'HolCountry5']);
  assert.ok(pick.groups.every(g => g.products.length === 3));
});

test('holiday multi: skips products sent in the previous holiday email', () => {
  const first = pickForLoopDay(products(), 2);
  const second = pickForLoopDay(products(), 2, { productKeys: first.productKeys });
  assert.equal(second.productKeys.filter(k => first.productKeys.includes(k)).length, 0);
  assert.equal(second.count, 15);
});

test('holiday single: top country, top 3 cities × 5 (refills from the top when a city runs out)', () => {
  const pick = pickForLoopDay(products(), 6);
  assert.equal(pick.themeName, 'HolCountry1 Holidays');
  assert.ok(pick.groups.length >= 3);
  assert.ok(pick.groups.every(g => g.products.every(p => p.country === 'HolCountry1')));
  assert.equal(new Set(pick.productKeys).size, pick.count);
});

// ── Activities ──

test('activities: plain transfers are excluded, tours with transfer stay', () => {
  assert.equal(isPlainTransfer(normalizeProduct(raw({ category: 'Transfers' }))), true);
  assert.equal(isPlainTransfer(normalizeProduct(raw({ url: 'https://www.raynatours.com/bkk/ground-transport/hua-hin-e-1' }))), true);
  assert.equal(isPlainTransfer(normalizeProduct(raw({ name: 'Desert Buggy with Transfer' }))), false);
  const pick = pickForLoopDay(products(), 3);
  assert.ok(pick.groups.flatMap(g => g.products).every(p => p.category !== 'Transfers'));
});

test('activities: countries 1–5, then 6–10 next time, up to 30 then wrap', () => {
  const a = pickForLoopDay(products(), 3);
  assert.deepEqual(a.groups.map(g => g.title), ['ActCountry1', 'ActCountry2', 'ActCountry3', 'ActCountry4', 'ActCountry5']);
  assert.equal(a.count, 15);
  const b = pickForLoopDay(products(), 7, { activityCursor: a.activityCursor });
  assert.deepEqual(b.groups.map(g => g.title), ['ActCountry6', 'ActCountry7', 'ActCountry8', 'ActCountry9', 'ActCountry10']);
  const c = pickForLoopDay(products(), 3, { activityCursor: 25 });
  assert.equal(c.groups[0].title, 'ActCountry26');
  assert.equal(c.activityCursor, 0, 'wraps after country 30');
});

// ── Cruises ──

test('cruise: top 10, then the next 10, then refill from the top', () => {
  const a = pickForLoopDay(products(), 5);
  assert.equal(a.count, 10);
  const b = pickForLoopDay(products(), 5, { productKeys: a.productKeys });
  assert.equal(b.productKeys.filter(k => a.productKeys.includes(k)).length, 0);
  const c = pickForLoopDay(products(), 5, { productKeys: [...a.productKeys, ...b.productKeys] });
  assert.equal(c.count, 10, '5 fresh + 5 refilled from the top');
});

test('takeFresh never duplicates', () => {
  const list = [1, 2, 3].map(i => ({ key: `k${i}` }));
  assert.deepEqual(takeFresh(list, 5, new Set(['k1'])).map(p => p.key), ['k2', 'k3', 'k1']);
});
