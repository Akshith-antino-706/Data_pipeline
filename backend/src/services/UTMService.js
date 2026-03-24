import db from '../config/database.js';

/**
 * UTM Tracking Service — Campaign-Centric
 * Every campaign gets a UTM link. Templates feed into campaigns.
 * Format: ?utm_source=AI_marketer&utm_medium=[channel]&utm_campaign=[campaign_name]_[segment]&utm_content=[channel]_[campaign_id]
 */
class UTMService {

  static BASE_URL = 'https://www.raynatours.com/activities';

  /**
   * Build a UTM URL
   */
  static buildUTM({ baseUrl, channel, campaignName, segmentLabel, campaignId, contentNumber = 1 }) {
    const base = baseUrl || this.BASE_URL;
    const medium = channel || 'email';
    const campaign = `${(campaignName || 'campaign').replace(/[^a-zA-Z0-9_-]/g, '_')}_${(segmentLabel || 'all').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const content = campaignId ? `${medium}_camp${campaignId}` : `${medium}_${contentNumber}`;

    const params = new URLSearchParams({
      utm_source: 'AI_marketer',
      utm_medium: medium,
      utm_campaign: campaign,
      utm_content: content
    });

    return `${base}?${params.toString()}`;
  }

  /**
   * Generate UTM link for a single campaign
   */
  static async generateForCampaign(campaignId) {
    const { rows: [campaign] } = await db.query(`
      SELECT c.*, ct.cta_url AS template_cta_url
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.id = $1
    `, [campaignId]);
    if (!campaign) throw new Error('Campaign not found');

    const baseUrl = campaign.template_cta_url || this.BASE_URL;
    const fullUrl = this.buildUTM({
      baseUrl,
      channel: campaign.channel,
      campaignName: campaign.name,
      segmentLabel: campaign.segment_label,
      campaignId: campaign.id
    });

    const { rows: [utm] } = await db.query(`
      INSERT INTO utm_tracking (campaign_id, template_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url, base_url)
      VALUES ($1, $2, $3, $4, 'AI_marketer', $5, $6, $7, $8, $9)
      ON CONFLICT DO NOTHING
      RETURNING utm_id
    `, [
      campaign.id,
      campaign.template_id,
      campaign.segment_label,
      campaign.channel,
      campaign.channel,
      `${campaign.name}_${campaign.segment_label}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      `${campaign.channel}_camp${campaign.id}`,
      fullUrl,
      baseUrl
    ]);

    return { campaign_id: campaign.id, campaign_name: campaign.name, segment: campaign.segment_label, channel: campaign.channel, utm_url: fullUrl, utm_id: utm?.utm_id };
  }

  /**
   * Generate UTM links for ALL campaigns in a segment
   */
  static async generateForSegment(segmentLabel) {
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.name, c.segment_label, c.channel::text AS channel, c.template_id,
        ct.cta_url AS template_cta_url
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.segment_label = $1
      ORDER BY c.id
    `, [segmentLabel]);

    const results = [];
    for (const camp of campaigns) {
      const baseUrl = camp.template_cta_url || this.BASE_URL;
      const fullUrl = this.buildUTM({
        baseUrl,
        channel: camp.channel,
        campaignName: camp.name,
        segmentLabel: camp.segment_label,
        campaignId: camp.id
      });

      await db.query(`
        INSERT INTO utm_tracking (campaign_id, template_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url, base_url)
        VALUES ($1, $2, $3, $4::channel_type, 'AI_marketer', $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
      `, [
        camp.id,
        camp.template_id,
        camp.segment_label,
        camp.channel,
        camp.channel,
        `${camp.name}_${camp.segment_label}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        `${camp.channel}_camp${camp.id}`,
        fullUrl,
        baseUrl
      ]);

      results.push({
        campaign_id: camp.id,
        campaign_name: camp.name,
        channel: camp.channel,
        utm_url: fullUrl
      });
    }

    return results;
  }

  /**
   * Generate UTM links for ALL campaigns across ALL segments
   */
  static async generateForAllSegments() {
    const { rows: segments } = await db.query(`
      SELECT DISTINCT segment_label FROM campaigns
      WHERE segment_label IS NOT NULL
      ORDER BY segment_label
    `);

    const results = [];
    for (const seg of segments) {
      const links = await this.generateForSegment(seg.segment_label);
      results.push({ segment: seg.segment_label, links_generated: links.length });
    }

    return results;
  }

  /**
   * Get all segments with campaign + UTM stats (for dropdown/table)
   */
  static async getSegmentsList() {
    const { rows } = await db.query(`
      SELECT sd.segment_name,
        (SELECT COUNT(*) FROM campaigns c WHERE c.segment_label = sd.segment_name) AS campaign_count,
        (SELECT COUNT(*) FROM content_templates ct WHERE ct.segment_label = sd.segment_name AND ct.status = 'approved') AS template_count,
        COUNT(DISTINCT ut.utm_id) AS utm_count,
        COALESCE(SUM(ut.clicks), 0) AS total_clicks,
        COALESCE(SUM(ut.conversions), 0) AS total_conversions,
        COALESCE(SUM(ut.revenue), 0) AS total_revenue,
        (SELECT COUNT(*) FROM segment_customers sc WHERE sc.segment_id = sd.segment_id AND sc.is_active = true) AS customer_count
      FROM segment_definitions sd
      LEFT JOIN utm_tracking ut ON ut.segment_label = sd.segment_name
      GROUP BY sd.segment_id, sd.segment_name, sd.segment_number
      ORDER BY sd.segment_number
    `);
    return rows;
  }

  /**
   * Get UTM tracking data with analytics
   */
  static async getAnalytics({ segmentLabel, channel, dateFrom, dateTo } = {}) {
    let where = '1=1';
    const params = [];

    if (segmentLabel) { params.push(segmentLabel); where += ` AND ut.segment_label = $${params.length}`; }
    if (channel) { params.push(channel); where += ` AND ut.channel::text = $${params.length}`; }
    if (dateFrom) { params.push(dateFrom); where += ` AND ut.created_at >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); where += ` AND ut.created_at <= $${params.length}`; }

    const { rows } = await db.query(`
      SELECT ut.*,
        ct.name AS template_name,
        c.name AS campaign_name,
        c.status AS campaign_status,
        c.target_count
      FROM utm_tracking ut
      LEFT JOIN content_templates ct ON ct.id = ut.template_id
      LEFT JOIN campaigns c ON c.id = ut.campaign_id
      WHERE ${where}
      ORDER BY ut.created_at DESC
      LIMIT 200
    `, params);

    const { rows: summary } = await db.query(`
      SELECT ut.channel::TEXT, COUNT(*) AS total_links,
        SUM(ut.clicks) AS total_clicks, SUM(ut.conversions) AS total_conversions,
        SUM(ut.revenue) AS total_revenue
      FROM utm_tracking ut WHERE ${where}
      GROUP BY ut.channel
    `, params);

    const { rows: segmentSummary } = await db.query(`
      SELECT ut.segment_label, COUNT(*) AS total_links,
        SUM(ut.clicks) AS total_clicks, SUM(ut.conversions) AS total_conversions,
        COUNT(DISTINCT ut.campaign_id) AS campaigns_tracked
      FROM utm_tracking ut WHERE ${where}
      GROUP BY ut.segment_label
      ORDER BY total_links DESC
    `, params);

    return { links: rows, summary, segmentSummary };
  }

  /** Record a UTM click */
  static async recordClick(utmId) {
    await db.query('UPDATE utm_tracking SET clicks = clicks + 1 WHERE utm_id = $1', [utmId]);
  }

  /** Record a UTM conversion */
  static async recordConversion(utmId, revenue = 0) {
    await db.query(
      'UPDATE utm_tracking SET conversions = conversions + 1, revenue = revenue + $2 WHERE utm_id = $1',
      [utmId, revenue]
    );
  }
}

export default UTMService;
