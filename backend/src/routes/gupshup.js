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

export default router;
