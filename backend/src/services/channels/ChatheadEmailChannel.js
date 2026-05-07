/**
 * ChatheadEmailChannel — async send via Chathead API.
 *
 * Lifted from the verified-working scripts/send_html_template_via_chathead.js
 * shape: form-encoded POST with Bearer auth to /apis/email/send/index.php.
 * The plain JSON shape silently 200s and drops the request, so don't change
 * the wire format here without re-verifying delivery end-to-end.
 *
 * Env:
 *   CHATHEAD_API_URL       defaults to http://chathead.io/apis/email/send/index.php
 *   CHATHEAD_API_TOKEN     required — Bearer token
 *   CHATHEAD_FROM_EMAIL    defaults to travelguide@newsletter.raynatours.com
 *   CHATHEAD_FROM_NAME     defaults to "Rayna Tours"
 */

const DEFAULT_API_URL = 'http://chathead.io/apis/email/send/index.php';

function fromEmail() { return process.env.CHATHEAD_FROM_EMAIL || 'travelguide@newsletter.raynatours.com'; }
function fromName()  { return process.env.CHATHEAD_FROM_NAME  || 'Rayna Tours'; }

export class ChatheadEmailChannel {

  static isConfigured() {
    return Boolean(process.env.CHATHEAD_API_TOKEN);
  }

  /**
   * Send a single email.
   * @returns {{success, externalId?, simulated?, status?, body?, error?, durationMs}}
   */
  static async send({ to, subject, html, fromAddress = null, fromDisplay = null } = {}) {
    if (!to)      return { success: false, error: 'recipient (to) required' };
    if (!subject) return { success: false, error: 'subject required' };
    if (!html)    return { success: false, error: 'html body required' };

    if (!this.isConfigured()) {
      console.log(`[Chathead] Simulated send → ${to} | subject="${subject}" | bytes=${html.length}`);
      return { success: true, simulated: true, externalId: `sim_chathead_${Date.now()}`, durationMs: 0 };
    }

    const apiUrl = process.env.CHATHEAD_API_URL || DEFAULT_API_URL;
    const form = new URLSearchParams();
    form.append('from',        fromAddress || fromEmail());
    form.append('from_name',   fromDisplay || fromName());
    form.append('destination', to);
    form.append('subject',     subject);
    form.append('body',        html);

    const start = Date.now();
    let res, text;
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${process.env.CHATHEAD_API_TOKEN}`,
        },
        body: form.toString(),
      });
      text = await res.text();
    } catch (err) {
      return { success: false, error: `chathead network error: ${err.message}`, durationMs: Date.now() - start };
    }

    let body = null;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    const ok = res.ok && body?.status === 'success';
    return {
      success: ok,
      provider: 'chathead',
      status: res.status,
      externalId: body?.message_id || body?.id || null,
      body,
      raw: body ? null : text,                 // only return raw if JSON parse failed
      ...(ok ? {} : { error: body?.message || `HTTP ${res.status}` }),
      durationMs: Date.now() - start,
    };
  }
}

export default ChatheadEmailChannel;
