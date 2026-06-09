/**
 * GupshupService — WhatsApp template approval + SMS (DLT) send + RCS template send.
 *
 * Every method checks for credentials first and falls back to simulation mode
 * when they're missing, so the whole pipeline is testable before keys land.
 *
 * Env vars (see docs/GUPSHUP_SETUP.md):
 *   WhatsApp:
 *     GUPSHUP_API_KEY, GUPSHUP_APP_NAME, GUPSHUP_APP_ID,
 *     GUPSHUP_WA_SOURCE, GUPSHUP_WA_NAMESPACE, GUPSHUP_CALLBACK_SECRET
 *   SMS:
 *     GUPSHUP_SMS_USER_ID, GUPSHUP_SMS_PASSWORD, GUPSHUP_SMS_SENDER_ID,
 *     DLT_PRINCIPAL_ENTITY_ID, DLT_TELEMARKETER_ID, DLT_HEADER_ID
 *   RCS (reuses SMS userid/password; legacy GatewayAPI endpoint covers both):
 *     GUPSHUP_RCS_BOT_ID, GUPSHUP_RCS_BOT_CATEGORY, GUPSHUP_RCS_BOT_BRAND
 */
import db from '../config/database.js';

const WA_API_BASE = 'https://api.gupshup.io/wa/api/v1';
const WA_TEMPLATE_BASE = 'https://api.gupshup.io/wa/app';
const SMS_API_BASE = 'https://enterprise.smsgupshup.com/GatewayAPI/rest';
// RCS shares the SMS gateway. Override via GUPSHUP_API_URL for staging if needed.
const RCS_API_BASE = process.env.GUPSHUP_API_URL || SMS_API_BASE;

export class GupshupService {

  // ── Config helpers ──────────────────────────────────────────────

  static get waConfig() {
    return {
      apiKey:    process.env.GUPSHUP_API_KEY,
      appName:   process.env.GUPSHUP_APP_NAME,
      appId:     process.env.GUPSHUP_APP_ID,
      source:    process.env.GUPSHUP_WA_SOURCE,
      namespace: process.env.GUPSHUP_WA_NAMESPACE,
      callbackSecret: process.env.GUPSHUP_CALLBACK_SECRET,
    };
  }

  static get smsConfig() {
    return {
      userId:          process.env.GUPSHUP_SMS_USER_ID,
      password:        process.env.GUPSHUP_SMS_PASSWORD,
      senderId:        process.env.GUPSHUP_SMS_SENDER_ID,
      dltEntityId:     process.env.DLT_PRINCIPAL_ENTITY_ID,
      dltTelemarketer: process.env.DLT_TELEMARKETER_ID,
      dltHeaderId:     process.env.DLT_HEADER_ID,
    };
  }

  static isWhatsAppConfigured() {
    const c = this.waConfig;
    return Boolean(c.apiKey && c.appName && c.appId);
  }

  static isSMSConfigured() {
    const c = this.smsConfig;
    return Boolean(c.userId && c.password && c.senderId);
  }

  static get rcsConfig() {
    // Per Gupshup support (2026-06-09), RCS SendMessage requires the
    // numeric Enterprise account credentials (e.g. 2000265179), NOT the
    // email-based RBM dashboard login. We expose them as GUPSHUP_RCS_*
    // env vars distinct from the SMS gateway credentials.
    //
    // Fallback to SMS vars is intentional: pre-support setups had SMS creds
    // wired in and worked end-to-end up to the auth boundary, so leaving
    // the fallback keeps older deployments working until they migrate.
    return {
      userId:      process.env.GUPSHUP_RCS_USER_ID   || process.env.GUPSHUP_SMS_USER_ID,
      password:    process.env.GUPSHUP_RCS_PASSWORD  || process.env.GUPSHUP_SMS_PASSWORD,
      botId:       process.env.GUPSHUP_RCS_BOT_ID,
      botCategory: process.env.GUPSHUP_RCS_BOT_CATEGORY,
      botBrand:    process.env.GUPSHUP_RCS_BOT_BRAND,
    };
  }

  static isRCSConfigured() {
    const c = this.rcsConfig;
    return Boolean(c.userId && c.password && c.botId);
  }

  // ── Template submission ────────────────────────────────────────

  /**
   * Submit a content_templates row to Gupshup for Meta approval (WhatsApp)
   * or record its DLT content template ID (SMS).
   *
   * Simulation mode: marks the row as 'pending' with a fake external_template_id.
   * The UI can then flip it to 'approved' manually via the approval endpoint.
   */
  static async submitTemplate(templateId) {
    const { rows: [tpl] } = await db.query('SELECT * FROM content_templates WHERE id = $1', [templateId]);
    if (!tpl) throw new Error(`Template ${templateId} not found`);
    if (!['whatsapp', 'sms'].includes(tpl.channel)) {
      throw new Error(`Channel '${tpl.channel}' does not require external approval (only whatsapp / sms do)`);
    }
    if (tpl.external_status === 'approved') {
      return { templateId, status: 'already_approved', externalId: tpl.external_template_id };
    }

    const prevStatus = tpl.external_status;
    const result = tpl.channel === 'whatsapp'
      ? await this._submitWhatsAppTemplate(tpl)
      : await this._submitSMSTemplate(tpl);

    await db.query(
      `UPDATE content_templates SET
         external_provider = 'gupshup',
         external_template_id = $2,
         external_status = $3,
         external_category = $4,
         external_submitted_at = NOW(),
         external_payload = $5,
         updated_at = NOW()
       WHERE id = $1`,
      [templateId, result.externalId, result.status, result.category || null, JSON.stringify(result.raw || {})]
    );
    await this._logEvent(templateId, 'submitted', prevStatus, result.status, { externalId: result.externalId, simulated: result.simulated });
    return { templateId, ...result };
  }

  static async _submitWhatsAppTemplate(tpl) {
    const c = this.waConfig;
    const category = tpl.category || 'MARKETING';  // override via tpl.external_category later

    if (!this.isWhatsAppConfigured()) {
      return {
        simulated: true,
        externalId: `sim_wa_${tpl.id}_${Date.now()}`,
        status: 'pending',
        category,
        raw: { simulated: true, note: 'Gupshup WA not configured — marked pending for local testing' },
      };
    }

    // Gupshup WA template API — POST /sm/api/v1/app/{appId}/template
    // Body (form-encoded): elementName, languageCode, content, category, templateType, vertical
    try {
      const form = new URLSearchParams();
      form.append('elementName', this._slug(tpl.name));
      form.append('languageCode', tpl.external_language || 'en');
      form.append('content', tpl.body);
      form.append('category', category);
      form.append('templateType', 'TEXT');
      form.append('vertical', 'Travel');
      if (tpl.subject) form.append('example', tpl.subject);

      const res = await fetch(`${WA_TEMPLATE_BASE}/${c.appId}/template`, {
        method: 'POST',
        headers: { 'apikey': c.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await res.json().catch(() => ({}));
      const status = (data?.status || '').toLowerCase() === 'success' ? 'pending' : 'error';
      return {
        simulated: false,
        externalId: data?.template?.id || data?.id || null,
        status,
        category,
        raw: data,
      };
    } catch (err) {
      return { simulated: false, externalId: null, status: 'error', category, raw: { error: err.message } };
    }
  }

  static async _submitSMSTemplate(tpl) {
    // SMS templates must be registered on the TRAI DLT portal BEFORE sending.
    // Gupshup doesn't register them — you (or ops) do, then pass the DLT
    // Content Template ID back here. This method just records the intent;
    // actual ID is set via setExternalId() once DLT returns it.
    return {
      simulated: !this.isSMSConfigured(),
      externalId: `sim_sms_dlt_${tpl.id}_${Date.now()}`,
      status: 'pending',
      category: tpl.external_category || 'transactional',
      raw: { note: 'SMS templates require TRAI DLT registration. Set external_template_id = DLT Content Template ID once registered.' },
    };
  }

  /** Manually set an external ID — used for SMS/DLT templates after registration */
  static async setExternalId(templateId, externalId, { status = 'pending', category = null } = {}) {
    const { rows: [tpl] } = await db.query('SELECT external_status FROM content_templates WHERE id = $1', [templateId]);
    if (!tpl) throw new Error(`Template ${templateId} not found`);
    await db.query(
      `UPDATE content_templates SET external_provider = 'gupshup', external_template_id = $2,
         external_status = $3, external_category = COALESCE($4, external_category),
         external_submitted_at = COALESCE(external_submitted_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [templateId, externalId, status, category]
    );
    await this._logEvent(templateId, 'submitted', tpl.external_status, status, { externalId, manual: true });
    return { templateId, externalId, status };
  }

  // ── Status check / approval webhook ───────────────────────────

  /** Poll Gupshup for current status of a submitted template */
  static async checkTemplateStatus(templateId) {
    const { rows: [tpl] } = await db.query('SELECT * FROM content_templates WHERE id = $1', [templateId]);
    if (!tpl) throw new Error(`Template ${templateId} not found`);
    if (!tpl.external_template_id) throw new Error('Template not submitted yet');

    const prevStatus = tpl.external_status;
    let newStatus = prevStatus;
    let raw = { simulated: true };

    if (tpl.channel === 'whatsapp' && this.isWhatsAppConfigured()) {
      const c = this.waConfig;
      try {
        const res = await fetch(`${WA_TEMPLATE_BASE}/${c.appId}/template/${tpl.external_template_id}`, {
          headers: { 'apikey': c.apiKey },
        });
        const data = await res.json().catch(() => ({}));
        newStatus = this._mapGupshupStatus(data?.template?.status || data?.status);
        raw = data;
      } catch (err) {
        raw = { error: err.message };
      }
    }

    await db.query(
      `UPDATE content_templates SET external_status = $2, external_last_checked_at = NOW(),
         external_approved_at = CASE WHEN $2 = 'approved' AND external_approved_at IS NULL THEN NOW() ELSE external_approved_at END,
         external_payload = COALESCE($3, external_payload)
       WHERE id = $1`,
      [templateId, newStatus, JSON.stringify(raw)]
    );
    await this._logEvent(templateId, 'status_checked', prevStatus, newStatus, raw);
    return { templateId, status: newStatus, changed: prevStatus !== newStatus };
  }

  /**
   * Webhook receiver — Gupshup calls our URL when a template's Meta review
   * resolves. Expected payload shape:
   *   { type: 'template-event', templateId, status: 'APPROVED'|'REJECTED'|... , reason }
   */
  static async handleWebhook(payload) {
    const extId = payload?.templateId || payload?.template?.id;
    const statusRaw = payload?.status || payload?.template?.status;
    if (!extId || !statusRaw) return { ignored: true, reason: 'missing templateId or status' };

    const status = this._mapGupshupStatus(statusRaw);
    const { rows: [tpl] } = await db.query(
      'SELECT id, external_status FROM content_templates WHERE external_template_id = $1',
      [extId]
    );
    if (!tpl) return { ignored: true, reason: 'unknown external template id' };

    await db.query(
      `UPDATE content_templates SET
         external_status = $2,
         external_approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE external_approved_at END,
         external_rejected_at = CASE WHEN $2 = 'rejected' THEN NOW() ELSE external_rejected_at END,
         external_rejection_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE external_rejection_reason END,
         external_payload = $4,
         updated_at = NOW()
       WHERE id = $1`,
      [tpl.id, status, payload.reason || null, JSON.stringify(payload)]
    );
    await this._logEvent(tpl.id, 'status_update', tpl.external_status, status, payload);
    return { templateId: tpl.id, status, previous: tpl.external_status };
  }

  /** Gate: is this template approved + ready to send? */
  static async assertApproved(templateId) {
    const { rows: [tpl] } = await db.query(
      'SELECT channel, external_status, name FROM content_templates WHERE id = $1',
      [templateId]
    );
    if (!tpl) throw new Error(`Template ${templateId} not found`);
    // Email bypasses Gupshup entirely
    if (tpl.channel === 'email' || tpl.channel === 'push') return true;
    if (tpl.external_status !== 'approved') {
      await this._logEvent(templateId, 'send_blocked', tpl.external_status, tpl.external_status, { reason: 'not_approved' });
      throw new Error(`Template "${tpl.name}" is not approved for sending via Gupshup (status: ${tpl.external_status || 'not_submitted'})`);
    }
    return true;
  }

  // ── Send methods (post-approval) ──────────────────────────────

  /** Send approved WhatsApp template to a user */
  static async sendWhatsApp({ to, templateId, params = [] }) {
    await this.assertApproved(templateId);
    const { rows: [tpl] } = await db.query('SELECT * FROM content_templates WHERE id = $1', [templateId]);

    if (!this.isWhatsAppConfigured()) {
      console.log(`[Gupshup/WA] Simulated send to ${to} | template=${tpl.external_template_id} | params=${JSON.stringify(params)}`);
      return { success: true, simulated: true, provider: 'gupshup-wa', externalId: `sim_msg_${Date.now()}` };
    }

    const c = this.waConfig;
    const form = new URLSearchParams();
    form.append('channel', 'whatsapp');
    form.append('source', c.source);
    form.append('destination', to.replace(/^\+/, ''));
    form.append('src.name', c.appName);
    form.append('template', JSON.stringify({ id: tpl.external_template_id, params }));

    try {
      const res = await fetch(`${WA_API_BASE}/template/msg`, {
        method: 'POST',
        headers: { 'apikey': c.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await res.json().catch(() => ({}));
      const success = (data?.status || '').toLowerCase() === 'submitted';
      return {
        success, provider: 'gupshup-wa',
        externalId: data?.messageId || null,
        raw: data,
        ...(success ? {} : { error: data?.message || 'send failed' }),
      };
    } catch (err) {
      return { success: false, error: err.message, provider: 'gupshup-wa' };
    }
  }

  /** Send approved SMS via Gupshup Enterprise + DLT metadata */
  static async sendSMS({ to, templateId, messageBody }) {
    await this.assertApproved(templateId);
    const { rows: [tpl] } = await db.query('SELECT * FROM content_templates WHERE id = $1', [templateId]);

    if (!this.isSMSConfigured()) {
      console.log(`[Gupshup/SMS] Simulated send to ${to} | DLT=${tpl.external_template_id}`);
      return { success: true, simulated: true, provider: 'gupshup-sms', externalId: `sim_sms_${Date.now()}` };
    }

    const c = this.smsConfig;
    const form = new URLSearchParams();
    form.append('method', 'SendMessage');
    form.append('send_to', to.replace(/^\+/, ''));
    form.append('msg', messageBody || tpl.body);
    form.append('msg_type', 'TEXT');
    form.append('userid', c.userId);
    form.append('auth_scheme', 'PLAIN');
    form.append('password', c.password);
    form.append('v', '1.1');
    form.append('format', 'json');
    form.append('mask', c.senderId);
    // DLT headers
    if (c.dltEntityId) form.append('principalEntityId', c.dltEntityId);
    if (tpl.external_template_id) form.append('dltTemplateId', tpl.external_template_id);

    try {
      const res = await fetch(`${SMS_API_BASE}?${form.toString()}`);
      const data = await res.json().catch(() => ({}));
      const success = data?.response?.status === 'success';
      return {
        success, provider: 'gupshup-sms',
        externalId: data?.response?.id || null,
        raw: data,
        ...(success ? {} : { error: data?.response?.details || 'send failed' }),
      };
    } catch (err) {
      return { success: false, error: err.message, provider: 'gupshup-sms' };
    }
  }

  // ── RCS (Gupshup RBM via legacy GatewayAPI) ───────────────────

  /**
   * Send an approved RCS template to a phone.
   *
   * Template approval is managed in the Gupshup Converse dashboard, NOT via
   * our content_templates table — so this method does NOT call assertApproved.
   * The caller passes the templateCode that's already approved in the bot.
   *
   *   to            E.164-ish phone (e.g. '919876543210' or '+919876543210')
   *   templateCode  the code Gupshup assigned (e.g. 'test_raynapromo')
   *   customParams  { variableName: value } — substituted into {{variableName}} placeholders
   *   meta          optional { entryId, nodeId, customerId } — logged to rcs_messages
   *
   * Returns { success, externalId, simulated, status, raw, error }.
   */
  static async sendRCS({ to, templateCode, customParams = null, meta = {} } = {}) {
    if (!to || !templateCode) {
      throw new Error('sendRCS: `to` and `templateCode` are required');
    }
    const destination = String(to).replace(/^\+/, '');

    // Opt-out gate — if the user STOP'd or got error_423 before, do not send.
    const { rows: optoutRows } = await db.query(
      'SELECT phone FROM rcs_optouts WHERE phone = $1 LIMIT 1',
      [destination]
    );
    if (optoutRows.length > 0) {
      const msgRow = await this._insertRcsMessage({
        destination, templateCode, customParams, meta,
        status: 'failed', errorCode: 'opted_out', errorReason: 'recipient previously opted out',
      });
      return { success: false, blocked: true, reason: 'opted_out', messageId: msgRow.id };
    }

    // Build the inner msg JSON. customParams must be a STRINGIFIED JSON value
    // per Gupshup's docs (https://docs.gupshup.io/reference/send-rcs-message).
    const templateMessage = { templateCode };
    if (customParams && Object.keys(customParams).length > 0) {
      templateMessage.customParams = JSON.stringify(customParams);
    }
    const msgPayload = { contentMessage: { templateMessage } };

    // Insert tracking row up front so callbacks can join on external_id later.
    const tracked = await this._insertRcsMessage({
      destination, templateCode, customParams, meta,
      status: 'queued', requestPayload: msgPayload,
    });

    if (!this.isRCSConfigured()) {
      const simulatedId = `sim_rcs_${tracked.id}_${Date.now()}`;
      await db.query(
        `UPDATE rcs_messages SET external_id = $1, status = 'submitted', updated_at = NOW() WHERE id = $2`,
        [simulatedId, tracked.id]
      );
      console.log(`[Gupshup/RCS] Simulated send to ${destination} | template=${templateCode}`);
      return { success: true, simulated: true, externalId: simulatedId, status: 'submitted', messageId: tracked.id };
    }

    const c = this.rcsConfig;
    const form = new URLSearchParams();
    form.append('method', 'SendMessage');
    form.append('send_to', destination);
    form.append('msg', JSON.stringify(msgPayload));
    form.append('msg_type', 'TEXT');
    form.append('userid', c.userId);
    form.append('auth_scheme', 'plain');
    form.append('password', c.password);
    form.append('v', '1.1');
    form.append('format', 'json');

    try {
      const res = await fetch(RCS_API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const data = await res.json().catch(() => ({}));
      const success = data?.response?.status === 'success';
      const externalId = data?.response?.id || null;

      await db.query(
        `UPDATE rcs_messages SET
           external_id = $1,
           status = $2,
           error_code = $3,
           error_reason = $4,
           response_payload = $5,
           failed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE failed_at END,
           updated_at = NOW()
         WHERE id = $6`,
        [
          externalId,
          success ? 'submitted' : 'failed',
          success ? null : (data?.response?.code || `http_${res.status}`),
          success ? null : (data?.response?.details || 'send failed'),
          JSON.stringify(data),
          tracked.id,
        ]
      );

      return {
        success,
        externalId,
        status: success ? 'submitted' : 'failed',
        raw: data,
        messageId: tracked.id,
        ...(success ? {} : { error: data?.response?.details || 'send failed' }),
      };
    } catch (err) {
      await db.query(
        `UPDATE rcs_messages SET status = 'failed', error_reason = $1, failed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [err.message, tracked.id]
      );
      return { success: false, error: err.message, messageId: tracked.id };
    }
  }

  /**
   * Update an rcs_messages row when Gupshup posts a DLR (sent/delivered/read/
   * failed) to our webhook. external_id is the gsId in the callback's
   * payload.gsId field.
   */
  static async recordRcsDlr({ externalId, type, destination, errorCode = null, errorReason = null, raw = null } = {}) {
    if (!externalId || !type) return { ignored: true, reason: 'missing externalId or type' };

    const t = String(type).toLowerCase();
    const setClauses = [`status = $1`, `updated_at = NOW()`];
    const params = [t];

    if (t === 'delivered') setClauses.push(`delivered_at = COALESCE(delivered_at, NOW())`);
    if (t === 'read')      setClauses.push(`read_at      = COALESCE(read_at, NOW())`);
    if (t === 'failed') {
      setClauses.push(`failed_at = COALESCE(failed_at, NOW())`);
      setClauses.push(`error_code   = COALESCE($${params.length + 1}, error_code)`);   params.push(errorCode);
      setClauses.push(`error_reason = COALESCE($${params.length + 1}, error_reason)`); params.push(errorReason);
    }

    params.push(externalId);
    const externalIdParamIndex = params.length;

    const { rowCount } = await db.query(
      `UPDATE rcs_messages SET ${setClauses.join(', ')} WHERE external_id = $${externalIdParamIndex}`,
      params
    );

    // 423 = user opted out (per the PDF error table). Mark them so future sends skip.
    if (t === 'failed' && String(errorCode) === '423' && destination) {
      await db.query(
        `INSERT INTO rcs_optouts (phone, source, raw_payload) VALUES ($1, 'error_423', $2)
         ON CONFLICT (phone) DO NOTHING`,
        [String(destination).replace(/^\+/, ''), JSON.stringify(raw || {})]
      );
    }

    return { matched: rowCount, type: t, externalId };
  }

  /**
   * Insert an inbound rcs_events row (user reply, button tap, URL click).
   * Returns the new row.
   */
  static async recordRcsInboundEvent({ externalMessageId, sourcePhone, eventType, payload, raw } = {}) {
    if (!sourcePhone || !eventType) {
      throw new Error('recordRcsInboundEvent: sourcePhone and eventType required');
    }
    const { rows: [row] } = await db.query(
      `INSERT INTO rcs_events (external_message_id, source_phone, event_type, payload, raw)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, received_at`,
      [externalMessageId || null, String(sourcePhone).replace(/^\+/, ''), eventType, JSON.stringify(payload || {}), JSON.stringify(raw || {})]
    );

    // Heuristic STOP-keyword opt-out: a text reply of just "stop" (any case).
    if (eventType === 'text' && /^stop\s*$/i.test(String(payload?.text || ''))) {
      await db.query(
        `INSERT INTO rcs_optouts (phone, source, raw_payload) VALUES ($1, 'stop_keyword', $2)
         ON CONFLICT (phone) DO NOTHING`,
        [String(sourcePhone).replace(/^\+/, ''), JSON.stringify(raw || {})]
      );
    }
    return row;
  }

  static async _insertRcsMessage({ destination, templateCode, customParams, meta = {}, status, errorCode = null, errorReason = null, requestPayload = null } = {}) {
    const c = this.rcsConfig;
    const { rows: [row] } = await db.query(
      `INSERT INTO rcs_messages
         (bot_id, destination, template_code, custom_params, status,
          error_code, error_reason, entry_id, node_id, customer_id, request_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        c.botId || null, destination, templateCode || null,
        customParams ? JSON.stringify(customParams) : null,
        status,
        errorCode, errorReason,
        meta.entryId || null, meta.nodeId || null, meta.customerId || null,
        requestPayload ? JSON.stringify(requestPayload) : null,
      ]
    );
    return row;
  }

  // ── Internal ──────────────────────────────────────────────────

  static _mapGupshupStatus(raw) {
    if (!raw) return 'pending';
    const s = String(raw).toUpperCase();
    if (s === 'APPROVED' || s === 'ENABLED') return 'approved';
    if (s === 'REJECTED') return 'rejected';
    if (s === 'PAUSED' || s === 'FLAGGED') return 'paused';
    if (s === 'DISABLED') return 'disabled';
    if (s === 'PENDING' || s === 'IN_APPEAL' || s === 'SUBMITTED') return 'pending';
    return 'pending';
  }

  static _slug(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 512);
  }

  static async _logEvent(templateId, eventType, prevStatus, newStatus, details) {
    try {
      await db.query(
        `INSERT INTO template_approval_events (template_id, provider, event_type, previous_status, new_status, details)
         VALUES ($1, 'gupshup', $2, $3, $4, $5)`,
        [templateId, eventType, prevStatus, newStatus, JSON.stringify(details || {})]
      );
    } catch (err) {
      console.error('[Gupshup] Failed to log approval event:', err.message);
    }
  }

  /** List approval events for a template (most recent first) */
  static async getEvents(templateId, limit = 20) {
    const { rows } = await db.query(
      `SELECT * FROM template_approval_events WHERE template_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [templateId, limit]
    );
    return rows;
  }

  /** Bulk submit: send every not-yet-submitted WA + SMS template for approval */
  static async bulkSubmit() {
    const { rows } = await db.query(
      `SELECT id FROM content_templates
       WHERE channel IN ('whatsapp', 'sms') AND (external_status IS NULL OR external_status = 'not_submitted')
       ORDER BY id`
    );
    const results = [];
    for (const r of rows) {
      try {
        results.push(await this.submitTemplate(r.id));
      } catch (err) {
        results.push({ templateId: r.id, error: err.message });
      }
    }
    return { submitted: results.length, results };
  }
}

export default GupshupService;
