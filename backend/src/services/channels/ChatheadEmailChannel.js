/**
 * ChatheadEmailChannel — send via AWS Email API.
 *
 * Env:
 *   AWS_EMAIL_API_URL       defaults to http://95.211.169.194/apis/aws/send/index.php
 *   AWS_EMAIL_FROM          defaults to explore@promotions.raynatours.com
 *   AWS_EMAIL_CAMPAIGN_ID   defaults to 1
 */

import { isEmailAllowed } from '../../utils/emailAllowlist.js';

const DEFAULT_API_URL  = 'http://95.211.169.194/apis/aws/send/index.php';
const DEFAULT_FROM     = 'Rayna Tours <explore@promotions.raynatours.com>';

function fromEmail() { return process.env.AWS_EMAIL_FROM || DEFAULT_FROM; }
function campaignId() { return process.env.AWS_EMAIL_CAMPAIGN_ID || '1'; }

export class ChatheadEmailChannel {

  static isConfigured() {
    // Always configured — we have hardcoded defaults for API URL and from email
    return true;
  }

  static async send({ to, subject, html, fromAddress = null } = {}) {
    if (!to)      return { success: false, error: 'recipient (to) required' };
    if (!subject) return { success: false, error: 'subject required' };
    if (!html)    return { success: false, error: 'html body required' };

    // WELCOME_EMAILS allow-list gate — only configured addresses may receive mail.
    // Disabled when WELCOME_EMAILS is unset/empty (allows all). Universal backstop:
    // every send path that reaches this transport is validated here.
    if (!isEmailAllowed(to)) {
      console.log(`[AWS Email] Skipped — ${to} not in WELCOME_EMAILS allow-list`);
      return { success: false, skipped: true, reason: 'not_in_allowlist', provider: 'allowlist' };
    }

    if (!this.isConfigured()) {
      console.log(`[AWS Email] Simulated send → ${to} | subject="${subject}" | bytes=${html.length}`);
      return { success: true, simulated: true, externalId: `sim_aws_${Date.now()}`, durationMs: 0 };
    }

    const apiUrl = process.env.AWS_EMAIL_API_URL || DEFAULT_API_URL;
    const payload = {
      from:         fromAddress || fromEmail(),
      subject,
      destinations: [to],
      body:         html,
      campaign_id:  campaignId(),
    };

    const start = Date.now();
    let res, text;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      text = await res.text();
    } catch (err) {
      return { success: false, error: `aws email network error: ${err.message}`, durationMs: Date.now() - start };
    }

    let body = null;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    const ok = res.ok && body?.status === 'success';
    if (!ok) {
      console.warn(`[AWS Email] REJECTED ${to} → HTTP ${res.status} | body:`, text.slice(0, 300));
    }
    return {
      success: ok,
      provider: 'aws-email',
      status: res.status,
      externalId: body?.message_id || body?.id || null,
      body,
      raw: body ? null : text,
      ...(ok ? {} : { error: body?.msg || body?.message || `HTTP ${res.status}` }),
      durationMs: Date.now() - start,
    };
  }
}

export default ChatheadEmailChannel;
