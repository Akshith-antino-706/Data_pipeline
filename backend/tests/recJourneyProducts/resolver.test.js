import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Never reach a real database: the resolver only talks to these two (faked) services.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '1';

const ids = (n, start = 1) => Array.from({ length: n }, (_, i) => start + i);
let saved, bookings, builds, buildResult, buildThrows;
beforeEach(() => {
  saved = new Map();      // `${uid}:${type}` → getForUser row
  bookings = new Map();   // `${uid}:${type}` → findFor result
  builds = [];            // computeForUser calls
  buildResult = (uid, type) => ({ productIds: ids(15, 500), source: 'claude', destinationCity: 'Dubai' });
  buildThrows = false;
});

mock.module(new URL('../../src/services/RecommendationRankingService.js', import.meta.url).href, {
  exports: {
    getForUser: async ({ unifiedId, recommendationType }) => saved.get(`${unifiedId}:${recommendationType}`) || null,
    computeForUser: async ({ unifiedId, recommendationType, topN }) => {
      builds.push({ unifiedId, recommendationType, topN });
      if (buildThrows) throw new Error('Claude down and no candidates');
      return buildResult(unifiedId, recommendationType);
    },
  },
});
mock.module(new URL('../../src/services/BookingLookupService.js', import.meta.url).href, {
  exports: { findFor: async (unifiedId, type) => bookings.get(`${unifiedId}:${type}`) || null },
});

const { resolveRecProductsForUser } = await import('../../src/services/RecommendationResolver.js');

test('saved future-trip picks built for the current booking are used as-is — no Claude call', async () => {
  bookings.set('1:future_trip', { bookingId: 77 });
  saved.set('1:future_trip', { productIds: ids(15), basedOnBookingId: 77, source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 1, recommendationType: 'future_trip' });
  assert.deepEqual(r.productIds, ids(15));
  assert.equal(r.recommendationType, 'future_trip');
  assert.equal(builds.length, 0);
});

test('saved picks for an OLDER booking are rebuilt for the new trip', async () => {
  bookings.set('2:future_trip', { bookingId: 900 });
  saved.set('2:future_trip', { productIds: ids(15), basedOnBookingId: 77, source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 2, recommendationType: 'future_trip' });
  assert.deepEqual(builds, [{ unifiedId: 2, recommendationType: 'future_trip', topN: 15 }]);
  assert.equal(r.source, 'built_now:claude');
  assert.equal(r.productIds.length, 15);
});

test('no saved picks but a future booking → built now for that booking', async () => {
  bookings.set('3:future_trip', { bookingId: 5 });
  const r = await resolveRecProductsForUser({ unifiedId: 3, recommendationType: 'future_trip' });
  assert.equal(builds.length, 1);
  assert.equal(r.recommendationType, 'future_trip');
});

test('same-day trip on a future-trip journey (the Vaibhav case) → on-trip picks, not generic ones', async () => {
  bookings.set('4:on_trip', { bookingId: 5248892 });
  saved.set('4:on_trip', { productIds: ids(15, 100), basedOnBookingId: 5248892, source: 'claude' });
  saved.set('4:future_trip', { productIds: ids(15, 300), basedOnBookingId: null, source: 'claude' });   // generic, must not win
  const r = await resolveRecProductsForUser({ unifiedId: 4, recommendationType: 'future_trip' });
  assert.equal(r.recommendationType, 'on_trip');
  assert.deepEqual(r.productIds, ids(15, 100));
  assert.equal(builds.length, 0);
});

test('an old trip\'s picks are never reused when the user has no booking of that type', async () => {
  saved.set('5:future_trip', { productIds: ids(15, 300), basedOnBookingId: 77, source: 'claude' });   // last month's trip
  const r = await resolveRecProductsForUser({ unifiedId: 5, recommendationType: 'future_trip' });
  assert.deepEqual(builds, [{ unifiedId: 5, recommendationType: 'future_trip', topN: 15 }]);         // generic Dubai build
  assert.equal(r.source, 'built_now:claude');
});

test('no booking at all → saved generic (Dubai) picks are reused, built only when missing', async () => {
  saved.set('6:future_trip', { productIds: ids(15, 300), basedOnBookingId: null, source: 'fallback' });
  const r = await resolveRecProductsForUser({ unifiedId: 6, recommendationType: 'future_trip' });
  assert.deepEqual(r.productIds, ids(15, 300));
  assert.equal(builds.length, 0);
});

test('building fails at every step → empty list, so the send path skips the email', async () => {
  bookings.set('7:future_trip', { bookingId: 1 });
  buildThrows = true;
  const r = await resolveRecProductsForUser({ unifiedId: 7, recommendationType: 'future_trip' });
  assert.deepEqual(r.productIds, []);
  assert.equal(r.source, 'none');
});

test('a build that returns fewer than 3 products moves on to the next step', async () => {
  bookings.set('8:future_trip', { bookingId: 1 });
  bookings.set('8:on_trip', { bookingId: 2 });
  buildResult = (uid, type) => (type === 'future_trip' ? { productIds: [1, 2], source: 'fallback' } : { productIds: ids(15, 700), source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 8, recommendationType: 'future_trip' });
  assert.equal(r.recommendationType, 'on_trip');
  assert.deepEqual(r.productIds, ids(15, 700));
});

test('on-trip journeys fall back to a future trip the same way', async () => {
  bookings.set('9:future_trip', { bookingId: 3 });
  saved.set('9:future_trip', { productIds: ids(15, 40), basedOnBookingId: 3, source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 9, recommendationType: 'on_trip' });
  assert.equal(r.recommendationType, 'future_trip');
  assert.deepEqual(r.productIds, ids(15, 40));
});

test('past_trip keeps its saved row as-is (no fallback, no build)', async () => {
  saved.set('10:past_trip', { productIds: [1, 2, 3, 4, 5], source: 'claude' });
  const r = await resolveRecProductsForUser({ unifiedId: 10, recommendationType: 'past_trip' });
  assert.deepEqual(r.productIds, [1, 2, 3, 4, 5]);
  assert.equal(builds.length, 0);
});
