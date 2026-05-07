/**
 * Day5ActivitiesRankingService
 *
 * Single Anthropic call (web_search-enabled) that picks 4 activity keys per
 * theme (thrill / family / icons / water / wildlife) plus 4 city keys for
 * the Top Cities section, plus a hero_activity_key for the hero bg.
 *
 * Universal ranking — same picks for every recipient. Picks are grounded
 * in real-world trending signal via Claude's web_search tool.
 */

import { _internals as dataInternals } from './Day5ActivitiesDataService.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SLOT_COUNT_THEME = 4;
const SLOT_COUNT_CITY  = 4;

const VARIANT_OPTIONS = {
  hero_variant_key:           ['skip_the_queue', 'experience_more'],
  limited_offer_variant_key:  ['raynow', 'early10'],
};

// ── prompt construction ───────────────────────────────────────────────────

function listForTheme(theme) {
  return Object.entries(dataInternals.ACTIVITY_CATALOG)
    .filter(([, v]) => v.themes.includes(theme))
    .map(([k, v]) => `  - ${k.padEnd(24)} | ${v.category.padEnd(28)} | product_id=${v.product_id}`);
}

function listCities() {
  return Object.entries(dataInternals.TOP_CITIES)
    .map(([k, v]) => `  - ${k.padEnd(14)} | ${v.city.padEnd(15)} | ${v.country}`);
}

function buildPrompt() {
  const thrill   = listForTheme('thrill').join('\n');
  const family   = listForTheme('family').join('\n');
  const icons    = listForTheme('icons').join('\n');
  const water    = listForTheme('water').join('\n');
  const wildlife = listForTheme('wildlife').join('\n');
  const cities   = listCities().join('\n');
  const allActivityKeys = Object.keys(dataInternals.ACTIVITY_CATALOG).join(', ');

  const rules = `
SAFETY PRE-SCREEN — DO THIS FIRST, BEFORE ANY OTHER SEARCH:
  Use web_search to check news in the LAST 30 DAYS for each candidate
  city/destination listed below. Look for:
    • active armed conflict / war / military strikes / regional escalation
    • government travel advisories at "do not travel" level
    • civil unrest, terror events, airport / airspace closures
    • natural disasters that have disrupted tourism
  EXCLUDE any destination with active issues from your picks. Don't promote
  any destination you cannot confidently say is currently safe and open.

  Add a "safety_notes" array to your JSON output: each entry should name
  the excluded destination and the reason in plain English (≤15 words).
  If you exclude nothing, return an empty array.

EACH SECTION HAS A DIFFERENT JOB:

  • city_keys              → "Top Cities To Visit" — 4 cities from CITY pool
  • thrill_keys            → adventure / adrenaline / outdoor activities
  • family_keys            → theme parks / safari / kid-friendly attractions
  • icons_keys             → bucket-list landmarks / observation decks
  • water_keys             → cruises / waterparks / island tours
  • wildlife_keys          → aquariums / safaris / wildlife encounters
  • hero_activity_key      → ONE activity whose product image is used as hero bg

HOW TO PICK:
  1. Use web_search 3-4 times. Find what's TRENDING in 2026 travel activities
     for UAE/GCC tourists. News, search trends, "must-do" lists, viral videos.
     Useful queries:
       "trending Dubai activities 2026"
       "must-do experiences Singapore 2026"
       "viral travel activities Asia 2026"
       "best theme parks 2026 UAE travellers"
  2. From findings, pick keys from the candidate lists below. ONLY use keys
     that exist there. Each key in <theme>_keys MUST have that theme tag.
  3. hero_activity_key — pick something visually striking from any theme.
  4. Universal picks. No per-user personalisation.

CITIES (pick 4 for city_keys):
${cities}

THRILL activities:
${thrill}

FAMILY activities:
${family}

ICONIC activities:
${icons}

WATER activities (cruises, waterparks, islands):
${water}

WILDLIFE activities:
${wildlife}

ALL VALID ACTIVITY KEYS: ${allActivityKeys}

VARIANT OPTIONS:
  hero_variant_key          : ${VARIANT_OPTIONS.hero_variant_key.join(' | ')}
  limited_offer_variant_key : ${VARIANT_OPTIONS.limited_offer_variant_key.join(' | ')}

OUTPUT CONSTRAINTS:
  - city_keys              : EXACTLY 4 unique keys from the CITY pool below.
  - thrill/family/icons/water/wildlife_keys: EXACTLY 4 unique keys each, from
                             their respective pools below. Never duplicate.
  - hero_activity_key      : 1 key from any theme.

  Note: candidate pools may be smaller than the full pool because some
  destinations have been removed for safety/business reasons. Pick from
  what's offered. If a pool has exactly 4 entries, use all 4.
  - trending_themes        : 3-5 short tags summarising what you found trending.
  - rationale              : ≤40 words plain English.

Return ONLY the JSON below. No prose, no markdown fences.

JSON SCHEMA:
{
  "safety_notes":    ["<excluded destination — short reason>", ...],
  "trending_themes": ["<tag>", ...],
  "rationale":       "<≤40 words>",
  "city_keys":       ["<k>","<k>","<k>","<k>"],
  "thrill_keys":     ["<k>","<k>","<k>","<k>"],
  "family_keys":     ["<k>","<k>","<k>","<k>"],
  "icons_keys":      ["<k>","<k>","<k>","<k>"],
  "water_keys":      ["<k>","<k>","<k>","<k>"],
  "wildlife_keys":   ["<k>","<k>","<k>","<k>"],
  "hero_activity_key":         "<k>",
  "hero_variant_key":          "<one of options>",
  "limited_offer_variant_key": "<one of options>"
}`;

  const system = `You pick activities to feature in a marketing email for Rayna Tours (Dubai-based travel agency). Use web_search to find trending experiences right now, then map onto our catalog. Universal picks (not personalised). ${rules}`;
  const user   = `Use web_search to find trending activities for UAE/GCC travellers, then return the JSON.`;
  return { system, user };
}

// ── validation ────────────────────────────────────────────────────────────

function validateRanking(r) {
  if (!r || typeof r !== 'object') throw new Error('ranking is not an object');

  const catalog = dataInternals.ACTIVITY_CATALOG;
  const cities  = dataInternals.TOP_CITIES;

  // city_keys: exactly SLOT_COUNT_CITY unique, all in cities pool
  if (!Array.isArray(r.city_keys) || r.city_keys.length !== SLOT_COUNT_CITY) {
    throw new Error(`city_keys must have exactly ${SLOT_COUNT_CITY} keys (got ${(r.city_keys || []).length})`);
  }
  if (new Set(r.city_keys).size !== r.city_keys.length) {
    throw new Error(`city_keys has duplicates`);
  }
  for (const k of r.city_keys) {
    if (!cities[k]) throw new Error(`city_keys: unknown "${k}"`);
  }

  // Themed keys: exactly SLOT_COUNT_THEME unique, all tagged with the right theme
  const themed = ['thrill', 'family', 'icons', 'water', 'wildlife'];
  for (const t of themed) {
    const arr = r[`${t}_keys`];
    if (!Array.isArray(arr)) throw new Error(`${t}_keys must be an array`);
    if (arr.length !== SLOT_COUNT_THEME) {
      throw new Error(`${t}_keys must have exactly ${SLOT_COUNT_THEME} keys (got ${arr.length})`);
    }
    if (new Set(arr).size !== arr.length) throw new Error(`${t}_keys has duplicates`);
    for (const k of arr) {
      if (!catalog[k]) throw new Error(`${t}_keys: unknown "${k}"`);
      if (!catalog[k].themes.includes(t)) throw new Error(`${t}_keys: "${k}" is not tagged with theme "${t}"`);
    }
  }

  if (r.hero_activity_key && !catalog[r.hero_activity_key]) {
    throw new Error(`hero_activity_key invalid: ${r.hero_activity_key}`);
  }
  if (r.hero_variant_key && !VARIANT_OPTIONS.hero_variant_key.includes(r.hero_variant_key)) {
    throw new Error(`hero_variant_key="${r.hero_variant_key}" not in [${VARIANT_OPTIONS.hero_variant_key.join(', ')}]`);
  }
  if (r.limited_offer_variant_key && !VARIANT_OPTIONS.limited_offer_variant_key.includes(r.limited_offer_variant_key)) {
    throw new Error(`limited_offer_variant_key="${r.limited_offer_variant_key}" not in [${VARIANT_OPTIONS.limited_offer_variant_key.join(', ')}]`);
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
    // 6 max uses: safety pre-screen (~2-3 calls) + trend research (~2-3 calls).
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
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

function buildFallbackRanking() {
  const catalog = dataInternals.ACTIVITY_CATALOG;
  const cities  = dataInternals.TOP_CITIES;

  const top = (theme) => Object.entries(catalog)
    .filter(([, v]) => v.themes.includes(theme))
    .slice(0, SLOT_COUNT_THEME)
    .map(([k]) => k);

  return {
    rationale:                'Default ranking (Claude unavailable). Top of each theme.',
    city_keys:                Object.keys(cities).slice(0, SLOT_COUNT_CITY),
    thrill_keys:              top('thrill'),
    family_keys:              top('family'),
    icons_keys:               top('icons'),
    water_keys:               top('water'),
    wildlife_keys:            top('wildlife'),
    hero_activity_key:        top('thrill')[0],
    hero_variant_key:         'skip_the_queue',
    limited_offer_variant_key:'raynow',
  };
}

// ── public API ────────────────────────────────────────────────────────────

export async function rankTrendingActivities({ modelOverride, useWebSearch = true } = {}) {
  const fallback = buildFallbackRanking();

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ranking:        fallback,
      source:         'fallback_no_api_key',
      rationale:      fallback.rationale,
      trendingThemes: [],
      webSearchCalls: 0,
    };
  }

  const { system, user } = buildPrompt();
  try {
    const { parsed, usage, model, webSearchCalls } = await callClaude({ system, user, model: modelOverride, useWebSearch });
    const merged = { ...fallback, ...parsed };
    validateRanking(merged);
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
    console.warn(`[Day5ActivitiesRankingService] Claude call failed → fallback. Reason: ${err.message}`);
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
  buildPrompt, validateRanking, callClaude, buildFallbackRanking,
  SLOT_COUNT_THEME, SLOT_COUNT_CITY, VARIANT_OPTIONS,
};

export default rankTrendingActivities;
