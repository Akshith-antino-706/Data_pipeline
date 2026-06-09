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
    rcs:      { configured: GupshupService.isRCSConfigured(), botId: process.env.GUPSHUP_RCS_BOT_ID || null },
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

/**
 * RCS callback receiver. Gupshup posts two top-level shapes here (see the
 * PDF "Inbound messages and events" + page 27 onwards):
 *
 *   type: "message"       → inbound user activity (text/image/button_reply/url_action/...)
 *   type: "message-event" → DLR (sent|delivered|read|failed)
 *
 * Both shapes share { app, timestamp, version, type, payload }. We always
 * respond 200 — Gupshup retries on non-2xx and we don't want loops if our
 * parser hits an edge case.
 */
router.post('/webhook/rcs', async (req, res) => {
  const body = req.body || {};
  try {
    const { type, payload } = body;
    if (!type || !payload) {
      return res.status(200).json({ received: true, ignored: 'missing type/payload' });
    }

    if (type === 'message-event') {
      // DLR. payload = { id, gsId, type, destination, payload: { code?, reason?, ts? } }
      const externalId  = payload.gsId || payload.id;
      const eventType   = payload.type;  // sent|delivered|read|failed
      const errorCode   = payload?.payload?.code != null ? String(payload.payload.code) : null;
      const errorReason = payload?.payload?.reason || null;
      const destination = payload.destination || null;

      const result = await GupshupService.recordRcsDlr({
        externalId, type: eventType, destination, errorCode, errorReason, raw: body,
      });
      return res.json({ received: true, ...result });
    }

    if (type === 'message') {
      // Inbound P2A: payload = { id, source, type, payload: {...}, sender, context? }
      const externalMessageId = payload?.context?.gsId || payload?.context?.id || null;
      const sourcePhone = payload?.sender?.phone || payload?.source;
      const eventType   = payload.type;   // text|image|video|button_reply|url_action|dialer_action|contact|location|reply_action
      const inner       = payload.payload || {};

      const event = await GupshupService.recordRcsInboundEvent({
        externalMessageId, sourcePhone, eventType, payload: inner, raw: body,
      });
      return res.json({ received: true, eventId: event.id });
    }

    return res.status(200).json({ received: true, ignored: `unhandled type: ${type}` });
  } catch (err) {
    console.error('[Gupshup RCS webhook] error:', err);
    // 200 so Gupshup doesn't loop on retries while we debug
    return res.status(200).json({ received: true, error: err.message });
  }
});

// ── RCS doc-aligned send + read endpoints ──────────────────────

/** Status of the legacy RCS gateway: are credentials in env? */
router.get('/rcs/config', (_req, res) => {
  res.json({
    success: true,
    data: {
      configured: GupshupService.isRCSConfigured(),
      apiUrl: process.env.GUPSHUP_API_URL || 'https://enterprise.smsgupshup.com/GatewayAPI/rest',
      bot: {
        id:       process.env.GUPSHUP_RCS_BOT_ID || null,
        category: process.env.GUPSHUP_RCS_BOT_CATEGORY || null,
        brand:    process.env.GUPSHUP_RCS_BOT_BRAND || null,
      },
    },
  });
});

/**
 * Send an approved RCS template to one-or-many recipients via the legacy
 * GatewayAPI/rest endpoint (the doc-aligned per-message API).
 *
 * Body:
 *   {
 *     templateCode: "test_raynapromo",         // required — Gupshup-approved code
 *     recipients:   ["919876543210", ...] OR   // array of phone strings, or
 *                   [{ phone: "919...", customParams?: {...} }],
 *     customParams: { "DISCOUNT": "20%" },     // optional — applied to every recipient
 *                                              // (per-recipient customParams override this)
 *   }
 *
 * Returns:
 *   { success: true, data: { sent, failed, results: [{ phone, success, externalId?, error? }] } }
 */
router.post('/rcs/send', async (req, res) => {
  try {
    const { templateCode, recipients, customParams: globalParams = null } = req.body || {};
    if (!templateCode) {
      return res.status(400).json({ success: false, error: 'templateCode required' });
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'recipients (non-empty array) required' });
    }

    // Normalize each recipient into { phone, customParams }
    const normalized = recipients.map(r => {
      if (typeof r === 'string') return { phone: r, customParams: globalParams };
      return { phone: r.phone, customParams: r.customParams || globalParams };
    }).filter(r => r.phone);

    const results = [];
    let sent = 0, failed = 0;
    for (const r of normalized) {
      try {
        const result = await GupshupService.sendRCS({
          to: r.phone,
          templateCode,
          customParams: r.customParams,
        });
        if (result.success) sent++; else failed++;
        results.push({ phone: r.phone, ...result });
      } catch (err) {
        failed++;
        results.push({ phone: r.phone, success: false, error: err.message });
      }
    }

    res.json({ success: true, data: { sent, failed, total: normalized.length, results } });
  } catch (err) {
    console.error('[POST /rcs/send] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** History — recent rcs_messages rows (newest first). */
router.get('/rcs/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const { rows } = await db.query(
      `SELECT id, external_id, bot_id, destination, template_code, status, error_code,
              error_reason, sent_at, delivered_at, read_at, failed_at, request_payload
       FROM rcs_messages ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** History — recent rcs_events rows (inbound activity). */
router.get('/rcs/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const { rows } = await db.query(
      `SELECT id, external_message_id, source_phone, event_type, payload, received_at
       FROM rcs_events ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
