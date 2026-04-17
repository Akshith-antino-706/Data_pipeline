import db from '../config/database.js';
import EmailRenderer from './EmailRenderer.js';
import { EmailChannel } from './channels/EmailChannel.js';

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
   * - Skips non-active entries (converted, exited, completed)
   * - Evaluates condition nodes using real data (UTM clicks, bookings)
   * - Respects wait node delays
   * - Logs action events with templateId for actual sending
   */
  static async processJourney(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const nodes = journey.nodes || [];
    const edges = journey.edges || [];
    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    // Get all active entries joined with unified_contacts
    const { rows: entries } = await db.query(`
      SELECT je.*, uc.name, uc.email, uc.phone, uc.phone_key, uc.booking_status,
        uc.total_tour_bookings, uc.total_hotel_bookings, uc.total_visa_bookings, uc.total_flight_bookings
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.unified_id = je.customer_id
      WHERE je.journey_id = $1 AND je.status = 'active'
    `, [journeyId]);

    let processed = 0;
    let actioned = 0;
    let waited = 0;
    let conditioned = 0;

    for (const entry of entries) {
      const currentNode = nodeMap[entry.current_node_id];
      if (!currentNode) continue;

      // ── WAIT node: check if enough time has elapsed ──
      if (currentNode.type === 'wait') {
        const waitDays = currentNode.data?.waitDays || 1;
        const lastEventRes = await db.query(`
          SELECT MAX(created_at) as last_event FROM journey_events WHERE entry_id = $1
        `, [entry.entry_id]);
        const lastEvent = lastEventRes.rows[0]?.last_event || entry.entered_at;
        const elapsed = (Date.now() - new Date(lastEvent).getTime()) / (1000 * 60 * 60 * 24);

        if (elapsed < waitDays) {
          waited++;
          continue; // Not enough time has passed, skip
        }
        // Time elapsed — fall through to advance to next node
      }

      // ── ACTION node: send message + log event ──
      if (currentNode.type === 'action') {
        const channel = currentNode.data?.channel;
        const templateId = currentNode.data?.templateId;
        let sendResult = null;

        // Email channel — render template + send via SMTP
        if (channel === 'email' && templateId && entry.email) {
          try {
            const rendered = await EmailRenderer.render(parseInt(templateId), entry.customer_id);
            sendResult = await EmailChannel.send({
              to: entry.email,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.plainText,
            });
            console.log(`[Journey] Email sent → ${entry.email} | template=${templateId} | success=${sendResult.success}`);
          } catch (err) {
            console.error(`[Journey] Email failed → ${entry.email}: ${err.message}`);
            sendResult = { success: false, error: err.message };
          }
        }

        await db.query(`
          INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
          VALUES ($1, $2, 'action_sent', $3, $4)
        `, [entry.entry_id, currentNode.id, channel,
            JSON.stringify({ templateId, channel, sendResult: sendResult ? { success: sendResult.success, provider: sendResult.provider, simulated: sendResult.simulated } : null })]);
        actioned++;
      }

      // ── CONDITION node: evaluate and choose the right branch ──
      if (currentNode.type === 'condition') {
        const condition = currentNode.data?.condition;
        let result = false;

        if (condition === 'booked' || condition === 'booked_activity') {
          // Check if customer has any new booking since entering the journey
          const { rows: [bookCheck] } = await db.query(`
            SELECT EXISTS (
              SELECT 1 FROM rayna_tours WHERE unified_id = $1 AND bill_date > $2
              UNION ALL
              SELECT 1 FROM rayna_hotels WHERE unified_id = $1 AND bill_date > $2
              UNION ALL
              SELECT 1 FROM rayna_visas WHERE unified_id = $1 AND bill_date > $2
              UNION ALL
              SELECT 1 FROM rayna_flights WHERE unified_id = $1 AND bill_date > $2
            ) as has_booking
          `, [entry.customer_id, entry.entered_at]);
          result = bookCheck.has_booking;
        } else if (condition === 'clicked_link' || condition === 'clicked') {
          // Check if customer clicked any UTM link for this journey's campaigns
          const { rows: [clickCheck] } = await db.query(`
            SELECT EXISTS (
              SELECT 1 FROM user_utm_links uul
              JOIN utm_tracking ut ON ut.utm_id = uul.utm_id
              JOIN campaigns c ON c.id = ut.campaign_id
              WHERE uul.unified_id = $1 AND uul.click_count > 0
                AND c.journey_id = $2
            ) as has_clicked
          `, [entry.customer_id, journeyId]);
          result = clickCheck.has_clicked;
        } else if (condition === 'opened_email') {
          // Check journey_events for email open
          const { rows: [openCheck] } = await db.query(`
            SELECT EXISTS (
              SELECT 1 FROM journey_events
              WHERE entry_id = $1 AND event_type = 'email_opened'
            ) as has_opened
          `, [entry.entry_id]);
          result = openCheck.has_opened;
        }

        // Log condition evaluation
        await db.query(`
          INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
          VALUES ($1, $2, 'condition_evaluated', NULL, $3)
        `, [entry.entry_id, currentNode.id, JSON.stringify({ condition, result })]);

        // Choose edge based on result: Yes → result=true, No → result=false
        const outEdges = edges.filter(e => e.source === currentNode.id);
        const yesEdge = outEdges.find(e => e.label === 'Yes');
        const noEdge = outEdges.find(e => e.label === 'No');
        const nextNodeId = result ? (yesEdge?.target || outEdges[0]?.target) : (noEdge?.target || outEdges[0]?.target);

        if (nextNodeId) {
          await db.query('UPDATE journey_entries SET current_node_id = $1 WHERE entry_id = $2', [nextNodeId, entry.entry_id]);
        }
        conditioned++;
        processed++;
        continue;
      }

      // ── GOAL node: mark as completed (not converted — conversion is detected by ConversionDetector) ──
      if (currentNode.type === 'goal') {
        await db.query(`
          UPDATE journey_entries SET status = 'completed', completed_at = NOW()
          WHERE entry_id = $1
        `, [entry.entry_id]);
        processed++;
        continue;
      }

      // ── Advance to next node ──
      const outEdges = edges.filter(e => e.source === currentNode.id);
      if (outEdges.length > 0) {
        await db.query('UPDATE journey_entries SET current_node_id = $1 WHERE entry_id = $2', [outEdges[0].target, entry.entry_id]);
      } else {
        await db.query(
          "UPDATE journey_entries SET status = 'completed', completed_at = NOW() WHERE entry_id = $1",
          [entry.entry_id]
        );
      }
      processed++;
    }

    // Update journey stats
    await db.query(`
      UPDATE journey_flows SET
        total_conversions = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1 AND status = 'converted'),
        total_exits = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1 AND status = 'exited'),
        conversion_rate = CASE WHEN total_entries > 0
          THEN ((SELECT COUNT(*)::numeric FROM journey_entries WHERE journey_id = $1 AND status = 'converted') / total_entries * 100)
          ELSE 0 END
      WHERE journey_id = $1
    `, [journeyId]);

    return { processed, actioned, waited, conditioned };
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

  // ── Campaign Analytics per Journey ─────────────────────────

  static async getJourneyCampaignAnalytics(journeyId) {
    // Get all campaigns linked to this journey's segment
    const { rows: journey } = await db.query(
      `SELECT jf.*, sd.segment_name FROM journey_flows jf
       LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
       WHERE jf.journey_id = $1`, [journeyId]
    );
    if (!journey[0]) return null;

    const segmentLabel = journey[0].segment_name || journey[0].segment_label;

    // Get segment customer count for target
    const { rows: [segCount] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM segment_customers WHERE segment_id = $1 AND is_active = true`,
      [journey[0].segment_id]
    );
    const targetCount = parseInt(segCount?.cnt) || 0;

    // Get campaign metrics for this segment
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.name, c.channel::text, c.status, c.template_id,
        c.sent_count, c.delivered_count, c.read_count, c.click_count,
        c.bounce_count, c.fail_count, c.conversion_count, c.revenue_total,
        c.journey_node_id,
        ct.body AS template_body, ct.name AS template_name,
        CASE WHEN c.sent_count > 0 THEN ROUND(c.delivered_count::numeric / c.sent_count * 100, 1) ELSE 0 END AS delivery_rate,
        CASE WHEN c.delivered_count > 0 THEN ROUND(c.read_count::numeric / c.delivered_count * 100, 1) ELSE 0 END AS open_rate,
        CASE WHEN c.delivered_count > 0 THEN ROUND(c.click_count::numeric / c.delivered_count * 100, 1) ELSE 0 END AS click_rate
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.segment_label = $1
      ORDER BY c.created_at ASC
    `, [segmentLabel]);

    // Aggregate totals
    const totals = {
      total_sent: campaigns.reduce((s, c) => s + (parseInt(c.sent_count) || 0), 0),
      total_delivered: campaigns.reduce((s, c) => s + (parseInt(c.delivered_count) || 0), 0),
      total_read: campaigns.reduce((s, c) => s + (parseInt(c.read_count) || 0), 0),
      total_clicked: campaigns.reduce((s, c) => s + (parseInt(c.click_count) || 0), 0),
      total_bounced: campaigns.reduce((s, c) => s + (parseInt(c.bounce_count) || 0), 0),
      total_failed: campaigns.reduce((s, c) => s + (parseInt(c.fail_count) || 0), 0),
      total_conversions: campaigns.reduce((s, c) => s + (parseInt(c.conversion_count) || 0), 0),
      total_revenue: campaigns.reduce((s, c) => s + (parseFloat(c.revenue_total) || 0), 0),
    };

    return { journey: journey[0], campaigns, totals, target_count: targetCount };
  }

  // ── Conversion Detection (BigQuery + Offline Booking) ──────

  static async checkConversions(journeyId) {
    const { rows: journey } = await db.query(
      `SELECT * FROM journey_flows WHERE journey_id = $1`, [journeyId]
    );
    if (!journey[0]) return null;

    let converted = 0;

    // 1. Check BigQuery purchases: GA4 purchase events for enrolled customers
    const { rows: bqConverted } = await db.query(`
      UPDATE journey_enrollments je SET
        status = 'converted',
        conversion_event = 'ga4_purchase',
        conversion_at = g.purchase_ts,
        updated_at = NOW()
      FROM (
        SELECT gp.linked_customer_id, MAX(ge.event_ts) AS purchase_ts
        FROM ga4_events ge
        JOIN ga4_user_profiles gp ON gp.user_pseudo_id = ge.user_pseudo_id
        WHERE ge.event_name = 'purchase'
          AND gp.linked_customer_id IS NOT NULL
          AND ge.event_ts > (SELECT MIN(enrolled_at) FROM journey_enrollments WHERE journey_id = $1)
        GROUP BY gp.linked_customer_id
      ) g
      WHERE je.journey_id = $1
        AND je.customer_id = g.linked_customer_id
        AND je.status = 'active'
      RETURNING je.id
    `, [journeyId]);
    converted += bqConverted.length;

    // 2. Check offline bookings: travel_data for enrolled customers
    const { rows: offlineConverted } = await db.query(`
      UPDATE journey_enrollments je SET
        status = 'converted',
        conversion_event = 'offline_booking',
        conversion_at = td.booking_ts,
        updated_at = NOW()
      FROM (
        SELECT c.customer_id, MAX(td.booking_date) AS booking_ts
        FROM customers c
        JOIN mysql_travel_data td ON LOWER(td.email) = LOWER(c.email)
        WHERE td.booking_date > (SELECT MIN(enrolled_at) FROM journey_enrollments WHERE journey_id = $1)
        GROUP BY c.customer_id
      ) td
      WHERE je.journey_id = $1
        AND je.customer_id = td.customer_id
        AND je.status = 'active'
      RETURNING je.id
    `, [journeyId]);
    converted += offlineConverted.length;

    // Update journey stats
    await db.query(`
      UPDATE journey_flows SET
        total_conversions = (SELECT COUNT(*) FROM journey_enrollments WHERE journey_id = $1 AND status = 'converted'),
        conversion_rate = CASE
          WHEN (SELECT COUNT(*) FROM journey_enrollments WHERE journey_id = $1) > 0
          THEN ROUND((SELECT COUNT(*)::numeric FROM journey_enrollments WHERE journey_id = $1 AND status = 'converted') /
                     (SELECT COUNT(*)::numeric FROM journey_enrollments WHERE journey_id = $1) * 100, 2)
          ELSE 0
        END,
        updated_at = NOW()
      WHERE journey_id = $1
    `, [journeyId]);

    return {
      ga4_conversions: bqConverted.length,
      offline_conversions: offlineConverted.length,
      total_converted: converted
    };
  }

  // ── Get Enrollments ────────────────────────────────────────

  static async getEnrollments(journeyId) {
    const { rows } = await db.query(`
      SELECT je.entry_id, je.journey_id, je.customer_id, je.current_node_id, je.status,
        je.entered_at, je.completed_at, je.converted_at, je.exit_reason,
        uc.name, uc.email, uc.phone, uc.company_name, uc.country,
        uc.booking_status, uc.segment_label
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.unified_id = je.customer_id
      WHERE je.journey_id = $1
      ORDER BY je.entered_at DESC
      LIMIT 100
    `, [journeyId]);

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'converted')::int AS converted,
        COUNT(*) FILTER (WHERE status = 'exited')::int AS exited
      FROM journey_entries WHERE journey_id = $1
    `, [journeyId]);

    return { enrollments: rows, stats };
  }
}

export default JourneyService;
