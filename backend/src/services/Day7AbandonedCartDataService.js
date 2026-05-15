/**
 * Day7AbandonedCartDataService
 *
 * Builds the data payload for the Day-7 "you left something behind" email.
 *
 * Sourcing rules:
 *   1. Look up the user's recent view_item events in ga4_events for product
 *      ids they actually browsed. JOIN to `products` (and `visa_products`)
 *      for full card data.
 *   2. Filter blocked destinations (e.g. Dubai).
 *   3. If <4 valid items remain, fill from `ranking.fallback_ids`
 *      (Anthropic-trending picks) so the email is never empty.
 *   4. Hero copy comes from `ranking.hero_variant` (universal A/B).
 *
 * The personalisation here is just "things this user already viewed" —
 * we don't re-rank or score them. Blocklist still applies.
 */

import { query } from '../config/database.js';
import { isCityBlocked } from '../config/blockedDestinations.js';
import { truncate, CARD_LIMITS } from '../utils/textTruncate.js';
import { platformsForDay7 } from '../utils/platformRatings.js';

const LOGO = 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png';

const TRUST_PLATFORMS = platformsForDay7();

function renderTrustPlatformsGrid(platforms) {
  const cell = (item, paddingStyle) => `
    <td width="50%" valign="top" style="width: 50%; ${paddingStyle} box-sizing: border-box;">
      <div style="background-color:#ffffff; border:1px solid #e0e0e0; border-radius:6px; padding:18px 10px 16px; text-align:center;">
        <div style="font-family:'Montserrat', Arial, sans-serif; font-size:11px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color:${item.name_color}; line-height:14px; margin-bottom:8px;">${item.name}</div>
        <div style="font-size:16px; line-height:18px; margin-bottom:8px;">${item.stars_html}</div>
        <div style="font-family:'Montserrat', Arial, sans-serif; font-size:18px; font-weight:800; color:#1a1a1a; line-height:20px;">${item.score}</div>
        <div style="font-family:'Montserrat', Arial, sans-serif; font-size:10px; color:#888; line-height:14px; margin-top:3px;">${item.reviews}</div>
      </div>
    </td>`;
  let rows = '';
  for (let i = 0; i < platforms.length; i += 2) {
    const left  = platforms[i];
    const right = platforms[i + 1];
    rows += `<tr>
      ${cell(left, 'padding: 0 5px 10px 0;')}
      ${right ? cell(right, 'padding: 0 0 10px 5px;') : '<td width="50%" style="width:50%;"></td>'}
    </tr>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse;">${rows}</table>`;
}

const HERO_VARIANTS = {
  still_thinking: {
    title:    'Still thinking<br/>it over?',
    subtitle: "You browsed something great. We've saved it all here &mdash; pick up exactly where you left off and lock in your spot before it fills up.",
    cta_text: 'Resume My Booking',
  },
  almost_yours: {
    title:    'Almost<br/>yours.',
    subtitle: 'These experiences are still available &mdash; complete your booking before someone else takes the slot.',
    cta_text: 'Complete My Booking',
  },
  back_to_it: {
    title:    'Pick up where<br/>you left off.',
    subtitle: "Your saved adventures are still here &mdash; but high-demand experiences fill up fast. Don't miss out.",
    cta_text: 'Resume Browsing',
  },
};

const URGENCY_VARIANTS = {
  high_demand: { lead: 'High demand alert:', body: 'These experiences are selling fast. Prices and availability may change &mdash; secure your spot now.' },
  limited:     { lead: 'Limited availability:', body: 'Bookings for these dates close soon. Lock in your reservation today.' },
  price_lock:  { lead: 'Price lock expiring:', body: "We're holding today's price for you &mdash; complete your booking before rates refresh." },
};

const FINAL_VARIANTS = {
  one_click: {
    title:    'Your experience is<br/>one click away.',
    subtitle: 'Thousands of travellers book with Rayna Tours every day. Secure your spot before it\'s gone &mdash; your adventure is waiting.',
    cta_text: 'Complete My Booking',
  },
  dont_wait: {
    title:    "Don't wait &mdash;<br/>book today.",
    subtitle: 'Your saved itinerary is one click away. Confirm and we\'ll handle the rest.',
    cta_text: 'Confirm My Trip',
  },
};

const FOOTER_LINKS = [
  { text: 'Holidays',   url: 'https://www.raynatours.com/holidays' },
  { text: 'Cruises',    url: 'https://www.raynatours.com/cruises' },
  { text: 'Visas',      url: 'https://www.raynatours.com/visas' },
  { text: 'Activities', url: 'https://www.raynatours.com/activities' },
];

// ── helpers ───────────────────────────────────────────────────────────────

function withUtm(url, contactId, campaign = 'day7_abandoned_cart') {
  if (!url) return 'https://www.raynatours.com';
  if (!/raynatours\.com/i.test(url)) return url;
  if (/[?&]utm_source=/.test(url)) return url;
  const params = new URLSearchParams({
    utm_source: 'email', utm_medium: 'journey', utm_campaign: campaign,
  });
  if (contactId) params.set('rid', String(contactId));
  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

function formatPrice(amount) {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function categoryLabel(p) {
  const city = p.city || '';
  if (p.type === 'cruise')     return `&#128674; Cruise &middot; ${city}`;
  if (p.type === 'holiday')    return `&#127968; Holiday Package &middot; ${city}`;
  if (p.type === 'activities') return `&#127956;&#65039; Experience &middot; ${city}`;
  if (p.type === 'visa')       return `&#128205; E-Visa &middot; ${p.country_label || city}`;
  return city;
}

function priceLabel(p) {
  if (p.type === 'cruise')     return 'Cabin from';
  if (p.type === 'holiday')    return 'Package from';
  if (p.type === 'visa')       return 'Visa fee from';
  return 'From';
}

function priceSub(p) {
  if (p.type === 'cruise')  return '/ cabin';
  if (p.type === 'holiday') return '/ person';
  if (p.type === 'visa')    return '/ person';
  return '/ person';
}

function highlightsFor(p) {
  // Generic 3-bullet template per type.
  if (p.type === 'cruise') {
    return ['All-inclusive dining & entertainment', 'Curated multi-day itinerary', 'Luxury cabins at sea'];
  }
  if (p.type === 'holiday') {
    return ['Flights + Hotel + Transfers included', 'Curated daily sightseeing', 'Flexible travel dates available'];
  }
  if (p.type === 'visa') {
    return ['100% online application', 'Most nationalities eligible', 'Fast processing, instant confirmation'];
  }
  return ['Skip-the-line entry', 'Top-rated by recent travellers', 'Flexible booking & free cancellation'];
}

// ── DB lookups ────────────────────────────────────────────────────────────

async function fetchBrowsedProductIds(unifiedId, lookbackDays = 30, limit = 8) {
  if (!unifiedId) return [];
  const { rows } = await query(
    `SELECT DISTINCT ON (item_id) item_id, MAX(event_ts) AS last_seen
       FROM ga4_events
      WHERE unified_id = $1
        AND event_name = 'view_item'
        AND item_id IS NOT NULL
        AND event_ts > NOW() - ($2 || ' days')::INTERVAL
      GROUP BY item_id
      ORDER BY item_id, last_seen DESC NULLS LAST
      LIMIT $3`,
    [unifiedId, String(lookbackDays), limit]
  );
  return rows
    .map(r => Number(r.item_id))
    .filter(n => Number.isFinite(n));
}

async function fetchProductsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const { rows } = await query(
    `SELECT product_id, name, type, city, country, category,
            sale_price, normal_price, currency, url, image_url
       FROM products
      WHERE product_id = ANY($1::int[])
        AND image_url IS NOT NULL
        AND image_url ~* '\\.(jpg|jpeg|png|webp)$'`,
    [ids]
  );
  // Preserve input ordering (most-recently-viewed first)
  const byId = new Map(rows.map(r => [Number(r.product_id), r]));
  return ids.map(id => byId.get(Number(id))).filter(Boolean);
}

async function fetchVisaByKey(visaKey) {
  if (!visaKey) return null;
  const { rows: [v] } = await query(
    `SELECT key, name, country_label, types_html, details_html, status,
            image_url, default_link
       FROM visa_products
      WHERE enabled = TRUE AND key = $1`,
    [visaKey]
  );
  if (!v) return null;
  return {
    type:           'visa',
    name:           v.name,
    country_label:  v.country_label,
    image_url:      v.image_url,
    url:            v.default_link,
    sale_price:     250,
    currency:       'AED',
    city:           v.country_label || '',
  };
}

// ── card mapping ──────────────────────────────────────────────────────────

function mapToCard(p, contactId) {
  return {
    image:       p.image_url,
    category:    truncate(categoryLabel(p), CARD_LIMITS.EYEBROW),
    name:        truncate(p.name, CARD_LIMITS.TITLE),
    rating_score: p.rating_score   || null,
    rating_stars: p.rating_stars   || null,
    rating_count: p.rating_count   || null,
    highlights:  highlightsFor(p),
    price_label: truncate(priceLabel(p), CARD_LIMITS.META),
    price:       truncate(`${p.currency || 'AED'} ${formatPrice(p.sale_price ?? p.normal_price ?? 250)}`, CARD_LIMITS.PRICE),
    price_sub:   priceSub(p),
    link:        withUtm(p.url, contactId),
  };
}

function isAllowed(p) {
  if (!p) return false;
  return !isCityBlocked(p.city) && !isCityBlocked(p.country);
}

// ── public API ────────────────────────────────────────────────────────────

export async function buildDay7AbandonedCartData({ contactId, ranking = {} }) {
  // 1. User's actual browse history (filtered through blocklist)
  const browsedIds   = await fetchBrowsedProductIds(contactId);
  const browsedProds = (await fetchProductsByIds(browsedIds)).filter(isAllowed);

  // 2. Backfill from Anthropic-trending picks if needed
  const fallbackIds = Array.isArray(ranking.fallback_ids) ? ranking.fallback_ids : [];
  const usedIds     = new Set(browsedProds.map(p => p.product_id));
  const need        = Math.max(0, 4 - browsedProds.length);

  let fallbackProds = [];
  if (need > 0 && fallbackIds.length > 0) {
    const remainingIds = fallbackIds.filter(id => !usedIds.has(Number(id)));
    fallbackProds = (await fetchProductsByIds(remainingIds)).filter(isAllowed).slice(0, need);
  }

  // 3. Visa fill — if still short and ranking suggested a visa key
  let visaCard = null;
  if (browsedProds.length + fallbackProds.length < 4 && ranking.fallback_visa_key) {
    visaCard = await fetchVisaByKey(ranking.fallback_visa_key);
  }

  // 4. Assemble ordered card list (max 4)
  const ordered = [...browsedProds, ...fallbackProds];
  if (visaCard && ordered.length < 4) ordered.push(visaCard);

  const items = ordered.slice(0, 4).map(p => mapToCard(p, contactId));

  // 5. Hero / urgency / final variants — Anthropic can pick or default
  const heroVariant   = HERO_VARIANTS[ranking.hero_variant_key]       || HERO_VARIANTS.still_thinking;
  const urgencyVariant= URGENCY_VARIANTS[ranking.urgency_variant_key] || URGENCY_VARIANTS.high_demand;
  const finalVariant  = FINAL_VARIANTS[ranking.final_variant_key]     || FINAL_VARIANTS.one_click;

  // 6. Hero bg — first card image (most-recently browsed) or ranking override
  const heroBg = ranking.hero_bg_image_override
    || items[0]?.image
    || 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Dhow-Cruise-Dinner---Marina-87/1767782326362_3_2.jpg';

  // Has any items at all?
  const hasItems = items.length > 0;

  return {
    logo_url: LOGO,
    hero: {
      background_image: heroBg,
      title:            heroVariant.title,
      subtitle:         heroVariant.subtitle,
      cta_text:         heroVariant.cta_text,
      cta_link:         withUtm(items[0]?.link || 'https://www.raynatours.com', contactId),
    },
    section: {
      eyebrow:  hasItems && browsedProds.length > 0 ? 'Recently Viewed' : 'Hand-picked For You',
      title:    hasItems && browsedProds.length > 0 ? 'Your Browsed Experiences' : 'Trending Right Now',
      subtitle: hasItems && browsedProds.length > 0
        ? "These are still available &mdash; but popular items like these fill up fast. Complete your booking today."
        : "Travellers can't stop talking about these picks &mdash; book before the rates change.",
    },
    urgency: urgencyVariant,
    browsed_experiences: items,
    trust_platforms: TRUST_PLATFORMS,
    trust_platforms_html: renderTrustPlatformsGrid(TRUST_PLATFORMS),
    final: finalVariant,
    footer: {
      year:        String(new Date().getFullYear()),
      legal_text:  "You're receiving this because you recently browsed raynatours.com",
      links:       FOOTER_LINKS,
    },
  };
}

export const _internals = {
  HERO_VARIANTS, URGENCY_VARIANTS, FINAL_VARIANTS, TRUST_PLATFORMS,
  withUtm, formatPrice, categoryLabel, mapToCard,
  fetchBrowsedProductIds, fetchProductsByIds, fetchVisaByKey,
};

export default buildDay7AbandonedCartData;
