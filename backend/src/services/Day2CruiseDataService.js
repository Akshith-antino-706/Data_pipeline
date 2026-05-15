/**
 * Day2CruiseDataService
 *
 * Builds the data.json payload that the day2-cruise renderer (template.html
 * + generate-email.js) consumes. The shape is locked to that renderer's
 * expectations — see backend/scripts/lib/day2_cruise_data_shape.md for the
 * contract.
 *
 * Inputs:
 *   - contactId: unified_contacts.unified_id (used for UTM rid)
 *   - ranking:   the structured object Anthropic returns (lean IDs only).
 *                Required keys + counts:
 *                  saver_product_ids          (3)   → products WHERE id IN (...)
 *                  regional_product_ids       (4)   → products WHERE id IN (...)
 *                  cruise_line_keys           (4)   → CRUISE_LINES config map
 *                  departure_city_keys        (5)   → DEPARTURE_CITIES config map
 *                  hero_variant_key           (1)   → HERO_VARIANTS map
 *                  regional_copy_variant_key  (1)   → REGIONAL_COPY map
 *
 * Output: nested object matching mail_templates/day2-cruise/data.json shape.
 *
 * Where each field comes from:
 *   - hero copy / regional copy → in-file config maps (HERO_VARIANTS, REGIONAL_COPY)
 *     Anthropic picks the variant key, this service resolves to copy.
 *   - departure_cities / cruise_lines → in-file config maps. Anthropic ranks
 *     by key, this service hydrates labels + flag URLs.
 *   - saver_packages, regional_cruises.items → SELECT from products table.
 *     Bullet description and region/season tags are DERIVED from name/category
 *     since `products` lacks curated marketing copy. To upgrade later: add
 *     `products.marketing_description` and `products.season_tag` columns and
 *     prefer them when present.
 *   - All link URLs get UTM params + recipient id stamped at the end.
 */

import { query } from '../config/database.js';
import { filterMapByKey } from '../config/blockedDestinations.js';
import { truncate, CARD_LIMITS } from '../utils/textTruncate.js';
import { platformsForDay2 } from '../utils/platformRatings.js';

// ── config maps ───────────────────────────────────────────────────────────

const DEPARTURE_CITIES = filterMapByKey({
  abu_dhabi: {
    name: 'Abu Dhabi', sub_text: 'Cruise from UAE',
    flag_url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1e6-1f1ea.png',
    flag_alt: 'UAE Flag',
    default_link: 'https://www.raynatours.com/cruises',
  },
  dubai: {
    name: 'Dubai', sub_text: 'Cruise from UAE',
    flag_url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1e6-1f1ea.png',
    flag_alt: 'UAE Flag',
    default_link: 'https://www.raynatours.com/dubai-cruises/aroya-gulf-to-red-sea-passage-cruise-488',
  },
  saudi_arabia: {
    name: 'Saudi Arabia', sub_text: 'Red Sea Cruises',
    flag_url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f8-1f1e6.png',
    flag_alt: 'Saudi Arabia Flag',
    default_link: 'https://www.raynatours.com/jeddah-cruises/aroya-saudi-red-sea-cruise-487',
  },
  singapore: {
    name: 'Singapore', sub_text: 'Asia Pacific Cruises',
    flag_url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f1f8-1f1ec.png',
    flag_alt: 'Singapore Flag',
    default_link: 'https://www.raynatours.com/cruises',
  },
  europe: {
    name: 'Europe', sub_text: 'Mediterranean &amp; Northern Cruises',
    flag_url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f30e.png',
    flag_alt: 'Europe Icon',
    default_link: 'https://www.raynatours.com/cruises',
  },
});

const CRUISE_LINES = {
  msc: {
    name: 'MSC Cruises',
    destinations: 'Mediterranean &middot; Caribbean &middot; Asia',
    image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Cruise/CruisePackageImages/Final/391/1771963374791_S.jpg',
    default_link: 'https://www.raynatours.com/cruises',
  },
  costa: {
    name: 'Costa Cruises',
    destinations: 'Mediterranean &middot; Northern Europe',
    image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Cruise/CruisePackageImages/Final/7Nights-%7C-BCN-%7C-Costa-Smeralda-392/1762238087109_S.jpg',
    default_link: 'https://www.raynatours.com/cruises',
  },
  royal_caribbean: {
    name: 'Royal Caribbean',
    destinations: 'Caribbean &middot; Asia &middot; Mediterranean',
    image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Cruise/CruisePackageImages/Final/440/1766729090298_S.jpg',
    default_link: 'https://www.raynatours.com/cruises',
  },
  genting_dreams: {
    name: 'Genting Dreams',
    destinations: 'Asia &middot; Singapore &middot; Phuket',
    image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Cruise/CruisePackageImages/Final/Genting-dream_-Singapore---high-seas---Singapore-416/1765347946312_S.jpg',
    default_link: 'https://www.raynatours.com/cruises',
  },
  norwegian: {
    name: 'Norwegian Cruise Line',
    destinations: 'Mediterranean &middot; Caribbean &middot; Northern Europe',
    image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Cruise/CruisePackageImages/Final/391/1771963374791_S.jpg',
    default_link: 'https://www.raynatours.com/cruises',
  },
  disney: {
    name: 'Disney Cruise Line',
    destinations: 'Mediterranean &middot; Caribbean',
    image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Cruise/CruisePackageImages/Final/391/1771963374791_S.jpg',
    default_link: 'https://www.raynatours.com/cruises',
  },
};

const HERO_VARIANTS = {
  horizon: {
    title: 'The World<br />is Your<br /><strong style="font-weight: 700">Horizon.</strong>',
    description: 'From the Red Sea to the Mediterranean, discover curated cruise journeys that redefine luxury at sea. Your voyage begins here.',
    bg_image: 'https://images.pexels.com/photos/1430677/pexels-photo-1430677.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  seven_seas: {
    title: 'Unforgettable Journeys<br />Across the<br /><strong style="font-weight: 700">Seven Seas.</strong>',
    description: 'From the Red Sea to the Mediterranean, discover curated cruise journeys that redefine luxury at sea. Your voyage begins here.',
    bg_image: 'https://images.pexels.com/photos/1430677/pexels-photo-1430677.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
  asia_calling: {
    title: 'Sail Through<br /><strong style="font-weight: 700">Asia\'s Coast.</strong>',
    description: 'Singapore, Phuket, the Andaman Sea — discover the cruises that connect the most beloved ports of Asia.',
    bg_image: 'https://images.pexels.com/photos/1430677/pexels-photo-1430677.jpeg?auto=compress&cs=tinysrgb&w=1280',
  },
};

const REGIONAL_COPY = {
  mediterranean: {
    section_subtitle: 'The Blue Heart Of Europe',
    section_title:    'Explore Mediterranean Cruises',
  },
  northern_europe: {
    section_subtitle: 'Fjords And Northern Lights',
    section_title:    'Explore Northern Europe Cruises',
  },
  asia_pacific: {
    section_subtitle: 'Tropical Coasts &amp; Island Stops',
    section_title:    'Explore Asia Pacific Cruises',
  },
  red_sea: {
    section_subtitle: 'Pristine Coasts &amp; Ancient Ports',
    section_title:    'Explore Red Sea Cruises',
  },
};

// Maps category slug → small uppercase eyebrow ("region" in the data.json saver shape)
const CATEGORY_TO_REGION_LABEL = {
  'jeddah-cruises':         'Saudi Red Sea',
  'dubai-cruises':          'UAE Coast',
  'singapore-city-cruises': 'Singapore',
  'barcelona-cruises':      'Western Mediterranean',
  'rome-cruises':           'Italian Coast',
  'copenhagen-cruises':     'Northern Europe',
  'kiel-cruises':           'Northern Europe',
  'hamburg-cruises':        'Northern Europe',
  'southampton-cruises':    'British Isles',
  'istanbul-cruises':       'Eastern Mediterranean',
  'valencia-cruises':       'Western Mediterranean',
  'savona-cruises':         'Italian Coast',
  'genoa-cruises':          'Italian Coast',
  'venice-cruises':         'Adriatic',
  'cannes-cruises':         'French Riviera',
  'naples-cruises':         'Italian Coast',
  'shanghai-cruises':       'Far East Asia',
  'tokyo-cruises':          'Far East Asia',
  'mumbai-cruises':         'Indian Coast',
  'goa-cruises':            'Indian Coast',
  'kochi-cruises':          'Indian Coast',
  'orlando-cruises':        'Caribbean',
  'mexico-cruises':         'Caribbean',
  'reykjavik-cruises':      'Northern Atlantic',
  'sardinia-cruises':       'Italian Coast',
  'messina-cruises':        'Italian Coast',
  'valletta-cruises':       'Mediterranean',
  'provence-cruises':       'French Riviera',
};

// ── helpers ───────────────────────────────────────────────────────────────

/** Format AED 1,448 from a numeric sale_price + currency. */
function formatPrice(amount, currency = 'AED') {
  if (amount == null) return `${currency} —`;
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currency} —`;
  return `${currency} ${n.toLocaleString('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })}`;
}

/** Best-effort eyebrow tag for the saver card. */
function deriveRegionLabel(product) {
  return CATEGORY_TO_REGION_LABEL[product.category] || titleCase(product.city || 'Featured');
}

/** Best-effort small tag for regional cards (e.g. "Spring", "7 Nights", "Featured"). */
function deriveSeasonTag(product) {
  const name = String(product.name || '');

  // Look for an explicit night/day count first
  const m = name.match(/(\d+)\s*(?:Night|Nights|Day|Days)/i);
  if (m) return `${m[1]} ${m[1] === '1' ? 'Night' : 'Nights'}`;

  // Look for a season word
  const seasons = ['Spring', 'Summer', 'Autumn', 'Fall', 'Winter'];
  for (const s of seasons) {
    if (new RegExp(`\\b${s}\\b`, 'i').test(name)) return s;
  }

  // Look for keywords
  if (/Roundtrip|Round\s*Trip/i.test(name)) return 'Round Trip';
  if (/Discovery|Explore/i.test(name))      return 'Discovery';
  if (/Escape/i.test(name))                  return 'Escape';

  return 'Featured';
}

/**
 * Build the bullet description shown under the saver title or regional title.
 * Format: `${City} Departure | ${duration text}<br />${a couple of perks}`
 *
 * Until the products table has curated copy, this is templated. Marketers can
 * override later via a `products.marketing_description` column.
 */
function deriveBulletDescription(product) {
  const city  = product.city || 'Premium Port';
  const tag   = deriveSeasonTag(product);
  const isCounted = /^\d+\s+Night/.test(tag); // e.g. "7 Nights"
  const left   = `${city} Departure | ${isCounted ? tag : 'Multiple Nights'}`;
  const right  = isCounted
    ? 'All-Inclusive | Premium Onboard'
    : `${tag} | All-Inclusive Onboard`;
  return `${left}<br />${right}`;
}

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Append UTM params + recipient id to a Rayna URL. Leaves non-Rayna URLs alone.
 * Mirrors the rules in EmailRenderer.injectUTMLinks.
 */
function withUtm(url, contactId, campaign = 'day2_cruise') {
  if (!url) return '#';
  if (!/raynatours\.com/i.test(url)) return url;
  if (/[?&]utm_source=/.test(url))   return url;

  const params = new URLSearchParams({
    utm_source:   'email',
    utm_medium:   'journey',
    utm_campaign: campaign,
  });
  if (contactId) params.set('rid', String(contactId));

  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

/** Restore the input ID order — ANY($1) does not preserve it. */
function orderRowsByIds(rows, ids, idCol = 'product_id') {
  const byId = new Map(rows.map(r => [r[idCol], r]));
  return ids.map(id => byId.get(Number(id))).filter(Boolean);
}

/** Validate ranking input; throw with a clear message on first problem. */
function validateRanking(r) {
  if (!r || typeof r !== 'object') {
    throw new Error('[Day2CruiseDataService] ranking must be an object');
  }
  const expect = (key, kind, count) => {
    const v = r[key];
    if (!Array.isArray(v)) throw new Error(`[Day2CruiseDataService] ranking.${key} must be an array`);
    if (v.length === 0)    throw new Error(`[Day2CruiseDataService] ranking.${key} is empty`);
    if (count && v.length !== count) {
      // Soft warn rather than throw — renderer can still cope with N items
      console.warn(`[Day2CruiseDataService] ranking.${key} has ${v.length} items; template expects ${count}`);
    }
    if (kind === 'int') {
      for (const x of v) if (!Number.isFinite(Number(x))) {
        throw new Error(`[Day2CruiseDataService] ranking.${key} contains non-numeric id: ${x}`);
      }
    } else {
      for (const x of v) if (typeof x !== 'string' || !x.trim()) {
        throw new Error(`[Day2CruiseDataService] ranking.${key} contains non-string key: ${x}`);
      }
    }
  };
  expect('saver_product_ids',     'int',    3);
  expect('regional_product_ids',  'int',    4);
  expect('cruise_line_keys',      'string', 4);
  expect('departure_city_keys',   'string', 5);

  // hero_product_id is OPTIONAL. When provided, must be numeric and SHOULD be
  // one of the saver/regional ids (so the catalog query already loads it).
  if (r.hero_product_id != null) {
    if (!Number.isFinite(Number(r.hero_product_id))) {
      throw new Error(`[Day2CruiseDataService] hero_product_id must be numeric: ${r.hero_product_id}`);
    }
  }

  if (r.hero_variant_key && !HERO_VARIANTS[r.hero_variant_key]) {
    throw new Error(`[Day2CruiseDataService] unknown hero_variant_key: ${r.hero_variant_key}`);
  }
  if (r.regional_copy_variant_key && !REGIONAL_COPY[r.regional_copy_variant_key]) {
    throw new Error(`[Day2CruiseDataService] unknown regional_copy_variant_key: ${r.regional_copy_variant_key}`);
  }
  for (const k of r.cruise_line_keys || []) {
    if (!CRUISE_LINES[k]) throw new Error(`[Day2CruiseDataService] unknown cruise_line_key: ${k}`);
  }
  for (const k of r.departure_city_keys || []) {
    if (!DEPARTURE_CITIES[k]) throw new Error(`[Day2CruiseDataService] unknown departure_city_key: ${k}`);
  }
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * Hydrate Anthropic's ranking into the data.json shape consumed by
 * generate-email.js. See file header for input/output contract.
 */
export async function buildDay2CruiseData({ contactId, ranking }) {
  validateRanking(ranking);

  const heroKey      = ranking.hero_variant_key          || 'horizon';
  const regionalKey  = ranking.regional_copy_variant_key || 'mediterranean';

  // Hydrate cruise items in one query (savers + regional + optional hero).
  const heroProductId = ranking.hero_product_id != null ? Number(ranking.hero_product_id) : null;
  const allCruiseIds = [
    ...ranking.saver_product_ids.map(Number),
    ...ranking.regional_product_ids.map(Number),
    ...(heroProductId != null ? [heroProductId] : []),
  ];
  const { rows: cruiseRows } = await query(
    `SELECT product_id, name, category, city, country,
            sale_price, normal_price, currency, url, image_url
       FROM products
      WHERE type = 'cruise' AND product_id = ANY($1::int[])`,
    [allCruiseIds]
  );

  const savers   = orderRowsByIds(cruiseRows, ranking.saver_product_ids);
  const regional = orderRowsByIds(cruiseRows, ranking.regional_product_ids);

  // Surface missing IDs loudly — better to fail than ship broken cards.
  if (savers.length !== ranking.saver_product_ids.length) {
    const missing = ranking.saver_product_ids.filter(
      id => !cruiseRows.some(r => r.product_id === Number(id))
    );
    throw new Error(`[Day2CruiseDataService] saver_product_ids not found: ${missing.join(', ')}`);
  }
  if (regional.length !== ranking.regional_product_ids.length) {
    const missing = ranking.regional_product_ids.filter(
      id => !cruiseRows.some(r => r.product_id === Number(id))
    );
    throw new Error(`[Day2CruiseDataService] regional_product_ids not found: ${missing.join(', ')}`);
  }

  // ── shape the response ───────────────────────────────────────────────
  const hero         = HERO_VARIANTS[heroKey];
  const regionalCopy = REGIONAL_COPY[regionalKey];

  const departure_cities = ranking.departure_city_keys.map((key, i, arr) => {
    const cfg = DEPARTURE_CITIES[key];
    const node = {
      name:     cfg.name,
      sub_text: cfg.sub_text,
      flag_url: cfg.flag_url,
      flag_alt: cfg.flag_alt,
      link:     withUtm(cfg.default_link, contactId),
    };
    // Last card spans both columns when the count is odd.
    if (i === arr.length - 1 && arr.length % 2 === 1) {
      node.is_full_width = true;
    }
    return node;
  });

  const saver_packages = savers.map(p => ({
    region:      truncate(deriveRegionLabel(p), CARD_LIMITS.EYEBROW),
    title:       truncate(p.name, CARD_LIMITS.TITLE),
    description: truncate(deriveBulletDescription(p), CARD_LIMITS.DESC),
    image:       p.image_url,
    price:       truncate(formatPrice(p.sale_price, p.currency), CARD_LIMITS.PRICE),
    link:        withUtm(p.url, contactId),
  }));

  const regional_cruises = {
    section_subtitle: regionalCopy.section_subtitle,
    section_title:    regionalCopy.section_title,
    items: regional.map(p => ({
      tag:         truncate(deriveSeasonTag(p), CARD_LIMITS.EYEBROW),
      title:       truncate(p.name, CARD_LIMITS.TITLE),
      description: truncate(deriveBulletDescription(p), CARD_LIMITS.DESC),
      image:       p.image_url,
      link:        withUtm(p.url, contactId),
    })),
  };

  const cruise_lines = ranking.cruise_line_keys.map(key => {
    const cfg = CRUISE_LINES[key];
    return {
      name:         cfg.name,
      destinations: cfg.destinations,
      image:        cfg.image_url,
      link:         withUtm(cfg.default_link, contactId),
    };
  });

  // Hero background: prefer the picked product image when one is set;
  // fall back to the variant's default. Missing product → variant default
  // (logged so it's debuggable but not a hard failure).
  let heroBgImage = hero.bg_image;
  if (heroProductId != null) {
    const heroProduct = cruiseRows.find(r => r.product_id === heroProductId);
    if (heroProduct?.image_url) {
      heroBgImage = heroProduct.image_url;
    } else {
      console.warn(`[Day2CruiseDataService] hero_product_id ${heroProductId} not found or has no image; using variant default`);
    }
  }

  return {
    hero: {
      title:         hero.title,
      description:   hero.description,
      bg_image:      heroBgImage,
      explore_link:  withUtm('https://www.raynatours.com/cruises', contactId),
      view_all_link: withUtm('https://www.raynatours.com/cruises', contactId),
    },
    departure_cities,
    saver_packages,
    regional_cruises,
    cruise_lines,
    ratings: RATINGS,
  };
}

const RATINGS = { platforms: platformsForDay2() };

// Exports for testing / extension
export const _internals = {
  DEPARTURE_CITIES, CRUISE_LINES, HERO_VARIANTS, REGIONAL_COPY,
  CATEGORY_TO_REGION_LABEL, formatPrice, deriveRegionLabel,
  deriveSeasonTag, deriveBulletDescription, withUtm, orderRowsByIds,
};

export default buildDay2CruiseData;
