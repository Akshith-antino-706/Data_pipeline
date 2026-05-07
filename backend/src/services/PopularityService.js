import { randomUUID, createHash } from 'crypto';
import { query } from '../config/database.js';

/**
 * PopularityService — produces a top-N list of products for a given product
 * type, frozen into popularity_snapshots so every journey entry fired in the
 * same run renders the same products.
 *
 * Provider precedence (first matching wins):
 *   1. ANTHROPIC_API_KEY   → Anthropic Messages API + web_search ranks the
 *                            internal Rayna catalog by current popularity.
 *                            Catalog stays in this file (real raynatours.com
 *                            URLs); the LLM only re-orders + selects top-N.
 *   2. POPULARITY_API_URL  → external popularity REST endpoint (legacy).
 *   3. (none)              → deterministic simulation pool.
 *
 * Anthropic env:
 *   ANTHROPIC_API_KEY        required
 *   ANTHROPIC_POPULARITY_MODEL  optional, default 'claude-sonnet-4-6'
 *   ANTHROPIC_POPULARITY_MAX_USES  optional, default 3 (web_search calls)
 */

const DEFAULT_LIMITS = { activity: 8, cruise: 6, holiday: 15, destination: 6 };

/** Hardcoded simulation rows (mirror the day5/day2/day4 originals). */
const SIM_PRODUCTS = {
  activity: [
    { theme: 'thrill', name: 'Jebel Jais Zipline',     category: 'Adventure', location: 'Ras Al Khaimah', duration: '3-4 Hours', price: 'From AED 370',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Jebel-Jais-Zipline-8937/1760337317788_3_2.jpg', product_url: 'https://www.raynatours.com/ras-al-khaimah/adventures-tours/jebel-jais-zipline-e-8937' },
    { theme: 'thrill', name: 'Desert Buggy Drive',     category: 'Adventure', location: 'Dubai',          duration: '2-3 Hours', price: 'From AED 1,500', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Dune-Buggy-Dubai-508239/1760004762625_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/desert-safari-tours/dune-buggy-dubai-e-508239' },
    { theme: 'thrill', name: 'iFly Singapore',          category: 'Skydiving', location: 'Singapore',      duration: '1-2 Hours', price: 'From AED 253',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/iFly-Singapore-6329/1760693733077_3_2.jpg', product_url: 'https://www.raynatours.com/singapore/sentosa-island-tours/ifly-singapore-e-6329' },
    { theme: 'thrill', name: 'AJ Hackett Sentosa',      category: 'Bungee',    location: 'Singapore',      duration: '2-3 Hours', price: 'From AED 156',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/AJ-Hackett-Sentosa-6328/1760955102124_3_2.jpg', product_url: 'https://www.raynatours.com/singapore/sentosa-island-tours/aj-hackett-sentosa-e-6328' },
    { theme: 'family', name: 'IMG Worlds of Adventure', category: 'Theme Park', location: 'Dubai',         duration: 'Full Day',  price: 'From AED 180',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/IMG-Worlds-of-Adventure-4753/1760008208926_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/theme-parks/img-worlds-of-adventure-e-4753' },
    { theme: 'family', name: 'Ferrari World Abu Dhabi', category: 'Theme Park', location: 'Abu Dhabi',     duration: 'Full Day',  price: 'From AED 75',   image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Ferrari-World-Theme-Park-57/1760007059152_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/theme-parks/ferrari-world-theme-park-e-57' },
    { theme: 'family', name: 'Universal Studios Singapore', category: 'Theme Park', location: 'Singapore', duration: 'Full Day',  price: 'From AED 220',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Universal-Studios-Singapore-4686/1760778918864_3_2.jpg', product_url: 'https://www.raynatours.com/singapore/theme-parks/universal-studios-singapore-e-4686' },
    { theme: 'family', name: 'Safari World Bangkok',    category: 'Safari',    location: 'Bangkok',        duration: 'Full Day',  price: 'From AED 33',   image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Safari-World-Bangkok-510002/1767956469411_3_2.jpg', product_url: 'https://www.raynatours.com/bangkok/nature-and-wildlife/safari-world-bangkok-e-510002' },
    { theme: 'icons',  name: 'Burj Khalifa At The Top', category: 'Iconic',    location: 'Dubai',          duration: '1-2 Hours', price: 'From AED 145',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Burj-Khalifa-At-The-Top-Tickets-18/1759833985818_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/burj-khalifa-tickets/burj-khalifa-at-the-top-tickets-e-18' },
    { theme: 'icons',  name: 'Museum of the Future',    category: 'Iconic',    location: 'Dubai',          duration: '1-2 Hours', price: 'From AED 159',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Museum-of-the-Future-5116/1760437357981_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/museums/museum-of-the-future-e-5116' },
    { theme: 'icons',  name: 'Gardens by the Bay',      category: 'Iconic',    location: 'Singapore',      duration: '2-3 Hours', price: 'From AED 88',   image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Gardens-by-the-Bay-4684/1760687052897_3_2.jpg', product_url: 'https://www.raynatours.com/singapore/nature-and-wildlife/gardens-by-the-bay-e-4684' },
    { theme: 'icons',  name: 'Marina Bay Sands SkyPark', category: 'Iconic',   location: 'Singapore',      duration: '1-2 Hours', price: 'From AED 95',   image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Marina-Bay-Sands-Sky-Park-5354/1760695468917_3_2.jpg', product_url: 'https://www.raynatours.com/singapore/city-tours/marina-bay-sands-skypark-e-5354' },
    { theme: 'cruises_and_islands', name: 'Dhow Cruise Dinner - Marina', category: 'Cruise',  location: 'Dubai',     duration: '2-3 Hours', price: 'From AED 65',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Dhow-Cruise-Dinner---Marina-87/1767782326362_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/dhow-cruise/dhow-cruise-dinner---marina-e-87' },
    { theme: 'cruises_and_islands', name: 'Adventure Cove Water Park',   category: 'Waterpark',location: 'Singapore', duration: 'Full Day',  price: 'From AED 77',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Adventure-Cove-Water-Park-5353/1760692038977_3_2.jpg', product_url: 'https://www.raynatours.com/singapore/sentosa-island-tours/adventure-cove-water-park-e-5353' },
    { theme: 'cruises_and_islands', name: 'Phi Phi Island Speedboat',    category: 'Island',  location: 'Phuket',    duration: 'Full Day',  price: 'From AED 112', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Phi-Phi-Island-on-Speed-Boat-509762/1768630073293_3_2.jpg', product_url: 'https://www.raynatours.com/phuket/island-tours/phi-phi-island-on-speed-boat-e-509762' },
    { theme: 'cruises_and_islands', name: 'James Bond Island Speedboat', category: 'Island',  location: 'Phuket',    duration: 'Full Day',  price: 'From AED 125', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/James-Bond-Island-on-Speed-Boat-509779/1768644313676_3_2.jpg', product_url: 'https://www.raynatours.com/phuket/island-tours/james-bond-island-on-speed-boat-e-509779' },
    { theme: 'wildlife', name: 'Dubai Aquarium & Underwater Zoo', category: 'Aquarium', location: 'Dubai',     duration: '2-3 Hours', price: 'From AED 145', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Dubai-Aquarium-and-Underwater-Zoo-3636/1759917679577_3_2.jpg', product_url: 'https://www.raynatours.com/dubai/theme-parks/dubai-aquarium-and-underwater-zoo-e-3636' },
    { theme: 'wildlife', name: 'National Aquarium Abu Dhabi',     category: 'Aquarium', location: 'Abu Dhabi', duration: '2-3 Hours', price: 'From AED 104', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/false-5901/Aquarium-Abu-Dhabi-01.jpg', product_url: 'https://www.raynatours.com/abu-dhabi/theme-parks/the-national-aquarium-abu-dhabi-e-5901' },
    { theme: 'wildlife', name: 'Night Safari Singapore',          category: 'Wildlife', location: 'Singapore', duration: '3-4 Hours', price: 'From AED 145', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Night-Safari-Singapore-4683/placeholder.jpg', product_url: 'https://www.raynatours.com/singapore/nature-and-wildlife/night-safari-singapore-e-4683' },
    { theme: 'wildlife', name: 'Dubai Safari Park',               category: 'Wildlife', location: 'Dubai',     duration: 'Half Day',  price: 'From AED 50',  image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Dubai-Safari-Park/placeholder.jpg', product_url: 'https://www.raynatours.com/dubai/nature-and-wildlife/dubai-safari-park' },
  ],
  cruise: [
    { name: 'Costa Smeralda Mediterranean Cruise', category: 'Cruise', location: 'Barcelona',  duration: '7 Nights', price: 'From AED 2,400', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Cruise-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/barcelona-cruises/costa-smeralda-mediterranean-spring-escape-cruise-392' },
    { name: 'Royal Caribbean Western Med',         category: 'Cruise', location: 'Barcelona',  duration: '7 Nights', price: 'From AED 3,100', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Cruise-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/barcelona-cruises/royal-caribbean-western-mediterranean-cruise-440' },
    { name: 'MSC Euribia North Europe',            category: 'Cruise', location: 'Copenhagen', duration: '7 Nights', price: 'From AED 2,800', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Cruise-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/copenhagen-cruises/msc-euirbia-copenhagen-hellesylt-alesund-flaam-kiel-391' },
    { name: 'Aroya Gulf-to-Red-Sea Cruise',        category: 'Cruise', location: 'Dubai',      duration: '5 Nights', price: 'From AED 2,200', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Cruise-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/dubai-cruises/aroya-gulf-to-red-sea-passage-cruise-488' },
    { name: 'Singapore Cruise Holidays',           category: 'Cruise', location: 'Singapore',  duration: '4 Nights', price: 'From AED 1,800', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Cruise-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/singapore-packages/singapore-cruise-holidays-725' },
    { name: 'Jeddah Red Sea Escape',               category: 'Cruise', location: 'Jeddah',     duration: '6 Nights', price: 'From AED 2,600', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Cruise-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/jeddah-cruises' },
  ],
  holiday: [
    { name: 'Abu Dhabi Stay & Play Luxury',  category: 'Package', location: 'Abu Dhabi', duration: '3 Nights', price: 'From AED 1,800', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/abu-dhabi-packages/abu-dhabi-stay-and-play-luxury-package-628' },
    { name: 'Best of Kazakhstan',            category: 'Package', location: 'Almaty',    duration: '5 Nights', price: 'From AED 2,400', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/almaty-packages/best-of-kazakhstan-441' },
    { name: 'Azerbaijan Super Saver',        category: 'Package', location: 'Baku',      duration: '4 Nights', price: 'From AED 1,950', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/baku-packages/azerbaijan-super-saver-304' },
    { name: 'Bali Tropical Treasures',       category: 'Package', location: 'Bali',      duration: '6 Nights', price: 'From AED 3,200', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/bali-packages/bali-tropical-treasures-516' },
    { name: 'Classic Bangkok & Pattaya',     category: 'Package', location: 'Bangkok',   duration: '5 Nights', price: 'From AED 2,100', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/bangkok-packages/classic-bangkok-and-pattaya-holidays-487' },
    { name: 'Singapore Family Fun',          category: 'Package', location: 'Singapore', duration: '4 Nights', price: 'From AED 2,800', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/singapore-packages/singapore-family-fun-package-716' },
    { name: 'Singapore Classic Highlights',  category: 'Package', location: 'Singapore', duration: '5 Nights', price: 'From AED 3,000', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/singapore-packages/singapore-classic-highlights-tour-712' },
    { name: 'Exclusive Singapore & Sentosa', category: 'Package', location: 'Singapore', duration: '6 Nights', price: 'From AED 3,400', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/singapore-packages/exclusive-singapore-and-sentosa-tour-728' },
    { name: 'Dubai City Highlights',         category: 'Package', location: 'Dubai',     duration: '3 Nights', price: 'From AED 1,600', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/dubai-city-packages' },
    { name: 'Tbilisi Mountain Escape',       category: 'Package', location: 'Tbilisi',   duration: '5 Nights', price: 'From AED 2,300', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/tbilisi-packages' },
    { name: 'Phuket Beach Getaway',          category: 'Package', location: 'Phuket',    duration: '4 Nights', price: 'From AED 2,000', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/phuket-activities' },
    { name: 'Kuala Lumpur Discovery',        category: 'Package', location: 'Kuala Lumpur', duration: '4 Nights', price: 'From AED 2,150', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/kuala-lumpur-activities' },
    { name: 'Rome Cultural Cruise',          category: 'Package', location: 'Rome',      duration: '7 Nights', price: 'From AED 3,500', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/rome-cruises' },
    { name: 'Dubai Activities Saver',        category: 'Package', location: 'Dubai',     duration: '3 Nights', price: 'From AED 1,400', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/dubai-activities' },
    { name: 'Singapore Activities Pass',     category: 'Package', location: 'Singapore', duration: '3 Nights', price: 'From AED 1,750', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg', product_url: 'https://www.raynatours.com/singapore-activities' },
  ],
  // City spotlights for the day-14 destinations email. price/duration are
  // intentionally absent (renderer treats them as optional); category carries
  // the country so the card chrome shows "DESTINATION · UAE" etc.
  destination: [
    { name: 'Dubai',        category: 'Destination · UAE',       location: 'United Arab Emirates', duration: 'Year-round',    price: 'Packages from AED 1,400', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Burj-Khalifa-At-The-Top-Tickets-18/1759833985818_3_2.jpg',     product_url: 'https://www.raynatours.com/dubai-activities' },
    { name: 'Abu Dhabi',    category: 'Destination · UAE',       location: 'United Arab Emirates', duration: 'Year-round',    price: 'Packages from AED 1,800', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Ferrari-World-Theme-Park-57/1760007059152_3_2.jpg',          product_url: 'https://www.raynatours.com/abu-dhabi-packages' },
    { name: 'Singapore',    category: 'Destination · Singapore', location: 'Singapore',            duration: '4–6 Nights',    price: 'Packages from AED 1,750', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Gardens-by-the-Bay-4684/1760687052897_3_2.jpg',             product_url: 'https://www.raynatours.com/singapore-packages' },
    { name: 'Bali',         category: 'Destination · Indonesia', location: 'Indonesia',            duration: '5–7 Nights',    price: 'Packages from AED 3,200', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg',                                              product_url: 'https://www.raynatours.com/bali-packages' },
    { name: 'Phuket',       category: 'Destination · Thailand',  location: 'Thailand',             duration: '4–6 Nights',    price: 'Packages from AED 2,000', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Phi-Phi-Island-on-Speed-Boat-509762/1768630073293_3_2.jpg', product_url: 'https://www.raynatours.com/phuket-activities' },
    { name: 'Bangkok',      category: 'Destination · Thailand',  location: 'Thailand',             duration: '4–5 Nights',    price: 'Packages from AED 2,100', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Safari-World-Bangkok-510002/1767956469411_3_2.jpg',        product_url: 'https://www.raynatours.com/bangkok-packages' },
    { name: 'Kuala Lumpur', category: 'Destination · Malaysia',  location: 'Malaysia',             duration: '3–4 Nights',    price: 'Packages from AED 2,150', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg',                                              product_url: 'https://www.raynatours.com/kuala-lumpur-activities' },
    { name: 'Tbilisi',      category: 'Destination · Georgia',   location: 'Georgia',              duration: '4–5 Nights',    price: 'Packages from AED 2,300', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg',                                              product_url: 'https://www.raynatours.com/tbilisi-packages' },
    { name: 'Baku',         category: 'Destination · Azerbaijan',location: 'Azerbaijan',           duration: '3–5 Nights',    price: 'Packages from AED 1,950', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg',                                              product_url: 'https://www.raynatours.com/baku-packages' },
    { name: 'Almaty',       category: 'Destination · Kazakhstan',location: 'Kazakhstan',           duration: '4–6 Nights',    price: 'Packages from AED 2,400', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg',                                              product_url: 'https://www.raynatours.com/almaty-packages' },
    { name: 'Ras Al Khaimah', category: 'Destination · UAE',     location: 'United Arab Emirates', duration: 'Day trips',     price: 'Activities from AED 370', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/Final/Jebel-Jais-Zipline-8937/1760337317788_3_2.jpg',           product_url: 'https://www.raynatours.com/ras-al-khaimah-activities' },
    { name: 'Rome',         category: 'Destination · Italy',     location: 'Italy',                duration: '5–7 Nights',    price: 'Cruises from AED 3,500', image_url: 'https://d2cazmkfw8kdtj.cloudfront.net/Holiday-Images/placeholder.jpg',                                              product_url: 'https://www.raynatours.com/rome-cruises' },
  ],
};

export default class PopularityService {

  static newRunId() {
    return randomUUID();
  }

  /**
   * Deterministic per-(journey, day) run id. Both the T-60 prewarm cron and
   * the actual journey processing call this with the same `bucketTs` (any
   * timestamp inside the same UTC day), so they end up writing/reading rows
   * keyed on the same run_id. The popularity_snapshots UNIQUE constraint
   * makes the second writer (the fire-time lazy snapshot) a no-op when
   * prewarm already populated the day's bucket.
   *
   * Day buckets line up with the daily journey cron at 1 AM UTC — prewarm at
   * 0 AM UTC and processing at 1 AM UTC are inside the same UTC day, so they
   * share a run_id.
   *
   * UUID v5-style: SHA-1 of "<journeyId>|<bucketKey>" formatted as UUID.
   */
  static runIdForBucket(journeyId, bucketTs = new Date()) {
    const bucketKey = new Date(bucketTs).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const h = createHash('sha1').update(`${journeyId}|${bucketKey}`).digest('hex');
    // Lay out as a v5-shaped UUID. Variant + version nibbles hand-set so it
    // parses cleanly as a UUID anywhere we read it back.
    const v5 =
      `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-` +
      `${(parseInt(h.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, '0')}${h.slice(18, 20)}-` +
      `${h.slice(20, 32)}`;
    return v5;
  }

  /** Returns 'anthropic' | 'http' | 'simulation' — for log lines. */
  static provider() {
    const k = process.env.ANTHROPIC_API_KEY;
    // Treat the .env placeholder as unset so the service falls back cleanly
    // until the user pastes a real key in.
    if (k && !k.includes('REPLACE_ME')) return 'anthropic';
    if (process.env.POPULARITY_API_URL) return 'http';
    return 'simulation';
  }

  /** Kept for backward compat with verify-general-broadcast.js. */
  static isConfigured() {
    return this.provider() !== 'simulation';
  }

  /**
   * Fetch popular products for one (product_type, theme?) bucket.
   * Returns a normalized list — the rendering layer does not look at raw API JSON.
   */
  static async fetchTopProducts({ productType, limit, country = null, theme = null } = {}) {
    const effLimit = limit || DEFAULT_LIMITS[productType] || 8;
    const provider = this.provider();

    if (provider === 'anthropic') {
      try {
        return await this._anthropicRank({ productType, limit: effLimit, country, theme });
      } catch (err) {
        // Anthropic ranking is best-effort. If it fails (timeout, rate limit,
        // bad JSON), fall back to the deterministic catalog so the journey
        // still sends. The error is logged but not surfaced to the worker.
        console.error(`[PopularityService] Anthropic ranking failed (${productType}/${theme || '_'}): ${err.message} — falling back to catalog order`);
        return this._simulationProducts({ productType, limit: effLimit, theme });
      }
    }

    if (provider === 'http') {
      const url = this._buildUrl({ productType, limit: effLimit, country, theme });
      const headers = { Accept: 'application/json' };
      if (process.env.POPULARITY_API_AUTH) {
        headers.Authorization = process.env.POPULARITY_API_AUTH;
      } else if (process.env.POPULARITY_API_KEY) {
        headers.Authorization = `Bearer ${process.env.POPULARITY_API_KEY}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let raw;
      try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`Popularity API ${res.status}: ${await res.text().catch(() => '')}`);
        raw = await res.json();
      } finally {
        clearTimeout(timeout);
      }

      return this._normalize(raw, { productType, theme }).slice(0, effLimit);
    }

    return this._simulationProducts({ productType, limit: effLimit, theme });
  }

  /**
   * Fetch popular products and persist them into popularity_snapshots
   * keyed by (journey_id, node_id, run_id, product_type, theme).
   * Returns the inserted rows.
   */
  static async snapshot({ journeyId, nodeId, runId, productType, themes = [null], limit, country = null } = {}) {
    if (!journeyId || !nodeId || !runId || !productType) {
      throw new Error('snapshot requires journeyId, nodeId, runId, productType');
    }

    // theme=null collides with itself in Postgres unique constraints (NULLs
    // are distinct in the default UNIQUE semantics, and we're on PG14 so
    // NULLS NOT DISTINCT isn't available). Coerce to a sentinel '_default'
    // string so re-runs of the prewarm/snapshot under the same run_id are
    // genuinely no-ops via ON CONFLICT DO NOTHING. The renderer already maps
    // theme=null/empty/'_default' to the same lookup key in getSnapshot, so
    // SLOT lookups continue to match.
    const themeKey = (t) => t || '_default';

    const all = [];
    for (const theme of themes) {
      const products = await this.fetchTopProducts({ productType, limit, country, theme });
      products.forEach((p, i) => {
        all.push({
          journey_id: journeyId,
          node_id: nodeId,
          run_id: runId,
          product_type: productType,
          theme: themeKey(theme),
          position: i + 1,
          ...p,
        });
      });
    }

    if (all.length === 0) return [];

    // ON CONFLICT DO NOTHING — same (journey_id, node_id, run_id, product_type, theme, position)
    // means the snapshot was already taken in this run; second caller is a no-op.
    const cols = ['journey_id','node_id','run_id','product_type','theme','position',
                  'product_id','name','category','location','duration','price',
                  'image_url','product_url','raw_payload'];
    const params = [];
    const placeholders = all.map((row, i) => {
      const base = i * cols.length;
      params.push(
        row.journey_id, row.node_id, row.run_id, row.product_type, row.theme, row.position,
        row.product_id || null, row.name, row.category, row.location, row.duration, row.price,
        row.image_url, row.product_url, row.raw_payload ? JSON.stringify(row.raw_payload) : null
      );
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`;
    });

    await query(
      `INSERT INTO popularity_snapshots (${cols.join(',')})
       VALUES ${placeholders.join(',')}
       ON CONFLICT (journey_id, node_id, run_id, product_type, theme, position) DO NOTHING`,
      params
    );

    return all;
  }

  /** Read a frozen snapshot back. Returned grouped by theme. */
  static async getSnapshot({ journeyId, nodeId, runId, productType }) {
    const { rows } = await query(
      `SELECT theme, position, product_id, name, category, location, duration, price, image_url, product_url
         FROM popularity_snapshots
        WHERE journey_id = $1 AND node_id = $2 AND run_id = $3 AND product_type = $4
        ORDER BY theme NULLS FIRST, position`,
      [journeyId, nodeId, runId, productType]
    );
    const byTheme = new Map();
    for (const r of rows) {
      const key = r.theme || '_default';
      if (!byTheme.has(key)) byTheme.set(key, []);
      byTheme.get(key).push(r);
    }
    return byTheme;
  }

  // ── Anthropic-backed ranking ──────────────────────────────────

  /**
   * Re-rank the internal Rayna catalog by current popularity using the
   * Anthropic Messages API + web_search. The catalog is the source of truth
   * for product_url / image_url — the model only picks an order and a
   * top-N subset; it never invents URLs.
   *
   * Returns the same normalized shape as fetchTopProducts.
   */
  static async _anthropicRank({ productType, limit, country, theme }) {
    const pool = this._catalogPool({ productType, theme });
    if (pool.length === 0) return [];
    if (pool.length <= limit) return pool.slice(0, limit);  // nothing to rank

    const model       = process.env.ANTHROPIC_POPULARITY_MODEL    || 'claude-sonnet-4-6';
    const maxUses     = parseInt(process.env.ANTHROPIC_POPULARITY_MAX_USES || '3');
    const apiKey      = process.env.ANTHROPIC_API_KEY;
    const audience    = country || 'travelers booking from UAE and India';
    const productHint = productType === 'destination'
      ? 'travel destinations / cities'
      : `travel ${productType}s (e.g., ${productType === 'activity' ? 'tours, attractions, theme parks, experiences' : productType === 'cruise' ? 'cruise sailings' : 'multi-day holiday packages'})`;

    // Catalog gets a stable index so the model only has to return indices.
    const catalogForLLM = pool.map((p, i) => ({
      i, name: p.name, category: p.category, location: p.location,
    }));

    const userPrompt =
      `Pick the ${limit} ${productHint} from the catalog below that are most popular RIGHT NOW for ${audience}. ` +
      `Use web_search to check current travel trends, seasonal interest, recent news / social buzz, and search-volume signals. ` +
      `You MUST only pick items already in the catalog — do not invent products.\n\n` +
      `Catalog (JSON):\n${JSON.stringify(catalogForLLM)}\n\n` +
      `Respond with ONLY a JSON object of this exact shape, no prose, no code fences:\n` +
      `{"ranked_indices": [<integers from "i" field, length=${limit}, ordered most→least popular]}`;

    const body = {
      model,
      max_tokens: 1024,
      system: 'You are a travel industry analyst. You rank existing catalog items by current real-world popularity using web search. You never invent items. You respond with ONLY the requested JSON.',
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
      messages: [{ role: 'user', content: userPrompt }],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let resJson;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Anthropic ${res.status}: ${await res.text().catch(() => '')}`);
      }
      resJson = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    const blocks = resJson.content || [];

    // Capture audit trail: what the model searched for and which URLs it
    // actually opened. Stored on every ranked row so a single SELECT shows
    // exactly which sources informed the popularity ranking.
    const queries = [];
    const sources = [];
    const citations = [];
    for (const b of blocks) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') {
        if (b.input?.query) queries.push(b.input.query);
      }
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) {
          if (r?.url) sources.push({ url: r.url, title: r.title || '' });
        }
      }
      if (b.type === 'text' && Array.isArray(b.citations)) {
        for (const c of b.citations) {
          if (c?.url) citations.push({ url: c.url, title: c.title || '', cited_text: (c.cited_text || '').slice(0, 240) });
        }
      }
    }
    const audit = {
      ranked_by: 'anthropic',
      model,
      queries,                                          // ["best dubai activities 2026", ...]
      sources: sources.slice(0, 20),                    // cap to keep raw_payload bounded
      citations: citations.slice(0, 10),
      stop_reason: resJson.stop_reason || null,
      usage: resJson.usage || null,                     // input/output/web-search tokens for cost audit
    };

    // The final text block is what we parse. Web-search blocks come earlier.
    const textBlock = [...blocks].reverse().find(b => b.type === 'text');
    if (!textBlock?.text) throw new Error('Anthropic returned no text block');

    const indices = this._parseRankedIndices(textBlock.text, pool.length);
    if (indices.length === 0) throw new Error(`Could not parse indices from: ${textBlock.text.slice(0, 200)}`);

    // Map indices → catalog rows, dedupe, take top-N.
    const seen = new Set();
    const ranked = [];
    for (const idx of indices) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const row = pool[idx];
      if (!row) continue;
      ranked.push({
        ...row,
        raw_payload: { ...audit, rank: ranked.length + 1 },
      });
      if (ranked.length >= limit) break;
    }

    // If the model returned fewer than `limit` valid indices, pad with the
    // catalog's natural order so the slot still fills.
    if (ranked.length < limit) {
      for (const [idx, row] of pool.entries()) {
        if (seen.has(idx)) continue;
        ranked.push({ ...row, raw_payload: { ranked_by: 'catalog_fallback' } });
        if (ranked.length >= limit) break;
      }
    }

    return ranked;
  }

  /**
   * Catalog rows for (product_type, theme).
   *
   * IMPORTANT: do NOT include a top-level `theme` field here. The snapshot()
   * caller spreads each row INTO a record that already has `theme` set from
   * its outer loop (see snapshot()); a top-level theme on this object would
   * override the loop's value via spread order and the row would be filed
   * under the wrong theme bucket — breaking SLOT lookups whose marker says
   * theme=null. (We hit exactly this once.)
   */
  static _catalogPool({ productType, theme }) {
    const pool = SIM_PRODUCTS[productType] || [];
    const filtered = theme ? pool.filter(p => p.theme === theme) : pool;
    return filtered.map(p => ({
      product_id:  null,
      name:        p.name,
      category:    p.category,
      location:    p.location,
      duration:    p.duration,
      price:       p.price,
      image_url:   p.image_url,
      product_url: p.product_url,
    }));
  }

  /**
   * Tolerant parser: tries strict JSON first, then strips code fences, then
   * falls back to a regex over `ranked_indices`.
   */
  static _parseRankedIndices(text, poolSize) {
    const tryParse = (s) => {
      try {
        const j = JSON.parse(s);
        const arr = j?.ranked_indices;
        if (!Array.isArray(arr)) return null;
        return arr.map(n => parseInt(n)).filter(n => Number.isInteger(n) && n >= 0 && n < poolSize);
      } catch { return null; }
    };

    const direct = tryParse(text.trim());
    if (direct?.length) return direct;

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      const parsed = tryParse(fenced[1].trim());
      if (parsed?.length) return parsed;
    }

    const obj = text.match(/\{[\s\S]*?"ranked_indices"[\s\S]*?\}/);
    if (obj) {
      const parsed = tryParse(obj[0]);
      if (parsed?.length) return parsed;
    }

    const arr = text.match(/"ranked_indices"\s*:\s*\[([^\]]*)\]/);
    if (arr) {
      const nums = arr[1].split(',').map(s => parseInt(s.trim()))
                          .filter(n => Number.isInteger(n) && n >= 0 && n < poolSize);
      if (nums.length) return nums;
    }

    return [];
  }

  // ── internals ─────────────────────────────────────────────────

  static _buildUrl({ productType, limit, country, theme }) {
    const base = process.env.POPULARITY_API_URL;
    const u = new URL(base.replace('{type}', encodeURIComponent(productType))
                          .replace('{limit}', String(limit))
                          .replace('{country}', country ? encodeURIComponent(country) : ''));
    if (!u.searchParams.has('type'))   u.searchParams.set('type', productType);
    if (!u.searchParams.has('limit'))  u.searchParams.set('limit', String(limit));
    if (country && !u.searchParams.has('country')) u.searchParams.set('country', country);
    if (theme   && !u.searchParams.has('theme'))   u.searchParams.set('theme', theme);
    return u.toString();
  }

  /**
   * Normalize whatever the popularity API returns into our internal shape.
   * The shape is intentionally lenient — drop in your real mapping here.
   */
  static _normalize(raw, { productType, theme }) {
    const list = Array.isArray(raw) ? raw
               : Array.isArray(raw?.products)  ? raw.products
               : Array.isArray(raw?.data)      ? raw.data
               : Array.isArray(raw?.items)     ? raw.items
               : [];
    return list.map(p => ({
      product_id:   p.product_id ?? p.id ?? p.productId ?? null,
      name:         p.name ?? p.title ?? '',
      category:     p.category ?? p.type ?? p.product_type ?? productType,
      location:     p.location ?? p.city ?? p.country ?? '',
      duration:     p.duration ?? '',
      price:        this._formatPrice(p),
      image_url:    p.image_url ?? p.image ?? p.thumbnail ?? '',
      product_url:  p.product_url ?? p.url ?? p.link ?? '',
      raw_payload:  p,
    }));
  }

  static _formatPrice(p) {
    if (typeof p.price === 'string' && p.price) return p.price;
    const amount = p.sale_price ?? p.price_aed ?? p.price ?? p.starting_price;
    const currency = p.currency || 'AED';
    if (!amount) return '';
    return `From ${currency} ${Number(amount).toLocaleString('en-US')}`;
  }

  static _simulationProducts({ productType, limit, theme }) {
    const pool = SIM_PRODUCTS[productType] || [];
    const filtered = theme ? pool.filter(p => p.theme === theme) : pool;
    return filtered.slice(0, limit).map(p => ({
      product_id: null,
      name: p.name,
      category: p.category,
      location: p.location,
      duration: p.duration,
      price: p.price,
      image_url: p.image_url,
      product_url: p.product_url,
      raw_payload: { simulated: true, theme: p.theme || null },
    }));
  }
}
