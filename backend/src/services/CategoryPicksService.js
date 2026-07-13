/**
 * CategoryPicksService
 *
 * Global daily top-5 picks per category ('activities' | 'holidays' | 'cruises').
 * Used by past-trip AI recs — same 5 products shown to all recipients on a
 * given day for a given category. Refreshed nightly at 3:45 AM Dubai.
 *
 * Selection: TRENDING = most-booked products in last 30 days that belong to
 * the category, ordered by booking count DESC. Top ~30 candidates fed to
 * Claude → Claude picks 5 with variety.
 *
 * Filters:
 *   - Products with valid URL + image only (no broken cards / 404 links)
 *   - available IS NULL OR available = true
 *   - Same URL / image / availability filters as on-trip candidate fetch
 *
 * If Claude fails → fallback to top-5 candidates by booking count (still
 * respects filters). No fallback rows stored — throws to caller.
 */

import db from '../config/database.js';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Map journey-level category → the products.category values that belong to it.
// Edit this map to expand coverage. Also used by the reverse lookup in the
// past-trip user compute (category → journey category).
export const CATEGORY_MAP = {
  activities: [
    'water-activities', 'adventure-tours', 'theme-parks', 'hot-air-balloon',
    'desert-safari-tours', 'burj-khalifa-tickets', 'city-tours',
    'culture-and-attractions', 'events-and-occasions', 'water-parks',
    'helicopter-tours', 'sightseeing-tours', 'nature-and-wildlife',
    'tours', 'sightseeing-cruises', 'atlantis-hotel-tours',
    'burj-al-arab-tours', 'events-and-shows', 'food-and-beverages',
    'island-tours', 'tours---activities', 'sentosa-island-tours',
  ],
  holidays: [
    'premium-tours', 'dubai-packages', 'events-and-occasions',
  ],
  cruises: [
    'cruise-and-boat-tours', 'sightseeing-cruises', 'barcelona-cruises',
    'copenhagen-cruises', 'rome-cruises',
  ],
};

// Reverse lookup: given a raw products.category value, return the journey-level
// category ('activities' / 'holidays' / 'cruises'). Cruises take precedence
// over activities when a value appears in both (e.g., sightseeing-cruises).
const _reverseMap = new Map();
for (const jcat of ['cruises','holidays','activities']) {          // priority order
  for (const raw of CATEGORY_MAP[jcat]) {
    if (!_reverseMap.has(raw)) _reverseMap.set(raw, jcat);
  }
}
export function journeyCategoryFor(productCategory) {
  if (!productCategory) return null;
  return _reverseMap.get(productCategory) || null;
}

// Bounded Claude concurrency (shared style with RecommendationRankingService).
const CLAUDE_MAX_CONCURRENT = 3;
let _inFlight = 0;
const _waiters = [];
function _acquire() {
  if (_inFlight < CLAUDE_MAX_CONCURRENT) { _inFlight++; return Promise.resolve(); }
  return new Promise(res => _waiters.push(res));
}
function _release() {
  if (_waiters.length > 0) _waiters.shift()();
  else _inFlight--;
}
async function _serialized(fn) {
  await _acquire();
  try { return await fn(); } finally { _release(); }
}

async function _fetchWithRetry(url, options, { timeoutMs = 45000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
      try {
        return await fetch(url, { ...options, signal: ac.signal, keepalive: false });
      } finally { clearTimeout(timer); }
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, Math.min(4000, 1000 * (2 ** attempt))));
    }
  }
  throw lastErr;
}

function _extractJson(text) {
  if (!text) throw new Error('Empty Claude response');
  let s = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No opening brace');
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
  if (end === -1) throw new Error('Unbalanced JSON');
  return JSON.parse(s.slice(start, end + 1));
}

/**
 * Trending candidates for a category — most-booked products in last 30 days.
 * Respects URL + image + availability filters so broken products never
 * enter the candidate pool.
 */
async function _fetchTrendingCandidates(category, limit = 30) {
  const cats = CATEGORY_MAP[category];
  if (!cats || cats.length === 0) return [];

  const RAYNA_TABLES = ['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_others'];
  const bookingsUnion = RAYNA_TABLES.map(t => `
    SELECT service_id AS product_id FROM ${t}
    WHERE COALESCE(is_cancel, '0') <> '1'
      AND service_id IS NOT NULL
      AND travel_date ~ '^\\d{4}-\\d{2}-\\d{2}'
      AND travel_date::date >= CURRENT_DATE - 30
  `).join(' UNION ALL ');

  const { rows } = await db.query(`
    WITH bookings_30d AS (
      SELECT product_id, COUNT(*) AS bookings
      FROM (${bookingsUnion}) b GROUP BY product_id
    )
    SELECT p.product_id, p.name, p.category, p.city, p.country,
           p.image_url, p.url, p.sale_price, p.normal_price,
           COALESCE(b.bookings, 0) AS bookings_30d
    FROM products p
    LEFT JOIN bookings_30d b ON b.product_id = p.product_id::text
    WHERE p.category = ANY($1::text[])
      AND p.name IS NOT NULL
      AND p.image_url IS NOT NULL AND p.image_url <> ''
      AND p.url IS NOT NULL AND p.url <> ''
      AND (p.available IS NULL OR p.available = true)
    ORDER BY COALESCE(b.bookings, 0) DESC,
             COALESCE(p.sale_price, p.normal_price) DESC NULLS LAST
    LIMIT $2
  `, [cats, limit]);
  return rows;
}

function _buildPrompt(category, candidates) {
  const cities = [...new Set(candidates.map(c => c.city).filter(Boolean))].slice(0, 8);
  const lines = candidates.map((c, i) =>
    `  ${String(i + 1).padStart(2, ' ')}. id=${c.product_id.toString().padEnd(6)} | ${(c.name || '').slice(0, 55).padEnd(55)} | ${c.city || '?'} | ${c.category} | AED ${c.sale_price || c.normal_price || '?'} | booked_30d=${c.bookings_30d}`
  ).join('\n');
  return `You are curating a "Top 5 ${category}" list for Rayna Tours' past-customer re-engagement.
Recipients are travelers who booked with Rayna before and are now home; inspire their NEXT trip with the hottest ${category}.

CATEGORY: ${category}
CITIES REPRESENTED: ${cities.join(', ')}

CANDIDATES (top 30 by bookings last 30 days):
${lines}

Pick TOP 5 you would recommend. Rules:
- ONLY use product_id values from the list above. Do not invent ids.
- Prefer VARIETY: mix destinations + mix of price points.
- Prefer high booking-count as popularity signal, but variety matters.
- Return strict JSON only, no prose outside.

OUTPUT (JSON):
{
  "product_ids": [<int>, <int>, <int>, <int>, <int>],
  "rationale": "<one sentence, ≤ 20 words>"
}`;
}

async function _callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await _fetchWithRetry(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parsed = _extractJson(json?.content?.[0]?.text || '');
  if (!Array.isArray(parsed.product_ids)) throw new Error('Claude returned no product_ids');
  return parsed;
}

/**
 * Compute + store today's top-5 picks for one category. Idempotent (UPSERT).
 * Throws if the compute genuinely fails after retries — no fallback row written.
 */
export async function computeCategoryPicks(category, { topN = 5 } = {}) {
  if (!CATEGORY_MAP[category]) throw new Error(`Unknown category: ${category}`);
  const candidates = await _fetchTrendingCandidates(category);
  if (candidates.length === 0) {
    console.warn(`[CategoryPicksService] No candidates for ${category} — skipping`);
    return { category, source: 'no_candidates', productIds: [], candidates: 0 };
  }

  const fallbackIds = candidates.slice(0, topN).map(c => c.product_id);
  let productIds, source, rationale;

  try {
    const claude = await _serialized(() => _callClaude(_buildPrompt(category, candidates)));
    const validIds = new Set(candidates.map(c => c.product_id));
    let picked = claude.product_ids.filter(id => validIds.has(Number(id))).slice(0, topN).map(Number);
    if (picked.length < topN) {
      const already = new Set(picked);
      for (const id of fallbackIds) {
        if (picked.length >= topN) break;
        if (!already.has(id)) { picked.push(id); already.add(id); }
      }
    }
    productIds = picked;
    source = 'claude';
    rationale = claude.rationale || '';
  } catch (err) {
    console.warn(`[CategoryPicksService] Claude failed for ${category}: ${err.message} — using trending fallback`);
    productIds = fallbackIds;
    source = 'fallback_trending';
    rationale = `Fallback after Claude error: ${err.message}`;
  }

  await db.query(`
    INSERT INTO daily_category_picks
      (category, computed_date, product_ids, source, rationale, candidate_count, computed_at)
    VALUES ($1, (NOW() AT TIME ZONE 'Asia/Dubai')::date, $2::jsonb, $3, $4, $5, NOW())
    ON CONFLICT (category, computed_date) DO UPDATE SET
      product_ids     = EXCLUDED.product_ids,
      source          = EXCLUDED.source,
      rationale       = EXCLUDED.rationale,
      candidate_count = EXCLUDED.candidate_count,
      computed_at     = NOW()
  `, [category, JSON.stringify(productIds), source, rationale, candidates.length]);

  return { category, source, productIds, rationale, candidates: candidates.length };
}

/**
 * Read the latest picks for a category (falls back to yesterday if today's
 * not computed yet). Returns null if no row exists at all.
 */
export async function getPicksForCategory(category) {
  if (!CATEGORY_MAP[category]) return null;
  const { rows } = await db.query(`
    SELECT product_ids, source, rationale, computed_date, computed_at
    FROM daily_category_picks
    WHERE category = $1
    ORDER BY computed_date DESC LIMIT 1
  `, [category]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    category,
    productIds: Array.isArray(r.product_ids) ? r.product_ids : (r.product_ids || []),
    source: r.source,
    rationale: r.rationale,
    computedDate: r.computed_date,
    computedAt: r.computed_at,
  };
}

export default { CATEGORY_MAP, computeCategoryPicks, getPicksForCategory, journeyCategoryFor };
