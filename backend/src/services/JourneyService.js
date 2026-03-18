import db from '../config/database.js';

/**
 * JourneyService — Journey Flow Builder & Execution Engine
 * Manages visual flows with triggers, actions, conditions, and wait steps
 *
 * Node types:
 *   - trigger:   Entry point (segment_entry, event, schedule)
 *   - action:    Send message (whatsapp, email, sms, push, rcs, web)
 *   - condition: Branch logic (opened_email, clicked_link, booked, time_elapsed)
 *   - wait:      Delay (hours, days)
 *   - goal:      Conversion check (booking, enquiry, registration)
 *
 * Edge format:
 *   { id, source, target, label?, condition? }
 */
class JourneyService {

  // ── CRUD ──────────────────────────────────────────────────

  static async getAll({ status, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (status) {
      params.push(status);
      where += ` AND jf.status = $${params.length}`;
    }

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM journey_flows jf WHERE ${where}`, params
    );

    const { rows } = await db.query(`
      SELECT jf.*,
        sd.segment_name, sd.segment_number, sd.priority,
        fs.stage_name, fs.stage_color,
        COALESCE(jsonb_array_length(jf.nodes), 0) AS node_count
      FROM journey_flows jf
      LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
      LEFT JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      WHERE ${where}
      ORDER BY jf.updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    return { data: rows, total: parseInt(count), page, limit };
  }

  static async getById(journeyId) {
    const { rows: [journey] } = await db.query(`
      SELECT jf.*,
        sd.segment_name, sd.segment_number, sd.priority, sd.customer_type,
        fs.stage_name, fs.stage_color
      FROM journey_flows jf
      LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
      LEFT JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      WHERE jf.journey_id = $1
    `, [journeyId]);

    if (!journey) return null;

    // Get entry stats
    const { rows: [entryStats] } = await db.query(`
      SELECT
        COUNT(*) AS total_entries,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'converted') AS converted,
        COUNT(*) FILTER (WHERE status = 'exited') AS exited
      FROM journey_entries WHERE journey_id = $1
    `, [journeyId]);

    // Get per-node analytics
    const { rows: nodeAnalytics } = await db.query(`
      SELECT node_id, event_type, channel, COUNT(*) AS event_count
      FROM journey_events je
      JOIN journey_entries jen ON jen.entry_id = je.entry_id
      WHERE jen.journey_id = $1
      GROUP BY node_id, event_type, channel
      ORDER BY node_id
    `, [journeyId]);

    return { ...journey, entryStats, nodeAnalytics };
  }

  static async create({ name, description, segmentId, strategyId, nodes, edges, goalType, goalValue, createdBy }) {
    const { rows: [journey] } = await db.query(`
      INSERT INTO journey_flows (name, description, segment_id, strategy_id, nodes, edges, goal_type, goal_value, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [name, description, segmentId, strategyId, JSON.stringify(nodes || []), JSON.stringify(edges || []), goalType, goalValue, createdBy]);
    return journey;
  }

  static async update(journeyId, fields) {
    const sets = [];
    const params = [journeyId];
    const allowed = { name: 'name', description: 'description', segment_id: 'segment_id', nodes: 'nodes', edges: 'edges', status: 'status', goal_type: 'goal_type', goal_value: 'goal_value' };

    for (const [key, col] of Object.entries(allowed)) {
      if (fields[key] !== undefined) {
        params.push(key === 'nodes' || key === 'edges' ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }

    if (sets.length === 0) return this.getById(journeyId);

    const { rows: [journey] } = await db.query(
      `UPDATE journey_flows SET ${sets.join(', ')} WHERE journey_id = $1 RETURNING *`, params
    );
    return journey;
  }

  static async delete(journeyId) {
    await db.query('DELETE FROM journey_flows WHERE journey_id = $1', [journeyId]);
    return { deleted: true };
  }

  // ── Auto-generate journey from strategy flow_steps ──────────

  static async generateFromStrategy(strategyId) {
    const { rows: [strategy] } = await db.query(
      'SELECT * FROM omnichannel_strategies WHERE id = $1', [strategyId]
    );
    if (!strategy) throw new Error('Strategy not found');

    const flowSteps = strategy.flow_steps || [];
    const nodes = [];
    const edges = [];
    let nodeId = 0;

    // Entry trigger node
    const entryNode = {
      id: `node_${nodeId++}`,
      type: 'trigger',
      data: { triggerType: 'segment_entry', segmentLabel: strategy.segment_label },
      position: { x: 300, y: 50 }
    };
    nodes.push(entryNode);
    let prevNodeId = entryNode.id;

    for (const step of flowSteps) {
      const actions = step.actions || [];

      // Add wait node if day > 0
      if (step.day > 0) {
        const waitNode = {
          id: `node_${nodeId++}`,
          type: 'wait',
          data: { waitDays: step.day, label: step.label },
          position: { x: 300, y: nodeId * 120 }
        };
        nodes.push(waitNode);
        edges.push({ id: `edge_${edges.length}`, source: prevNodeId, target: waitNode.id });
        prevNodeId = waitNode.id;
      }

      // Add action nodes for each channel action
      for (const action of actions) {
        const actionNode = {
          id: `node_${nodeId++}`,
          type: 'action',
          data: {
            channel: action.channel,
            message: action.message,
            timing: action.timing,
            label: step.label
          },
          position: { x: 300 + (actions.indexOf(action) * 200), y: nodeId * 120 }
        };
        nodes.push(actionNode);
        edges.push({ id: `edge_${edges.length}`, source: prevNodeId, target: actionNode.id });
      }

      if (actions.length > 0) {
        prevNodeId = nodes[nodes.length - 1].id;
      }
    }

    // Goal node at end
    const goalNode = {
      id: `node_${nodeId++}`,
      type: 'goal',
      data: { goalType: 'booking', label: 'Customer Books' },
      position: { x: 300, y: nodeId * 120 }
    };
    nodes.push(goalNode);
    edges.push({ id: `edge_${edges.length}`, source: prevNodeId, target: goalNode.id });

    // Find segment_id for this strategy
    const { rows: [seg] } = await db.query(
      'SELECT segment_id FROM segment_definitions WHERE segment_name = $1 LIMIT 1',
      [strategy.segment_label]
    );

    const journey = await this.create({
      name: `Journey: ${strategy.name}`,
      description: `Auto-generated from strategy: ${strategy.description}`,
      segmentId: seg?.segment_id,
      strategyId: strategy.id,
      nodes,
      edges,
      goalType: 'booking',
      goalValue: null,
      createdBy: 'system'
    });

    return journey;
  }

  // ── Journey Execution ───────────────────────────────────────

  /**
   * Enroll customers from a segment into a journey
   */
  static async enrollSegment(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey || !journey.segment_id) throw new Error('Journey has no segment');

    // Get all active customers in this segment not already enrolled
    const { rows } = await db.query(`
      INSERT INTO journey_entries (journey_id, customer_id, current_node_id)
      SELECT $1, sc.customer_id, $2
      FROM segment_customers sc
      WHERE sc.segment_id = $3 AND sc.is_active = true
        AND NOT EXISTS (SELECT 1 FROM journey_entries je WHERE je.journey_id = $1 AND je.customer_id = sc.customer_id)
      RETURNING entry_id
    `, [journeyId, journey.nodes?.[0]?.id || 'node_0', journey.segment_id]);

    // Update journey metrics
    await db.query(
      'UPDATE journey_flows SET total_entries = total_entries + $1 WHERE journey_id = $2',
      [rows.length, journeyId]
    );

    return { enrolled: rows.length };
  }

  /**
   * Process active journey entries: advance through nodes
   */
  static async processJourney(journeyId, batchSize = 100) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const nodes = journey.nodes || [];
    const edges = journey.edges || [];
    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    // Get active entries
    const { rows: entries } = await db.query(`
      SELECT je.*, c.first_name, c.last_name, c.email, c.phone_number, c.whatsapp_number
      FROM journey_entries je
      JOIN customers c ON c.customer_id = je.customer_id
      WHERE je.journey_id = $1 AND je.status = 'active'
      LIMIT $2
    `, [journeyId, batchSize]);

    let processed = 0;
    let actioned = 0;

    for (const entry of entries) {
      const currentNode = nodeMap[entry.current_node_id];
      if (!currentNode) continue;

      // Process based on node type
      if (currentNode.type === 'action') {
        // Log the action event
        await db.query(`
          INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
          VALUES ($1, $2, 'action_sent', $3, $4)
        `, [entry.entry_id, currentNode.id, currentNode.data?.channel, JSON.stringify(currentNode.data)]);
        actioned++;
      } else if (currentNode.type === 'goal') {
        // Mark as converted
        await db.query(`
          UPDATE journey_entries SET status = 'converted', converted_at = NOW()
          WHERE entry_id = $1
        `, [entry.entry_id]);

        await db.query(
          'UPDATE journey_flows SET total_conversions = total_conversions + 1 WHERE journey_id = $1',
          [journeyId]
        );
        processed++;
        continue;
      }

      // Find next node via edges
      const outEdges = edges.filter(e => e.source === currentNode.id);
      if (outEdges.length > 0) {
        const nextNodeId = outEdges[0].target;
        await db.query(
          'UPDATE journey_entries SET current_node_id = $1 WHERE entry_id = $2',
          [nextNodeId, entry.entry_id]
        );
      } else {
        // No more edges — journey complete
        await db.query(
          'UPDATE journey_entries SET status = $1, completed_at = NOW() WHERE entry_id = $2',
          ['completed', entry.entry_id]
        );
      }
      processed++;
    }

    // Update conversion rate
    await db.query(`
      UPDATE journey_flows SET
        conversion_rate = CASE WHEN total_entries > 0
          THEN (total_conversions::NUMERIC / total_entries * 100)
          ELSE 0 END
      WHERE journey_id = $1
    `, [journeyId]);

    return { processed, actioned };
  }

  /**
   * Get journey analytics summary
   */
  static async getJourneyAnalytics(journeyId) {
    const { rows: nodeStats } = await db.query(`
      SELECT
        je.node_id,
        je.event_type,
        je.channel,
        COUNT(*) AS count,
        MIN(je.created_at) AS first_event,
        MAX(je.created_at) AS last_event
      FROM journey_events je
      JOIN journey_entries jen ON jen.entry_id = je.entry_id
      WHERE jen.journey_id = $1
      GROUP BY je.node_id, je.event_type, je.channel
      ORDER BY je.node_id
    `, [journeyId]);

    const { rows: funnelData } = await db.query(`
      SELECT
        current_node_id,
        status,
        COUNT(*) AS count
      FROM journey_entries
      WHERE journey_id = $1
      GROUP BY current_node_id, status
    `, [journeyId]);

    return { nodeStats, funnelData };
  }
}

export default JourneyService;
