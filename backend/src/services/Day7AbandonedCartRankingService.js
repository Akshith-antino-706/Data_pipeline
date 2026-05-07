/**
 * Day7AbandonedCartRankingService
 *
 * Single Anthropic call (web_search-enabled) that picks fallback / backfill
 * products for the Day-7 abandoned-cart email. Used when the user has no
 * browse history (or fewer than 4 viewable items) — Claude finds what's
 * trending right now across activities / holidays / cruises and picks ONE
 * product_id per type (3 total) plus a visa fallback key.
 *
 * Universal picks — same fallback set for every recipient.
 */

import { query } from '../config/database.js';
import { isCityBlocked } from '../config/blockedDestinations.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const HERO_VARIANT_KEYS    = ['still_thinking', 'almost_yours', 'back_to_it'];
const URGENCY_VARIANT_KEYS = ['high_demand',    'limited',      'price_lock'];
const FINAL_VARIANT_KEYS   = ['one_click',      'dont_wait'];

// ── candidate fetch (recent, image-valid, not blocked) ────────────────────

async function fetchCandidates(type, limit = 20) {
  const { rows } = await query(
    `SELECT product_id, name, type, city, country
       FROM products
      WHERE type = $1
        AND image_url IS NOT NULL
        AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
      ORDER BY product_id DESC
      LIMIT $2`,
    [type, limit]
  );
  return rows.filter(r => !isCityBlocked(r.city) && !isCityBlocked(r.country));
}

async function fetchVisaKeys() {
  const { rows } = await query(
    `SELECT key, country_label FROM visa_products WHERE enabled = TRUE ORDER BY key`
  );
  return rows.filter(r => !isCityBlocked(r.country_label));
}

// ── prompt construction ───────────────────────────────────────────────────

function listProducts(rows) {
  if (!rows || rows.length === 0) return '  (none available)';
  return rows
    .map(p => `  - product_id=${String(p.product_id).padEnd(6)} | ${String(p.city || '').padEnd(15)} | ${p.name}`)
    .join('\n');
}

function listVisas(rows) {
  if (!rows || rows.length === 0) return '  (none available)';
  return rows.map(v => `  - "${v.key}" (${v.country_label})`).join('\n');
}

function buildPrompt({ activities, holidays, cruises, visas }) {
  const rules = `
SAFETY PRE-SCREEN — DO THIS FIRST:
  Use web_search to check news in the LAST 30 DAYS for the candidate
  destinations below. Look for: armed conflict, war, military strikes,
  "do not travel" advisories, civil unrest, terror events, airport closures,
  natural disasters disrupting tourism. EXCLUDE any destination with active
  issues. Add a "safety_notes" array (each entry ≤15 words). Empty if nothing.

YOUR JOB:
  Pick ONE product_id from each of three lists (Activities, Holidays, Cruises)
  to use as a backfill / "trending right now" pick when a user has no recent
  browse history. Also pick ONE visa key as the optional 4th card.

  These should be CURRENT trending picks for UAE/GCC travellers in 2026 —
  not personalised, the same picks apply to every recipient.

  Also pick three copy variants (hero, urgency, final CTA) that fit the
  trending-mix tone.

HOW TO PICK:
  1. Use web_search 3-4 times to find trending experiences / packages /
     cruises right now. Useful queries:
       "trending tours UAE travellers 2026"
       "best holiday packages 2026"
       "popular cruise destinations 2026"
  2. From the candidate lists, pick product_ids that match the trending
     findings. ONLY use ids that exist in the lists below.
  3. Pick variant keys from the option lists.

ACTIVITIES (pick 1 product_id):
${listProducts(activities)}

HOLIDAYS (pick 1 product_id):
${listProducts(holidays)}

CRUISES (pick 1 product_id):
${listProducts(cruises)}

VISA KEYS (pick 1 fallback_visa_key):
${listVisas(visas)}

VARIANT OPTIONS:
  hero_variant_key    : ${HERO_VARIANT_KEYS.join(' | ')}
  urgency_variant_key : ${URGENCY_VARIANT_KEYS.join(' | ')}
  final_variant_key   : ${FINAL_VARIANT_KEYS.join(' | ')}

OUTPUT CONSTRAINTS:
  - fallback_ids       : array of EXACTLY 3 ints — [activity_id, holiday_id, cruise_id]
  - fallback_visa_key  : 1 visa key from the list above
  - hero_variant_key   : 1 from options
  - urgency_variant_key: 1 from options
  - final_variant_key  : 1 from options
  - hero_bg_image_override: null (default)
  - trending_themes    : 3-5 short tags
  - rationale          : ≤40 words

Return ONLY the JSON below. No prose, no markdown fences.

JSON SCHEMA:
{
  "safety_notes":            ["<short reason>", ...],
  "trending_themes":         ["<tag>", ...],
  "rationale":               "<≤40 words>",
  "fallback_ids":            [<activity_id>, <holiday_id>, <cruise_id>],
  "fallback_visa_key":       "<key>",
  "hero_variant_key":        "<one of options>",
  "urgency_variant_key":     "<one of options>",
  "final_variant_key":       "<one of options>",
  "hero_bg_image_override":  null
}`;

  const system = `You pick fallback / trending products to feature in a Day-7 cart-abandonment email for Rayna Tours (Dubai-based travel agency). Use web_search to find what's trending right now, then map onto our actual catalog. Universal picks (not personalised). ${rules}`;
  const user   = `Use web_search to find current trending experiences / packages / cruises for UAE/GCC travellers, then return the JSON.`;
  return { system, user };
}

// ── validation ────────────────────────────────────────────────────────────

function validateRanking(r, { activities, holidays, cruises, visas }) {
  if (!r || typeof r !== 'object') throw new Error('ranking is not an object');

  if (!Array.isArray(r.fallback_ids) || r.fallback_ids.length !== 3) {
    throw new Error(`fallback_ids must be an array of length 3 (got ${(r.fallback_ids || []).length})`);
  }
  const [actId, holId, cruId] = r.fallback_ids.map(Number);
  const inPool = (id, pool) => pool.some(p => Number(p.product_id) === Number(id));

  if (!inPool(actId, activities)) throw new Error(`fallback_ids[0]=${actId} not in activities pool`);
  if (!inPool(holId, holidays))   throw new Error(`fallback_ids[1]=${holId} not in holidays pool`);
  if (!inPool(cruId, cruises))    throw new Error(`fallback_ids[2]=${cruId} not in cruises pool`);

  if (r.fallback_visa_key && !visas.some(v => v.key === r.fallback_visa_key)) {
    throw new Error(`fallback_visa_key="${r.fallback_visa_key}" not in visa pool`);
  }
  if (r.hero_variant_key && !HERO_VARIANT_KEYS.includes(r.hero_variant_key)) {
    throw new Error(`hero_variant_key="${r.hero_variant_key}" invalid`);
  }
  if (r.urgency_variant_key && !URGENCY_VARIANT_KEYS.includes(r.urgency_variant_key)) {
    throw new Error(`urgency_variant_key="${r.urgency_variant_key}" invalid`);
  }
  if (r.final_variant_key && !FINAL_VARIANT_KEYS.includes(r.final_variant_key)) {
    throw new Error(`final_variant_key="${r.final_variant_key}" invalid`);
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

function buildFallbackRanking({ activities, holidays, cruises, visas }) {
  return {
    safety_notes:           [],
    trending_themes:        [],
    rationale:              'Default ranking (Claude unavailable). Latest products per type.',
    fallback_ids: [
      activities[0]?.product_id ?? null,
      holidays[0]?.product_id   ?? null,
      cruises[0]?.product_id    ?? null,
    ].filter(Number.isFinite),
    fallback_visa_key:      visas[0]?.key || null,
    hero_variant_key:       'still_thinking',
    urgency_variant_key:    'high_demand',
    final_variant_key:      'one_click',
    hero_bg_image_override: null,
  };
}

// ── public API ────────────────────────────────────────────────────────────

export async function rankAbandonedCartFallback({ modelOverride, useWebSearch = true } = {}) {
  const [activities, holidays, cruises, visas] = await Promise.all([
    fetchCandidates('activities'),
    fetchCandidates('holiday'),
    fetchCandidates('cruise'),
    fetchVisaKeys(),
  ]);

  const fallback = buildFallbackRanking({ activities, holidays, cruises, visas });

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ranking:        fallback,
      source:         'fallback_no_api_key',
      rationale:      fallback.rationale,
      trendingThemes: [],
      safetyNotes:    [],
      webSearchCalls: 0,
      candidates:     { activities: activities.length, holidays: holidays.length, cruises: cruises.length, visas: visas.length },
    };
  }

  const { system, user } = buildPrompt({ activities, holidays, cruises, visas });

  try {
    const { parsed, usage, model, webSearchCalls } = await callClaude({ system, user, model: modelOverride, useWebSearch });
    const merged = { ...fallback, ...parsed };
    validateRanking(merged, { activities, holidays, cruises, visas });

    return {
      ranking:        merged,
      source:         'claude',
      rationale:      merged.rationale || '',
      trendingThemes: parsed.trending_themes || [],
      safetyNotes:    parsed.safety_notes    || [],
      webSearchCalls,
      model,
      usage,
      candidates:     { activities: activities.length, holidays: holidays.length, cruises: cruises.length, visas: visas.length },
    };
  } catch (err) {
    console.warn(`[Day7AbandonedCartRankingService] Claude call failed → fallback. Reason: ${err.message}`);
    return {
      ranking:        fallback,
      source:         'fallback',
      rationale:      fallback.rationale,
      trendingThemes: [],
      safetyNotes:    [],
      webSearchCalls: 0,
      error:          err.message,
      candidates:     { activities: activities.length, holidays: holidays.length, cruises: cruises.length, visas: visas.length },
    };
  }
}

export const _internals = {
  buildPrompt, validateRanking, callClaude, buildFallbackRanking,
  fetchCandidates, fetchVisaKeys,
  HERO_VARIANT_KEYS, URGENCY_VARIANT_KEYS, FINAL_VARIANT_KEYS,
};

export default rankAbandonedCartFallback;
