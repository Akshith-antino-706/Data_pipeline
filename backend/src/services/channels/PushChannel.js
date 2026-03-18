/**
 * Push Notification Channel — OneSignal
 *
 * Env vars:
 *   ONESIGNAL_APP_ID    – OneSignal App ID
 *   ONESIGNAL_API_KEY   – OneSignal REST API Key
 */

export class PushChannel {

  static get config() {
    return {
      appId: process.env.ONESIGNAL_APP_ID,
      apiKey: process.env.ONESIGNAL_API_KEY,
    };
  }

  /** Send push to specific users (by external_user_id / email) */
  static async send({ userIds, title, body, url, imageUrl }) {
    const { appId, apiKey } = this.config;

    if (!appId || !apiKey) {
      console.log(`[PUSH] To: ${userIds?.join(', ')} | Title: ${title}`);
      return {
        success: true,
        simulated: true,
        externalId: `sim_push_${Date.now()}`,
        provider: 'simulated',
      };
    }

    try {
      const payload = {
        app_id: appId,
        include_aliases: {
          external_id: Array.isArray(userIds) ? userIds : [userIds],
        },
        target_channel: 'push',
        headings: { en: title },
        contents: { en: body },
        ...(url && { url }),
        ...(imageUrl && { big_picture: imageUrl }),
      };

      const res = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.id) {
        return {
          success: true,
          externalId: data.id,
          provider: 'onesignal',
          recipients: data.recipients,
        };
      }

      return {
        success: false,
        error: data.errors?.join(', ') || 'Unknown OneSignal error',
        providerResponse: data,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Send push to a segment (OneSignal segment, not our segment) */
  static async sendToSegment({ segmentName, title, body, url }) {
    const { appId, apiKey } = this.config;

    if (!appId || !apiKey) {
      return { success: true, simulated: true };
    }

    try {
      const res = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: appId,
          included_segments: [segmentName],
          headings: { en: title },
          contents: { en: body },
          ...(url && { url }),
        }),
      });

      const data = await res.json();
      return data.id
        ? { success: true, externalId: data.id, provider: 'onesignal', recipients: data.recipients }
        : { success: false, error: data.errors?.join(', ') };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}
