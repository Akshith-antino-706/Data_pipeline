import db from '../config/database.js';

/**
 * UTM Tracking Service
 * Format: ?utm_source=AI_marketer&utm_medium=[channel]&utm_campaign=[name]_[segment]&utm_content=[channel]_[number]
 */
class UTMService {

  static BASE_URL = 'https://rayna.com';

  /**
   * Build a UTM URL
   */
  static buildUTM({ baseUrl, channel, campaignName, segmentLabel, contentNumber = 1 }) {
    const base = baseUrl || this.BASE_URL;
    const medium = channel || 'email';
    const campaign = `${(campaignName || 'campaign').replace(/\s+/g, '_')}_${(segmentLabel || 'all').replace(/\s+/g, '_')}`;
    const content = `${medium}_${contentNumber}`;

    const params = new URLSearchParams({
      utm_source: 'AI_marketer',
      utm_medium: medium,
      utm_campaign: campaign,
      utm_content: content
    });

    return `${base}?${params.toString()}`;
  }

  /**
   * Generate UTM links for all templates in a segment
   */
  static async generateForSegment(segmentLabel) {
    const { rows: templates } = await db.query(`
      SELECT ct.id, ct.name, ct.channel_type, ct.cta_url, ct.segment_label
      FROM content_templates ct
      WHERE ct.segment_label = $1 AND ct.status = 'active'
      ORDER BY ct.id
    `, [segmentLabel]);

    const utmLinks = [];
    const channelCounters = {};

    for (const tpl of templates) {
      const ch = tpl.channel_type;
      channelCounters[ch] = (channelCounters[ch] || 0) + 1;

      const fullUrl = this.buildUTM({
        baseUrl: tpl.cta_url || this.BASE_URL,
        channel: ch,
        campaignName: tpl.name.split(':')[0]?.trim() || tpl.name,
        segmentLabel: tpl.segment_label,
        contentNumber: channelCounters[ch]
      });

      // Store in DB
      await db.query(`
        INSERT INTO utm_tracking (template_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url, base_url)
        VALUES ($1, $2, $3, 'AI_marketer', $4, $5, $6, $7, $8)
        RETURNING utm_id
      `, [
        tpl.id,
        tpl.segment_label,
        ch,
        ch,
        `${tpl.name.split(':')[0]?.trim()}_${tpl.segment_label}`.replace(/\s+/g, '_'),
        `${ch}_${channelCounters[ch]}`,
        fullUrl,
        tpl.cta_url || this.BASE_URL
      ]);

      utmLinks.push({ template_id: tpl.id, template_name: tpl.name, channel: ch, utm_url: fullUrl });
    }

    return utmLinks;
  }

  /**
   * Generate UTM links for a campaign
   */
  static async generateForCampaign(campaignId) {
    const { rows: [campaign] } = await db.query(
      'SELECT * FROM campaigns WHERE id = $1', [campaignId]
    );
    if (!campaign) throw new Error('Campaign not found');

    const fullUrl = this.buildUTM({
      channel: campaign.channel,
      campaignName: campaign.name,
      segmentLabel: campaign.segment_label,
      contentNumber: 1
    });

    await db.query(`
      INSERT INTO utm_tracking (campaign_id, segment_label, channel, utm_source, utm_medium, utm_campaign, utm_content, full_url)
      VALUES ($1, $2, $3, 'AI_marketer', $4, $5, $6, $7)
    `, [campaignId, campaign.segment_label, campaign.channel, campaign.channel,
        `${campaign.name}_${campaign.segment_label}`.replace(/\s+/g, '_'),
        `${campaign.channel}_1`, fullUrl]);

    return { campaign_id: campaignId, utm_url: fullUrl };
  }

  /**
   * Get UTM tracking data with analytics
   */
  static async getAnalytics({ segmentLabel, channel, dateFrom, dateTo } = {}) {
    let where = '1=1';
    const params = [];

    if (segmentLabel) { params.push(segmentLabel); where += ` AND ut.segment_label = $${params.length}`; }
    if (channel) { params.push(channel); where += ` AND ut.channel = $${params.length}`; }
    if (dateFrom) { params.push(dateFrom); where += ` AND ut.created_at >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); where += ` AND ut.created_at <= $${params.length}`; }

    const { rows } = await db.query(`
      SELECT ut.*, ct.name AS template_name
      FROM utm_tracking ut
      LEFT JOIN content_templates ct ON ct.id = ut.template_id
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

    return { links: rows, summary };
  }

  /**
   * Record a UTM click
   */
  static async recordClick(utmId) {
    await db.query('UPDATE utm_tracking SET clicks = clicks + 1 WHERE utm_id = $1', [utmId]);
  }

  /**
   * Record a UTM conversion
   */
  static async recordConversion(utmId, revenue = 0) {
    await db.query(
      'UPDATE utm_tracking SET conversions = conversions + 1, revenue = revenue + $2 WHERE utm_id = $1',
      [utmId, revenue]
    );
  }
}

export default UTMService;
