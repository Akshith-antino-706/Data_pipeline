import { Router } from 'express';
import JourneyService from '../services/JourneyService.js';
import ConversionDetector from '../services/ConversionDetector.js';
import { queueCounts } from '../services/queue/index.js';
const router = Router();

// List journeys (supports ?audience=indian|rest|all)
router.get('/', async (req, res, next) => {
  try {
    const { status, audience, page, limit } = req.query;
    const data = await JourneyService.getAll({ status, audience, page: parseInt(page) || 1, limit: parseInt(limit) || 20 });
    res.json(data);
  } catch (err) { next(err); }
});

// ── Diagnose — test every layer of the email pipeline ──
router.get('/diagnose', async (_req, res, next) => {
  try {
    const db = (await import('../config/database.js')).default;
    const { ChatheadEmailChannel } = await import('../services/channels/ChatheadEmailChannel.js');
    const report = {};

    // 1. DB check
    try {
      await db.query('SELECT 1');
      report.db = { ok: true };
    } catch (err) {
      report.db = { ok: false, error: err.message };
    }

    // 2. Redis / BullMQ check
    try {
      const counts = await queueCounts('email');
      report.redis = { ok: true, queueCounts: counts };
    } catch (err) {
      report.redis = { ok: false, error: err.message };
    }

    // 3. Email override setting
    report.emailOverride = {
      configured: !!process.env.EMAIL_OVERRIDE_TO,
      value: process.env.EMAIL_OVERRIDE_TO || null,
    };

    // 4. Probe the AWS email API with a tiny test send
    const testTo = process.env.EMAIL_OVERRIDE_TO || process.env.SMTP_USER || null;
    if (testTo) {
      try {
        const result = await ChatheadEmailChannel.send({
          to: testTo,
          subject: '[Journey Diagnose] Test send from pipeline',
          html: `<div style="font-family:sans-serif;padding:20px"><h2>Pipeline Test</h2><p>Sent at ${new Date().toISOString()}</p><p>If you see this, ChatheadEmailChannel → AWS API → your inbox is working.</p></div>`,
        });
        report.emailApiTest = { ok: result.success, to: testTo, provider: result.provider, externalId: result.externalId, error: result.error || null, durationMs: result.durationMs };
      } catch (err) {
        report.emailApiTest = { ok: false, to: testTo, error: err.message };
      }
    } else {
      report.emailApiTest = { ok: false, error: 'EMAIL_OVERRIDE_TO not set — no test recipient' };
    }

    // 5. Last 10 journey_events (so you can see what's actually happening)
    try {
      const { rows: events } = await db.query(`
        SELECT je.event_type, je.channel, je.node_id, je.created_at, je.details,
               jent.email, jent.status AS entry_status
          FROM journey_events je
          JOIN journey_entries jent ON jent.entry_id = je.entry_id
         ORDER BY je.created_at DESC LIMIT 10
      `);
      report.recentEvents = events;
    } catch (err) {
      report.recentEvents = { error: err.message };
    }

    // 6. Active journeys + entry counts
    try {
      const { rows: journeys } = await db.query(`
        SELECT jf.journey_id, jf.name, jf.status,
               COUNT(CASE WHEN je.status='active' THEN 1 END) AS active_entries,
               COUNT(CASE WHEN je.status='completed' THEN 1 END) AS completed_entries
          FROM journey_flows jf
          LEFT JOIN journey_entries je ON je.journey_id = jf.journey_id
         GROUP BY jf.journey_id, jf.name, jf.status
         ORDER BY jf.updated_at DESC LIMIT 5
      `);
      report.journeys = journeys;
    } catch (err) {
      report.journeys = { error: err.message };
    }

    const allOk = report.db?.ok && report.redis?.ok && report.emailApiTest?.ok;
    res.json({ ok: allOk, report });
  } catch (err) { next(err); }
});

// BullMQ queue depths — how many jobs are waiting/active across all journey channels
// NOTE: must be defined BEFORE /:id routes, otherwise Express matches "queue-counts" as :id
router.get('/queue-counts', async (_req, res, next) => {
  try {
    const [email, wa, sms] = await Promise.all([
      queueCounts('email').catch(() => null),
      queueCounts('whatsapp').catch(() => null),
      queueCounts('sms').catch(() => null),
    ]);
    res.json({ data: { email, whatsapp: wa, sms } });
  } catch (err) { next(err); }
});

// Test-send: run the full email pipeline for ONE entry and return step-by-step diagnostics
router.post('/:id/nodes/:nodeId/test-send', async (req, res, next) => {
  try {
    const journeyId = parseInt(req.params.id);
    const nodeId    = req.params.nodeId;
    const db = (await import('../config/database.js')).default;
    const steps = [];

    // Step 1: get node config from journey
    const { rows: [jf] } = await db.query('SELECT nodes, edges FROM journey_flows WHERE journey_id = $1', [journeyId]);
    if (!jf) return res.status(404).json({ error: 'Journey not found' });
    const node = (jf.nodes || []).find(n => n.id === nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const channel    = (node.data?.channel || '').toLowerCase();
    const templateId = node.data?.templateId || node.data?.emailTemplateId || null;
    steps.push({ step: 'node_config', ok: !!(channel && templateId), channel, templateId });
    if (!channel || !templateId) return res.json({ ok: false, steps, error: 'Node missing channel or templateId' });

    // Step 2: pick one active entry on this node (or any entry for this journey)
    const { rows: entries } = await db.query(
      `SELECT je.entry_id, je.customer_id, je.email, uc.name
         FROM journey_entries je
         JOIN unified_contacts uc ON uc.id = je.customer_id
        WHERE je.journey_id = $1 AND je.email IS NOT NULL
        LIMIT 1`,
      [journeyId]
    );
    const entry = entries[0];
    steps.push({ step: 'pick_entry', ok: !!entry, entryId: entry?.entry_id, email: entry?.email });
    if (!entry) return res.json({ ok: false, steps, error: 'No entries with email found for this journey' });

    // Step 3: render the template
    const { renderDayHtml } = await import('../services/JourneyService.js');
    let html, subject;
    try {
      const rendered = await renderDayHtml(parseInt(templateId), entry.customer_id);
      if (rendered?.html) {
        html = rendered.html; subject = rendered.subject;
        steps.push({ step: 'render_template', ok: true, method: 'renderDayHtml', subjectPreview: subject, htmlBytes: html.length });
      } else {
        steps.push({ step: 'render_template', ok: false, method: 'renderDayHtml', error: 'returned null — templateId not in Day1-7 range or data build failed' });
      }
    } catch (err) {
      steps.push({ step: 'render_template', ok: false, method: 'renderDayHtml', error: err.message });
    }

    // Fallback: EmailRenderer
    if (!html) {
      try {
        const { default: EmailRenderer } = await import('../services/EmailRenderer.js');
        const { rows: [ct] } = await db.query('SELECT html_template_id FROM content_templates WHERE id = $1', [parseInt(templateId)]);
        const htmlTemplateId = ct?.html_template_id;
        steps.push({ step: 'resolve_html_template', ok: !!htmlTemplateId, htmlTemplateId });
        if (!htmlTemplateId) return res.json({ ok: false, steps, error: 'No html_template_id linked to this content_template — email will be action_blocked in worker' });
        const rendered = await Promise.resolve(EmailRenderer.renderForJourneyNode({ htmlTemplateId, unifiedId: entry.customer_id, journeyId, nodeId }));
        html = rendered.html; subject = rendered.subject;
        steps.push({ step: 'render_fallback', ok: true, method: 'EmailRenderer', subjectPreview: subject, htmlBytes: html?.length });
      } catch (err) {
        steps.push({ step: 'render_fallback', ok: false, error: err.message });
        return res.json({ ok: false, steps, error: 'Template render failed in both paths' });
      }
    }

    // Step 4: send via ChatheadEmailChannel
    const { ChatheadEmailChannel } = await import('../services/channels/ChatheadEmailChannel.js');
    const sendTo = process.env.EMAIL_OVERRIDE_TO || entry.email;
    steps.push({ step: 'email_override', overrideActive: !!process.env.EMAIL_OVERRIDE_TO, sendingTo: sendTo, realRecipient: entry.email });
    try {
      const result = await ChatheadEmailChannel.send({ to: sendTo, subject: subject || 'Rayna Tours', html });
      steps.push({ step: 'chathead_send', ok: result.success, to: sendTo, subject, provider: result.provider, externalId: result.externalId, error: result.error || null, durationMs: result.durationMs, raw: result.raw || null });
      return res.json({ ok: result.success, steps, error: result.success ? null : result.error });
    } catch (err) {
      steps.push({ step: 'chathead_send', ok: false, error: err.message });
      return res.json({ ok: false, steps, error: err.message });
    }
  } catch (err) { next(err); }
});

// Reset next_fire_at for all active entries using speed-up timing (call once after enabling JOURNEY_WAIT_SECS_PER_DAY)
router.post('/:id/reset-fire-times', async (req, res, next) => {
  try {
    const journeyId = parseInt(req.params.id);
    const db = (await import('../config/database.js')).default;
    const { rows: journey } = await db.query('SELECT nodes, edges FROM journey_flows WHERE journey_id = $1', [journeyId]);
    if (!journey[0]) return res.status(404).json({ error: 'Journey not found' });

    const nodes = journey[0].nodes || [];
    const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

    const { rows: entries } = await db.query(
      `SELECT entry_id, current_node_id, last_event_at, entered_at FROM journey_entries WHERE journey_id = $1 AND status = 'active'`,
      [journeyId]
    );

    let updated = 0;
    for (const entry of entries) {
      const node = nodeMap[entry.current_node_id];
      if (!node) continue;
      const from = new Date(entry.last_event_at || entry.entered_at || Date.now());
      const nextFire = JourneyService.calculateNextFireAt(node, from);
      await db.query('UPDATE journey_entries SET next_fire_at = $1 WHERE entry_id = $2', [nextFire, entry.entry_id]);
      updated++;
    }

    res.json({ data: { updated, message: `Reset next_fire_at for ${updated} entries using current speed-up settings` } });
  } catch (err) { next(err); }
});

// Get journey detail
router.get('/:id', async (req, res, next) => {
  try {
    const data = await JourneyService.getById(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Journey not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Create journey
router.post('/', async (req, res, next) => {
  try {
    const data = await JourneyService.create(req.body);
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Update journey
router.put('/:id', async (req, res, next) => {
  try {
    const data = await JourneyService.update(parseInt(req.params.id), req.body);
    res.json({ data });
  } catch (err) { next(err); }
});

// Delete journey
router.delete('/:id', async (req, res, next) => {
  try {
    await JourneyService.delete(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Node-level CRUD (used by the UI editor) ──
router.post('/:id/nodes', async (req, res, next) => {
  try {
    const { node, afterNodeId } = req.body;
    const data = await JourneyService.addNode(parseInt(req.params.id), node, afterNodeId);
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

router.patch('/:id/nodes/:nodeId', async (req, res, next) => {
  try {
    const data = await JourneyService.updateNode(parseInt(req.params.id), req.params.nodeId, req.body);
    res.json({ data });
  } catch (err) { next(err); }
});

router.delete('/:id/nodes/:nodeId', async (req, res, next) => {
  try {
    const data = await JourneyService.deleteNode(parseInt(req.params.id), req.params.nodeId);
    res.json({ data });
  } catch (err) { next(err); }
});

// Get persisted send log for a specific action node (campaign stats)
router.get('/:id/nodes/:nodeId/send-log', async (req, res, next) => {
  try {
    const data = await JourneyService.getNodeSendLog(parseInt(req.params.id), req.params.nodeId);
    res.json({ data });
  } catch (err) { next(err); }
});

// Auto-generate journey from strategy
router.post('/generate-from-strategy/:strategyId', async (req, res, next) => {
  try {
    const data = await JourneyService.generateFromStrategy(parseInt(req.params.strategyId));
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Reset stuck entries (clear last_run_id so they can be re-processed)
router.post('/:id/reset-entries', async (req, res, next) => {
  try {
    const pool = (await import('../config/database.js')).default;
    const nodeId = req.body?.nodeId || req.query?.nodeId;
    if (nodeId) {
      const { rowCount } = await pool.query(
        `UPDATE journey_entries SET current_node_id = $2, last_run_id = NULL, last_enqueued_at = NULL WHERE journey_id = $1 AND status = 'active'`,
        [parseInt(req.params.id), nodeId]
      );
      return res.json({ data: { reset: rowCount, movedTo: nodeId } });
    }
    const { rowCount } = await pool.query(
      `UPDATE journey_entries SET last_run_id = NULL, last_enqueued_at = NULL WHERE journey_id = $1 AND status = 'active'`,
      [parseInt(req.params.id)]
    );
    res.json({ data: { reset: rowCount } });
  } catch (err) { next(err); }
});

// Start journey: activate + enroll + first process
router.post('/:id/start', async (req, res, next) => {
  try {
    const journeyId = parseInt(req.params.id);
    const data = await JourneyService.startJourney(journeyId);
    res.json({ data });
    // Fire first node immediately (don't await — respond to client first)
    JourneyService.processJourney(journeyId).then(r => {
      console.log(`[Journey ${journeyId}] Immediate trigger after start: processed=${r.processed}, enqueued=${r.enqueued}`);
    }).catch(err => {
      console.error(`[Journey ${journeyId}] Immediate trigger error: ${err.message}`);
    });
  } catch (err) { next(err); }
});

// Pause or resume journey (toggle)
router.post('/:id/pause', async (req, res, next) => {
  try {
    const data = await JourneyService.pauseJourney(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Enroll segment customers into journey
router.post('/:id/enroll', async (req, res, next) => {
  try {
    const data = await JourneyService.enrollSegment(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Process journey (advance customers through nodes)
router.post('/:id/process', async (req, res, next) => {
  try {
    const data = await JourneyService.processJourney(parseInt(req.params.id), parseInt(req.query.batch) || 100);
    res.json({ data });
  } catch (err) { next(err); }
});

// Get journey entries (real flow data)
router.get('/:id/entries', async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const data = await JourneyService.getEntries(parseInt(req.params.id), { page: parseInt(page) || 1, limit: parseInt(limit) || 50, status });
    res.json(data);
  } catch (err) { next(err); }
});

// Get journey analytics
router.get('/:id/analytics', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyAnalytics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Get campaign analytics inside journey (sent, delivered, read, click, bounce per node)
router.get('/:id/campaign-analytics', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyCampaignAnalytics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// GTM event breakdown per node for this journey
// Every action node gets the full event-type list (0 count if no data for that node).
// Returns { allEventTypes: [...], data: { nodeId: { sent, events: [...] } } }
router.get('/:id/gtm-node-stats', async (req, res, next) => {
  try {
    const journeyId = parseInt(req.params.id);
    const db = (await import('../config/database.js')).default;

    const [{ rows: gtmRows }, { rows: sentRows }, { rows: allTypeRows }] = await Promise.all([
      // Per-node counts (only rows that exist)
      db.query(`
        SELECT
          node_id,
          event_name,
          COUNT(*)                   AS event_count,
          COUNT(DISTINCT unified_id) AS unique_users,
          SUM(event_value)           AS total_value
        FROM gtm_events
        WHERE journey_id = $1 AND node_id IS NOT NULL
        GROUP BY node_id, event_name
        ORDER BY node_id, event_count DESC
      `, [journeyId]),

      // Sent counts per node from email_send_log
      db.query(`
        SELECT node_id, COUNT(*) AS sent_count
        FROM email_send_log
        WHERE journey_id = $1
          AND node_id IS NOT NULL
          AND status NOT IN ('failed', 'queued')
        GROUP BY node_id
      `, [journeyId]),

      // All distinct event types for this journey (used to fill zeros on nodes with no data)
      db.query(`
        SELECT DISTINCT event_name,
          SUM(event_count) OVER (PARTITION BY event_name) AS journey_total
        FROM (
          SELECT event_name, COUNT(*) AS event_count
          FROM gtm_events
          WHERE journey_id = $1
          GROUP BY event_name
        ) sub
        ORDER BY journey_total DESC
      `, [journeyId]),
    ]);

    // All event types ordered by journey-wide total
    const allEventTypes = allTypeRows.map(r => r.event_name);

    // Build per-node lookup: { nodeId: { eventName: { count, users, value } } }
    const nodeEventLookup = {};
    for (const r of gtmRows) {
      if (!nodeEventLookup[r.node_id]) nodeEventLookup[r.node_id] = {};
      nodeEventLookup[r.node_id][r.event_name] = {
        event_count:  parseInt(r.event_count)  || 0,
        unique_users: parseInt(r.unique_users) || 0,
        total_value:  parseFloat(r.total_value) || 0,
      };
    }

    // Build per-node sent map
    const sentByNode = {};
    for (const r of sentRows) sentByNode[r.node_id] = parseInt(r.sent_count) || 0;

    // Collect all node_ids that appear in either gtmRows or sentRows
    const nodeIds = [...new Set([
      ...gtmRows.map(r => r.node_id),
      ...sentRows.map(r => r.node_id),
    ])];

    // For each node, produce the full event list (with zeros for missing types)
    const byNode = {};
    for (const nodeId of nodeIds) {
      const lookup = nodeEventLookup[nodeId] || {};
      byNode[nodeId] = {
        sent: sentByNode[nodeId] || 0,
        events: allEventTypes.map(name => ({
          event_name:   name,
          event_count:  lookup[name]?.event_count  || 0,
          unique_users: lookup[name]?.unique_users  || 0,
          total_value:  lookup[name]?.total_value   || 0,
        })),
      };
    }

    res.json({ allEventTypes, data: byNode });
  } catch (err) { next(err); }
});

// Check conversions (BigQuery purchase + offline booking) and stop converted enrollments
router.post('/:id/check-conversions', async (req, res, next) => {
  try {
    const data = await JourneyService.checkConversions(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Get enrollment status for a journey
router.get('/:id/enrollments', async (req, res, next) => {
  try {
    const data = await JourneyService.getEnrollments(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Run conversion detection + auto-enrollment across all journeys
router.post('/detect-conversions', async (_req, res, next) => {
  try {
    const data = await ConversionDetector.runAll();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// Process all active journeys at once
router.post('/process-all', async (_req, res, next) => {
  try {
    const { rows: journeys } = await (await import('../config/database.js')).default.query(
      "SELECT journey_id FROM journey_flows WHERE status = 'active'"
    );
    const results = [];
    for (const j of journeys) {
      const r = await JourneyService.processJourney(j.journey_id);
      results.push({ journey_id: j.journey_id, ...r });
    }
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

// Retry blocked entries — move back to action node and re-activate journey
router.post('/:id/nodes/:nodeId/retry-blocked', async (req, res, next) => {
  try {
    const journeyId = parseInt(req.params.id);
    const nodeId = req.params.nodeId;
    const db = (await import('../config/database.js')).default;

    const { rows: blocked } = await db.query(`
      SELECT DISTINCT je.entry_id
      FROM journey_events jev
      JOIN journey_entries je ON je.entry_id = jev.entry_id
      WHERE je.journey_id = $1 AND jev.node_id = $2 AND jev.event_type = 'action_blocked'
    `, [journeyId, nodeId]);

    if (blocked.length === 0) return res.json({ data: { retried: 0 } });

    const ids = blocked.map(r => r.entry_id);
    const { rowCount } = await db.query(`
      UPDATE journey_entries
      SET current_node_id = $1, status = 'active', last_run_id = NULL, last_enqueued_at = NULL, completed_at = NULL
      WHERE entry_id = ANY($2::bigint[])
    `, [nodeId, ids]);

    await db.query(`
      UPDATE journey_flows SET status = 'active', updated_at = NOW()
      WHERE journey_id = $1 AND status = 'completed'
    `, [journeyId]);

    res.json({ data: { retried: rowCount } });
  } catch (err) { next(err); }
});

export default router;
