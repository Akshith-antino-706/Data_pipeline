#!/usr/bin/env node
/**
 * Smoke test for Day2CruiseDataService.
 *
 * Calls the service with a hand-built ranking and writes the resulting JSON
 * to backend/scripts/day2_cruise_data.smoke.json. Verifies:
 *   - service runs without throwing
 *   - returned shape matches the data.json contract (top-level keys, item counts)
 *   - link URLs are UTM-stamped
 *   - prices are formatted
 *
 * Run: node backend/scripts/smoke_day2_cruise_data.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDay2CruiseData } from '../src/services/Day2CruiseDataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const RANKING = {
  // Real cruise product_ids from the products table (all type='cruise').
  saver_product_ids:    [900965, 900972, 900983],          // 3
  regional_product_ids: [900981, 900983, 900984, 900986],  // 4
  cruise_line_keys:     ['msc', 'costa', 'royal_caribbean', 'genting_dreams'], // 4
  departure_city_keys:  ['abu_dhabi', 'dubai', 'saudi_arabia', 'singapore', 'europe'], // 5
  hero_variant_key:           'horizon',
  regional_copy_variant_key:  'mediterranean',
};

const CONTACT_ID = 'ctc_smoke_01';

function check(cond, msg) {
  if (!cond) { console.error(`[FAIL] ${msg}`); process.exit(1); }
  console.log(`[OK]   ${msg}`);
}

(async () => {
  console.log('→ buildDay2CruiseData(...)');
  const data = await buildDay2CruiseData({ contactId: CONTACT_ID, ranking: RANKING });

  // Top-level shape
  check('hero' in data,             'has hero');
  check('departure_cities' in data, 'has departure_cities');
  check('saver_packages' in data,   'has saver_packages');
  check('regional_cruises' in data, 'has regional_cruises');
  check('cruise_lines' in data,     'has cruise_lines');

  // Counts match the ranking input
  check(data.departure_cities.length === 5, 'departure_cities has 5 items');
  check(data.saver_packages.length    === 3, 'saver_packages has 3 items');
  check(data.regional_cruises.items.length === 4, 'regional_cruises.items has 4 items');
  check(data.cruise_lines.length      === 4, 'cruise_lines has 4 items');

  // Hero copy resolved from variant
  check(typeof data.hero.title === 'string'        && data.hero.title.includes('Horizon'),
        'hero.title resolved from horizon variant');
  check(typeof data.hero.bg_image === 'string'     && data.hero.bg_image.startsWith('http'),
        'hero.bg_image is a URL');

  // Departure cities — last has is_full_width when count is odd
  const lastCity = data.departure_cities[4];
  check(lastCity.is_full_width === true, 'last departure city has is_full_width=true (5 cities → odd)');
  check(data.departure_cities.slice(0, 4).every(c => !('is_full_width' in c)),
        'first four cities do NOT have is_full_width');

  // Saver shape
  for (let i = 0; i < data.saver_packages.length; i++) {
    const s = data.saver_packages[i];
    check(typeof s.region === 'string' && s.region.length > 0,    `saver[${i}].region is set`);
    check(typeof s.title === 'string'  && s.title.length > 0,     `saver[${i}].title is set`);
    check(typeof s.description === 'string',                       `saver[${i}].description is a string`);
    check(/^AED\s/.test(s.price),                                  `saver[${i}].price starts with "AED " (got: ${s.price})`);
    check(/utm_source=email/.test(s.link),                         `saver[${i}].link is UTM-stamped`);
    check(/rid=ctc_smoke_01/.test(s.link),                         `saver[${i}].link carries rid`);
  }

  // Regional shape
  for (let i = 0; i < data.regional_cruises.items.length; i++) {
    const r = data.regional_cruises.items[i];
    check(typeof r.tag === 'string' && r.tag.length > 0, `regional[${i}].tag is set`);
    check(typeof r.title === 'string',                    `regional[${i}].title is set`);
    check(/utm_source=email/.test(r.link),               `regional[${i}].link is UTM-stamped`);
  }

  // Cruise lines
  data.cruise_lines.forEach((l, i) => {
    check(l.name && l.image && l.destinations,        `cruise_lines[${i}] fully populated`);
    check(/utm_source=email/.test(l.link),            `cruise_lines[${i}].link UTM-stamped`);
  });

  // Write output for visual inspection / diffing against friend's data.json
  const out = path.join(__dirname, 'day2_cruise_data.smoke.json');
  fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\n[OK] wrote ${out}`);
  console.log(`     ${JSON.stringify(data).length.toLocaleString()} bytes`);

  process.exit(0);
})().catch(err => {
  console.error(`[ERROR] ${err.stack || err}`);
  process.exit(1);
});
