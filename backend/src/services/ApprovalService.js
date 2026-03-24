import db from '../config/database.js';

class ApprovalService {

  static async getQueue({ status = 'pending', entityType, limit = 50 } = {}) {
    let where = 'status = $1';
    const params = [status];
    if (entityType) { params.push(entityType); where += ` AND entity_type = $${params.length}`; }

    const { rows } = await db.query(`
      SELECT aq.*,
        CASE
          WHEN aq.entity_type = 'strategy' THEN (SELECT name FROM omnichannel_strategies WHERE id = aq.entity_id)
          WHEN aq.entity_type = 'campaign' THEN (SELECT name FROM campaigns WHERE id = aq.entity_id)
          WHEN aq.entity_type = 'content' THEN (SELECT name FROM content_templates WHERE id = aq.entity_id)
          WHEN aq.entity_type = 'coupon' THEN (SELECT code FROM coupons WHERE coupon_id = aq.entity_id)
        END AS entity_name
      FROM approval_queue aq
      WHERE ${where}
      ORDER BY
        CASE aq.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        aq.requested_at ASC
      LIMIT $${params.length + 1}
    `, [...params, limit]);

    return rows;
  }

  static async getById(approvalId) {
    const { rows: [item] } = await db.query('SELECT * FROM approval_queue WHERE approval_id = $1', [approvalId]);
    return item;
  }

  static async requestApproval({ entityType, entityId, action, payload, changesSummary, aiConfidence, aiReasoning, segmentLabel, priority }) {
    const { rows: [item] } = await db.query(`
      INSERT INTO approval_queue (entity_type, entity_id, action, request_payload, changes_summary, ai_confidence, ai_reasoning, segment_label, priority)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [entityType, entityId, action, JSON.stringify(payload || {}), changesSummary, aiConfidence, aiReasoning, segmentLabel, priority || 'normal']);
    return item;
  }

  static async approve(approvalId, reviewedBy = 'admin') {
    const { rows: [item] } = await db.query(`
      UPDATE approval_queue SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
      WHERE approval_id = $1 AND status = 'pending'
      RETURNING *
    `, [approvalId, reviewedBy]);

    if (!item) throw new Error('Approval not found or already processed');

    // Apply the approved change
    await this._applyApproval(item);
    return item;
  }

  static async reject(approvalId, reviewedBy = 'admin') {
    const { rows: [item] } = await db.query(`
      UPDATE approval_queue SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW()
      WHERE approval_id = $1 AND status = 'pending'
      RETURNING *
    `, [approvalId, reviewedBy]);

    if (!item) throw new Error('Approval not found or already processed');
    return item;
  }

  static async _applyApproval(item) {
    const payload = item.request_payload;

    switch (item.entity_type) {
      case 'strategy':
        if (item.action === 'activate') {
          await db.query("UPDATE omnichannel_strategies SET status = 'active' WHERE id = $1", [item.entity_id]);
        } else if (item.action === 'optimize' && payload.flow_steps) {
          await db.query("UPDATE omnichannel_strategies SET flow_steps = $2, ai_last_review = NOW() WHERE id = $1", [item.entity_id, JSON.stringify(payload.flow_steps)]);
        }
        break;

      case 'campaign':
        if (item.action === 'send') {
          await db.query("UPDATE campaigns SET status = 'scheduled' WHERE id = $1", [item.entity_id]);
        } else if (item.action === 'activate') {
          await db.query("UPDATE campaigns SET status = 'active' WHERE id = $1", [item.entity_id]);
        }
        break;

      case 'content':
        if (item.action === 'activate') {
          await db.query("UPDATE content_templates SET status = 'active' WHERE id = $1", [item.entity_id]);
        } else if (item.action === 'update' && payload.body) {
          await db.query("UPDATE content_templates SET body = $2 WHERE id = $1", [item.entity_id, payload.body]);
        }
        break;

      case 'coupon':
        if (item.action === 'activate') {
          await db.query("UPDATE coupons SET is_active = true WHERE coupon_id = $1", [item.entity_id]);
        }
        break;
    }
  }

  // ── AI Strategy Analysis → Approval Queue ────────────────
  static async aiAnalyzeStrategies() {
    // Get all active strategies with campaign performance
    const { rows: strategies } = await db.query(`
      SELECT s.id, s.name, s.segment_label, s.channels, s.flow_steps,
        COALESCE(camp.total_sent, 0) AS total_sent,
        COALESCE(camp.total_delivered, 0) AS total_delivered,
        COALESCE(camp.total_read, 0) AS total_read,
        COALESCE(camp.total_clicked, 0) AS total_clicked,
        COALESCE(camp.total_bounced, 0) AS total_bounced,
        COALESCE(camp.campaign_count, 0) AS campaign_count,
        COALESCE(seg.customer_count, 0) AS customer_count,
        COALESCE(conv.conversion_count, 0) AS conversion_count
      FROM omnichannel_strategies s
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS campaign_count,
          COALESCE(SUM(sent_count), 0) AS total_sent,
          COALESCE(SUM(delivered_count), 0) AS total_delivered,
          COALESCE(SUM(read_count), 0) AS total_read,
          COALESCE(SUM(click_count), 0) AS total_clicked,
          COALESCE(SUM(bounce_count), 0) AS total_bounced
        FROM campaigns WHERE strategy_id = s.id
      ) camp ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS customer_count
        FROM segment_customers WHERE segment_id = (
          SELECT segment_id FROM segment_definitions WHERE segment_name = s.segment_label LIMIT 1
        ) AND is_active = true
      ) seg ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS conversion_count
        FROM journey_enrollments je
        JOIN journey_flows jf ON jf.journey_id = je.journey_id
        WHERE jf.strategy_id = s.id AND je.status = 'converted'
      ) conv ON true
      WHERE s.status = 'active'
    `);

    const suggestions = [];

    for (const s of strategies) {
      const sent = parseInt(s.total_sent) || 0;
      const delivered = parseInt(s.total_delivered) || 0;
      const read = parseInt(s.total_read) || 0;
      const clicked = parseInt(s.total_clicked) || 0;
      const bounced = parseInt(s.total_bounced) || 0;
      const customers = parseInt(s.customer_count) || 0;
      const conversions = parseInt(s.conversion_count) || 0;

      const deliveryRate = sent > 0 ? (delivered / sent * 100) : 0;
      const openRate = delivered > 0 ? (read / delivered * 100) : 0;
      const clickRate = delivered > 0 ? (clicked / delivered * 100) : 0;
      const bounceRate = sent > 0 ? (bounced / sent * 100) : 0;
      const conversionRate = customers > 0 ? (conversions / customers * 100) : 0;

      const analysis = { deliveryRate, openRate, clickRate, bounceRate, conversionRate, sent, customers };
      let suggestion = null;

      // Rule 1: No campaigns sent yet — recommend launching
      if (sent === 0 && customers > 0) {
        suggestion = {
          action: 'activate',
          priority: customers > 100 ? 'high' : 'normal',
          summary: `Strategy "${s.name}" has ${customers} customers but 0 messages sent. Recommend launching campaigns.`,
          reasoning: `Segment "${s.segment_label}" has ${customers} customers waiting. No campaigns have been executed. Starting the journey will begin engaging these customers.`,
          confidence: 0.85,
          predictedImprovement: 5.0
        };
      }
      // Rule 2: High bounce rate — suggest channel switch
      else if (bounceRate > 15 && sent > 50) {
        suggestion = {
          action: 'optimize',
          priority: 'high',
          summary: `High bounce rate (${bounceRate.toFixed(1)}%) for "${s.name}". Suggest switching primary channel.`,
          reasoning: `Bounce rate of ${bounceRate.toFixed(1)}% indicates delivery issues. Consider switching from email to WhatsApp for better reachability, or cleaning the email list.`,
          confidence: 0.78,
          predictedImprovement: bounceRate * 0.4
        };
      }
      // Rule 3: Low open rate — suggest subject line / timing change
      else if (openRate < 15 && sent > 50) {
        suggestion = {
          action: 'optimize',
          priority: 'normal',
          summary: `Low open rate (${openRate.toFixed(1)}%) for "${s.name}". Suggest A/B testing subject lines.`,
          reasoning: `Open rate of ${openRate.toFixed(1)}% is below the 20% industry average. Try personalized subject lines with customer name and enquiry topic. Also consider sending at different times.`,
          confidence: 0.72,
          predictedImprovement: 8.0
        };
      }
      // Rule 4: Good opens but low clicks — suggest CTA improvement
      else if (openRate > 20 && clickRate < 3 && sent > 50) {
        suggestion = {
          action: 'optimize',
          priority: 'normal',
          summary: `Good opens (${openRate.toFixed(1)}%) but low clicks (${clickRate.toFixed(1)}%) for "${s.name}". CTA needs improvement.`,
          reasoning: `Emails are being opened but not clicked. Recommend stronger CTAs, adding urgency ("Limited spots"), or including product images matching enquiry context.`,
          confidence: 0.75,
          predictedImprovement: 5.0
        };
      }
      // Rule 5: Zero conversions with decent engagement — suggest offer/discount
      else if (sent > 100 && conversions === 0 && clicked > 0) {
        suggestion = {
          action: 'optimize',
          priority: 'high',
          summary: `${clicked} clicks but 0 conversions for "${s.name}". Suggest adding incentive/discount.`,
          reasoning: `Customers are engaging (${clicked} clicks) but not converting. Add a time-limited discount coupon or free add-on to push them over the edge.`,
          confidence: 0.80,
          predictedImprovement: 3.0
        };
      }

      if (suggestion) {
        // Check if similar pending approval already exists
        const { rows: existing } = await db.query(
          `SELECT 1 FROM approval_queue WHERE entity_type = 'strategy' AND entity_id = $1 AND status = 'pending' LIMIT 1`,
          [s.id]
        );

        if (existing.length === 0) {
          await this.requestApproval({
            entityType: 'strategy',
            entityId: s.id,
            action: suggestion.action,
            payload: { analysis, flow_steps: s.flow_steps },
            changesSummary: suggestion.summary,
            aiConfidence: suggestion.confidence,
            aiReasoning: suggestion.reasoning,
            segmentLabel: s.segment_label,
            priority: suggestion.priority
          });

          // Also update the new approval columns
          await db.query(`
            UPDATE approval_queue SET
              ai_analysis = $2,
              conversion_rate_before = $3,
              predicted_improvement = $4
            WHERE entity_type = 'strategy' AND entity_id = $1 AND status = 'pending'
          `, [s.id, JSON.stringify(analysis), conversionRate, suggestion.predictedImprovement]);

          suggestions.push({ strategy: s.name, segment: s.segment_label, ...suggestion });
        }
      }
    }

    return { analyzed: strategies.length, suggestions_created: suggestions.length, suggestions };
  }

  static async getStats() {
    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
        (AVG(EXTRACT(EPOCH FROM (reviewed_at - requested_at)) / 3600) FILTER (WHERE reviewed_at IS NOT NULL))::NUMERIC(8,1) AS avg_review_hours
      FROM approval_queue
    `);
    return stats;
  }
}

export default ApprovalService;
