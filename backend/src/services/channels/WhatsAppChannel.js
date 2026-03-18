/**
 * WhatsApp Business API Channel
 * Supports: Meta Cloud API (graph.facebook.com)
 *
 * Env vars needed:
 *   WHATSAPP_PHONE_ID   – WhatsApp business phone number ID
 *   WHATSAPP_TOKEN       – Permanent access token
 */

const BASE_URL = 'https://graph.facebook.com/v21.0';

export class WhatsAppChannel {

  static get config() {
    return {
      phoneId: process.env.WHATSAPP_PHONE_ID,
      token: process.env.WHATSAPP_TOKEN,
    };
  }

  /** Send a template message */
  static async sendTemplate({ to, templateName, namespace, languageCode = 'en', components = [] }) {
    const { phoneId, token } = this.config;
    if (!phoneId || !token) {
      return { success: false, error: 'WhatsApp not configured', simulated: true };
    }

    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(namespace && { namespace }),
        ...(components.length && { components }),
      },
    };

    return this._send(body);
  }

  /** Send a free-form text message (within 24hr window) */
  static async sendText({ to, text }) {
    const { phoneId, token } = this.config;
    if (!phoneId || !token) {
      return { success: false, error: 'WhatsApp not configured', simulated: true };
    }

    return this._send({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  /** Send an image message */
  static async sendImage({ to, imageUrl, caption }) {
    return this._send({
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, ...(caption && { caption }) },
    });
  }

  /** Core send method */
  static async _send(body) {
    const { phoneId, token } = this.config;
    try {
      const res = await fetch(`${BASE_URL}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.messages?.[0]?.id) {
        return {
          success: true,
          externalId: data.messages[0].id,
          provider: 'whatsapp_cloud',
        };
      }

      return {
        success: false,
        error: data.error?.message || 'Unknown error',
        providerResponse: data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Get message status (webhook-driven in production, this is for manual check) */
  static parseWebhook(body) {
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value) return null;

    // Message status update
    if (value.statuses?.[0]) {
      const s = value.statuses[0];
      return {
        type: 'status',
        externalId: s.id,
        recipientId: s.recipient_id,
        status: s.status, // sent, delivered, read, failed
        timestamp: s.timestamp,
        errors: s.errors,
      };
    }

    // Incoming message
    if (value.messages?.[0]) {
      const m = value.messages[0];
      return {
        type: 'incoming',
        from: m.from,
        messageId: m.id,
        text: m.text?.body,
        timestamp: m.timestamp,
      };
    }

    return null;
  }
}
