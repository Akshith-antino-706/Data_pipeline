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
