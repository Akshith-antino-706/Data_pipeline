import db from '../config/database.js';

/**
 * ConversionFunnel — 7-stage funnel tracking with conversion metrics
 * Tracks: Segment → Messaged → Delivered → Opened → Clicked → Converted/Purchased
 */
class ConversionFunnel {

  /**
   * Get full funnel overview with per-stage metrics
   */
  static async getFunnelOverview() {
    const { rows: stages } = await db.query(`
      SELECT
        fs.stage_number, fs.stage_name, fs.stage_color, fs.stage_description,
        COUNT(DISTINCT sd.segment_id) AS segment_count,
        COUNT(DISTINCT sc.customer_id) AS customer_count,
        COALESCE(SUM(conv.conversions), 0) AS total_conversions,
        COALESCE(SUM(conv.revenue), 0)::NUMERIC(12,2) AS total_revenue,
        COALESCE(camp.total_sent, 0) AS messages_sent,
        COALESCE(camp.total_delivered, 0) AS messages_delivered,
        COALESCE(camp.total_read, 0) AS messages_read,
        COALESCE(camp.total_clicked, 0) AS messages_clicked
      FROM funnel_stages fs
      LEFT JOIN segment_definitions sd ON sd.stage_id = fs.stage_id
      LEFT JOIN segment_customers sc ON sc.segment_id = sd.segment_id AND sc.is_active = true
      LEFT JOIN (
        SELECT ct.segment_id, COUNT(*) AS conversions, SUM(ct.conversion_value) AS revenue
        FROM conversion_tracking ct GROUP BY ct.segment_id
      ) conv ON conv.segment_id = sd.segment_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(c.sent_count) AS total_sent,
          SUM(c.delivered_count) AS total_delivered,
          SUM(c.read_count) AS total_read,
          SUM(c.clicked_count) AS total_clicked
        FROM campaigns c WHERE c.segment_label = sd.segment_name
      ) camp ON true
      GROUP BY fs.stage_id, camp.total_sent, camp.total_delivered, camp.total_read, camp.total_clicked
      ORDER BY fs.stage_number
    `);

    // Calculate funnel rates
    return stages.map(s => ({
      ...s,
      delivery_rate: s.messages_sent > 0 ? ((s.messages_delivered / s.messages_sent) * 100).toFixed(1) : '0.0',
      open_rate: s.messages_delivered > 0 ? ((s.messages_read / s.messages_delivered) * 100).toFixed(1) : '0.0',
      click_rate: s.messages_delivered > 0 ? ((s.messages_clicked / s.messages_delivered) * 100).toFixed(1) : '0.0',
      conversion_rate: s.customer_count > 0 ? ((s.total_conversions / s.customer_count) * 100).toFixed(1) : '0.0'
    }));
  }

  /**
   * Get detailed funnel for a specific segment
   */
  static async getSegmentFunnel(segmentId) {
    const { rows: [segment] } = await db.query(`
      SELECT sd.*, fs.stage_name, fs.stage_color
      FROM segment_definitions sd
      JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      WHERE sd.segment_id = $1
    `, [segmentId]);

    if (!segment) return null;

    // Get funnel metrics
    const { rows: [metrics] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM segment_customers WHERE segment_id = $1 AND is_active = true) AS total_in_segment,
        (SELECT SUM(sent_count) FROM campaigns WHERE segment_label = $2) AS messages_sent,
        (SELECT SUM(delivered_count) FROM campaigns WHERE segment_label = $2) AS messages_delivered,
        (SELECT SUM(read_count) FROM campaigns WHERE segment_label = $2) AS messages_opened,
        (SELECT SUM(clicked_count) FROM campaigns WHERE segment_label = $2) AS messages_clicked,
        (SELECT COUNT(*) FROM conversion_tracking WHERE segment_id = $1) AS conversions,
        (SELECT SUM(conversion_value) FROM conversion_tracking WHERE segment_id = $1) AS revenue
    `, [segmentId, segment.segment_name]);

    // Get conversion breakdown by type
    const { rows: conversionTypes } = await db.query(`
      SELECT conversion_type, COUNT(*) AS count, SUM(conversion_value)::NUMERIC(12,2) AS value
      FROM conversion_tracking WHERE segment_id = $1
      GROUP BY conversion_type
    `, [segmentId]);

    // Get conversion by channel
    const { rows: channelConversions } = await db.query(`
      SELECT source_channel, COUNT(*) AS count, SUM(conversion_value)::NUMERIC(12,2) AS value
      FROM conversion_tracking WHERE segment_id = $1
      GROUP BY source_channel
    `, [segmentId]);

    // Get time-series conversions (last 30 days)
    const { rows: timeSeries } = await db.query(`
      SELECT DATE_TRUNC('day', converted_at)::DATE AS day, COUNT(*) AS conversions, SUM(conversion_value)::NUMERIC(12,2) AS revenue
      FROM conversion_tracking
      WHERE segment_id = $1 AND converted_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', converted_at)
      ORDER BY day
    `, [segmentId]);

    const funnel = [
      { stage: 'In Segment', count: parseInt(metrics.total_in_segment || 0), color: '#6c5ce7' },
      { stage: 'Messaged', count: parseInt(metrics.messages_sent || 0), color: '#74b9ff' },
      { stage: 'Delivered', count: parseInt(metrics.messages_delivered || 0), color: '#00b894' },
      { stage: 'Opened', count: parseInt(metrics.messages_opened || 0), color: '#fdcb6e' },
      { stage: 'Clicked', count: parseInt(metrics.messages_clicked || 0), color: '#e17055' },
      { stage: 'Converted', count: parseInt(metrics.conversions || 0), color: '#00b894' },
    ];

    return { segment, funnel, metrics, conversionTypes, channelConversions, timeSeries };
  }

  /**
   * Record a conversion event
   */
  static async recordConversion({ customerId, segmentId, campaignId, journeyId, conversionType, conversionValue, sourceChannel, utmSource, utmMedium, utmCampaign }) {
    const { rows: [conversion] } = await db.query(`
      INSERT INTO conversion_tracking
        (customer_id, segment_id, campaign_id, journey_id, conversion_type, conversion_value, source_channel, utm_source, utm_medium, utm_campaign)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [customerId, segmentId, campaignId, journeyId, conversionType, conversionValue, sourceChannel, utmSource, utmMedium, utmCampaign]);

    return conversion;
  }

  /**
   * Get channel effectiveness across all segments
   */
  static async getChannelEffectiveness() {
    const { rows } = await db.query(`
      SELECT
        c.channel,
        COUNT(DISTINCT c.id) AS campaigns,
        SUM(c.sent_count) AS total_sent,
        SUM(c.delivered_count) AS total_delivered,
        SUM(c.read_count) AS total_read,
        SUM(c.clicked_count) AS total_clicked,
        SUM(c.bounced_count) AS total_bounced,
        COALESCE(conv.conversions, 0) AS conversions,
        COALESCE(conv.revenue, 0)::NUMERIC(12,2) AS revenue,
        CASE WHEN SUM(c.sent_count) > 0
          THEN (SUM(c.delivered_count)::NUMERIC / SUM(c.sent_count) * 100)::NUMERIC(5,1)
          ELSE 0 END AS delivery_rate,
        CASE WHEN SUM(c.delivered_count) > 0
          THEN (SUM(c.read_count)::NUMERIC / SUM(c.delivered_count) * 100)::NUMERIC(5,1)
          ELSE 0 END AS open_rate,
        CASE WHEN SUM(c.delivered_count) > 0
          THEN (SUM(c.clicked_count)::NUMERIC / SUM(c.delivered_count) * 100)::NUMERIC(5,1)
          ELSE 0 END AS click_rate
      FROM campaigns c
      LEFT JOIN (
        SELECT source_channel, COUNT(*) AS conversions, SUM(conversion_value) AS revenue
        FROM conversion_tracking GROUP BY source_channel
      ) conv ON conv.source_channel = c.channel::TEXT
      WHERE c.status IN ('completed', 'running')
      GROUP BY c.channel, conv.conversions, conv.revenue
      ORDER BY total_sent DESC
    `);
    return rows;
  }

  /**
   * Get key success metrics as defined in the strategy document
   */
  static async getKeyMetrics() {
    const { rows: [metrics] } = await db.query(`
      SELECT
        -- Conversion rate by segment (avg)
        (SELECT AVG(CASE WHEN sc_cnt > 0 THEN conv_cnt::NUMERIC / sc_cnt * 100 END)::NUMERIC(5,1)
         FROM (SELECT sd.segment_id,
           (SELECT COUNT(*) FROM segment_customers WHERE segment_id = sd.segment_id AND is_active = true) AS sc_cnt,
           (SELECT COUNT(*) FROM conversion_tracking WHERE segment_id = sd.segment_id) AS conv_cnt
         FROM segment_definitions sd) x) AS avg_conversion_rate,

        -- Revenue
        (SELECT COALESCE(SUM(conversion_value), 0)::NUMERIC(12,2) FROM conversion_tracking) AS total_revenue,

        -- Time to conversion (avg days)
        (SELECT AVG(EXTRACT(EPOCH FROM (ct.converted_at - sc.assigned_at)) / 86400)::NUMERIC(10,1)
         FROM conversion_tracking ct
         JOIN segment_customers sc ON sc.customer_id = ct.customer_id AND sc.segment_id = ct.segment_id
        ) AS avg_days_to_convert,

        -- Reactivation rate (dormant segments)
        (SELECT COUNT(*)::NUMERIC FROM conversion_tracking ct
         JOIN segment_definitions sd ON sd.segment_id = ct.segment_id
         WHERE sd.segment_name ILIKE '%Dormant%' OR sd.segment_name ILIKE '%One-Time%'
        ) AS reactivations,

        -- Referral rate
        (SELECT COUNT(*)::NUMERIC FROM conversion_tracking WHERE utm_source = 'referral') AS referral_conversions,

        -- Total messages sent
        (SELECT COALESCE(SUM(sent_count), 0) FROM campaigns) AS total_messages_sent,

        -- Active journeys
        (SELECT COUNT(*) FROM journey_flows WHERE status = 'active') AS active_journeys
    `);
    return metrics;
  }
}

export default ConversionFunnel;
