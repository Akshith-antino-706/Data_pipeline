import { test, expect } from 'vitest';
import { validateFeed, fetchFeed, normalizeProduct, isUsable, FeedError } from '../../src/services/dailyOffer/feed.js';
import { pickForLoopDay, loopDayForDate, LOOP, isPlainTransfer, takeFresh } from '../../src/services/dailyOffer/picker.js';
import type { OfferProduct } from '../../src/services/dailyOffer/types.js';
import { raw, feedBody, fullFeed, sampleProducts } from './fixtures.js';

const NOW = new Date('2026-11-01T05:30:00Z');   // 9:30 AM Dubai
const products = (): OfferProduct[] => sampleProducts().map(normalizeProduct);

/** The FeedError reason thrown by `fn`, or null. */
function reasonOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof FeedError ? e.reason : 'not a FeedError'; }
}

async function rejectReason(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return e instanceof FeedError ? e.reason : 'not a FeedError'; }
}

// ── Feed ──

test('feed: valid today feed is accepted and trimmed to needed fields', () => {
  const { products: ps } = validateFeed(fullFeed(NOW), { now: NOW });
  expect(ps.length).toBeGreaterThanOrEqual(1600);
  expect(Object.keys(ps[0]).sort()).toEqual(['available', 'category', 'city', 'cityOrder', 'country', 'countryOrder', 'image', 'key', 'name', 'prices', 'productId', 'rank', 'rankInCity', 'slug', 'subtitle', 'type', 'url'].sort());
});

test('feed: not built today → feed_not_today', () => {
  const body = fullFeed(NOW);
  body.generatedAt = '2026-10-31T01:00:00Z';
  expect(reasonOf(() => validateFeed(body, { now: NOW }))).toBe('feed_not_today');
});

test('feed: prices not updated today → prices_not_today', () => {
  const body = fullFeed(NOW);
  body.marketPricesAt = undefined;
  expect(reasonOf(() => validateFeed(body, { now: NOW }))).toBe('prices_not_today');
});

test('feed: too few rows → feed_too_small', () => {
  expect(reasonOf(() => validateFeed(feedBody(sampleProducts(), NOW), { now: NOW }))).toBe('feed_too_small');
});

test('feed: no products list → feed_invalid', () => {
  expect(reasonOf(() => validateFeed({ generatedAt: NOW.toISOString() }, { now: NOW }))).toBe('feed_invalid');
});

test('feed: HTTP error and timeout are reported, not thrown raw', async () => {
  const http503: typeof fetch = async () => new Response(null, { status: 503 });
  expect(await rejectReason(fetchFeed({ url: 'x', now: NOW, fetchImpl: http503 }))).toBe('feed_http_error');
  const hang: typeof fetch = (_u, init) => new Promise<Response>((_, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  expect(await rejectReason(fetchFeed({ url: 'x', now: NOW, timeoutMs: 20, fetchImpl: hang }))).toBe('feed_timeout');
});

test('feed: product key includes type (visa and holiday ids can clash)', () => {
  const a = normalizeProduct(raw({ type: 'visa', productId: 340 }));
  const b = normalizeProduct(raw({ type: 'holiday', productId: 340 }));
  expect(a.key).not.toBe(b.key);
});

test('feed: unusable products — unavailable, no image, zero price', () => {
  expect(isUsable(normalizeProduct(raw({ status: 'unavailable' })))).toBe(false);
  expect(isUsable(normalizeProduct(raw({ image: '' })))).toBe(false);
  expect(isUsable(normalizeProduct(raw({ sale: 0 })))).toBe(false);
  expect(isUsable(normalizeProduct(raw({})))).toBe(true);
});

// ── Loop ──

test('loop: the Dubai date decides the day — Holiday, Cruise, Activities, Visa from 3 Nov 2026', () => {
  const theme = (d: string): string => LOOP[loopDayForDate(d) - 1].theme;
  expect(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-30'].map(theme))
    .toEqual(['holiday_multi', 'cruise', 'activities', 'visa', 'holiday_single', 'visa']);
  expect(loopDayForDate('2026-11-03')).toBe(1);
  expect(loopDayForDate('2026-11-27'), 'wraps after 24 days').toBe(1);
  expect(loopDayForDate('2026-11-02'), 'dates before the start count backwards').toBe(24);
});

test('loop: holiday style alternates and visa ranks walk 1–7, 8–14, 15–21 across the 24 days', () => {
  expect(LOOP.filter(s => s.theme.startsWith('holiday')).map(s => s.theme))
    .toEqual(['holiday_multi', 'holiday_single', 'holiday_multi', 'holiday_single', 'holiday_multi', 'holiday_single']);
  expect(LOOP.filter(s => s.theme === 'visa').map(s => s.visaFrom)).toEqual([1, 8, 15, 1, 8, 15]);
  expect(LOOP.every((s, i) => s.theme.startsWith(['holiday', 'cruise', 'activities', 'visa'][i % 4]))).toBe(true);
});

// ── Visa ──

test('visa (Day 4): fixed UAE/USA/Schengen first, then ranked 1–7 without Schengen twice', () => {
  const pick = pickForLoopDay(products(), 4);
  const names = pick.groups[0].products.map(p => p.name);
  expect(names.slice(0, 3)).toEqual(['Dubai Visa', 'US Visa', 'Schengen Visa']);
  expect(names.slice(3)).toEqual(['Visa 1', 'Visa 2', 'Visa 3', 'Visa 4', 'Visa 5', 'Visa 6', 'Visa 7']);
  expect(pick.count).toBe(10);
  expect(new Set(pick.productKeys).size).toBe(10);
});

test('visa Days 8 and 12 use ranks 8–14 and 15–21', () => {
  expect(pickForLoopDay(products(), 8).groups[0].products.slice(3).map(p => p.name)).toEqual(['Visa 8', 'Visa 9', 'Visa 10', 'Visa 11', 'Visa 12', 'Visa 13', 'Visa 14']);
  expect(pickForLoopDay(products(), 12).groups[0].products.slice(3).map(p => p.name).at(-1)).toBe('Visa 21');
});

test('visa: an unavailable fixed visa is left out and reported', () => {
  const ps = products().map(p => p.slug === 'usa-visa' ? { ...p, available: false } : p);
  const pick = pickForLoopDay(ps, 4);
  expect(pick.missingFixedVisas).toEqual(['usa-visa']);
  expect(pick.count).toBe(9);
});

// ── Holidays ──

test('holiday multi: top 5 countries × 3', () => {
  const pick = pickForLoopDay(products(), 1);
  expect(pick.groups.map(g => g.title)).toEqual(['HolCountry1', 'HolCountry2', 'HolCountry3', 'HolCountry4', 'HolCountry5']);
  expect(pick.groups.every(g => g.products.length === 3)).toBe(true);
});

test('holiday multi: skips products sent in the previous holiday email', () => {
  const first = pickForLoopDay(products(), 1);
  const second = pickForLoopDay(products(), 1, { productKeys: first.productKeys });
  expect(second.productKeys.filter(k => first.productKeys.includes(k)).length).toBe(0);
  expect(second.count).toBe(15);
});

test('holiday single: top country, top 3 cities × 5 (refills from the top when a city runs out)', () => {
  const pick = pickForLoopDay(products(), 5);
  expect(pick.themeName).toBe('HolCountry1 Holidays');
  expect(pick.groups.length).toBeGreaterThanOrEqual(3);
  expect(pick.groups.every(g => g.products.every(p => p.country === 'HolCountry1'))).toBe(true);
  expect(new Set(pick.productKeys).size).toBe(pick.count);
});

// ── Activities ──

test('activities: plain transfers are excluded, tours with transfer stay', () => {
  expect(isPlainTransfer(normalizeProduct(raw({ category: 'Transfers' })))).toBe(true);
  expect(isPlainTransfer(normalizeProduct(raw({ url: 'https://www.raynatours.com/bkk/ground-transport/hua-hin-e-1' })))).toBe(true);
  expect(isPlainTransfer(normalizeProduct(raw({ name: 'Desert Buggy with Transfer' })))).toBe(false);
  const pick = pickForLoopDay(products(), 3);
  expect(pick.groups.flatMap(g => g.products).every(p => p.category !== 'Transfers')).toBe(true);
});

test('activities: countries 1–5, then 6–10 next time, up to 30 then wrap', () => {
  const a = pickForLoopDay(products(), 3);
  expect(a.groups.map(g => g.title)).toEqual(['ActCountry1', 'ActCountry2', 'ActCountry3', 'ActCountry4', 'ActCountry5']);
  expect(a.count).toBe(15);
  const b = pickForLoopDay(products(), 7, { activityCursor: a.activityCursor });
  expect(b.groups.map(g => g.title)).toEqual(['ActCountry6', 'ActCountry7', 'ActCountry8', 'ActCountry9', 'ActCountry10']);
  const c = pickForLoopDay(products(), 3, { activityCursor: 25 });
  expect(c.groups[0].title).toBe('ActCountry26');
  expect(c.activityCursor, 'wraps after country 30').toBe(0);
});

// ── Cruises ──

test('cruise: top 10, then the next 10, then refill from the top', () => {
  const a = pickForLoopDay(products(), 2);
  expect(a.count).toBe(10);
  const b = pickForLoopDay(products(), 2, { productKeys: a.productKeys });
  expect(b.productKeys.filter(k => a.productKeys.includes(k)).length).toBe(0);
  const c = pickForLoopDay(products(), 2, { productKeys: [...a.productKeys, ...b.productKeys] });
  expect(c.count, '5 fresh + 5 refilled from the top').toBe(10);
});

test('takeFresh never duplicates', () => {
  const list = [1, 2, 3].map(i => ({ key: `k${i}` }));
  expect(takeFresh(list, 5, new Set(['k1'])).map(p => p.key)).toEqual(['k2', 'k3', 'k1']);
});
