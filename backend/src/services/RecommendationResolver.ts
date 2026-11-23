/**
 * RecommendationResolver
 *
 * Decides, at send time, which saved recommendations a recommendation-journey
 * email uses — so a recipient never gets an empty product section just because
 * the nightly compute hadn't run for them, ran for an older trip, or their trip
 * type doesn't match the journey (e.g. a same-day visa on a future_trip journey).
 *
 *   1. The journey's own type (future_trip / on_trip), if it was built for the
 *      user's current booking of that type.
 *   2. Otherwise, if the user HAS a booking of that type → build it now.
 *   3. Otherwise the other type (on_trip ↔ future_trip), same two checks.
 *   4. Otherwise build the journey's own type with no booking — computeForUser
 *      then picks for Dubai.
 *
 * Building uses computeForUser unchanged: candidates come from the booking city,
 * then its country, then Dubai (unknown city / no products in the country), and
 * a Claude error falls back to the top candidates by price. past_trip is never a
 * fallback — its picks are mixed-city.
 *
 * Returns { productIds, recommendationType, source } — productIds may be empty
 * if everything failed; the send path then skips the email.
 */

import { getForUser, computeForUser } from './RecommendationRankingService.js';
import { findFor } from './BookingLookupService.js';
import type { ResolvedRecProducts, UserRecommendation } from '../types/productsReco.js';

type TripType = 'future_trip' | 'on_trip';
type Booking = Awaited<ReturnType<typeof findFor>>;

/** Products to keep per user — same as the nightly compute (dailyRecommendationCompute). */
const TOP_N = 15;
const MIN_USABLE = 3;
const OTHER_TYPE: Record<TripType, TripType> = { future_trip: 'on_trip', on_trip: 'future_trip' };
const isTripType = (t: string | undefined): t is TripType => t === 'future_trip' || t === 'on_trip';

/**
 * The saved row is usable: enough products, and built for this exact booking — or,
 * when the user has no booking of this type, built for no booking (the generic
 * Dubai picks). A row built for an older trip is never reused.
 */
function _fresh(cached: UserRecommendation | null, booking: Booking): cached is UserRecommendation {
  if (!cached || (cached.productIds || []).length < MIN_USABLE) return false;
  return String(cached.basedOnBookingId ?? '') === String(booking?.bookingId ?? '');
}

const _saved = (cached: UserRecommendation, type: string): ResolvedRecProducts =>
  ({ productIds: cached.productIds, recommendationType: type, source: cached.source || 'cached' });

async function _build(unifiedId: string | number, recommendationType: string, why: string): Promise<ResolvedRecProducts | null> {
  const built = await computeForUser({ unifiedId, recommendationType, topN: TOP_N });
  console.log(`[RecResolver] uid=${unifiedId} built ${recommendationType} now (${why}) → ${built?.productIds?.length || 0} products, source=${built?.source}, city=${built?.destinationCity}`);
  return built?.productIds?.length ? { productIds: built.productIds, recommendationType, source: `built_now:${built.source}` } : null;
}

/**
 * Try one type for a user who HAS a booking of that type: the saved row if it was
 * built for that booking, else build it now. No booking of this type → null
 * (generic picks are only the last step, so a real trip of the other type wins).
 */
async function _forType(unifiedId: string | number, type: TripType): Promise<ResolvedRecProducts | null> {
  const booking = await findFor(unifiedId, type);
  if (!booking) return null;
  const cached = await getForUser({ unifiedId, recommendationType: type });
  if (_fresh(cached, booking)) return _saved(cached, type);
  return _build(unifiedId, type, cached ? 'saved picks are for another booking' : 'no saved picks');
}

export async function resolveRecProductsForUser({ unifiedId, recommendationType }: { unifiedId: string | number; recommendationType: string }): Promise<ResolvedRecProducts> {
  if (!unifiedId || !isTripType(recommendationType)) {
    // past_trip / unknown types keep their saved row as-is.
    const cached = unifiedId ? await getForUser({ unifiedId, recommendationType }) : null;
    return { productIds: cached?.productIds || [], recommendationType, source: cached?.source || 'no_cached_row' };
  }
  const steps: (() => Promise<ResolvedRecProducts | null>)[] = [
    () => _forType(unifiedId, recommendationType),
    () => _forType(unifiedId, OTHER_TYPE[recommendationType]),
    async () => {
      // No booking of either type: reuse the generic picks if they're saved, else build them.
      const cached = await getForUser({ unifiedId, recommendationType });
      if (_fresh(cached, null)) return _saved(cached, recommendationType);
      return _build(unifiedId, recommendationType, 'no current booking — Dubai picks');
    },
  ];
  for (const step of steps) {
    try {
      const r = await step();
      if (r && r.productIds.length >= MIN_USABLE) return r;
    } catch (err) {
      console.warn(`[RecResolver] uid=${unifiedId} step failed: ${(err as Error).message}`);
    }
  }
  return { productIds: [], recommendationType, source: 'none' };
}

export default { resolveRecProductsForUser };
