import db from '../config/database.js';
import EmailRenderer from './EmailRenderer.js';
import { EmailChannel } from './channels/EmailChannel.js';
import { SMSChannel } from './channels/SMSChannel.js';
import { WhatsAppChannel } from './channels/WhatsAppChannel.js';
import GupshupService from './GupshupService.js';
import PopularityService from './PopularityService.js';
import { enqueueBatch } from './queue/index.js';

// Hardcoded test recipients — internal QA. Anything else seeded into the
// TEST_USERS segment also matches by email here. Used by:
//   - enrollAll({ mode: 'test_users' }) → restricts the enrollment query
//   - processJourney action-node firing → forces email-only for these users
//     so they never receive WhatsApp/SMS even if the action node specifies it.
const TEST_EMAILS = new Set([
  'akshith@antino.com',
  'akshith@raynatours.com',
  'anket@raynatours.com',
  'vaibhav@raynatours.com',
  'alok@raynatours.com',
  'manoj@raynatours.com',
]);
function isTestUser(email) {
  return !!email && TEST_EMAILS.has(String(email).toLowerCase().trim());
}

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

  static async getAll({ status, audience, page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];

    if (status) {
      params.push(status);
      where += ` AND jf.status = $${params.length}`;
    }
    if (audience) {
      params.push(audience);
      where += ` AND jf.audience = $${params.length}`;
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

  static async create({ name, description, segmentId, strategyId, nodes, edges, goalType, goalValue, createdBy, audience }) {
    const { rows: [journey] } = await db.query(`
      INSERT INTO journey_flows (name, description, segment_id, strategy_id, nodes, edges, goal_type, goal_value, created_by, audience)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [name, description, segmentId, strategyId, JSON.stringify(nodes || []), JSON.stringify(edges || []), goalType, goalValue, createdBy, audience || 'all']);
    return journey;
  }

  static async update(journeyId, fields) {
    const sets = [];
    const params = [journeyId];
    const allowed = { name: 'name', description: 'description', segment_id: 'segment_id', nodes: 'nodes', edges: 'edges', status: 'status', goal_type: 'goal_type', goal_value: 'goal_value', audience: 'audience' };

    for (const [key, col] of Object.entries(allowed)) {
      if (fields[key] !== undefined) {
        params.push(key === 'nodes' || key === 'edges' ? JSON.stringify(fields[key]) : fields[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }

    if (sets.length === 0) return this.getById(journeyId);

    const { rows: [journey] } = await db.query(
      `UPDATE journey_flows SET ${sets.join(', ')}, updated_at = NOW() WHERE journey_id = $1 RETURNING *`, params
    );
    return journey;
  }

  // ── Node-level CRUD helpers (used by the UI editor) ───────

  /** Add a node + edge from `afterNodeId` → newNode. If afterNodeId is null/undefined, append to end. */
  static async addNode(journeyId, node, afterNodeId = null) {
    const j = await this.getById(journeyId);
    if (!j) throw new Error('Journey not found');
    const nodes = Array.isArray(j.nodes) ? j.nodes : [];
    const edges = Array.isArray(j.edges) ? j.edges : [];

    if (!node.id) node.id = `node_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    nodes.push(node);

    // Wire an edge from afterNodeId to this node (or from last node if unspecified).
    const source = afterNodeId || (nodes.length > 1 ? nodes[nodes.length - 2].id : null);
    if (source) {
      edges.push({ id: `e_${source}_${node.id}`, source, target: node.id });
    }
    return this.update(journeyId, { nodes, edges });
  }

  /** Update a single node's fields (type, channel, templateId, waitDays, label, etc.). */
  static async updateNode(journeyId, nodeId, patch) {
    const j = await this.getById(journeyId);
    if (!j) throw new Error('Journey not found');
    const nodes = (j.nodes || []).map(n =>
      n.id === nodeId ? { ...n, ...patch, data: { ...(n.data || {}), ...(patch.data || {}) } } : n
    );
    return this.update(journeyId, { nodes });
  }

  /** Delete a node and stitch edges around it (previous node's edges re-point to this node's targets). */
  static async deleteNode(journeyId, nodeId) {
    const j = await this.getById(journeyId);
    if (!j) throw new Error('Journey not found');
    const nodes = (j.nodes || []).filter(n => n.id !== nodeId);
    const incoming = (j.edges || []).filter(e => e.target === nodeId).map(e => e.source);
    const outgoing = (j.edges || []).filter(e => e.source === nodeId).map(e => e.target);
    let edges = (j.edges || []).filter(e => e.source !== nodeId && e.target !== nodeId);
    // Stitch: every incoming source → every outgoing target
    for (const s of incoming) {
      for (const t of outgoing) {
        if (!edges.some(e => e.source === s && e.target === t)) {
          edges.push({ id: `e_${s}_${t}`, source: s, target: t });
        }
      }
    }
    return this.update(journeyId, { nodes, edges });
  }

  static async delete(journeyId) {
    await db.query('DELETE FROM journey_flows WHERE journey_id = $1', [journeyId]);
    return { deleted: true };
  }

  /**
   * Test-send a single action node to an arbitrary recipient. Does NOT touch
   * journey_entries or journey_events — this is purely for content QA.
   *   - email  → renders template via EmailRenderer (no unifiedId personalization)
   *              and sends via EmailChannel
   *   - sms    → sends template body via SMSChannel
   *   - whatsapp → sends template body as free-form text via WhatsAppChannel.sendText
   *                (session-window only; no approved template lookup here)
   */
  static async testSendNode(journeyId, nodeId, recipient) {
    const journey = await this.getById(journeyId);
    if (!journey) throw new Error('Journey not found');

    const node = (journey.nodes || []).find(n => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found in journey ${journeyId}`);
    if (node.type !== 'action') throw new Error(`Node ${nodeId} is type='${node.type}', only 'action' nodes are sendable`);

    const channel = (node.data?.channel || '').toLowerCase();
    const templateId = node.data?.templateId;
    if (!templateId) throw new Error(`Node ${nodeId} has no templateId`);

    // Slugified journey name in utm_campaign keeps analytics readable.
    const campaignSlug = String(journey.name || `journey-${journeyId}`)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Resolve recipient → unified_contacts for full personalization + rid attribution.
    // Email: match on email_key (lowercased). Phone: match on phone_key (last 10 digits).
    // If no match, fall back to generic (null unifiedId) — send still works.
    const resolveRecipient = async (to) => {
      if (channel === 'email') {
        const { rows: [u] } = await db.query(
          'SELECT unified_id, name, email FROM unified_contacts WHERE email_key = LOWER(TRIM($1)) LIMIT 1',
          [to]
        );
        return u || null;
      }
      const { rows: [u] } = await db.query(
        `SELECT unified_id, name, phone FROM unified_contacts
         WHERE phone_key = RIGHT(REGEXP_REPLACE($1, '[^0-9]', '', 'g'), 10) LIMIT 1`,
        [to]
      );
      return u || null;
    };

    // Build the UTM link including rid= when we found the user, so GTM event
    // attribution links clicks back to the same unified_id.
    const buildUtmLink = (unifiedId) => {
      const base = `https://www.raynatours.com/?utm_source=journey_test&utm_medium=${encodeURIComponent(channel)}&utm_campaign=${encodeURIComponent(campaignSlug)}&utm_content=${encodeURIComponent(nodeId)}`;
      return unifiedId ? `${base}&rid=${unifiedId}` : base;
    };

    if (channel === 'email') {
      const to = (recipient || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Valid email address required');
      const user = await resolveRecipient(to);
      const utmLink = buildUtmLink(user?.unified_id);
      const rendered = await EmailRenderer.render(parseInt(templateId), user?.unified_id || null, { utm_link: utmLink });
      const result = await EmailChannel.send({
        to,
        subject: rendered.subject || `[TEST] ${node.data?.label || 'Journey node'}`,
        html: rendered.html,
        text: rendered.plainText,
      });
      return {
        channel, recipient: to, templateId, utmLink,
        resolvedUser: user ? { unifiedId: user.unified_id, name: user.name } : null,
        ...result,
      };
    }

    if (channel === 'sms' || channel === 'whatsapp') {
      const to = (recipient || '').trim();
      if (!/^\+?[0-9][0-9\s\-()]{5,}$/.test(to)) throw new Error('Valid phone number required (E.164 recommended, e.g. +971501234567)');
      const { rows: [tpl] } = await db.query(
        'SELECT body, subject, external_status, external_template_id FROM content_templates WHERE id = $1',
        [parseInt(templateId)]
      );
      if (!tpl) throw new Error(`Template ${templateId} not found`);

      // Approval gate — WA/SMS must be approved via Gupshup before any send.
      // Simulation mode (no keys) still enforces this, but you can flip a template
      // to 'approved' via /api/v3/gupshup/templates/:id/force-approve for local dev.
      await GupshupService.assertApproved(parseInt(templateId));

      const user = await resolveRecipient(to);
      const utmLink = buildUtmLink(user?.unified_id);
      const rawBody = tpl.body || tpl.subject || node.data?.label || 'Journey node test';
      const firstName = user?.name ? user.name.split(' ')[0] : 'there';
      const body = `[TEST] ${rawBody
        .replace(/\{\{utm_link\}\}/g, utmLink)
        .replace(/\{\{first_name\}\}/g, firstName)}`;

      const result = channel === 'sms'
        ? await GupshupService.sendSMS({ to, templateId: parseInt(templateId), messageBody: body })
        : await GupshupService.sendWhatsApp({ to, templateId: parseInt(templateId), params: [firstName, utmLink] });

      return {
        channel, recipient: to, templateId, utmLink,
        externalTemplateId: tpl.external_template_id,
        resolvedUser: user ? { unifiedId: user.unified_id, name: user.name } : null,
        ...result,
      };
    }

    throw new Error(`Unsupported channel '${channel}'`);
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
   * Enroll-everyone-eligible. For "general broadcast" journeys that target
   * all email-eligible (or WA-eligible) contacts rather than a saved segment.
   *
   * @param {object} args
   * @param {number} args.journeyId
   * @param {'email'|'whatsapp'|'both'} [args.channel='email']  Eligibility filter
   * @param {'test_users'|'full'|'sample'} [args.mode='full']   How many to enroll
   * @param {number} [args.sampleSize]   For mode='sample' — exact N rows (random)
   * @param {number[]} [args.unifiedIds] For mode='test_users' — explicit ids
   *                                     (defaults to the 4 known test users in memory)
   */
  static async enrollAll({ journeyId, channel = 'email', mode = 'full', sampleSize = null, unifiedIds = null } = {}) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const startNodeId = journey.nodes?.[0]?.id || 'node_0';

    // Build the eligibility predicate per channel.
    const where = [];
    if (channel === 'email' || channel === 'both') {
      where.push(`(uc.email IS NOT NULL AND uc.email <> ''
                   AND COALESCE(uc.email_unsubscribed,'No') <> 'Yes'
                   AND uc.email ~ '^[^@]+@[^@]+\\.[^@]+$')`);
    }
    if (channel === 'whatsapp' || channel === 'both') {
      where.push(`(uc.phone IS NOT NULL AND uc.phone <> ''
                   AND COALESCE(uc.wa_unsubscribed,'No') <> 'Yes'
                   AND COALESCE(uc.is_indian, false) = true)`);
    }
    if (where.length === 0) throw new Error(`Unknown channel: ${channel}`);

    // Apply audience filter (existing journey-level Indian/Rest/All split).
    if (journey.audience === 'indian') where.push('uc.is_indian = true');
    else if (journey.audience === 'rest') where.push('uc.is_indian = false');

    let extra = '';
    let params = [journeyId, startNodeId];
    if (mode === 'test_users') {
      // Match by canonical email — the 4 test users (Akshith / Anket / Vaibhav /
      // Alok) saved in /memory. unifiedIds override available for ad-hoc tests.
      if (unifiedIds && unifiedIds.length > 0) {
        extra = `AND uc.unified_id = ANY($3::bigint[])`;
        params.push(unifiedIds);
      } else {
        extra = `AND LOWER(uc.email) = ANY($3::text[])`;
        params.push(Array.from(TEST_EMAILS));
      }
    } else if (mode === 'sample') {
      const n = Math.max(1, parseInt(sampleSize || 100));
      extra = `ORDER BY random() LIMIT ${n}`;
    }
    // mode === 'full' adds nothing extra.

    const sql = `
      INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track)
      SELECT $1, uc.unified_id, $2, CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END
      FROM unified_contacts uc
      WHERE ${where.join(' AND ')}
        AND NOT EXISTS (
          SELECT 1 FROM journey_entries je
          WHERE je.journey_id = $1 AND je.customer_id = uc.unified_id
        )
        ${extra}
      RETURNING entry_id`;

    const { rows } = await db.query(sql, params);

    if (rows.length > 0) {
      await db.query(
        'UPDATE journey_flows SET total_entries = total_entries + $1 WHERE journey_id = $2',
        [rows.length, journeyId]
      );
    }
    return { enrolled: rows.length, mode, channel };
  }

  /**
   * Enroll customers from a segment into a journey
   */
  static async enrollSegment(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey || !journey.segment_id) throw new Error('Journey has no segment');

    // Get all active customers in this segment not already enrolled.
    // Dual-track journeys (audience='all') enroll everyone and stamp each entry with
    // track='indian'|'rest' per is_indian. Legacy single-audience journeys keep prior behavior.
    let audienceFilter = '';
    if (journey.audience === 'indian')      audienceFilter = 'AND uc.is_indian = true';
    else if (journey.audience === 'rest')   audienceFilter = 'AND uc.is_indian = false';

    const { rows } = await db.query(`
      INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track)
      SELECT $1, sc.customer_id, $2, CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END
      FROM segment_customers sc
      JOIN unified_contacts uc ON uc.unified_id = sc.customer_id
      WHERE sc.segment_id = $3 AND sc.is_active = true
        ${audienceFilter}
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

    // Run id is deterministic per (journey, UTC day). This lets the T-60min
    // prewarm cron (prewarmJourneyPopularity) and the fire-time processJourney
    // call write/read snapshot rows under the SAME run_id — the prewarm
    // populates the day bucket at 4 AM Dubai, and the 5 AM journey cron's
    // _ensureNodeSnapshotted is a no-op (popularity_snapshots ON CONFLICT DO
    // NOTHING) because the rows already exist. journey_entries.last_run_id is
    // unchanged in semantics: same-day re-runs of the cron skip already-enqueued
    // entries, fresh-day runs re-enqueue any entries still on action nodes.
    const runId = PopularityService.runIdForBucket(journeyId);

    // Popularity is snapshotted LAZILY: only when a node first fires in this
    // run (i.e., we're about to enqueue an action for an entry sitting on it).
    // This way the LLM only ranks for nodes that actually have firing entries,
    // which is what "on every node fire → fresh dynamic content" actually means
    // in practice. _ensureNodeSnapshotted() dedupes within a run via this Set.
    const snapshottedNodes = new Set();

    // Get all active entries joined with unified_contacts + current journey segment
    const { rows: entries } = await db.query(`
      SELECT je.*, uc.name, uc.email, uc.phone, uc.phone_key, uc.booking_status,
        uc.total_tour_bookings, uc.total_hotel_bookings, uc.total_visa_bookings, uc.total_flight_bookings,
        uc.segment_label AS current_segment, uc.is_indian,
        sd.segment_name AS journey_segment
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.unified_id = je.customer_id
      LEFT JOIN segment_definitions sd ON sd.segment_id = $2
      WHERE je.journey_id = $1 AND je.status = 'active'
    `, [journeyId, journey.segment_id]);

    let processed = 0;
    let actioned = 0;
    let waited = 0;
    let conditioned = 0;
    let converted = 0;
    let enqueued = 0;

    // Action sends are batched and enqueued at the end of the loop so we minimize
    // BullMQ round-trips. One batch per channel.
    const enqueueByChannel = { email: [], whatsapp: [], sms: [] };

    for (const entry of entries) {
      // ── CONVERSION CHECK: runs BEFORE every node fires ──
      // If user booked or moved segments since entering, exit the journey.
      const conv = await this.checkConversion(entry);
      if (conv.converted) {
        await db.query(`
          UPDATE journey_entries
          SET status = 'converted', converted_at = NOW(), exit_reason = $2, last_conversion_check = NOW()
          WHERE entry_id = $1
        `, [entry.entry_id, conv.reason]);
        await db.query(`
          INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
          VALUES ($1, $2, 'converted', NULL, $3)
        `, [entry.entry_id, entry.current_node_id, JSON.stringify(conv)]);
        console.log(`[Journey ${journeyId}] Converted entry ${entry.entry_id} (uid=${entry.customer_id}) → ${conv.reason}`);
        converted++;
        processed++;
        continue;
      }
      await db.query('UPDATE journey_entries SET last_conversion_check = NOW() WHERE entry_id = $1', [entry.entry_id]);

      const currentNode = nodeMap[entry.current_node_id];
      if (!currentNode) continue;

      const entryTrack = entry.track || 'all';

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

      // ── ACTION node: enqueue a BullMQ job for the worker to send + advance ──
      // We do NOT send inline anymore. Instead we resolve the effective channel
      // + template per entry track, build a self-contained job payload, and add
      // it to the channel-specific queue. The worker handles render → send →
      // journey_events insert → entry advance. This is what scales the journey
      // run from a synchronous loop to ~18 lakh recipients.
      if (currentNode.type === 'action') {
        // Skip if this entry was already enqueued in this run — prevents double
        // enqueue if processJourney() is re-triggered before workers drain.
        if (entry.last_run_id === runId) {
          processed++;
          continue;
        }

        const rawChannel = (currentNode.data?.channel || '').toLowerCase();
        const rawTemplateId = currentNode.data?.templateId;
        let channel = rawChannel;
        let templateId = rawTemplateId;
        let autoPaired = false;
        if (rawChannel === 'whatsapp' && entryTrack === 'rest') {
          channel = (currentNode.data?.restChannel || 'email').toLowerCase();
          templateId = currentNode.data?.restTemplateId || rawTemplateId;
          autoPaired = true;
        }

        // TEST_USERS guard: hardcoded testers receive email only — no WhatsApp,
        // no SMS — even if the action node specifies one of those channels.
        // Skip the action entirely (don't enqueue) and advance to the next node.
        if (isTestUser(entry.email) && channel !== 'email') {
          await db.query(
            `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
             VALUES ($1, $2, 'action_skipped', $3, $4)`,
            [entry.entry_id, currentNode.id, channel,
             JSON.stringify({ reason: 'test_user_email_only', track: entryTrack })]
          );
          await this._advanceEntry(entry.entry_id, currentNode.id, edges, nodeMap, entryTrack);
          processed++;
          continue;
        }

        // Pre-resolve the html_template_id once per templateId per run (cached
        // on this in-memory map) so the worker doesn't have to do another lookup.
        let htmlTemplateId = null;
        if (channel === 'email' && templateId) {
          htmlTemplateId = await this._resolveHtmlTemplateId(parseInt(templateId));
        }

        // Lazy snapshot: this is the first entry firing this node in this run,
        // so snapshot popular products NOW (not at the top of processJourney).
        // Subsequent entries hitting the same node share the snapshot via the
        // popularity_snapshots UNIQUE constraint + this in-process dedupe Set.
        if (channel === 'email' && htmlTemplateId && !snapshottedNodes.has(currentNode.id)) {
          await this._ensureNodeSnapshotted({
            journeyId, runId, nodeId: currentNode.id, contentTemplateId: parseInt(templateId),
          });
          snapshottedNodes.add(currentNode.id);
        }

        const jobData = {
          entryId:        entry.entry_id,
          customerId:     entry.customer_id,
          journeyId,
          nodeId:         currentNode.id,
          runId,
          channel,
          templateId,
          htmlTemplateId,
          name:           entry.name,
          email:          entry.email,
          phone:          entry.phone,
          isIndian:       entry.is_indian,
          track:          entryTrack,
          autoPaired,
          originalChannel: rawChannel,
          edges,
          nodes:          nodeMap,
        };

        if (!channel || !templateId) {
          // Misconfigured action node — log + advance now, don't enqueue.
          await db.query(
            `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
             VALUES ($1, $2, 'action_blocked', $3, $4)`,
            [entry.entry_id, currentNode.id, channel || null,
             JSON.stringify({ reason: 'missing_channel_or_template', autoPaired, track: entryTrack })]
          );
          // Advance to next track-matched edge so the entry doesn't get stuck.
          await this._advanceEntry(entry.entry_id, currentNode.id, edges, nodeMap, entryTrack);
          processed++;
          continue;
        }

        if (!enqueueByChannel[channel]) enqueueByChannel[channel] = [];
        enqueueByChannel[channel].push({ data: jobData, opts: { jobId: `${journeyId}:${entry.entry_id}:${runId}` } });

        // Stamp the entry so we can tell it's in flight + skip it on re-runs.
        await db.query(
          `UPDATE journey_entries SET last_run_id = $2, last_enqueued_at = NOW()
             WHERE entry_id = $1`,
          [entry.entry_id, runId]
        );
        actioned++;
        processed++;
        // Worker advances the entry after the actual send — do NOT fall through
        // into the synchronous track-aware advance block at the bottom.
        continue;
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
      // Track-aware: prefer edges whose target node's track matches the entry's track.
      // Shared nodes (track='all') match any entry. For WhatsApp nodes, Rest users
      // receive the auto-pair (Email or SMS using restChannel + restTemplateId) — they
      // do NOT skip the step. The actual channel swap happens in the action-send block.
      const matchesTrack = (nodeId) => {
        const n = nodeMap[nodeId];
        if (!n) return false;
        const t = n.data?.track || 'all';
        return t === 'all' || t === entryTrack;
      };

      const outEdges = edges.filter(e => e.source === currentNode.id);
      const trackEdges = outEdges.filter(e => matchesTrack(e.target));
      const chosen = trackEdges[0] || outEdges[0];  // fall back to any edge if no track-match

      if (chosen) {
        await db.query('UPDATE journey_entries SET current_node_id = $1 WHERE entry_id = $2', [chosen.target, entry.entry_id]);
      } else {
        await db.query(
          "UPDATE journey_entries SET status = 'completed', completed_at = NOW() WHERE entry_id = $1",
          [entry.entry_id]
        );
      }
      processed++;
    }

    // Drain per-channel batches into BullMQ. We chunk to ~1000 jobs per addBulk
    // call to keep the Redis round-trip and the in-memory pipeline bounded.
    const BATCH_SIZE = 1000;
    for (const [channel, jobs] of Object.entries(enqueueByChannel)) {
      if (!jobs || jobs.length === 0) continue;
      for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const slice = jobs.slice(i, i + BATCH_SIZE);
        try {
          await enqueueBatch(channel, slice);
          enqueued += slice.length;
        } catch (err) {
          console.error(`[Journey ${journeyId}] enqueueBatch(${channel}) failed: ${err.message}`);
          // Roll back the last_run_id stamp on the affected entries so they are
          // re-tried on the next processJourney() run instead of being skipped.
          const entryIds = slice.map(j => j.data.entryId);
          await db.query(
            `UPDATE journey_entries SET last_run_id = NULL, last_enqueued_at = NULL
               WHERE entry_id = ANY($1::bigint[]) AND last_run_id = $2`,
            [entryIds, runId]
          ).catch(() => {});
        }
      }
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

    return { processed, actioned, waited, conditioned, converted, enqueued, runId };
  }

  // ── processJourney helpers ────────────────────────────────────

  /**
   * T-60min popularity prewarm. Looks for entries that will become due to
   * fire within the lookahead window, identifies the action node they'll hit,
   * and takes the popularity snapshot NOW so it's already in the DB by the
   * time the journey cron actually fires the send.
   *
   * Called from a cron 60 min ahead of processJourney's run (e.g., 4 AM Dubai
   * when processJourney is at 5 AM Dubai). Both share runIdForBucket(journeyId)
   * so the snapshots line up.
   *
   * @param {object} args
   * @param {number} [args.journeyId]            scope to one journey, else all active
   * @param {number} [args.lookaheadMinutes=60]  how far ahead to look
   * @param {number} [args.windowMinutes=30]     +/- tolerance around T-lookahead
   * @returns {{ journeysScanned, nodesSnapshotted, entriesConsidered }}
   */
  static async prewarmJourneyPopularity({
    journeyId = null,
    lookaheadMinutes = 60,
    windowMinutes = 30,
  } = {}) {
    const lookaheadMs = lookaheadMinutes * 60_000;
    const windowMs    = windowMinutes    * 60_000;
    const now = Date.now();

    const { rows: journeys } = await db.query(
      journeyId
        ? `SELECT journey_id, nodes, edges FROM journey_flows WHERE journey_id = $1`
        : `SELECT journey_id, nodes, edges FROM journey_flows WHERE status = 'active'`,
      journeyId ? [journeyId] : []
    );

    let nodesSnapshotted = 0;
    let entriesConsidered = 0;

    for (const j of journeys) {
      const nodes   = j.nodes || [];
      const edges   = j.edges || [];
      const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
      const runId   = PopularityService.runIdForBucket(j.journey_id);

      // Active entries + when their last journey event happened (used to compute
      // when their current wait will elapse).
      const { rows: entries } = await db.query(
        `SELECT je.entry_id, je.current_node_id, je.entered_at,
                (SELECT MAX(created_at) FROM journey_events WHERE entry_id = je.entry_id) AS last_event
           FROM journey_entries je
          WHERE je.journey_id = $1 AND je.status = 'active'`,
        [j.journey_id]
      );

      // Track which (journey, action_node) pairs we've already snapshotted in
      // this prewarm pass — many entries can land on the same node, and the
      // snapshot only needs to happen once per node per run.
      const snapshotted = new Set();

      for (const entry of entries) {
        entriesConsidered++;
        const currentNode = nodeMap[entry.current_node_id];
        if (!currentNode) continue;

        // Only entries sitting on a wait node have a predictable fire time.
        // (Entries already on action nodes will fire on the very next cron.)
        if (currentNode.type !== 'wait') continue;

        const waitDays = currentNode.data?.waitDays || 1;
        const lastEventTs = new Date(entry.last_event || entry.entered_at).getTime();
        const fireTs = lastEventTs + waitDays * 86_400_000;

        // Within [now+lookahead-window, now+lookahead+window]?
        if (Math.abs(fireTs - (now + lookaheadMs)) > windowMs) continue;

        // Find the action node this wait flows into.
        const outEdge = edges.find(e => e.source === entry.current_node_id);
        const nextNode = outEdge && nodeMap[outEdge.target];
        if (!nextNode || nextNode.type !== 'action') continue;
        if (!nextNode.data?.templateId) continue;

        if (snapshotted.has(nextNode.id)) continue;
        snapshotted.add(nextNode.id);

        await this._ensureNodeSnapshotted({
          journeyId:         j.journey_id,
          runId,
          nodeId:            nextNode.id,
          contentTemplateId: parseInt(nextNode.data.templateId),
        });
        nodesSnapshotted++;
      }
    }

    return {
      journeysScanned:    journeys.length,
      nodesSnapshotted,
      entriesConsidered,
      lookaheadMinutes,
      windowMinutes,
    };
  }

  /**
   * Lazy popularity snapshot — fired the first time an entry actually hits a
   * given action node within a processJourney run. Same one-call-per-run
   * uniformity as before (the popularity_snapshots UNIQUE constraint + the
   * in-memory dedupe Set in processJourney guarantee a single Anthropic call
   * per (journey, node, run)) but skips nodes that have no firing entries.
   *
   * Why lazy: a journey with a 14-day drip would otherwise pay for 4 LLM
   * ranking calls every cron tick — including the 13 ticks where the day-14
   * node has zero firing entries. Lazy snapshotting makes "node fires → fresh
   * dynamic content" a literal invariant of the code, not an emergent property.
   */
  static async _ensureNodeSnapshotted({ journeyId, runId, nodeId, contentTemplateId }) {
    const { rows: [cfg] } = await db.query(
      `SELECT eht.uses_popular_products, eht.product_type, eht.product_limit,
              eht.html_body
         FROM content_templates ct
         LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
        WHERE ct.id = $1`,
      [contentTemplateId]
    );
    if (!cfg || !cfg.uses_popular_products || !cfg.product_type) return;

    const themes = this._extractThemesFromTemplate(cfg.html_body, cfg.product_type);

    try {
      await PopularityService.snapshot({
        journeyId,
        nodeId,
        runId,
        productType: cfg.product_type,
        themes:      themes.length > 0 ? themes : [null],
        limit:       cfg.product_limit || undefined,
      });
      console.log(`[Journey ${journeyId}] popularity snapshot taken at node fire — node=${nodeId} type=${cfg.product_type} provider=${PopularityService.provider()}`);
    } catch (err) {
      // Snapshot failures are surfaced but don't kill the run — the renderer
      // will see an empty grouped map and drop the marker silently.
      console.error(`[Journey ${journeyId}] popularity snapshot failed for node=${nodeId}: ${err.message}`);
    }
  }

  /** Pull every theme=... attribute from <!-- SLOT:(product_grid|hero_image) ... --> comments matching productType. */
  static _extractThemesFromTemplate(html, productType) {
    if (!html) return [];
    const re = /<!--\s*SLOT:(?:product_grid|hero_image)\s+([^>]*?)-->/g;
    const themes = new Set();
    let m;
    while ((m = re.exec(html)) !== null) {
      const attrs = {};
      const ar = /(\w+)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = ar.exec(m[1])) !== null) attrs[a[1]] = a[2];
      if (attrs.product_type !== productType) continue;
      themes.add(attrs.theme || null);
    }
    return [...themes];
  }

  static async _resolveHtmlTemplateId(contentTemplateId) {
    if (!contentTemplateId) return null;
    const { rows: [r] } = await db.query(
      'SELECT html_template_id FROM content_templates WHERE id = $1',
      [contentTemplateId]
    );
    return r?.html_template_id || null;
  }

  /** Track-aware entry advance — same logic the worker uses, but available to the producer
   *  for the misconfigured-action-node fallback so we don't enqueue garbage jobs. */
  static async _advanceEntry(entryId, currentNodeId, edges, nodeMap, entryTrack) {
    const matchesTrack = (nodeId) => {
      const n = nodeMap[nodeId];
      if (!n) return false;
      const t = n.data?.track || 'all';
      return t === 'all' || t === entryTrack;
    };
    const outEdges = edges.filter(e => e.source === currentNodeId);
    const trackEdges = outEdges.filter(e => matchesTrack(e.target));
    const chosen = trackEdges[0] || outEdges[0];

    if (chosen) {
      await db.query('UPDATE journey_entries SET current_node_id = $1 WHERE entry_id = $2',
                     [chosen.target, entryId]);
    } else {
      await db.query("UPDATE journey_entries SET status = 'completed', completed_at = NOW() WHERE entry_id = $1",
                     [entryId]);
    }
  }

  /**
   * Check whether an entry has converted since it was enrolled.
   * Converts when EITHER:
   *   - A new booking exists in any rayna_* table with bill_date >= entered_at, OR
   *   - The user's current segment differs from the journey's intended segment
   *     (segment engine has moved them; they're no longer the target audience).
   * Returns: { converted: bool, reason: 'booking' | 'segment_change' | null, details?: {...} }
   */
  static async checkConversion(entry) {
    // 1. Booking-based conversion
    const { rows: [b] } = await db.query(`
      SELECT
        EXISTS (SELECT 1 FROM rayna_tours   WHERE unified_id = $1 AND bill_date >= $2) AS tour,
        EXISTS (SELECT 1 FROM rayna_hotels  WHERE unified_id = $1 AND bill_date >= $2) AS hotel,
        EXISTS (SELECT 1 FROM rayna_visas   WHERE unified_id = $1 AND bill_date >= $2) AS visa,
        EXISTS (SELECT 1 FROM rayna_flights WHERE unified_id = $1 AND bill_date >= $2) AS flight
    `, [entry.customer_id, entry.entered_at]);
    if (b.tour || b.hotel || b.visa || b.flight) {
      const types = [];
      if (b.tour) types.push('tour');
      if (b.hotel) types.push('hotel');
      if (b.visa) types.push('visa');
      if (b.flight) types.push('flight');
      return { converted: true, reason: 'booking', details: { types } };
    }

    // 2. Segment-change conversion — user no longer matches the journey's target segment.
    // Skip this check for journeys that aren't tied to a specific segment (e.g., occasions).
    if (entry.journey_segment && entry.current_segment && entry.journey_segment !== entry.current_segment) {
      return {
        converted: true,
        reason: 'segment_change',
        details: { from: entry.journey_segment, to: entry.current_segment },
      };
    }

    return { converted: false, reason: null };
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
