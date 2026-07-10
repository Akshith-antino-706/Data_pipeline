/**
 * RecommendationRankingService
 *
 * Picks N activity products to recommend to an on-trip / future-travel user.
 * Same-city, excluding a specific product_id (whatever they already booked).
 *
 * Design goals:
 *   - ADDITIVE — no touch to existing Day{N}RankingService files or the
 *     renderDayHtml pipeline. This service is called only by the new
 *     /api/v2/recommendations/* routes.
 *   - Serialized Claude calls + retry-once + fallback pattern, matching
 *     Day5ActivitiesRankingService.
 *   - Frozen rankings supported via journey_node_rankings when
 *     journeyId + nodeId are supplied (real sends). Preview calls without
 *     journeyId skip the freeze and use an in-memory cache instead.
 *
 * Contract:
 *   rankRecommendations({ destinationCity, excludeProductId, topN = 5,
 *                          journeyId, nodeId }) → {
 *     productIds:  [123, 456, ...],   // ordered picks
 *     source:      'claude' | 'fallback' | 'fallback_no_api_key',
 *     candidates:  <int>,              // count from products table
 *     rationale:   '...'               // Claude's short explanation
 *   }
 */

import db from '../config/database.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const RANKING_TYPE  = 'recommendation';

// Serialize Claude calls at module scope. Prevents burst rate-limit hits when
// multiple workers ask for a ranking at the same moment.
let _claudeLock = Promise.resolve();
const _memoryCache = new Map(); // key = `${city}::${excludeId}::${topN}` → { data, ts }
const MEMORY_TTL_MS = 10 * 60 * 1000; // 10 min

function _cacheKey(city, excludeId, topN) {
  return `${(city || '').toLowerCase()}::${excludeId || ''}::${topN}`;
}

// Categories that are NOT things-to-do-on-a-trip. Excluded from candidate pool.
// Kept as a small block-list so new activity categories auto-include.
const NON_EXPERIENCE_CATEGORIES = new Set([
  'transfers', 'airport-transfers', 'visa', 'visas',
  'hotels', 'hotel', 'flights', 'flight',
]);

async function _fetchCandidates(city, excludeProductId, limit = 100) {
  // Same-city experiences (activities, tours, attractions, cruises, safaris,
  // theme parks, tickets, hot-air balloons, water parks, …), excluding the
  // product they already booked and utility categories that aren't "things
  // to do" (transfers, visas, hotels, flights).
  const excluded = Array.from(NON_EXPERIENCE_CATEGORIES);
  const { rows } = await db.query(`
    SELECT product_id, name, category, city, country,
           image_url, url, sale_price, normal_price, page_description
    FROM products
    WHERE LOWER(TRIM(city)) = LOWER(TRIM($1))
      AND ($2::text IS NULL OR product_id::text <> $2::text)
      AND (category IS NULL OR NOT (LOWER(category) = ANY($3::text[])))
      AND name IS NOT NULL
      AND image_url IS NOT NULL
    ORDER BY COALESCE(sale_price, normal_price) DESC NULLS LAST
    LIMIT $4
  `, [city, excludeProductId ? String(excludeProductId) : null, excluded, limit]);
  return rows;
}

function _buildPrompt(city, excludeProductId, candidates, topN) {
  const lines = candidates.map((c, i) =>
    `  ${String(i + 1).padStart(2, ' ')}. id=${c.product_id.toString().padEnd(6)} | ${c.name.slice(0, 60).padEnd(60)} | AED ${c.sale_price || c.normal_price || '?'}`
  ).join('\n');

  return `You are a travel expert curating activity recommendations for a Rayna Tours customer currently visiting ${city}.

They already booked product_id=${excludeProductId || 'unknown'} — do NOT recommend that one; only pick from the candidates below.

CANDIDATES (all activities available in ${city}):
${lines}

Pick the TOP ${topN} you would recommend to a first-time visitor to ${city}, ranked best-first.

RULES:
- ONLY use product_id values from the list above. Do not invent ids.
- Prefer variety across activity types (adventure, culture, family, food, water) over 5 similar products.
- Prefer well-known landmarks and highly-rated experiences.
- Return strict JSON only, no prose outside the JSON.

OUTPUT SHAPE (JSON):
{
  "product_ids": [<int>, <int>, <int>, <int>, <int>],
  "rationale": "<one sentence, ≤ 20 words, why this set>"
}`;
}

async function _callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { source: 'fallback_no_api_key' };

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  // Extract the first {...} block — models occasionally add a stray sentence.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON block');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.product_ids)) throw new Error('Claude returned no product_ids');
  return { source: 'claude', ...parsed };
}

async function _serialized(fn) {
  const prior = _claudeLock;
  let release;
  _claudeLock = new Promise(res => { release = res; });
  try { await prior; } catch { /* ignore prior failures */ }
  try { return await fn(); } finally { release(); }
}

async function _rankOnce({ destinationCity, excludeProductId, topN }) {
  const candidates = await _fetchCandidates(destinationCity, excludeProductId);
  if (candidates.length === 0) {
    return { productIds: [], source: 'fallback', candidates: 0, rationale: `No activity candidates found in ${destinationCity}` };
  }

  // Fallback pick — used when Claude fails or no API key. Just the top-N
  // candidates by sale_price (already ordered by _fetchCandidates).
  const fallbackIds = candidates.slice(0, topN).map(c => c.product_id);

  const prompt = _buildPrompt(destinationCity, excludeProductId, candidates, topN);

  try {
    const claude = await _serialized(() => _callClaude(prompt));
    if (claude.source === 'fallback_no_api_key') {
      return { productIds: fallbackIds, source: 'fallback_no_api_key', candidates: candidates.length, rationale: `Fallback: top ${topN} by price (no API key)` };
    }
    // Sanity-check the ids Claude returned are actually in the candidate set.
    const validIds = new Set(candidates.map(c => c.product_id));
    const claudePicked = claude.product_ids
      .filter(id => validIds.has(Number(id)))
      .slice(0, topN)
      .map(Number);
    if (claudePicked.length === 0) {
      return { productIds: fallbackIds, source: 'fallback', candidates: candidates.length, rationale: 'Claude returned no valid ids — used fallback' };
    }
    // If Claude returned fewer than topN valid ids (some were hallucinated / not in
    // the pool), top up from the fallback list so we always render `topN` cards.
    // Skip any id already in claudePicked to avoid duplicates.
    if (claudePicked.length < topN) {
      const already = new Set(claudePicked);
      for (const id of fallbackIds) {
        if (claudePicked.length >= topN) break;
        if (!already.has(id)) { claudePicked.push(id); already.add(id); }
      }
      return { productIds: claudePicked, source: 'claude', candidates: candidates.length, rationale: (claude.rationale || '') + ` (topped up with ${topN - claude.product_ids.filter(id => validIds.has(Number(id))).length} fallback)` };
    }
    return { productIds: claudePicked, source: 'claude', candidates: candidates.length, rationale: claude.rationale || '' };
  } catch (err) {
    console.warn('[RecommendationRankingService] Claude call failed:', err.message);
    return { productIds: fallbackIds, source: 'fallback', candidates: candidates.length, rationale: `Fallback after Claude error: ${err.message}` };
  }
}

/**
 * Public entry point. Rank recommendations for a user in a specific city,
 * excluding whatever they already booked.
 *
 * Freezes per (journeyId, nodeId) when both are supplied — same pattern as
 * Day1-7 rankings. This guarantees preview == sent email once frozen.
 */
// ═══════════════════════════════════════════════════════════════════════════
// Per-user precompute API (used by dailyRecommendationCompute cron + send path)
// ═══════════════════════════════════════════════════════════════════════════
//
// The daily cron calls computeForUser() for every eligible user. At send time,
// getForUser() reads back the cached row. Neither call touches the
// journey_node_rankings table used by Day 1-7 emails, so those pipelines are
// completely independent.

/**
 * Compute + persist recommendations for a single user + context.
 * Idempotent: safe to call repeatedly (UPSERT semantics).
 *
 *   context: 'on_trip' | 'future_trip' | 'past_trip'
 *
 * Returns the persisted row shape, or null if no relevant booking exists
 * (e.g. past_trip while its logic is TBD).
 */
export async function computeForUser({ unifiedId, recommendationType, topN = 5, cacheDays = 30 } = {}) {
  if (!unifiedId) throw new Error('unifiedId is required');
  if (!['on_trip','future_trip','past_trip'].includes(recommendationType)) {
    throw new Error(`Unknown recommendationType: ${recommendationType}`);
  }

  // past_trip logic is intentionally stubbed — user will supply the "based on
  // what?" rule later. For now, skip the compute so we don't waste Claude calls
  // on incomplete logic.
  if (recommendationType === 'past_trip') {
    return null;
  }

  const { findFor } = await import('./BookingLookupService.js');
  const booking = await findFor(unifiedId, recommendationType);
  if (!booking || !booking.destinationCity) {
    // Nothing to base recs on — cron will retry next day.
    return null;
  }

  const ranking = await _rankOnce({
    destinationCity: booking.destinationCity,
    excludeProductId: booking.productId,
    topN,
  });

  const row = {
    unified_id:          unifiedId,
    recommendation_type: recommendationType,
    based_on_booking_id: booking.bookingId,
    based_on_product_id: booking.productId,
    destination_city:    booking.destinationCity,
    product_ids:         JSON.stringify(ranking.productIds || []),
    source:              ranking.source || 'fallback',
    rationale:           ranking.rationale || null,
    expires_at:          new Date(Date.now() + cacheDays * 24 * 60 * 60 * 1000).toISOString(),
  };

  await db.query(`
    INSERT INTO user_product_recommendations
      (unified_id, recommendation_type, based_on_booking_id, based_on_product_id,
       destination_city, product_ids, source, rationale, computed_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), $9)
    ON CONFLICT (unified_id, recommendation_type)
    DO UPDATE SET
      based_on_booking_id = EXCLUDED.based_on_booking_id,
      based_on_product_id = EXCLUDED.based_on_product_id,
      destination_city    = EXCLUDED.destination_city,
      product_ids         = EXCLUDED.product_ids,
      source              = EXCLUDED.source,
      rationale           = EXCLUDED.rationale,
      computed_at         = NOW(),
      expires_at          = EXCLUDED.expires_at
  `, [
    row.unified_id, row.recommendation_type, row.based_on_booking_id, row.based_on_product_id,
    row.destination_city, row.product_ids, row.source, row.rationale, row.expires_at,
  ]);

  return {
    unifiedId,
    recommendationType,
    destinationCity: booking.destinationCity,
    productIds:      ranking.productIds || [],
    source:          ranking.source,
    rationale:       ranking.rationale,
  };
}

/**
 * Read the cached recommendation row for (user, type).
 * Returns null if no row OR the row has expired. Send path uses this.
 */
export async function getForUser({ unifiedId, recommendationType } = {}) {
  if (!unifiedId || !recommendationType) return null;
  const { rows } = await db.query(`
    SELECT unified_id, recommendation_type, based_on_booking_id, based_on_product_id,
           destination_city, product_ids, source, rationale, computed_at, expires_at
    FROM user_product_recommendations
    WHERE unified_id = $1 AND recommendation_type = $2 AND expires_at > NOW()
    LIMIT 1
  `, [unifiedId, recommendationType]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    unifiedId:          r.unified_id,
    recommendationType: r.recommendation_type,
    basedOnBookingId:   r.based_on_booking_id,
    basedOnProductId:   r.based_on_product_id,
    destinationCity:    r.destination_city,
    productIds:         Array.isArray(r.product_ids) ? r.product_ids : (r.product_ids || []),
    source:             r.source,
    rationale:          r.rationale,
    computedAt:         r.computed_at,
    expiresAt:          r.expires_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

export async function rankRecommendations({ destinationCity, excludeProductId, topN = 5, journeyId, nodeId } = {}) {
  if (!destinationCity) throw new Error('destinationCity is required');

  // Freeze path — real journey sends
  if (journeyId && nodeId) {
    const { rows: [existing] } = await db.query(
      'SELECT ranking FROM journey_node_rankings WHERE journey_id = $1 AND node_id = $2 AND ranking_type = $3',
      [journeyId, nodeId, RANKING_TYPE]
    );
    if (existing?.ranking) return existing.ranking;

    const result = await _rankOnce({ destinationCity, excludeProductId, topN });
    await db.query(
      `INSERT INTO journey_node_rankings (journey_id, node_id, ranking_type, ranking, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (journey_id, node_id, ranking_type) DO NOTHING`,
      [journeyId, nodeId, RANKING_TYPE, JSON.stringify(result), result.source]
    );
    // Re-read so all workers converge on the same frozen result.
    const { rows: [frozen] } = await db.query(
      'SELECT ranking FROM journey_node_rankings WHERE journey_id = $1 AND node_id = $2 AND ranking_type = $3',
      [journeyId, nodeId, RANKING_TYPE]
    );
    return frozen?.ranking || result;
  }

  // Preview / one-off path — memory cache
  const key = _cacheKey(destinationCity, excludeProductId, topN);
  const hit = _memoryCache.get(key);
  if (hit && (Date.now() - hit.ts) < MEMORY_TTL_MS) return hit.data;

  const result = await _rankOnce({ destinationCity, excludeProductId, topN });
  _memoryCache.set(key, { data: result, ts: Date.now() });
  return result;
}

export default rankRecommendations;
