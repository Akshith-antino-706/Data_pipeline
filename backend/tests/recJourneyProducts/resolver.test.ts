import { test, expect, vi, beforeEach } from 'vitest';

// Never reach a real database: the resolver only talks to these two (faked) services.
type SavedRec = { productIds: number[]; basedOnBookingId?: number | null; source: string };
type BuildResult = { productIds: number[]; source: string; destinationCity?: string };
type BuildCall = { unifiedId: number; recommendationType: string; topN: number };

const ids = (n: number, start = 1): number[] => Array.from({ length: n }, (_, i) => start + i);

const t = vi.hoisted(() => ({
  saved: new Map<string, SavedRec>(),                   // `${uid}:${type}` → getForUser row
  bookings: new Map<string, { bookingId: number }>(),   // `${uid}:${type}` → findFor result
  builds: [] as BuildCall[],                            // computeForUser calls
  buildResult: (_uid: number, _type: string): BuildResult => ({ productIds: [], source: '' }),
  buildThrows: false,
}));

beforeEach(() => {
  t.saved = new Map();
  t.bookings = new Map();
  t.builds = [];
  t.buildResult = () => ({ productIds: ids(15, 500), source: 'claude', destinationCity: 'Dubai' });
  t.buildThrows = false;
});

vi.mock('../../src/services/RecommendationRankingService.js', () => ({
  getForUser: async ({ unifiedId, recommendationType }: { unifiedId: number; recommendationType: string }) => t.saved.get(`${unifiedId}:${recommendationType}`) || null,
  computeForUser: async ({ unifiedId, recommendationType, topN }: BuildCall) => {
    t.builds.push({ unifiedId, recommendationType, topN });
    if (t.buildThrows) throw new Error('Claude down and no candidates');
    return t.buildResult(unifiedId, recommendationType);
  },
}));
vi.mock('../../src/services/BookingLookupService.js', () => ({
  findFor: async (unifiedId: number, type: string) => t.bookings.get(`${unifiedId}:${type}`) || null,
}));

import { resolveRecProductsForUser } from '../../src/services/RecommendationResolver.js';

test('saved future-trip picks built for the current booking are used as-is — no Claude call', async () => {
  t.bookings.set('1:future_trip', { bookingId: 77 });
  t.saved.set('1:future_trip', { productIds: ids(15), basedOnBookingId: 77, source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 1, recommendationType: 'future_trip' });
  expect(r.productIds).toEqual(ids(15));
  expect(r.recommendationType).toBe('future_trip');
  expect(t.builds.length).toBe(0);
});

test('saved picks for an OLDER booking are rebuilt for the new trip', async () => {
  t.bookings.set('2:future_trip', { bookingId: 900 });
  t.saved.set('2:future_trip', { productIds: ids(15), basedOnBookingId: 77, source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 2, recommendationType: 'future_trip' });
  expect(t.builds).toEqual([{ unifiedId: 2, recommendationType: 'future_trip', topN: 15 }]);
  expect(r.source).toBe('built_now:claude');
  expect(r.productIds.length).toBe(15);
});

test('no saved picks but a future booking → built now for that booking', async () => {
  t.bookings.set('3:future_trip', { bookingId: 5 });
  const r = await resolveRecProductsForUser({ unifiedId: 3, recommendationType: 'future_trip' });
  expect(t.builds.length).toBe(1);
  expect(r.recommendationType).toBe('future_trip');
});

test('same-day trip on a future-trip journey (the Vaibhav case) → on-trip picks, not generic ones', async () => {
  t.bookings.set('4:on_trip', { bookingId: 5248892 });
  t.saved.set('4:on_trip', { productIds: ids(15, 100), basedOnBookingId: 5248892, source: 'claude' });
  t.saved.set('4:future_trip', { productIds: ids(15, 300), basedOnBookingId: null, source: 'claude' });   // generic, must not win
  const r = await resolveRecProductsForUser({ unifiedId: 4, recommendationType: 'future_trip' });
  expect(r.recommendationType).toBe('on_trip');
  expect(r.productIds).toEqual(ids(15, 100));
  expect(t.builds.length).toBe(0);
});

test('an old trip\'s picks are never reused when the user has no booking of that type', async () => {
  t.saved.set('5:future_trip', { productIds: ids(15, 300), basedOnBookingId: 77, source: 'claude' });   // last month's trip
  const r = await resolveRecProductsForUser({ unifiedId: 5, recommendationType: 'future_trip' });
  expect(t.builds).toEqual([{ unifiedId: 5, recommendationType: 'future_trip', topN: 15 }]);         // generic Dubai build
  expect(r.source).toBe('built_now:claude');
});

test('no booking at all → saved generic (Dubai) picks are reused, built only when missing', async () => {
  t.saved.set('6:future_trip', { productIds: ids(15, 300), basedOnBookingId: null, source: 'fallback' });
  const r = await resolveRecProductsForUser({ unifiedId: 6, recommendationType: 'future_trip' });
  expect(r.productIds).toEqual(ids(15, 300));
  expect(t.builds.length).toBe(0);
});

test('building fails at every step → empty list, so the send path skips the email', async () => {
  t.bookings.set('7:future_trip', { bookingId: 1 });
  t.buildThrows = true;
  const r = await resolveRecProductsForUser({ unifiedId: 7, recommendationType: 'future_trip' });
  expect(r.productIds).toEqual([]);
  expect(r.source).toBe('none');
});

test('a build that returns fewer than 3 products moves on to the next step', async () => {
  t.bookings.set('8:future_trip', { bookingId: 1 });
  t.bookings.set('8:on_trip', { bookingId: 2 });
  t.buildResult = (_uid, type) => (type === 'future_trip' ? { productIds: [1, 2], source: 'fallback' } : { productIds: ids(15, 700), source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 8, recommendationType: 'future_trip' });
  expect(r.recommendationType).toBe('on_trip');
  expect(r.productIds).toEqual(ids(15, 700));
});

test('on-trip journeys fall back to a future trip the same way', async () => {
  t.bookings.set('9:future_trip', { bookingId: 3 });
  t.saved.set('9:future_trip', { productIds: ids(15, 40), basedOnBookingId: 3, source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 9, recommendationType: 'on_trip' });
  expect(r.recommendationType).toBe('future_trip');
  expect(r.productIds).toEqual(ids(15, 40));
});

test('past_trip keeps its saved row as-is (no fallback, no build)', async () => {
  t.saved.set('10:past_trip', { productIds: [1, 2, 3, 4, 5], source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 10, recommendationType: 'past_trip' });
  expect(r.productIds).toEqual([1, 2, 3, 4, 5]);
  expect(t.builds.length).toBe(0);
});
