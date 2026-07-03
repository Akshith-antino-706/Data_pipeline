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
 */

const SITE = (process.env.PUBLIC_SITE_URL || 'https://www.raynatours.com').replace(/\/+$/, '');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Legacy / template-specific lowercase keys → canonical UPPER_SNAKE key.
// (Plain lowercase keys that already match a canonical name — e.g. destination_city,
//  coupon_code — resolve automatically via rawKey.toUpperCase(); only non-matching
//  names need an explicit alias here.)
const ALIASES = {
  customer_name: 'USER_FIRST_NAME',
  first_name:    'USER_FIRST_NAME',
  user_name:     'USER_NAME',
  item_name:     'ITEM_NAME',
  product_name:  'ITEM_NAME',
  service_type:  'ITEM_CATEGORY',
  item_image:    'ITEM_IMAGE_URL',
  cta_url:       'ITEM_URL',
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
const DEFAULTS = { USER_FIRST_NAME: 'there' };

/** Build the full {KEY: value} map for one (contact, event) pair. */
function buildValues(ctx = {}) {
  const c  = ctx.contact || {};
  const ev = ctx.event   || {};
  const p  = ctx.payload || ev.raw_payload || {};
  const ecomRoot = p.ecommerceData || p.ecommerce || {};
  const ecom = (Array.isArray(ecomRoot.items) && ecomRoot.items[0]) || {};

  const firstName = (c.name || p.name || '').toString().trim().split(/\s+/)[0] || '';
  const pageUrl   = ev.page_url || p.pageUrl || '';
  const orderId   = p.transactionId || '';
  const ts        = ev.created_at ? new Date(ev.created_at).toLocaleString() : (p.timestamp || '');
  const segs      = Array.isArray(c.segments) ? c.segments.join(', ') : (c.segments ?? '');

  return {
    // ── unified_contacts ──
    USER_NAME:        c.name ?? p.name,
    USER_FIRST_NAME:  firstName,
    USER_EMAIL:       c.email ?? p.email,
    USER_PHONE:       c.mobile ?? p.contact_number,
    USER_CITY:        c.city ?? p.city,
    USER_COUNTRY:     c.country ?? p.country,
    IS_INDIAN_USER:   c.is_indian === true || c.is_indian === 'true' ? 'Yes' : (c.is_indian === false || c.is_indian === 'false' ? 'No' : ''),
    IS_LOCAL_USER:    (c.geography === 'LOCAL') ? 'Yes' : '',
    BOOKING_STATUS:   c.booking_status,
    PRODUCT_TIER:     c.product_tier,
    CUSTOMER_SEGMENT: segs,
    RID:              c.id,

    // ── gtm_events ──
    PAGE_URL:        pageUrl,
    ITEM_URL:        pageUrl,
    PAGE_TITLE:      p.pageTitle ?? ev.page_title,
    EVENT_TIMESTAMP: ts,
    EVENT_NAME:      ev.event_name ?? p.eventName,
    EVENT_ID:        ev.event_id ?? '',
    JOURNEY_ID:      ev.journey_id ?? p.journeyId,
    NODE_ID:         ev.node_id ?? p.nodeId,

    // ── raw_payload ──
    ITEM_NAME:       p.itemName ?? ecom.item_name,
    ITEM_ID:         p.itemId ?? ecom.item_id,
    ITEM_IMAGE_URL:  p.imageUrl ?? ecom.image_url,
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
    // Per-recipient unsubscribe. The send pipeline (injectClickTracking + server) rewrites
    // this to a tracked /api/unsubscribe?log=<id> click. Without this it rendered blank.
    // UNSUBSCRIBE_URL:     c.id ? `${SITE}/unsubscribe?uid=${c.id}` : `${SITE}/unsubscribe`,

    // ── extras (used by the legacy gtm-welcome.html) ──
    RAW_PAYLOAD: JSON.stringify(p, null, 2),
  };
}

/**
 * Replace every {{KEY}} in `html` with its resolved, HTML-escaped value.
 * Unknown / empty keys → blank (never leak a literal {{KEY}}).
 */
export function renderTemplate(html, ctx = {}) {
  if (!html) return '';
  const values = buildValues(ctx);
  const missing = new Set();
  // Matches {{ KEY }} and the Liquid-style {{ KEY | default: 'fallback' }}.
  const RE = /\{\{\s*([A-Za-z0-9_]+)\s*(?:\|\s*default\s*:\s*(['"])([\s\S]*?)\2\s*)?\}\}/g;
  const out = String(html).replace(RE, (_m, rawKey, _q, inlineDefault) => {
    const key = ALIASES[rawKey] || ALIASES[rawKey.toLowerCase()] || rawKey.toUpperCase();
    let v = values[key];
    if (v === undefined || v === null || v === '') {
      // priority: resolved value → inline {{|default:'…'}} → per-key DEFAULTS → blank
      if (inlineDefault !== undefined)      v = inlineDefault;
      else if (DEFAULTS[key] !== undefined) v = DEFAULTS[key];
      else { v = ''; if (!(key in values)) missing.add(rawKey); }
    }
    return esc(v);
  });
  if (missing.size) console.warn(`[placeholderResolver] keys with no value/default → blank: ${[...missing].join(', ')}`);
  return out;
}

/**
 * Same UPPER_SNAKE values map renderTemplate uses, PLUS the raw ecommerce `items[]`
 * array — so Liquid templates can `{% for item in items %}` over every cart product
 * (the regex renderTemplate only ever exposes items[0]).
 */
export function buildLiquidVars(ctx = {}) {
  const p = ctx.payload || ctx.event?.raw_payload || {};
  const items = Array.isArray(p.ecommerceData?.items) ? p.ecommerceData.items
              : Array.isArray(p.ecommerce?.items)     ? p.ecommerce.items : [];
  return { ...buildValues(ctx), items };
}

export default { renderTemplate, buildLiquidVars };
