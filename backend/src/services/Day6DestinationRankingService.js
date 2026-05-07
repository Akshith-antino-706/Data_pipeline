/**
 * Day6DestinationRankingService
 *
 * Single Anthropic call (web_search-enabled) that picks product IDs to feature
 * in the destination-spotlight email for ONE destination at a time
 * (e.g. Singapore). Claude searches the web for what's trending RIGHT NOW for
 * that specific destination, then maps onto the actual products we sell for
 * that city in our DB.
 *
 * Universal picks — same picks for every recipient.
 */

import { query } from '../config/database.js';
import { _internals as dataInternals } from './Day6DestinationDataService.js';
import { isKeyBlocked } from '../config/blockedDestinations.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SLOT_COUNT = 4;

// ── candidate fetch ───────────────────────────────────────────────────────

function asCityList(productCity) {
  return Array.isArray(productCity) ? productCity : [productCity];
}

async function fetchHolidayCandidates(productCity) {
  const { rows } = await query(
    `SELECT product_id, name, category
       FROM products
      WHERE type = 'holiday'
        AND image_url IS NOT NULL
        AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
        AND LOWER(city) = ANY($1::text[])
      ORDER BY product_id DESC
      LIMIT 30`,
    [asCityList(productCity)]
  );
  return rows;
}

async function fetchActivityCandidates(productCity) {
  const { rows } = await query(
    `SELECT product_id, name, category
       FROM products
      WHERE type = 'activities'
        AND image_url IS NOT NULL
        AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
        AND LOWER(city) = ANY($1::text[])
      ORDER BY product_id DESC
      LIMIT 30`,
    [asCityList(productCity)]
  );
  return rows;
}

async function fetchCruiseCandidates(category) {
  if (!category) return [];
  const { rows } = await query(
    `SELECT product_id, name, category
       FROM products
      WHERE type = 'cruise'
        AND image_url IS NOT NULL
        AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
        AND category = $1
      ORDER BY product_id DESC
      LIMIT 30`,
    [category]
  );
  return rows;
}

// ── prompt construction ───────────────────────────────────────────────────

function listProducts(rows) {
  if (!rows || rows.length === 0) return '  (none available)';
  return rows
    .map(p => `  - product_id=${String(p.product_id).padEnd(6)} | ${String(p.category || '').padEnd(28)} | ${p.name}`)
    .join('\n');
}

function buildPrompt({ dest, holidayCandidates, activityCandidates, cruiseCandidates }) {
  const holidayList  = listProducts(holidayCandidates);
  const activityList = listProducts(activityCandidates);
  const cruiseList   = listProducts(cruiseCandidates);

  const taglineOptions = dest.taglines
    .map((t, i) => `  ${i}: "${t}"`)
    .join('\n');

  const cruiseHint = cruiseCandidates.length === 0
    ? `  (no cruises available — return empty cruise_ids array)`
    : `  Pick up to ${SLOT_COUNT} unique product_ids from the CRUISE list.`;

  const rules = `
DESTINATION: ${dest.name}, ${dest.country}

SAFETY PRE-SCREEN — DO THIS FIRST, BEFORE ANY OTHER SEARCH:
  Use web_search to check news in the LAST 30 DAYS for ${dest.name}, ${dest.country}.
  Look for: active armed conflict / war / military strikes, government travel
  advisories at "do not travel" level, civil unrest, terror events, airport /
  airspace closures, natural disasters disrupting tourism.
  If ${dest.name} has active issues, set "safe_to_promote": false and explain
  in safety_notes. Otherwise set true.

  Add a "safety_notes" array — each entry ≤15 words, plain English. Empty if
  nothing concerning.

YOUR JOB:
  Pick the BEST products from our catalog (below) to feature in this email.
  The email is a destination spotlight — one full email about ${dest.name}.
  Picks should reflect what travellers are searching, talking about, and
  booking RIGHT NOW for ${dest.name}.

HOW TO PICK:
  1. Use web_search 3-4 times to find what's trending for ${dest.name} in 2026.
     Useful queries:
       "trending ${dest.name} attractions 2026"
       "must-do ${dest.name} experiences"
       "best ${dest.name} tour packages 2026"
       "top things to do ${dest.name}"
  2. From the candidate lists below, pick:
       holiday_ids   → 4 product_ids from HOLIDAYS list (multi-day packages)
       activity_ids  → 4 product_ids from ACTIVITIES list (things to do)
       cruise_ids    → up to 4 product_ids from CRUISES list (may be empty)
     ONLY use product_ids that appear in the lists below.
  3. tagline_index — pick the index of the tagline that best matches your trending findings.
  4. hero_bg_image_override — leave null unless you specifically want to swap in
     one of the candidate product images. Almost always leave null.
  5. Universal picks. No per-user personalisation.

HOLIDAY PACKAGES (pick 4 product_ids):
${holidayList}

ACTIVITIES / THINGS TO DO (pick 4 product_ids):
${activityList}

CRUISES:
${cruiseList}
${cruiseHint}

TAGLINE OPTIONS (pick the index that fits the email's vibe best):
${taglineOptions}

OUTPUT CONSTRAINTS:
  - holiday_ids   : exactly ${SLOT_COUNT} unique product_ids from HOLIDAYS list, OR fewer if pool has fewer.
  - activity_ids  : exactly ${SLOT_COUNT} unique product_ids from ACTIVITIES list, OR fewer if pool has fewer.
  - cruise_ids    : 0 to ${SLOT_COUNT} unique product_ids from CRUISES list.
  - tagline_index : integer in range [0, ${dest.taglines.length - 1}].
  - hero_bg_image_override: null (default) or a URL string.
  - trending_themes : 3-5 short tags summarising what's trending for ${dest.name}.
  - rationale     : ≤40 words plain English on why these picks.

Return ONLY the JSON below. No prose, no markdown fences.

JSON SCHEMA:
{
  "safe_to_promote":   true,
  "safety_notes":      ["<short reason>", ...],
  "trending_themes":   ["<tag>", ...],
  "rationale":         "<≤40 words>",
  "holiday_ids":       [<int>, <int>, <int>, <int>],
  "activity_ids":      [<int>, <int>, <int>, <int>],
  "cruise_ids":        [<int>, ...],
  "tagline_index":     <int>,
  "hero_bg_image_override": null
}`;

  const system = `You pick products to feature in a destination-spotlight marketing email for Rayna Tours (Dubai-based travel agency). The email focuses on ONE destination: ${dest.name}, ${dest.country}. Use web_search to find what's trending for ${dest.name} right now, then map onto our actual product catalog. Universal picks (not personalised). ${rules}`;
  const user   = `Use web_search to find trending experiences in ${dest.name}, then return the JSON.`;
  return { system, user };
}

// ── validation ────────────────────────────────────────────────────────────

function validateRanking(r, { dest, holidayCandidates, activityCandidates, cruiseCandidates }) {
  if (!r || typeof r !== 'object') throw new Error('ranking is not an object');

  const holidayIds  = new Set(holidayCandidates.map(p => p.product_id));
  const activityIds = new Set(activityCandidates.map(p => p.product_id));
  const cruiseIds   = new Set(cruiseCandidates.map(p => p.product_id));

  const checkSubset = (key, arr, pool, allowEmpty = false) => {
    if (!Array.isArray(arr)) throw new Error(`${key} must be an array`);
    if (!allowEmpty && pool.size > 0 && arr.length === 0) {
      throw new Error(`${key} is empty but candidates exist`);
    }
    if (new Set(arr).size !== arr.length) throw new Error(`${key} has duplicate ids`);
    for (const id of arr) {
      if (!pool.has(Number(id))) throw new Error(`${key}: product_id ${id} not in candidates`);
    }
  };

  checkSubset('holiday_ids',  r.holiday_ids,  holidayIds);
  checkSubset('activity_ids', r.activity_ids, activityIds);
  checkSubset('cruise_ids',   r.cruise_ids,   cruiseIds, /* allowEmpty */ true);

  if (r.tagline_index != null) {
    const i = Number(r.tagline_index);
    if (!Number.isInteger(i) || i < 0 || i >= dest.taglines.length) {
      throw new Error(`tagline_index ${r.tagline_index} out of range [0, ${dest.taglines.length - 1}]`);
    }
  }
}

// ── Claude call ───────────────────────────────────────────────────────────

async function callClaude({ system, user, model = DEFAULT_MODEL, useWebSearch = true }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('NO_API_KEY');

  const body = {
    model,
    max_tokens: 4096,
    temperature: 0.3,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Claude HTTP ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  const text = textBlocks.length ? textBlocks[textBlocks.length - 1].text : '';
  if (!text) throw new Error('Claude returned no text content');

  const webSearchCalls = (data.content || []).filter(b => b.type === 'server_tool_use').length;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`No JSON object in response. Got: ${text.slice(0, 200)}`);

  let parsed;
  try { parsed = JSON.parse(m[0]); }
  catch (e) { throw new Error(`JSON parse failed: ${e.message}. Got: ${m[0].slice(0, 200)}`); }

  return { parsed, usage: data.usage, model: data.model, webSearchCalls };
}

// ── deterministic fallback ────────────────────────────────────────────────

function buildFallbackRanking({ holidayCandidates, activityCandidates, cruiseCandidates }) {
  const take = (rows, n) => rows.slice(0, n).map(p => p.product_id);
  return {
    safe_to_promote:        true,
    safety_notes:           [],
    trending_themes:        [],
    rationale:              'Default ranking (Claude unavailable). Latest products for the destination.',
    holiday_ids:            take(holidayCandidates,  SLOT_COUNT),
    activity_ids:           take(activityCandidates, SLOT_COUNT),
    cruise_ids:             take(cruiseCandidates,   SLOT_COUNT),
    tagline_index:          0,
    hero_bg_image_override: null,
  };
}

// ── public API ────────────────────────────────────────────────────────────

export async function rankDestinationSpotlight({ destinationKey, modelOverride, useWebSearch = true } = {}) {
  if (isKeyBlocked(destinationKey)) {
    throw new Error(`[Day6DestinationRankingService] destination "${destinationKey}" is blocked`);
  }
  const dest = dataInternals.DESTINATION_CATALOG[destinationKey];
  if (!dest) {
    throw new Error(`[Day6DestinationRankingService] unknown destination key: ${destinationKey}`);
  }

  const [holidayCandidates, activityCandidates, cruiseCandidates] = await Promise.all([
    fetchHolidayCandidates(dest.productCity),
    fetchActivityCandidates(dest.productCity),
    fetchCruiseCandidates(dest.cruiseCategory),
  ]);

  const fallback = buildFallbackRanking({ holidayCandidates, activityCandidates, cruiseCandidates });

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ranking:        fallback,
      source:         'fallback_no_api_key',
      rationale:      fallback.rationale,
      trendingThemes: [],
      safetyNotes:    [],
      webSearchCalls: 0,
      candidates:     { holiday: holidayCandidates.length, activity: activityCandidates.length, cruise: cruiseCandidates.length },
    };
  }

  const { system, user } = buildPrompt({ dest, holidayCandidates, activityCandidates, cruiseCandidates });

  try {
    const { parsed, usage, model, webSearchCalls } = await callClaude({ system, user, model: modelOverride, useWebSearch });
    const merged = { ...fallback, ...parsed };
    validateRanking(merged, { dest, holidayCandidates, activityCandidates, cruiseCandidates });

    if (parsed.safe_to_promote === false) {
      const reason = (parsed.safety_notes || []).join(' | ') || 'Claude flagged destination as unsafe to promote';
      throw new Error(`UNSAFE_TO_PROMOTE: ${reason}`);
    }

    return {
      ranking:        merged,
      source:         'claude',
      rationale:      merged.rationale || '',
      trendingThemes: parsed.trending_themes || [],
      safetyNotes:    parsed.safety_notes    || [],
      safeToPromote:  parsed.safe_to_promote !== false,
      webSearchCalls,
      model,
      usage,
      candidates:     { holiday: holidayCandidates.length, activity: activityCandidates.length, cruise: cruiseCandidates.length },
    };
  } catch (err) {
    if (String(err.message || '').startsWith('UNSAFE_TO_PROMOTE')) throw err;
    console.warn(`[Day6DestinationRankingService] Claude call failed → fallback. Reason: ${err.message}`);
    return {
      ranking:        fallback,
      source:         'fallback',
      rationale:      fallback.rationale,
      trendingThemes: [],
      safetyNotes:    [],
      safeToPromote:  true,
      webSearchCalls: 0,
      error:          err.message,
      candidates:     { holiday: holidayCandidates.length, activity: activityCandidates.length, cruise: cruiseCandidates.length },
    };
  }
}

export const _internals = {
  buildPrompt, validateRanking, callClaude, buildFallbackRanking,
  fetchHolidayCandidates, fetchActivityCandidates, fetchCruiseCandidates,
  SLOT_COUNT,
};

export default rankDestinationSpotlight;
