/**
 * dailyCategoryPicksCompute
 *
 * Nightly (3:45 AM Dubai) computes the top-5 products per journey-level
 * category (activities / holidays / cruises) via Claude. Writes to
 * daily_category_picks. Consumed by past-trip user compute (see
 * dailyPastTripCompute cron) which serves the same 5 to all users in that
 * category on the same day.
 *
 * Runs AFTER:
 *   2:00 AM — segmentation refresh (unified_contacts.booking_status)
 *   3:35 AM — dailyRecommendationCompute (on_trip / future_trip)
 *
 * 3 Claude calls per run. ~$0.03/day.
 */

import { computeCategoryPicks } from '../services/CategoryPicksService.js';

export async function runDailyCategoryPicksCompute() {
  const started = Date.now();
  console.log(`[CategoryPicksCron] Starting at ${new Date().toISOString()}`);
  const results = [];
  for (const cat of ['activities', 'holidays', 'cruises']) {
    try {
      const r = await computeCategoryPicks(cat);
      console.log(`[CategoryPicksCron] ${cat}: source=${r.source} picks=[${r.productIds.join(',')}] candidates=${r.candidates}`);
      results.push({ category: cat, ok: true, source: r.source });
    } catch (err) {
      console.error(`[CategoryPicksCron] ${cat} FAILED:`, err.message);
      results.push({ category: cat, ok: false, error: err.message });
    }
  }
  console.log(`[CategoryPicksCron] Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${JSON.stringify(results)}`);
  return results;
}

export default runDailyCategoryPicksCompute;
