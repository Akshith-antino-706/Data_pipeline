/**
 * VisaRankingService
 *
 * Calls Anthropic's Claude API to rank visa products for a specific contact,
 * then returns a ranking object compatible with Day3VisaDataService.
 *
 * Pipeline:
 *   1. Load contact attributes (nationality, country, city, booking history,
 *      browsing history) from unified_contacts.
 *   2. Load enabled visa catalog from visa_products.
 *   3. Build a structured prompt: catalog + contact attrs + JSON schema.
 *   4. Call Claude (claude-sonnet-4-5) with low temperature for stable picks.
 *   5. Parse the JSON response, validate every key exists in the catalog,
 *      and that each section has the required count.
 *   6. Return the ranking. On any failure (no API key, network error, schema
 *      violation), return a deterministic fallback so the email still sends.
 *
 * Env:
 *   ANTHROPIC_API_KEY  required for live ranking; without it we return the fallback.
 *   CLAUDE_MODEL       optional override (default: 'claude-sonnet-4-5')
 *
 * Public API:
 *   rankVisasForContact({ contactId? , email? }) → { ranking, source, rationale }
 *     - source: 'claude' | 'fallback' | 'fallback_no_api_key'
 */

import { query } from '../config/database.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Required slot counts (must match the template's bake-in)
const SLOT_COUNTS = {
  international_keys: 4,
  evisa_keys:         4,
  popular_keys:       4,
};

const VARIANT_OPTIONS = {
  hero_variant_key:        ['passport', 'gateway'],
  international_copy_key:  ['abroad', 'major'],
  evisa_copy_key:          ['online', 'fast'],
  popular_copy_key:        ['also', 'trending'],
  cta_variant_key:         ['apply_today', 'ready_to_travel'],
};

// ── DB loads ──────────────────────────────────────────────────────────────

async function loadContact({ contactId, email }) {
  let where, params;
  if (contactId) {
    where  = 'unified_id = $1';
    params = [contactId];
  } else if (email) {
    where  = 'email_key = LOWER(TRIM($1))';
    params = [email];
  } else {
    return null;
  }

  const { rows: [c] } = await query(`
    SELECT unified_id, name, email, country, city,
           total_tour_bookings, total_hotel_bookings, total_visa_bookings,
           total_flight_bookings, total_booking_revenue,
           last_booking_at, ga4_countries, ga4_top_pages, contact_type
      FROM unified_contacts
     WHERE ${where} LIMIT 1
  `, params);
  return c || null;
}

async function loadVisaCatalog() {
  const { rows } = await query(`
    SELECT key, name, country_label, types_html, details_html, status,
           categories, region, sort_order
      FROM visa_products
     WHERE enabled = TRUE
     ORDER BY sort_order, key
  `);
  return rows;
}

// ── prompt construction ───────────────────────────────────────────────────

function buildPrompt(catalog) {
  // Group catalog by which sections each visa is eligible for
  const intlEligible    = catalog.filter(v => v.categories.includes('international'));
  const evisaEligible   = catalog.filter(v => v.categories.includes('evisa'));
  const popularEligible = catalog.filter(v => v.categories.includes('popular'));

  const fmt = v => `  - ${v.key.padEnd(12)} | ${v.name.padEnd(20)} | ${v.country_label || '-'} | ${v.region || '-'} | ${v.status || '-'}`;

  const catalogBlock = `
VISA CATALOG (pick keys ONLY from these lists; you cannot invent new keys):

INTERNATIONAL VISAS (sticker / embassy):
${intlEligible.map(fmt).join('\n')}

E-VISA / INSTANT VISAS:
${evisaEligible.map(fmt).join('\n')}

POPULAR DESTINATIONS (small image-only cards):
${popularEligible.map(fmt).join('\n')}`;

  const variantBlock = `
COPY VARIANT OPTIONS — pick ONE key per group:
  hero_variant_key       : ${VARIANT_OPTIONS.hero_variant_key.join(' | ')}
  international_copy_key : ${VARIANT_OPTIONS.international_copy_key.join(' | ')}
  evisa_copy_key         : ${VARIANT_OPTIONS.evisa_copy_key.join(' | ')}
  popular_copy_key       : ${VARIANT_OPTIONS.popular_copy_key.join(' | ')}
  cta_variant_key        : ${VARIANT_OPTIONS.cta_variant_key.join(' | ')}`;

  const rules = `
SAFETY PRE-SCREEN — DO THIS FIRST, BEFORE ANY OTHER SEARCH:
  Use web_search to check news in the LAST 30 DAYS for each candidate
  destination. Look for: active armed conflict, war, military strikes,
  "do not travel" advisories, civil unrest, terror events, airport / airspace
  closures, embassy closures, or natural disasters disrupting travel.
  EXCLUDE any destination with active issues. Don't promote a visa to a
  destination you cannot confidently say is currently safe and open.
  Add a "safety_notes" array with destinations excluded + reason (≤15 words).

EACH SECTION HAS A DIFFERENT JOB:

  • international_keys → "Major Embassies / Top Destinations, Trusted Approvals"
       Embassy / sticker-visa destinations that the most people are
       traveling to right now (high tourist volume, growing arrivals).

  • evisa_keys → "eVisas in Hours, Not Days"
       The most-trending e-visa destinations RIGHT NOW. Visa demand
       surges, viral destinations with online application options.

  • popular_keys → "Where Our Customers Are Flying Next"
       A DIFFERENT, complementary set — destinations to promote alongside
       the above two, NOT a repeat of them. Emerging or "also worth
       featuring" destinations beyond the headline picks above.

HOW TO PICK:
  1. Use the web_search tool 2-4 times to research what travel
     destinations are currently trending. Search the open web — news,
     travel blogs, tourism arrival numbers, visa application surges,
     viral destinations.
     Useful queries:
       "top tourist destinations 2026 by arrivals"
       "trending travel destinations 2026"
       "visa applications surge 2026"
       "where tourists are going [current year]"
       "most-searched travel countries 2026"
  2. From what you find, pick destinations with the strongest real-world
     signal (arrivals data, search trends, news coverage, growth %).
  3. Match findings to catalog KEYS. ONLY use keys from the catalog above.
     If a trending destination is NOT in our catalog, skip it — pick the
     next best catalog match. Never fabricate keys.
  4. The same picks apply to ALL customers — this is universal trending
     content, not per-user personalisation.

OUTPUT CONSTRAINTS:
  - international_keys: EXACTLY 4 unique keys from INTERNATIONAL VISAS section,
                       chosen by tourist arrival volume / current popularity.
  - evisa_keys        : EXACTLY 4 unique keys from E-VISA section, chosen by
                       current trending signal (web search results).
  - popular_keys      : EXACTLY 4 unique keys from POPULAR DESTINATIONS
                       section. THESE 4 KEYS MUST NOT APPEAR IN EITHER
                       international_keys OR evisa_keys. Pick complementary
                       destinations to feature alongside, not duplicates.
  - trending_themes   : 3-5 short tags (≤4 words each) summarising what you
                       found trending. Used internally for logging.
  - rationale         : ≤40 words plain English. Brief evidence: which
                       trends you saw and why they justify these picks.

After you have searched, return ONLY the JSON object below. No prose, no
markdown fences, no commentary.

JSON SCHEMA:
{
  "safety_notes":    ["<excluded destination — short reason>", ...],
  "trending_themes": ["<tag>", "<tag>", "<tag>"],
  "rationale": "<≤40 words>",
  "international_keys": ["<key>","<key>","<key>","<key>"],
  "evisa_keys":         ["<key>","<key>","<key>","<key>"],
  "popular_keys":       ["<key>","<key>","<key>","<key>"],
  "hero_variant_key":        "<one of options>",
  "international_copy_key":  "<one of options>",
  "evisa_copy_key":          "<one of options>",
  "popular_copy_key":        "<one of options>",
  "cta_variant_key":         "<one of options>"
}`;

  const system = `You pick visa destinations to feature in a marketing email for Rayna Tours (a Dubai-based travel agency). Your job is to identify trending visa destinations using web search, then map them onto our catalog of three distinct sections: top embassy destinations, trending e-visas, and complementary popular picks. The three sections must showcase DIFFERENT destinations — never repeat the same key across sections. The same picks apply to all customers (no per-user personalisation). ${rules}`;

  const user = `${catalogBlock}\n${variantBlock}\n\nUse web_search to find current trending visa destinations, then return the JSON.`;

  return { system, user };
}

// ── validation ────────────────────────────────────────────────────────────

function validateRanking(ranking, catalog) {
  if (!ranking || typeof ranking !== 'object') {
    throw new Error('ranking is not an object');
  }

  const keysByKey = new Map(catalog.map(v => [v.key, v]));

  // Slot count + key existence + category match
  for (const [slot, count] of Object.entries(SLOT_COUNTS)) {
    const arr = ranking[slot];
    if (!Array.isArray(arr)) throw new Error(`${slot} must be an array`);
    if (arr.length !== count) throw new Error(`${slot} has ${arr.length} keys, expected ${count}`);
    if (new Set(arr).size !== count) throw new Error(`${slot} has duplicate keys`);

    const expectedCategory =
      slot === 'international_keys' ? 'international' :
      slot === 'evisa_keys'         ? 'evisa'         :
      slot === 'popular_keys'       ? 'popular'       : null;

    for (const k of arr) {
      const row = keysByKey.get(k);
      if (!row) throw new Error(`${slot} contains unknown key: "${k}"`);
      if (expectedCategory && !row.categories.includes(expectedCategory)) {
        throw new Error(`${slot} contains "${k}" which lacks category "${expectedCategory}"`);
      }
    }
  }

  // Cross-section disjoint: a destination must NOT appear in more than one section.
  const intl = new Set(ranking.international_keys);
  const evis = new Set(ranking.evisa_keys);
  const pop  = new Set(ranking.popular_keys);
  const overlap = (a, b) => [...a].filter(k => b.has(k));

  const intlEvisa = overlap(intl, evis);
  const intlPop   = overlap(intl, pop);
  const evisaPop  = overlap(evis, pop);

  if (intlEvisa.length) throw new Error(`international_keys ∩ evisa_keys must be empty (overlap: ${intlEvisa.join(', ')})`);
  if (intlPop.length)   throw new Error(`international_keys ∩ popular_keys must be empty (overlap: ${intlPop.join(', ')})`);
  if (evisaPop.length)  throw new Error(`evisa_keys ∩ popular_keys must be empty (overlap: ${evisaPop.join(', ')})`);

  // Variant keys
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
    max_tokens:  4096,             // larger — web_search results take context space
    temperature: 0.3,              // low — we want stable, deterministic picks
    system,
    messages: [{ role: 'user', content: user }],
  };

  if (useWebSearch) {
    body.tools = [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 6,                  // 6 = 2-3 safety + 2-3 trends. Keeps cost predictable.
    }];
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

  // Response may have multiple content blocks: web_search_tool_use,
  // web_search_tool_result, and one or more text blocks. The final answer
  // is in the LAST text block.
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  const text = textBlocks.length > 0
    ? textBlocks[textBlocks.length - 1].text
    : '';
  if (!text) throw new Error('Claude returned no text content');

  // Count what happened (visibility into whether web search ran)
  const webSearchCalls = (data.content || []).filter(b => b.type === 'server_tool_use').length;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON object in response. Got: ${text.slice(0, 200)}`);

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}. Got: ${jsonMatch[0].slice(0, 200)}`);
  }

  return { parsed, usage: data.usage, model: data.model, webSearchCalls };
}

// ── deterministic fallback ────────────────────────────────────────────────

/**
 * If Claude is unavailable or returns garbage, return a sensible default.
 * Picks top-sorted keys per category, with each section DISJOINT from the
 * others (a destination never appears in more than one section).
 */
function buildFallbackRanking(catalog) {
  const used = new Set();
  const pickTopExcluding = (cat, count) => {
    const picked = [];
    for (const row of catalog) {
      if (picked.length === count) break;
      if (!row.categories.includes(cat)) continue;
      if (used.has(row.key)) continue;
      picked.push(row.key);
      used.add(row.key);
    }
    return picked;
  };

  // Order matters: international first (smallest pool), then evisa, then popular.
  const international_keys = pickTopExcluding('international', SLOT_COUNTS.international_keys);
  const evisa_keys         = pickTopExcluding('evisa',         SLOT_COUNTS.evisa_keys);
  const popular_keys       = pickTopExcluding('popular',       SLOT_COUNTS.popular_keys);

  return {
    rationale:               'Default ranking (Claude unavailable). Disjoint by category, sort_order priority.',
    international_keys,
    evisa_keys,
    popular_keys,
    hero_variant_key:        'passport',
    international_copy_key:  'abroad',
    evisa_copy_key:          'online',
    popular_copy_key:        'also',
    cta_variant_key:         'apply_today',
  };
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Rank visas based on what's TRENDING on the web right now.
 *
 * This is NOT contact-specific personalisation — the same ranking applies to
 * all recipients of the same campaign run. The picks change over time as
 * world-wide trends shift.
 *
 * @param {object} [args]
 * @param {string} [args.modelOverride]  Claude model id
 * @param {boolean} [args.useWebSearch=true]  set false to skip the web search tool
 *
 * @returns {Promise<{
 *   ranking:        object,
 *   source:         'claude' | 'fallback' | 'fallback_no_api_key',
 *   rationale:      string,
 *   trendingThemes: string[],
 *   webSearchCalls: number,
 *   model?:         string,
 *   usage?:         object,
 *   error?:         string
 * }>}
 */
export async function rankTrendingVisas({ modelOverride, useWebSearch = true } = {}) {
  const catalog = await loadVisaCatalog();

  if (catalog.length === 0) {
    throw new Error('[VisaRankingService] visa_products is empty — run migration 050');
  }

  const fallback = buildFallbackRanking(catalog);

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ranking:        fallback,
      source:         'fallback_no_api_key',
      rationale:      fallback.rationale,
      trendingThemes: [],
      webSearchCalls: 0,
    };
  }

  const { system, user } = buildPrompt(catalog);

  try {
    const { parsed, usage, model, webSearchCalls } = await callClaude({
      system, user, model: modelOverride, useWebSearch,
    });

    // Variant keys may be missing — fill with fallback defaults.
    // Strip trending_themes before validate (validateRanking doesn't know it).
    const merged = { ...fallback, ...parsed };
    validateRanking(merged, catalog);

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
    console.warn(`[VisaRankingService] Claude call failed → fallback. Reason: ${err.message}`);
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

// Backwards-compat shim — old name still works, contactId/email ignored.
export const rankVisasForContact = (args = {}) => rankTrendingVisas(args);

export const _internals = {
  loadContact, loadVisaCatalog, buildPrompt, validateRanking,
  buildFallbackRanking, callClaude,
  SLOT_COUNTS, VARIANT_OPTIONS,
};

export default rankVisasForContact;
