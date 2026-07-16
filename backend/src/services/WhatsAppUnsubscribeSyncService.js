/**
 * WhatsAppUnsubscribeSyncService
 *
 * Syncs WhatsApp unsubscribe events from MYSQL2 (5.79.64.193 / chats DB)
 * `unsubscribed` table → RDS `unified_contacts.wa_unsubscribe`.
 *
 * Source table schema (all rows are type='message', i.e. WhatsApp):
 *   id, destination (phone digits, no leading '+'), type, created_at
 *
 * Match key: unified_contacts.mobile = destination (both stripped to digits).
 * Set wa_unsubscribe = 'Yes' where currently not 'Yes'.
 *
 * Uses sync_metadata.wa_unsubscribe_sync.last_synced_at as a watermark so each
 * run only scans rows created since the last successful run.
 *
 * This is additive to UnsubscribeSyncService (which handles EMAIL unsubscribe
 * from primary MySQL). They target different columns and cannot interfere.
 */

import { mysqlQuery } from '../config/mysql.js';
import db from '../config/database.js';

const SYNC_KEY = 'wa_unsubscribe_sync';
const BATCH = 5000;

async function readWatermark() {
  const { rows } = await db.query(
    `SELECT last_synced_at FROM sync_metadata WHERE table_name = $1`,
    [SYNC_KEY]
  );
  if (rows.length === 0) {
    await db.query(
      `INSERT INTO sync_metadata (table_name) VALUES ($1) ON CONFLICT DO NOTHING`,
      [SYNC_KEY]
    );
    return new Date('1970-01-01T00:00:00Z');
  }
  return new Date(rows[0].last_synced_at);
}

async function writeMetadata({ rowsSynced, durationMs, status, error, watermarkAdvance }) {
  await db.query(
    `INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (table_name) DO UPDATE SET
       last_synced_at   = EXCLUDED.last_synced_at,
       rows_synced      = EXCLUDED.rows_synced,
       sync_status      = EXCLUDED.sync_status,
       error_message    = EXCLUDED.error_message,
       sync_duration_ms = EXCLUDED.sync_duration_ms,
       updated_at       = NOW()`,
    [SYNC_KEY, watermarkAdvance, rowsSynced, status, error || null, durationMs]
  );
}

function normalizePhone(p) {
  return p ? String(p).replace(/[^0-9]/g, '') : null;
}

export default class WhatsAppUnsubscribeSyncService {

  static async sync({ triggeredBy = 'cron' } = {}) {
    const start = Date.now();
    const startedAt = new Date();
    const summary = {
      triggeredBy,
      startedAt: startedAt.toISOString(),
      watermarkFrom: null,
      mysqlRowsFetched: 0,
      flipped: 0,
      durationMs: 0,
      status: 'success',
      error: null,
    };

    try {
      const watermark = await readWatermark();
      summary.watermarkFrom = watermark.toISOString();
      console.log(`[WAUnsubSync] Starting — watermark=${summary.watermarkFrom} triggeredBy=${triggeredBy}`);

      const rows = await mysqlQuery(
        `SELECT destination, created_at FROM unsubscribed
         WHERE type = 'message' AND created_at > ?
         ORDER BY created_at ASC`,
        [watermark],
        'chats'
      );
      summary.mysqlRowsFetched = rows.length;
      console.log(`[WAUnsubSync] Fetched ${rows.length} MYSQL2 rows since watermark`);

      if (rows.length === 0) {
        summary.durationMs = Date.now() - start;
        await writeMetadata({
          rowsSynced: 0, durationMs: summary.durationMs, status: 'success',
          error: null, watermarkAdvance: startedAt,
        });
        return summary;
      }

      const phones = [...new Set(rows.map(r => normalizePhone(r.destination)).filter(Boolean))];

      let flipped = 0;
      for (let i = 0; i < phones.length; i += BATCH) {
        const chunk = phones.slice(i, i + BATCH);
        const { rowCount } = await db.query(
          `UPDATE unified_contacts
           SET wa_unsubscribe = 'Yes', updated_at = NOW()
           WHERE mobile = ANY($1::text[])
             AND (wa_unsubscribe IS NULL OR wa_unsubscribe <> 'Yes')`,
          [chunk]
        );
        flipped += rowCount;
      }
      summary.flipped = flipped;

      summary.durationMs = Date.now() - start;
      await writeMetadata({
        rowsSynced: flipped, durationMs: summary.durationMs, status: 'success',
        error: null, watermarkAdvance: startedAt,
      });
      console.log(`[WAUnsubSync] Done — flipped=${flipped} duration=${summary.durationMs}ms`);
      return summary;
    } catch (err) {
      summary.durationMs = Date.now() - start;
      summary.status = 'error';
      summary.error = err.message;
      console.error('[WAUnsubSync] Failed:', err);
      await writeMetadata({
        rowsSynced: summary.flipped,
        durationMs: summary.durationMs,
        status: 'error',
        error: err.message.slice(0, 500),
        watermarkAdvance: (await readWatermark()),
      }).catch(() => {});
      return summary;
    }
  }
}
