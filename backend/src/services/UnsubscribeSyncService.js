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
    let totalRows = 0;
    let setYes = 0;
    let setNo = 0;
    let offset = 0;

    console.log('[UnsubscribeSync] Starting sync from MySQL → RDS...');

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
    return { totalRows, setYes, setNo, durationMs };
  }
}
