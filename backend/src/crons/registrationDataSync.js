/**
 * registrationDataSync
 *
 * Daily pull of website registrations from the registration-data API into
 * affiliate_data, guestuser_data and agent_data — new sign-ups are inserted,
 * registrations edited since (name, phone, consent, authorisation…) are updated.
 *
 * API limits: one call covers at most 7 days, toDate includes the whole day, and
 * fromDate must be after a rolling cut-off (~2 months back). Each run fetches the
 * last 7 days (Dubai dates), which covers yesterday's sign-ups plus a week of edits.
 *
 * Rows match on each table's id column. The tables have no unique constraint on it,
 * so each table is synced in one transaction under a table lock. Only rows whose
 * values really differ are written, in the format the original loader used:
 *   - every column is text; empty values are the text 'NULL'
 *   - numeric-looking text is stored as a number: ' +0971501234567 ' → '971501234567'
 *     (text with inner spaces/dashes, e.g. '50 123 4567', is kept as-is)
 *   - timestamps 'YYYY-MM-DD HH:MM:SS[.ffffff]', fraction only when the source has one
 */
import { transaction } from '../config/database.js';
import db from '../config/database.js';

const API_URL = process.env.REGISTRATION_API_URL || 'https://www.raynatours.com/api/registration-data';
const WINDOW_DAYS = 7;
const TYPES = [
  { type: 'affiliate', table: 'affiliate_data', key: 'affiliateId' },
  { type: 'guestuser', table: 'guestuser_data', key: 'GuestUserId' },
  { type: 'agent',     table: 'agent_data',     key: 'AgentID' },
];
// A row that would overwrite more than this many existing (non-empty) values is
// skipped and logged for review — that pattern means bad data, not a profile edit.
const MAX_OVERWRITES = 3;

// ── Dates (Dubai calendar) ──
const dubaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── Value formats ──
const numericLike = s => {
  const t = s.trim();
  return /^\+?\d+$/.test(t) ? t.replace(/^\+/, '').replace(/^0+(?=\d)/, '') : s;
};
const TS = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?)?$/;

/** API value → the loader's text format */
function toDb(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(v);
  if (m) return m[3] ? `${m[1]} ${m[2]}.${(m[3] + '000000').slice(0, 6)}` : `${m[1]} ${m[2]}`;
  return numericLike(v);
}

/** Meaning-level form, so formatting-only differences don't count as changes */
function norm(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s === 'NULL' || s === 'null') return '';
  if (s === 'true') return '1';
  if (s === 'false') return '0';
  const m = TS.exec(s);
  if (m) return `${m[1]} ${m[2] || '00:00:00'}.${((m[3] || '') + '000000').slice(0, 6)}`;
  return numericLike(s);
}

// ── API ──
async function fetchRegistrations(type, fromDate, toDate) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'x-website-currency=INR; x-website-language=English' },
        body: JSON.stringify({ fromDate, toDate, type }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      const records = body?.data?.records;
      if (!Array.isArray(records) || body.data.count !== records.length) throw new Error('unexpected payload');
      return records;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`[RegistrationSync] ${type}: attempt ${attempt} failed (${err.message}) — retrying`);
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
}

// ── One table ──
async function syncType({ type, table, key }, fromDate, toDate, { dryRun }) {
  const records = await fetchRegistrations(type, fromDate, toDate);
  const result = { type, fetched: records.length, inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  if (!records.length) return result;

  const apiKey = Object.keys(records[0]).find(k => k.toLowerCase() === key.toLowerCase());
  if (!apiKey) throw new Error(`API records have no "${key}" field`);

  const work = async (client) => {
    if (!dryRun) await client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);

    const { rows: colRows } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
    const colFor = {};
    for (const { column_name } of colRows) colFor[column_name.toLowerCase()] = column_name;
    const unknown = Object.keys(records[0]).filter(k => !colFor[k.toLowerCase()]);
    if (unknown.length) console.warn(`[RegistrationSync] ${type}: API fields with no column in ${table} (ignored): ${unknown.join(', ')}`);

    const ids = records.map(r => String(r[apiKey]));
    const { rows: existing } = await client.query(`SELECT * FROM ${table} WHERE "${key}" = ANY($1::text[])`, [ids]);
    const byId = new Map();
    for (const row of existing) {
      if (byId.has(row[key])) throw new Error(`${table} has duplicate ${key} ${row[key]} — fix before syncing`);
      byId.set(row[key], row);
    }

    const inserts = [];
    const updates = [];
    for (const rec of records) {
      const vals = {};
      for (const [k, v] of Object.entries(rec)) {
        const col = colFor[k.toLowerCase()];
        if (col) vals[col] = { raw: v, text: toDb(v) };
      }
      const id = String(rec[apiKey]);
      const row = byId.get(id);
      if (!row) {
        inserts.push(Object.fromEntries(Object.entries(vals).map(([col, v]) => [col, v.text])));
        continue;
      }
      const changed = Object.entries(vals)
        .filter(([col, v]) => (row[col] ?? null) !== v.text && norm(row[col]) !== norm(v.raw))
        .map(([col, v]) => [col, v.text]);
      if (!changed.length) { result.unchanged++; continue; }
      const overwrites = changed.filter(([col, text]) => row[col] !== 'NULL' && row[col] != null && text !== 'NULL').length;
      if (overwrites > MAX_OVERWRITES) {
        console.warn(`[RegistrationSync] ${type}: ${key} ${id} would overwrite ${overwrites} values (${changed.map(([c]) => c).join(', ')}) — skipped, review manually`);
        result.skipped++;
        continue;
      }
      updates.push({ dbId: row.id, id, changed });
    }

    if (dryRun) {
      result.inserted = inserts.length;
      result.updated = updates.length;
      return;
    }

    for (const u of updates) {
      const sets = u.changed.map(([col], i) => `"${col}" = $${i + 2}`).join(', ');
      await client.query(`UPDATE ${table} SET ${sets}, updated_at = now(), synced_at = now() WHERE id = $1`,
        [u.dbId, ...u.changed.map(([, text]) => text)]);
    }
    result.updated = updates.length;

    for (let i = 0; i < inserts.length; i += 200) {
      const chunk = inserts.slice(i, i + 200);
      const cols = Object.keys(chunk[0]);
      const params = [];
      const tuples = chunk.map(vals => `(${cols.map(col => { params.push(vals[col] ?? 'NULL'); return `$${params.length}`; }).join(', ')}, now())`);
      await client.query(
        `INSERT INTO ${table} (${cols.map(col => `"${col}"`).join(', ')}, synced_at) VALUES ${tuples.join(', ')}`, params);
    }
    result.inserted = inserts.length;
  };

  if (dryRun) {
    const client = await db.connect();
    try { await work(client); } finally { client.release(); }
  } else {
    await transaction(work);
  }
  return result;
}

async function writeSyncMetadata(type, status, rows, durationMs, error) {
  try {
    await db.query(`
      INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
      VALUES ($1, NOW(), $2, $3, $4, $5, NOW())
      ON CONFLICT (table_name) DO UPDATE SET
        last_synced_at   = EXCLUDED.last_synced_at,
        rows_synced      = EXCLUDED.rows_synced,
        sync_status      = EXCLUDED.sync_status,
        error_message    = EXCLUDED.error_message,
        sync_duration_ms = EXCLUDED.sync_duration_ms,
        updated_at       = NOW()
    `, [`registration_${type}_sync`, rows, status, error, durationMs]);
  } catch (err) {
    console.warn(`[RegistrationSync] ${type}: sync_metadata write failed:`, err.message);
  }
}

/**
 * Sync all three registration types. Each type runs independently, so one failing
 * (API down, bad data) doesn't block the others.
 * @param {{ dryRun?: boolean }} opts dryRun: report what would change, write nothing
 */
export async function runRegistrationDataSync({ dryRun = false } = {}) {
  const toDate = dubaiToday();
  const fromDate = addDays(toDate, -WINDOW_DAYS);
  console.log(`[RegistrationSync] ${dryRun ? 'DRY RUN ' : ''}${fromDate} → ${toDate}`);

  const results = [];
  for (const cfg of TYPES) {
    const started = Date.now();
    try {
      const r = await syncType(cfg, fromDate, toDate, { dryRun });
      console.log(`[RegistrationSync] ${cfg.type}: fetched=${r.fetched} inserted=${r.inserted} updated=${r.updated} unchanged=${r.unchanged} skipped=${r.skipped} in ${Date.now() - started}ms`);
      if (!dryRun) await writeSyncMetadata(cfg.type, 'success', r.inserted + r.updated, Date.now() - started, null);
      results.push(r);
    } catch (err) {
      console.error(`[RegistrationSync] ${cfg.type} failed:`, err.message);
      if (!dryRun) await writeSyncMetadata(cfg.type, 'error', 0, Date.now() - started, err.message);
      results.push({ type: cfg.type, error: err.message });
    }
  }
  return { fromDate, toDate, dryRun, results };
}

export default { runRegistrationDataSync };
