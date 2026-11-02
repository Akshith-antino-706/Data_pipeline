/**
 * OTP → WhatsApp send.
 *
 * The OTP feed is self-addressed: the recipient is named in the payload (`to.phone`), so there
 * is no audience to qualify and no segment to honour. That is why this path does NOT go through
 * GiveawayJourneyService.onEvent (which filters trigger_source to giveaway/affiliate and refuses
 * a journey with no segment) and writes no gtm_journey_entries row (unified_id is NOT NULL there,
 * and an OTP requester is not a marketing contact).
 *
 * The journey row named by OTP_JOURNEY_ID is the CONFIG HOLDER: its first whatsapp action node
 * supplies the ChatHead channel and template, so either can be changed in the journey builder
 * instead of by deploy. Env vars override it only as an escape hatch.
 *
 * Transport is ChatHead's single-send endpoint, which differs from the broadcast API we use
 * everywhere else:
 *   - GET only. A POST (JSON or form) returns HTTP 200 with an EMPTY body and sends nothing.
 *   - The channel is the number in the URL path, not a parameter. Only channel 191 has this
 *     endpoint; the other 58 channels 404.
 *   - Arrays use the bracket form (`template_vars[]`), and the response carries a UTF-8 BOM.
 */
import db from '../../config/database.js';
import { getConnection } from '../queue/index.js';

const SEND_URL    = process.env.WA_SEND_ENDPOINT || 'https://www.chathead.io/apis/send/97142087412/';
const JOURNEY_ID  = parseInt(process.env.OTP_JOURNEY_ID || '549', 10);
const REDIS_PFX   = process.env.OTP_REDIS_PREFIX || 'dp:otp:';
const MAX_TTL     = parseInt(process.env.OTP_REDIS_MAX_TTL || '900', 10);

// journeyId → { channelId, templateName }. The journey is edited rarely; re-reading it on every
// OTP would put a query in front of a 10-minute code for no benefit.
let _cfg = null, _cfgAt = 0;
const CFG_TTL_MS = 5 * 60 * 1000;

/** Digits only, '+' stripped — what `destination` wants and how unified_contacts.mobile is stored. */
export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Read the ChatHead channel + template off the journey's first whatsapp action node.
 * Env vars win when set, so a broken journey row can be bypassed without a deploy.
 */
async function loadConfig() {
  if (_cfg && Date.now() - _cfgAt < CFG_TTL_MS) return _cfg;

  let channelId = process.env.OTP_WA_CHANNEL || null;
  let templateName = process.env.OTP_WA_TEMPLATE || null;

  if (!channelId || !templateName) {
    try {
      const { rows: [j] } = await db.query('SELECT nodes FROM journey_flows WHERE journey_id = $1', [JOURNEY_ID]);
      const nodes = typeof j?.nodes === 'string' ? JSON.parse(j.nodes) : (j?.nodes || []);
      const node = nodes.find(n => n?.type === 'action' && String(n.data?.channel || '').toLowerCase() === 'whatsapp');
      // waTemplateName holds the DISPLAY name on nodes saved by the builder, but the send API
      // needs the template_code. They differ on most templates, so prefer an explicit env value.
      channelId    = channelId    || node?.data?.waChannelId   || null;
      templateName = templateName || node?.data?.waTemplateName || null;
    } catch (e) {
      console.error(`[OtpMQ] could not read journey ${JOURNEY_ID}: ${e.message}`);
    }
  }

  _cfg = { channelId, templateName };
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

  const { templateName } = await loadConfig();
  if (!templateName) return { ok: false, error: 'no_template_configured' };

  const qs = new URLSearchParams();
  qs.append('destination', phone);
  qs.append('type', 'template');
  qs.append('template_name', templateName);
  qs.append('template_vars[]', String(p.code));

  let body = '';
  try {
    const res = await fetch(`${SEND_URL}?${qs.toString()}`, { signal: AbortSignal.timeout(15000) });
    body = (await res.text()).replace(/^﻿/, '');          // the response is BOM-prefixed
  } catch (e) {
    return { ok: false, error: `fetch_failed:${e.message}` };
  }

  // An empty 200 is this endpoint's undocumented failure mode (every POST returns one). It is
  // NOT success — treat it as a transport fault rather than a silent send.
  if (!body.trim()) return { ok: false, error: 'empty_response' };

  let j;
  try { j = JSON.parse(body); }
  catch { return { ok: false, error: `unparseable:${body.slice(0, 120)}` }; }

  if (j?.status === 'success') return { ok: true, wamid: j?.data?.message_id || null };
  return { ok: false, error: j?.msg || 'send_failed' };
}

export default { sendOtp, normalizePhone };
