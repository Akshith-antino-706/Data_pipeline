/**
 * OTP → WhatsApp send.
 *
 * The OTP feed is self-addressed: the recipient is named in the payload (`to.phone`), so there
 * is no audience to qualify and no segment to honour. That is why this path does NOT go through
 * GiveawayJourneyService.onEvent (which filters trigger_source to giveaway/affiliate and refuses
 * a journey with no segment).
 *
 * The journey row named by OTP_JOURNEY_ID is the CONFIG HOLDER: its first whatsapp action node
 * supplies the ChatHead channel and template, so either can be changed in the journey builder
 * instead of by deploy. Env vars override it only as an escape hatch.
 *
 * WHY THE ENTRY IS WRITTEN AS 'snapshot', NOT 'active':
 *   ContinuousJourneyService.processDue claims `status = 'active'` rows. Writing an active entry
 *   would hand the send to the 1-minute cron — which batches WhatsApp and schedules the broadcast
 *   at now+60s, most of a 10-minute code's life, and applies the 3-per-24h cap that would block a
 *   4th code in a day. 'snapshot' is never claimed either, so the journey UI gets its row (the
 *   SNAPSHOTTED tile) while delivery stays on the fast path here.
 *
 *   Both outcomes are recorded as 'snapshot' so exactly ONE counter moves on journey 549; whether
 *   a code actually went out is in whatsapp_send_log.status (sent | failed), not in the entry.
 *
 * Scope: this only ever touches the single journey named by OTP_JOURNEY_ID (549). It is not a
 * general mechanism — no other journey writes terminal entries from outside the engine.
 *
 * Transport is ChatHead's single-send endpoint, which differs from the broadcast API:
 *   - GET only. A POST (JSON or form) returns HTTP 200 with an EMPTY body and sends nothing.
 *   - The channel is the number in the URL path, not a parameter. Only channel 191 has this
 *     endpoint; the other 58 channels 404.
 *   - Arrays use the bracket form (`template_vars[]`), and the response carries a UTF-8 BOM.
 *   - An Authentication template needs `template_button_vars[]` as well as `template_vars[]`.
 *     Neither that field nor the requirement appears in ChatHead's documentation.
 */
import db from '../../config/database.js';
import { getConnection } from '../queue/index.js';

const SEND_URL   = process.env.WA_SEND_ENDPOINT || 'https://www.chathead.io/apis/send/97142087412/';
const JOURNEY_ID = parseInt(process.env.OTP_JOURNEY_ID || '549', 10);
const REDIS_PFX  = process.env.OTP_REDIS_PREFIX || 'dp:otp:';
const MAX_TTL    = parseInt(process.env.OTP_REDIS_MAX_TTL || '900', 10);

// journeyId → { channelId, templateName, nodeId }. The journey is edited rarely; re-reading it
// on every OTP would put a query in front of a 10-minute code for no benefit.
let _cfg = null, _cfgAt = 0;
const CFG_TTL_MS = 5 * 60 * 1000;

/** Digits only, '+' stripped — what `destination` wants and how unified_contacts.mobile is stored. */
export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** Channel, template and node id off the journey's first whatsapp action node. */
async function loadConfig() {
  if (_cfg && Date.now() - _cfgAt < CFG_TTL_MS) return _cfg;

  let channelId    = process.env.OTP_WA_CHANNEL  || null;
  let templateName = process.env.OTP_WA_TEMPLATE || null;
  let templateId   = null;
  let nodeId       = null;

  try {
    const { rows: [j] } = await db.query('SELECT nodes FROM journey_flows WHERE journey_id = $1', [JOURNEY_ID]);
    const nodes = typeof j?.nodes === 'string' ? JSON.parse(j.nodes) : (j?.nodes || []);
    const node = nodes.find(n => n?.type === 'action' && String(n.data?.channel || '').toLowerCase() === 'whatsapp');
    nodeId     = node?.id || null;
    templateId = node?.data?.waTemplateId || null;
    // waTemplateName holds the DISPLAY name on builder-saved nodes, but the send API needs the
    // template_code — they differ on most templates, so an explicit env value wins.
    channelId    = channelId    || node?.data?.waChannelId    || null;
    templateName = templateName || node?.data?.waTemplateName || null;
  } catch (e) {
    console.error(`[OtpMQ] could not read journey ${JOURNEY_ID}: ${e.message}`);
  }

  _cfg = { channelId, templateName, templateId, nodeId };
  _cfgAt = Date.now();
  return _cfg;
}

/** Cache the code for its own lifetime, so a verify step can read it back. Never fatal. */
async function stash(p, phone) {
  const ttl = Math.min(MAX_TTL, Math.ceil((new Date(p.expiresAt).getTime() - Date.now()) / 1000));
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  try {
    await getConnection().set(
      `${REDIS_PFX}${p.tenantId}:${phone}`,
      JSON.stringify({ id: p.id, code: p.code, expiresAt: p.expiresAt }),
      'EX', ttl,
    );
  } catch { /* the send matters more than the cache */ }
}

/**
 * Find the contact holding this number, or create a phone-only one.
 * `mobile` is stored WITHOUT a '+', so the normalized form matches directly and uses idx_uc_mobile.
 * That index is not unique, so two codes for a brand-new number can race; the re-select after the
 * insert collapses the duplicate rather than leaving two rows.
 */
async function resolveContact(phone) {
  const { rows } = await db.query('SELECT id FROM unified_contacts WHERE mobile = $1 ORDER BY id LIMIT 1', [phone]);
  if (rows.length) return rows[0].id;
  try {
    // `sources` marks these so an OTP requester can be excluded from marketing segments —
    // they asked for a verification code, not to be contacted.
    const { rows: [ins] } = await db.query(
      `INSERT INTO unified_contacts (mobile, sources) VALUES ($1, 'otp') RETURNING id`, [phone]);
    return ins.id;
  } catch {
    const { rows: again } = await db.query('SELECT id FROM unified_contacts WHERE mobile = $1 ORDER BY id LIMIT 1', [phone]);
    return again[0]?.id ?? null;
  }
}

/**
 * Record the OTP against journey 549 so it appears in the UI.
 * `item_id = p.id` makes it one row per code, and ON CONFLICT keeps a redelivered message from
 * double-counting. Status is always 'snapshot' — see the header for why it is never 'active'.
 */
async function recordEntry({ p, phone, unifiedId, cfg, result }) {
  if (!unifiedId) return;
  const ok = result.ok;
  try {
    await db.query(
      `INSERT INTO gtm_journey_entries
         (journey_id, unified_id, item_id, current_node_id, status, entered_at, last_event_id)
       VALUES ($1,$2,$3,$4,'snapshot',NOW(),$3)
       ON CONFLICT (journey_id, unified_id, item_id) DO NOTHING`,
      [JOURNEY_ID, unifiedId, String(p.id), cfg.nodeId]
    );
  } catch (e) { console.error(`[OtpMQ] entry insert failed: ${e.message}`); }

  try {
    await db.query(
      `INSERT INTO whatsapp_send_log
         (unified_id, phone, channel_id, template_id, template_name, journey_id, node_id,
          status, source, error, wamid, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'otp',$9,$10, CASE WHEN $8='sent' THEN NOW() ELSE NULL END)`,
      [unifiedId, phone, cfg.channelId ? parseInt(cfg.channelId) : null,
       cfg.templateId ? parseInt(cfg.templateId) : null, cfg.templateName,
       JOURNEY_ID, cfg.nodeId, ok ? 'sent' : 'failed',
       ok ? null : String(result.error || '').slice(0, 500), result.wamid ?? null]
    );
  } catch (e) { console.error(`[OtpMQ] send-log insert failed: ${e.message}`); }
}

/**
 * Send one OTP. Returns { ok, wamid, error } — never throws, so the consumer always acks.
 * @param {object} p  the validated phone.otp.prod.send payload
 */
export async function sendOtp(p) {
  const phone = normalizePhone(p?.to?.phone);
  if (phone.length < 10) return { ok: false, error: `invalid_phone:${phone.length}_digits` };

  // Expired before we got to it (consumer restart, queue backlog) — sending a dead code is worse
  // than sending nothing. The queue's x-message-ttl makes this rare, not impossible.
  if (p.expiresAt && new Date(p.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'already_expired' };
  }

  await stash(p, phone);

  const cfg = await loadConfig();
  if (!cfg.templateName) return { ok: false, error: 'no_template_configured' };

  const qs = new URLSearchParams();
  qs.append('destination', phone);
  qs.append('type', 'template');
  qs.append('template_name', cfg.templateName);
  // The code goes in TWICE. Meta's Authentication templates need it as a body parameter AND as
  // the COPY_CODE button's own component parameter; omit the second and the send is rejected with
  // the same generic "Can not send Message at this time!" as every other failure.
  // `template_button_vars[]` is undocumented — it is not in ChatHead's send API page.
  qs.append('template_vars[]', String(p.code));
  qs.append('template_button_vars[]', String(p.code));

  let result;
  try {
    const res  = await fetch(`${SEND_URL}?${qs.toString()}`, { signal: AbortSignal.timeout(15000) });
    const body = (await res.text()).replace(/^﻿/, '');        // the response is BOM-prefixed
    // An empty 200 is this endpoint's undocumented failure mode (every POST returns one). It is
    // NOT success — treat it as a transport fault rather than a silent send.
    if (!body.trim()) result = { ok: false, error: 'empty_response' };
    else {
      let j;
      try { j = JSON.parse(body); } catch { j = null; }
      if (!j)                        result = { ok: false, error: `unparseable:${body.slice(0, 120)}` };
      else if (j.status === 'success') result = { ok: true, wamid: j?.data?.message_id || null };
      else                           result = { ok: false, error: j.msg || 'send_failed' };
    }
  } catch (e) {
    result = { ok: false, error: `fetch_failed:${e.message}` };
  }

  // Attribute it to the journey either way — a failed code is worth seeing in the UI too.
  try {
    const unifiedId = await resolveContact(phone);
    await recordEntry({ p, phone, unifiedId, cfg, result });
  } catch (e) {
    console.error(`[OtpMQ] attribution failed (send result unaffected): ${e.message}`);
  }

  return result;
}

export default { sendOtp, normalizePhone };
