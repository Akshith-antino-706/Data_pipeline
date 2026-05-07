/**
 * Day1WelcomeRankingService
 *
 * Single Anthropic call (with the web_search server tool) that picks 4 keys
 * per section for the Day-1 welcome email — Holidays / Cruises / Visas /
 * Activities. Picks are based on what's TRENDING globally / regionally
 * right now, not on per-contact attributes (universal ranking).
 *
 * Pipeline:
 *   1. Load the 3 in-file destination catalogs (holiday/cruise/activity) from
 *      Day1WelcomeDataService and the visa_products DB rows.
 *   2. Build a structured prompt: 4 catalog blocks + variant options +
 *      JSON schema.
 *   3. Call Claude with web_search enabled (max 5 searches).
 *   4. Parse + validate the JSON response. Cross-section disjointness is
 *      NOT required — the same destination (e.g. Dubai) legitimately fits
 *      Holidays/Cruises/Activities. We only require WITHIN-section unique.
 *   5. Fallback to a deterministic ranking if anything goes wrong.
 *
 * Env:
 *   ANTHROPIC_API_KEY  required for live ranking; missing → fallback
 *   CLAUDE_MODEL       optional (default: 'claude-sonnet-4-5')
 */

import { query } from '../config/database.js';
import { _internals as dataInternals } from './Day1WelcomeDataService.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SLOT_COUNT = 4;

const VARIANT_OPTIONS = {
  hero_variant_key:      ['perfect_trip', 'curated_for_you'],
  exclusive_variant_key: ['raynow', 'welcome_off'],
};

// ── catalog loaders ───────────────────────────────────────────────────────

async function loadVisaCatalog() {
  const { rows } = await query(`
    SELECT key, name, country_label, region
      FROM visa_products
     WHERE enabled = TRUE
     ORDER BY sort_order, key
  `);
  return rows;
}

function listFromMap(map) {
  // Map → array of { key, name, link } for prompt formatting
  return Object.entries(map).map(([key, v]) => ({ key, name: v.name, link: v.default_link }));
}

// ── prompt construction ───────────────────────────────────────────────────

function buildPrompt(holidays, cruises, activities, visas) {
  const fmt = v => `  - ${v.key.padEnd(14)} | ${v.name}`;

  const catalogBlock = `
HOLIDAY DESTINATIONS catalog (pick 4 keys for Holidays section):
${holidays.map(fmt).join('\n')}

CRUISE DESTINATIONS catalog (pick 4 keys for Cruises section):
${cruises.map(fmt).join('\n')}

VISA catalog (pick 4 keys for Visas section):
${visas.map(v => `  - ${v.key.padEnd(14)} | ${v.name.padEnd(22)} | ${v.region || '-'}`).join('\n')}

ACTIVITY DESTINATIONS catalog (pick 4 keys for Activities section):
${activities.map(fmt).join('\n')}`;

  const variantBlock = `
COPY VARIANT OPTIONS — pick ONE key per group:
  hero_variant_key       : ${VARIANT_OPTIONS.hero_variant_key.join(' | ')}
  exclusive_variant_key  : ${VARIANT_OPTIONS.exclusive_variant_key.join(' | ')}`;

  const rules = `
SAFETY PRE-SCREEN — DO THIS FIRST, BEFORE ANY OTHER SEARCH:
  Use web_search to check news in the LAST 30 DAYS for each candidate
  destination. Look for: active armed conflict, war, military strikes,
  "do not travel" advisories, civil unrest, terror events, airport / airspace
  closures, natural disasters disrupting tourism.
  EXCLUDE any destination with active issues. Don't promote any destination
  you cannot confidently say is currently safe and open.
  Add a "safety_notes" array with destinations excluded + reason (≤15 words).

HOW TO PICK:
  1. Use the web_search tool 3-5 times to find what's CURRENTLY TRENDING.
     Useful queries (vary terms / current year):
       "trending holiday destinations 2026"
       "top cruise destinations 2026 by bookings"
       "trending visa applications 2026"
       "most popular activities tourists 2026"
       "where UAE / GCC residents are travelling 2026"
       "viral travel destinations [current year]"
  2. From real-world signal (search trends, arrivals data, visa surges,
     news mentions), pick the strongest 4 destinations PER section.
  3. ONLY use keys that exist in the catalog above. If a trending destination
     is NOT in our catalog, skip it — pick the next best catalog match.
     Never fabricate keys.
  4. Within a section, all 4 keys must be unique. ACROSS sections, the same
     destination MAY appear (e.g. 'dubai' in both Holidays and Cruises is
     fine — Dubai is genuinely a top market for both).
  5. Universal picks — no per-customer personalisation.

OUTPUT CONSTRAINTS:
  - holiday_keys, cruise_keys, visa_keys, activity_keys: each EXACTLY 4
    unique keys from their respective catalogs.
  - trending_themes : 3-5 short tags (≤4 words each) for logging.
  - rationale       : ≤50 words plain English. Brief evidence: which trends
                     drove the picks for each section.

After you have searched, return ONLY the JSON object below. No prose, no
markdown fences, no commentary.

JSON SCHEMA:
{
  "safety_notes":    ["<excluded destination — short reason>", ...],
  "trending_themes": ["<tag>", "<tag>", "<tag>"],
  "rationale": "<≤50 words>",
  "holiday_keys":  ["<key>","<key>","<key>","<key>"],
  "cruise_keys":   ["<key>","<key>","<key>","<key>"],
  "visa_keys":     ["<key>","<key>","<key>","<key>"],
  "activity_keys": ["<key>","<key>","<key>","<key>"],
  "hero_variant_key":      "<one of options>",
  "exclusive_variant_key": "<one of options>"
}`;

  const system = `You pick destinations to feature in a Day-1 welcome marketing email for Rayna Tours (a Dubai-based travel agency). You choose the most-trending destinations across four sections — Holidays, Cruises, Visas, Activities — by searching the web for current real-world demand, then mapping findings to our catalog. Same picks apply to all customers. ${rules}`;

  const user = `${catalogBlock}\n${variantBlock}\n\nUse web_search to find current trending destinations, then return the JSON.`;
  return { system, user };
}

// ── validation ────────────────────────────────────────────────────────────

function validateRanking(ranking, { holidayMap, cruiseMap, activityMap, visaMap }) {
  if (!ranking || typeof ranking !== 'object') throw new Error('ranking is not an object');

  const checkSection = (slot, map) => {
    const arr = ranking[slot];
    if (!Array.isArray(arr)) throw new Error(`${slot} must be an array`);
    if (arr.length !== SLOT_COUNT) throw new Error(`${slot} has ${arr.length} keys, expected ${SLOT_COUNT}`);
    if (new Set(arr).size !== SLOT_COUNT) throw new Error(`${slot} has duplicate keys`);
    for (const k of arr) {
      if (!map[k]) throw new Error(`${slot} contains unknown key: "${k}"`);
    }
  };

  checkSection('holiday_keys',  holidayMap);
  checkSection('cruise_keys',   cruiseMap);
  checkSection('activity_keys', activityMap);
  checkSection('visa_keys',     visaMap);

  for (const [k, options] of Object.entries(VARIANT_OPTIONS)) {
    const v = ranking[k];
    if (v && !options.includes(v)) {
      throw new Error(`${k}="${v}" not in [${options.join(', ')}]`);
    }
  }
}

// ── Claude call ───────────────────────────────────────────────────────────

async function callClaude({ system, user, model = DEFAULT_MODEL, useWebSearch = true }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('NO_API_KEY');

  const body = {
    model,
    max_tokens:  4096,
    temperature: 0.3,
    system,
    messages: [{ role: 'user', content: user }],
  };

  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 7 }];
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
  const text = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : '';
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

function buildFallbackRanking(maps) {
  const top4 = (m) => Object.keys(m).slice(0, SLOT_COUNT);

  return {
    rationale:             'Default ranking (Claude unavailable). Top of each catalog.',
    holiday_keys:          top4(maps.holidayMap),
    cruise_keys:           top4(maps.cruiseMap),
    activity_keys:         top4(maps.activityMap),
    visa_keys:             top4(maps.visaMap),
    hero_variant_key:      'perfect_trip',
    exclusive_variant_key: 'raynow',
  };
}

// ── public API ────────────────────────────────────────────────────────────

export async function rankTrendingWelcome({ modelOverride, useWebSearch = true } = {}) {
  const holidayMap  = dataInternals.HOLIDAY_DESTINATIONS;
  const cruiseMap   = dataInternals.CRUISE_DESTINATIONS;
  const activityMap = dataInternals.ACTIVITY_DESTINATIONS;
  const visaRows    = await loadVisaCatalog();
  const visaMap     = Object.fromEntries(visaRows.map(r => [r.key, r]));

  if (!Object.keys(holidayMap).length || !Object.keys(cruiseMap).length ||
      !Object.keys(activityMap).length || visaRows.length === 0) {
    throw new Error('[Day1WelcomeRankingService] one or more catalogs are empty');
  }

  const maps = { holidayMap, cruiseMap, activityMap, visaMap };
  const fallback = buildFallbackRanking(maps);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ranking:        fallback,
      source:         'fallback_no_api_key',
      rationale:      fallback.rationale,
      trendingThemes: [],
      webSearchCalls: 0,
    };
  }

  const holidays   = listFromMap(holidayMap);
  const cruises    = listFromMap(cruiseMap);
  const activities = listFromMap(activityMap);
  const { system, user } = buildPrompt(holidays, cruises, activities, visaRows);

  try {
    const { parsed, usage, model, webSearchCalls } = await callClaude({ system, user, model: modelOverride, useWebSearch });
    const merged = { ...fallback, ...parsed };
    validateRanking(merged, maps);

    return {
      ranking:        merged,
      source:         'claude',
      rationale:      merged.rationale || '',
      trendingThemes: parsed.trending_themes || [],
      safetyNotes:    parsed.safety_notes    || [],
      webSearchCalls,
      model,
      usage,
    };
  } catch (err) {
    console.warn(`[Day1WelcomeRankingService] Claude call failed → fallback. Reason: ${err.message}`);
    return {
      ranking:        fallback,
      source:         'fallback',
      rationale:      fallback.rationale,
      trendingThemes: [],
      safetyNotes:    [],
      webSearchCalls: 0,
      error:          err.message,
    };
  }
}

export const _internals = {
  loadVisaCatalog, listFromMap, buildPrompt, validateRanking,
  buildFallbackRanking, callClaude,
  SLOT_COUNT, VARIANT_OPTIONS,
};

export default rankTrendingWelcome;
