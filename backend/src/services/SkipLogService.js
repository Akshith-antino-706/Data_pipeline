import db from '../config/database.js';

/**
 * Records every message skipped by the item-completeness (missing-key) guard — across all
 * three send paths: GTM WhatsApp (per-message), GTM email, and Continuous WhatsApp (batched).
 *
 * Stored in the `journey_skip_log` Postgres table (migration 116) — PERMANENT: survives
 * container rebuilds/redeploys/restarts and is shared by the backend + giveaway-consumer
 * containers. The GET /api/v3/journeys/skip-log.csv endpoint renders this table as CSV,
 * NEWEST FIRST.
 */
const COLS = ['skipped_at', 'journey_id', 'channel', 'event_id', 'event_name',
              'item_id', 'item_name', 'missing_keys', 'page_url'];

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export default class SkipLogService {
  static get columns() { return COLS; }
  static get header() { return COLS.join(','); }

  /**
   * Record one skip. Never throws — logging must not break the send loop.
   * @param {object} a
   * @param {number|string} a.journeyId
   * @param {'whatsapp'|'email'} a.channel
   * @param {object} a.eventRow   the gtm_events row (event_id, event_name, page_url, raw_payload)
   * @param {string|number} a.itemId
   * @param {string} [a.itemName] mapped item name (falls back to raw_payload.itemName)
   * @param {string[]} a.missing  missing field labels, e.g. ['ITEM_PRICE','DESTINATION_CITY']
   */
  static async record({ journeyId, channel, eventRow = {}, itemId, itemName, missing = [] } = {}) {
    try {
      const rp = eventRow.raw_payload || {};
      await db.query(
        `INSERT INTO journey_skip_log
           (journey_id, channel, event_id, event_name, item_id, item_name, missing_keys, page_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          journeyId ?? null,
          channel || null,
          eventRow.event_id ?? null,
          eventRow.event_name ?? null,
          itemId != null ? String(itemId) : null,
          (itemName || rp.itemName || '') || null,
          Array.isArray(missing) ? (missing.join(', ') || null) : (missing || null),
          eventRow.page_url || rp.pageUrl || null,
        ]
      );
    } catch (err) {
      console.error('[SkipLog] insert failed:', err.message);
    }
  }

  /** Render the whole table as a CSV string, NEWEST FIRST. */
  static async toCsv() {
    const { rows } = await db.query(
      `SELECT to_char(skipped_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS skipped_at,
              journey_id, channel, event_id, event_name, item_id, item_name, missing_keys, page_url
       FROM journey_skip_log
       ORDER BY skipped_at DESC, id DESC`
    );
    const lines = [COLS.join(',')];
    for (const r of rows) lines.push(COLS.map((c) => esc(r[c])).join(','));
    return lines.join('\n') + '\n';
  }
}
