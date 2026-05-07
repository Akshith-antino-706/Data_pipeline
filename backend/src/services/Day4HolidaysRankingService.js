/**
 * Day4HolidaysRankingService
 *
 * Single Anthropic call (web_search-enabled) that picks 4 destination keys
 * per theme for the Day-4 Holidays email — Summer / Eid / Romantic /
 * Adventure — plus one "eid_special" feature destination, plus a
 * "hero_destination" used to render the hero bg.
 *
 * Picks come from the in-file HOLIDAY_DESTINATIONS catalog (in
 * Day4HolidaysDataService). Each destination is tagged with one or more
 * `themes` — Claude must respect those tags.
 *
 * Within-section uniqueness is required. Cross-section repetition is OK
 * (e.g. Phuket can show in both Summer and Adventure if the catalog tags
 * both themes for it) — but we encourage Claude to spread variety.
 */

import { _internals as dataInternals } from './Day4HolidaysDataService.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const SLOT_COUNT = 4;
const VARIANT_OPTIONS = {
  hero_variant_key: ['dream_holidays', 'expertly_curated'],
};

// ── prompt construction ───────────────────────────────────────────────────

function listFor(theme) {
  return Object.entries(dataInternals.HOLIDAY_DESTINATIONS)
    .filter(([, v]) => v.themes.includes(theme))
    .map(([k, v]) => `  - ${k.padEnd(16)} | ${v.name.padEnd(18)} | ${v.country}`);
}

function buildPrompt() {
  const summerList    = listFor('summer').join('\n');
  const eidList       = listFor('eid').join('\n');
  const romanticList  = listFor('romantic').join('\n');
  const adventureList = listFor('adventure').join('\n');
  const allKeys       = Object.keys(dataInternals.HOLIDAY_DESTINATIONS).join(', ');

  const rules = `
SAFETY PRE-SCREEN — DO THIS FIRST, BEFORE ANY OTHER SEARCH:
  Use web_search to check news in the LAST 30 DAYS for each candidate
  destination. Look for: active armed conflict, war, military strikes,
  "do not travel" advisories, civil unrest, terror events, airport / airspace
  closures, natural disasters disrupting tourism.
  EXCLUDE any destination with active issues. Don't promote any destination
  you cannot confidently say is currently safe and open.
  Add a "safety_notes" array with destinations excluded + reason (≤15 words).

EACH SECTION HAS A DIFFERENT JOB:

  • summer_keys         → "Summer Escapes" (tropical, beach, Asia-Pacific)
  • eid_keys            → "Eid Al Adha Packages" (multi-day regional / GCC / Central Asia, family-friendly)
  • romantic_keys       → "Romantic Destinations" (couples, scenic, intimate)
  • adventure_keys      → "Adventure Destinations" (outdoor, mountains, wildlife, desert, hiking)
  • eid_special_key     → ONE single destination for the featured Eid banner. Should be from eid_keys preferably.
  • hero_destination_key→ ONE destination whose product image is used as the email's hero background.

HOW TO PICK:
  1. Use web_search 3-4 times. Find what's TRENDING in 2026 holidays for travellers from the UAE/GCC.
     Searches: "trending summer holiday destinations 2026 UAE", "Eid 2026 family holiday destinations",
     "best couples / honeymoon destinations 2026", "adventure travel destinations 2026 trending".
  2. Match findings to KEYS from the candidate lists below. ONLY use keys that exist there.
  3. Each key in summer_keys MUST come from the SUMMER list (etc. for the others).
  4. eid_special_key should come from the EID list (or from eid_keys you picked).
  5. hero_destination_key can be any destination — but pick something visually striking (preferably
     one of the 16 keys you've already picked across the 4 themes).
  6. Universal picks — these apply to all customers, no per-user personalisation.

CANDIDATE DESTINATIONS BY THEME (pick ONLY from these):

SUMMER (tropical / beach):
${summerList}

EID (multi-day regional):
${eidList}

ROMANTIC (couples):
${romanticList}

ADVENTURE (outdoor / wildlife):
${adventureList}

ALL VALID KEYS: ${allKeys}

VARIANT OPTIONS:
  hero_variant_key: ${VARIANT_OPTIONS.hero_variant_key.join(' | ')}

OUTPUT CONSTRAINTS:
  - Each <theme>_keys: EXACTLY 4 unique keys, each from the listed pool for that theme.
  - eid_special_key   : 1 key from EID pool (ideally one of eid_keys).
  - hero_destination_key: 1 key from anywhere in the catalog.
  - trending_themes   : 3-5 short tags summarising what you found trending.
  - rationale         : ≤40 words plain English.

After searching, return ONLY the JSON object below. No prose, no markdown fences.

JSON SCHEMA:
{
  "safety_notes":    ["<excluded destination — short reason>", ...],
  "trending_themes": ["<tag>", ...],
  "rationale": "<≤40 words>",
  "summer_keys":    ["<k>","<k>","<k>","<k>"],
  "eid_keys":       ["<k>","<k>","<k>","<k>"],
  "romantic_keys":  ["<k>","<k>","<k>","<k>"],
  "adventure_keys": ["<k>","<k>","<k>","<k>"],
  "eid_special_key":      "<k>",
  "hero_destination_key": "<k>",
  "hero_variant_key":     "<one of options>"
}`;

  const system = `You pick holiday destinations to feature in a marketing email for Rayna Tours (Dubai-based travel agency). Use web_search to identify what's trending right now, then map to our catalog of holiday destinations across four themes. Universal picks (not personalised). ${rules}`;
  const user   = `Use web_search to find current trending holiday destinations for UAE/GCC travellers, then return the JSON.`;
  return { system, user };
}

// ── validation ────────────────────────────────────────────────────────────

function validateRanking(ranking) {
  if (!ranking || typeof ranking !== 'object') throw new Error('ranking is not an object');

  const catalog = dataInternals.HOLIDAY_DESTINATIONS;
  const inTheme = (key, theme) => catalog[key]?.themes?.includes(theme);

  const expectations = [
    { slot: 'summer_keys',    theme: 'summer'    },
    { slot: 'eid_keys',       theme: 'eid'       },
    { slot: 'romantic_keys',  theme: 'romantic'  },
    { slot: 'adventure_keys', theme: 'adventure' },
  ];

  for (const { slot, theme } of expectations) {
    const arr = ranking[slot];
    if (!Array.isArray(arr)) throw new Error(`${slot} must be an array`);
    if (arr.length !== SLOT_COUNT) throw new Error(`${slot} has ${arr.length} keys, expected ${SLOT_COUNT}`);
    if (new Set(arr).size !== arr.length) throw new Error(`${slot} has duplicate keys`);
    for (const k of arr) {
      if (!catalog[k]) throw new Error(`${slot}: unknown key "${k}"`);
      if (!inTheme(k, theme)) throw new Error(`${slot}: "${k}" is not tagged with theme "${theme}"`);
    }
  }

  if (!ranking.eid_special_key || !catalog[ranking.eid_special_key]) {
    throw new Error(`eid_special_key invalid: "${ranking.eid_special_key}"`);
  }
  if (!ranking.hero_destination_key || !catalog[ranking.hero_destination_key]) {
    throw new Error(`hero_destination_key invalid: "${ranking.hero_destination_key}"`);
  }
  if (ranking.hero_variant_key && !VARIANT_OPTIONS.hero_variant_key.includes(ranking.hero_variant_key)) {
    throw new Error(`hero_variant_key="${ranking.hero_variant_key}" not in [${VARIANT_OPTIONS.hero_variant_key.join(', ')}]`);
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

function buildFallbackRanking() {
  const catalog = dataInternals.HOLIDAY_DESTINATIONS;
  const top = (theme) => Object.entries(catalog)
    .filter(([, v]) => v.themes.includes(theme))
    .slice(0, SLOT_COUNT)
    .map(([k]) => k);

  return {
    rationale:           'Default ranking (Claude unavailable). Top of each theme.',
    summer_keys:         top('summer'),
    eid_keys:            top('eid'),
    romantic_keys:       top('romantic'),
    adventure_keys:      top('adventure'),
    eid_special_key:     top('eid')[0],
    hero_destination_key:top('summer')[0],
    hero_variant_key:    'dream_holidays',
  };
}

// ── public API ────────────────────────────────────────────────────────────

export async function rankTrendingHolidays({ modelOverride, useWebSearch = true } = {}) {
  const fallback = buildFallbackRanking();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ranking: fallback, source: 'fallback_no_api_key', rationale: fallback.rationale, trendingThemes: [], webSearchCalls: 0 };
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
    console.warn(`[Day4HolidaysRankingService] Claude call failed → fallback. Reason: ${err.message}`);
    return {
      ranking:        fallback,
      source:         'fallback',
      rationale:      fallback.rationale,
      trendingThemes: [],
      webSearchCalls: 0,
      error:          err.message,
    };
  }
}

export const _internals = {
  buildPrompt, validateRanking, callClaude, buildFallbackRanking,
  SLOT_COUNT, VARIANT_OPTIONS, listFor,
};

export default rankTrendingHolidays;
