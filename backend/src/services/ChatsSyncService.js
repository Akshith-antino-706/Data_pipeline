import { query as pgQuery } from '../config/database.js';
import { mysqlQuery } from '../config/mysql.js';

const BATCH = 2000;

const toDate = (v) => (v instanceof Date && !isNaN(v) ? v : null);

const INSERT_COLS = [
  'wa_id', 'wa_name', 'email', 'country', 'receiver', 'boat', 'status',
  'priority', 'tags', 'fv', 'last_in', 'last_out', 'last_msg', 'last_short',
  'seen', 'spam', 'last_packed', 'created_at', 'updated_at',
  'user_id', 'first_msg_text', 'last_msg_at', 'unified_id',
];

function buildPlaceholders(rowCount, colCount) {
  const parts = [];
  let p = 1;
  for (let r = 0; r < rowCount; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) row.push(`$${p++}`);
    parts.push(`(${row.join(',')})`);
  }
  return parts.join(',');
}

function rowToParams(r) {
  return [
    r.wa_id,
    r.wa_name,
    r.email,
    r.country,
    r.receiver,
    r.boat,
    r.status,
    r.priority,
    r.tags,
    r.fv,
    toDate(r.last_in),
    toDate(r.last_out),
    toDate(r.last_msg),
    r.last_short,
    r.seen,
    r.spam,
    r.last_packed,
    toDate(r.created_at),
    toDate(r.updated_at),
    null,                   // user_id
    null,                   // first_msg_text
    toDate(r.last_msg),     // last_msg_at mirrors last_msg
    null,                   // unified_id (set by backfill step)
  ];
}

export default class ChatsSyncService {
  /**
   * Pull new chats from MySQL (created_at > MAX(created_at) in RDS),
   * insert them into RDS, then backfill unified_id on NULL rows.
   * Insert-only — UPDATEs to existing MySQL chats are not propagated.
   */
  static async sync() {
    const t0 = Date.now();
    const result = { watermark: null, inserted: 0, unifiedMatched: 0, elapsedMs: 0 };
    let syncStatus = 'success';
    let errorMessage = null;

    try {
    // 1. Watermark from RDS — read as ::text to bypass JS Date / TZ conversions
    //    on both pg and mysql2 sides. The literal datetime string round-trips
    //    correctly regardless of Node process TZ.
    const wmRes = await pgQuery("SELECT to_char(MAX(created_at), 'YYYY-MM-DD HH24:MI:SS') AS wm FROM chats");
    const watermark = wmRes.rows[0].wm;
    result.watermark = watermark;
    console.log(`[ChatsSync] Watermark (RDS MAX(created_at)): ${watermark || 'NULL (empty table)'}`);

    // 2. Pull new rows from MySQL, batched by keyset on id.
    //    Using a fixed watermark + id-keyset means a slow loop won't re-pull rows.
    const cols = 'id, wa_id, wa_name, email, country, receiver, boat, status, priority, tags, fv, last_in, last_out, last_msg, last_short, seen, spam, last_packed, created_at, updated_at';
    const colList = INSERT_COLS.join(', ');
    const colCount = INSERT_COLS.length;

    let lastId = 0;
    let inserted = 0;
    while (true) {
      const rows = watermark
        ? await mysqlQuery(
            `SELECT ${cols} FROM chats WHERE created_at > ? AND id > ? ORDER BY id ASC LIMIT ?`,
            [watermark, lastId, BATCH],
            'chats',
          )
        : await mysqlQuery(
            `SELECT ${cols} FROM chats WHERE id > ? ORDER BY id ASC LIMIT ?`,
            [lastId, BATCH],
            'chats',
          );
      if (rows.length === 0) break;

      const sql = `INSERT INTO chats (${colList}) VALUES ${buildPlaceholders(rows.length, colCount)}`;
      const params = [];
      for (const r of rows) params.push(...rowToParams(r));
      await pgQuery(sql, params);

      inserted += rows.length;
      lastId = rows[rows.length - 1].id;
    }
    result.inserted = inserted;
    console.log(`[ChatsSync] Inserted ${inserted} new chats`);

    // 3. Backfill unified_id on NULL rows (mobile then email)
    const p1 = await pgQuery(`
      WITH ranked AS (
        SELECT DISTINCT ON (normalize_phone(mobile))
               normalize_phone(mobile) AS phone_key, id
        FROM unified_contacts
        WHERE mobile IS NOT NULL AND mobile <> ''
          AND normalize_phone(mobile) IS NOT NULL
        ORDER BY normalize_phone(mobile), id
      )
      UPDATE chats c
      SET unified_id = r.id
      FROM ranked r
      WHERE c.unified_id IS NULL
        AND c.wa_id IS NOT NULL
        AND normalize_phone(c.wa_id) = r.phone_key
    `);
    const p2 = await pgQuery(`
      WITH ranked AS (
        SELECT DISTINCT ON (lower(trim(email)))
               lower(trim(email)) AS email_key, id
        FROM unified_contacts
        WHERE email IS NOT NULL AND email <> ''
        ORDER BY lower(trim(email)), id
      )
      UPDATE chats c
      SET unified_id = r.id
      FROM ranked r
      WHERE c.unified_id IS NULL
        AND c.email IS NOT NULL AND c.email <> ''
        AND lower(trim(c.email)) = r.email_key
    `);
    result.unifiedMatched = (p1.rowCount || 0) + (p2.rowCount || 0);
    console.log(`[ChatsSync] unified_id matched — phone: ${p1.rowCount || 0}, email: ${p2.rowCount || 0}`);

    } catch (err) {
      syncStatus = 'error';
      errorMessage = err.message?.slice(0, 500) || String(err);
      throw err;
    } finally {
      result.elapsedMs = Date.now() - t0;
      try {
        await pgQuery(
          `INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
           VALUES ('chats_sync', now(), $1, $2, $3, $4, now())
           ON CONFLICT (table_name) DO UPDATE SET
             last_synced_at = EXCLUDED.last_synced_at,
             rows_synced = EXCLUDED.rows_synced,
             sync_status = EXCLUDED.sync_status,
             error_message = EXCLUDED.error_message,
             sync_duration_ms = EXCLUDED.sync_duration_ms,
             updated_at = EXCLUDED.updated_at`,
          [result.inserted + result.unifiedMatched, syncStatus, errorMessage, result.elapsedMs],
        );
      } catch (metaErr) {
        console.error('[ChatsSync] Failed to write sync_metadata:', metaErr.message);
      }
    }
    return result;
  }
}
