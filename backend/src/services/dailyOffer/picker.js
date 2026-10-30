/**
 * Daily offer email — product picker (pure functions, no I/O).
 *
 * The 8-day loop:
 *   1 Visa           fixed UAE/USA/Schengen + ranked visas 1–7
 *   2 Holidays       top 5 countries × 3 (multi-destination)
 *   3 Activities     next 5 activity countries × 3
 *   4 Visa           fixed 3 + ranked visas 8–14
 *   5 Cruises        top 10
 *   6 Holidays       top country → top 3 cities × 5 (single destination)
 *   7 Activities     next 5 activity countries × 3
 *   8 Visa           fixed 3 + ranked visas 15–21
 *
 * Which loop day runs today comes from the last daily journey that actually sent
 * (see DailyOfferService) — a skipped day's theme carries over to the next day.
 *
 * "Fresh" rule for holidays and cruises: take the top products by ranking, skipping
 * those sent in that theme's previous email; when the list runs out, refill from the top.
 * Activities walk down the country list (1–5, 6–10, … up to 30, then wrap).
 */
import { isUsable } from './feed.js';

export const LOOP = [
  { loopDay: 1, theme: 'visa', visaFrom: 1, visaTo: 7 },
  { loopDay: 2, theme: 'holiday_multi' },
  { loopDay: 3, theme: 'activities' },
  { loopDay: 4, theme: 'visa', visaFrom: 8, visaTo: 14 },
  { loopDay: 5, theme: 'cruise' },
  { loopDay: 6, theme: 'holiday_single' },
  { loopDay: 7, theme: 'activities' },
  { loopDay: 8, theme: 'visa', visaFrom: 15, visaTo: 21 },
];

// UAE, USA, Schengen — matched by page link so a rename in the feed doesn't break them.
export const FIXED_VISA_SLUGS = ['dubai-visa', 'usa-visa', 'schengen-visa'];
export const ACTIVITY_COUNTRY_CAP = 30;

const byRank = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity);

/** Next loop day after the given one (8 → 1). No previous → 1. */
export function nextLoopDay(lastLoopDay) {
  const n = Number(lastLoopDay);
  if (!Number.isInteger(n) || n < 1 || n > LOOP.length) return 1;
  return (n % LOOP.length) + 1;
}

/** Plain transfers (airport pick-ups, intercity rides) are not offers — tours that include a transfer stay. */
export function isPlainTransfer(p) {
  return p.category.toLowerCase() === 'transfers' ||
    /\/(transfers|ground-transport)\//i.test(p.url);
}

/** Ordered distinct values of `field`, ordered by the smallest `orderField` then best rank. */
function orderedGroups(products, field, orderField) {
  const best = new Map();
  for (const p of products) {
    const k = p[field];
    if (!k) continue;
    const cur = best.get(k);
    const o = p[orderField] ?? Infinity;
    if (!cur || o < cur.order || (o === cur.order && (p.rank ?? Infinity) < cur.rank)) {
      best.set(k, { order: o, rank: p.rank ?? Infinity });
    }
  }
  return [...best.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].rank - b[1].rank)
    .map(([k]) => k);
}

/**
 * Take `n` items from an ordered list, preferring ones not in `skip`; if not enough
 * fresh ones remain, refill from the top of the list. Never returns an item twice
 * or anything in `taken`.
 */
export function takeFresh(list, n, skip = new Set(), taken = new Set()) {
  const out = [];
  for (const p of list) {
    if (out.length >= n) break;
    if (!skip.has(p.key) && !taken.has(p.key)) out.push(p);
  }
  for (const p of list) {
    if (out.length >= n) break;
    if (!out.includes(p) && !taken.has(p.key)) out.push(p);
  }
  return out;
}

function pool(products, type) {
  return products.filter(p => p.type === type && isUsable(p)).sort(byRank);
}

function pickVisa(products, slot) {
  const visas = pool(products, 'visa');
  const fixed = FIXED_VISA_SLUGS.map(s => visas.find(v => v.slug === s)).filter(Boolean);
  const fixedKeys = new Set(fixed.map(v => v.key));
  const ranked = visas
    .filter(v => !fixedKeys.has(v.key) && v.countryOrder !== null)
    .sort((a, b) => a.countryOrder - b.countryOrder || byRank(a, b));
  const want = slot.visaTo - slot.visaFrom + 1;
  let picks = ranked.slice(slot.visaFrom - 1, slot.visaTo);
  if (picks.length < want) picks = takeFresh(ranked, want, new Set(), new Set(picks.map(p => p.key))).concat(picks).slice(0, want);
  return {
    groups: [{ title: 'Visas', subtitle: 'Apply online with Rayna Tours', products: [...fixed, ...picks] }],
    missingFixed: FIXED_VISA_SLUGS.filter(s => !fixed.some(v => v.slug === s)),
  };
}

function pickHolidayMulti(products, prevKeys) {
  const holidays = pool(products, 'holiday');
  const countries = orderedGroups(holidays, 'country', 'countryOrder');
  const groups = [];
  const taken = new Set();
  // Top 5 countries × 3; a country short of products hands its gap to the next one.
  let need = 15;
  for (const country of countries) {
    if (need <= 0) break;
    const per = groups.length < 5 ? 3 : need;
    const items = takeFresh(holidays.filter(h => h.country === country), Math.min(per, need), prevKeys, taken);
    if (!items.length) continue;
    items.forEach(p => taken.add(p.key));
    groups.push({ title: country, subtitle: 'Holiday packages', products: items });
    need -= items.length;
  }
  return { groups };
}

function pickHolidaySingle(products, prevKeys) {
  const holidays = pool(products, 'holiday');
  const country = orderedGroups(holidays, 'country', 'countryOrder')[0];
  if (!country) return { groups: [], country: null };
  const inCountry = holidays.filter(h => h.country === country);
  const cities = orderedGroups(inCountry, 'city', 'cityOrder');
  const groups = [];
  const taken = new Set();
  let need = 15;
  for (const city of cities) {
    if (need <= 0) break;
    const per = groups.length < 3 ? 5 : need;
    const items = takeFresh(inCountry.filter(h => h.city === city), Math.min(per, need), prevKeys, taken);
    if (!items.length) continue;
    items.forEach(p => taken.add(p.key));
    groups.push({ title: city, subtitle: `${country} holiday packages`, products: items });
    need -= items.length;
  }
  return { groups, country };
}

function pickActivities(products, prevCursor) {
  const acts = pool(products, 'activities').filter(p => !isPlainTransfer(p));
  const countries = orderedGroups(acts, 'country', 'countryOrder').slice(0, ACTIVITY_COUNTRY_CAP);
  const n = countries.length;
  if (!n) return { groups: [], cursor: { start: 0, next: 0 } };
  const start = Number.isInteger(prevCursor) && prevCursor >= 0 ? prevCursor % n : 0;
  const groups = [];
  let need = 15;
  let used = 0;
  // Next 5 countries × 3; a country short of products hands its gap to the next one.
  while (need > 0 && used < n) {
    const country = countries[(start + used) % n];
    used += 1;
    const per = groups.length < 5 ? 3 : need;
    const items = acts.filter(a => a.country === country).slice(0, Math.min(per, need));
    if (!items.length) continue;
    groups.push({ title: country, subtitle: 'Things to do', products: items });
    need -= items.length;
    if (groups.length >= 5 && need <= 0) break;
  }
  return { groups, cursor: { start, next: (start + used) % n } };
}

function pickCruise(products, prevKeys) {
  const cruises = pool(products, 'cruise');
  return { groups: [{ title: 'Cruises', subtitle: 'Sail away with Rayna Tours', products: takeFresh(cruises, 10, prevKeys) }] };
}

/** "A", "A & B", "A, B & C"; with more → "A, B, C & more". */
const joinNames = (names, more = false) => {
  if (more) return `${names.join(', ')} & more`;
  return names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
};

/**
 * Pick today's products.
 *   products  normalized feed products (feed.js)
 *   loopDay   1..8
 *   previous  { productKeys: string[] (previous email of the same theme), activityCursor: number|null }
 */
export function pickForLoopDay(products, loopDay, previous = {}) {
  const slot = LOOP.find(s => s.loopDay === loopDay);
  if (!slot) throw new Error(`Unknown loop day ${loopDay}`);
  const prevKeys = new Set(previous.productKeys || []);

  let result;
  let themeName;
  let subjectLead;
  if (slot.theme === 'visa') {
    result = pickVisa(products, slot);
    themeName = 'Visa Offers';
    subjectLead = 'Visas for UAE, USA, Schengen & more';
  } else if (slot.theme === 'holiday_multi') {
    result = pickHolidayMulti(products, prevKeys);
    themeName = 'Holiday Packages';
    subjectLead = `Holidays in ${joinNames(result.groups.slice(0, 3).map(g => g.title), result.groups.length > 3)}`;
  } else if (slot.theme === 'holiday_single') {
    result = pickHolidaySingle(products, prevKeys);
    themeName = `${result.country || 'Holiday'} Holidays`;
    subjectLead = `${result.country || 'Holiday'} holidays`;
  } else if (slot.theme === 'activities') {
    result = pickActivities(products, previous.activityCursor);
    themeName = 'Activities';
    subjectLead = `Things to do in ${joinNames(result.groups.slice(0, 2).map(g => g.title), result.groups.length > 2)}`;
  } else {
    result = pickCruise(products, prevKeys);
    themeName = 'Cruises';
    subjectLead = 'Cruise holidays';
  }

  const groups = result.groups.filter(g => g.products.length);
  const flat = groups.flatMap(g => g.products);
  return {
    loopDay,
    theme: slot.theme,
    themeName,
    subjectLead,
    groups,
    productKeys: flat.map(p => p.key),
    count: flat.length,
    activityCursor: result.cursor ? result.cursor.next : null,
    missingFixedVisas: result.missingFixed || [],
  };
}
