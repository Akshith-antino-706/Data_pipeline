/**
 * RecommendationRenderer
 *
 * Takes a set of ranked product_ids + a template body (HTML with Handlebars-ish
 * placeholders) and returns rendered HTML with the {{#products}}...{{/products}}
 * block expanded and top-level variables substituted.
 *
 * Intentionally NOT using a full Handlebars engine — the existing content
 * templates use a small, well-defined vocabulary:
 *
 *   {{customer_name}}      { {{destination}} }     {{email_heading}}
 *   {{email_body}}         {{coupon_code}}        {{coupon_discount}}
 *   {{coupon_expiry}}
 *
 *   {{#if coupon_code}} … {{/if}}                 (single conditional block)
 *   {{#products}} … {{/products}}                 (loop over products[])
 *     inside: {{product_name}} {{product_url}} {{product_image}}
 *             {{product_category}} {{product_price}} {{product_strike_price}}
 *             {{product_rating}} {{product_reviews}}
 *
 * Anything the template asks for that we don't have → substituted with '' so
 * the layout still renders cleanly.
 *
 * ADDITIVE: no touch to existing renderers (Day1WelcomeRenderer, etc.).
 */

import db from '../config/database.js';

/**
 * Load full product rows for a list of ordered product_ids and return them
 * in the SAME order as the input array. Missing ids are dropped silently.
 */
export async function hydrateProducts(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];
  const { rows } = await db.query(`
    SELECT product_id, name, category, city, country,
           image_url, url, sale_price, normal_price, page_description
    FROM products
    WHERE product_id = ANY($1::int[])
  `, [productIds.map(Number)]);

  const byId = new Map(rows.map(r => [r.product_id, r]));
  return productIds
    .map(id => byId.get(Number(id)))
    .filter(Boolean)
    .map(r => ({
      product_id:           r.product_id,
      product_name:         r.name || '',
      product_url:          r.url || 'https://www.raynatours.com',
      product_image:        r.image_url || '',
      product_category:     r.category || 'Activity',
      product_price:        r.sale_price != null ? Math.round(Number(r.sale_price)) : (r.normal_price != null ? Math.round(Number(r.normal_price)) : ''),
      product_strike_price: (r.sale_price != null && r.normal_price != null && Number(r.normal_price) > Number(r.sale_price))
        ? Math.round(Number(r.normal_price))
        : '',
      product_rating:       '4.7',   // No ratings column yet in `products` — placeholder
      product_reviews:      '',
    }));
}

/**
 * Expand the {{#products}}...{{/products}} loop.
 * The block content is repeated once per product, with per-product variable
 * substitution inside each iteration.
 */
function _expandProductsBlock(html, products) {
  const re = /\{\{#products\}\}([\s\S]*?)\{\{\/products\}\}/g;
  return html.replace(re, (_, inner) => {
    return products.map(p => _renderProductCard(inner, p)).join('');
  });
}

/**
 * Render a single product card's block, handling:
 *   - Mustache-style truthy conditionals: {{#varname}}...{{/varname}}
 *     (block is kept if varname is truthy, otherwise stripped)
 *   - Simple substitutions: {{varname}}
 *
 * Handles ANY var name — not just product_strike_price — so templates can gate
 * any card element by presence of a field (e.g. {{#promotion_badge}}...{{/promotion_badge}}).
 */
function _renderProductCard(inner, product) {
  let block = inner;

  // 1. Expand inner conditional blocks {{#field}}...{{/field}} first
  //    Any non-empty/truthy field keeps the block; otherwise strip.
  //    Regex is safe: field name is letters/underscore only.
  const condRe = /\{\{#([a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  block = block.replace(condRe, (_full, field, body) => {
    const v = product[field];
    return (v !== undefined && v !== null && v !== '') ? body : '';
  });

  // 2. Now do plain {{var}} substitutions with the product's values
  for (const [k, v] of Object.entries(product)) {
    block = block.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v ?? ''));
  }
  return block;
}

/**
 * Expand a single {{#if <var>}}…{{/if}} conditional block.
 * Kept for coupon_code (existing product-recommendation.html uses it).
 */
function _expandIfBlocks(html, vars) {
  const re = /\{\{#if\s+([a-z_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  return html.replace(re, (_, name, body) => {
    return vars[name] ? body : '';
  });
}

/**
 * Substitute top-level {{var}} placeholders that survived the block expansions.
 */
function _substitute(html, vars) {
  let out = html;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v ?? ''));
  }
  // Strip any leftover single-variable placeholders so we never ship {{foo}} to a real inbox.
  out = out.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '');
  return out;
}

/**
 * Main entry.
 *   templateHtml — raw HTML with placeholders
 *   ranking      — { productIds: [...] } from RecommendationRankingService
 *   vars         — top-level substitutions: customer_name, destination, email_heading, …
 *
 * Returns { html, productsUsed: [...hydrated products] }.
 */
export async function renderRecommendationEmail({ templateHtml, ranking, vars = {} } = {}) {
  if (!templateHtml) throw new Error('templateHtml is required');
  const productIds = ranking?.productIds || ranking?.product_ids || [];
  const products = await hydrateProducts(productIds);

  let html = _expandProductsBlock(templateHtml, products);
  html = _expandIfBlocks(html, vars);
  html = _substitute(html, vars);

  return { html, productsUsed: products };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-user send-time render (reads from user_product_recommendations)
// ═══════════════════════════════════════════════════════════════════════════
//
// Called by the worker ONLY when the journey has `recommendation_type IS NOT
// NULL`. Reads the user's cached recs, hydrates the 5 products, expands the
// {{#products}}...{{/products}} block, and substitutes top-level {{vars}}.
//
// If no cached row exists yet (e.g. cron hasn't run for a brand-new user),
// the {{#products}} block collapses to empty — email still sends, just
// without the cards. Better than blocking the send.

/**
 * Post-process an already-rendered email to inject per-user AI recommendations.
 *
 *   templateHtml         — the raw template body (may or may not contain {{#products}})
 *   unifiedId            — recipient
 *   recommendationType   — 'on_trip' | 'future_trip' | 'past_trip'
 *   vars                 — additional {{var}} substitutions (customer_name, destination, …)
 *
 * Returns { html, productsUsed, source } — same shape as renderRecommendationEmail
 * but sourced from the per-user cache instead of an in-flight Claude call.
 */
export async function injectPerUserProducts({ templateHtml, unifiedId, recommendationType, vars = {} } = {}) {
  if (!templateHtml) throw new Error('templateHtml is required');
  if (!unifiedId || !recommendationType) {
    // Safe default — collapse {{#products}} to empty, keep other vars.
    return renderRecommendationEmail({ templateHtml, ranking: { productIds: [] }, vars });
  }

  // Dynamic import to avoid circular reference at module load time.
  const { getForUser } = await import('./RecommendationRankingService.js');
  const cached = await getForUser({ unifiedId, recommendationType });

  const productIds = cached?.productIds || [];
  const enrichedVars = {
    // Pass destinationCity through automatically so templates can use {{destination}}.
    destination: vars.destination || cached?.destinationCity || '',
    ...vars,
  };

  const { html, productsUsed } = await renderRecommendationEmail({
    templateHtml,
    ranking: { productIds },
    vars: enrichedVars,
  });

  return {
    html,
    productsUsed,
    source: cached?.source || 'no_cached_row',
    fromCache: !!cached,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Send-time allowlist gate (safety mechanism for rec journeys)
// ═══════════════════════════════════════════════════════════════════════════
//
// Controlled by REC_JOURNEY_ALLOWLIST env var (comma-separated emails).
// When set → journeys with recommendation_type IS NOT NULL send ONLY to those
// emails. Everyone else → send skipped. When unset/empty → allow all (prod mode).
//
// This is INDEPENDENT of EMAIL_CAP_BYPASS_EMAILS (which controls the frequency
// cap, not delivery). Two concerns, two switches.

const REC_ALLOWLIST = new Set(
  (process.env.REC_JOURNEY_ALLOWLIST || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Should we allow this recipient to receive a rec-journey email?
 * If the allowlist is empty (env var unset), returns true (no restriction).
 * If the allowlist is set, only recipients in it return true.
 */
export function isRecipientAllowedForRec(email) {
  if (REC_ALLOWLIST.size === 0) return true; // production mode
  return !!email && REC_ALLOWLIST.has(String(email).trim().toLowerCase());
}

export default renderRecommendationEmail;
