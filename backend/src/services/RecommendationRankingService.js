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

// Bounded-concurrency Claude gate. Max N in-flight calls at once. Prevents
// burst rate-limit hits during large recomputes while giving ~3x throughput
// vs strict serialization. Anthropic's tier handles well over this concurrency.
const CLAUDE_MAX_CONCURRENT = 3;
let _claudeInFlight = 0;
const _claudeWaiters = [];
function _acquireClaudeSlot() {
  if (_claudeInFlight < CLAUDE_MAX_CONCURRENT) {
    _claudeInFlight++;
    return Promise.resolve();
  }
  return new Promise(res => _claudeWaiters.push(res));
}
function _releaseClaudeSlot() {
  if (_claudeWaiters.length > 0) {
    // Hand the slot directly to the next waiter — counter stays balanced.
    const next = _claudeWaiters.shift();
    next();
  } else {
    _claudeInFlight--;
  }
}
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
  // Fetch experience products (activities/tours/attractions/cruises/safari/
  // theme parks/tickets/etc.). Excludes:
  //   - the product they already booked
  //   - utility categories that aren't "things to do"
  //   - products without a working URL or image (broken cards)
  //   - products explicitly marked available=false in the enriched sync
  //     (NULL treated as available for pre-sync rows)
  //
  // Two-stage lookup — if the city has too few candidates, fall back to the
  // same country. Guarantees we can always feed Claude enough products.
  const excluded = Array.from(NON_EXPERIENCE_CATEGORIES);
  const MIN_CANDIDATES = 10;
  const params = [city, excludeProductId ? String(excludeProductId) : null, excluded, limit];

  // Stage 1: same city
  const cityQ = `
    SELECT product_id, name, category, city, country,
           image_url, url, sale_price, normal_price, page_description
    FROM products
    WHERE LOWER(TRIM(city)) = LOWER(TRIM($1))
      AND ($2::text IS NULL OR product_id::text <> $2::text)
      AND (category IS NULL OR NOT (LOWER(category) = ANY($3::text[])))
      AND name IS NOT NULL
      AND image_url IS NOT NULL AND image_url <> ''
      AND url IS NOT NULL AND url <> ''
      AND (available IS NULL OR available = true)
    ORDER BY COALESCE(sale_price, normal_price) DESC NULLS LAST
    LIMIT $4`;
  const { rows: cityRows } = await db.query(cityQ, params);
  if (cityRows.length >= MIN_CANDIDATES) return cityRows;

  // Stage 2: same country. Look up the country for the given city (from any
  // product in that city). If the city has 0 products, use a hardcoded UAE
  // Emirates map for known cases (Sharjah/Ajman/RAK/Fujairah/UAQ) since Rayna
  // is UAE-focused. Otherwise fall through to Stage 3.
  const UAE_EMIRATES = new Set(['sharjah','ajman','ras al khaimah','fujairah','umm al quwain','dubai','abu dhabi']);
  let country = null;
  const { rows: [countryRow] } = await db.query(
    `SELECT country FROM products WHERE LOWER(TRIM(city)) = LOWER(TRIM($1)) AND country IS NOT NULL LIMIT 1`,
    [city]
  );
  if (countryRow?.country) country = countryRow.country;
  else if (UAE_EMIRATES.has(String(city).toLowerCase().trim())) country = 'United Arab Emirates';

  if (country) {
    const { rows: countryRows } = await db.query(`
      SELECT product_id, name, category, city, country,
             image_url, url, sale_price, normal_price, page_description
      FROM products
      WHERE LOWER(TRIM(country)) = LOWER(TRIM($1))
        AND ($2::text IS NULL OR product_id::text <> $2::text)
        AND (category IS NULL OR NOT (LOWER(category) = ANY($3::text[])))
        AND name IS NOT NULL
        AND image_url IS NOT NULL AND image_url <> ''
        AND url IS NOT NULL AND url <> ''
        AND (available IS NULL OR available = true)
      ORDER BY COALESCE(sale_price, normal_price) DESC NULLS LAST
      LIMIT $4
    `, [country, excludeProductId ? String(excludeProductId) : null, excluded, limit]);
    if (countryRows.length >= MIN_CANDIDATES) return countryRows;
  }

  // Stage 3: absolute fallback — Dubai. Rayna's densest catalog is Dubai;
  // recommending Dubai activities to any user beats returning empty picks.
  const { rows: dubaiRows } = await db.query(`
    SELECT product_id, name, category, city, country,
           image_url, url, sale_price, normal_price, page_description
    FROM products
    WHERE LOWER(TRIM(city)) = 'dubai'
      AND ($1::text IS NULL OR product_id::text <> $1::text)
      AND (category IS NULL OR NOT (LOWER(category) = ANY($2::text[])))
      AND name IS NOT NULL
      AND image_url IS NOT NULL AND image_url <> ''
      AND url IS NOT NULL AND url <> ''
      AND (available IS NULL OR available = true)
    ORDER BY COALESCE(sale_price, normal_price) DESC NULLS LAST
    LIMIT $3
  `, [excludeProductId ? String(excludeProductId) : null, excluded, limit]);
  return dubaiRows;
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

/**
 * Extract a balanced JSON object from a text blob. Handles:
 *   - Markdown fences: ```json {...} ```
 *   - Prose before/after the JSON (finds the FIRST balanced {...} block)
 * Returns the parsed object, or throws with a specific message.
 */
function _extractJson(text) {
  if (!text) throw new Error('Empty Claude response');
  // Strip markdown fences if present
  let s = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  // Find the first balanced {...} substring by walking braces
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No opening brace in Claude response');
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Unbalanced JSON in Claude response (possibly truncated)');
  return JSON.parse(s.slice(start, end + 1));
}

/**
 * Fetch with a fresh connection (no keep-alive reuse) + timeout + retries with
 * exponential backoff. `undici` keep-alive reuse of closed sockets is the root
 * cause of the intermittent "fetch failed" errors under sustained load.
 */
async function _fetchWithRetry(url, options, { timeoutMs = 45000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
      try {
        return await fetch(url, {
          ...options,
          signal: ac.signal,
          // undici extension — force a fresh connection instead of reusing a stale keep-alive socket
          keepalive: false,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      // Give up on obvious non-retryable errors
      if (err?.name === 'AbortError' && err.message !== 'timeout') throw err;
      if (attempt < retries) {
        // 1s, 2s, 4s backoff
        const wait = Math.min(4000, 1000 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function _callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const body = {
    model: DEFAULT_MODEL,
    max_tokens: 1024,   // headroom so JSON doesn't get truncated
    messages: [{ role: 'user', content: prompt }],
  };

  const res = await _fetchWithRetry(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Retry once on 429 / 5xx after a short pause
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 3000));
      const res2 = await _fetchWithRetry(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res2.ok) throw new Error(`Anthropic ${res2.status} (retry): ${await res2.text()}`);
      const json2 = await res2.json();
      const text2 = json2?.content?.[0]?.text || '';
      const parsed2 = _extractJson(text2);
      if (!Array.isArray(parsed2.product_ids)) throw new Error('Claude returned no product_ids');
      return { source: 'claude', ...parsed2 };
    }
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const text = json?.content?.[0]?.text || '';
  const parsed = _extractJson(text);
  if (!Array.isArray(parsed.product_ids)) throw new Error('Claude returned no product_ids');
  return { source: 'claude', ...parsed };
}

// Renamed from _serialized — now uses the CLAUDE_MAX_CONCURRENT gate above,
// allowing up to N calls in flight at once. Callsites stay the same.
async function _serialized(fn) {
  await _acquireClaudeSlot();
  try { return await fn(); } finally { _releaseClaudeSlot(); }
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

  // past_trip logic: NO Claude call per user. Instead:
  //   1. Aggregate user's past bookings by products.category
  //   2. Map max-booked category → journey-level category (activities|holidays|cruises)
  //      via CategoryPicksService.journeyCategoryFor(). Default 'activities' if no data.
  //   3. Look up daily_category_picks for that category's top-5 (global, refreshed daily)
  //   4. Store in user_product_recommendations
  //
  // The 3 Claude calls per day live in CategoryPicksService (one per category);
  // this per-user compute is pure SQL and runs on ~626k users in ~15 min.
  if (recommendationType === 'past_trip') {
    const { journeyCategoryFor, getPicksForCategory } = await import('./CategoryPicksService.js');

    // Group user's past bookings by products.category, pick max
    const RAYNA_TABLES = ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_others'];
    const bookingsUnion = RAYNA_TABLES.map(t => `
      SELECT service_id FROM ${t}
      WHERE unified_id = $1 AND COALESCE(is_cancel, '0') <> '1' AND service_id IS NOT NULL
    `).join(' UNION ALL ');
    const { rows: catRows } = await db.query(`
      SELECT p.category, COUNT(*) AS n
      FROM (${bookingsUnion}) b
      JOIN products p ON p.product_id::text = b.service_id
      WHERE p.category IS NOT NULL
      GROUP BY p.category ORDER BY n DESC LIMIT 5
    `, [unifiedId]);

    // Determine journey-level category. First match wins (rows already ORDER BY n DESC).
    let journeyCat = 'activities';   // default when no signal
    let sourceCat = null;
    for (const r of catRows) {
      const jc = journeyCategoryFor(r.category);
      if (jc) { journeyCat = jc; sourceCat = r.category; break; }
    }

    // Read today's picks for that journey category
    const picks = await getPicksForCategory(journeyCat);
    if (!picks || !Array.isArray(picks.productIds) || picks.productIds.length === 0) {
      console.warn(`[past_trip] No daily_category_picks for ${journeyCat} — user ${unifiedId} skipped`);
      return null;
    }

    // Upsert the user's past_trip row. destination_city='multi-city' (global);
    // based_on_product_id encodes the raw category we detected (audit trail).
    await db.query(`
      INSERT INTO user_product_recommendations
        (unified_id, recommendation_type, based_on_booking_id, based_on_product_id,
         destination_city, product_ids, source, rationale, computed_at, expires_at)
      VALUES ($1, 'past_trip', NULL, $2, 'multi-city', $3::jsonb, $4, $5, NOW(), $6)
      ON CONFLICT (unified_id, recommendation_type) DO UPDATE SET
        based_on_product_id = EXCLUDED.based_on_product_id,
        destination_city    = EXCLUDED.destination_city,
        product_ids         = EXCLUDED.product_ids,
        source              = EXCLUDED.source,
        rationale           = EXCLUDED.rationale,
        computed_at         = NOW(),
        expires_at          = EXCLUDED.expires_at
    `, [
      unifiedId,
      sourceCat,   // e.g., 'water-activities' — for audit
      JSON.stringify(picks.productIds),
      picks.source || 'claude',
      `Top 5 ${journeyCat} · max-booked=${sourceCat || 'default'} · ${picks.rationale || ''}`,
      new Date(Date.now() + cacheDays * 24 * 60 * 60 * 1000).toISOString(),
    ]);

    return {
      unifiedId,
      recommendationType: 'past_trip',
      destinationCity: 'multi-city',
      productIds: picks.productIds,
      source: picks.source,
      journeyCategory: journeyCat,
    };
  }

  const { findFor } = await import('./BookingLookupService.js');
  const booking = await findFor(unifiedId, recommendationType);

  // If we can't find a matching booking (boundary drift, all-cancelled rows,
  // etc.), fall back to generic Dubai recommendations. This guarantees every
  // user in the segment gets a rec — no more skips. based_on_booking_id +
  // based_on_product_id remain null so we know it's a generic pick.
  const destinationCity = booking?.destinationCity || 'Dubai';
  const excludeProductId = booking?.productId || null;

  const ranking = await _rankOnce({
    destinationCity,
    excludeProductId,
    topN,
  });

  const row = {
    unified_id:          unifiedId,
    recommendation_type: recommendationType,
    based_on_booking_id: booking?.bookingId || null,
    based_on_product_id: excludeProductId,
    destination_city:    destinationCity,
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
