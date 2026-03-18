/**
 * Email Channel — supports SendGrid API or SMTP via Nodemailer
 *
 * Env vars:
 *   EMAIL_PROVIDER     – 'sendgrid' | 'smtp' (default: 'smtp')
 *   SENDGRID_API_KEY   – SendGrid API key (if provider = sendgrid)
 *   SMTP_HOST          – SMTP server hostname (e.g. smtp.office365.com)
 *   SMTP_PORT          – SMTP server port (587 for TLS, 465 for SSL)
 *   SMTP_USER          – SMTP username / email
 *   SMTP_PASS          – SMTP password
 *   SMTP_SECURE        – 'true' for port 465 SSL, 'false' for STARTTLS (default: false)
 *   EMAIL_FROM         – Default sender email
 *   EMAIL_FROM_NAME    – Default sender name
 */

import nodemailer from 'nodemailer';

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[EMAIL] SMTP not fully configured — emails will be simulated');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false,
    },
  });

  // Verify connection on first use
  _transporter.verify()
    .then(() => console.log(`[EMAIL] SMTP connected: ${host}:${port} as ${user}`))
    .catch(err => console.error(`[EMAIL] SMTP verify failed: ${err.message}`));

  return _transporter;
}

export class EmailChannel {

  static get config() {
    return {
      provider: process.env.EMAIL_PROVIDER || 'smtp',
      sendgridKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.EMAIL_FROM || 'marketing@raynatours.com',
      fromName: process.env.EMAIL_FROM_NAME || 'Rayna Tours',
    };
  }

  /** Send a single email */
  static async send({ to, subject, html, text, replyTo }) {
    const { provider, sendgridKey, fromEmail, fromName } = this.config;

    // SendGrid path
    if (provider === 'sendgrid' && sendgridKey) {
      return this._sendViaSendGrid({ to, subject, html, text, replyTo });
    }

    // SMTP path
    if (provider === 'smtp') {
      return this._sendViaSMTP({ to, subject, html, text, replyTo });
    }

    // Simulated send (fallback for development)
    console.log(`[EMAIL] Simulated → To: ${to} | Subject: ${subject}`);
    return {
      success: true,
      simulated: true,
      externalId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      provider: 'simulated',
    };
  }

  /** Send via SMTP using Nodemailer */
  static async _sendViaSMTP({ to, subject, html, text, replyTo }) {
    const { fromEmail, fromName } = this.config;
    const transporter = getTransporter();

    if (!transporter) {
      // Fall back to simulated if SMTP not configured
      console.log(`[EMAIL] SMTP not configured — simulating → To: ${to}`);
      return {
        success: true,
        simulated: true,
        externalId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        provider: 'simulated',
      };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        html,
        ...(text && { text }),
        ...(replyTo && { replyTo }),
      });

      console.log(`[EMAIL] Sent via SMTP → To: ${to} | MessageId: ${info.messageId}`);
      return {
        success: true,
        externalId: info.messageId,
        provider: 'smtp',
      };
    } catch (err) {
      console.error(`[EMAIL] SMTP send failed → To: ${to} | Error: ${err.message}`);
      return {
        success: false,
        error: err.message,
        provider: 'smtp',
      };
    }
  }

  /** Send via SendGrid API */
  static async _sendViaSendGrid({ to, subject, html, text, replyTo }) {
    const { sendgridKey, fromEmail, fromName } = this.config;

    const body = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [
        ...(text ? [{ type: 'text/plain', value: text }] : []),
        { type: 'text/html', value: html },
      ],
      ...(replyTo && { reply_to: { email: replyTo } }),
      tracking_settings: {
        click_tracking: { enable: true },
        open_tracking: { enable: true },
      },
    };

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.status === 202) {
        const messageId = res.headers.get('x-message-id');
        return {
          success: true,
          externalId: messageId || `sg_${Date.now()}`,
          provider: 'sendgrid',
        };
      }

      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData.errors?.[0]?.message || `HTTP ${res.status}`,
        providerResponse: errData,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Send bulk emails (batch) */
  static async sendBulk(messages) {
    const results = [];
    for (const msg of messages) {
      const result = await this.send(msg);
      results.push({ to: msg.to, ...result });
    }
    return results;
  }

  /** Parse SendGrid webhook event */
  static parseWebhook(events) {
    return events.map(event => ({
      externalId: event.sg_message_id,
      email: event.email,
      event: event.event,
      timestamp: event.timestamp,
      url: event.url,
      reason: event.reason,
      ip: event.ip,
      userAgent: event.useragent,
    }));
  }
}
