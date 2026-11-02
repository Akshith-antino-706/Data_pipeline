/**
 * Daily offer email — per-recipient prices at send time.
 *
 * Called by the email worker ONLY when the rendered HTML carries the daily-offer marker,
 * so every other journey's send path is untouched. The market comes from the
 * recipient's mobile_country alone (India ₹, UAE AED, Saudi SAR, other → own currency,
 * empty → AED). Rendered output is cached per journey node + market, so 747k sends
 * reuse a handful of renders.
 */
import db from '../../config/database.js';
import { getRates } from '../../utils/currency.js';
import { resolveMarketByMobileCountry } from '../../utils/marketPlan.js';
import { applyMarket, renderProblems, DAILY_OFFER_MARKER } from './render.js';
import type { DailyOfferLabel, OfferMarket } from './types.js';

interface CachedRender { at: number; html: string; subject: string }

export type PersonalizedOffer =
  | { html: string; subject: string; market: OfferMarket; error?: undefined }
  | { error: string; html?: undefined; subject?: undefined; market?: undefined };

/** The node's data.dailyOffer, when it has a product snapshot (node data is untyped JSONB). */
function asLabel(v: unknown): DailyOfferLabel | null {
  if (!v || typeof v !== 'object') return null;
  const products = (v as { products?: unknown }).products;
  return Array.isArray(products) && products.length ? v as DailyOfferLabel : null;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const _cache = new Map<string, CachedRender>();   // `${journeyId}|${nodeId}|${plan}|${currency}|${checkedAt}` → { at, html, subject }

export function isDailyOfferHtml(html: unknown): html is string {
  return typeof html === 'string' && html.startsWith(DAILY_OFFER_MARKER);
}

/**
 * Returns { html, subject } for this recipient, or { error } when the email must not be
 * sent (no snapshot / unpriced products). Never returns token-bearing HTML.
 */
export async function personalizeDailyOffer({ html, subject, label: rawLabel, customerId }: {
  html: string; subject: string | null | undefined; label: unknown; customerId: number | string;
}): Promise<PersonalizedOffer> {
  const label = asLabel(rawLabel);
  if (!label) return { error: 'daily_offer_snapshot_missing' };
  const { rows: [c] } = await db.query<{ mobile_country: string | null }>('SELECT mobile_country FROM unified_contacts WHERE id = $1', [customerId]);
  const market = resolveMarketByMobileCountry(c?.mobile_country);
  const rates = await getRates();
  const key = `${label.date}|${label.loopDay}|${market.plan}|${market.currency}|${label.checkedAt || label.createdAt}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { html: hit.html, subject: hit.subject, market };

  const out = applyMarket({ html, subject }, label.products, market, rates);
  const problems = renderProblems(out);
  if (problems.length) return { error: `daily_offer_render_failed: ${problems.join(', ')}` };
  const result = { html: out.html.replace(DAILY_OFFER_MARKER, ''), subject: out.subject };
  if (_cache.size > 200) _cache.clear();
  _cache.set(key, { at: Date.now(), ...result });
  return { ...result, market };
}
