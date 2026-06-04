/**
 * SocialPostRenderer
 *
 * Renders 1080×1350 Instagram-style social post templates. Three layouts:
 *
 *   1. destination-post   — destination opener, coupon badge, activity-driven hero
 *   2. generic-hero       — Day 1 carousel card 1: "Your dream holiday starts here"
 *   3. generic-category   — Day 1 carousel cards 2-5: ACTIVITIES / CRUISES / etc.
 *
 * Each returns a final substituted HTML string. The caller writes it to disk
 * and screenshots via headless browser (puppeteer) downstream.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../config/database.js';
import { BRAND, CONTACT } from '../utils/brand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const TEMPLATES = {
  // ── Destination / Activity / CTA (moved to wa_templates/ — Instagram-side variants were removed)
  destination:     path.join(REPO_ROOT, 'mail_templates/wa_templates/destination-post.html'),
  activity:        path.join(REPO_ROOT, 'mail_templates/wa_templates/activity-post.html'),
  cta:             path.join(REPO_ROOT, 'mail_templates/wa_templates/cta-post.html'),
  genericHero:     path.join(REPO_ROOT, 'mail_templates/wa_templates/generic-hero.html'),
  genericCategory: path.join(REPO_ROOT, 'mail_templates/wa_templates/generic-category.html'),

  // ── editorial "city journey" carousel — opener + N day cards + closing
  cityCard:        path.join(REPO_ROOT, 'mail_templates/wa_templates/city-card.html'),
  dayCard:         path.join(REPO_ROOT, 'mail_templates/wa_templates/day-card.html'),
  closingBanner:   path.join(REPO_ROOT, 'mail_templates/wa_templates/closing-banner.html'),

  // ── cruise journey — opener + N day cards + closing
  cruiseOpener:    path.join(REPO_ROOT, 'mail_templates/wa_templates/cruise-opener.html'),
  cruiseDayCard:   path.join(REPO_ROOT, 'mail_templates/wa_templates/cruise-day-card.html'),
  cruiseClosing:   path.join(REPO_ROOT, 'mail_templates/wa_templates/cruise-closing.html'),

  // ── WhatsApp carousel templates (live under mail_templates/wa_templates/)
  visaHero:        path.join(REPO_ROOT, 'mail_templates/wa_templates/visa-hero.html'),
  visaPromo:       path.join(REPO_ROOT, 'mail_templates/wa_templates/visa-promo.html'),
  visaCountry:     path.join(REPO_ROOT, 'mail_templates/wa_templates/visa-country.html'),
  visaClosing:     path.join(REPO_ROOT, 'mail_templates/wa_templates/visa-closing.html'),
  waGenericHero:   path.join(REPO_ROOT, 'mail_templates/wa_templates/generic-hero.html'),
  waGenericCategory: path.join(REPO_ROOT, 'mail_templates/wa_templates/generic-category.html'),
};

// Per-country presets for visa cards. Caller can override any field.
const VISA_PRESETS = {
  us: {
    country:       'US',
    tagline:       'Tired of waiting months for a',
    taglineColor:  '#FFE100',
    promise:       'Get Your US Tourist Visa Within 24 Hours!',
    subHeadline:   'No lengthy paperwork — Quick approval with expert assistance',
    accent:        'MADE EASY',
    accentColor:   '#E43633',
    heroImage:     'https://images.pexels.com/photos/3760529/pexels-photo-3760529.jpeg?auto=compress&cs=tinysrgb&w=1080',
    flagImage:     'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Flag_of_the_United_States.svg/1280px-Flag_of_the_United_States.svg.png',
  },
  uae: {
    country:       'UAE',
    tagline:       'Reunite with loved ones in',
    taglineColor:  '#FFE100',
    promise:       'Get Your UAE Tourist Visa in Just 24 Hours!',
    subHeadline:   'Fast approval — Minimal paperwork — Best price guaranteed',
    accent:        'MADE EASY',
    accentColor:   '#E43633',
    heroImage:     'https://images.pexels.com/photos/325193/pexels-photo-325193.jpeg?auto=compress&cs=tinysrgb&w=1080',
    flagImage:     'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Flag_of_the_United_Arab_Emirates.svg/1280px-Flag_of_the_United_Arab_Emirates.svg.png',
  },
  schengen: {
    country:       'SCHENGEN',
    tagline:       'Plan your European escape with',
    taglineColor:  '#FFE100',
    promise:       'Get Your Schengen Visa with Expert Help',
    subHeadline:   'End-to-end assistance — Document check — Appointment booking',
    accent:        'MADE EASY',
    accentColor:   '#003399',
    heroImage:     'https://images.pexels.com/photos/532826/pexels-photo-532826.jpeg?auto=compress&cs=tinysrgb&w=1080',
    flagImage:     'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Flag_of_Europe.svg/1280px-Flag_of_Europe.svg.png',
  },
};

const VISA_BUTTON_DEFAULTS = {
  text:  'APPLY NOW',
  bg:    '#E43633',
  color: '#FFFFFF',
};

// WhatsApp generic-category cards: per-category theme (gradient colors + background).
const WA_CATEGORY_PRESETS = {
  activities: {
    category:        'Activities',
    headline:        'Top-rated experiences worldwide — from desert safaris to city tours.',
    heroImage:       'https://images.pexels.com/photos/2356045/pexels-photo-2356045.jpeg?auto=compress&cs=tinysrgb&w=1080',
    topShadeColor:   'rgba(0,0,0,0.78)',
    bottomShadeColor:'#000000',
  },
  cruises: {
    category:        'Cruises',
    headline:        'Set sail on award-winning cruises across Europe, Asia and the Gulf.',
    heroImage:       'https://images.pexels.com/photos/813011/pexels-photo-813011.jpeg?auto=compress&cs=tinysrgb&w=1080',
    topShadeColor:   'rgba(2,12,39,0.80)',
    bottomShadeColor:'#0D3860',
  },
  holidays: {
    category:        'Holidays',
    headline:        'Curated holiday packages built around how you love to travel.',
    heroImage:       'https://images.pexels.com/photos/2533092/pexels-photo-2533092.jpeg?auto=compress&cs=tinysrgb&w=1080',
    topShadeColor:   '#404040',
    bottomShadeColor:'#7D573D',
  },
  visas: {
    category:        'Visas',
    headline:        'Fast, hassle-free visas to 100+ destinations — handled end-to-end.',
    heroImage:       'https://images.pexels.com/photos/3760529/pexels-photo-3760529.jpeg?auto=compress&cs=tinysrgb&w=1080',
    topShadeColor:   '#464C51',
    bottomShadeColor:'#919BAA',
  },
};

const WA_GENERIC_HERO_DEFAULTS = {
  headline:  'Your dream holiday starts here',
  heroImage: '',  // intentionally blank — falls back to the gradient body bg
};

// Per-day footer color palette for the day-card (matches the Figma vibe:
// teal for slide 2, cream for 3, cream for 4, etc.). Falls back to dark.
const DAY_FOOTER_COLORS = [
  { bg: '#427285', text: '#FFFFFF' },  // teal
  { bg: '#F3E5D4', text: '#000000' },  // cream
  { bg: '#F3E5D4', text: '#000000' },  // cream
  { bg: '#2F2F2F', text: '#FFFFFF' },  // dark
  { bg: '#2F2F2F', text: '#FFFFFF' },  // dark
];

const CITY_TAGLINES = {
  bali:        'Find Your Tranquility',
  bangkok:     'Where Energy Meets Wonder',
  dubai:       'Iconic Skylines Await',
  singapore:   'A City Reimagined',
  phuket:      'Island Soul, Endless Shore',
  pattaya:     'Sun, Sea, Set in Motion',
  'kuala lumpur': 'Modern Asia, Soulful Heart',
  'abu dhabi': 'Where Tradition Glows',
};

const DEFAULT_SUBTITLE = 'Discover the city of possibilities';

const FALLBACK_IMAGE =
  'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/16424/bangkok-city.jpg';

// ── generic-hero defaults ────────────────────────────────────────────────

const GENERIC_HERO_DEFAULTS = {
  headline:  'Your dream holiday starts here',
  heroImage: 'https://images.pexels.com/photos/2474690/pexels-photo-2474690.jpeg?auto=compress&cs=tinysrgb&w=1080',
};

// ── generic-category presets ─────────────────────────────────────────────
//
// Day 1 carousel cards 2-5. Each preset bundles a static background and
// the marketing copy. Caller can still override any field.

const CATEGORY_PRESETS = {
  activities: {
    category:    'Activities',
    description: 'Explore top-rated activities worldwide with Rayna.',
    heroImage:   'https://images.pexels.com/photos/2356045/pexels-photo-2356045.jpeg?auto=compress&cs=tinysrgb&w=1080',
  },
  cruises: {
    category:    'Cruises',
    description: 'Explore top-rated cruises worldwide with Rayna.',
    heroImage:   'https://images.pexels.com/photos/813011/pexels-photo-813011.jpeg?auto=compress&cs=tinysrgb&w=1080',
  },
  holidays: {
    category:    'Holidays',
    description: 'Curated holidays for every kind of traveler.',
    heroImage:   'https://images.pexels.com/photos/2533092/pexels-photo-2533092.jpeg?auto=compress&cs=tinysrgb&w=1080',
  },
  visas: {
    category:    'Visas',
    description: 'Get your Visa in 24 hours, hassle-free.',
    heroImage:   'https://images.pexels.com/photos/3760529/pexels-photo-3760529.jpeg?auto=compress&cs=tinysrgb&w=1080',
  },
};

// ── shared helpers ───────────────────────────────────────────────────────

/**
 * Pick the Nth most-popular activity in a city (rank 1-based).
 *   Popularity = SUM(user_product_affinity.affinity_score) across all users.
 *   Tiebreakers: SUM(purchase_count), then sale_price DESC.
 *   Falls back gracefully when no users have engaged yet (cold-start city) —
 *   the LEFT JOIN keeps the product in the result set with 0 affinity.
 */
async function pickActivityForCityRanked(city, rank = 1) {
  const offset = Math.max(0, (rank | 0) - 1);
  const { rows } = await query(`
    SELECT p.product_id, p.name, p.city, p.country, p.image_url, p.page_description, p.category,
           COALESCE(SUM(upa.affinity_score), 0) AS total_affinity,
           COALESCE(SUM(upa.purchase_count),  0) AS total_purchases
      FROM products p
      LEFT JOIN user_product_affinity upa ON upa.product_id = p.product_id
     WHERE p.type = 'activities'
       AND LOWER(p.city) = LOWER($1)
       AND p.image_url IS NOT NULL
       AND p.image_url ~* '\\.(jpg|jpeg|png|webp)$'
     GROUP BY p.product_id
     ORDER BY total_affinity DESC,
              total_purchases DESC,
              p.sale_price DESC NULLS LAST,
              p.product_id ASC
     LIMIT 1 OFFSET $2
  `, [city, offset]);
  return rows[0] || null;
}

const pickActivityForCity = (city) => pickActivityForCityRanked(city, 1);

/**
 * Get the top-N popularity-ranked activities for a city (for day-card N).
 * Same ordering as pickActivityForCityRanked but in one query.
 */
async function pickTopActivitiesForCity(city, limit = 3) {
  const { rows } = await query(`
    SELECT p.product_id, p.name, p.city, p.country, p.image_url, p.page_description, p.category,
           COALESCE(SUM(upa.affinity_score), 0) AS total_affinity,
           COALESCE(SUM(upa.purchase_count),  0) AS total_purchases
      FROM products p
      LEFT JOIN user_product_affinity upa ON upa.product_id = p.product_id
     WHERE p.type = 'activities'
       AND LOWER(p.city) = LOWER($1)
       AND p.image_url IS NOT NULL
       AND p.image_url ~* '\\.(jpg|jpeg|png|webp)$'
     GROUP BY p.product_id
     ORDER BY total_affinity DESC,
              total_purchases DESC,
              p.sale_price DESC NULLS LAST,
              p.product_id ASC
     LIMIT $2
  `, [city, limit]);
  return rows;
}

/**
 * Top-N popularity-ranked cruises (type='cruise' in products).
 * Same affinity-then-price ordering, used by cruise-day-card.
 */
async function pickTopCruises(limit = 3) {
  const { rows } = await query(`
    SELECT p.product_id, p.name, p.city, p.country, p.image_url, p.sale_price,
           COALESCE(SUM(upa.affinity_score), 0) AS total_affinity,
           COALESCE(SUM(upa.purchase_count),  0) AS total_purchases
      FROM products p
      LEFT JOIN user_product_affinity upa ON upa.product_id = p.product_id
     WHERE p.type = 'cruise'
       AND p.image_url IS NOT NULL
       AND p.image_url ~* '\\.(jpg|jpeg|png|webp)$'
     GROUP BY p.product_id
     ORDER BY total_affinity DESC,
              total_purchases DESC,
              p.sale_price ASC NULLS LAST,
              p.product_id ASC
     LIMIT $1
  `, [limit]);
  return rows;
}

/** Cheapest cruise sale_price across the catalog (for opener badge). */
async function startingPriceForCruises() {
  const { rows } = await query(`
    SELECT FLOOR(MIN(sale_price))::int AS price
      FROM products
     WHERE type = 'cruise'
       AND sale_price IS NOT NULL
       AND sale_price > 0
  `);
  return rows[0]?.price || null;
}

/** Cheapest published activity sale_price for a city (used in pricing pill). */
async function startingPriceForCity(city) {
  const { rows } = await query(`
    SELECT FLOOR(MIN(sale_price))::int AS price
      FROM products
     WHERE type = 'activities'
       AND LOWER(city) = LOWER($1)
       AND sale_price IS NOT NULL
       AND sale_price > 0
  `, [city]);
  return rows[0]?.price || null;
}

/** Trim HTML tags and collapse whitespace from product page_description. */
function cleanDescription(text, maxLen = 130) {
  if (!text) return '';
  const stripped = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen - 1).replace(/[\s,.;:!?]+$/, '') + '…';
}

function formatTitle(activity, cityFallback) {
  const city    = (activity?.city || cityFallback || '').trim();
  const country = (activity?.country || '').trim();
  if (city && country && country.toLowerCase() !== city.toLowerCase()) {
    return `${country} ${city}`.toUpperCase();
  }
  return city.toUpperCase();
}

function substitute(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

// ── public renderers ─────────────────────────────────────────────────────

export async function renderDestinationPost({
  city,
  couponCode,
  discountValue,
  productId,
  title,
  subtitle,
}) {
  if (!city) throw new Error('renderDestinationPost: city is required');
  if (!couponCode) throw new Error('renderDestinationPost: couponCode is required');
  if (discountValue == null) throw new Error('renderDestinationPost: discountValue is required');

  let activity = null;
  if (productId) {
    const { rows } = await query(
      `SELECT product_id, name, city, country, image_url
         FROM products WHERE product_id = $1`,
      [productId]
    );
    activity = rows[0] || null;
  } else {
    activity = await pickActivityForCity(city);
  }

  if (!activity) {
    console.warn(`[SocialPostRenderer] no activity found for city="${city}"; using fallback image`);
  }

  const html = await fs.readFile(TEMPLATES.destination, 'utf8');

  return substitute(html, {
    title:         title    || formatTitle(activity, city),
    subtitle:      subtitle || DEFAULT_SUBTITLE,
    heroImage:     activity?.image_url || FALLBACK_IMAGE,
    logoUrl:       BRAND.logoUrl,
    couponCode:    String(couponCode).toUpperCase(),
    discountValue: String(discountValue),
    websiteUrl:    'www.raynatours.com',
    phoneNumber:   CONTACT.phone,
  });
}

export async function renderActivityPost({
  city,
  rank = 1,
  productId,
  title,
  description,
  heroImage,
} = {}) {
  let activity = null;
  if (productId) {
    const { rows } = await query(
      `SELECT product_id, name, city, country, image_url, page_description, category
         FROM products WHERE product_id = $1`,
      [productId]
    );
    activity = rows[0] || null;
  } else if (city) {
    activity = await pickActivityForCityRanked(city, rank);
  } else {
    throw new Error('renderActivityPost: either city or productId is required');
  }

  if (!activity) {
    throw new Error(`renderActivityPost: no activity found (city="${city}", rank=${rank}, productId=${productId})`);
  }

  const finalTitle = title || activity.name;
  const finalDesc  = description || cleanDescription(activity.page_description) ||
                     `Discover ${activity.name} with Rayna Tours.`;

  const html = await fs.readFile(TEMPLATES.activity, 'utf8');
  return substitute(html, {
    title:       finalTitle,
    description: finalDesc,
    heroImage:   heroImage || activity.image_url || FALLBACK_IMAGE,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

export async function renderCtaPost({
  city,
  headline,
  sub,
  buttonText,
  heroImage,
  productId,
} = {}) {
  let activity = null;
  if (productId) {
    const { rows } = await query(
      `SELECT product_id, name, city, country, image_url FROM products WHERE product_id = $1`,
      [productId]
    );
    activity = rows[0] || null;
  } else if (city) {
    activity = await pickActivityForCityRanked(city, 1);
  }

  const cityLabel = (activity?.city || city || '').trim();
  const html = await fs.readFile(TEMPLATES.cta, 'utf8');

  return substitute(html, {
    headline:    headline   || 'Ready for these experiences?',
    sub:         sub        || (cityLabel ? `Book your stay in ${cityLabel}` : 'Book your next adventure with Rayna'),
    buttonText:  buttonText || 'Book now',
    heroImage:   heroImage  || activity?.image_url || FALLBACK_IMAGE,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

// ── city-journey variant (5-card editorial carousel) ────────────────────

export async function renderCityCard({
  city,
  tagline,
  startingPrice,
  heroImage,
} = {}) {
  if (!city) throw new Error('renderCityCard: city is required');

  // Hero defaults to the city's top activity image
  let img = heroImage;
  if (!img) {
    const top = await pickActivityForCityRanked(city, 1);
    img = top?.image_url || FALLBACK_IMAGE;
  }

  const price = startingPrice != null ? Number(startingPrice) : await startingPriceForCity(city);

  const html = await fs.readFile(TEMPLATES.cityCard, 'utf8');
  return substitute(html, {
    cityName:      city.toUpperCase().includes(city.toUpperCase())
                     ? city.charAt(0).toUpperCase() + city.slice(1).toLowerCase()
                     : city,
    tagline:       tagline || CITY_TAGLINES[city.toLowerCase()] || 'Where your story begins',
    startingPrice: price != null ? String(price) : '—',
    heroImage:     img,
    logoUrl:       BRAND.logoUrl,
    websiteUrl:    'www.raynatours.com',
    phoneNumber:   CONTACT.phone,
  });
}

export async function renderDayCard({
  city,
  dayNumber,
  title,
  heroImage,
  footerBg,
  footerText,
  productId,
} = {}) {
  if (dayNumber == null) throw new Error('renderDayCard: dayNumber is required');

  let activity = null;
  if (productId) {
    const { rows } = await query(
      `SELECT product_id, name, city, country, image_url FROM products WHERE product_id = $1`,
      [productId]
    );
    activity = rows[0] || null;
  } else if (city) {
    activity = await pickActivityForCityRanked(city, dayNumber);
  } else {
    throw new Error('renderDayCard: either city or productId is required');
  }

  const palette = DAY_FOOTER_COLORS[(dayNumber - 1) % DAY_FOOTER_COLORS.length];

  const html = await fs.readFile(TEMPLATES.dayCard, 'utf8');
  return substitute(html, {
    dayNumber:   String(dayNumber),
    title:       title || activity?.name || `Day ${dayNumber}`,
    heroImage:   heroImage || activity?.image_url || FALLBACK_IMAGE,
    footerColor: footerBg   || palette.bg,
    footerText:  footerText || palette.text,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

export async function renderClosingBanner({
  city,
  headline,
  sub,
  buttonText,
  heroImage,
  productId,
} = {}) {
  let activity = null;
  if (productId) {
    const { rows } = await query(
      `SELECT product_id, name, city, country, image_url FROM products WHERE product_id = $1`,
      [productId]
    );
    activity = rows[0] || null;
  } else if (city) {
    activity = await pickActivityForCityRanked(city, 1);
  }

  const html = await fs.readFile(TEMPLATES.closingBanner, 'utf8');
  return substitute(html, {
    headline:    headline   || 'Your story starts here',
    sub:         sub        || (city ? `Book your ${city} escape with Rayna` : 'Book your next adventure with Rayna'),
    buttonText:  buttonText || 'Book Now',
    heroImage:   heroImage  || activity?.image_url || FALLBACK_IMAGE,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

// ── cruise-journey variant (5-card carousel for Day 4) ──────────────────

export async function renderCruiseOpener({
  eyebrow,
  headline,
  startingPrice,
  heroImage,
} = {}) {
  let img = heroImage;
  if (!img) {
    const top = await pickTopCruises(1);
    img = top[0]?.image_url || FALLBACK_IMAGE;
  }
  const price = startingPrice != null ? Number(startingPrice) : await startingPriceForCruises();

  const html = await fs.readFile(TEMPLATES.cruiseOpener, 'utf8');
  return substitute(html, {
    eyebrow:       eyebrow  || 'The Voyage Collection',
    headline:      headline || 'Cruise',
    startingPrice: price != null ? String(price) : '—',
    heroImage:     img,
    logoUrl:       BRAND.logoUrl,
    websiteUrl:    'www.raynatours.com',
    phoneNumber:   CONTACT.phone,
  });
}

export async function renderCruiseDayCard({
  dayNumber,
  destination,
  heroImage,
  productId,
} = {}) {
  if (dayNumber == null) throw new Error('renderCruiseDayCard: dayNumber is required');

  let cruise = null;
  if (productId) {
    const { rows } = await query(
      `SELECT product_id, name, city, country, image_url FROM products WHERE product_id = $1`,
      [productId]
    );
    cruise = rows[0] || null;
  } else {
    const top = await pickTopCruises(dayNumber);
    cruise = top[dayNumber - 1] || null;
  }

  const html = await fs.readFile(TEMPLATES.cruiseDayCard, 'utf8');
  return substitute(html, {
    dayNumber:   String(dayNumber),
    destination: destination || (cruise?.city || `Day ${dayNumber}`).toUpperCase(),
    heroImage:   heroImage   || cruise?.image_url || FALLBACK_IMAGE,
    logoUrl:     BRAND.logoUrl,
  });
}

export async function renderCruiseClosing({
  eyebrow,
  headline,
  buttonText,
  heroImage,
  destination,
} = {}) {
  let img = heroImage;
  if (!img) {
    const top = await pickTopCruises(1);
    img = top[0]?.image_url || FALLBACK_IMAGE;
  }

  const html = await fs.readFile(TEMPLATES.cruiseClosing, 'utf8');
  return substitute(html, {
    eyebrow:     eyebrow    || 'Ready for these experiences?',
    headline:    headline   || (destination ? `Book your stay in ${destination}` : 'Book your cruise with Rayna'),
    buttonText:  buttonText || 'Book Now',
    heroImage:   img,
    logoUrl:     BRAND.logoUrl,
  });
}

export async function renderGenericHero({ headline, heroImage } = {}) {
  const html = await fs.readFile(TEMPLATES.genericHero, 'utf8');
  return substitute(html, {
    headline:    headline  || GENERIC_HERO_DEFAULTS.headline,
    heroImage:   heroImage || GENERIC_HERO_DEFAULTS.heroImage,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

export async function renderGenericCategory({
  category,
  description,
  heroImage,
} = {}) {
  if (!category) throw new Error('renderGenericCategory: category is required');

  const preset = CATEGORY_PRESETS[category.toLowerCase()] || {};
  const finalCategory    = (preset.category || category).toUpperCase();
  const finalDescription = description || preset.description || '';
  const finalImage       = heroImage    || preset.heroImage  || FALLBACK_IMAGE;

  const html = await fs.readFile(TEMPLATES.genericCategory, 'utf8');
  return substitute(html, {
    category:    finalCategory,
    description: finalDescription,
    heroImage:   finalImage,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

// ── visa-journey variant (visa carousel) ────────────────────────────────

function resolveVisaPreset(country) {
  if (!country) return {};
  const key = String(country).toLowerCase().replace(/\s+/g, '');
  return VISA_PRESETS[key] || {};
}

export async function renderVisaHero({
  country,
  tagline,
  taglineColor,
  promise,
  subHeadline,
  buttonText,
  buttonBg,
  buttonColor,
  heroImage,
} = {}) {
  if (!country) throw new Error('renderVisaHero: country is required');
  const preset = resolveVisaPreset(country);

  const html = await fs.readFile(TEMPLATES.visaHero, 'utf8');
  return substitute(html, {
    country:      (country || preset.country || '').toUpperCase(),
    tagline:      tagline      || preset.tagline      || 'Get your visa with',
    taglineColor: taglineColor || preset.taglineColor || '#FFE100',
    promise:      promise      || preset.promise      || `Get Your ${country} Tourist Visa Fast!`,
    subHeadline:  subHeadline  || preset.subHeadline  || 'Quick approval with expert assistance',
    buttonText:   buttonText   || VISA_BUTTON_DEFAULTS.text,
    buttonBg:     buttonBg     || VISA_BUTTON_DEFAULTS.bg,
    buttonColor:  buttonColor  || VISA_BUTTON_DEFAULTS.color,
    heroImage:    heroImage    || preset.heroImage    || FALLBACK_IMAGE,
    logoUrl:      BRAND.logoUrl,
  });
}

export async function renderVisaPromo({
  country,
  accent,
  accentColor,
  subHeadline,
  buttonText,
  buttonBg,
  buttonColor,
  heroImage,
} = {}) {
  if (!country) throw new Error('renderVisaPromo: country is required');
  const preset = resolveVisaPreset(country);

  const html = await fs.readFile(TEMPLATES.visaPromo, 'utf8');
  return substitute(html, {
    country:     ((country || preset.country) + ' VISAS').toUpperCase(),
    accent:      accent      || preset.accent      || 'MADE EASY',
    accentColor: accentColor || preset.accentColor || '#E43633',
    subHeadline: subHeadline || 'Apply Now & Travel Without Stress',
    buttonText:  buttonText  || VISA_BUTTON_DEFAULTS.text,
    buttonBg:    buttonBg    || '#FFFFFF',
    buttonColor: buttonColor || '#000000',
    heroImage:   heroImage   || preset.heroImage  || FALLBACK_IMAGE,
    logoUrl:     BRAND.logoUrl,
  });
}

export async function renderVisaCountry({
  country,
  subLine,
  heroImage,
  flagImage,
} = {}) {
  if (!country) throw new Error('renderVisaCountry: country is required');
  const preset = resolveVisaPreset(country);

  const html = await fs.readFile(TEMPLATES.visaCountry, 'utf8');
  return substitute(html, {
    country:   (country || preset.country || '').toUpperCase(),
    subLine:   subLine   || 'Apply now and travel without stress',
    heroImage: heroImage || preset.heroImage || FALLBACK_IMAGE,
    flagImage: flagImage || preset.flagImage || '',
    logoUrl:   BRAND.logoUrl,
  });
}

export async function renderWaGenericHero({ headline, heroImage } = {}) {
  const html = await fs.readFile(TEMPLATES.waGenericHero, 'utf8');
  return substitute(html, {
    headline:    headline  || WA_GENERIC_HERO_DEFAULTS.headline,
    heroImage:   heroImage || WA_GENERIC_HERO_DEFAULTS.heroImage,
    logoUrl:     BRAND.logoUrl,
    websiteUrl:  'www.raynatours.com',
    phoneNumber: CONTACT.phone,
  });
}

export async function renderWaGenericCategory({
  category,
  headline,
  heroImage,
  topShadeColor,
  bottomShadeColor,
} = {}) {
  if (!category) throw new Error('renderWaGenericCategory: category is required');
  const preset = WA_CATEGORY_PRESETS[category.toLowerCase()] || {};

  const html = await fs.readFile(TEMPLATES.waGenericCategory, 'utf8');
  return substitute(html, {
    category:         (preset.category || category).toUpperCase(),
    headline:         headline         || preset.headline         || '',
    heroImage:        heroImage        || preset.heroImage        || FALLBACK_IMAGE,
    topShadeColor:    topShadeColor    || preset.topShadeColor    || 'rgba(0,0,0,0.78)',
    bottomShadeColor: bottomShadeColor || preset.bottomShadeColor || '#000000',
    logoUrl:          BRAND.logoUrl,
    websiteUrl:       'www.raynatours.com',
    phoneNumber:      CONTACT.phone,
  });
}

export async function renderVisaClosing({
  headline,
  accent,
  accentColor,
  withLabel,
  heroImage,
} = {}) {
  const html = await fs.readFile(TEMPLATES.visaClosing, 'utf8');
  return substitute(html, {
    headline:    headline    || 'Ready for these experiences?',
    accent:      accent      || 'Apply Your VISAS',
    accentColor: accentColor || '#FFCF62',
    withLabel:   withLabel   || 'with',
    heroImage:   heroImage   || 'https://images.pexels.com/photos/3769138/pexels-photo-3769138.jpeg?auto=compress&cs=tinysrgb&w=1080',
    logoUrl:     BRAND.logoUrl,
  });
}

export const _internals = {
  pickActivityForCity,
  pickActivityForCityRanked,
  pickTopActivitiesForCity,
  pickTopCruises,
  startingPriceForCity,
  startingPriceForCruises,
  cleanDescription,
  substitute,
  TEMPLATES,
  CATEGORY_PRESETS,
  GENERIC_HERO_DEFAULTS,
  CITY_TAGLINES,
  DAY_FOOTER_COLORS,
  VISA_PRESETS,
  VISA_BUTTON_DEFAULTS,
};
