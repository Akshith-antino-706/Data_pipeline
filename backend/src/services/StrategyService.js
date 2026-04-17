import { query } from '../config/database.js';

// Parse PG array string "{a,b,c}" → ["a","b","c"]
function parseChannels(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.replace(/[{}]/g, '').split(',').filter(Boolean);
  return [];
}
function fixRow(row) {
  if (!row) return row;
  row.channels = parseChannels(row.channels);
  return row;
}

export class StrategyService {

  /** Get all strategies with segment stats */
  static async getAll() {
    const { rows } = await query(`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM unified_contacts uc WHERE uc.booking_status = s.segment_label) AS segment_size,
        (SELECT COUNT(*) FROM campaigns c WHERE c.strategy_id = s.id) AS campaign_count,
        (SELECT COUNT(*) FROM campaigns c WHERE c.strategy_id = s.id AND c.status = 'running') AS active_campaigns
      FROM omnichannel_strategies s
      ORDER BY s.updated_at DESC
    `);
    return rows.map(fixRow);
  }

  /** Get strategy by ID with full details */
  static async getById(id) {
    const { rows } = await query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM unified_contacts uc WHERE uc.booking_status = s.segment_label) AS segment_size
      FROM omnichannel_strategies s
      WHERE s.id = $1
    `, [id]);
    if (!rows[0]) return null;

    // Get associated campaigns
    const campaigns = await query(`
      SELECT id, name, channel, status, sent_count, delivered_count, read_count, clicked_count,
             scheduled_at, completed_at
      FROM campaigns WHERE strategy_id = $1
      ORDER BY created_at DESC
    `, [id]);

    return { ...fixRow(rows[0]), campaigns: campaigns.rows };
  }

  /** Create a new strategy */
  static async create({ name, description, segmentLabel, channels, flowSteps, createdBy }) {
    const { rows } = await query(`
      INSERT INTO omnichannel_strategies (name, description, segment_label, channels, flow_steps, created_by)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      RETURNING *
    `, [name, description, segmentLabel, channels, JSON.stringify(flowSteps || []), createdBy]);
    return rows[0];
  }

  /** Update strategy */
  static async update(id, { name, description, channels, flowSteps, status }) {
    const sets = [];
    const params = [];
    let i = 1;

    if (name !== undefined) { sets.push(`name = $${i++}`); params.push(name); }
    if (description !== undefined) { sets.push(`description = $${i++}`); params.push(description); }
    if (channels !== undefined) { sets.push(`channels = $${i++}`); params.push(channels); }
    if (flowSteps !== undefined) { sets.push(`flow_steps = $${i++}::jsonb`); params.push(JSON.stringify(flowSteps)); }
    if (status !== undefined) { sets.push(`status = $${i++}`); params.push(status); }

    if (sets.length === 0) return null;

    params.push(id);
    const { rows } = await query(
      `UPDATE omnichannel_strategies SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    return rows[0];
  }

  /** Get strategies for a specific segment */
  static async getBySegment(segmentLabel) {
    const { rows } = await query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM campaigns c WHERE c.strategy_id = s.id AND c.status IN ('running', 'completed')) AS total_campaigns,
        (SELECT COALESCE(SUM(c.sent_count), 0) FROM campaigns c WHERE c.strategy_id = s.id) AS total_sent,
        (SELECT COALESCE(SUM(c.delivered_count), 0) FROM campaigns c WHERE c.strategy_id = s.id) AS total_delivered
      FROM omnichannel_strategies s
      WHERE s.segment_label = $1 AND s.status != 'archived'
      ORDER BY s.created_at DESC
    `, [segmentLabel]);
    return rows.map(fixRow);
  }
}
