/**
 * dailyRecommendationCompute
 *
 * Nightly batch that precomputes AI-recommended products for every eligible user
 * across the 3 rec contexts (on_trip, future_trip, past_trip). Runs at
 * 3:30 AM Dubai (registered in server.js, timezone: 'Asia/Dubai').
 *
 * Strategy:
 *   For each recommendation_type:
 *     1. Find users in the matching segment (booking_status) whose row is
 *        missing OR expired in user_product_recommendations
 *     2. computeForUser() → 1 Claude call each, INSERT (or UPDATE via UPSERT)
 *     3. Serialized via the existing _claudeLock in RankingService
 *
 * Safety:
 *   - Read-only against existing tables (unified_contacts, rayna_tours, products).
 *     Only writes to user_product_recommendations.
 *   - `past_trip` compute returns null (stubbed) — logged and skipped.
 *   - Bounded budget: `MAX_PER_TYPE_PER_RUN` caps how many users we touch per
 *     run so a bad rollout can't blast 1M Claude calls in one night.
 *   - Fail-safe: per-user errors are caught + logged; one bad user doesn't
 *     stop the batch.
 */

import db from '../config/database.js';
import { computeForUser } from '../services/RecommendationRankingService.js';

const MAX_PER_TYPE_PER_RUN = parseInt(process.env.REC_CRON_MAX_PER_TYPE || '2000', 10);

// booking_status values that make a user eligible for each rec type.
// (booking_status is computed by UnifiedContactBuilder.computeSegmentation.)
const STATUS_FOR_TYPE = {
  on_trip:     'ON_TRIP',
  future_trip: 'FUTURE_TRAVEL',
  past_trip:   'PAST_BOOKING',
};

async function _eligibleUsers(recommendationType, limit) {
  const status = STATUS_FOR_TYPE[recommendationType];
  if (!status) return [];

  // Users in the right status, either with no cached row for this type OR
  // whose cached row has expired. LEFT JOIN + IS NULL / expires < NOW() covers
  // both cases in one query.
  const { rows } = await db.query(`
    SELECT uc.id AS unified_id
    FROM unified_contacts uc
    LEFT JOIN user_product_recommendations upr
      ON upr.unified_id = uc.id
     AND upr.recommendation_type = $1
    WHERE uc.booking_status = $2
      AND uc.email IS NOT NULL
      AND (upr.id IS NULL OR upr.expires_at <= NOW())
    ORDER BY uc.id
    LIMIT $3
  `, [recommendationType, status, limit]);
  return rows.map(r => r.unified_id);
}

async function _runOneType(recommendationType) {
  const startedAt = Date.now();
  const users = await _eligibleUsers(recommendationType, MAX_PER_TYPE_PER_RUN);
  console.log(`[RecCron] ${recommendationType}: ${users.length} eligible users to compute`);

  let computed = 0, skipped = 0, failed = 0;
  for (const unifiedId of users) {
    try {
      const result = await computeForUser({ unifiedId, recommendationType });
      if (result === null) {
        skipped++; // No relevant booking OR past_trip stub
      } else {
        computed++;
      }
    } catch (err) {
      failed++;
      console.warn(`[RecCron] ${recommendationType} unified_id=${unifiedId} failed: ${err.message}`);
    }
  }

  const durMs = Date.now() - startedAt;
  console.log(`[RecCron] ${recommendationType}: done — computed=${computed} skipped=${skipped} failed=${failed} in ${(durMs / 1000).toFixed(1)}s`);
  return { recommendationType, computed, skipped, failed, durMs };
}

/**
 * Entry point — called by node-cron each night.
 * Exported so it can also be triggered manually (POST endpoint if needed later).
 */
export async function runDailyRecommendationCompute() {
  console.log(`[RecCron] === Starting daily recommendation compute at ${new Date().toISOString()} ===`);
  const results = [];
  for (const type of ['on_trip', 'future_trip', 'past_trip']) {
    try {
      results.push(await _runOneType(type));
    } catch (err) {
      console.error(`[RecCron] type=${type} batch aborted: ${err.stack || err.message}`);
      results.push({ recommendationType: type, error: err.message });
    }
  }
  console.log(`[RecCron] === Daily compute finished ===`, JSON.stringify(results));
  return results;
}

export default runDailyRecommendationCompute;
