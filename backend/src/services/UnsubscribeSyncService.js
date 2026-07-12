import { mysqlQuery } from '../config/mysql.js';
import db from '../config/database.js';

const BATCH_SIZE = 5000;

/**
 * UnsubscribeSyncService
 *
 * Syncs unsubscribe status from MySQL (phpMyAdmin) `unsubscribed` table
 * into RDS `unified_contacts.email_unsubscribe`.
 *
 * MySQL is the source of truth:
 *   unsubscribe = 1  →  email_unsubscribe = 'Yes'
 *   unsubscribe = 0  →  email_unsubscribe = 'No'
 *
 * Runs daily at 2 AM Dubai via cron in server.js.
 */
export default class UnsubscribeSyncService {

  static async sync() {
    const start = Date.now();
    const startedAt = new Date();
    let totalRows = 0;
    let setYes = 0;
    let setNo = 0;
    let offset = 0;

    console.log('[UnsubscribeSync] Starting sync from MySQL → RDS...');

    try {
      while (true) {
        // Fetch batch from MySQL
        const rows = await mysqlQuery(
          'SELECT email, unsubscribe FROM unsubscribed LIMIT ? OFFSET ?',
          [BATCH_SIZE, offset],
          'primary'
        );

        if (!rows || rows.length === 0) break;
        totalRows += rows.length;

        // Split into unsubscribed (1) and resubscribed (0)
        const unsub = rows.filter(r => r.unsubscribe === 1).map(r => r.email?.toLowerCase()?.trim()).filter(Boolean);
        const resub = rows.filter(r => r.unsubscribe === 0).map(r => r.email?.toLowerCase()?.trim()).filter(Boolean);

        // Bulk update: unsubscribe = 1 → 'Yes'
        if (unsub.length > 0) {
          const { rowCount } = await db.query(`
            UPDATE unified_contacts
            SET email_unsubscribe = 'Yes', updated_at = NOW()
            WHERE LOWER(TRIM(email)) = ANY($1::text[])
              AND email_unsubscribe <> 'Yes'
          `, [unsub]);
          setYes += rowCount;

          if (rowCount > 0) {
            await db.query(`
              INSERT INTO unsubscribe_log (unified_id, email, campaign)
              SELECT id, email, 'mysql_sync'
              FROM unified_contacts
              WHERE LOWER(TRIM(email)) = ANY($1::text[])
                AND email_unsubscribe = 'Yes'
            `, [unsub]);
          }
        }

        // Bulk update: unsubscribe = 0 → 'No'
        if (resub.length > 0) {
          const { rowCount } = await db.query(`
            UPDATE unified_contacts
            SET email_unsubscribe = 'No', updated_at = NOW()
            WHERE LOWER(TRIM(email)) = ANY($1::text[])
              AND email_unsubscribe <> 'No'
          `, [resub]);
          setNo += rowCount;
        }

        if (rows.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
      }

      const durationMs = Date.now() - start;
      console.log(`[UnsubscribeSync] Done in ${(durationMs / 1000).toFixed(1)}s — MySQL rows: ${totalRows}, set Yes: ${setYes}, set No: ${setNo}`);

      // Record run in sync_metadata so /data-pipeline UI can show last-run info.
      // rows_synced = number of unified_contacts flag flips (Yes+No), which is what
      // actually changed. Total scanned MySQL rows shown in log for reference.
      await db.query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ('unsubscribe_sync', $1, $2, 'success', NULL, $3, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          last_synced_at   = EXCLUDED.last_synced_at,
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = 'success',
          error_message    = NULL,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [startedAt, setYes + setNo, durationMs]).catch(err =>
        console.warn('[UnsubscribeSync] sync_metadata write failed:', err.message)
      );

      return { totalRows, setYes, setNo, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      console.error(`[UnsubscribeSync] Failed after ${(durationMs / 1000).toFixed(1)}s:`, err.message);
      // Still write to sync_metadata so /data-pipeline shows the failure.
      await db.query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ('unsubscribe_sync', $1, $2, 'error', $3, $4, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = 'error',
          error_message    = EXCLUDED.error_message,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [startedAt, setYes + setNo, err.message.slice(0, 500), durationMs]).catch(() => {});
      throw err;
    }
  }
}
