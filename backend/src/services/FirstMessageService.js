import { query } from '../config/database.js';

/**
 * Fetches the first message for each chat conversation from ChatHead API
 * and updates chats.first_msg_text + customer_master.first_msg_text
 *
 * API: GET https://chathead.io/apis/wa/first_msg/?from={wa_id}&to={receiver}
 * Returns: { status: "success", msg: "..." }
 */
class FirstMessageService {

  static API_BASE = 'https://chathead.io/apis/wa/first_msg';
  static CONCURRENCY = 10;
  static BATCH_SIZE = 500;
  static DELAY_BETWEEN_BATCHES = 500;

  static async fetchFirstMessage(from, to) {
    try {
      const url = `${this.API_BASE}/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'success' && data.msg) {
        return data.msg;
      }
      return null;
    } catch {
      return null;
    }
  }

  static async processBatch(rows) {
    const results = [];
    for (let i = 0; i < rows.length; i += this.CONCURRENCY) {
      const chunk = rows.slice(i, i + this.CONCURRENCY);
      const promises = chunk.map(async (row) => {
        const msg = await this.fetchFirstMessage(row.wa_id, row.receiver);
        return { id: row.id, wa_id: row.wa_id, msg };
      });
      results.push(...(await Promise.all(promises)));
    }
    return results;
  }

  static async updateMessages(results) {
    let updated = 0;
    for (const r of results) {
      if (r.msg) {
        // Remove null bytes and invalid UTF-8 characters
        const clean = String(r.msg).replace(/\0/g, '').replace(/[\uD800-\uDFFF]/g, '');
        try {
          await query(
            'UPDATE chats SET first_msg_text = $1 WHERE id = $2',
            [clean, r.id]
          );
          updated++;
        } catch {
          // Skip rows with encoding issues
        }
      }
    }
    return updated;
  }

  /**
   * Run the full sync — fetches first messages for all chats that don't have one yet
   */
  static async syncAll() {
    console.log('[FirstMsg] Starting sync...');
    let totalProcessed = 0;
    let totalUpdated = 0;
    let hasMore = true;

    while (hasMore) {
      const { rows } = await query(
        `SELECT id, wa_id, receiver
         FROM chats
         WHERE first_msg_text IS NULL
           AND wa_id IS NOT NULL AND receiver IS NOT NULL
         ORDER BY id
         LIMIT $1`,
        [this.BATCH_SIZE]
      );

      if (rows.length === 0) { hasMore = false; break; }

      console.log(`[FirstMsg] Processing batch of ${rows.length} (total so far: ${totalProcessed})...`);
      const results = await this.processBatch(rows);
      const updated = await this.updateMessages(results);

      totalProcessed += rows.length;
      totalUpdated += updated;

      console.log(`[FirstMsg] Batch: ${updated}/${rows.length} fetched. Total: ${totalUpdated}/${totalProcessed}`);

      if (hasMore) await new Promise(r => setTimeout(r, this.DELAY_BETWEEN_BATCHES));
    }

    console.log(`[FirstMsg] Done. ${totalUpdated}/${totalProcessed} messages fetched`);
    return { totalProcessed, totalUpdated };
  }

  /**
   * Test with a small batch
   */
  static async testRun(limit = 20) {
    console.log(`[FirstMsg] Test run (${limit} rows)...`);
    const { rows } = await query(
      `SELECT id, wa_id, receiver FROM chats
       WHERE first_msg_text IS NULL AND wa_id IS NOT NULL AND receiver IS NOT NULL
       LIMIT $1`, [limit]
    );

    const results = await this.processBatch(rows);
    const updated = await this.updateMessages(results);
    console.log(`[FirstMsg] Test: ${updated}/${rows.length} fetched`);

    const { rows: samples } = await query(
      `SELECT id, wa_id, first_msg_text FROM chats WHERE first_msg_text IS NOT NULL LIMIT 5`
    );
    return { updated, total: rows.length, samples };
  }
}

export default FirstMessageService;
