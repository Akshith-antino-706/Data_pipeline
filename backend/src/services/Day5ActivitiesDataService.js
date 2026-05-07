/**
 * Day5ActivitiesDataService
 *
 * Builds the data payload for the Day-5 Activities email. Anthropic returns
 * activity KEYS per theme (thrill / family / icons / water / wildlife) plus
 * city KEYS for the Top Cities section. This service hydrates each key by
 * looking up the corresponding row in the `products` table by product_id,
 * then shapes the data to what the renderer expects.
 *
 * Inputs:
 *   - contactId: unified_contacts.unified_id (used for UTM rid)
 *   - ranking:
 *       city_keys[4],
 *       thrill_keys[4], family_keys[4], icons_keys[4], water_keys[4], wildlife_keys[4],
 *       hero_activity_key                 // optional — overrides hero bg image
 *       hero_variant_key?
 *       limited_offer_variant_key?
 */

import { query } from '../config/database.js';
import { filterMapByKey, filterMapByCity } from '../config/blockedDestinations.js';

// ── catalog: activities by product_id (with theme tags) ──────────────────
//
// Each key references a real row in `products` (type='activities'). The
// `themes` tags drive what Anthropic is allowed to pick for each section.

const ACTIVITY_CATALOG = filterMapByCity({
  // ── Thrill (5 entries; 1 in Dubai) ────────────────────────────────────
  jebel_jais_zipline:    { product_id: 8937,   city: 'Ras Al Khaimah', category: 'Adventure - Ras Al Khaimah', themes: ['thrill'] },
  desert_buggy_dubai:    { product_id: 508239, city: 'Dubai',          category: 'Adventure - Dubai',          themes: ['thrill'] },
  ifly_singapore:        { product_id: 6329,   city: 'Singapore',      category: 'Skydiving - Singapore',      themes: ['thrill'] },
  aj_hackett_sentosa:    { product_id: 6328,   city: 'Singapore',      category: 'Bungee - Singapore',         themes: ['thrill'] },
  skywalk_mahanakhon:    { product_id: 510519, city: 'Bangkok',        category: 'Skywalk - Bangkok',          themes: ['thrill'] },
  parasailing_langkawi:  { product_id: 509570, city: 'Langkawi',       category: 'Parasailing - Langkawi',     themes: ['thrill'] },

  // ── Family (6 entries; 1 in Dubai, 1 in Abu Dhabi) ────────────────────
  img_worlds:            { product_id: 4753,   city: 'Dubai',          category: 'Theme Park - Dubai',         themes: ['family'] },
  ferrari_world:         { product_id: 57,     city: 'Abu Dhabi',      category: 'Theme Park - Abu Dhabi',     themes: ['family'] },
  universal_singapore:   { product_id: 4686,   city: 'Singapore',      category: 'Theme Park - Singapore',     themes: ['family'] },
  safari_world_bangkok:  { product_id: 510530, city: 'Bangkok',        category: 'Safari - Bangkok',           themes: ['family'] },
  bali_safari_park:      { product_id: 510088, city: 'Bali',           category: 'Safari - Bali',              themes: ['family'] },
  sentosa_4d:            { product_id: 508855, city: 'Singapore',      category: 'Theme Park - Singapore',     themes: ['family'] },

  // ── Iconic / Bucket-list (6 entries; 2 in Dubai) ──────────────────────
  burj_khalifa:          { product_id: 18,     city: 'Dubai',          category: 'Iconic - Dubai',             themes: ['icons'] },
  museum_of_future:      { product_id: 5116,   city: 'Dubai',          category: 'Iconic - Dubai',             themes: ['icons'] },
  gardens_by_bay:        { product_id: 4684,   city: 'Singapore',      category: 'Iconic - Singapore',         themes: ['icons'] },
  marina_bay_sands:      { product_id: 5354,   city: 'Singapore',      category: 'Iconic - Singapore',         themes: ['icons'] },
  petronas_towers:       { product_id: 509553, city: 'Kuala Lumpur',   category: 'Iconic - Kuala Lumpur',      themes: ['icons'] },
  kl_tower:              { product_id: 509556, city: 'Kuala Lumpur',   category: 'Iconic - Kuala Lumpur',      themes: ['icons'] },
  skyhelix_sentosa:      { product_id: 508542, city: 'Singapore',      category: 'Iconic - Singapore',         themes: ['icons'] },
  baiyoke_sky:           { product_id: 510532, city: 'Bangkok',        category: 'Iconic - Bangkok',           themes: ['icons'] },

  // ── Cruises / Waterparks / Islands (6 entries; 1 in Dubai) ────────────
  dhow_cruise_marina:    { product_id: 87,     city: 'Dubai',          category: 'Cruise - Dubai',             themes: ['water'] },
  adventure_cove:        { product_id: 5353,   city: 'Singapore',      category: 'Waterpark - Singapore',      themes: ['water'] },
  phi_phi_speedboat:     { product_id: 509762, city: 'Phuket',         category: 'Island - Phuket',            themes: ['water'] },
  james_bond_speedboat:  { product_id: 509779, city: 'Phuket',         category: 'Island - Phuket',            themes: ['water'] },
  chaophraya_cruise:     { product_id: 510520, city: 'Bangkok',        category: 'Cruise - Bangkok',           themes: ['water'] },
  bali_sunset_cruise:    { product_id: 510673, city: 'Bali',           category: 'Cruise - Bali',              themes: ['water'] },

  // ── Wildlife & Nature (7 entries; 1 in Dubai, 1 in Abu Dhabi) ─────────
  dubai_aquarium:        { product_id: 3636,   city: 'Dubai',          category: 'Aquarium - Dubai',           themes: ['wildlife'] },
  national_aquarium_ad:  { product_id: 5901,   city: 'Abu Dhabi',      category: 'Aquarium - Abu Dhabi',       themes: ['wildlife'] },
  night_safari_singapore:{ product_id: 4683,   city: 'Singapore',      category: 'Safari - Singapore',         themes: ['wildlife'] },
  phuket_tiger_kingdom:  { product_id: 510538, city: 'Phuket',         category: 'Wildlife - Phuket',          themes: ['wildlife'] },
  singapore_zoo:         { product_id: 4689,   city: 'Singapore',      category: 'Zoo - Singapore',            themes: ['wildlife'] },
  pattaya_elephant_sanctuary: { product_id: 510498, city: 'Pattaya',   category: 'Wildlife - Pattaya',         themes: ['wildlife'] },
  phuket_elephant_sanctuary:  { product_id: 510553, city: 'Phuket',    category: 'Wildlife - Phuket',          themes: ['wildlife'] },
});

// ── catalog: top cities ───────────────────────────────────────────────────
//
// `productSearch` is the LOWER(city) string we count activities by. For
// "Kuala Lumpur" we need the literal city name. Counts come from a single
// SQL query at hydration time.

const TOP_CITIES = filterMapByKey({
  dubai:        { city: 'Dubai',         country: 'UAE',       imageUrl: 'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Dubai%20Visa%20New_294/burj-alrab.jpg', exploreUrl: 'https://www.raynatours.com/dubai-activities',         productSearch: 'dubai' },
  singapore:    { city: 'Singapore',     country: 'Singapore', imageUrl: 'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/23726/singapore-city.png',              exploreUrl: 'https://www.raynatours.com/singapore-activities',      productSearch: 'singapore' },
  bangkok:      { city: 'Bangkok',       country: 'Thailand',  imageUrl: 'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/16424/bangkok-city.jpg',                exploreUrl: 'https://www.raynatours.com/bangkok-activities',        productSearch: 'bangkok' },
  kuala_lumpur: { city: 'Kuala Lumpur',  country: 'Malaysia',  imageUrl: 'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/20097/kuala-lumpur-city.png',           exploreUrl: 'https://www.raynatours.com/kuala-lumpur-activities',   productSearch: 'kuala lumpur' },
  bali:         { city: 'Bali',          country: 'Indonesia', imageUrl: 'https://images.pexels.com/photos/2474690/pexels-photo-2474690.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop', exploreUrl: 'https://www.raynatours.com/bali-activities', productSearch: 'bali' },
  abu_dhabi:    { city: 'Abu Dhabi',     country: 'UAE',       imageUrl: 'https://d2cazmkfw8kdtj.cloudfront.net/City-Images/13236/abu-dhabi.jpg',                   exploreUrl: 'https://www.raynatours.com/abu-dhabi-activities',     productSearch: 'abu dhabi' },
  phuket:       { city: 'Phuket',        country: 'Thailand',  imageUrl: 'https://images.pexels.com/photos/1007657/pexels-photo-1007657.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop', exploreUrl: 'https://www.raynatours.com/phuket-activities', productSearch: 'phuket' },
  pattaya:      { city: 'Pattaya',       country: 'Thailand',  imageUrl: 'https://images.pexels.com/photos/1007657/pexels-photo-1007657.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop', exploreUrl: 'https://www.raynatours.com/pattaya-activities', productSearch: 'pattaya' },
});

// ── variant copy maps ─────────────────────────────────────────────────────

const HERO_VARIANTS = {
  skip_the_queue: {
    subheading: 'SKIP THE QUEUE, LIVE THE MOMENT',
    title:      'World-Class<br />Activities,<br /><span style="font-style: italic;">Instantly Booked.</span>',
    description:'From desert thrills to city icons — discover, book and go. Instant confirmation on every experience.',
    buttonLabel:'Browse Activities',
    buttonUrl:  'https://www.raynatours.com/activities',
  },
  experience_more: {
    subheading: 'EXPERIENCE MORE, EVERYWHERE',
    title:      'Unforgettable<br /><span style="font-style: italic;">Experiences Await.</span>',
    description:'Adventures, attractions, and once-in-a-lifetime moments — booked in seconds.',
    buttonLabel:'Discover Activities',
    buttonUrl:  'https://www.raynatours.com/activities',
  },
};

const LIMITED_OFFER_VARIANTS = {
  raynow: {
    sectionHeader: 'Limited Time Offer',
    title:         'Book Activities & Get Up to 20% OFF',
    description:   'Valid on all activities&nbsp; &middot;&nbsp; Instant confirmation&nbsp; &middot;&nbsp; No hidden charges',
    code:          'RAYNOW',
  },
  early10: {
    sectionHeader: 'Early Bird Special',
    title:         'Book 7 Days Ahead, Save 10%',
    description:   'On select activities&nbsp; &middot;&nbsp; Free cancellation&nbsp; &middot;&nbsp; No hidden fees',
    code:          'EARLY10',
  },
};

const SECTION_COPY = {
  topCities: {
    sectionHeader: 'Where to Go',
    title:         'Top Cities To Visit',
    description:   'Four world-class cities, thousands of experiences - pick your destination and start exploring.',
  },
  thrill: {
    sectionHeader: 'For the Bold',
    title:         'Thrill & Adventure Picks',
    description:   'Heart-pounding activities for those who seek the extraordinary - ziplines, dunes, and freefall await.',
  },
  family: {
    sectionHeader: 'For the Whole Family',
    title:         'Family Fun Favorites',
    description:   'Create unforgettable memories together - world-famous theme parks and safari adventures for all ages.',
  },
  icons: {
    sectionHeader: 'Bucket List',
    title:         'Must-Visit Icons',
    description:   "The world's most iconic landmarks - experiences you'll talk about for years to come.",
  },
  water: {
    sectionHeader: 'On the Water',
    title:         'Cruises, Waterparks & Islands',
    description:   'Set sail, make a splash, or island-hop your way to paradise - aquatic adventures await.',
  },
  wildlife: {
    sectionHeader: 'Nature & Wildlife',
    title:         'Wildlife Wonders',
    description:   "Get up close with nature's most extraordinary creatures - aquariums, safaris, and wildlife sanctuaries.",
  },
};

const PERKS = [
  { icon: '&#9889;',           label: 'Instant Confirmation' },
  { icon: '&#127915;',         label: 'Skip The Queue' },
  { icon: '&#128176;',         label: 'Best Price' },
  { icon: '&#128737;&#65039;', label: 'Secure Booking' },
];

const PROMISE = {
  sectionHeader: 'Our Promise',
  title:         'Your Journey, Our Commitment',
  description:   "From booking to the experience, we're here to make every step smooth, safe, and memorable.",
  items: [
    { icon: '&#128176;', title: 'Best Price Guarantee',  description: "Find a lower price? We'll refund 110% of the difference. Our price match guarantee ensures you always get the best deal." },
    { icon: '&#128274;', title: 'Secure & Safe Booking', description: 'Your data is protected with 256-bit SSL encryption. We never share your personal information with third parties.' },
    { icon: '&#9889;',   title: 'Instant Confirmation',  description: 'Most activities are confirmed instantly, so you can book with confidence and start planning your experience right away.' },
  ],
};

const PLATFORMS = {
  sectionHeader: "Don't Just Take Our Word For It",
  title:         'Verified by the Platforms You Already Trust',
  description:   'Our ratings are earned - not curated. Check us on any major review platform and see what real travellers say.',
  items: [
    { name: 'Rayna Tours',  logo: 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/AGT-06437/raynatourslogo.png',                                       rating: '4.5', stars: '&#9733;&#9733;&#9733;&#9733;<span style="color:#cccccc">&#9733;</span>', reviews: '3,450 Reviews',  color: '#ff9900', bg: '#fffdf4' },
    { name: 'Trustpilot',   logo: 'https://cdn.trustpilot.net/brand-assets/4.3.0/logo-black.svg',                                                          rating: '4.3', stars: '&#9733;&#9733;&#9733;&#9733;<span style="color:#cccccc">&#9733;</span>', reviews: '52,641 Reviews', color: '#00b67a', bg: '#f4fcf8' },
    { name: 'Tripadvisor',  logo: 'https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_secondary_registered.svg',                  rating: '4.6', stars: '&#9733;&#9733;&#9733;&#9733;+',                                            reviews: '12,861 Reviews', color: '#34e0a1', bg: '#f4fcf8' },
    { name: 'Google',       logo: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png',                                  rating: '4.4', stars: '&#9733;&#9733;&#9733;&#9733;<span style="color:#cccccc">&#9733;</span>', reviews: '1,517 Reviews',  color: '#ea4335', bg: '#fff8f6' },
  ],
};

const CTA_FOOTER = {
  sectionHeader: 'Your Next Adventure Is One Click Away',
  title:         'Book Your Experience Today',
  description:   'Use code <strong>RAYNOW</strong> at checkout and save up to <strong>20% on all activities</strong> - instant confirmation, no hidden fees.',
  buttonLabel:   'Browse All Activities &rarr;',
  buttonUrl:     'https://www.raynatours.com/activities',
};

const FOOTER = {
  contact: {
    address: 'Abu Dhabi & Dubai, UAE',
    phone:   '+971 2 550 3591',
    email:   'info@raynatours.com',
  },
  social: [
    { name: 'Facebook',  url: 'https://www.facebook.com/raynagroup',           icon: 'https://img.icons8.com/ios-filled/20/ffffff/facebook-new.png' },
    { name: 'Instagram', url: 'https://instagram.com/raynatours_',             icon: 'https://img.icons8.com/ios-filled/20/ffffff/instagram-new.png' },
    { name: 'LinkedIn',  url: 'https://www.linkedin.com/company/raynatours',   icon: 'https://img.icons8.com/ios-filled/14/ffffff/linkedin.png' },
    { name: 'YouTube',   url: 'https://www.youtube.com/raynatours',            icon: 'https://img.icons8.com/ios-filled/14/ffffff/youtube-play.png' },
  ],
};

const NAVIGATION = [
  { label: 'Activities', url: 'https://www.raynatours.com/activities' },
  { label: 'Cruises',    url: 'https://www.raynatours.com/cruises' },
  { label: 'Visas',      url: 'https://www.raynatours.com/visas' },
  { label: 'Holidays',   url: 'https://www.raynatours.com/holidays' },
];

const HERO_STATS = [
  { value: '25M+',   label: 'Guests served<br />and counting'   },
  { value: '1,500+', label: 'Professionals<br />across regions' },
  { value: '1,000+', label: 'Experiences<br />to choose from'   },
  { value: '25+',    label: 'Operating<br />companies'          },
];

// ── helpers ───────────────────────────────────────────────────────────────

function withUtm(url, contactId, campaign = 'day5_activities') {
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
  if (amount == null) return `From ${currency} —`;
  const n = Number(amount);
  if (!Number.isFinite(n)) return `From ${currency} —`;
  return `From ${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function deriveDuration(name) {
  const s = String(name || '');
  const hours = s.match(/(\d+)\s*-\s*(\d+)\s*Hours?/i);
  if (hours) return `${hours[1]}-${hours[2]} Hours`;
  if (/Full\s*Day/i.test(s)) return 'Full Day';
  if (/Half\s*Day/i.test(s)) return 'Half Day';
  return '2-3 Hours';
}

async function fetchProductsByIds(ids) {
  if (!ids.length) return new Map();
  const { rows } = await query(`
    SELECT product_id, name, type, city, country,
           sale_price, normal_price, currency, url, image_url, page_description
      FROM products
     WHERE product_id = ANY($1::int[])
       AND image_url IS NOT NULL
       AND image_url ~* '\\.(jpg|jpeg|png|webp)$'
  `, [ids]);
  return new Map(rows.map(r => [r.product_id, r]));
}

async function fetchActivityCountsByCity(searchTerms) {
  if (!searchTerms.length) return new Map();
  const counts = new Map();
  for (const term of searchTerms) {
    const { rows: [r] } = await query(
      `SELECT COUNT(*)::int AS n FROM products WHERE type='activities' AND LOWER(city) = $1`,
      [term]
    );
    counts.set(term, r?.n || 0);
  }
  return counts;
}

function hydrateActivity(catalogKey, productRow, contactId) {
  const cfg = ACTIVITY_CATALOG[catalogKey];
  if (!cfg) {
    throw new Error(`[Day5ActivitiesDataService] unknown activity key: ${catalogKey}`);
  }
  if (!productRow) {
    // Fallback — still emits a renderable card
    console.warn(`[Day5ActivitiesDataService] product ${cfg.product_id} not found for "${catalogKey}"`);
    return {
      category: cfg.category,
      title:    catalogKey.replace(/_/g, ' '),
      duration: '2-3 Hours',
      price:    'From AED —',
      imageUrl: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/placeholder.jpg',
      bookUrl:  withUtm('https://www.raynatours.com/activities', contactId),
    };
  }
  return {
    category: cfg.category,
    title:    productRow.name,
    duration: deriveDuration(productRow.page_description || productRow.name),
    price:    formatPrice(productRow.sale_price ?? productRow.normal_price, productRow.currency),
    imageUrl: productRow.image_url,
    bookUrl:  withUtm(productRow.url, contactId),
  };
}

function validateRanking(r) {
  if (!r || typeof r !== 'object') {
    throw new Error('[Day5ActivitiesDataService] ranking must be an object');
  }

  const themed = [
    { slot: 'thrill_keys',   theme: 'thrill'   },
    { slot: 'family_keys',   theme: 'family'   },
    { slot: 'icons_keys',    theme: 'icons'    },
    { slot: 'water_keys',    theme: 'water'    },
    { slot: 'wildlife_keys', theme: 'wildlife' },
  ];

  for (const { slot, theme } of themed) {
    const arr = r[slot];
    if (!Array.isArray(arr)) throw new Error(`ranking.${slot} must be an array`);
    if (arr.length !== 4) throw new Error(`ranking.${slot} must have exactly 4 items (got ${arr.length})`);
    if (new Set(arr).size !== arr.length) throw new Error(`ranking.${slot} has duplicate keys`);
    for (const k of arr) {
      const cfg = ACTIVITY_CATALOG[k];
      if (!cfg) throw new Error(`ranking.${slot}: unknown activity key "${k}"`);
      if (!cfg.themes.includes(theme)) {
        throw new Error(`ranking.${slot}: "${k}" is not tagged with theme "${theme}"`);
      }
    }
  }

  if (!Array.isArray(r.city_keys) || r.city_keys.length !== 4) {
    throw new Error(`city_keys must have exactly 4 items (got ${(r.city_keys || []).length})`);
  }
  for (const k of r.city_keys || []) {
    if (!TOP_CITIES[k]) throw new Error(`ranking.city_keys: unknown city key "${k}"`);
  }

  if (r.hero_variant_key && !HERO_VARIANTS[r.hero_variant_key]) {
    throw new Error(`unknown hero_variant_key: ${r.hero_variant_key}`);
  }
  if (r.limited_offer_variant_key && !LIMITED_OFFER_VARIANTS[r.limited_offer_variant_key]) {
    throw new Error(`unknown limited_offer_variant_key: ${r.limited_offer_variant_key}`);
  }
  if (r.hero_activity_key && !ACTIVITY_CATALOG[r.hero_activity_key]) {
    throw new Error(`unknown hero_activity_key: ${r.hero_activity_key}`);
  }
}

// ── public API ────────────────────────────────────────────────────────────

export async function buildDay5ActivitiesData({ contactId, ranking }) {
  validateRanking(ranking);

  // Pick variants
  const hero          = HERO_VARIANTS[ranking.hero_variant_key             || 'skip_the_queue'];
  const limitedOffer  = LIMITED_OFFER_VARIANTS[ranking.limited_offer_variant_key || 'raynow'];

  // Collect product IDs from all themed sections + the hero (if set)
  const themeArrays = [
    ranking.thrill_keys, ranking.family_keys, ranking.icons_keys,
    ranking.water_keys,  ranking.wildlife_keys,
  ];
  const allActivityKeys = themeArrays.flat();
  if (ranking.hero_activity_key) allActivityKeys.push(ranking.hero_activity_key);
  const allProductIds = [...new Set(allActivityKeys.map(k => ACTIVITY_CATALOG[k].product_id))];

  // Single query for all activity products
  const productsById = await fetchProductsByIds(allProductIds);

  // Single query for top-city activity counts
  const cityTerms = (ranking.city_keys || []).map(k => TOP_CITIES[k].productSearch);
  const cityCounts = await fetchActivityCountsByCity(cityTerms);

  // Hydrate each themed section
  const hyd = (keys) => keys.map(k => hydrateActivity(k, productsById.get(ACTIVITY_CATALOG[k].product_id), contactId));
  const thrillPicks   = hyd(ranking.thrill_keys);
  const familyPicks   = hyd(ranking.family_keys);
  const iconsPicks    = hyd(ranking.icons_keys);
  const waterPicks    = hyd(ranking.water_keys);
  const wildlifePicks = hyd(ranking.wildlife_keys);

  // Hydrate top cities (uses static config + dynamic activity counts)
  const cities = ranking.city_keys.map(k => {
    const cfg = TOP_CITIES[k];
    const n = cityCounts.get(cfg.productSearch) || 0;
    return {
      country:        cfg.country,
      city:           cfg.city,
      activitiesCount:n > 0 ? `${n}+ Activities` : 'Activities Available',
      imageUrl:       cfg.imageUrl,
      exploreUrl:     withUtm(cfg.exploreUrl, contactId),
    };
  });

  // Hero bg image — if Anthropic picked a hero_activity_key, use its image.
  // Else fall back to the variant's default (or first thrill pick's image).
  let heroBgImage;
  if (ranking.hero_bg_image_override) {
    heroBgImage = ranking.hero_bg_image_override;
  } else if (ranking.hero_activity_key) {
    const heroCfg = ACTIVITY_CATALOG[ranking.hero_activity_key];
    heroBgImage = productsById.get(heroCfg.product_id)?.image_url
              || thrillPicks[0]?.imageUrl
              || 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/ManualPackageGalleryImages/Final/Dubai-Sky-High-Thrills-Holiday-558/1761553496187_S.jpg';
  } else {
    heroBgImage = thrillPicks[0]?.imageUrl
              || 'https://d2cazmkfw8kdtj.cloudfront.net/assets/Images/ManualPackageGalleryImages/Final/Dubai-Sky-High-Thrills-Holiday-558/1761553496187_S.jpg';
  }

  return {
    navigation: NAVIGATION.map(n => ({ label: n.label, url: withUtm(n.url, contactId) })),
    hero: {
      subheading:      hero.subheading,
      title:           hero.title,
      description:     hero.description,
      backgroundImage: heroBgImage,
      buttonLabel:     hero.buttonLabel,
      buttonUrl:       withUtm(hero.buttonUrl, contactId),
      stats:           HERO_STATS,
    },
    topCities: {
      sectionHeader: SECTION_COPY.topCities.sectionHeader,
      title:         SECTION_COPY.topCities.title,
      description:   SECTION_COPY.topCities.description,
      cities,
    },
    thrillAdventure: {
      sectionHeader: SECTION_COPY.thrill.sectionHeader,
      title:         SECTION_COPY.thrill.title,
      description:   SECTION_COPY.thrill.description,
      picks:         thrillPicks,
    },
    familyFun: {
      sectionHeader: SECTION_COPY.family.sectionHeader,
      title:         SECTION_COPY.family.title,
      description:   SECTION_COPY.family.description,
      picks:         familyPicks,
    },
    limitedOffer: {
      sectionHeader: limitedOffer.sectionHeader,
      title:         limitedOffer.title,
      description:   limitedOffer.description,
      code:          limitedOffer.code,
    },
    mustVisitIcons: {
      sectionHeader: SECTION_COPY.icons.sectionHeader,
      title:         SECTION_COPY.icons.title,
      description:   SECTION_COPY.icons.description,
      picks:         iconsPicks,
    },
    cruisesWaterparks: {
      sectionHeader: SECTION_COPY.water.sectionHeader,
      title:         SECTION_COPY.water.title,
      description:   SECTION_COPY.water.description,
      picks:         waterPicks,
    },
    wildlifeWonders: {
      sectionHeader: SECTION_COPY.wildlife.sectionHeader,
      title:         SECTION_COPY.wildlife.title,
      description:   SECTION_COPY.wildlife.description,
      picks:         wildlifePicks,
    },
    perks:    PERKS,
    promise:  PROMISE,
    platforms:PLATFORMS,
    ctaFooter:{
      ...CTA_FOOTER,
      buttonUrl: withUtm(CTA_FOOTER.buttonUrl, contactId),
    },
    footer:   FOOTER,
  };
}

export const _internals = {
  ACTIVITY_CATALOG, TOP_CITIES, HERO_VARIANTS, LIMITED_OFFER_VARIANTS,
  SECTION_COPY, PERKS, PROMISE, PLATFORMS, CTA_FOOTER, FOOTER,
  NAVIGATION, HERO_STATS,
  withUtm, formatPrice, deriveDuration, fetchProductsByIds,
  fetchActivityCountsByCity, hydrateActivity, validateRanking,
};

export default buildDay5ActivitiesData;
