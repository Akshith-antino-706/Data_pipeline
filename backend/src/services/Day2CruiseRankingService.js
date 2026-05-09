/**
 * Day2CruiseRankingService
 *
 * Single Anthropic call (with web_search) that picks cruise products, lines,
 * departure cities, and copy variants for the Day-2 cruise email.
 *
 * Ranking shape (matches Day2CruiseDataService.validateRanking):
 *   saver_product_ids          (3)  — cruise product IDs for "saver" section
 *   regional_product_ids       (4)  — cruise product IDs for "regional" section
 *   cruise_line_keys           (4)  — keys from CRUISE_LINES map
 *   departure_city_keys        (5)  — keys from DEPARTURE_CITIES map
 *   hero_variant_key           (1)  — 'horizon' | 'seven_seas' | 'asia_calling'
 *   regional_copy_variant_key  (1)  — 'mediterranean' | 'northern_europe' | 'asia_pacific' | 'red_sea'
 *   hero_product_id            (1)  — optional, one of the saver/regional ids
 *
 * Env:
 *   ANTHROPIC_API_KEY  required for live ranking; missing → fallback
 *   CLAUDE_MODEL       optional (default: 'claude-sonnet-4-5')
 */

import { query } from '../config/database.js';
import { _internals as dataInternals } from './Day2CruiseDataService.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ── catalog loader ───────────────────────────────────────────────────────

async function loadCruiseProducts() {
  const { rows } = await query(`
    SELECT product_id, name, category, city, country,
           sale_price, normal_price, currency, url, image_url
      FROM products
     WHERE type = 'cruise'
     ORDER BY sale_price ASC NULLS LAST
     LIMIT 50
  `);
  return rows;
}

// ── prompt construction ──────────────────────────────────────────────────

function buildPrompt(cruiseProducts, departureCities, cruiseLines, heroVariants, regionalCopy) {
  const productFmt = p =>
    `  - ID ${p.product_id} | ${p.name} | ${p.city || '—'} | ${p.currency || 'AED'} ${p.sale_price || '—'}`;

  const catalogBlock = `
CRUISE PRODUCTS catalog (pick 3 for saver_product_ids, 4 for regional_product_ids — NO overlap):
${cruiseProducts.map(productFmt).join('\n')}

DEPARTURE CITIES (pick 5 keys):
${Object.entries(departureCities).map(([k, v]) => `  - ${k.padEnd(16)} | ${v.name}`).join('\n')}

CRUISE LINES (pick 4 keys):
${Object.entries(cruiseLines).map(([k, v]) => `  - ${k.padEnd(20)} | ${v.name}`).join('\n')}`;

  const variantBlock = `
COPY VARIANT OPTIONS — pick ONE key per group:
  hero_variant_key           : ${Object.keys(heroVariants).join(' | ')}
  regional_copy_variant_key  : ${Object.keys(regionalCopy).join(' | ')}`;

  const rules = `
SAFETY PRE-SCREEN — DO THIS FIRST:
  Use web_search to check cruise news in the LAST 30 DAYS. Look for:
  port closures, cruise bans, piracy warnings, geopolitical disruptions.
  EXCLUDE any route/port with active issues.
  Add a "safety_notes" array with exclusions + reason (≤15 words each).

HOW TO PICK:
  1. Use web_search 3-5 times:
     "trending cruise destinations 2026"
     "best cruise deals 2026"
     "cruise industry trends 2026"
     "popular cruise departures middle east 2026"
     "cruise booking trends UAE GCC 2026"
  2. Pick products with the best value + trending routes.
  3. saver_product_ids (3) and regional_product_ids (4) must NOT overlap.
  4. departure_city_keys: pick 5 keys from the DEPARTURE CITIES list above.
  5. cruise_line_keys: pick 4 keys from the CRUISE LINES list above.
  6. hero_product_id: optionally pick ONE product_id from saver or regional
     to feature as the hero background image.

OUTPUT — return ONLY the JSON object below. No prose, no markdown fences.

JSON SCHEMA:
{
  "safety_notes":              ["<excluded — reason>", ...],
  "trending_themes":           ["<tag>", "<tag>", "<tag>"],
  "rationale":                 "<≤50 words>",
  "saver_product_ids":         [<id>, <id>, <id>],
  "regional_product_ids":      [<id>, <id>, <id>, <id>],
  "cruise_line_keys":          ["<key>","<key>","<key>","<key>"],
  "departure_city_keys":       ["<key>","<key>","<key>","<key>","<key>"],
  "hero_variant_key":          "<one of options>",
  "regional_copy_variant_key": "<one of options>",
  "hero_product_id":           <id or null>
}`;

  const system = `You pick cruise products and routes to feature in a Day-2 cruise marketing email for Rayna Tours (a Dubai-based travel agency). You choose trending cruise products, lines, and departure cities by searching the web, then mapping findings to our catalog. Same picks apply to all customers. ${rules}`;

  const user = `${catalogBlock}\n${variantBlock}\n\nUse web_search to find current cruise trends, then return the JSON.`;
  return { system, user };
}

// ── validation ───────────────────────────────────────────────────────────

function validateRanking(ranking, { productIds, departureCityKeys, cruiseLineKeys, heroVariantKeys, regionalCopyKeys }) {
  if (!ranking || typeof ranking !== 'object') throw new Error('ranking is not an object');

  // saver_product_ids
  if (!Array.isArray(ranking.saver_product_ids) || ranking.saver_product_ids.length !== 3)
    throw new Error('saver_product_ids must be array of 3');
  for (const id of ranking.saver_product_ids) {
    if (!productIds.has(Number(id))) throw new Error(`saver_product_ids: unknown product ${id}`);
  }

  // regional_product_ids
  if (!Array.isArray(ranking.regional_product_ids) || ranking.regional_product_ids.length !== 4)
    throw new Error('regional_product_ids must be array of 4');
  for (const id of ranking.regional_product_ids) {
    if (!productIds.has(Number(id))) throw new Error(`regional_product_ids: unknown product ${id}`);
  }

  // no overlap
  const saverSet = new Set(ranking.saver_product_ids.map(Number));
  for (const id of ranking.regional_product_ids) {
    if (saverSet.has(Number(id))) throw new Error(`product ${id} appears in both saver and regional`);
  }

  // cruise_line_keys
  if (!Array.isArray(ranking.cruise_line_keys) || ranking.cruise_line_keys.length !== 4)
    throw new Error('cruise_line_keys must be array of 4');
  for (const k of ranking.cruise_line_keys) {
    if (!cruiseLineKeys.has(k)) throw new Error(`unknown cruise_line_key: ${k}`);
  }

  // departure_city_keys
  if (!Array.isArray(ranking.departure_city_keys) || ranking.departure_city_keys.length < 4)
    throw new Error('departure_city_keys must be array of 4-5');
  for (const k of ranking.departure_city_keys) {
    if (!departureCityKeys.has(k)) throw new Error(`unknown departure_city_key: ${k}`);
  }

  // variant keys
  if (ranking.hero_variant_key && !heroVariantKeys.has(ranking.hero_variant_key))
    throw new Error(`unknown hero_variant_key: ${ranking.hero_variant_key}`);
  if (ranking.regional_copy_variant_key && !regionalCopyKeys.has(ranking.regional_copy_variant_key))
    throw new Error(`unknown regional_copy_variant_key: ${ranking.regional_copy_variant_key}`);
}

// ── Claude call ──────────────────────────────────────────────────────────

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

// ── deterministic fallback ───────────────────────────────────────────────

function buildFallbackRanking(cruiseProducts, departureCityKeys, cruiseLineKeys) {
  const ids = cruiseProducts.map(p => p.product_id);
  return {
    rationale:                'Default ranking (Claude unavailable). Cheapest products first.',
    saver_product_ids:         ids.slice(0, 3),
    regional_product_ids:      ids.slice(3, 7),
    cruise_line_keys:          cruiseLineKeys.slice(0, 4),
    departure_city_keys:       departureCityKeys.slice(0, 5),
    hero_variant_key:          'horizon',
    regional_copy_variant_key: 'mediterranean',
    hero_product_id:           ids[0] || null,
  };
}

// ── public API ───────────────────────────────────────────────────────────

export async function rankTrendingCruises({ modelOverride, useWebSearch = true } = {}) {
  const cruiseProducts   = await loadCruiseProducts();
  const departureCities  = dataInternals.DEPARTURE_CITIES;
  const cruiseLines      = dataInternals.CRUISE_LINES;
  const heroVariants     = dataInternals.HERO_VARIANTS;
  const regionalCopy     = dataInternals.REGIONAL_COPY;

  if (cruiseProducts.length < 7) {
    throw new Error(`[Day2CruiseRankingService] only ${cruiseProducts.length} cruise products — need ≥7`);
  }

  const productIds        = new Set(cruiseProducts.map(p => p.product_id));
  const departureCityKeys = new Set(Object.keys(departureCities));
  const cruiseLineKeys    = new Set(Object.keys(cruiseLines));
  const heroVariantKeys   = new Set(Object.keys(heroVariants));
  const regionalCopyKeys  = new Set(Object.keys(regionalCopy));

  const validationSets = { productIds, departureCityKeys, cruiseLineKeys, heroVariantKeys, regionalCopyKeys };
  const fallback = buildFallbackRanking(cruiseProducts, [...departureCityKeys], [...cruiseLineKeys]);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ranking:        fallback,
      source:         'fallback_no_api_key',
      rationale:      fallback.rationale,
      trendingThemes: [],
      webSearchCalls: 0,
    };
  }

  const { system, user } = buildPrompt(cruiseProducts, departureCities, cruiseLines, heroVariants, regionalCopy);

  try {
    const { parsed, usage, model, webSearchCalls } = await callClaude({ system, user, model: modelOverride, useWebSearch });

    // Ensure product IDs are numbers
    if (parsed.saver_product_ids) parsed.saver_product_ids = parsed.saver_product_ids.map(Number);
    if (parsed.regional_product_ids) parsed.regional_product_ids = parsed.regional_product_ids.map(Number);
    if (parsed.hero_product_id != null) parsed.hero_product_id = Number(parsed.hero_product_id);

    const merged = { ...fallback, ...parsed };
    validateRanking(merged, validationSets);

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
    console.warn(`[Day2CruiseRankingService] Claude call failed → fallback. Reason: ${err.message}`);
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
  loadCruiseProducts, buildPrompt, validateRanking,
  buildFallbackRanking, callClaude,
};

export default rankTrendingCruises;
