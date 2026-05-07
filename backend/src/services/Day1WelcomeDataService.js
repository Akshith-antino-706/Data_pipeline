/**
 * Day1WelcomeDataService
 *
 * Builds the data.json payload for the Day-1 welcome email
 * (template + Day1WelcomeRenderer.js).
 *
 * Architecture:
 *   - Holidays / Cruises / Activities sections come from in-file config maps
 *     (these are marketing destination keys, not products — same pattern as
 *     cruise's DEPARTURE_CITIES).
 *   - Visa section comes from the `visa_products` DB table (so the visa
 *     copy is consistent with the day-3 visa email — Tourist · Transit only).
 *   - Anthropic picks 4 keys per section based on web-trending data via
 *     Day1WelcomeRankingService. This service hydrates those keys into
 *     the renderer-friendly shape.
 *   - Ratings + variant copy are static maps.
 *
 * Inputs:
 *   - contactId: unified_contacts.unified_id (used for UTM rid)
 *   - ranking: {
 *       holiday_keys[4], cruise_keys[4], visa_keys[4], activity_keys[4],
 *       hero_variant_key?, exclusive_variant_key?
 *     }
 *
 * Output: nested object matching the friend's data.json shape.
 */

import { query } from '../config/database.js';
import { filterMapByKey, isKeyBlocked } from '../config/blockedDestinations.js';

// ── catalog: holiday destinations ────────────────────────────────────────

// `productSearch` lists city/country names to match against the `products`
// table when picking a real product image for the hero bg. The first hit wins.
const HOLIDAY_DESTINATIONS = filterMapByKey({
  dubai: {
    name: 'Dubai',
    image: 'https://images.pexels.com/photos/29537849/pexels-photo-29537849.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/dubai-city-packages',
    productSearch: ['dubai'],
  },
  singapore: {
    name: 'Singapore',
    image: 'https://images.pexels.com/photos/777059/pexels-photo-777059.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/singapore-packages',
    productSearch: ['singapore'],
  },
  georgia: {
    name: 'Georgia',
    image: 'https://images.pexels.com/photos/31967671/pexels-photo-31967671.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/tbilisi-packages',
    productSearch: ['tbilisi', 'georgia'],
  },
  bali: {
    name: 'Bali',
    image: 'https://images.pexels.com/photos/11110076/pexels-photo-11110076.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/bali-packages',
    productSearch: ['bali', 'indonesia'],
  },
  thailand: {
    name: 'Thailand',
    image: 'https://images.pexels.com/photos/1031659/pexels-photo-1031659.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/thailand-packages',
    productSearch: ['phuket', 'bangkok', 'thailand'],
  },
  malaysia: {
    name: 'Malaysia',
    image: 'https://images.pexels.com/photos/2397414/pexels-photo-2397414.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/malaysia-packages',
    productSearch: ['kuala lumpur', 'malaysia'],
  },
  maldives: {
    name: 'Maldives',
    image: 'https://images.pexels.com/photos/1287460/pexels-photo-1287460.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/maldives-packages',
    productSearch: ['maldives'],
  },
  turkey: {
    name: 'Turkey',
    image: 'https://images.pexels.com/photos/1549326/pexels-photo-1549326.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/turkey-packages',
    productSearch: ['istanbul', 'turkey'],
  },
});

// ── catalog: cruise destinations ─────────────────────────────────────────

const CRUISE_DESTINATIONS = filterMapByKey({
  dubai: {
    name: 'Dubai',
    image: 'https://images.pexels.com/photos/19612315/pexels-photo-19612315.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/dubai-city-cruises',
  },
  saudi_arabia: {
    name: 'Saudi Arabia',
    image: 'https://images.pexels.com/photos/15839821/pexels-photo-15839821.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/jeddah-cruises',
  },
  singapore: {
    name: 'Singapore',
    image: 'https://images.pexels.com/photos/813011/pexels-photo-813011.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/singapore-city-cruises',
  },
  rome: {
    name: 'Rome',
    image: 'https://images.pexels.com/photos/1797161/pexels-photo-1797161.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/rome-cruises',
  },
  barcelona: {
    name: 'Barcelona',
    image: 'https://images.pexels.com/photos/1388030/pexels-photo-1388030.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/barcelona-cruises',
  },
  copenhagen: {
    name: 'Copenhagen',
    image: 'https://images.pexels.com/photos/3771803/pexels-photo-3771803.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/copenhagen-cruises',
  },
  istanbul: {
    name: 'Istanbul',
    image: 'https://images.pexels.com/photos/3585050/pexels-photo-3585050.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/istanbul-cruises',
  },
});

// ── catalog: activity destinations ───────────────────────────────────────

const ACTIVITY_DESTINATIONS = filterMapByKey({
  dubai: {
    name: 'Dubai',
    image: 'https://images.pexels.com/photos/31640448/pexels-photo-31640448.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/dubai-activities',
  },
  singapore: {
    name: 'Singapore',
    image: 'https://images.pexels.com/photos/3152126/pexels-photo-3152126.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/singapore-activities',
  },
  malaysia: {
    name: 'Malaysia',
    image: 'https://images.pexels.com/photos/462671/pexels-photo-462671.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/kuala-lumpur-activities',
  },
  thailand: {
    name: 'Thailand',
    image: 'https://images.pexels.com/photos/31029467/pexels-photo-31029467.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/phuket-activities',
  },
  abu_dhabi: {
    name: 'Abu Dhabi',
    image: 'https://images.pexels.com/photos/2044434/pexels-photo-2044434.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/abu-dhabi-activities',
  },
  bali: {
    name: 'Bali',
    image: 'https://images.pexels.com/photos/2474690/pexels-photo-2474690.jpeg?auto=compress&cs=tinysrgb&w=280&h=210&fit=crop',
    default_link: 'https://www.raynatours.com/bali-activities',
  },
});

// ── ratings + variants ───────────────────────────────────────────────────

const RATINGS = [
  {
    platform: 'Rayna Tours',
    logo:     'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png',
    stars:    '&#9733;&#9733;&#9733;&#9733;<span style="color: #dddddd">&#9733;</span>',
    rating:   '4.5',
    reviews:  '3,450 Reviews',
    styles:   { border: '#f0e5c0', bg: '#fffdf4', starColor: '#f5a623' },
  },
  {
    platform: 'Trustpilot',
    logo:     'https://cdn.trustpilot.net/brand-assets/4.3.0/logo-black.svg',
    stars:    '&#9733;&#9733;&#9733;&#9733;<span style="color: #dddddd">&#9733;</span>',
    rating:   '4.3',
    reviews:  '52,641 Reviews',
    styles:   { border: '#b8e8d0', bg: '#f4fcf8', starColor: '#00b67a' },
  },
  {
    platform: 'Tripadvisor',
    logo:     'https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg',
    stars:    '&#9733;&#9733;&#9733;&#9733;+',
    rating:   '4.6',
    reviews:  '12,861 Reviews',
    styles:   { border: '#b8e8d0', bg: '#f4fcf8', starColor: '#00aa6c' },
  },
  {
    platform: 'Google',
    logo:     'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',
    stars:    '&#9733;&#9733;&#9733;&#9733;&#9733;',
    rating:   '4.4',
    reviews:  '1,517 Reviews',
    styles:   { border: '#f5cfc8', bg: '#fff8f6', starColor: '#fbbc04' },
  },
];

const HERO_VARIANTS = {
  perfect_trip: {
    title:           'Plan Your Perfect Trip &mdash;<br />Everything in One Place',
    subtitle:        'Your dream holiday starts here &mdash; holidays, cruises, visas &amp; activities, all curated for UAE travellers who want more.',
    backgroundImage: 'https://images.pexels.com/photos/2356059/pexels-photo-2356059.jpeg?auto=compress&cs=tinysrgb&w=1280',
    button:          { text: 'Start Planning Now', link: 'https://www.raynatours.com/' },
  },
  curated_for_you: {
    title:           'Curated Travel,<br />Crafted For You',
    subtitle:        'From beach escapes to embassy visas &mdash; Rayna Tours brings everything your next trip needs into one place.',
    backgroundImage: 'https://images.pexels.com/photos/2356059/pexels-photo-2356059.jpeg?auto=compress&cs=tinysrgb&w=1280',
    button:          { text: 'Start Exploring', link: 'https://www.raynatours.com/' },
  },
};

const EXCLUSIVE_VARIANTS = {
  raynow: {
    title:        'Exclusive Offer',
    headline:     'Book Activities &amp; Get Upto 20% OFF<br />Use Code RAYNOW',
    buttonText:   'Book Now',
    buttonLink:   'https://www.raynatours.com/activities',
  },
  welcome_off: {
    title:        'Welcome Offer',
    headline:     'New Customer? Get 15% Off<br />Use Code WELCOME15',
    buttonText:   'Apply Code',
    buttonLink:   'https://www.raynatours.com/',
  },
};

// Section icons / labels / "explore all" links — these don't change per send
const SECTION_META = {
  holiday:  { id: 'holidays',   title: 'Holidays',   icon: '&#127968;', link: 'https://www.raynatours.com/holidays'   }, // 🏘️
  cruise:   { id: 'cruises',    title: 'Cruises',    icon: '&#128674;', link: 'https://www.raynatours.com/cruises'    }, // 🚢
  visa:     { id: 'visas',      title: 'Visas',      icon: '&#128737;', link: 'https://www.raynatours.com/visas'      }, // 🛡️
  activity: { id: 'activities', title: 'Activities', icon: '&#127919;', link: 'https://www.raynatours.com/activities' }, // 🎯
};

const LOGO_URL = 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png';

// ── helpers ───────────────────────────────────────────────────────────────

function withUtm(url, contactId, campaign = 'day1_welcome') {
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

function validateRanking(r) {
  if (!r || typeof r !== 'object') {
    throw new Error('[Day1WelcomeDataService] ranking must be an object');
  }
  const expectKeys = (key, count, mapName, map) => {
    const v = r[key];
    if (!Array.isArray(v)) throw new Error(`[Day1WelcomeDataService] ranking.${key} must be an array`);
    if (v.length !== count) {
      console.warn(`[Day1WelcomeDataService] ranking.${key} has ${v.length} items; template expects ${count}`);
    }
    for (const k of v) {
      if (typeof k !== 'string' || !k.trim()) {
        throw new Error(`[Day1WelcomeDataService] ranking.${key} contains non-string key: ${k}`);
      }
      if (map && !map[k]) {
        throw new Error(`[Day1WelcomeDataService] ranking.${key}: unknown ${mapName} key "${k}"`);
      }
    }
  };

  expectKeys('holiday_keys',  4, 'HOLIDAY_DESTINATIONS', HOLIDAY_DESTINATIONS);
  expectKeys('cruise_keys',   4, 'CRUISE_DESTINATIONS',  CRUISE_DESTINATIONS);
  expectKeys('activity_keys', 4, 'ACTIVITY_DESTINATIONS',ACTIVITY_DESTINATIONS);
  expectKeys('visa_keys',     4, null,                    null); // visas validated against DB

  if (r.hero_variant_key && !HERO_VARIANTS[r.hero_variant_key]) {
    throw new Error(`unknown hero_variant_key: ${r.hero_variant_key}`);
  }
  if (r.exclusive_variant_key && !EXCLUSIVE_VARIANTS[r.exclusive_variant_key]) {
    throw new Error(`unknown exclusive_variant_key: ${r.exclusive_variant_key}`);
  }
}

function orderRowsByKeys(rows, keys, idCol = 'key') {
  const byKey = new Map(rows.map(r => [r[idCol], r]));
  return keys.map(k => byKey.get(k));
}

/**
 * Pick a real product image to use as the hero bg, based on the lead holiday
 * destination Claude ranked first. Searches the `products` table for any
 * product matching one of the destination's `productSearch` city hints.
 *
 * Preference order: holiday > activities > any type. Newest product_id first.
 * Returns null if nothing matches — caller should fall back to a static URL.
 */
async function pickHeroProductImage(holidayKey) {
  const cfg = HOLIDAY_DESTINATIONS[holidayKey];
  if (!cfg?.productSearch?.length) return null;

  for (const term of cfg.productSearch) {
    const { rows } = await query(`
      SELECT image_url
        FROM products
       WHERE image_url IS NOT NULL
         AND (LOWER(city) ILIKE $1 OR LOWER(country) ILIKE $1)
       ORDER BY (type = 'holiday')    DESC,
                (type = 'activities') DESC,
                product_id DESC
       LIMIT 1
    `, [`%${term.toLowerCase()}%`]);
    if (rows[0]?.image_url) return rows[0].image_url;
  }
  return null;
}

// ── public API ────────────────────────────────────────────────────────────

export async function buildDay1WelcomeData({ contactId, ranking }) {
  validateRanking(ranking);

  const hero       = HERO_VARIANTS[ranking.hero_variant_key             || 'perfect_trip'];
  const exclusive  = EXCLUSIVE_VARIANTS[ranking.exclusive_variant_key   || 'raynow'];

  // Holiday section
  const holidayItems = ranking.holiday_keys.map(k => {
    const c = HOLIDAY_DESTINATIONS[k];
    return { name: c.name, image: c.image, link: withUtm(c.default_link, contactId) };
  });

  // Cruise section
  const cruiseItems = ranking.cruise_keys.map(k => {
    const c = CRUISE_DESTINATIONS[k];
    return { name: c.name, image: c.image, link: withUtm(c.default_link, contactId) };
  });

  // Activity section
  const activityItems = ranking.activity_keys.map(k => {
    const c = ACTIVITY_DESTINATIONS[k];
    return { name: c.name, image: c.image, link: withUtm(c.default_link, contactId) };
  });

  // Visa section — pulled from DB visa_products
  const { rows: visaRows } = await query(`
    SELECT key, name, image_url, default_link
      FROM visa_products
     WHERE enabled = TRUE AND key = ANY($1::text[])
  `, [ranking.visa_keys]);

  const orderedVisas = orderRowsByKeys(visaRows, ranking.visa_keys);
  const missing = ranking.visa_keys.filter((k, i) => !orderedVisas[i]);
  if (missing.length > 0) {
    throw new Error(`[Day1WelcomeDataService] visa keys not found: ${missing.join(', ')}`);
  }
  const visaItems = orderedVisas.map(v => ({
    name: v.name, image: v.image_url, link: withUtm(v.default_link, contactId),
  }));

  // Hero bg: prefer a real product image for the lead holiday destination.
  // Fall back to ranking override → variant default if nothing found.
  const productHeroImage = await pickHeroProductImage(ranking.holiday_keys[0]);
  const heroBgImage = ranking.hero_bg_image_override
                   || productHeroImage
                   || hero.backgroundImage;

  return {
    logoUrl: LOGO_URL,
    hero: {
      backgroundImage: heroBgImage,
      title:           hero.title,
      subtitle:        hero.subtitle,
      button: {
        text: hero.button.text,
        link: withUtm(hero.button.link, contactId),
      },
      stats: [
        { value: '25M+',   label: 'Guests served<br />and counting'   },
        { value: '1,500+', label: 'Professionals<br />across regions' },
        { value: '1000+',  label: 'Experiences<br />to choose from'   },
        { value: '25+',    label: 'Operating<br />companies'          },
      ],
    },
    sections: [
      { ...SECTION_META.holiday,  link: withUtm(SECTION_META.holiday.link,  contactId), items: holidayItems  },
      { ...SECTION_META.cruise,   link: withUtm(SECTION_META.cruise.link,   contactId), items: cruiseItems   },
      { ...SECTION_META.visa,     link: withUtm(SECTION_META.visa.link,     contactId), items: visaItems     },
      { ...SECTION_META.activity, link: withUtm(SECTION_META.activity.link, contactId), items: activityItems },
    ],
    exclusiveOffer: {
      title:      exclusive.title,
      headline:   exclusive.headline,
      buttonText: exclusive.buttonText,
      buttonLink: withUtm(exclusive.buttonLink, contactId),
    },
    ratings: RATINGS,
  };
}

export const _internals = {
  HOLIDAY_DESTINATIONS, CRUISE_DESTINATIONS, ACTIVITY_DESTINATIONS,
  RATINGS, HERO_VARIANTS, EXCLUSIVE_VARIANTS, SECTION_META, LOGO_URL,
  withUtm, orderRowsByKeys, validateRanking,
};

export default buildDay1WelcomeData;
