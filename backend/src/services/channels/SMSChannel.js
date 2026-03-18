/**
 * SMS Channel — Twilio
 *
 * Env vars:
 *   TWILIO_SID        – Twilio Account SID
 *   TWILIO_AUTH_TOKEN  – Twilio Auth Token
 *   TWILIO_FROM        – Twilio phone number (e.g. +1234567890)
 */

export class SMSChannel {

  static get config() {
    return {
      sid: process.env.TWILIO_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM,
    };
  }

  /** Send a single SMS */
  static async send({ to, body }) {
    const { sid, authToken, from } = this.config;

    if (!sid || !authToken) {
      console.log(`[SMS] To: ${to} | Body: ${body.slice(0, 50)}...`);
      return {
        success: true,
        simulated: true,
        externalId: `sim_sms_${Date.now()}`,
        provider: 'simulated',
      };
    }

    try {
      const params = new URLSearchParams();
      params.append('To', to);
      params.append('From', from);
      params.append('Body', body);

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        }
      );

      const data = await res.json();

      if (data.sid) {
        return {
          success: true,
          externalId: data.sid,
          provider: 'twilio',
          status: data.status,
        };
      }

      return {
        success: false,
        error: data.message || 'Unknown Twilio error',
        providerResponse: data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Parse Twilio status webhook */
  static parseWebhook(body) {
    return {
      externalId: body.MessageSid,
      status: body.MessageStatus, // queued, sent, delivered, undelivered, failed
      to: body.To,
      from: body.From,
      errorCode: body.ErrorCode,
      errorMessage: body.ErrorMessage,
    };
  }
}
