import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Appends ONE row to a CSV file every time a message is skipped by the item-completeness
 * (missing-key) guard — across all three send paths: GTM WhatsApp (per-message), GTM email,
 * and Continuous WhatsApp (batched). No DB table; the file is served publicly at
 *   GET /api/v3/journeys/skip-log.csv
 * and opens directly in Excel / Google Sheets.
 *
 * Override the location with env SKIP_LOG_CSV (default: <backend>/data/skipped-products.csv).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = process.env.SKIP_LOG_CSV || path.join(__dirname, '../../data/skipped-products.csv');

const HEADER = [
  'skipped_at', 'journey_id', 'channel', 'event_id', 'event_name',
  'item_id', 'item_name', 'missing_keys', 'page_url', 'contact_email', 'contact_mobile',
];

// RFC-4180 field escaping: quote if it contains a comma, quote, or newline.
const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default class SkipLogService {
  static get path() { return CSV_PATH; }
  static get header() { return HEADER.join(','); }

  /**
   * Record one skip. Never throws — logging must not break the send loop.
   * @param {object} a
   * @param {number|string} a.journeyId
   * @param {'whatsapp'|'email'} a.channel
   * @param {object} a.eventRow    the gtm_events row (event_id, event_name, page_url, raw_payload)
   * @param {string|number} a.itemId
   * @param {string} [a.itemName]  mapped item name (falls back to raw_payload.itemName)
   * @param {string[]} a.missing   missing field labels, e.g. ['ITEM_PRICE','DESTINATION_CITY']
   * @param {object} [a.contact]   the contact row (email / actual_email / mobile)
   */
  static record({ journeyId, channel, eventRow = {}, itemId, itemName, missing = [], contact = {} } = {}) {
    try {
      const rp = eventRow.raw_payload || {};
      const row = [
        new Date().toISOString(),
        journeyId ?? '',
        channel || '',
        eventRow.event_id ?? '',
        eventRow.event_name ?? '',
        itemId != null ? itemId : '',
        itemName || rp.itemName || '',
        Array.isArray(missing) ? missing.join(', ') : (missing || ''),
        eventRow.page_url || rp.pageUrl || '',
        contact.email || contact.actual_email || '',
        contact.mobile || '',
      ].map(esc).join(',');

      const dir = path.dirname(CSV_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Write the header once, on first creation. appendFileSync is O_APPEND → each line is
      // written atomically, so concurrent skips never interleave a half-row.
      if (!fs.existsSync(CSV_PATH)) fs.appendFileSync(CSV_PATH, HEADER.join(',') + '\n');
      fs.appendFileSync(CSV_PATH, row + '\n');
    } catch (err) {
      console.error('[SkipLog] append failed:', err.message);
    }
  }
}
