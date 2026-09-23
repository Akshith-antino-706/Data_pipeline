/**
 * Persist a consumed giveaway message:
 *   1. Upsert the contact into unified_contacts (matched on lower(trim(email)) — NO duplicates),
 *      tagging `sources` with 'giveaway'.
 *   2. Insert the event into giveaway_events (idempotent on the message id).
 *
 * Both steps are safe to run on a redelivery: the contact lookup is idempotent and the event
 * insert is ON CONFLICT (id) DO NOTHING. Storing happens regardless of GIVEAWAY_SEND_ENABLED.
 */
import pool from '../../config/database.js';

const str = (v) => (v === '' || v == null) ? null : String(v);
const int = (v) => { const m = String(v ?? '').match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };

// Find-or-create the contact; append 'giveaway' to sources if missing. Returns unified_id (or null).
async function upsertContact(client, { email, name }) {
  if (!email) return null;
  const { rows: [found] } = await client.query(
    `SELECT id, sources FROM unified_contacts WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [email]
  );
  if (found) {
    const src = found.sources || '';
    if (!src.split(',').map(s => s.trim()).includes('giveaway')) {
      await client.query(
        `UPDATE unified_contacts
           SET sources = CASE WHEN sources IS NULL OR sources = '' THEN 'giveaway' ELSE sources || ',giveaway' END,
               updated_at = NOW()
         WHERE id = $1`,
        [found.id]
      );
    }
    return found.id;
  }
  const { rows: [created] } = await client.query(
    `INSERT INTO unified_contacts (email, name, sources, created_at, updated_at)
     VALUES ($1, $2, 'giveaway', NOW(), NOW())
     RETURNING id`,
    [email, name || null]
  );
  return created.id;
}

/**
 * Ingest one validated §3 giveaway message. Returns { unifiedId, stored }.
 */
export async function ingestGiveawayEvent(p) {
  // Nested data: { user{name}, giveaway{title,image,mechanic}, prize{name,image,type,value},
  //               winner{rank,code}, offer{name,code,expiry}, participant{position,points} }.
  const d = p.data || {};
  const u = d.user || {}, g = d.giveaway || {}, pr = d.prize || {}, w = d.winner || {}, of = d.offer || {}, pa = d.participant || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const unifiedId = await upsertContact(client, { email: p.to?.email, name: p.to?.name });

    const res = await client.query(
      `INSERT INTO giveaway_events
         (id, version, type, tenant_id, giveaway_id, unified_id, email, name,
          giveaway, giveaway_image, mechanic, prize, prize_image, prize_type, value,
          rank, code, offer, offer_code, expiry, position, points,
          subject, body, body_format, created_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id, p.version ?? 1, p.type, String(p.tenantId ?? ''), p.giveawayId || null, unifiedId,
        p.to?.email || null, str(u.name) ?? p.to?.name ?? null,
        str(g.title), str(g.image), str(g.mechanic),
        str(pr.name), str(pr.image), str(pr.type), str(pr.value),
        int(w.rank), str(w.code), str(of.name), str(of.code), str(of.expiry),
        str(pa.position), str(pa.points),
        p.subject || null, p.body || null, p.bodyFormat || null, p.createdAt || null,
        JSON.stringify(p),
      ]
    );
    await client.query('COMMIT');
    return { unifiedId, stored: res.rowCount > 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export default { ingestGiveawayEvent };
