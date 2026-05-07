/**
 * Day4HolidaysDataService
 *
 * Builds the data shape for the Day-4 Holidays email. Anthropic returns
 * destination KEYS per theme (summer, eid, romantic, adventure). This service
 * hydrates each key by querying the `products` table (type='holiday') for the
 * latest holiday matching that destination's city/country search hints.
 *
 * Inputs:
 *   - contactId: unified_contacts.unified_id (used for UTM rid)
 *   - ranking: {
 *       summer_keys[4], eid_keys[4],
 *       romantic_keys[4], adventure_keys[4],
 *       eid_special_key (single),
 *       hero_destination_key,            // optional — defaults to summer_keys[0]
 *       hero_variant_key?
 *     }
 *
 * Output: nested object that matches the friend's datastore.json contract.
 */

import { query } from '../config/database.js';
import { filterMapByKey } from '../config/blockedDestinations.js';

// ── catalog: destinations × theme tags ────────────────────────────────────

const HOLIDAY_DESTINATIONS = filterMapByKey({
  // —— Summer / Tropical ——
  bali:           { name: 'Bali',          country: 'Indonesia',     productSearch: ['bali'],            themes: ['summer', 'romantic'] },
  phuket:         { name: 'Phuket',        country: 'Thailand',      productSearch: ['phuket'],          themes: ['summer', 'adventure'] },
  singapore_city: { name: 'Singapore',     country: 'Singapore',     productSearch: ['singapore'],       themes: ['summer'] },
  kuala_lumpur:   { name: 'Kuala Lumpur',  country: 'Malaysia',      productSearch: ['kuala lumpur'],    themes: ['summer'] },
  maldives:       { name: 'Maldives',      country: 'Maldives',      productSearch: ['maldives'],        themes: ['summer', 'romantic'] },
  bangkok:        { name: 'Bangkok',       country: 'Thailand',      productSearch: ['bangkok'],         themes: ['summer', 'adventure'] },
  hanoi:          { name: 'Hanoi',         country: 'Vietnam',       productSearch: ['hanoi'],           themes: ['summer', 'adventure'] },
  colombo:        { name: 'Colombo',       country: 'Sri Lanka',     productSearch: ['colombo'],         themes: ['summer', 'adventure'] },
  zanzibar:       { name: 'Zanzibar',      country: 'Tanzania',      productSearch: ['zanzibar'],        themes: ['summer', 'romantic'] },
  port_blair:     { name: 'Andaman',       country: 'India',         productSearch: ['port blair', 'andaman'], themes: ['summer'] },

  // —— Eid (multi-day, family / regional) ——
  dubai:          { name: 'Royal Dubai',   country: 'UAE',           productSearch: ['dubai city', 'dubai'], themes: ['eid', 'adventure'] },
  istanbul:       { name: 'Istanbul',      country: 'Turkey',        productSearch: ['istanbul'],        themes: ['eid', 'romantic'] },
  baku:           { name: 'Baku',          country: 'Azerbaijan',    productSearch: ['baku'],            themes: ['eid'] },
  tashkent:       { name: 'Samarkand',     country: 'Uzbekistan',    productSearch: ['tashkent', 'samarkand'], themes: ['eid'] },
  amman:          { name: 'Amman',         country: 'Jordan',        productSearch: ['amman'],           themes: ['eid'] },
  yerevan:        { name: 'Yerevan',       country: 'Armenia',       productSearch: ['yerevan'],         themes: ['eid'] },

  // —— Romantic (couples) ——
  tbilisi:        { name: 'Tbilisi',       country: 'Georgia',       productSearch: ['tbilisi'],         themes: ['romantic'] },
  paris:          { name: 'Paris',         country: 'France',        productSearch: ['paris'],           themes: ['romantic'] },
  rome:           { name: 'Rome',          country: 'Italy',          productSearch: ['rome'],            themes: ['romantic'] },
  vienna:         { name: 'Vienna',        country: 'Austria',       productSearch: ['vienna'],          themes: ['romantic'] },
  abu_dhabi:      { name: 'Abu Dhabi',     country: 'UAE',           productSearch: ['abu dhabi'],       themes: ['romantic'] },
  mauritius:      { name: 'Mauritius',     country: 'Mauritius',     productSearch: ['mauritius'],       themes: ['romantic', 'summer'] },
  amsterdam:      { name: 'Amsterdam',     country: 'Netherlands',   productSearch: ['amsterdam'],       themes: ['romantic'] },

  // —— Adventure ——
  almaty:         { name: 'Almaty',        country: 'Kazakhstan',    productSearch: ['almaty'],          themes: ['adventure'] },
  leh:            { name: 'Leh Ladakh',    country: 'India',         productSearch: ['leh'],             themes: ['adventure'] },
  shimla:         { name: 'Shimla',        country: 'India',         productSearch: ['shimla'],          themes: ['adventure'] },
  gangtok:        { name: 'Gangtok',       country: 'India',         productSearch: ['gangtok'],         themes: ['adventure'] },
  srinagar:       { name: 'Srinagar',      country: 'India',         productSearch: ['srinagar'],        themes: ['adventure'] },
  cape_town:      { name: 'Cape Town',     country: 'South Africa',  productSearch: ['cape town'],       themes: ['adventure'] },
  nairobi:        { name: 'Nairobi',       country: 'Kenya',         productSearch: ['nairobi'],         themes: ['adventure'] },
});

// ── ratings (same shape friend's data uses) ───────────────────────────────

const RATINGS = [
  { platform: 'Rayna Tours',  logo: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png',
    scale: '4/5',   rating: '4.5', reviews: '3,450 Reviews',  color: '#f5a623', border: '#f0e5c0', bg: '#fffdf4' },
  { platform: 'Trustpilot',   logo: 'https://cdn.trustpilot.net/brand-assets/4.3.0/logo-black.svg',
    scale: '4/5',   rating: '4.3', reviews: '52,641 Reviews', color: '#00b67a', border: '#b8e8d0', bg: '#f4fcf8' },
  { platform: 'Tripadvisor',  logo: 'https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg',
    scale: '4.5/5', rating: '4.6', reviews: '12,861 Reviews', color: '#00aa6c', border: '#b8e8d0', bg: '#f4fcf8' },
  { platform: 'Google',       logo: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
    scale: '5/5',   rating: '4.4', reviews: '1,517 Reviews',  color: '#fbbc04', border: '#f5cfc8', bg: '#fff8f6' },
];

const HERO_VARIANTS = {
  dream_holidays: {
    title:    'Dream Holidays,<br /><span style="font-style: italic">Expertly Planned.</span>',
    subtitle: 'All-inclusive packages with flights, hotel, tours and transfers - curated for every traveller, every budget, every dream.',
  },
  expertly_curated: {
    title:    'Expertly Curated<br /><span style="font-style: italic">Travel Experiences.</span>',
    subtitle: 'From sunlit beaches to mountain escapes — every package is hand-picked, every detail prepared by our travel experts.',
  },
};

const STATS = [
  { value: '25M+',  label: 'Guests served and counting' },
  { value: '1,500+', label: 'Professionals across regions' },
  { value: '1,000+', label: 'Experiences to choose from' },
  { value: '25+',   label: 'Operating companies' },
];

const CONTACT = {
  phone:      '+971 2 550 3559',
  phone_link: 'tel:+97125503559',
  email:      'info@raynatours.com',
  address:    'Abu Dhabi & Dubai, UAE',
};

const LOGO_URL    = 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png';
const FALLBACK_HERO_IMAGE = 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/ManualPackageGalleryImages/289_1_0_santorini%20greece%20new.jpg';

// ── helpers ───────────────────────────────────────────────────────────────

function withUtm(url, contactId, campaign = 'day4_holidays') {
  if (!url) return '#';
  if (!/raynatours\.com/i.test(url)) return url;
  if (/[?&]utm_source=/.test(url)) return url;
  const params = new URLSearchParams({
    utm_source:   'email',
    utm_medium:   'journey',
    utm_campaign: campaign,
  });
  if (contactId) params.set('rid', String(contactId));
  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

function formatPrice(amount, currency = 'AED') {
  if (amount == null) return `${currency} —`;
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} —`;
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Heuristic duration extraction from product name. Falls back to "Multi-Day Package". */
function deriveDuration(name) {
  const s = String(name || '');
  // "X Days / Y Nights" or "X Nights / Y Days"
  const both = s.match(/(\d+)\s*Nights?\s*\/\s*(\d+)\s*Days?/i)
            || s.match(/(\d+)\s*Days?\s*\/\s*(\d+)\s*Nights?/i);
  if (both) {
    const [, a, b] = both;
    return /night/i.test(both[0].split(/\s/)[1]) ? `${a} Nights / ${b} Days` : `${a} Days / ${b} Nights`;
  }
  const nights = s.match(/(\d+)\s*Nights?/i);
  if (nights) return `${nights[1]} Nights / ${parseInt(nights[1]) + 1} Days`;
  const days = s.match(/(\d+)\s*Days?/i);
  if (days) return `${days[1]} Days / ${Math.max(parseInt(days[1]) - 1, 1)} Nights`;
  return 'Multi-Day Package';
}

/**
 * Fetch the latest holiday product matching one of the destination's
 * search hints. Returns null if nothing found.
 */
async function fetchProductForKey(destKey) {
  const cfg = HOLIDAY_DESTINATIONS[destKey];
  if (!cfg?.productSearch?.length) return null;
  for (const term of cfg.productSearch) {
    const { rows } = await query(`
      SELECT product_id, name, type, city, country,
             sale_price, normal_price, currency, url, image_url
        FROM products
       WHERE type = 'holiday'
         AND image_url IS NOT NULL
         -- Skip rows where image_url is just a domain or has no real path.
         -- Real product images end in .jpg / .jpeg / .png / .webp.
         AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
         AND (LOWER(city) ILIKE $1 OR LOWER(country) ILIKE $1)
       ORDER BY product_id DESC
       LIMIT 1
    `, [`%${term.toLowerCase()}%`]);
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Hydrate a destination key into the card shape the renderer expects.
 * Falls back to catalog name + a generic image if no product is found.
 */
async function hydrateDestination(destKey, contactId, themeFallbackPrice = '999') {
  const cfg = HOLIDAY_DESTINATIONS[destKey];
  if (!cfg) {
    throw new Error(`[Day4HolidaysDataService] unknown destination key: ${destKey}`);
  }
  const product = await fetchProductForKey(destKey);
  if (product) {
    return {
      image:    product.image_url,
      country:  product.country || cfg.country,
      name:     product.name,
      duration: deriveDuration(product.name),
      price:    formatPrice(product.sale_price ?? product.normal_price, product.currency),
      link:     withUtm(product.url, contactId),
    };
  }
  // No product matched — emit a card with catalog fallbacks (still renders cleanly).
  console.warn(`[Day4HolidaysDataService] no product for "${destKey}" — falling back`);
  return {
    image:    FALLBACK_HERO_IMAGE,
    country:  cfg.country,
    name:     cfg.name,
    duration: 'Multi-Day Package',
    price:    `AED ${themeFallbackPrice}`,
    link:     withUtm('https://www.raynatours.com/holidays', contactId),
  };
}

function validateRanking(r) {
  if (!r || typeof r !== 'object') {
    throw new Error('[Day4HolidaysDataService] ranking must be an object');
  }
  for (const key of ['summer_keys', 'eid_keys', 'romantic_keys', 'adventure_keys']) {
    if (!Array.isArray(r[key])) throw new Error(`ranking.${key} must be an array`);
    if (r[key].length !== 4) {
      console.warn(`[Day4HolidaysDataService] ranking.${key} has ${r[key].length} items; template expects 4`);
    }
    for (const k of r[key]) {
      if (typeof k !== 'string' || !HOLIDAY_DESTINATIONS[k]) {
        throw new Error(`ranking.${key}: unknown destination key "${k}"`);
      }
    }
  }
  if (!r.eid_special_key || !HOLIDAY_DESTINATIONS[r.eid_special_key]) {
    throw new Error(`ranking.eid_special_key invalid or missing: "${r.eid_special_key}"`);
  }
  if (r.hero_variant_key && !HERO_VARIANTS[r.hero_variant_key]) {
    throw new Error(`unknown hero_variant_key: ${r.hero_variant_key}`);
  }
  if (r.hero_destination_key && !HOLIDAY_DESTINATIONS[r.hero_destination_key]) {
    throw new Error(`unknown hero_destination_key: ${r.hero_destination_key}`);
  }
}

// ── public API ────────────────────────────────────────────────────────────

export async function buildDay4HolidaysData({ contactId, ranking }) {
  validateRanking(ranking);

  const heroVariant = HERO_VARIANTS[ranking.hero_variant_key || 'dream_holidays'];

  // Hydrate cards for each section
  const [summer_escapes, eid_packages, romantic_destinations, adventure_destinations, eidSpecialProduct] = await Promise.all([
    Promise.all(ranking.summer_keys.map(k => hydrateDestination(k, contactId, '1,499'))),
    Promise.all(ranking.eid_keys.map(k => hydrateDestination(k, contactId, '4,999'))),
    Promise.all(ranking.romantic_keys.map(k => hydrateDestination(k, contactId, '2,999'))),
    Promise.all(ranking.adventure_keys.map(k => hydrateDestination(k, contactId, '1,999'))),
    fetchProductForKey(ranking.eid_special_key),
  ]);

  // Hero image — prefer a real product image for the chosen hero destination.
  const heroDestKey = ranking.hero_destination_key || ranking.summer_keys[0];
  const heroProduct = await fetchProductForKey(heroDestKey);
  const heroBgImage = ranking.hero_bg_image_override
                   || heroProduct?.image_url
                   || FALLBACK_HERO_IMAGE;

  const eidSpecialFallback = HOLIDAY_DESTINATIONS[ranking.eid_special_key];
  const eid_special_offer = {
    image:   eidSpecialProduct?.image_url || FALLBACK_HERO_IMAGE,
    heading: 'Special Eid Al Adha<br />Holiday Deals',
    text:    'Complimentary hotel upgrade and early check-in when you book any 5-night package for Eid season.',
    link:    withUtm(eidSpecialProduct?.url || `https://www.raynatours.com/holidays`, contactId),
  };

  return {
    hero: {
      background_image: heroBgImage,
      title:            heroVariant.title,
      subtitle:         heroVariant.subtitle,
    },
    summer_escapes,
    eid_packages,
    eid_special_offer,
    romantic_destinations,
    adventure_destinations,
    stats:    STATS,
    contact:  CONTACT,
    logo_url: LOGO_URL,
    ratings:  RATINGS,
  };
}

export const _internals = {
  HOLIDAY_DESTINATIONS, RATINGS, HERO_VARIANTS, STATS, CONTACT,
  LOGO_URL, FALLBACK_HERO_IMAGE,
  withUtm, formatPrice, deriveDuration, fetchProductForKey,
  hydrateDestination, validateRanking,
};

export default buildDay4HolidaysData;
