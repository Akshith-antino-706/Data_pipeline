import { query } from '../config/database.js';

/**
 * Email Tracking Service
 * - Open tracking via 1x1 pixel
 * - Click tracking via redirect endpoint
 * - Injects tracking into HTML before sending
 */
export class EmailTrackingService {

  static get baseUrl() {
    return process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  }

  /**
   * Record an email open
   */
  static async trackOpen(messageId) {
    await query(`
      UPDATE message_log
      SET status = CASE WHEN status = 'sent' THEN 'read'::message_status ELSE status END,
          read_at = COALESCE(read_at, NOW())
      WHERE id = $1
    `, [messageId]);

    // Update campaign read_count
    await query(`
      UPDATE campaigns c SET read_count = sub.cnt
      FROM (
        SELECT campaign_id, COUNT(*) as cnt
        FROM message_log WHERE read_at IS NOT NULL AND campaign_id = (
          SELECT campaign_id FROM message_log WHERE id = $1
        )
        GROUP BY campaign_id
      ) sub
      WHERE c.id = sub.campaign_id
    `, [messageId]);
  }

  /**
   * Record a link click
   */
  static async trackClick(messageId, url) {
    await query(`
      UPDATE message_log
      SET status = 'clicked'::message_status,
          clicked_at = COALESCE(clicked_at, NOW()),
          read_at = COALESCE(read_at, NOW())
      WHERE id = $1
    `, [messageId]);

    // Update campaign clicked_count
    await query(`
      UPDATE campaigns c SET
        clicked_count = sub.clicked,
        read_count = sub.read
      FROM (
        SELECT campaign_id,
          COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as clicked,
          COUNT(*) FILTER (WHERE read_at IS NOT NULL) as read
        FROM message_log WHERE campaign_id = (
          SELECT campaign_id FROM message_log WHERE id = $1
        )
        GROUP BY campaign_id
      ) sub
      WHERE c.id = sub.campaign_id
    `, [messageId]);

    // Increment clicks on utm_tracking if URL has UTM params
    try {
      const urlObj = new URL(url);
      const utm_campaign = urlObj.searchParams.get('utm_campaign');

      if (utm_campaign) {
        const { rows: [msg] } = await query('SELECT campaign_id FROM message_log WHERE id = $1', [messageId]);
        if (msg) {
          await query(`
            UPDATE utm_tracking SET clicks = clicks + 1
            WHERE campaign_id = $1 AND utm_campaign = $2
          `, [msg.campaign_id, utm_campaign]);
        }
      }
    } catch { /* non-UTM URL, skip */ }
  }

  /**
   * Inject open pixel + wrap all links for click tracking
   */
  static injectTracking(html, messageId) {
    const base = this.baseUrl;

    // 1. Open tracking pixel — 1x1 transparent GIF
    const pixel = `<img src="${base}/api/track/open/${messageId}" width="1" height="1" style="display:none" alt="" />`;
    html = html.replace('</body>', `${pixel}</body>`);
    // Fallback if no </body> tag
    if (!html.includes(pixel)) {
      html += pixel;
    }

    // 2. Click tracking — wrap all href links
    html = html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
      // Don't wrap tracking URLs or mailto
      if (url.includes('/api/track/') || url.startsWith('mailto:')) return match;
      const tracked = `${base}/api/track/click/${messageId}?url=${encodeURIComponent(url)}`;
      return `href="${tracked}"`;
    });

    return html;
  }
}
