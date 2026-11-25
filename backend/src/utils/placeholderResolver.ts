/**
 * Universal placeholder resolver for GTM email templates.
 *
 * One engine, many templates: any template (per GTM event) may use ANY subset of the
 * 60 master keys from placeholder_keys_final.pdf; this fills them all from the contact,
 * the GTM event, the event's raw_payload, the ecommerce data layer, or generated/static
 * URLs. Keys are UPPER_SNAKE (e.g. {{ITEM_NAME}}). Legacy lowercase keys used by the old
 * gtm-welcome.html ({{customer_name}}, {{item_name}}, …) are aliased for back-compat.
 *
 * Source mapping mirrors the master reference:
 *   - unified_contacts  → USER_*, RID, BOOKING_STATUS, PRODUCT_TIER, CUSTOMER_SEGMENT, IS_*
 *   - gtm_events        → PAGE_URL, EVENT_TIMESTAMP, JOURNEY_ID, NODE_ID
 *   - raw_payload       → ITEM_*, CURRENCY, COUPON_CODE, UTM_*, LEAD_*, ERROR_*, etc.
 *   - ecommerce         → ADULT_COUNT, CHILD_COUNT, BOOKING_DATE, SELECTED_DATE, *_VALUE
 *   - generated/static  → CART_URL, WISHLIST_URL, RESUME_*, RETRY_*, VIEW_BOOKING_URL
 *   - ctx.affinity      → PRODUCT_AFFINITY_1..3, SERVICE_AFFINITY_1..3 (services/affinityVars.js;
 *                         callers attach it when the template uses those keys)
 */
import { signUnsubToken } from './unsubToken.js';

import type { EcomItem, EcomRoot, PlaceholderContext, PlaceholderScalar, PlaceholderValues } from '../types/utilsPlaceholder.js';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://www.raynatours.com').replace(/\/+$/, '');

// Host that actually serves /api/unsubscribe. Separate from SITE because the prod reverse proxy
// gives every non-/api path to the frontend — an unsubscribe link on SITE would 404.
const UNSUB_SITE = (process.env.PUBLIC_UNSUB_URL || 'https://promotions.raynatours.com').replace(/\/+$/, '');

// Fallback header image for WhatsApp templates that REQUIRE an `img` (header media) but the
// send has no item/contact image (e.g. a manual/no-event broadcast). Set WA_DEFAULT_IMG to a
// real, publicly-fetchable image URL — WhatsApp rejects a template whose header image is empty
// or unreachable. This default is only used when nothing better resolves.
const WA_DEFAULT_IMG = process.env.WA_DEFAULT_IMG || `${SITE}/rayna-og.jpg`;

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch as '&' | '<' | '>' | '"' | "'"]));

// Legacy / template-specific lowercase keys → canonical UPPER_SNAKE key.
// (Plain lowercase keys that already match a canonical name — e.g. destination_city,
//  coupon_code — resolve automatically via rawKey.toUpperCase(); only non-matching
//  names need an explicit alias here.)
const ALIASES: Record<string, string> = {
  customer_name: 'USER_FIRST_NAME',
  first_name:    'USER_FIRST_NAME',
  user_name:     'USER_NAME',
  // WhatsApp node payload keys (ChatHead .data record: {id, d, name, img}) → canonical.
  name:          'USER_NAME',
  d:             'USER_PHONE',
  img:           'USER_IMAGE',
  id:            'RID',
  item_name:     'ITEM_NAME',
  product_name:  'ITEM_NAME',
  service_type:  'ITEM_CATEGORY',
  item_image:    'ITEM_IMAGE_URL',
  cta_url:       'ITEM_URL',
  o_url:         'O_URL',
  '0_url':       'O_URL',   // zero-form alias — some WhatsApp templates use 0_url (zero), not o_url (letter O)
  event_name:    'EVENT_NAME',
  event_id:      'EVENT_ID',
  event_time:    'EVENT_TIMESTAMP',
  page_url:      'PAGE_URL',
  raw_payload:   'RAW_PAYLOAD',
  // Product-recommendation blocks (rec1/2/3) → the item the user triggered the event on.
  rec1_name:     'ITEM_NAME',
  rec2_name:     'ITEM_NAME',
  rec3_name:     'ITEM_NAME',
  rec1_url:      'ITEM_URL',
  rec2_url:      'ITEM_URL',
  rec3_url:      'ITEM_URL',
  rec1_now:      'ITEM_PRICE',
  rec1_price:    'ITEM_PRICE',
  rec2_price:    'ITEM_PRICE',
  rec3_price:    'ITEM_PRICE',
  rec1_image:      'ITEM_IMAGE_URL',
  rec1_image_url:  'ITEM_IMAGE_URL',
  rec2_image_url:  'ITEM_IMAGE_URL',
  rec3_image_url:  'ITEM_IMAGE_URL',
  rec1_city:     'DESTINATION_CITY',
  rec2_city:     'DESTINATION_CITY',
  rec3_city:     'DESTINATION_CITY',
  // Add-on CTA → the same service/item URL the user engaged with ("Same Service URL").
  addon_url:     'ITEM_URL',
  // unsubscribe — real link if you wire one; falls back to the template default otherwise.
  unsubscribe_url: 'UNSUBSCRIBE_URL',
};

// Per-key defaults when the resolved value is empty (otherwise → blank, never literal {{}})
const DEFAULTS: Record<string, string> = { USER_FIRST_NAME: 'there' };

// Some product/visa image URLs contain raw spaces (e.g. ".../Saudi Arabia Visa New_309/Saudi-Arabia.jpg")
// which break in email/WhatsApp unless percent-encoded. Encode spaces only (never double-encode an
// already-escaped URL). Applied to the image URL so every template/channel renders it.
const encImgUrl = (u: PlaceholderScalar): PlaceholderScalar => (u == null || u === '' ? u : String(u).replace(/ /g, '%20'));

/** Build the full {KEY: value} map for one (contact, event) pair. */
function buildValues(ctx: PlaceholderContext = {}): PlaceholderValues {
  const c  = ctx.contact || {};
  const ev = ctx.event   || {};
  const p  = ctx.payload || ev.raw_payload || {};
  const a  = ctx.affinity || {};
  const ecomRoot: EcomRoot = p.ecommerceData || p.ecommerce || {};
  const ecom: EcomItem = (Array.isArray(ecomRoot.items) && ecomRoot.items[0]) || {};

  // Strip leading honorifics ("Mr. Vaibhav Gupta" → "Vaibhav Gupta", "Mrs  Priya" → "Priya")
  // so greetings never read "Hi Mr." / "Dear Mrs.". Repeated titles are stripped too.
  const HONORIFIC_RE = /^(?:(?:mr|mrs|ms|miss|mistress|master|dr|prof|professor|sir|madam|mdm|mx|shri|smt|capt|captain|er|eng)\.?,?\s+)+/i;
  const cleanName = (n: unknown): string => String(n ?? '').trim().replace(HONORIFIC_RE, '').trim();
  const fullName  = cleanName(c.name ?? p.name);
  const firstName = fullName.split(/\s+/)[0] || '';
  const pageUrl   = ev.page_url || p.pageUrl || '';
  const orderId   = p.transactionId || '';
  const evDate    = ev.created_at ? new Date(ev.created_at) : null;
  const ts        = evDate ? (Number.isNaN(evDate.getTime()) ? '' : evDate.toLocaleString()) : (p.timestamp || '');
  const segs      = Array.isArray(c.segments) ? c.segments.join(', ') : (c.segments ?? '');

  return {
    // ── unified_contacts ──
    USER_NAME:        fullName,
    // Full name (not just the first word), with honorifics stripped — imported names often
    // lead with a title ("Mr. Vaibhav Gupta"); cleaned here so it greets "Hi Vaibhav Gupta".
    USER_FIRST_NAME:  fullName || firstName,
    USER_EMAIL:       c.email ?? p.email,
    // WhatsApp node payload carries the phone as `d` and a per-contact image as `img`
    // (ChatHead .data record shape: {id, d, name, img}). Read those alongside the
    // email sources so the same resolver serves both channels.
    USER_PHONE:       c.mobile ?? c.d ?? p.contact_number ?? p.d,
    USER_IMAGE:       c.img ?? p.img,
    USER_CITY:        c.city ?? p.city,
    USER_COUNTRY:     c.country ?? p.country,
    IS_INDIAN_USER:   c.is_indian === true || c.is_indian === 'true' ? 'Yes' : (c.is_indian === false || c.is_indian === 'false' ? 'No' : ''),
    IS_LOCAL_USER:    (c.geography === 'LOCAL') ? 'Yes' : '',
    BOOKING_STATUS:   c.booking_status,
    PRODUCT_TIER:     c.product_tier,
    CUSTOMER_SEGMENT: segs,
    RID:              c.id ?? p.id,

    // ── gtm_events ──
    PAGE_URL:        pageUrl,
    ITEM_URL:        pageUrl,
    // O_URL — first available URL across ALL sources (page → raw-payload url fields →
    // ecommerce → order/booking → site root). Never blank; used by the WhatsApp `o_url` var.
    O_URL:           pageUrl || p.itemUrl || p.item_url || p.url || p.ctaUrl || p.cta_url
                       || p.productUrl || p.product_url || p.pageUrl
                       || ecom.item_url || ecom.url
                       || (orderId ? `${SITE}/booking/${encodeURIComponent(orderId)}` : '')
                       || `${SITE}`,
    PAGE_TITLE:      p.pageTitle ?? ev.page_title,
    EVENT_TIMESTAMP: ts,
    EVENT_NAME:      ev.event_name ?? p.eventName,
    EVENT_ID:        ev.event_id ?? '',
    JOURNEY_ID:      ev.journey_id ?? p.journeyId,
    NODE_ID:         ev.node_id ?? p.nodeId,

    // ── raw_payload ──
    ITEM_NAME:       p.itemName ?? ecom.item_name,
    ITEM_ID:         p.itemId ?? ecom.item_id,
    ITEM_IMAGE_URL:  encImgUrl(p.imageUrl ?? ecom.image_url ?? p.img),
    ITEM_CATEGORY:   p.itemCategory,
    ITEM_REFERRER:   p.referrer,
    CURRENCY:        p.currency ?? ecomRoot.currency ?? ecom.currency,
    DESTINATION_CITY: p.city ?? ecom.city,
    // COUPON_CODE:     p.coupon ?? ecomRoot.coupon,
    PAYMENT_METHOD:  p.paymentType,
    ORDER_ID:        orderId,
    TAX_AMOUNT:      p.tax,
    CONTENT_TYPE:    p.contentType,
    CLICK_LOCATION:  p.clickLocation,
    SHARE_METHOD:    p.shareMethod,
    EMAIL_CLICKED:   p.emailAddress,
    PHONE_CLICKED:   p.phoneNumber,
    WHATSAPP_NUMBER_CLICKED: p.whatsappNumber,
    FORM_NAME:       p.formName,
    LEAD_SOURCE:     p.source,
    LEAD_TYPE:       p.leadType,
    LEAD_VALUE:      p.eventValue,
    PRODUCT_CONTEXT: p.productContext,
    PRODUCT_INTEREST: p.productInterest,
    ERROR_CODE:      p.errorCode,
    ERROR_MESSAGE:   p.errorMessage,
    UTM_CAMPAIGN:    p.utmCampaign,
    UTM_SOURCE:      p.utmSource,

    // ── ecommerce (raw_payload.ecommerceData.items[0], with raw_payload fallback) ──
    ADULT_COUNT:      ecom.adult_count,
    CHILD_COUNT:      ecom.children_count,
    BOOKING_DATE:     ecom.booking_date,
    SELECTED_DATE:    p.selectedDate ?? ecom.selected_date,
    // The live site feed leaves flat eventValue + ecommerceData.value null and puts the
    // real price in ecommerceData.items[0].price → fall back to it, else price renders blank.
    ITEM_PRICE:       p.eventValue ?? ecomRoot.value ?? ecom.price,
    CART_VALUE:       p.eventValue ?? ecomRoot.value ?? ecom.price,
    ORDER_TOTAL:      p.eventValue ?? ecomRoot.value ?? ecom.price,
    ORDER_VALUE:      p.eventValue ?? ecomRoot.value ?? ecom.price,
    ATTEMPTED_AMOUNT: p.eventValue ?? ecom.price,

    // ── generated / static URLs ──
    CART_URL:            `${SITE}/cart`,
    WISHLIST_URL:        `${SITE}/wishlist`,
    RESUME_CHECKOUT_URL: pageUrl || `${SITE}/checkout`,
    RESUME_PAYMENT_URL:  `${SITE}/checkout`,
    RETRY_PAYMENT_URL:   orderId ? `${SITE}/payment/retry?order=${encodeURIComponent(orderId)}` : `${SITE}/checkout`,
    VIEW_BOOKING_URL:    orderId ? `${SITE}/booking/${encodeURIComponent(orderId)}` : `${SITE}/my-bookings`,
    // Per-recipient unsubscribe. 60 html templates reference {{UNSUBSCRIBE_URL}}, and while this
    // was commented out it resolved to BLANK in every one of them — an empty href, which both
    // breaks the opt-out and reads as non-compliant bulk mail to Gmail/Yahoo.
    //   • UNSUB_SITE, not SITE: the route is mounted at /api/unsubscribe on the promotions host;
    //     SITE is www.raynatours.com, which the reverse proxy sends to the frontend instead.
    //   • Signed token, not ?uid=: a raw id is enumerable, so anyone could opt out any contact.
    UNSUBSCRIBE_URL:     c.id ? `${UNSUB_SITE}/api/unsubscribe?t=${encodeURIComponent(signUnsubToken(c.id))}`
                              : `${UNSUB_SITE}/api/unsubscribe`,

    // ── booking affinity (top booked products / business lines) ──
    // '' → undefined so Liquid's {% if PRODUCT_AFFINITY_1 %} is false for contacts without bookings.
    PRODUCT_AFFINITY_1: a.product_affinity_1 || undefined,
    PRODUCT_AFFINITY_2: a.product_affinity_2 || undefined,
    PRODUCT_AFFINITY_3: a.product_affinity_3 || undefined,
    SERVICE_AFFINITY_1: a.service_affinity_1 || undefined,
    SERVICE_AFFINITY_2: a.service_affinity_2 || undefined,
    SERVICE_AFFINITY_3: a.service_affinity_3 || undefined,

    // ── extras (used by the legacy gtm-welcome.html) ──
    RAW_PAYLOAD: JSON.stringify(p, null, 2),
  };
}

/** The values-map key a template's {{ rawKey }} resolves to (alias first, else UPPER_CASE). */
export function canonicalKey(rawKey: string): string {
  return ALIASES[rawKey] || ALIASES[rawKey.toLowerCase()] || rawKey.toUpperCase();
}

/**
 * Replace every {{KEY}} in `html` with its resolved, HTML-escaped value.
 * Unknown / empty keys → blank (never leak a literal {{KEY}}).
 */
export function renderTemplate(html: string | null | undefined, ctx: PlaceholderContext = {}, { escape = true }: { escape?: boolean } = {}): string {
  if (!html) return '';
  const values = buildValues(ctx);
  const missing = new Set<string>();
  // Matches {{ KEY }} and the Liquid-style {{ KEY | default: 'fallback' }}.
  const RE = /\{\{\s*([A-Za-z0-9_]+)\s*(?:\|\s*default\s*:\s*(['"])([\s\S]*?)\2\s*)?\}\}/g;
  const out = String(html).replace(RE, (_m: string, rawKey: string, _q: string | undefined, inlineDefault: string | undefined) => {
    const key = canonicalKey(rawKey);
    let v = values[key];
    if (v === undefined || v === null || v === '') {
      // priority: resolved value → inline {{|default:'…'}} → per-key DEFAULTS → blank
      if (inlineDefault !== undefined)      v = inlineDefault;
      else if (DEFAULTS[key] !== undefined) v = DEFAULTS[key];
      else { v = ''; if (!(key in values)) missing.add(rawKey); }
    }
    return escape ? esc(v) : String(v);
  });
  if (missing.size) console.warn(`[placeholderResolver] keys with no value/default → blank: ${[...missing].join(', ')}`);
  return out;
}

/**
 * renderTemplate for a subject line. A subject is plain text, not HTML, so values go in as
 * they are: HTML-escaping them put "&#39;" / "&amp;" into inbox subjects (D'Souza → D&#39;Souza).
 */
export function renderSubject(subject: string | null | undefined, ctx: PlaceholderContext = {}): string {
  return renderTemplate(subject, ctx, { escape: false });
}

/**
 * Same UPPER_SNAKE values map renderTemplate uses, PLUS the raw ecommerce `items[]`
 * array — so Liquid templates can `{% for item in items %}` over every cart product
 * (the regex renderTemplate only ever exposes items[0]). Affinity keys are also given
 * in lowercase ({{ product_affinity_1 }}) since Liquid is case-sensitive.
 */
export function buildLiquidVars(ctx: PlaceholderContext = {}) {
  const p = ctx.payload || ctx.event?.raw_payload || {};
  const items = Array.isArray(p.ecommerceData?.items) ? p.ecommerceData.items
              : Array.isArray(p.ecommerce?.items)     ? p.ecommerce.items : [];
  const affinity = Object.fromEntries(Object.entries(ctx.affinity || {}).filter(([, v]) => v));
  return { ...buildValues(ctx), ...affinity, items };
}

/**
 * Which `.data` columns to emit. '*' = EVERY resolved key (template-agnostic — we don't
 * know which ChatHead template needs which key; extra columns are ignored by ChatHead).
 * Can also be set to an explicit lowercase array (e.g. for million-recipient broadcasts
 * where a lean file matters). Nothing here is ever a literal {{key}} — empties are dropped.
 */
export const WA_DATA_KEYS = '*';

export const RCS_DATA_KEYS = ['item_name', 'item_price', 'destination_city', 'cta_url', 'user_first_name'];

// Events that carry a product context. Used to decide whether the item-completeness gate
// applies — SAME condition for email + WhatsApp so both channels skip/send consistently.
const ITEM_EVENTS = new Set(['view_item', 'add_to_cart', 'begin_checkout', 'add_to_wishlist', 'add_payment_info', 'purchase']);

/** Is this send product/item-based? (a real itemId OR a product event). */
export function isItemBased(eventName: string, itemId: unknown): boolean {
  const hasItem = itemId != null && String(itemId).trim() !== '' && String(itemId) !== '_noitem';
  return hasItem || ITEM_EVENTS.has(eventName);
}

/**
 * Item-completeness gate for product emails/WhatsApp. Checks the FINAL mapped values that a
 * channel actually sends — pass buildLiquidVars(ctx) for EMAIL or buildWaVars(ctx) for WhatsApp.
 * It is casing-agnostic (UPPER_SNAKE email keys OR lowercase .data keys), so each channel is
 * judged by the exact values it will render. A product message must have ALL of:
 *   item_name, item_price, item_image, currency, destination_city, and a URL.
 * Placeholder junk (NA, N/A, null, undefined, none, -) counts as EMPTY. Returns the missing
 * field labels ([] = complete). NOTE: the image is checked via item_image_url / ITEM_IMAGE_URL —
 * NOT the WhatsApp `img` key, which carries a default placeholder and would mask a missing image.
 */
export function missingItemFields(v: Record<string, unknown> = {}): string[] {
  const blank = (x: unknown): boolean => {
    const s = String(x ?? '').trim();
    return s === '' || /^(na|n\/a|null|undefined|none|-)$/i.test(s);
  };
  const pick = (...keys: string[]): unknown => { for (const k of keys) { if (!blank(v[k])) return v[k]; } return ''; };

  // Category-aware exemption: VISA products have no destination city (you apply for a
  // country's visa, there's no "city"), so a missing DESTINATION_CITY must NOT skip them.
  const category = String(pick('ITEM_CATEGORY', 'item_category', 'service_type')).toLowerCase();
  const isVisa = /visa/.test(category);

  const missing: string[] = [];
  if (blank(pick('ITEM_NAME', 'item_name')))                      missing.push('ITEM_NAME');
  if (blank(pick('ITEM_PRICE', 'item_price')))                    missing.push('ITEM_PRICE');
  if (blank(pick('ITEM_IMAGE_URL', 'item_image_url', 'item_image'))) missing.push('ITEM_IMAGE_URL');
  if (blank(pick('CURRENCY', 'currency')))                        missing.push('CURRENCY');
  if (!isVisa && blank(pick('DESTINATION_CITY', 'destination_city'))) missing.push('DESTINATION_CITY');
  if (blank(pick('ITEM_URL', 'item_url', 'PAGE_URL', 'page_url', 'cta_url'))) missing.push('URL');
  return missing;
}

// Never worth putting in the .data file (a huge JSON dump — not a template variable).
const WA_DATA_EXCLUDE = new Set(['RAW_PAYLOAD']);

/**
 * Resolve the WhatsApp/RCS `.data` variables for one (contact, event) context using the
 * SAME placeholder keys the email templates use. Builds the values map once.
 *   keys = '*'  → emit EVERY resolved value: each canonical key lowercased, PLUS every
 *                 lowercase alias (cta_url, img, product_name, rec1_name …), minus
 *                 RAW_PAYLOAD and minus empties.
 *   keys = []   → emit only those specific lowercase keys (lean mode).
 * `name` is always USER_NAME, falling back to USER_FIRST_NAME (matches the email templates).
 */
export function buildWaVars(ctx: PlaceholderContext = {}, keys: string | readonly string[] = WA_DATA_KEYS): PlaceholderValues {
  const values = buildValues(ctx);
  const out: PlaceholderValues = {};
  const put = (k: string, v: PlaceholderScalar) => { if (v != null && String(v).trim() !== '') out[k] = String(v).trim(); };

  if (keys === '*' || keys === 'all') {
    for (const [canon, v] of Object.entries(values)) {
      if (WA_DATA_EXCLUDE.has(canon)) continue;
      put(canon.toLowerCase(), v);            // e.g. ITEM_NAME → item_name, USER_CITY → user_city
    }
    for (const [alias, canon] of Object.entries(ALIASES)) {
      if (WA_DATA_EXCLUDE.has(canon)) continue;
      put(alias, values[canon]);              // e.g. cta_url, product_name, rec1_name → same value
    }
  } else {
    for (const rawKey of keys) {
      const canon = ALIASES[rawKey] || ALIASES[rawKey.toLowerCase()] || rawKey.toUpperCase();
      put(rawKey, values[canon]);
    }
  }

  // ── COMPULSORY keys: img + 0_url are ALWAYS emitted (WhatsApp templates require them) ──
  // `img` header image: USER_IMAGE (the `img` alias) → item image. Deliberately NOT defaulted
  // here: a generic value would be indistinguishable from a real one, and would stop
  // ChatHeadV1Service.buildAndSaveDataFile from substituting the TEMPLATE's own header image
  // (which looks right for that template, where a site-wide default does not). Leaving the key
  // absent is the signal "nothing resolved — use the template's". The .data file still always
  // carries `img`, because that builder fills it: template image → WA_DEFAULT_IMG.
  const _img = out.img || out.item_image || out.item_image_url || values.ITEM_IMAGE_URL;
  if (_img) out.img = _img; else delete out.img;
  // Button URL: 0_url (zero) AND o_url (letter O). The WhatsApp template's button ALREADY
  // prepends the site base (https://www.raynatours.com/), so these must be the RELATIVE PATH
  // only — otherwise the URL doubles (…/https://…). Strip the scheme+host (+leading slash).
  // Full absolute URLs stay available in item_url / cta_url / page_url for full-url buttons.
  const btnUrl = out['0_url'] || out.o_url || values.O_URL || SITE;
  const relUrl = String(btnUrl).replace(/^https?:\/\/[^/]+\/?/i, '');
  out['0_url'] = relUrl;
  out.o_url    = relUrl;
  // `item_price` — ALWAYS emit the price key so the template binding never misses it (else "NA").
  // Falls through the price aliases; empty only when the source event carried no price at all.
  out.item_price = out.item_price || out.cart_value || out.order_total || out.rec1_price || values.ITEM_PRICE || '';
  // `name` = USER_NAME || USER_FIRST_NAME (default 'there'), just like the email templates.
  put('name', values.USER_NAME || values.USER_FIRST_NAME);
  // `user_first_name` = the FULL name (USER_FIRST_NAME now resolves to c.name, not the first word) —
  // always emitted alongside `name` and all other keys.
  put('user_first_name', values.USER_FIRST_NAME || values.USER_NAME);
  return out;
}

// Off unless WA_UTM_ENABLED=true — a journey WhatsApp send then carries the same attribution
// the email click-tracker adds (emailTracking.injectClickTracking), with source=whatsapp.
const WA_UTM_ENABLED = process.env.WA_UTM_ENABLED === 'true';
const SITE_HOST = new URL(SITE).host;

/**
 * Tag every site link in a journey WhatsApp `.data` record with UTM + rid/journeyId/nodeId.
 *
 * Covers the relative button suffixes (0_url / o_url — the template prepends the site base,
 * so the query string rides on the path) and every absolute `*_url` on our own host. Image
 * URLs, the unsubscribe link and other hosts are left alone. Returns a copy; a no-op (same
 * object) when the flag is off or the record is empty (the 'without_values' data mode).
 */
export function withWaUtm(
  vars: PlaceholderValues,
  { journeyId, nodeId, unifiedId }: { journeyId?: string | number | null; nodeId?: string | null; unifiedId?: string | number | null },
): PlaceholderValues {
  if (!WA_UTM_ENABLED || !vars || !Object.keys(vars).length || journeyId == null || journeyId === '') return vars;

  const node = (nodeId || '').replace(/[^a-zA-Z0-9]+/g, '_');
  const tag = (u: URL) => {
    u.searchParams.set('utm_source', 'whatsapp');
    u.searchParams.set('utm_medium', 'journey');
    u.searchParams.set('utm_campaign', `j${journeyId}_${node}`);
    u.searchParams.set('utm_content', `journey_${journeyId}`);
    if (unifiedId != null && unifiedId !== '') u.searchParams.set('rid', String(unifiedId));
    u.searchParams.set('journeyId', String(journeyId));
    if (nodeId) u.searchParams.set('nodeId', nodeId);
  };

  const out: PlaceholderValues = { ...vars };
  for (const [k, v] of Object.entries(vars)) {
    if (v == null || !/_url$/.test(k) || /image|unsubscribe/.test(k)) continue;
    const s = String(v).trim();
    try {
      if (k === '0_url' || k === 'o_url') {
        // Relative path the button appends to the site base — tag it, then strip the base back off.
        const u = new URL(s.replace(/^\/+/, ''), `${SITE}/`);
        tag(u);
        out[k] = `${u.pathname.replace(/^\/+/, '')}${u.search}${u.hash}`;
      } else if (/^https?:\/\//i.test(s)) {
        const u = new URL(s);
        if (u.host !== SITE_HOST) continue;
        tag(u);
        out[k] = u.toString();
      }
    } catch { /* malformed URL — leave as-is */ }
  }
  return out;
}

export default { renderTemplate, buildLiquidVars, buildWaVars, withWaUtm, WA_DATA_KEYS, RCS_DATA_KEYS };
