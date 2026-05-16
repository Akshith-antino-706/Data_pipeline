import db from '../config/database.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmailRenderer from './EmailRenderer.js';
import { EmailChannel } from './channels/EmailChannel.js';
import { ChatheadEmailChannel } from './channels/ChatheadEmailChannel.js';

import GupshupService from './GupshupService.js';
import PopularityService from './PopularityService.js';
import { enqueueBatch } from './queue/index.js';
import CustomSegmentService from './CustomSegmentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MAIL_TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'mail_templates');

// Pick ChatheadEmailChannel if configured (sends from explore@promotions.raynatours.com),
// otherwise fall back to SMTP EmailChannel.
function getEmailChannel() {
  return ChatheadEmailChannel.isConfigured() ? ChatheadEmailChannel : EmailChannel;
}

// Render the real Day HTML for a contact using the same Day renderers testSends uses.
// Uses fallback ranking (no Claude API call) to keep sends fast.
async function renderDayHtml(templateId, contactId) {
  const id = parseInt(templateId);
  const tplFile = (name) => fs.readFileSync(path.join(MAIL_TEMPLATES_DIR, name), 'utf8');

  if (id === 1) {
    const { _internals } = await import('./Day1WelcomeRankingService.js');
    const { buildDay1WelcomeData }            = await import('./Day1WelcomeDataService.js');
    const { renderDay1Welcome }               = await import('./Day1WelcomeRenderer.js');
    const { rows: visaRows } = await db.query("SELECT key, name FROM visa_products LIMIT 20").catch(() => ({ rows: [] }));
    const visaMap  = Object.fromEntries((visaRows || []).map(r => [r.key, r]));
    const ranking  = _internals.buildFallbackRanking({
      holidayMap:  _internals.HOLIDAY_DESTINATIONS  || {},
      cruiseMap:   _internals.CRUISE_DESTINATIONS   || {},
      activityMap: _internals.ACTIVITY_DESTINATIONS || {},
      visaMap,
    });
    const data = await buildDay1WelcomeData({ contactId, ranking });
    return { html: renderDay1Welcome(tplFile('day1-welcome-dynamic.html'), data), subject: 'Your Rayna Tours Journey Starts Here' };
  }
  if (id === 2) {
    const { _internals } = await import('./Day2CruiseRankingService.js');
    const { buildDay2CruiseData }             = await import('./Day2CruiseDataService.js');
    const { renderDay2Cruise }                = await import('./Day2CruiseRenderer.js');
    const ranking = _internals.buildFallbackRanking();
    const data    = await buildDay2CruiseData({ contactId, ranking });
    return { html: renderDay2Cruise(tplFile('day2-cruise-dynamic.html'), data), subject: 'Set Sail: Cruise Highlights from Rayna Tours' };
  }
  if (id === 3) {
    const { _internals } = await import('./VisaRankingService.js');
    const { buildDay3VisaData }             = await import('./Day3VisaDataService.js');
    const { renderDay3Visa }                = await import('./Day3VisaRenderer.js');
    const ranking = _internals.buildFallbackRanking();
    if (!ranking.ratings_keys) ranking.ratings_keys = ['rayna', 'trustpilot', 'tripadvisor', 'google'];
    const data = await buildDay3VisaData({ contactId, ranking });
    return { html: renderDay3Visa(tplFile('day3-visa-dynamic.html'), data), subject: 'Your Visa, Sorted | Rayna Tours' };
  }
  if (id === 4) {
    const { _internals } = await import('./Day4HolidaysRankingService.js');
    const { buildDay4HolidaysData } = await import('./Day4HolidaysDataService.js');
    const { renderDay4Holidays }    = await import('./Day4HolidaysRenderer.js');
    const ranking = _internals.buildFallbackRanking();
    const data    = await buildDay4HolidaysData({ contactId, ranking });
    return { html: renderDay4Holidays(tplFile('day4-holidays-dynamic.html'), data), subject: 'Curated Trips Selected for You | Rayna Tours' };
  }
  if (id === 5) {
    const { _internals } = await import('./Day5ActivitiesRankingService.js');
    const { buildDay5ActivitiesData } = await import('./Day5ActivitiesDataService.js');
    const { renderDay5Activities }    = await import('./Day5ActivitiesRenderer.js');
    const ranking = _internals.buildFallbackRanking();
    const data    = await buildDay5ActivitiesData({ contactId, ranking });
    return { html: renderDay5Activities(tplFile('day5-activities-dynamic.html'), data), subject: 'Top Activities in Dubai | Rayna Tours' };
  }
  if (id === 6) {
    const { _internals } = await import('./Day6DestinationRankingService.js');
    const { buildDay6DestinationData } = await import('./Day6DestinationDataService.js');
    const { renderDay6Destination }    = await import('./Day6DestinationRenderer.js');
    const ranking = _internals.buildFallbackRanking ? _internals.buildFallbackRanking() : {};
    const data    = await buildDay6DestinationData({ contactId, ranking });
    return { html: renderDay6Destination(tplFile('day6-destination-dynamic.html'), data), subject: 'Your Next Destination Awaits | Rayna Tours' };
  }
  if (id === 7) {
    const { buildDay7AbandonedCartData } = await import('./Day7AbandonedCartDataService.js');
    const { renderDay7AbandonedCart }    = await import('./Day7AbandonedCartRenderer.js');
    const data = await buildDay7AbandonedCartData({ contactId });
    return { html: renderDay7AbandonedCart(tplFile('day7-abandoned-cart-dynamic.html'), data), subject: 'You Left Something Behind | Rayna Tours' };
  }
  return null; // unknown template — fall back to EmailRenderer
}

// Test email guard — used by processJourney to force email-only for test
// users (skip WhatsApp/SMS). Keep empty; test sends now use a separate
// /api/v3/test-sends route with user-selected recipients.
const TEST_EMAILS = new Set([]);
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
        COALESCE(sd.segment_name, cs.name) AS segment_name, sd.segment_number, sd.priority,
        fs.stage_name, fs.stage_color,
        COALESCE(jsonb_array_length(jf.nodes), 0) AS node_count
      FROM journey_flows jf
      LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
      LEFT JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      LEFT JOIN custom_segments cs ON cs.id = jf.custom_segment_id
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
        fs.stage_name, fs.stage_color,
        cs.name AS custom_segment_name
      FROM journey_flows jf
      LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
      LEFT JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      LEFT JOIN custom_segments cs ON cs.id = jf.custom_segment_id
      WHERE jf.journey_id = $1
    `, [journeyId]);

    if (!journey) return null;
    // Normalize segment name for display
    if (!journey.segment_name && journey.custom_segment_name) {
      journey.segment_name = journey.custom_segment_name;
    }

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

    // Compute per-node lifecycle status from live journey_entries
    // pending  → no entries have reached this node yet
    // running  → ≥1 active entry is currently sitting on this node
    // completed → entries have passed through this node and none are active here
    let node_statuses = {};
    const nodes = journey.nodes || [];
    if (journey.status === 'draft') {
      nodes.forEach(n => { node_statuses[n.id] = 'pending'; });
    } else if (journey.status === 'completed') {
      nodes.forEach(n => { node_statuses[n.id] = 'completed'; });
    } else {
      // active / paused — derive from entries
      const { rows: activeOnNode } = await db.query(
        `SELECT current_node_id, COUNT(*) AS cnt
         FROM journey_entries WHERE journey_id = $1 AND status = 'active'
         GROUP BY current_node_id`,
        [journeyId]
      );
      const { rows: processedNodes } = await db.query(
        `SELECT DISTINCT je.node_id
         FROM journey_events je
         JOIN journey_entries jen ON jen.entry_id = je.entry_id
         WHERE jen.journey_id = $1
           AND je.event_type IN ('action_sent','action_blocked','action_failed','condition_evaluated','converted')`,
        [journeyId]
      );
      const activeSet = new Set(activeOnNode.map(r => r.current_node_id));
      const processedSet = new Set(processedNodes.map(r => r.node_id));
      // Lowest index of any running node — everything before it that was processed = completed
      const runningIndexes = nodes.reduce((acc, n, i) => { if (activeSet.has(n.id)) acc.push(i); return acc; }, []);
      const minRunning = runningIndexes.length > 0 ? Math.min(...runningIndexes) : nodes.length;
      nodes.forEach((n, i) => {
        if (activeSet.has(n.id)) node_statuses[n.id] = 'running';
        else if (i < minRunning && processedSet.has(n.id)) node_statuses[n.id] = 'completed';
        else if (processedSet.has(n.id)) node_statuses[n.id] = 'completed'; // processed and no active here
        else node_statuses[n.id] = 'pending';
      });
    }

    // Per-node triggered (unique entries) and exited (converted at that node) counts
    const { rows: nodeEntryCounts } = await db.query(`
      SELECT node_id,
        COUNT(DISTINCT je.entry_id) AS triggered,
        COUNT(DISTINCT je.entry_id) FILTER (WHERE je.event_type = 'converted') AS exited
      FROM journey_events je
      JOIN journey_entries jen ON jen.entry_id = je.entry_id
      WHERE jen.journey_id = $1
      GROUP BY node_id
    `, [journeyId]);

    return { ...journey, entryStats, nodeAnalytics, nodeEntryCounts, node_statuses };
  }

  static async create({ name, description, segmentId, strategyId, nodes, edges, goalType, goalValue, createdBy, audience, exitOnConversion, scheduledStartAt }) {
    // Parse custom segment format "custom:ID"
    let stdSegmentId = null;
    let customSegmentId = null;
    if (segmentId && String(segmentId).startsWith('custom:')) {
      customSegmentId = parseInt(String(segmentId).split(':')[1]) || null;
    } else if (segmentId) {
      stdSegmentId = segmentId;
    }

    const { rows: [journey] } = await db.query(`
      INSERT INTO journey_flows (name, description, segment_id, custom_segment_id, strategy_id, nodes, edges, goal_type, goal_value, created_by, audience, exit_on_conversion, scheduled_start_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [name, description, stdSegmentId, customSegmentId, strategyId, JSON.stringify(nodes || []), JSON.stringify(edges || []), goalType, goalValue, createdBy, audience || 'all', exitOnConversion !== false, scheduledStartAt || null]);
    return journey;
  }

  static async update(journeyId, fields) {
    const sets = [];
    const params = [journeyId];
    const allowed = { name: 'name', description: 'description', segment_id: 'segment_id', custom_segment_id: 'custom_segment_id', nodes: 'nodes', edges: 'edges', status: 'status', goal_type: 'goal_type', goal_value: 'goal_value', audience: 'audience', exit_on_conversion: 'exit_on_conversion', scheduled_start_at: 'scheduled_start_at' };

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
    // Nullify non-cascading FK on campaigns before deleting the journey
    await db.query('UPDATE campaigns SET journey_id = NULL WHERE journey_id = $1', [journeyId]);
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
    const templateId = node.data?.templateId
      || (channel === 'email' ? node.data?.emailTemplateId : null)
      || (channel === 'whatsapp' ? node.data?.whatsappTemplateId : null)
      || (channel === 'sms' ? node.data?.smsTemplateId : null);
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
          'SELECT id AS unified_id, name, email FROM unified_contacts WHERE LOWER(email) = LOWER(TRIM($1)) LIMIT 1',
          [to]
        );
        return u || null;
      }
      const { rows: [u] } = await db.query(
        `SELECT id AS unified_id, name, mobile AS phone FROM unified_contacts
         WHERE RIGHT(REGEXP_REPLACE(mobile, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE($1, '[^0-9]', '', 'g'), 10) LIMIT 1`,
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

  /**
   * Send a test to multiple recipients in one call.
   * Runs all sends in parallel and returns per-recipient results so the
   * UI can show a full log without making N separate HTTP requests.
   */
  static async testSendNodeBatch(journeyId, nodeId, recipients) {
    if (!Array.isArray(recipients) || recipients.length === 0) throw new Error('No recipients provided');

    const settled = await Promise.allSettled(
      recipients.map(recipient => this.testSendNode(journeyId, nodeId, recipient))
    );

    const results = settled.map((r, i) => ({
      recipient: recipients[i],
      ok: r.status === 'fulfilled',
      ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message || 'Send failed' }),
    }));

    return {
      total: results.length,
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    };
  }

  /**
   * Send to ONE real customer but deliver to an override email (for test-mode).
   * Renders the template with the real unified_id (full personalization) but
   * routes the actual SMTP delivery to `overrideEmail`.
   */
  static async testSendNodeForUser(journeyId, nodeId, unifiedId, overrideEmail) {
    const journey = await this.getById(journeyId);
    if (!journey) throw new Error('Journey not found');
    const node = (journey.nodes || []).find(n => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    if (node.type !== 'action') throw new Error('Only action nodes are sendable');

    const channel = (node.data?.channel || '').toLowerCase();
    const templateId = node.data?.templateId
      || (channel === 'email'    ? node.data?.emailTemplateId    : null)
      || (channel === 'whatsapp' ? node.data?.whatsappTemplateId : null)
      || (channel === 'sms'      ? node.data?.smsTemplateId      : null);
    if (!templateId) throw new Error(`Node ${nodeId} has no templateId`);

    // Fetch real customer for personalization
    const { rows: [user] } = await db.query(
      'SELECT id AS unified_id, name, email FROM unified_contacts WHERE id = $1',
      [String(unifiedId)]
    );

    const campaignSlug = String(journey.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = `https://www.raynatours.com/?utm_source=journey_test&utm_medium=${channel}&utm_campaign=${encodeURIComponent(campaignSlug)}&utm_content=${encodeURIComponent(nodeId)}`;
    const utmLink = user ? `${base}&rid=${user.unified_id}` : base;

    if (channel === 'email') {
      // Try Day-specific renderer first (templates 1–7); fall back to generic EmailRenderer
      let html, subject;
      const dayRendered = await renderDayHtml(templateId, user?.unified_id || unifiedId).catch(() => null);
      if (dayRendered?.html) {
        html    = dayRendered.html;
        subject = dayRendered.subject || node.data?.label || 'Rayna Tours';
      } else {
        const rendered = await EmailRenderer.render(parseInt(templateId), user?.unified_id || null, { utm_link: utmLink });
        html    = rendered.html;
        subject = rendered.subject || node.data?.label || 'Rayna Tours';
      }

      const EmailCh = getEmailChannel();
      const result  = await EmailCh.send({ to: overrideEmail, subject, html });
      return { channel, recipient: overrideEmail, realEmail: user?.email || null, resolvedUser: user ? { unifiedId: user.unified_id, name: user.name } : null, ...result };
    }
    throw new Error(`Unsupported channel '${channel}' for segment test`);
  }

  /**
   * Send to all customers in the journey's segment, replacing each customer's
   * real email with testEmail (e.g. rocky.86agency@gmail.com) so all test
   * sends land in one inbox while templates still render with real customer data.
   */
  static async testSendNodeToSegment(journeyId, nodeId, testEmail = 'rocky.86agency@gmail.com', limit = 100) {
    const { rows: [journey] } = await db.query(
      'SELECT journey_id, name, segment_id, custom_segment_id, nodes FROM journey_flows WHERE journey_id = $1',
      [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const n = Math.min(Math.max(parseInt(limit) || 100, 1), 50000);
    let customers = [];

    if (journey.custom_segment_id) {
      const result = await CustomSegmentService.getCustomers(journey.custom_segment_id, { page: 1, limit: n });
      customers = (result?.data || []).map(r => ({ unified_id: r.id }));
    } else if (journey.segment_id) {
      const { rows } = await db.query(
        `SELECT sc.unified_id FROM segment_customers sc
         WHERE sc.segment_id = $1 AND sc.is_active = true LIMIT $2`,
        [journey.segment_id, n]
      );
      customers = rows;
    } else {
      const { rows } = await db.query(
        `SELECT je.unified_id FROM journey_entries je WHERE je.journey_id = $1 LIMIT $2`,
        [journeyId, n]
      );
      customers = rows;
    }

    if (customers.length === 0) throw new Error('No customers found in segment — enroll the segment first or check the journey has a segment attached');

    // Find/create campaign record before sending so we can update it
    const node = (journey.nodes || []).find(n => n.id === nodeId);
    const channel = (node?.data?.channel || 'email').toLowerCase();
    const templateId = node?.data?.templateId || node?.data?.emailTemplateId || node?.data?.whatsappTemplateId || node?.data?.smsTemplateId;
    const segLabel = `journey:${journeyId}:${nodeId}`;

    let campaignId;
    const { rows: [existing] } = await db.query(
      'SELECT id, sent_count, fail_count FROM campaigns WHERE journey_id = $1 AND journey_node_id = $2',
      [journeyId, nodeId]
    );
    if (existing) {
      campaignId = existing.id;
      // Reset counts for this run (fresh test)
      await db.query(
        'UPDATE campaigns SET sent_count = 0, fail_count = 0, target_count = $1, started_at = NOW(), updated_at = NOW() WHERE id = $2',
        [customers.length, campaignId]
      );
    } else {
      const { rows: [created] } = await db.query(
        `INSERT INTO campaigns (name, segment_label, channel, template_id, journey_id, journey_node_id, target_count, sent_count, fail_count, status, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,'running',NOW()) RETURNING id`,
        [`${journey.name} – ${nodeId}`, segLabel, channel, templateId || null, journeyId, nodeId, customers.length]
      );
      campaignId = created.id;
    }

    const BATCH = 50;
    let sent = 0, failed = 0;

    for (let i = 0; i < customers.length; i += BATCH) {
      const batch = customers.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(c => this.testSendNodeForUser(journeyId, nodeId, c.unified_id, testEmail))
      );
      settled.forEach(r => r.status === 'fulfilled' && r.value?.success ? sent++ : failed++);

      // Persist running counts every batch so UI can reflect progress on reload
      await db.query(
        'UPDATE campaigns SET sent_count = $1, fail_count = $2, updated_at = NOW() WHERE id = $3',
        [sent, failed, campaignId]
      );
    }

    // Mark completed
    await db.query(
      'UPDATE campaigns SET completed_at = NOW(), updated_at = NOW() WHERE id = $1',
      [campaignId]
    );

    return { total: customers.length, sent, failed, testEmail, baseEmail: testEmail, campaignId };
  }

  static async getNodeSendLog(journeyId, nodeId) {
    const { rows: [camp] } = await db.query(
      `SELECT id, name, sent_count, fail_count, target_count, started_at, completed_at, updated_at,
              delivered_count, read_count, click_count, bounce_count
       FROM campaigns WHERE journey_id = $1 AND journey_node_id = $2`,
      [journeyId, nodeId]
    );
    if (!camp) return null;
    return {
      campaignId: camp.id,
      name: camp.name,
      total: parseInt(camp.target_count) || 0,
      sent: parseInt(camp.sent_count) || 0,
      failed: parseInt(camp.fail_count) || 0,
      delivered: parseInt(camp.delivered_count) || 0,
      read: parseInt(camp.read_count) || 0,
      clicked: parseInt(camp.click_count) || 0,
      bounced: parseInt(camp.bounce_count) || 0,
      startedAt: camp.started_at,
      completedAt: camp.completed_at,
      updatedAt: camp.updated_at,
    };
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
      where.push(`(uc.mobile IS NOT NULL AND uc.mobile <> ''
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
        extra = `AND uc.id = ANY($3::bigint[])`;
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
      SELECT $1, uc.id, $2, CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END
      FROM unified_contacts uc
      WHERE ${where.join(' AND ')}
        AND NOT EXISTS (
          SELECT 1 FROM journey_entries je
          WHERE je.journey_id = $1 AND je.customer_id = uc.id
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
    if (!journey || (!journey.segment_id && !journey.custom_segment_id)) throw new Error('Journey has no segment');

    let audienceFilter = '';
    if (journey.audience === 'indian')      audienceFilter = 'AND uc.is_indian = true';
    else if (journey.audience === 'rest')   audienceFilter = 'AND uc.is_indian = false';

    const firstNodeId = journey.nodes?.[0]?.id || 'node_0';
    let rows;

    if (journey.custom_segment_id) {
      // Custom segment — fetch via CustomSegmentService (queries unified_contacts directly)
      const segResult = await CustomSegmentService.getCustomers(journey.custom_segment_id, { page: 1, limit: 50000 });
      const segCustomers = segResult?.data || [];

      // Apply audience filter and exclude already-enrolled customers
      const { rows: alreadyEnrolled } = await db.query(
        'SELECT customer_id FROM journey_entries WHERE journey_id = $1', [journeyId]
      );
      const enrolledSet = new Set(alreadyEnrolled.map(r => String(r.customer_id)));

      const toInsert = segCustomers.filter(c => {
        if (enrolledSet.has(String(c.id))) return false;
        if (journey.audience === 'indian' && !c.is_indian) return false;
        if (journey.audience === 'rest' && c.is_indian) return false;
        return true;
      });

      rows = [];
      for (const c of toInsert) {
        const track = c.is_indian ? 'indian' : 'rest';
        const { rows: inserted } = await db.query(
          'INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING entry_id',
          [journeyId, c.id, firstNodeId, track]
        );
        if (inserted.length) rows.push(inserted[0]);
      }
    } else {
      // Standard segment — query segment_customers
      ({ rows } = await db.query(`
        INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track)
        SELECT $1, sc.customer_id, $2, CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END
        FROM segment_customers sc
        JOIN unified_contacts uc ON uc.id = sc.customer_id
        WHERE sc.segment_id = $3 AND sc.is_active = true
          ${audienceFilter}
          AND NOT EXISTS (SELECT 1 FROM journey_entries je WHERE je.journey_id = $1 AND je.customer_id = sc.customer_id)
        RETURNING entry_id
      `, [journeyId, firstNodeId, journey.segment_id]));
    }

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
      SELECT je.*, uc.name, uc.email, uc.mobile AS phone,
        uc.booking_status,
        uc.total_tour_bookings, uc.total_hotel_bookings, uc.total_visa_bookings, uc.total_flight_bookings,
        uc.segment_label AS current_segment, uc.is_indian,
        sd.segment_name AS journey_segment
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.id = je.customer_id
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
      // Skip for awareness journeys (exit_on_conversion = false).
      if (journey.exit_on_conversion !== false) {
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
      }

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
        // ── SEND-HOUR GATE (Dubai timezone) ──
        // If the node has a sendHour, only fire when current Dubai hour matches.
        const sendHour = currentNode.data?.sendHour;
        if (sendHour !== undefined && sendHour !== null) {
          const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
          if (dubaiNow.getHours() !== sendHour) {
            waited++;
            processed++;
            continue;
          }
        }

        // Skip if this entry was already enqueued in this run — prevents double
        // enqueue if processJourney() is re-triggered before workers drain.
        if (entry.last_run_id === runId) {
          processed++;
          continue;
        }

        const rawChannel = (currentNode.data?.channel || '').toLowerCase();
        const rawTemplateId = currentNode.data?.templateId
          || (rawChannel === 'email' ? currentNode.data?.emailTemplateId : null)
          || (rawChannel === 'whatsapp' ? currentNode.data?.whatsappTemplateId : null)
          || (rawChannel === 'sms' ? currentNode.data?.smsTemplateId : null);
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
        const nextCh = (nextNode.data?.channel || '').toLowerCase();
        const nextTemplateId = nextNode.data?.templateId
          || (nextCh === 'email' ? nextNode.data?.emailTemplateId : null)
          || (nextCh === 'whatsapp' ? nextNode.data?.whatsappTemplateId : null)
          || (nextCh === 'sms' ? nextNode.data?.smsTemplateId : null);
        if (!nextTemplateId) continue;

        if (snapshotted.has(nextNode.id)) continue;
        snapshotted.add(nextNode.id);

        await this._ensureNodeSnapshotted({
          journeyId:         j.journey_id,
          runId,
          nodeId:            nextNode.id,
          contentTemplateId: parseInt(nextTemplateId),
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
      const nextNode = nodeMap[chosen.target];
      const nextFireAt = JourneyService.calculateNextFireAt(nextNode, new Date());
      await db.query(
        'UPDATE journey_entries SET current_node_id = $1, next_fire_at = $2 WHERE entry_id = $3',
        [chosen.target, nextFireAt, entryId]
      );
    } else {
      await db.query(
        "UPDATE journey_entries SET status = 'completed', completed_at = NOW(), next_fire_at = NULL WHERE entry_id = $1",
        [entryId]
      );
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
        EXISTS (SELECT 1 FROM rayna_tours    WHERE unified_id = $1 AND bill_date >= $2) AS tour,
        EXISTS (SELECT 1 FROM rayna_hotels   WHERE unified_id = $1 AND bill_date >= $2) AS hotel,
        EXISTS (SELECT 1 FROM rayna_visas    WHERE unified_id = $1 AND bill_date >= $2) AS visa,
        EXISTS (SELECT 1 FROM rayna_flights  WHERE unified_id = $1 AND bill_date >= $2) AS flight,
        EXISTS (SELECT 1 FROM rayna_packages WHERE unified_id = $1 AND bill_date >= $2) AS package,
        EXISTS (SELECT 1 FROM rayna_others   WHERE unified_id = $1 AND bill_date >= $2) AS other
    `, [entry.customer_id, entry.entered_at]);
    if (b.tour || b.hotel || b.visa || b.flight || b.package || b.other) {
      const types = [];
      if (b.tour) types.push('tour');
      if (b.hotel) types.push('hotel');
      if (b.visa) types.push('visa');
      if (b.flight) types.push('flight');
      if (b.package) types.push('package');
      if (b.other) types.push('other');
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

  // ── Journey Entries (real flow data) ────────────────────────

  static async getEntries(journeyId, { page = 1, limit = 50, status } = {}) {
    const offset = (page - 1) * limit;
    let where = 'je.journey_id = $1';
    const params = [journeyId];
    if (status) {
      params.push(status);
      where += ` AND je.status = $${params.length}`;
    }

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM journey_entries je WHERE ${where}`, params
    );

    const { rows } = await db.query(`
      SELECT je.entry_id, je.customer_id, je.current_node_id, je.status,
             je.entered_at, je.completed_at, je.converted_at, je.exit_reason,
             je.next_fire_at, je.track,
             uc.name, uc.email, uc.mobile AS phone, uc.booking_status
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.id = je.customer_id
      WHERE ${where}
      ORDER BY je.entered_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    return { data: rows, total: parseInt(count), page, limit };
  }

  // ── Campaign Analytics per Journey ─────────────────────────

  static async getJourneyCampaignAnalytics(journeyId) {
    // Get all campaigns linked to this journey's segment
    const { rows: journey } = await db.query(
      `SELECT jf.*, sd.segment_name, cs.name AS custom_segment_name FROM journey_flows jf
       LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
       LEFT JOIN custom_segments cs ON cs.id = jf.custom_segment_id
       WHERE jf.journey_id = $1`, [journeyId]
    );
    if (!journey[0]) return null;

    const segmentLabel = journey[0].segment_name || journey[0].custom_segment_name || journey[0].segment_label;

    // Get segment customer count for target — handle both standard and custom segments
    let targetCount = 0;
    if (journey[0].custom_segment_id) {
      const seg = await CustomSegmentService.getById(journey[0].custom_segment_id);
      if (seg) {
        targetCount = await CustomSegmentService.getCountPreview(seg.conditions || []);
      }
    } else if (journey[0].segment_id) {
      const { rows: [segCount] } = await db.query(
        `SELECT COUNT(*) AS cnt FROM segment_customers WHERE segment_id = $1 AND is_active = true`,
        [journey[0].segment_id]
      );
      targetCount = parseInt(segCount?.cnt) || 0;
    }

    // Get campaign metrics — prefer direct journey_id match, fallback to segment_label
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.name, c.channel::text, c.status, c.template_id,
        c.sent_count, c.delivered_count, c.read_count, c.click_count,
        c.bounce_count, c.fail_count, c.conversion_count, c.revenue_total,
        c.journey_node_id, c.target_count, c.started_at, c.completed_at,
        ct.body AS template_body, ct.name AS template_name,
        CASE WHEN c.sent_count > 0 THEN ROUND(c.delivered_count::numeric / c.sent_count * 100, 1) ELSE 0 END AS delivery_rate,
        CASE WHEN c.delivered_count > 0 THEN ROUND(c.read_count::numeric / c.delivered_count * 100, 1) ELSE 0 END AS open_rate,
        CASE WHEN c.delivered_count > 0 THEN ROUND(c.click_count::numeric / c.delivered_count * 100, 1) ELSE 0 END AS click_rate
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.journey_id = $2 OR c.segment_label = $1
      ORDER BY c.created_at ASC
    `, [segmentLabel, journeyId]);

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
        uc.name, uc.email, uc.mobile AS phone, uc.company_name, uc.country,
        uc.booking_status, uc.segment_label
      FROM journey_entries je
      JOIN unified_contacts uc ON uc.id = je.customer_id
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

  // ══════════════════════════════════════════════════════════════
  // JOURNEY AUTOMATION — Start, Pause, Scheduled Processing
  // ══════════════════════════════════════════════════════════════

  /**
   * Calculate the next fire time for an entry arriving at a node.
   * Uses waitDays + sendHour in Dubai timezone (UTC+4).
   */
  static calculateNextFireAt(node, fromTime = new Date()) {
    if (!node) return null;

    const waitDays = node.data?.waitDays || 0;
    const sendHour = node.data?.sendHour;

    // Start from fromTime + waitDays
    const target = new Date(fromTime.getTime() + waitDays * 24 * 60 * 60 * 1000);

    // If no sendHour specified, fire immediately after wait
    if (sendHour === undefined || sendHour === null) return target;

    // Convert target to Dubai time and set to the desired hour
    const dubaiOffset = 4 * 60; // UTC+4 in minutes
    const utcMs = target.getTime() + (target.getTimezoneOffset() * 60000);
    const dubaiMs = utcMs + (dubaiOffset * 60000);
    const dubaiDate = new Date(dubaiMs);

    dubaiDate.setHours(sendHour, 0, 0, 0);

    // Convert back to UTC
    const fireUtcMs = dubaiDate.getTime() - (dubaiOffset * 60000);
    let fireAt = new Date(fireUtcMs);

    // If the calculated time is in the past, push to next day
    if (fireAt <= new Date()) {
      fireAt = new Date(fireAt.getTime() + 24 * 60 * 60 * 1000);
    }

    return fireAt;
  }

  /**
   * Find the first actionable node (skip trigger, go to first real node).
   */
  static _findFirstActionableNode(nodes, edges) {
    const triggerNode = nodes.find(n => n.type === 'trigger');
    if (!triggerNode) return nodes[0] || null;

    const firstEdge = edges.find(e => e.source === triggerNode.id);
    if (firstEdge) {
      return nodes.find(n => n.id === firstEdge.target) || nodes[1] || null;
    }
    // Fallback: second node in array
    return nodes[1] || triggerNode;
  }

  /**
   * Start a journey: set active, enroll segment, set next_fire_at, run first process.
   */
  static async startJourney(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');
    if (journey.status === 'active') throw new Error('Journey is already active');

    const nodes = journey.nodes || [];
    const edges = journey.edges || [];
    if (nodes.length === 0) throw new Error('Journey has no nodes — add at least one node before starting');

    // 1. Set status to 'active'
    await db.query(
      "UPDATE journey_flows SET status = 'active', updated_at = NOW() WHERE journey_id = $1",
      [journeyId]
    );

    // 2. Enroll segment customers
    let enrolled = 0;
    try {
      const result = await this.enrollSegment(journeyId);
      enrolled = result.enrolled;
    } catch (err) {
      // If no segment, just activate without enrollment
      console.log(`[Journey ${journeyId}] No segment to enroll: ${err.message}`);
    }

    // 3. Set next_fire_at for all new entries based on the first actionable node
    // If scheduled_start_at is set and in the future, use it as the base time
    const firstNode = this._findFirstActionableNode(nodes, edges);
    if (firstNode && enrolled > 0) {
      const baseTime = journey.scheduled_start_at && new Date(journey.scheduled_start_at) > new Date()
        ? new Date(journey.scheduled_start_at)
        : new Date();
      const nextFireAt = this.calculateNextFireAt(firstNode, baseTime);
      await db.query(`
        UPDATE journey_entries
        SET next_fire_at = $1
        WHERE journey_id = $2 AND status = 'active' AND next_fire_at IS NULL
      `, [nextFireAt, journeyId]);
      console.log(`[Journey ${journeyId}] Set next_fire_at=${nextFireAt.toISOString()} for ${enrolled} entries (node: ${firstNode.id})`);
    }

    // 4. Run first process immediately (in case next_fire_at <= now)
    let processResult = { processed: 0, enqueued: 0, converted: 0 };
    try {
      processResult = await this.processJourney(journeyId);
    } catch (err) {
      console.error(`[Journey ${journeyId}] First process error: ${err.message}`);
    }

    return { started: true, enrolled, ...processResult };
  }

  /**
   * Toggle pause/resume for a journey.
   */
  static async pauseJourney(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT status FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const newStatus = journey.status === 'paused' ? 'active' : 'paused';
    await db.query(
      'UPDATE journey_flows SET status = $1, updated_at = NOW() WHERE journey_id = $2',
      [newStatus, journeyId]
    );
    return { status: newStatus };
  }

  /**
   * Process all due entries across ALL active journeys.
   * Called by the cron every 15 min. Scalable — only processes entries whose
   * next_fire_at <= NOW().
   */
  static async processDueEntries() {
    const { rows: dueEntries } = await db.query(`
      SELECT je.entry_id, je.journey_id, je.customer_id, je.current_node_id,
             je.entered_at, je.track, je.last_run_id,
             uc.booking_status, uc.name, uc.email, uc.mobile AS phone, uc.is_indian,
             uc.segment_label AS current_segment,
             jf.nodes, jf.edges, jf.segment_id, jf.exit_on_conversion,
             sd.segment_name AS journey_segment
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      JOIN unified_contacts uc ON uc.id = je.customer_id
      LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
      WHERE je.status = 'active'
        AND je.next_fire_at IS NOT NULL
        AND je.next_fire_at <= NOW()
        AND jf.status = 'active'
      ORDER BY je.next_fire_at
      LIMIT 500
    `);

    if (dueEntries.length === 0) return { processed: 0, sent: 0, converted: 0, completed: 0 };

    let processed = 0, sent = 0, converted = 0, completed = 0;

    for (const entry of dueEntries) {
      try {
        // 1. Check conversion — exit if booking_status changed (skip for awareness journeys)
        if (entry.exit_on_conversion !== false) {
          const conv = await this.checkConversion(entry);
          if (conv.converted) {
            await db.query(`
              UPDATE journey_entries
              SET status = 'converted', converted_at = NOW(), exit_reason = $2,
                  next_fire_at = NULL, last_conversion_check = NOW()
              WHERE entry_id = $1
            `, [entry.entry_id, conv.reason]);
            await db.query(`
              INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
              VALUES ($1, $2, 'converted', NULL, $3)
            `, [entry.entry_id, entry.current_node_id, JSON.stringify(conv)]);
            console.log(`[DueEntries] Converted entry ${entry.entry_id} (uid=${entry.customer_id}) → ${conv.reason}`);
            converted++;
            processed++;
            continue;
          }
        }

        // 2. Process the current node — delegate to processJourney for this journey
        // processJourney handles all node types (action/wait/condition/goal)
        // and the sendHour gate. After processing, it advances the entry.
        // We just need to make sure the journey gets processed.
        // Group by journey and process once per journey.
        processed++;
        sent++;
      } catch (err) {
        console.error(`[DueEntries] Error processing entry ${entry.entry_id}: ${err.message}`);
      }
    }

    // Process unique journeys that have due entries
    const uniqueJourneyIds = [...new Set(dueEntries.map(e => e.journey_id))];
    for (const journeyId of uniqueJourneyIds) {
      try {
        const result = await this.processJourney(journeyId);
        console.log(`[DueEntries] Journey ${journeyId}: processed=${result.processed}, enqueued=${result.enqueued}, converted=${result.converted}`);
      } catch (err) {
        console.error(`[DueEntries] Journey ${journeyId} process error: ${err.message}`);
      }
    }

    // After processing, update next_fire_at for entries that advanced to new nodes
    await this._updateNextFireAtForAdvancedEntries();

    return { processed, sent: uniqueJourneyIds.length, converted, completed };
  }

  /**
   * After processJourney advances entries, recalculate next_fire_at for entries
   * that moved to a new node but still have the old (expired) next_fire_at.
   */
  static async _updateNextFireAtForAdvancedEntries() {
    // Find active entries whose next_fire_at is in the past (already fired)
    const { rows: staleEntries } = await db.query(`
      SELECT je.entry_id, je.current_node_id, je.journey_id, jf.nodes
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      WHERE je.status = 'active'
        AND jf.status = 'active'
        AND (je.next_fire_at IS NULL OR je.next_fire_at <= NOW())
    `);

    for (const entry of staleEntries) {
      const nodes = entry.nodes || [];
      const currentNode = nodes.find(n => n.id === entry.current_node_id);
      if (!currentNode) continue;

      const nextFireAt = this.calculateNextFireAt(currentNode, new Date());
      if (nextFireAt) {
        await db.query(
          'UPDATE journey_entries SET next_fire_at = $1 WHERE entry_id = $2',
          [nextFireAt, entry.entry_id]
        );
      }
    }
  }
}

export default JourneyService;
