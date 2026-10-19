/**
 * Persist a consumed giveaway message:
 *   1. Upsert the contact into unified_contacts (matched on lower(trim(email)) — NO duplicates),
 *      tagging `sources` with 'giveaway'.
 *   2. Insert the event into giveaway_affiliate_events (idempotent on the message id).
 *
 * Both steps are safe to run on a redelivery: the contact lookup is idempotent and the event
 * insert is ON CONFLICT (id) DO NOTHING. Storing happens regardless of GIVEAWAY_SEND_ENABLED.
 */
import pool from '../../config/database.js';

const str = (v) => (v === '' || v == null) ? null : String(v);
const int = (v) => { const m = String(v ?? '').match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };

// Find-or-create the contact; append 'giveaway' to sources if missing. Returns unified_id (or null).
// Giveaway contacts are tagged contact_type = 'B2C'.
async function upsertContact(client, { email, name }) {
  if (!email) return null;

  // NO DUPLICATES: serialize concurrent giveaway ingests for the SAME email with a
  // transaction-scoped advisory lock (auto-released on COMMIT/ROLLBACK). Without this the
  // find-or-create (SELECT then INSERT, no unique index) races on redelivery and inserts a
  // second row for the same email. The lock makes the second ingest wait, then it finds the
  // row the first one inserted.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext(lower(trim($1))))`, [email]);

  const { rows: [found] } = await client.query(
    `SELECT id, sources FROM unified_contacts WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [email]
  );
  if (found) {
    const src = found.sources || '';
    const needsSource = !src.split(',').map(s => s.trim()).includes('giveaway');
    if (needsSource) {
      // Append the giveaway source and backfill contact_type to 'B2C' when it isn't set yet
      // (never overrides an existing B2B/B2C classification).
      await client.query(
        `UPDATE unified_contacts
           SET sources = CASE WHEN sources IS NULL OR sources = '' THEN 'giveaway' ELSE sources || ',giveaway' END,
               contact_type = COALESCE(contact_type, 'B2C'),
               updated_at = NOW()
         WHERE id = $1`,
        [found.id]
      );
    }
    return found.id;
  }
  const { rows: [created] } = await client.query(
    `INSERT INTO unified_contacts (email, name, sources, contact_type, created_at, updated_at)
     VALUES ($1, $2, 'giveaway', 'B2C', NOW(), NOW())
     RETURNING id`,
    [email, name || null]
  );
  return created.id;
}

/**
 * Ingest one validated message from either feed. Returns { unifiedId, stored }.
 *
 *   source 'GIVEAWAY'  → nested data{} block, carries a rendered subject/body
 *   source 'AFFILIATE' → top-level coupon{} / commission{} / link{} / cardOffer{} block,
 *                        no email content (the journey template renders it)
 *
 * Shared columns (id, version, type, tenant_id, email, name, created_at, raw_payload) are
 * filled identically for both; each feed's specifics go to its own columns, and the complete
 * original object is always kept in raw_payload.
 */
export async function ingestGiveawayEvent(p, source = 'GIVEAWAY') {
  // Nested data: { user{name}, giveaway{title,image,mechanic}, prize{name,image,type,value},
  //               winner{rank,code}, offer{name,code,expiry}, participant{position,points} }.
  const d = p.data || {};
  const u = d.user || {}, g = d.giveaway || {}, pr = d.prize || {}, w = d.winner || {}, of = d.offer || {}, pa = d.participant || {};
  // Affiliate blocks — exactly one is present, selected by `type`.
  const cp = p.coupon || {}, cm = p.commission || {}, lk = p.link || {}, co = p.cardOffer || {};
  const disc = Array.isArray(cp.discounts) ? (cp.discounts[0] || {}) : {};
  const isAff = source === 'AFFILIATE';
  const ts = (v) => (v == null || v === '') ? null : v;      // ISO string or null for TIMESTAMPTZ
  const dec = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const unifiedId = await upsertContact(client, { email: p.to?.email, name: p.to?.name });

    const res = await client.query(
      `INSERT INTO giveaway_affiliate_events
         (id, version, type, source, tenant_id, giveaway_id, unified_id, email, name,
          giveaway, giveaway_image, mechanic, prize, prize_image, prize_type, value,
          rank, code, offer, offer_code, expiry, position, points,
          subject, body, body_format, created_at, raw_payload,
          user_tenant_id, coupon_id, valid_from, max_total_redemptions, max_per_user,
          discount_type, max_discount_value, currency,
          commission_rate, commission_prev_rate, effective_from,
          link_id, link_slug, tracking_url, destination_url,
          campaign_source, campaign_medium, campaign_name,
          offer_id, offer_subtitle, bank_name, min_order_value, max_discount_cap)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
               $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id, p.version ?? 1, p.type, source, String(p.tenantId ?? ''), p.giveawayId || null, unifiedId,
        p.to?.email || null, str(u.name) ?? p.to?.name ?? null,
        // ── giveaway-specific (null for affiliate) ──
        str(g.title), str(g.image), str(g.mechanic),
        str(pr.name), str(pr.image), str(pr.type),
        // `value`, `code`, `offer`, `offer_code`, `expiry` are SHARED columns — each feed
        // maps its own meaning onto them so segments/templates can read one field.
        isAff ? str(disc.value ?? co.discount) : str(pr.value),
        int(w.rank),
        isAff ? str(cp.code ?? co.code)        : str(w.code),
        isAff ? str(co.title)                  : str(of.name),
        isAff ? str(co.code)                   : str(of.code),
        isAff ? str(cp.validUntil ?? co.validUntil) : str(of.expiry),
        str(pa.position), str(pa.points),
        // Affiliate carries no rendered email — subject/body/bodyFormat stay null.
        p.subject || null, p.body || null, p.bodyFormat || null, p.createdAt || null,
        JSON.stringify(p),
        // ── affiliate-specific (null for giveaway) ──
        str(p.userTenantId),
        str(cp.couponId), ts(cp.validFrom), int(cp.maxTotalRedemptions), int(cp.maxPerUser),
        str(disc.discountType ?? co.discountType), dec(disc.maxDiscountValue ?? co.maxDiscountCap),
        str(disc.maxDiscountCurrency ?? disc.amountCurrency ?? co.currency ?? co.amountCurrency),
        dec(cm.ratePercent), dec(cm.previousRatePercent), ts(cm.effectiveFrom),
        str(lk.linkId), str(lk.slug), str(lk.trackingUrl), str(lk.destinationUrl),
        str(lk.campaignSource), str(lk.campaignMedium), str(lk.campaignName),
        str(co.offerId), str(co.subTitle), str(co.bankName), dec(co.minOrderValue), dec(co.maxDiscountCap),
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
