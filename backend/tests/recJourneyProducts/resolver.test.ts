import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserRecommendation } from '../../src/types/productsReco.js';

// The resolver only talks to these two services — both faked, so no DB and no Claude.
type Saved = Pick<UserRecommendation, 'productIds' | 'basedOnBookingId' | 'source'>;
type Built = { productIds: number[]; source: string; destinationCity?: string };
const state = vi.hoisted(() => ({
  saved: new Map<string, unknown>(),       // `${uid}:${type}` → getForUser row
  bookings: new Map<string, unknown>(),    // `${uid}:${type}` → findFor result
  builds: [] as { unifiedId: number; recommendationType: string; topN: number }[],
  buildResult: (_uid: number, _type: string): unknown => null,
  buildThrows: false,
}));
vi.mock('../../src/services/RecommendationRankingService.js', () => ({
  getForUser: async ({ unifiedId, recommendationType }: { unifiedId: number; recommendationType: string }) =>
    state.saved.get(`${unifiedId}:${recommendationType}`) || null,
  computeForUser: async ({ unifiedId, recommendationType, topN }: { unifiedId: number; recommendationType: string; topN: number }) => {
    state.builds.push({ unifiedId, recommendationType, topN });
    if (state.buildThrows) throw new Error('Claude down and no candidates');
    return state.buildResult(unifiedId, recommendationType);
  },
}));
vi.mock('../../src/services/BookingLookupService.js', () => ({
  findFor: async (unifiedId: number, type: string) => state.bookings.get(`${unifiedId}:${type}`) || null,
}));

const { resolveRecProductsForUser } = await import('../../src/services/RecommendationResolver.js');

const ids = (n: number, start = 1) => Array.from({ length: n }, (_, i) => start + i);
const save = (key: string, row: Partial<Saved>) => state.saved.set(key, { basedOnBookingId: null, source: 'claude', ...row });
const book = (key: string, bookingId: number) => state.bookings.set(key, { bookingId });

beforeEach(() => {
  state.saved.clear();
  state.bookings.clear();
  state.builds = [];
  state.buildResult = (): Built => ({ productIds: ids(15, 500), source: 'claude', destinationCity: 'Dubai' });
  state.buildThrows = false;
});

describe('RecommendationResolver — which products a recommendation email uses', () => {
  it('saved future-trip picks built for the current booking are used as-is — no Claude call', async () => {
    book('1:future_trip', 77);
    save('1:future_trip', { productIds: ids(15), basedOnBookingId: '77' });
    const r = await resolveRecProductsForUser({ unifiedId: 1, recommendationType: 'future_trip' });
    expect(r.productIds).toEqual(ids(15));
    expect(r.recommendationType).toBe('future_trip');
    expect(state.builds).toHaveLength(0);
  });

  it('saved picks for an OLDER booking are rebuilt for the new trip', async () => {
    book('2:future_trip', 900);
    save('2:future_trip', { productIds: ids(15), basedOnBookingId: '77' });
    const r = await resolveRecProductsForUser({ unifiedId: 2, recommendationType: 'future_trip' });
    expect(state.builds).toEqual([{ unifiedId: 2, recommendationType: 'future_trip', topN: 15 }]);
    expect(r.source).toBe('built_now:claude');
    expect(r.productIds).toHaveLength(15);
  });

  it('no saved picks but a future booking → built now for that booking', async () => {
    book('3:future_trip', 5);
    const r = await resolveRecProductsForUser({ unifiedId: 3, recommendationType: 'future_trip' });
    expect(state.builds).toHaveLength(1);
    expect(r.recommendationType).toBe('future_trip');
  });

  it('same-day trip on a future-trip journey (the Vaibhav case) → on-trip picks, not generic ones', async () => {
    book('4:on_trip', 5248892);
    save('4:on_trip', { productIds: ids(15, 100), basedOnBookingId: '5248892' });
    save('4:future_trip', { productIds: ids(15, 300), basedOnBookingId: null });   // generic, must not win
    const r = await resolveRecProductsForUser({ unifiedId: 4, recommendationType: 'future_trip' });
    expect(r.recommendationType).toBe('on_trip');
    expect(r.productIds).toEqual(ids(15, 100));
    expect(state.builds).toHaveLength(0);
  });

  it("an old trip's picks are never reused when the user has no booking of that type", async () => {
    save('5:future_trip', { productIds: ids(15, 300), basedOnBookingId: '77' });   // last month's trip
    const r = await resolveRecProductsForUser({ unifiedId: 5, recommendationType: 'future_trip' });
    expect(state.builds).toEqual([{ unifiedId: 5, recommendationType: 'future_trip', topN: 15 }]);   // generic Dubai build
    expect(r.source).toBe('built_now:claude');
  });

  it('no booking at all → saved generic (Dubai) picks are reused, built only when missing', async () => {
    save('6:future_trip', { productIds: ids(15, 300), basedOnBookingId: null, source: 'fallback' });
    const r = await resolveRecProductsForUser({ unifiedId: 6, recommendationType: 'future_trip' });
    expect(r.productIds).toEqual(ids(15, 300));
    expect(state.builds).toHaveLength(0);
  });

  it('building fails at every step → empty list, so the send path skips the email', async () => {
    book('7:future_trip', 1);
    state.buildThrows = true;
    const r = await resolveRecProductsForUser({ unifiedId: 7, recommendationType: 'future_trip' });
    expect(r.productIds).toEqual([]);
    expect(r.source).toBe('none');
  });

  it('a build that returns fewer than 3 products moves on to the next step', async () => {
    book('8:future_trip', 1);
    book('8:on_trip', 2);
    state.buildResult = (_uid, type): Built =>
      (type === 'future_trip' ? { productIds: [1, 2], source: 'fallback' } : { productIds: ids(15, 700), source: 'claude' });
    const r = await resolveRecProductsForUser({ unifiedId: 8, recommendationType: 'future_trip' });
    expect(r.recommendationType).toBe('on_trip');
    expect(r.productIds).toEqual(ids(15, 700));
  });

  it('on-trip journeys fall back to a future trip the same way', async () => {
    book('9:future_trip', 3);
    save('9:future_trip', { productIds: ids(15, 40), basedOnBookingId: '3' });
    const r = await resolveRecProductsForUser({ unifiedId: 9, recommendationType: 'on_trip' });
    expect(r.recommendationType).toBe('future_trip');
    expect(r.productIds).toEqual(ids(15, 40));
  });

  it('past_trip keeps its saved row as-is (no fallback, no build)', async () => {
    save('10:past_trip', { productIds: [1, 2, 3, 4, 5] });
    const r = await resolveRecProductsForUser({ unifiedId: 10, recommendationType: 'past_trip' });
    expect(r.productIds).toEqual([1, 2, 3, 4, 5]);
    expect(state.builds).toHaveLength(0);
  });
});
