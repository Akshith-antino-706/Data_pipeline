import { Router } from 'express';
import db from '../config/database.js';
import JourneyService from '../services/JourneyService.js';
import ConversionDetector from '../services/ConversionDetector.js';
import { queueCounts } from '../services/queue/index.js';
import { cached, del as cacheDel } from '../config/cache.js';
const router = Router();

// ── Journey-detail cache (Phase 0) ──
// GET /:id and /:id/timeline run heavy aggregations over millions of
// journey_entries / journey_events rows. The dashboard polls them every ~30s
// (often from several tabs at once), so we cache the computed result briefly
// and invalidate on any successful mutation to /:id*.
const JOURNEY_DETAIL_TTL = 30; // seconds
const detailKey   = id => `journey:detail:${id}`;
const timelineKey = id => `journey:timeline:${id}`;
function invalidateJourney(id) {
  return cacheDel(detailKey(id), timelineKey(id)).catch(() => {});
}

// Invalidate the cached detail/timeline after any successful write to /:id*
router.use('/:id', (req, _res, next) => {
  if (req.method === 'GET') return next();
  const id = parseInt(req.params.id);
  if (!Number.isNaN(id)) {
    _res.on('finish', () => {
      if (_res.statusCode < 400) invalidateJourney(id);
    });
  }
  next();
});

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

// Journey Operations Dashboard — aggregate for /journeys/dashboard
// (MUST be declared before '/:id' so 'dashboard' isn't parsed as a journey id)
router.get('/dashboard', async (req, res, next) => {
  try {
    // Cache 30 min: getOpsDashboard fires several heavy email_send_log scans; without this
    // the page recomputes them live on EVERY load (slow). 30 min keeps the ops view fresh
    // enough while collapsing repeat loads to an instant cache hit. Bypass with ?fresh=1.
    const data = req.query.fresh
      ? await JourneyService.getOpsDashboard()
      : await cached('journey:ops-dashboard', () => JourneyService.getOpsDashboard(), 1800);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ── Analytics tab — reads the precomputed journey_node_stats rollup (NEVER scans
//    email_send_log live). Populated by the 30-min cron (JourneyStatsService). Fast &
//    isolated: a plain SELECT on a small table, independent of journey size.
//    Declared before '/:id' so these static prefixes aren't parsed as a journey id.

// Per-journey summary rows (the '__ALL__' rollup row of each journey) + freshness meta.
router.get('/analytics/table', async (req, res, next) => {
  try {
    const params = [];
    let where = `s.node_id = '__ALL__'`;
    if (req.query.status) { params.push(req.query.status); where += ` AND s.journey_status = $${params.length}`; }
    // Join journey_flows for journey_type so the UI can filter fixed vs continuous
    // (continuous = journey_type 'gtm'; everything else is a fixed/scheduled journey).
    const { rows } = await db.query(
      `SELECT s.*, COALESCE(jf.journey_type, 'normal') AS journey_type
       FROM journey_node_stats s
       LEFT JOIN journey_flows jf ON jf.journey_id = s.journey_id
       WHERE ${where} ORDER BY s.entries DESC, s.journey_id DESC`, params
    );
    const { rows: [meta] } = await db.query(
      `SELECT last_run_at, last_run_ms, journeys_run FROM journey_stats_meta WHERE id = true`
    );
    res.json({ success: true, data: { journeys: rows, meta: meta || null } });
  } catch (err) { next(err); }
});

// Node-level rows for one journey. Default = cumulative rollup rows. With ?date=YYYY-MM-DD,
// returns per-node metrics scoped to that Dubai date (all columns, computed on demand, cached
// 5 min) — only nodes that actually sent that day.
router.get('/analytics/:id/nodes', async (req, res, next) => {
  try {
    const jid = parseInt(req.params.id);
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) {
      const { computeNodesForDate } = await import('../services/JourneyStatsService.js');
      const data = req.query.fresh
        ? await computeNodesForDate(jid, req.query.date)
        : await cached(`journey:analytics-nodes:${jid}:${req.query.date}`, () => computeNodesForDate(jid, req.query.date), 300);
      return res.json({ success: true, data });
    }
    const { rows } = await db.query(
      `SELECT * FROM journey_node_stats WHERE journey_id = $1 ORDER BY (node_id = '__ALL__') DESC, node_id`,
      [jid]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// On-demand recompute of a single journey (the "Refresh" button). Recomputes live and
// upserts into the rollup; a few seconds for big journeys — used sparingly, not on load.
router.post('/analytics/:id/refresh', async (req, res, next) => {
  try {
    const { refreshJourney } = await import('../services/JourneyStatsService.js');
    const r = await refreshJourney(parseInt(req.params.id));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
});

// Journeys active on a single date — filtered list + relevant nodes inline
// (?date=YYYY-MM-DD, defaults to today). Powers the date-filtered dashboard accordion.
router.get('/active-on-date', async (req, res, next) => {
  try {
    // Cache 60s per date: this aggregates today's email_send_log + 4.9M active journey_entries
    // (~12-44s under load) and the dashboard POLLS it every ~30s. Without a cache, every poll
    // re-runs the heavy scan, and under send-load it exceeds the 60s proxy → nginx returns an
    // HTML 504 → the UI throws "Unexpected token '<'". A short cache keeps it fresh enough for
    // an ops view while collapsing repeat polls. Bypass with ?fresh=1.
    // Resolve the Dubai date for the cache key so 'today' doesn't go stale across midnight.
    const dubaiToday = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : dubaiToday;
    const data = req.query.fresh
      ? await JourneyService.getJourneysActiveOnDate(req.query.date)
      : await cached(`journey:active-on-date:${date}`, () => JourneyService.getJourneysActiveOnDate(req.query.date), 60);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// Per-node breakdown for the dashboard accordion (optional ?date=YYYY-MM-DD)
router.get('/:id/node-breakdown', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyNodeBreakdown(parseInt(req.params.id), req.query.date);
    if (!data) return res.status(404).json({ success: false, error: 'Journey not found' });
    res.json({ success: true, data });
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
      `SELECT je.entry_id, je.customer_id, uc.email, uc.name
         FROM journey_entries je
         JOIN unified_contacts uc ON uc.id = je.customer_id
        WHERE je.journey_id = $1 AND uc.email IS NOT NULL
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

// Get journey detail (cached ~30s; invalidated on mutation)
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const data = await cached(detailKey(id), () => JourneyService.getById(id), JOURNEY_DETAIL_TTL);
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

// Manually (re)generate today's daily AI master templates — all 7 via Claude.
// Useful to run on-demand instead of waiting for the 3 AM cron.
router.post('/generate-daily-templates', async (_req, res) => {
  try {
    const { generateDailyAITemplates } = await import('../services/JourneyService.js');
    const results = await generateDailyAITemplates();
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dynamic email preview — renders the EXACT email sent to contacts, with live
// Claude ranking (same renderDayHtml the workers use). Slow (~15-26s on cache miss).
router.get('/:id/nodes/:nodeId/preview-dynamic', async (req, res) => {
  try {
    const journeyId = parseInt(req.params.id);
    const nodeId    = req.params.nodeId;
    const db = (await import('../config/database.js')).default;

    const { rows: [jf] } = await db.query('SELECT nodes FROM journey_flows WHERE journey_id = $1', [journeyId]);
    if (!jf) return res.status(404).json({ success: false, error: 'Journey not found' });
    const node = (jf.nodes || []).find(n => n.id === nodeId);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });

    const templateId = node.data?.templateId || node.data?.emailTemplateId;
    if (!templateId) return res.status(400).json({ success: false, error: 'Node has no email template' });

    // Use a real enrolled contact so personalization/tracking renders realistically
    const { rows: [entry] } = await db.query(
      `SELECT je.customer_id FROM journey_entries je
       JOIN unified_contacts uc ON uc.id = je.customer_id
       WHERE je.journey_id = $1 AND uc.email IS NOT NULL LIMIT 1`,
      [journeyId]
    );
    const contactId = entry?.customer_id || 'preview';

    // Same stored email the worker sends — guarantees preview == sent (byte-identical)
    const { getOrGenerateNodeEmail } = await import('../services/JourneyService.js');
    const rendered = await getOrGenerateNodeEmail({ journeyId, nodeId, templateId: parseInt(templateId), contactId });
    if (!rendered?.html) {
      return res.status(500).json({ success: false, error: `Template ${templateId} is not a dynamic Day template (1-7)` });
    }
    res.json({ success: true, data: { html: rendered.html, subject: rendered.subject, templateId: parseInt(templateId), rankingSource: rendered.source } });
  } catch (err) {
    console.error('[preview-dynamic] failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
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
    // manual=true clears scheduled_start_at so the auto-start cron won't double-fire
    const data = await JourneyService.startJourney(journeyId, { manual: true });
    res.json({ data });
    // Advance trigger node + fire first action node in background (2 passes needed)
    // Not awaited — API responds immediately, processing happens async
    JourneyService.processJourney(journeyId)
      .then(() => JourneyService.processJourney(journeyId))
      .then(r => console.log(`[Journey ${journeyId}] Background start: processed=${r.processed} enqueued=${r.enqueued}`))
      .catch(err => console.error(`[Journey ${journeyId}] Background start error: ${err.message}`));
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

// Per-node predicted trigger timeline (cached ~30s; invalidated on mutation)
router.get('/:id/timeline', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const data = await cached(timelineKey(id), () => JourneyService.getJourneyTimeline(id), JOURNEY_DETAIL_TTL);
    res.json({ data });
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

// Per-node booking conversion stats: openers who booked within the node's send window
router.get('/:id/node-conversions', async (req, res, next) => {
  try {
    const journeyId = parseInt(req.params.id);

    // Cache 30 min: this scans all 6 rayna booking tables + joins every opener (~9s on J332,
    // and it grows with the data). It's a slow-moving analytics stat, so a cache keeps the
    // detail screen snappy without a live recompute each open. Bypass with ?fresh=1.
    const compute = async () => {
    const { rows } = await db.query(`
      WITH node_windows AS (
        SELECT
          node_id,
          MIN(created_at)::date AS node_start,
          LEAD(MIN(created_at)::date) OVER (ORDER BY MIN(created_at)) AS node_end
        FROM email_send_log
        WHERE journey_id = $1
        GROUP BY node_id
      ),
      openers AS (
        SELECT DISTINCT node_id, unified_id
        FROM email_send_log
        WHERE journey_id = $1 AND opened_at IS NOT NULL
      ),
      all_bookings AS (
        SELECT unified_id, TO_DATE(booking_date, 'DD/MM/YYYY') AS bdate FROM rayna_tours    WHERE booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        UNION ALL SELECT unified_id, TO_DATE(booking_date, 'DD/MM/YYYY') FROM rayna_visas    WHERE booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        UNION ALL SELECT unified_id, TO_DATE(booking_date, 'DD/MM/YYYY') FROM rayna_packages WHERE booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        UNION ALL SELECT unified_id, TO_DATE(booking_date, 'DD/MM/YYYY') FROM rayna_flights  WHERE booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        UNION ALL SELECT unified_id, TO_DATE(booking_date, 'DD/MM/YYYY') FROM rayna_hotels   WHERE booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        UNION ALL SELECT unified_id, TO_DATE(booking_date, 'DD/MM/YYYY') FROM rayna_others   WHERE booking_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
      ),
      converted_per_node AS (
        SELECT DISTINCT nw.node_id, o.unified_id
        FROM node_windows nw
        JOIN openers o ON o.node_id = nw.node_id
        JOIN all_bookings b ON b.unified_id = o.unified_id
          AND b.bdate >= nw.node_start
          AND b.bdate < COALESCE(nw.node_end, CURRENT_DATE + 1)
      )
      SELECT
        nw.node_id,
        nw.node_start,
        nw.node_end,
        COUNT(DISTINCT o.unified_id)   AS total_openers,
        COUNT(DISTINCT cpn.unified_id) AS converted
      FROM node_windows nw
      LEFT JOIN openers o   ON o.node_id = nw.node_id
      LEFT JOIN converted_per_node cpn ON cpn.node_id = nw.node_id AND cpn.unified_id = o.unified_id
      GROUP BY nw.node_id, nw.node_start, nw.node_end
      ORDER BY nw.node_start
    `, [journeyId]);

    const out = {};
    for (const row of rows) {
      const openers   = parseInt(row.total_openers) || 0;
      const converted = parseInt(row.converted)     || 0;
      out[row.node_id] = {
        node_start:      row.node_start,
        node_end:        row.node_end,
        total_openers:   openers,
        converted,
        conversion_rate: openers > 0 ? Math.round((converted / openers) * 10000) / 100 : 0,
      };
    }
    return out;
    };

    const data = req.query.fresh
      ? await compute()
      : await cached(`journey:node-conversions:${journeyId}`, compute, 1800);
    res.json({ data });
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
