/**
 * Gupshup integration endpoints — template approval + webhooks.
 *
 *   POST /api/v3/gupshup/templates/:id/submit          → submit for Meta/DLT approval
 *   POST /api/v3/gupshup/templates/:id/check-status    → poll current status
 *   POST /api/v3/gupshup/templates/:id/set-external-id → manual ID (SMS/DLT)
 *   POST /api/v3/gupshup/templates/:id/force-approve   → dev helper (simulation only)
 *   GET  /api/v3/gupshup/templates/:id/events          → approval audit trail
 *   POST /api/v3/gupshup/bulk-submit                   → submit everything pending
 *   POST /api/v3/gupshup/webhook/wa                    → Meta/Gupshup template-status callbacks
 *   POST /api/v3/gupshup/webhook/sms                   → Gupshup SMS delivery receipts
 *   GET  /api/v3/gupshup/config                         → which providers are live vs simulated
 */
import { Router } from 'express';
import GupshupService from '../services/GupshupService.js';
import db from '../config/database.js';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    whatsapp: { configured: GupshupService.isWhatsAppConfigured() },
    sms:      { configured: GupshupService.isSMSConfigured() },
    rcs:      { configured: GupshupService.isRCSConfigured() },
  });
});

// ── Template approval ──────────────────────────────────────────

router.post('/templates/:id/submit', async (req, res) => {
  try {
    const data = await GupshupService.submitTemplate(parseInt(req.params.id));
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/templates/:id/check-status', async (req, res) => {
  try {
    const data = await GupshupService.checkTemplateStatus(parseInt(req.params.id));
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Used for SMS where DLT content-template-id is issued out-of-band and set manually
router.post('/templates/:id/set-external-id', async (req, res) => {
  try {
    const { externalId, status, category } = req.body;
    if (!externalId) throw new Error('externalId required');
    const data = await GupshupService.setExternalId(parseInt(req.params.id), externalId, { status, category });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Dev/simulation helper — flip a pending template to approved without Gupshup.
// Useful for end-to-end testing before real keys land.
router.post('/templates/:id/force-approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows: [before] } = await db.query('SELECT external_status, channel FROM content_templates WHERE id = $1', [id]);
    if (!before) throw new Error('Template not found');
    if (!['whatsapp', 'sms'].includes(before.channel)) throw new Error('Only whatsapp/sms templates need Gupshup approval');
    await db.query(
      `UPDATE content_templates SET external_status = 'approved', external_approved_at = NOW(),
         external_provider = COALESCE(external_provider, 'gupshup'),
         external_template_id = COALESCE(external_template_id, 'sim_force_' || $1) WHERE id = $1`,
      [id]
    );
    await db.query(
      `INSERT INTO template_approval_events (template_id, provider, event_type, previous_status, new_status, details)
       VALUES ($1, 'gupshup', 'status_update', $2, 'approved', $3)`,
      [id, before.external_status, JSON.stringify({ forceApproved: true, actor: 'dev_tool' })]
    );
    res.json({ success: true, data: { id, status: 'approved', forceApproved: true } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/templates/:id/events', async (req, res) => {
  try {
    const data = await GupshupService.getEvents(parseInt(req.params.id));
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/bulk-submit', async (_req, res) => {
  try {
    const data = await GupshupService.bulkSubmit();
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Webhooks ───────────────────────────────────────────────────

router.post('/webhook/wa', async (req, res) => {
  // TODO: verify Gupshup signature once GUPSHUP_CALLBACK_SECRET is set
  try {
    const data = await GupshupService.handleWebhook(req.body);
    res.json({ received: true, ...data });
  } catch (err) {
    console.error('[Gupshup WA webhook] error:', err);
    res.status(200).json({ received: true, error: err.message });  // 200 so Gupshup doesn't retry
  }
});

router.post('/webhook/sms', async (req, res) => {
  // SMS delivery receipts — log for now, could update message_log later
  try {
    console.log('[Gupshup SMS webhook]', JSON.stringify(req.body));
    res.json({ received: true });
  } catch (err) {
    res.status(200).json({ received: true, error: err.message });
  }
});

// ── SMS (Gupshup) — Phase 1: config, template list, single test-send ──────────
// Mirrors the WhatsApp Test Send. Calls GupshupService.sendSMS DIRECTLY (does NOT
// use the JOURNEY_SMS_ENABLED worker gate), so it's fully isolated from live journeys.

router.get('/sms/config', (_req, res) => {
  const c = GupshupService.smsConfig;
  res.json({ success: true, data: { configured: GupshupService.isSMSConfigured(), senderId: c.senderId || null } });
});

// SMS templates come from content_templates (channel='sms'); external_status shows DLT approval.
router.get('/sms/templates', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, body, external_status, external_template_id
         FROM content_templates WHERE channel = 'sms' ORDER BY id DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /sms/test-send — send ONE SMS to a test number. Body: { phone, templateId, name? }.
router.post('/sms/test-send', async (req, res) => {
  const { phone, templateId, name } = req.body || {};
  const digits = String(phone || '').replace(/^\+/, '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(digits)) return res.status(400).json({ success: false, error: 'valid phone required (10-15 digits, no +)' });
  if (!templateId) return res.status(400).json({ success: false, error: 'templateId required' });

  // Best-effort contact identity (stays null for ad-hoc numbers).
  let unifiedId = null;
  try {
    const { rows: [u] } = await db.query(
      `SELECT id FROM unified_contacts WHERE regexp_replace(COALESCE(mobile,''),'\\D','','g') = $1 LIMIT 1`, [digits]);
    unifiedId = u?.id ?? null;
  } catch { /* identity is optional */ }

  // Render {{first_name}} the same way the SMS worker does, so the preview matches the send.
  let messageBody = null;
  try {
    const { rows: [tpl] } = await db.query('SELECT body FROM content_templates WHERE id = $1', [parseInt(templateId)]);
    const firstName = name ? String(name).split(' ')[0] : 'there';
    messageBody = (tpl?.body || '').replace(/\{\{first_name\}\}/g, firstName) || null;
  } catch { /* sendSMS falls back to tpl.body */ }

  let result;
  try {
    result = await GupshupService.sendSMS({ to: digits, templateId: parseInt(templateId), messageBody });
  } catch (err) {
    result = { success: false, error: err.message, blocked: /not approved/i.test(err.message) };
  }

  // Independent per-message log — a logging failure must never fail the send.
  try {
    const c = GupshupService.smsConfig;
    const status = result?.blocked ? 'blocked' : result?.simulated ? 'simulated' : (result?.success ? 'sent' : 'failed');
    await db.query(
      `INSERT INTO sms_send_log
         (unified_id, phone, contact_name, template_id, sender_mask, provider, external_id,
          status, source, error, message_body, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'test-send',$9,$10,
               CASE WHEN $8 IN ('sent','simulated') THEN NOW() ELSE NULL END)`,
      [unifiedId, digits, name || null, parseInt(templateId), c.senderId || null,
       result?.provider || 'gupshup-sms', result?.externalId || null, status,
       result?.success ? null : String(result?.error || 'send failed').slice(0, 500), messageBody]
    );
  } catch (logErr) { console.warn('[gupshup/sms/test-send] log write failed:', logErr.message); }

  res.json({ success: !!result?.success, data: { phone: digits, unifiedId, result } });
});

// ── RCS Test Send ──────────────────────────────────────────────
// Mirrors the SMS Test Send. Calls GupshupService.sendRCS directly against the
// mediaapi (RBM) host. RCS templates are NOT in content_templates — the caller
// passes the Gupshup-issued templateCode + optional customParams. Simulates when
// RCS creds aren't set, so the card is usable before RCS provisioning completes.

router.get('/rcs/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      configured: GupshupService.isRCSConfigured(),
      ctmConfigured: Boolean(process.env.GUPSHUP_CTM_TOKEN && process.env.GUPSHUP_CTM_SERVICE_ID),
    },
  });
});

// ── RCS template listing + preview (from the Gupshup console CTM API) ──
// The enterprise send API has no template-list endpoint, so we read the console
// backend (ctm-api.gupshup.io) the dashboard itself uses. Auth is a short-lived
// console session JWT (GUPSHUP_CTM_TOKEN) — paste a fresh one when it expires.
// Each template's `elementName` IS the templateCode used in the RCS send.
function parseRcsTemplate(t) {
  // Recursively walk the component tree to pull out the body text, buttons and image.
  const texts = [], buttons = []; let image = null;
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (node.type === 'text' && node.text?.body) texts.push(node.text.body);
    if (node.type === 'image' && node.image?.url && !image) image = node.image.url;
    if (node.type === 'button' && node.button) {
      buttons.push({ text: node.button.text || '', action: node.button.action?.type || node.button.action?.value || '' });
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(t.components || []);
  return {
    code:   t.channelParams?.elementName || t.gsTemplateId || t.id,   // ← templateCode for send
    status: t.status,
    type:   t.channelParams?.templateType || null,
    body:   texts.join('\n\n'),
    buttons,
    image,
    createdOn: t.createdOn || null,
  };
}

router.get('/rcs/templates', async (_req, res) => {
  const base = process.env.GUPSHUP_CTM_BASE || 'https://ctm-api.gupshup.io';
  const svc  = process.env.GUPSHUP_CTM_SERVICE_ID;
  const token = process.env.GUPSHUP_CTM_TOKEN;
  if (!svc || !token) {
    return res.json({ success: true, data: [], note: 'CTM token/service not configured — set GUPSHUP_CTM_TOKEN + GUPSHUP_CTM_SERVICE_ID (console session token, expires ~30 min).' });
  }
  try {
    const url = `${base}/ctm/service/${svc}/template?channel=rcs&orderBy=createdOn&order=desc&pageNo=1&pageSize=100`;
    const r = await fetch(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}`, origin: 'https://console.gupshup.io' } });
    if (r.status === 401 || r.status === 403) {
      return res.status(200).json({ success: false, error: 'CTM token expired/invalid — paste a fresh console token into GUPSHUP_CTM_TOKEN.', data: [] });
    }
    const j = await r.json().catch(() => ({}));
    const templates = (j.templates || []).map(parseRcsTemplate);
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(200).json({ success: false, error: err.message, data: [] });
  }
});

// POST /rcs/test-send — Body: { phone, templateCode, name?, customParams?, smsFallback? }
router.post('/rcs/test-send', async (req, res) => {
  const { phone, templateCode, name, customParams, smsFallback } = req.body || {};
  const digits = String(phone || '').replace(/^\+/, '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(digits)) return res.status(400).json({ success: false, error: 'valid phone required (10-15 digits, no +)' });
  if (!templateCode) return res.status(400).json({ success: false, error: 'templateCode required (issued by Gupshup after RCS template approval)' });

  // Best-effort contact identity (stays null for ad-hoc numbers).
  let unifiedId = null;
  try {
    const { rows: [u] } = await db.query(
      `SELECT id FROM unified_contacts WHERE regexp_replace(COALESCE(mobile,''),'\\D','','g') = $1 LIMIT 1`, [digits]);
    unifiedId = u?.id ?? null;
  } catch { /* identity is optional */ }

  let result;
  try {
    result = await GupshupService.sendRCS({ to: digits, templateCode, customParams: customParams || null, smsFallback: smsFallback || null });
  } catch (err) {
    result = { success: false, error: err.message };
  }

  // Log into sms_send_log (shared channel log) tagged provider='gupshup-rcs';
  // templateCode is stored in message_body since RCS has no numeric template_id.
  try {
    const status = result?.simulated ? 'simulated' : (result?.success ? 'sent' : 'failed');
    await db.query(
      `INSERT INTO sms_send_log
         (unified_id, phone, contact_name, template_id, provider, external_id,
          status, source, error, message_body, sent_at)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,'test-send',$7,$8,
               CASE WHEN $6 IN ('sent','simulated') THEN NOW() ELSE NULL END)`,
      [unifiedId, digits, name || null, result?.provider || 'gupshup-rcs', result?.externalId || null,
       status, result?.success ? null : String(result?.error || 'send failed').slice(0, 500),
       `RCS templateCode=${templateCode}${customParams ? ` params=${JSON.stringify(customParams)}` : ''}`]
    );
  } catch (logErr) { console.warn('[gupshup/rcs/test-send] log write failed:', logErr.message); }

  res.json({ success: !!result?.success, data: { phone: digits, unifiedId, result } });
});

export default router;
