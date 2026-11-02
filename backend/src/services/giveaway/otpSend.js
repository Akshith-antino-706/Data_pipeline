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
 * NOTHING IS PERSISTED. A verification code is transient and its recipient is not a marketing
 * contact, so this path writes no unified_contacts row, no gtm_journey_entries row and no
 * whatsapp_send_log row. The only trace is the consumer's log line, the capped Redis event list
 * it already writes for every feed, and the code itself in Redis under its own expiry.
 *
 * Consequence to know: journey 549's counters stay at 0 forever. gtm_journey_entries.unified_id
 * is NOT NULL, so a UI row is impossible without creating a contact — which is exactly what we
 * are declining to do. The journey exists to hold the channel + template, nothing more.
 *
 * Scope: this reads the single journey named by OTP_JOURNEY_ID (549) and writes to no table.
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

  return result;
}

export default { sendOtp, normalizePhone };
