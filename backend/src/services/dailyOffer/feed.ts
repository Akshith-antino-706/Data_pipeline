/**
 * Daily offer email — product feed reader.
 *
 * Downloads the enriched feed, checks it is today's and complete, and keeps only the
 * few fields the email needs. Nothing is written to disk or the database: the raw
 * ~50 MB response goes out of scope as soon as this function returns.
 */
import { dubaiDate } from './config.js';
import type { FeedResult, FetchFeedOptions, OfferProduct, PlanPrices } from './types.js';

/** One raw enriched-feed product row (only the fields read here). */
export interface RawFeedProduct {
  productId?: string | number | null;
  type?: string | null;
  name?: string | null;
  url?: string | null;
  image?: string | null;
  country?: string | null;
  city?: string | null;
  category?: string | null;
  price_availabilityStatus?: string | null;
  feed_rank?: number | string | null;
  country_display_order?: number | string | null;
  city_display_order?: number | string | null;
  rank_in_city?: number | string | null;
  amenity_nights?: string | null;
  listing_amenities?: string | null;
  market_prices?: Record<string, { price?: number | string | null; sale_price?: number | string | null; currency?: string } | undefined> | null;
}

/** The parsed feed response. */
export interface RawFeedBody {
  generatedAt?: string;
  marketPricesAt?: string;
  products?: RawFeedProduct[];
}

export class FeedError extends Error {
  reason: string;   // short machine code, used in logs / skip reasons
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

const PLANS = ['default', 'IN', 'SA', 'AE'];
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const txt = (v: unknown): string => (v === null || v === undefined) ? '' : String(v).trim();

/** Last path segment of a product URL, e.g. ".../visas/dubai-visa" → "dubai-visa". */
export function urlSlug(url: unknown): string {
  return txt(url).split('?')[0].replace(/\/+$/, '').split('/').pop() || '';
}

/** Card subtitle from real feed fields only (never invented text). */
function subtitleFor(p: RawFeedProduct): string {
  const type = txt(p.type);
  if (type === 'holiday') return [txt(p.amenity_nights), txt(p.city)].filter(Boolean).join(' · ');
  if (type === 'cruise') {
    const ship = txt(p.amenity_nights);              // the feed carries the ship name here for cruises
    return [txt(p.listing_amenities), ship].filter(Boolean).join(' · ');
  }
  if (type === 'activities') return [txt(p.city), txt(p.country)].filter(Boolean).join(', ');
  return '';
}

function pricesFor(mp: RawFeedProduct['market_prices']): PlanPrices {
  const out: PlanPrices = {};
  for (const plan of PLANS) {
    const row = mp && typeof mp === 'object' ? mp[plan] : null;
    if (!row) continue;
    out[plan] = { price: num(row.price), sale: num(row.sale_price) };
  }
  return out;
}

/** Feed row → the small product record the email uses. */
export function normalizeProduct(p: RawFeedProduct): OfferProduct {
  return {
    key:          `${txt(p.type)}-${txt(p.productId)}`,   // productId alone is NOT unique across types
    productId:    txt(p.productId),
    type:         txt(p.type),
    name:         txt(p.name),
    url:          txt(p.url),
    slug:         urlSlug(p.url),
    image:        txt(p.image),
    country:      txt(p.country),
    city:         txt(p.city),
    category:     txt(p.category),
    available:    txt(p.price_availabilityStatus).toLowerCase() === 'available',
    rank:         num(p.feed_rank),
    countryOrder: num(p.country_display_order),
    cityOrder:    num(p.city_display_order),
    rankInCity:   num(p.rank_in_city),
    subtitle:     subtitleFor(p),
    prices:       pricesFor(p.market_prices),
  };
}

/** True when a product has everything a card needs: name, https link, image, a real price. */
export function isUsable(prod: OfferProduct | null | undefined): boolean {
  const sale = prod?.prices?.default?.sale;
  return Boolean(
    prod && prod.available && prod.name && /^https:\/\//.test(prod.url) &&
    /^https:\/\//.test(prod.image) && sale != null && sale > 0
  );
}

/**
 * Check a parsed feed body and return normalized products.
 * Throws FeedError(reason) when the feed must not be used today.
 */
export function validateFeed(body: RawFeedBody | null | undefined, { now = new Date(), minRows = 1500 }: { now?: Date; minRows?: number } = {}): FeedResult {
  if (!body || typeof body !== 'object' || !Array.isArray(body.products)) {
    throw new FeedError('feed_invalid', 'Feed response has no products list');
  }
  const today = dubaiDate(now);
  const built = body.generatedAt ? dubaiDate(new Date(body.generatedAt)) : null;
  const priced = body.marketPricesAt ? dubaiDate(new Date(body.marketPricesAt)) : null;
  if (built !== today) {
    throw new FeedError('feed_not_today', `Feed was built on ${built || 'unknown date'}, not today (${today})`);
  }
  if (priced !== today) {
    throw new FeedError('prices_not_today', `Feed prices were updated on ${priced || 'unknown date'}, not today (${today})`);
  }
  if (body.products.length < minRows) {
    throw new FeedError('feed_too_small', `Feed has ${body.products.length} products, expected at least ${minRows}`);
  }
  const products = body.products.map(normalizeProduct);
  const broken = products.filter(p => !p.productId || !p.type || !p.name || !p.url || p.rank === null).length;
  if (broken > products.length * 0.05) {
    throw new FeedError('feed_fields_missing', `${broken} of ${products.length} products are missing id, type, name, link or rank`);
  }
  return { products, generatedAt: body.generatedAt, marketPricesAt: body.marketPricesAt };
}

/** Download + validate. `fetchImpl` is injectable for tests. */
export async function fetchFeed({ url, timeoutMs = 300000, minRows = 1500, now = new Date(), fetchImpl = fetch }: FetchFeedOptions): Promise<FeedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: RawFeedBody;
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new FeedError('feed_http_error', `Feed returned HTTP ${res.status}`);
    body = await res.json() as RawFeedBody;
  } catch (err) {
    if (err instanceof FeedError) throw err;
    const e = err as Error;
    const reason = e?.name === 'AbortError' ? 'feed_timeout' : 'feed_download_failed';
    throw new FeedError(reason, `Feed download failed: ${e?.message || String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  return validateFeed(body, { now, minRows });
}
