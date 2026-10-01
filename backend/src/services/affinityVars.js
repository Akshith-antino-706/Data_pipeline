import { query } from '../config/database.js';

/**
 * affinityVars — per-contact template variables from user_affinity_top3
 * (built nightly by BookingAffinityService):
 *
 *   product_affinity_1..3   the contact's top booked products, e.g. "Burj Khalifa"
 *   service_affinity_1..3   the contact's top business lines, e.g. "Tours"
 *
 * Contacts without bookings get empty strings, so templates can fall back with
 * {{ product_affinity_1 | default: 'our top experiences' }} or {% if product_affinity_1 %}.
 * Lookups never throw — a failed lookup returns empty values so a send is never blocked.
 */

const SERVICE_LABEL = { tours: 'Tours', packages: 'Packages', hotels: 'Hotels', visas: 'Visas', flights: 'Flights', others: 'Others' };
const RANKS = [1, 2, 3];
const COLUMNS = RANKS.flatMap(r => [`product_${r}_name`, `service_${r}`]).join(', ');

export const AFFINITY_VAR_KEYS = [
  ...RANKS.map(r => `product_affinity_${r}`),
  ...RANKS.map(r => `service_affinity_${r}`),
];

function toVars(row) {
  const vars = {};
  for (const r of RANKS) {
    vars[`product_affinity_${r}`] = row?.[`product_${r}_name`] || '';
    vars[`service_affinity_${r}`] = SERVICE_LABEL[row?.[`service_${r}`]] || row?.[`service_${r}`] || '';
  }
  return vars;
}

export const EMPTY_AFFINITY_VARS = Object.freeze(toVars(null));

// Sample values for previews, test sends and template QA.
export const SAMPLE_AFFINITY_VARS = Object.freeze({
  product_affinity_1: 'Desert Safari', product_affinity_2: 'Burj Khalifa', product_affinity_3: 'Dhow Cruise',
  service_affinity_1: 'Tours', service_affinity_2: 'Visas', service_affinity_3: 'Packages',
});

/**
 * Copy of a vars object without empty affinity keys. Liquid treats '' as true, so a
 * contact with no bookings must reach `{% if product_affinity_1 %}` as nil, not ''.
 */
export function dropEmptyAffinity(vars = {}) {
  const out = { ...vars };
  for (const k of AFFINITY_VAR_KEYS) if (!out[k]) delete out[k];
  return out;
}

const AFFINITY_RE = /(product|service)_affinity_[123]/i;
/** Does this template text use any affinity variable? Lets callers skip the lookup. */
export function usesAffinity(...texts) {
  return texts.some(t => typeof t === 'string' && AFFINITY_RE.test(t));
}

/** Variables for one contact. */
export async function getAffinityVars(unifiedId) {
  if (!unifiedId) return { ...EMPTY_AFFINITY_VARS };
  try {
    const { rows } = await query(`SELECT ${COLUMNS} FROM user_affinity_top3 WHERE unified_id = $1`, [unifiedId]);
    return toVars(rows[0]);
  } catch (err) {
    console.warn(`[affinityVars] lookup failed for ${unifiedId}: ${err.message}`);
    return { ...EMPTY_AFFINITY_VARS };
  }
}

/** Variables for many contacts in one query → Map(String(unifiedId) → vars). Missing ids aren't in the map. */
export async function getAffinityVarsMany(unifiedIds) {
  const map = new Map();
  const ids = [...new Set((unifiedIds || []).filter(id => id != null && id !== '').map(String))];
  if (!ids.length) return map;
  try {
    const { rows } = await query(`SELECT unified_id, ${COLUMNS} FROM user_affinity_top3 WHERE unified_id = ANY($1::bigint[])`, [ids]);
    for (const row of rows) map.set(String(row.unified_id), toVars(row));
  } catch (err) {
    console.warn(`[affinityVars] batch lookup failed (${ids.length} ids): ${err.message}`);
  }
  return map;
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// {{product_affinity_1}}, {{ PRODUCT_AFFINITY_1 }}, {{ product_affinity_1 | default: 'x' }}
const FILL_RE = /\{\{\s*((?:product|service)_affinity_[123])\s*(?:\|\s*default\s*:\s*(['"])([\s\S]*?)\2\s*)?\}\}/gi;

/**
 * Fill affinity placeholders in already-rendered text (used where one stored HTML is
 * shared by every recipient). Empty value → the inline default, else blank.
 * `html: true` escapes values for HTML bodies; subjects are plain text.
 */
export function fillAffinityVars(text, vars, { html = true } = {}) {
  if (!text) return text;
  return String(text).replace(FILL_RE, (_m, key, _q, inlineDefault) => {
    const v = vars?.[key.toLowerCase()] || inlineDefault || '';
    return html ? escHtml(v) : v;
  });
}
