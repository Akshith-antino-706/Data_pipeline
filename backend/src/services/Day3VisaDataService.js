/**
 * Day3VisaDataService
 *
 * Builds the data.json payload that Day3VisaRenderer consumes (template +
 * card-builder helpers).
 *
 * Architecture:
 *   - Visa product info lives in the `visa_products` table (see migration 050).
 *   - Anthropic (or a fallback) ranks visas by KEY via VisaRankingService.
 *   - This service hydrates the ranked keys with full DB rows and assembles
 *     the nested data shape the renderer expects.
 *   - Variant copy (hero / section eyebrows / CTA) stays in this file because
 *     those are layout/marketing concerns, not a catalog.
 *
 * Inputs:
 *   - contactId: unified_contacts.unified_id (used for UTM rid)
 *   - ranking:   { international_keys[4], evisa_keys[4], popular_keys[4],
 *                  ratings_keys[4], hero_variant_key?, copy_variant_keys?,
 *                  hero_bg_image_override? }
 *
 * Output: nested object matching the template's data.json shape.
 */

import { query } from '../config/database.js';

// ── variant copy maps (NOT catalog — these are layout/copy choices) ────────

const RATINGS = {
  rayna: {
    platform: 'Rayna Tours',
    score:    '4.5',
    reviews:  '25 Million Customers',
    stars:    '&#9733;&#9733;&#9733;&#9733;<span style="color:#dddddd">&#9733;</span>',
  },
  trustpilot: {
    platform: 'Trustpilot',
    score:    '4.7',
    reviews:  '34,655 Reviews',
    stars:    '&#9733;&#9733;&#9733;&#9733;<span style="color:#dddddd">&#9733;</span>',
  },
  tripadvisor: {
    platform: 'Tripadvisor',
    score:    '4.6',
    reviews:  '12,882 Reviews',
    stars:    '&#9733;&#9733;&#9733;&#9733;+',
  },
  google: {
    platform: 'Google',
    score:    '4.3',
    reviews:  '1,693 Reviews',
    stars:    '&#9733;&#9733;&#9733;&#9733;&#9733;',
  },
};

const HERO_VARIANTS = {
  passport: {
    title:       'Your Passport<br />to Every<br /><strong style="font-weight: 700">Destination.</strong>',
    description: 'Fast approvals, expert guidance, and zero stress. Rayna Tours handles your visa - you focus on packing.',
    bg_image:    'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Dubai%20Visa%20New_294/burj-alrab.jpg',
  },
  gateway: {
    title:       'Visa Made Easy<br /><strong style="font-weight: 700">Travel Made Joyful.</strong>',
    description: 'From e-Visas to embassy submissions — we handle the paperwork so your trip starts at takeoff.',
    bg_image:    'https://d2cazmkfw8kdtj.cloudfront.net/Visa-Images/Schengen%20New%20Visa_337/Schengen.jpg',
  },
};

const INTERNATIONAL_COPY = {
  abroad: {
    subtitle:    'International Travel',
    title:       'Traveling Abroad?<br />Apply For Your Visa Today',
    description: 'Expert visa processing for top destinations - fast, reliable, hassle-free.',
  },
  major: {
    subtitle:    'Major Embassies',
    title:       'Top Destinations,<br />Trusted Approvals',
    description: 'Embassy-grade visa processing with hand-held guidance through every step.',
  },
};

const EVISA_COPY = {
  online: {
    subtitle:    'Instant Online Processing',
    title:       'Apply for Your E-Visa<br />Hassle-Free',
    description: 'Skip long queues - apply for your eVisa online, effortlessly from anywhere.',
  },
  fast: {
    subtitle:    'Fast Track eVisas',
    title:       'eVisas in<br />Hours, Not Days',
    description: 'Apply online and receive your eVisa straight to your inbox.',
  },
};

const POPULAR_COPY = {
  also: {
    subtitle: 'Also Popular',
    title:    'More Destinations, <br /> More Adventures',
  },
  trending: {
    subtitle: 'Trending With UAE Travellers',
    title:    'Where Our Customers <br /> Are Flying Next',
  },
};

const RATINGS_COPY = {
  default: {
    subtitle:    "Don't just take our word for it",
    title:       'Verified by the Platforms You Already Trust',
    description: 'Our ratings are earned - not curated. Check us on any major review platform and see what real travellers say.',
  },
};

const CTA_VARIANTS = {
  apply_today: {
    subtitle:    'Your Journey Starts With a Single Click',
    title:       'Apply for Your<br />Visa Today',
    description: 'Let Rayna Tours take the stress out of visa applications. Fast, simple, and trusted by thousands of travellers.',
    button_text: 'Start Your Application',
    link:        'https://www.raynatours.com/visas',
  },
  ready_to_travel: {
    subtitle:    'Ready When You Are',
    title:       'Pack Your Bags.<br />We&#8217;ll Pack the Paperwork.',
    description: 'Submit your application in minutes — visa specialists do the rest.',
    button_text: 'Apply Now',
    link:        'https://www.raynatours.com/visas',
  },
};

const FOOTER = {
  address: 'Rayna Tours &amp; Travels &middot; Dubai, UAE',
  email:   'info@raynatours.com',
  phone:   '+971 4 000 0000',
};

// ── helpers ───────────────────────────────────────────────────────────────

function withUtm(url, contactId, campaign = 'day3_visa', { journeyId, nodeId } = {}) {
  if (!url) return '#';
  if (!/raynatours\.com/i.test(url)) return url;
  if (/[?&]utm_source=/.test(url)) return url;
  const params = new URLSearchParams({
    utm_source:   'email',
    utm_medium:   'journey',
    utm_campaign: campaign,
  });
  if (contactId) params.set('rid', String(contactId));
  if (journeyId) params.set('journeyId', String(journeyId));
  if (nodeId)    params.set('nodeId', String(nodeId));
  return `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`;
}

/** Restore the input key order — ANY($1) does not preserve it. */
function orderRowsByKeys(rows, keys) {
  const byKey = new Map(rows.map(r => [r.key, r]));
  return keys.map(k => byKey.get(k));
}

function validateRanking(r) {
  if (!r || typeof r !== 'object') {
    throw new Error('[Day3VisaDataService] ranking must be an object');
  }
  for (const k of ['international_keys', 'evisa_keys', 'popular_keys', 'ratings_keys']) {
    if (!Array.isArray(r[k])) throw new Error(`[Day3VisaDataService] ranking.${k} must be an array`);
    if (r[k].length !== 4) {
      console.warn(`[Day3VisaDataService] ranking.${k} has ${r[k].length} items; template expects 4`);
    }
    for (const v of r[k]) {
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`[Day3VisaDataService] ranking.${k} contains non-string key: ${v}`);
      }
    }
  }

  if (r.hero_variant_key       && !HERO_VARIANTS[r.hero_variant_key])         throw new Error(`unknown hero_variant_key: ${r.hero_variant_key}`);
  if (r.international_copy_key && !INTERNATIONAL_COPY[r.international_copy_key]) throw new Error(`unknown international_copy_key: ${r.international_copy_key}`);
  if (r.evisa_copy_key         && !EVISA_COPY[r.evisa_copy_key])              throw new Error(`unknown evisa_copy_key: ${r.evisa_copy_key}`);
  if (r.popular_copy_key       && !POPULAR_COPY[r.popular_copy_key])          throw new Error(`unknown popular_copy_key: ${r.popular_copy_key}`);
  if (r.cta_variant_key        && !CTA_VARIANTS[r.cta_variant_key])           throw new Error(`unknown cta_variant_key: ${r.cta_variant_key}`);

  for (const k of r.ratings_keys || []) {
    if (!RATINGS[k]) throw new Error(`unknown ratings key: ${k}`);
  }
}

// ── public API ────────────────────────────────────────────────────────────

export async function buildDay3VisaData({ contactId, ranking, journeyId, nodeId }) {
  validateRanking(ranking);
  const utm = { journeyId, nodeId };

  // Pick variants (or defaults)
  const hero       = HERO_VARIANTS[ranking.hero_variant_key             || 'passport'];
  const intlCopy   = INTERNATIONAL_COPY[ranking.international_copy_key   || 'abroad'];
  const evisaCopy  = EVISA_COPY[ranking.evisa_copy_key                  || 'online'];
  const popCopy    = POPULAR_COPY[ranking.popular_copy_key              || 'also'];
  const cta        = CTA_VARIANTS[ranking.cta_variant_key                || 'apply_today'];
  const ratingsCp  = RATINGS_COPY.default;

  // ── one query for all visa rows used in this email ────────────────────
  const allKeys = [
    ...ranking.international_keys,
    ...ranking.evisa_keys,
    ...ranking.popular_keys,
  ];
  const { rows: visaRows } = await query(`
    SELECT key, name, country_label, flag_unicode, flag_url,
           types_html, details_html, status, image_url, default_link,
           categories, region
      FROM visa_products
     WHERE enabled = TRUE AND key = ANY($1::text[])
  `, [allKeys]);

  const intlRows    = orderRowsByKeys(visaRows, ranking.international_keys);
  const evisaRows   = orderRowsByKeys(visaRows, ranking.evisa_keys);
  const popularRows = orderRowsByKeys(visaRows, ranking.popular_keys);

  // Surface missing keys loudly — better than silently dropping cards
  const missing = (rows, keys, slot) => keys.filter((k, i) => !rows[i]).map(k => `${slot}:${k}`);
  const allMissing = [
    ...missing(intlRows,    ranking.international_keys, 'international'),
    ...missing(evisaRows,   ranking.evisa_keys,         'evisa'),
    ...missing(popularRows, ranking.popular_keys,       'popular'),
  ];
  if (allMissing.length > 0) {
    throw new Error(`[Day3VisaDataService] visa keys not found in catalog: ${allMissing.join(', ')}`);
  }

  // hero_bg_image_override allows Anthropic / caller to inject any URL.
  const heroBgImage = ranking.hero_bg_image_override || hero.bg_image;

  return {
    hero: {
      bg_image:    heroBgImage,
      title:       hero.title,
      description: hero.description,
    },

    international_travel: {
      subtitle:    intlCopy.subtitle,
      title:       intlCopy.title,
      description: intlCopy.description,
      visas: intlRows.map(v => ({
        name:  v.name,
        flag:  v.flag_unicode || '',
        types: v.types_html   || '',
        image: v.image_url,
        link:  withUtm(v.default_link, contactId, 'day3_visa', utm),
      })),
    },

    evisa_section: {
      subtitle:    evisaCopy.subtitle,
      title:       evisaCopy.title,
      description: evisaCopy.description,
      items: evisaRows.map(v => ({
        name:    v.name,
        country: v.country_label || '',
        flag:    v.flag_unicode || '',
        details: v.details_html || '',
        image:   v.image_url,
        link:    withUtm(v.default_link, contactId, 'day3_visa', utm),
        status:  v.status || 'Online',
      })),
    },

    popular_destinations: {
      subtitle: popCopy.subtitle,
      title:    popCopy.title,
      items: popularRows.map(v => ({
        name:  v.name,
        image: v.image_url,
        link:  withUtm(v.default_link, contactId, 'day3_visa', utm),
      })),
    },

    ratings: {
      subtitle:    ratingsCp.subtitle,
      title:       ratingsCp.title,
      description: ratingsCp.description,
      items: ranking.ratings_keys.map(key => RATINGS[key]),
    },

    cta: {
      subtitle:    cta.subtitle,
      title:       cta.title,
      description: cta.description,
      button_text: cta.button_text,
      link:        withUtm(cta.link, contactId, 'day3_visa', utm),
    },

    footer: {
      address: FOOTER.address,
      email:   FOOTER.email,
      phone:   FOOTER.phone,
    },
  };
}

// Exports for testing / extension
export const _internals = {
  RATINGS, HERO_VARIANTS, INTERNATIONAL_COPY, EVISA_COPY, POPULAR_COPY,
  RATINGS_COPY, CTA_VARIANTS, FOOTER,
  withUtm, orderRowsByKeys, validateRanking,
};

export default buildDay3VisaData;
