/**
 * Day6DestinationDataService
 *
 * Builds the data payload for the destination-spotlight email. ONE
 * destination per send (Singapore / Bangkok / Phuket / etc.). Hydrates 3
 * product sections (holidays / things to do / cruises) by querying the
 * `products` table for that destination's city, plus the visa section by
 * looking up the corresponding row in `visa_products`.
 *
 * Inputs:
 *   - contactId        : unified_contacts.unified_id (UTM rid)
 *   - destinationKey   : key in DESTINATION_CATALOG (e.g. 'singapore')
 *   - ranking          : optional Anthropic output (product_ids per section,
 *                        tagline_variant_key, etc.). When absent we just take
 *                        the latest products for the destination.
 *
 * Output: nested object that matches the friend's data.json contract.
 */

import { query } from '../config/database.js';
import { isKeyBlocked } from '../config/blockedDestinations.js';
import { truncate, CARD_LIMITS } from '../utils/textTruncate.js';
import { platformsForDay6 } from '../utils/platformRatings.js';

// ── catalog: destinations we can spotlight ────────────────────────────────

const DESTINATION_CATALOG = {
  singapore: {
    name:           'Singapore',
    country:        'Singapore',
    productCity:    ['singapore', 'singapore city'], // matches LOWER(products.city) — DB uses both forms
    cruiseCategory: 'singapore-city-cruises',
    visaKey:        'singapore',           // visa_products.key
    heroImage:      'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/23726/singapore-city.png',
    flagHtml:       '&#127480;&#127468;',  // 🇸🇬
    titleSplit:     { title: 'Singapore,', subtitle: 'Your Way.' },
    taglines:       ['The Lion City Awaits', 'East Meets West', 'Where Futures Begin'],
    holidayPagePath:'/singapore-packages',
    activitiesPath: '/singapore-activities',
  },
  bangkok: {
    name:           'Bangkok',
    country:        'Thailand',
    productCity:    ['bangkok'],
    cruiseCategory: 'bangkok-cruises',
    visaKey:        'thailand',
    heroImage:      'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/16424/bangkok-city.jpg',
    flagHtml:       '&#127481;&#127469;',
    titleSplit:     { title: 'Bangkok,', subtitle: 'Unfiltered.' },
    taglines:       ['City of Angels', 'Where Tradition Meets Skyline', 'The Heart of Thailand'],
    holidayPagePath:'/bangkok-packages',
    activitiesPath: '/bangkok-activities',
  },
  phuket: {
    name:           'Phuket',
    country:        'Thailand',
    productCity:    ['phuket'],
    cruiseCategory: 'phuket-cruises',
    visaKey:        'thailand',
    heroImage:      'https://images.pexels.com/photos/1007657/pexels-photo-1007657.jpeg?auto=compress&cs=tinysrgb&w=1200',
    flagHtml:       '&#127481;&#127469;',
    titleSplit:     { title: 'Phuket,', subtitle: 'Pure Paradise.' },
    taglines:       ['Pearl of the Andaman', 'Where the Sea Sings', 'Island Escape'],
    holidayPagePath:'/phuket-packages',
    activitiesPath: '/phuket-activities',
  },
  bali: {
    name:           'Bali',
    country:        'Indonesia',
    productCity:    'bali',
    cruiseCategory: null,                  // no cruises from Bali in our catalog
    visaKey:        null,                  // no Indonesia visa product
    heroImage:      'https://images.pexels.com/photos/2474690/pexels-photo-2474690.jpeg?auto=compress&cs=tinysrgb&w=1200',
    flagHtml:       '&#127470;&#127465;',
    titleSplit:     { title: 'Bali,', subtitle: 'Awaits.' },
    taglines:       ['The Island of Gods', 'Where Time Slows Down', 'Tropical Soul'],
    holidayPagePath:'/bali-packages',
    activitiesPath: '/bali-activities',
  },
  kuala_lumpur: {
    name:           'Kuala Lumpur',
    country:        'Malaysia',
    productCity:    'kuala lumpur',
    cruiseCategory: null,
    visaKey:        'malaysia',
    heroImage:      'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/20097/kuala-lumpur-city.png',
    flagHtml:       '&#127474;&#127486;',
    titleSplit:     { title: 'Kuala Lumpur,', subtitle: 'Reimagined.' },
    taglines:       ['Where Cultures Connect', 'Twin Towers, Triple Charm', 'The Garden City of Lights'],
    holidayPagePath:'/kuala-lumpur-packages',
    activitiesPath: '/kuala-lumpur-activities',
  },
  istanbul: {
    name:           'Istanbul',
    country:        'Turkey',
    productCity:    'istanbul',
    cruiseCategory: 'istanbul-cruises',
    visaKey:        'turkey',
    heroImage:      'https://images.pexels.com/photos/1549326/pexels-photo-1549326.jpeg?auto=compress&cs=tinysrgb&w=1200',
    flagHtml:       '&#127481;&#127479;',
    titleSplit:     { title: 'Istanbul,', subtitle: 'Two Continents.' },
    taglines:       ['Where East Meets West', 'The City on the Bosphorus', 'Crossroads of Empires'],
    holidayPagePath:'/istanbul-packages',
    activitiesPath: '/istanbul-activities',
  },
};

// ── ratings (universal across destinations) ───────────────────────────────

const RATINGS = {
  title:       'Verified by the Platforms You Already Trust',
  subtitle:    "Don't Just Take Our Word For It",
  description: 'Our ratings are earned - not curated. Check us on any major review platform and see what real travellers say.',
  platforms: platformsForDay6(),
};

const STATS = [
  { value: '25M+',   label: 'Guests served and counting'   },
  { value: '1,500+', label: 'Professionals across regions' },
  { value: '1,000+', label: 'Experiences to choose from'   },
  { value: '25+',    label: 'Operating companies'          },
];

// ── helpers ───────────────────────────────────────────────────────────────

function withUtm(url, contactId, campaign = 'day6_destination') {
  if (!url) return '#';
  if (!/raynatours\.com/i.test(url)) return url;
  if (/[?&]utm_source=/.test(url)) return url;
  const params = new URLSearchParams({
    utm_source: 'email', utm_medium: 'journey', utm_campaign: campaign,
  });
  if (contactId) params.set('rid', String(contactId));
  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

function formatPrice(amount, currency = 'AED', prefix = 'From ') {
  if (amount == null) return `${prefix}${currency} —`;
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${prefix}${currency} —`;
  return `${prefix}${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function deriveDuration(name, fallback = '2-3 Hours') {
  const s = String(name || '');
  // "Xn / yD" or "X Nights"
  const both = s.match(/(\d+)\s*N(?:ights?)?\s*\/\s*(\d+)\s*D(?:ays?)?/i);
  if (both) return `${both[1]}N / ${both[2]}D`;
  const nights = s.match(/(\d+)\s*Nights?/i);
  if (nights) return `${nights[1]} Nights / ${parseInt(nights[1]) + 1} Days`;
  const days = s.match(/(\d+)\s*Days?/i);
  if (days) return `${days[1]} Days / ${Math.max(parseInt(days[1]) - 1, 1)} Nights`;
  const hourRange = s.match(/(\d+)\s*-\s*(\d+)\s*Hours?/i);
  if (hourRange) return `${hourRange[1]}-${hourRange[2]} Hours`;
  if (/Full\s*Day/i.test(s)) return 'Full Day';
  return fallback;
}

function deriveCategory(productRow, destination, fallback) {
  // e.g. "Iconic - Singapore", "Theme Park - Singapore"
  const city = productRow.city || destination.name;
  const cat = String(productRow.category || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (cat) return `${cat} - ${city}`;
  return `${fallback} - ${city}`;
}

// ── DB lookups ────────────────────────────────────────────────────────────

async function fetchProducts({ type, productCity, ids = null, limit = 4 }) {
  const cityList = Array.isArray(productCity) ? productCity : [productCity];
  const sql = ids && ids.length > 0
    ? {
        text: `SELECT product_id, name, type, city, country, category,
                      sale_price, normal_price, currency, url, image_url
                 FROM products
                WHERE type = $1
                  AND image_url IS NOT NULL
                  AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
                  AND product_id = ANY($2::int[])`,
        values: [type, ids],
      }
    : {
        text: `SELECT product_id, name, type, city, country, category,
                      sale_price, normal_price, currency, url, image_url
                 FROM products
                WHERE type = $1
                  AND image_url IS NOT NULL
                  AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
                  AND LOWER(city) = ANY($2::text[])
                ORDER BY product_id DESC
                LIMIT $3`,
        values: [type, cityList, limit],
      };
  const { rows } = await query(sql.text, sql.values);
  return rows;
}

async function fetchCruises({ category, ids = null, limit = 4 }) {
  if (!category && (!ids || ids.length === 0)) return [];
  const sql = ids && ids.length > 0
    ? {
        text: `SELECT product_id, name, city, country, category,
                      sale_price, normal_price, currency, url, image_url
                 FROM products
                WHERE type = 'cruise'
                  AND image_url IS NOT NULL
                  AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
                  AND product_id = ANY($1::int[])`,
        values: [ids],
      }
    : {
        text: `SELECT product_id, name, city, country, category,
                      sale_price, normal_price, currency, url, image_url
                 FROM products
                WHERE type = 'cruise'
                  AND image_url IS NOT NULL
                  AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
                  AND category = $1
                ORDER BY product_id DESC
                LIMIT $2`,
        values: [category, limit],
      };
  const { rows } = await query(sql.text, sql.values);
  return rows;
}

async function fetchVisa(visaKey) {
  if (!visaKey) return null;
  const { rows: [v] } = await query(
    `SELECT key, name, country_label, types_html, details_html, status, image_url, default_link
       FROM visa_products
      WHERE enabled = TRUE AND key = $1`,
    [visaKey]
  );
  return v || null;
}

// ── public API ────────────────────────────────────────────────────────────

export async function buildDay6DestinationData({ contactId, destinationKey, ranking = {} }) {
  if (isKeyBlocked(destinationKey)) {
    throw new Error(`[Day6DestinationDataService] destination "${destinationKey}" is blocked`);
  }
  const dest = DESTINATION_CATALOG[destinationKey];
  if (!dest) {
    throw new Error(`[Day6DestinationDataService] unknown destination key: ${destinationKey}`);
  }

  // Tagline pick — Anthropic can override; otherwise default to first
  const tagline = (ranking.tagline_index != null && dest.taglines[ranking.tagline_index])
    ? dest.taglines[ranking.tagline_index]
    : dest.taglines[0];

  // Hero bg — Anthropic override or destination default
  const heroBgImage = ranking.hero_bg_image_override || dest.heroImage;

  // Hydrate 3 product sections in parallel
  const [holidayRows, activityRows, cruiseRows, visaRow] = await Promise.all([
    fetchProducts({ type: 'holiday',    productCity: dest.productCity, ids: ranking.holiday_ids,  limit: 4 }),
    fetchProducts({ type: 'activities', productCity: dest.productCity, ids: ranking.activity_ids, limit: 4 }),
    fetchCruises ({ category: dest.cruiseCategory, ids: ranking.cruise_ids, limit: 4 }),
    fetchVisa(dest.visaKey),
  ]);

  // Map products to card shape
  const holidayItems = holidayRows.slice(0, 4).map(p => ({
    category: truncate(deriveCategory(p, dest, `${dest.name} - Sightseeing`), CARD_LIMITS.EYEBROW),
    title:    truncate(p.name, CARD_LIMITS.TITLE),
    duration: truncate(deriveDuration(p.name, '3N / 4D'), CARD_LIMITS.META),
    price:    truncate(formatPrice(p.sale_price ?? p.normal_price, p.currency), CARD_LIMITS.PRICE),
    image:    p.image_url,
    link:     withUtm(p.url, contactId),
  }));

  const activityItems = activityRows.slice(0, 4).map(p => ({
    category: truncate(deriveCategory(p, dest, 'Things to Do'), CARD_LIMITS.EYEBROW),
    title:    truncate(p.name, CARD_LIMITS.TITLE),
    duration: truncate(deriveDuration(p.name, '2-3 Hours'), CARD_LIMITS.META),
    price:    truncate(formatPrice(p.sale_price ?? p.normal_price, p.currency), CARD_LIMITS.PRICE),
    image:    p.image_url,
    link:     withUtm(p.url, contactId),
  }));

  const cruiseItems = cruiseRows.slice(0, 4).map(p => ({
    category: truncate(`Cruise - ${dest.name}`, CARD_LIMITS.EYEBROW),
    title:    truncate(p.name, CARD_LIMITS.TITLE),
    duration: truncate(deriveDuration(p.name, '3N / 4D'), CARD_LIMITS.META),
    price:    truncate(formatPrice(p.sale_price ?? p.normal_price, p.currency), CARD_LIMITS.PRICE),
    image:    p.image_url,
    link:     withUtm(p.url, contactId),
  }));

  // Visa section — graceful when no visa product exists for this country
  const visaPrice  = visaRow ? `AED ${(ranking.visa_price_override || '250')}` : `AED 250`;
  const visa = {
    subtitle:    visaRow ? `${dest.country} Visa` : 'Need a Visa?',
    title:       visaRow
      ? `Apply for Your ${dest.country} Visa &mdash; Fast &amp; Hassle-Free`
      : `Travel to ${dest.country} &mdash; Visa Assistance Available`,
    meta:        visaRow
      ? `${visaRow.types_html || 'Tourist · Transit'} &nbsp;&middot;&nbsp; ${visaRow.status || 'Online'} processing &nbsp;&middot;&nbsp; Simple documentation`
      : 'Speak to our visa team for the latest entry requirements and processing timelines.',
    price:       visaPrice,
    priceLabel:  visaRow ? 'Starting From' : 'Get a Quote',
    buttonText:  'Apply Now',
    buttonLink:  withUtm(visaRow?.default_link || 'https://www.raynatours.com/visas', contactId),
  };

  return {
    topbarHtml: `${dest.flagHtml} Discover ${dest.name} &mdash; Holidays &middot; Activities &middot; Cruises &middot; Visa`,
    hero: {
      backgroundImage: heroBgImage,
      tagline,
      title:           dest.titleSplit.title,
      subtitle:        dest.titleSplit.subtitle,
      description:     `Iconic skylines, world-class attractions, luxury cruises and seamless visa &mdash; everything ${dest.name} in one place.`,
      buttons: [
        { text: 'Explore Packages', link: withUtm(`https://www.raynatours.com${dest.holidayPagePath}`, contactId) },
        { text: 'Book Activities',  link: withUtm(`https://www.raynatours.com${dest.activitiesPath}`,  contactId) },
      ],
    },
    stats: STATS,
    holidayPackages: {
      title:       `${dest.name} Holiday Packages`,
      subtitle:    'Holiday Packages',
      description: `Curated itineraries covering iconic sights, luxury stays and unforgettable experiences &mdash; all in one package.`,
      items: holidayItems,
    },
    topThingsToDo: {
      title:       `Top Things To Do In ${dest.name}`,
      subtitle:    'Must-Do Experiences',
      description: `From iconic landmarks to local favourites &mdash; ${dest.name}'s most-loved experiences, instantly booked.`,
      items: activityItems,
    },
    cruises: {
      title:       `Cruises From ${dest.name}`,
      subtitle:    'Set Sail',
      description: cruiseItems.length > 0
        ? `Set sail from ${dest.name}'s nearby ports &mdash; curated cruise itineraries with departures throughout the year.`
        : `Cruises departing from nearby ports &mdash; explore the wider region by sea.`,
      items: cruiseItems,
    },
    visa,
    ratings: RATINGS,
    lastPart: {
      title:       `Plan Your ${dest.name} Trip Today`,
      subtitle:    `Your ${dest.name} Adventure Starts Here`,
      description: `Packages, activities, cruises and visa &mdash; everything you need for the perfect ${dest.name} getaway, all in one place.`,
      buttonText:  `Explore ${dest.name}`,
      buttonLink:  withUtm(`https://www.raynatours.com${dest.holidayPagePath}`, contactId),
    },
  };
}

export const _internals = {
  DESTINATION_CATALOG, RATINGS, STATS,
  withUtm, formatPrice, deriveDuration, deriveCategory,
  fetchProducts, fetchCruises, fetchVisa,
};

export default buildDay6DestinationData;
