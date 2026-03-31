import { query } from '../config/database.js';

/**
 * Fetches the first message for each chat conversation from ChatHead API
 * and updates mysql_chats.first_message_text
 *
 * API: GET https://chathead.io/apis/wa/first_msg/?from={customer_no}&to={department_number}
 * Returns: { status: "success", msg: "..." }
 */
class FirstMessageService {

  static API_BASE = 'https://chathead.io/apis/wa/first_msg';
  static CONCURRENCY = 10;       // parallel API calls
  static BATCH_SIZE = 500;       // rows to fetch from DB at a time
  static DELAY_BETWEEN_BATCHES = 1000; // ms pause between batches

  /**
   * Fetch first message from ChatHead API for a single from/to pair
   */
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

  /**
   * Process a batch of rows with controlled concurrency
   */
  static async processBatch(rows) {
    const results = [];
    for (let i = 0; i < rows.length; i += this.CONCURRENCY) {
      const chunk = rows.slice(i, i + this.CONCURRENCY);
      const promises = chunk.map(async (row) => {
        const msg = await this.fetchFirstMessage(row.customer_no, row.department_number);
        return { id: row.id, msg };
      });
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Update the DB with fetched messages
   */
  static async updateMessages(results) {
    let updated = 0;
    for (const r of results) {
      if (r.msg) {
        await query(
          'UPDATE mysql_chats SET first_message_text = $1 WHERE id = $2',
          [r.msg, r.id]
        );
        updated++;
      }
    }
    return updated;
  }

  /**
   * Run the full sync — fetches first messages for all chats that don't have one yet
   */
  static async syncAll() {
    console.log('[FirstMessage] Starting sync...');
    let totalProcessed = 0;
    let totalUpdated = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Get next batch of chats without first_message_text
      const { rows } = await query(
        `SELECT id, customer_no, department_number
         FROM mysql_chats
         WHERE first_message_text IS NULL
           AND customer_no IS NOT NULL
           AND department_number IS NOT NULL
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [this.BATCH_SIZE, offset]
      );

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`[FirstMessage] Processing batch of ${rows.length} (offset ${offset})...`);
      const results = await this.processBatch(rows);
      const updated = await this.updateMessages(results);

      totalProcessed += rows.length;
      totalUpdated += updated;
      offset += rows.length;

      console.log(`[FirstMessage] Batch done: ${updated}/${rows.length} updated. Total: ${totalUpdated}/${totalProcessed}`);

      // Pause between batches to avoid hammering the API
      if (hasMore) {
        await new Promise(r => setTimeout(r, this.DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`[FirstMessage] Sync complete: ${totalUpdated} messages fetched out of ${totalProcessed} chats`);
    return { totalProcessed, totalUpdated };
  }

  /**
   * Run a small test batch to verify the API works
   */
  static async testRun(limit = 20) {
    console.log(`[FirstMessage] Test run with ${limit} rows...`);
    const { rows } = await query(
      `SELECT id, customer_no, department_number
       FROM mysql_chats
       WHERE first_message_text IS NULL
         AND customer_no IS NOT NULL
         AND department_number IS NOT NULL
       LIMIT $1`,
      [limit]
    );

    const results = await this.processBatch(rows);
    const updated = await this.updateMessages(results);
    console.log(`[FirstMessage] Test done: ${updated}/${rows.length} updated`);

    // Show sample results
    const { rows: samples } = await query(
      `SELECT id, customer_no, department_number, first_message_text
       FROM mysql_chats
       WHERE first_message_text IS NOT NULL
       LIMIT 5`
    );
    return { updated, total: rows.length, samples };
  }
}

export default FirstMessageService;
