import { query, transaction } from '../config/database.js';
import { ContentService } from './ContentService.js';
import { BaseTemplateService } from './BaseTemplateService.js';
import ProductService from './ProductService.js';
import { getSegmentProducts } from '../templates/segmentProducts.js';
import SEGMENT_EMAIL_CONFIG from '../templates/segmentEmailConfig.js';

export class CampaignService {

  /** Get all campaigns with summary */
  static async getAll({ status, channel, page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) { conditions.push(`c.status = $${idx++}`); params.push(status); }
    if (channel) { conditions.push(`c.channel = $${idx++}`); params.push(channel); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;

    const [countRes, dataRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM campaigns c ${where}`, params),
      query(
        `SELECT c.*,
           s.name AS strategy_name,
           t.name AS template_name,
           CASE WHEN c.sent_count > 0
             THEN ROUND(c.delivered_count * 100.0 / c.sent_count, 1)
             ELSE 0 END AS delivery_rate,
           CASE WHEN c.delivered_count > 0
             THEN ROUND(c.read_count * 100.0 / c.delivered_count, 1)
             ELSE 0 END AS open_rate,
           CASE WHEN c.delivered_count > 0
             THEN ROUND(c.clicked_count * 100.0 / c.delivered_count, 1)
             ELSE 0 END AS click_rate
         FROM campaigns c
         LEFT JOIN omnichannel_strategies s ON s.id = c.strategy_id
         LEFT JOIN content_templates t ON t.id = c.template_id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      data: dataRes.rows,
      total: parseInt(countRes.rows[0].total),
      page,
      limit,
    };
  }

  /** Get single campaign with detailed analytics */
  static async getById(id) {
    const { rows } = await query(`
      SELECT c.*,
        s.name AS strategy_name,
        t.name AS template_name,
        t.body AS template_body,
        t.subject AS template_subject
      FROM campaigns c
      LEFT JOIN omnichannel_strategies s ON s.id = c.strategy_id
      LEFT JOIN content_templates t ON t.id = c.template_id
      WHERE c.id = $1
    `, [id]);

    if (!rows[0]) return null;

    // Get hourly analytics
    const analytics = await query(`
      SELECT hour_bucket, sent, delivered, read, clicked, bounced, failed,
             delivery_rate, open_rate, click_rate, bounce_rate
      FROM campaign_analytics
      WHERE campaign_id = $1
      ORDER BY hour_bucket
    `, [id]);

    // Get message status breakdown
    const statusBreakdown = await query(`
      SELECT status, COUNT(*) AS count
      FROM message_log
      WHERE campaign_id = $1
      GROUP BY status
      ORDER BY count DESC
    `, [id]);

    return {
      ...rows[0],
      analytics: analytics.rows,
      statusBreakdown: statusBreakdown.rows,
    };
  }

  /** Create a new campaign */
  static async create({ name, strategyId, segmentLabel, channel, templateId, filterCriteria, scheduledAt, createdBy }) {
    // Count target audience
    let targetQuery = `SELECT COUNT(*) AS count FROM customer_segments WHERE segment_label = $1`;
    const targetParams = [segmentLabel];

    if (channel === 'email') targetQuery += ' AND can_email = TRUE';
    if (channel === 'whatsapp') targetQuery += ' AND can_whatsapp = TRUE';
    if (channel === 'sms') targetQuery += ' AND can_sms = TRUE';

    const { rows: [{ count }] } = await query(targetQuery, targetParams);

    const { rows } = await query(`
      INSERT INTO campaigns (name, strategy_id, segment_label, channel, template_id, status, target_count, filter_criteria, scheduled_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      RETURNING *
    `, [name, strategyId, segmentLabel, channel, templateId, scheduledAt ? 'scheduled' : 'draft', parseInt(count), JSON.stringify(filterCriteria || {}), scheduledAt, createdBy]);

    return rows[0];
  }

  /** Execute a campaign — queue all messages */
  static async execute(campaignId) {
    return await transaction(async (client) => {
      // Lock the campaign
      const { rows: [campaign] } = await client.query(
        `SELECT * FROM campaigns WHERE id = $1 FOR UPDATE`, [campaignId]
      );

      if (!campaign) throw new Error('Campaign not found');
      if (!['draft', 'scheduled'].includes(campaign.status)) {
        throw new Error(`Cannot execute campaign in ${campaign.status} status`);
      }

      // Get template
      const { rows: [template] } = await client.query(
        `SELECT * FROM content_templates WHERE id = $1`, [campaign.template_id]
      );
      if (!template) throw new Error('Template not found');

      // Get target customers
      let customerQuery = `SELECT email, full_name, country, nationality, segment_label, total_bookings
                           FROM customer_segments WHERE segment_label = $1`;
      if (campaign.channel === 'email') customerQuery += ' AND can_email = TRUE';
      if (campaign.channel === 'whatsapp') customerQuery += ' AND can_whatsapp = TRUE';
      if (campaign.channel === 'sms') customerQuery += ' AND can_sms = TRUE';

      const { rows: customers } = await client.query(customerQuery, [campaign.segment_label]);

      // Queue messages
      let queued = 0;
      for (const customer of customers) {
        let { body, subject } = ContentService.renderTemplate(template, customer);

        // For email campaigns: wrap in Rayna Tours base template with products + coupon
        if (campaign.channel === 'email') {
          try {
            const firstName = (customer.full_name || '').split(' ')[0] || 'Traveler';
            const segConfig = SEGMENT_EMAIL_CONFIG[campaign.segment_label] || {};
            // Dynamic products from API, fallback to hardcoded
            let products;
            try {
              const dynamic = await ProductService.getForSegment(campaign.segment_label, 3);
              if (dynamic.length > 0) {
                products = dynamic.map(p => ({
                  product_url: p.url || 'https://www.raynatours.com',
                  product_image: p.image || '',
                  product_category: (p.item_group_id || '').replace(/-/g, ' '),
                  product_name: p.name || '',
                  product_rating: p.rating || '4.8',
                  product_reviews: String(p.reviewCount || ''),
                  product_price: String(p.salePrice || ''),
                  product_strike_price: String(p.normalPrice || ''),
                }));
              }
            } catch { /* API down */ }
            if (!products || products.length === 0) {
              products = getSegmentProducts(campaign.segment_label);
            }

            // Add UTM params to each product URL
            const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            const utmParams = `utm_source=rayna_platform&utm_medium=email&utm_campaign=${slug(campaign.segment_label)}&utm_content=${slug(campaign.name)}`;
            const trackedProducts = products.map(p => ({
              ...p,
              product_url: p.product_url + (p.product_url.includes('?') ? '&' : '?') + utmParams,
            }));

            // Use segment config for heading, body, and subject — not internal step labels
            const emailHeading = segConfig.email_heading || 'Special Offer from Rayna Tours';
            const emailBody = segConfig.email_body || body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            subject = segConfig.subject || subject;
            const hasCoupon = !!(template.coupon_code || segConfig.coupon_code);

            const baseTemplate = segConfig.baseTemplate || 'product-recommendation';
            body = BaseTemplateService.render(baseTemplate, {
              customer_name: firstName,
              email_heading: emailHeading,
              email_body: emailBody,
              cta_url: segConfig.cta_url
                ? segConfig.cta_url + (segConfig.cta_url.includes('?') ? '&' : '?') + utmParams
                : (trackedProducts[0]?.product_url) || 'https://www.raynatours.com/activities?' + utmParams,
              ...(hasCoupon ? {
                coupon_code: template.coupon_code || segConfig.coupon_code,
                coupon_discount: segConfig.coupon_discount || 'Flat 15% Off',
                coupon_expiry: segConfig.coupon_expiry || '7 days',
              } : {}),
              products: trackedProducts,
            });
          } catch (e) {
            console.warn('[Campaign] Base template render failed, using raw:', e.message);
          }
        }

        await client.query(`
          INSERT INTO message_log (campaign_id, customer_email, channel, template_id, status, rendered_body, rendered_subject)
          VALUES ($1, $2, $3, $4, 'queued', $5, $6)
        `, [campaignId, customer.email, campaign.channel, template.id, body, subject]);
        queued++;
      }

      // Update campaign status
      await client.query(`
        UPDATE campaigns SET status = 'running', started_at = NOW(), target_count = $2 WHERE id = $1
      `, [campaignId, queued]);

      return { campaignId, queued };
    });
  }

  /** Process queued messages (called by worker/cron) */
  static async processQueue(batchSize = 100) {
    const { rows: messages } = await query(`
      SELECT ml.*, c.channel
      FROM message_log ml
      JOIN campaigns c ON c.id = ml.campaign_id
      WHERE ml.status = 'queued'
      ORDER BY ml.queued_at
      LIMIT $1
    `, [batchSize]);

    const results = { sent: 0, failed: 0 };

    for (const msg of messages) {
      try {
        let sendResult = { success: true, simulated: true };

        if (msg.channel === 'email') {
          const { EmailChannel } = await import('./channels/EmailChannel.js');
          const { EmailTrackingService } = await import('./EmailTrackingService.js');
          const trackedHtml = EmailTrackingService.injectTracking(msg.rendered_body, msg.id);
          sendResult = await EmailChannel.send({
            to: msg.customer_email,
            subject: msg.rendered_subject || 'Rayna Tours',
            html: trackedHtml,
          });
        }

        if (sendResult.success) {
          await query(`
            UPDATE message_log
            SET status = 'sent', sent_at = NOW(), external_id = $2,
                provider_response = $3::jsonb
            WHERE id = $1
          `, [msg.id, sendResult.externalId || null, JSON.stringify(sendResult)]);
          results.sent++;
        } else {
          throw new Error(sendResult.error || 'Send failed');
        }
      } catch (err) {
        await query(`
          UPDATE message_log
          SET status = 'failed', failed_at = NOW(), failure_reason = $2
          WHERE id = $1
        `, [msg.id, err.message]);
        results.failed++;
      }
    }

    // Update campaign aggregate counts
    await query(`
      UPDATE campaigns c SET
        sent_count = sub.sent,
        delivered_count = sub.delivered,
        read_count = sub.read,
        clicked_count = sub.clicked,
        bounced_count = sub.bounced,
        failed_count = sub.failed,
        status = CASE
          WHEN sub.queued = 0 AND c.status = 'running' THEN 'completed'::campaign_status
          ELSE c.status
        END,
        completed_at = CASE
          WHEN sub.queued = 0 AND c.status = 'running' THEN NOW()
          ELSE c.completed_at
        END
      FROM (
        SELECT
          campaign_id,
          COUNT(*) FILTER (WHERE status = 'sent') AS sent,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(*) FILTER (WHERE status = 'read') AS read,
          COUNT(*) FILTER (WHERE status = 'clicked') AS clicked,
          COUNT(*) FILTER (WHERE status = 'bounced') AS bounced,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed,
          COUNT(*) FILTER (WHERE status = 'queued') AS queued
        FROM message_log
        GROUP BY campaign_id
      ) sub
      WHERE c.id = sub.campaign_id
    `);

    return results;
  }

  /** Get campaign performance summary across all campaigns */
  static async getPerformanceSummary() {
    const { rows } = await query(`
      SELECT
        channel,
        COUNT(*) AS total_campaigns,
        SUM(sent_count) AS total_sent,
        SUM(delivered_count) AS total_delivered,
        SUM(read_count) AS total_read,
        SUM(clicked_count) AS total_clicked,
        SUM(bounced_count) AS total_bounced,
        CASE WHEN SUM(sent_count) > 0
          THEN ROUND(SUM(delivered_count) * 100.0 / SUM(sent_count), 1)
          ELSE 0 END AS avg_delivery_rate,
        CASE WHEN SUM(delivered_count) > 0
          THEN ROUND(SUM(read_count) * 100.0 / SUM(delivered_count), 1)
          ELSE 0 END AS avg_open_rate,
        CASE WHEN SUM(delivered_count) > 0
          THEN ROUND(SUM(clicked_count) * 100.0 / SUM(delivered_count), 1)
          ELSE 0 END AS avg_click_rate
      FROM campaigns
      WHERE status IN ('running', 'completed')
      GROUP BY channel
    `);
    return rows;
  }
}
