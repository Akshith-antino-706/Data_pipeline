/**
 * /api/v3/test-sends — internal QA endpoint to send any of the 7 day templates
 * to user-selected emails (searched from unified_contacts) without going
 * through journeys.
 *
 * Behaviour:
 *   - Frontend provides `emails` array in request body — these are the
 *     recipients. No hardcoded segment needed.
 *   - GET /search-contacts?q=... lets the UI search unified_contacts.
 *   - Runs the appropriate ranking once, then fans out per-recipient render+send.
 *   - Returns per-recipient MessageId so the UI can show the result.
 *
 * Endpoints:
 *   GET  /api/v3/test-sends/search-contacts?q=...  — search contacts by email/name
 *   POST /api/v3/test-sends/day1  ..  day7         — body: { emails: [...] }
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import db from '../config/database.js';
import { SendTrackService } from '../services/SendTrackService.js';
import { injectClickTracking, injectOpenPixel } from '../utils/emailTracking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..', '..');

const router = express.Router();

const TEMPLATE_DIR = path.join(ROOT, 'mail_templates');

// ── Concurrency-limited parallel send ─────────────────────────────────────
const BATCH_CONCURRENCY = 20; // send 20 emails at a time in parallel

/**
 * Process an array of items with a concurrency limit.
 * `fn(item, index)` should return a result object.
 */
async function parallelMap(items, fn, concurrency = BATCH_CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try { results[i] = await fn(items[i], i); }
      catch (err) { results[i] = { email: items[i]?.email, success: false, error: err.message }; }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// Large-batch tracking — stores results for async sends
const batchJobs = new Map(); // jobId → { status, total, sent, failed, results, startedAt }

// ── shared helpers ────────────────────────────────────────────────────────

/**
 * Resolve recipients from an `emails` array in the request body.
 * Looks up each email in unified_contacts to get the unified_id.
 */
async function resolveRecipients(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error('emails[] is required — select at least one recipient');
  }
  const cleaned = [...new Set(emails.map(e => String(e).toLowerCase().trim()).filter(Boolean))];
  if (cleaned.length === 0) throw new Error('No valid emails provided');

  const { rows } = await db.query(`
    SELECT DISTINCT ON (LOWER(email)) id AS unified_id, LOWER(email) AS email
      FROM unified_contacts
     WHERE LOWER(email) = ANY($1)
       AND email IS NOT NULL AND email <> ''
     ORDER BY LOWER(email), id
  `, [cleaned]);

  // Warn about emails not found in DB (but don't hard-fail — just skip them)
  const found = new Set(rows.map(r => r.email));
  const missing = cleaned.filter(e => !found.has(e));
  if (missing.length > 0) {
    console.warn(`[test-sends] emails not in unified_contacts: ${missing.join(', ')}`);
  }

  return rows;
}

async function loadEmailChannel() {
  const { ChatheadEmailChannel } = await import('../services/channels/ChatheadEmailChannel.js');
  if (ChatheadEmailChannel.isConfigured()) return ChatheadEmailChannel;
  const { EmailChannel } = await import('../services/channels/EmailChannel.js');
  return EmailChannel;
}

// Cache ranking results per day — 1800s (30 min) covers full 7-day sequence (7×2min=14min + buffer)
async function cachedRanking(key, computeFn) {
  const { cached } = await import('../config/cache.js');
  return cached(`test-send:ranking:${key}`, computeFn, 1800);
}

function leftoversCheck(html) {
  const v = [...html.matchAll(/\{\{[\w.]+\}\}/g)];
  const b = [...html.matchAll(/\{\{[#/](list|if)/g)];
  return v.length === 0 && b.length === 0;
}

/**
 * Like sendOne but persists every attempt to email_send_log and injects an
 * open-tracking pixel so we know when the recipient actually reads the email.
 */

async function sendAndLog({ EmailChannel, recipient, subject, html, templateLabel, dayNumber, source = 'test-send', journeyId, nodeId }) {
  const baseUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;

  const logId = await SendTrackService.logSend({
    unifiedId:     recipient.unified_id,
    email:         recipient.email,
    subject,
    templateLabel,
    dayNumber,
    source,
    journeyId:     journeyId || null,
    nodeId:        nodeId || null,
  });
  console.log(`[SendQueue] QUEUED  Day${dayNumber} → ${recipient.email} (log#${logId})`);

  // 1. Inject UTM params + click-tracking redirect into every link
  const campaignSlug = `day${dayNumber}_${templateLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const contentSlug  = `test_send_day${dayNumber}`;
  const utmHtml = injectClickTracking(html, {
    logId, baseUrl, campaign: campaignSlug, content: contentSlug, unifiedId: recipient.unified_id, journeyId, nodeId,
  });

  // 2. Inject open-tracking pixel
  const trackedHtml = injectOpenPixel(utmHtml, logId, baseUrl);

  const start = Date.now();
  let result;
  try {
    result = await EmailChannel.send({ to: recipient.email, subject, html: trackedHtml });
  } catch (err) {
    result = { success: false, error: err.message || String(err), provider: null };
  }
  const ms = Date.now() - start;

  // Fire-and-forget — don't block the API response on the status update
  if (result?.success) {
    console.log(`[SendQueue] SENT    Day${dayNumber} → ${recipient.email} (log#${logId}, ${ms}ms, provider:${result.provider || '?'})`);
    SendTrackService.markSent(logId, { externalId: result.externalId || null, provider: result.provider || null, durationMs: ms }).catch(() => {});
  } else {
    console.log(`[SendQueue] FAILED  Day${dayNumber} → ${recipient.email} (log#${logId}) — ${result?.error || result?.reason || 'unknown'}`);
    SendTrackService.markFailed(logId, { error: result?.error || result?.reason || 'unknown', provider: result?.provider || null, durationMs: ms }).catch(() => {});
  }

  return {
    email:      recipient.email,
    unifiedId:  recipient.unified_id,
    sendLogId:  logId,
    success:    !!result?.success,
    externalId: result?.externalId || null,
    error:      result?.error || result?.reason || null,
    ms,
  };
}

// ── contact list (paginated, optional filter) ────────────────────────────

// ── Filter options — distinct values for all filterable columns ──────────
router.get('/contacts/filter-options', async (req, res, next) => {
  try {
    const [bs, ct, geo, pt, countries, segments, customSegs] = await Promise.all([
      db.query(`SELECT DISTINCT booking_status AS val FROM unified_contacts WHERE booking_status IS NOT NULL ORDER BY 1`),
      db.query(`SELECT DISTINCT contact_type AS val FROM unified_contacts WHERE contact_type IS NOT NULL ORDER BY 1`),
      db.query(`SELECT DISTINCT geography AS val FROM unified_contacts WHERE geography IS NOT NULL ORDER BY 1`),
      db.query(`SELECT DISTINCT product_tier AS val FROM unified_contacts WHERE product_tier IS NOT NULL ORDER BY 1`),
      db.query(`SELECT country AS val, COUNT(*)::int AS cnt FROM unified_contacts WHERE country IS NOT NULL AND country <> '' GROUP BY country ORDER BY cnt DESC LIMIT 50`),
      db.query(`SELECT segment_id AS id, segment_name AS name FROM segment_definitions ORDER BY segment_number`),
      db.query(`SELECT id, name FROM custom_segments WHERE status = 'active' ORDER BY id`),
    ]);
    res.json({
      data: {
        booking_status: bs.rows.map(r => r.val),
        contact_type: ct.rows.map(r => r.val),
        geography: geo.rows.map(r => r.val),
        product_tier: pt.rows.map(r => r.val),
        countries: countries.rows,
        segments: segments.rows,
        custom_segments: customSegs.rows,
      }
    });
  } catch (err) { next(err); }
});

router.get('/contacts', async (req, res, next) => {
  try {
    const q      = String(req.query.q || '').trim();
    const limit  = Math.min(500, parseInt(req.query.limit  || '50'));
    const offset = Math.max(0,   parseInt(req.query.offset || '0'));
    const hasQ   = q.length >= 2;

    // Build filter conditions
    const conditions = ["uc.email IS NOT NULL AND uc.email <> ''"];
    const params = [];

    if (hasQ) {
      params.push(`%${q.toLowerCase()}%`);
      conditions.push(`(lower(uc.email) LIKE $${params.length} OR lower(uc.name) LIKE $${params.length})`);
    }
    if (req.query.booking_status) {
      params.push(req.query.booking_status);
      conditions.push(`uc.booking_status = $${params.length}`);
    }
    if (req.query.contact_type) {
      params.push(req.query.contact_type);
      conditions.push(`uc.contact_type = $${params.length}`);
    }
    if (req.query.country) {
      params.push(req.query.country);
      conditions.push(`uc.country = $${params.length}`);
    }
    if (req.query.geography) {
      params.push(req.query.geography);
      conditions.push(`uc.geography = $${params.length}`);
    }
    if (req.query.product_tier) {
      params.push(req.query.product_tier);
      conditions.push(`uc.product_tier = $${params.length}`);
    }
    if (req.query.is_indian !== undefined && req.query.is_indian !== '') {
      params.push(req.query.is_indian === 'true');
      conditions.push(`uc.is_indian = $${params.length}`);
    }
    // Segment filter — join segment_customers
    let segmentJoin = '';
    if (req.query.segment_id) {
      params.push(parseInt(req.query.segment_id));
      segmentJoin = `JOIN segment_customers sc ON sc.customer_id = uc.id AND sc.segment_id = $${params.length} AND sc.is_active = true`;
    }
    // Custom segment filter
    if (req.query.custom_segment_id) {
      params.push(parseInt(req.query.custom_segment_id));
      segmentJoin = `JOIN custom_segment_contacts csc ON csc.unified_id = uc.id AND csc.segment_id = $${params.length}`;
    }

    const where = conditions.join(' AND ');
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(
        `SELECT DISTINCT ON (uc.email) uc.id, uc.email, uc.name, uc.contact_type, uc.booking_status, uc.country, uc.is_indian
         FROM unified_contacts uc ${segmentJoin}
         WHERE ${where}
         ORDER BY uc.email LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(DISTINCT uc.email)::int AS total FROM unified_contacts uc ${segmentJoin} WHERE ${where}`,
        params
      ),
    ]);
    res.json({ data: { contacts: rows, total: cnt.total, limit, offset } });
  } catch (err) { next(err); }
});

// ── contact search ───────────────────────────────────────────────────────

// POST /send-daily-ai — send the EXACT AI daily-master template (the one shown in
// "Preview AI") to recipients. Guarantees Test Send == Preview AI == journey send.
// Body: { templateId, emails }
router.post('/send-daily-ai', async (req, res) => {
  try {
    const templateId = parseInt(req.body?.templateId);
    if (!templateId) return res.status(400).json({ success: false, error: 'templateId required' });
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ success: false, error: 'No valid recipients found' });

    // The AI daily master — same HTML as Preview AI and journey sends
    const { getDailyAITemplate } = await import('../services/JourneyService.js');
    const master = await getDailyAITemplate(templateId);
    if (!master?.html) return res.status(400).json({ success: false, error: `Template ${templateId} is not a dynamic Day template (1-7)` });

    const EmailChannel = await loadEmailChannel();
    const subject = master.subject || `Day ${templateId} | Rayna Tours`;
    const label = `Day ${templateId} (AI)`;

    const sendOne = (r) => sendAndLog({
      EmailChannel, recipient: r, subject, html: master.html,
      templateLabel: label, dayNumber: templateId, source: req.body?.source || 'test-send',
    });

    const results = await parallelMap(recipients, sendOne);
    const sent = results.filter(r => r.success).length;
    res.json({ success: true, data: { day: templateId, recipients: recipients.length, sent, source: master.source, results } });
  } catch (err) {
    console.error('[send-daily-ai] failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /analyze-email — QA report for a Day template's rendered email.
// Body: { templateId } (1-7). Returns grammar / missing content / URL checks /
// spam-risk / other errors. Used by the Content screen after a Test Send.
router.post('/analyze-email', async (req, res) => {
  try {
    const templateId = parseInt(req.body?.templateId);
    if (!templateId) return res.status(400).json({ success: false, error: 'templateId required' });

    // Use the same daily-master HTML that gets sent (so the report matches the email)
    const { getDailyAITemplate } = await import('../services/JourneyService.js');
    const rendered = await getDailyAITemplate(templateId);
    if (!rendered?.html) return res.status(400).json({ success: false, error: `Template ${templateId} is not a dynamic Day template (1-7)` });

    const { analyzeEmail } = await import('../services/EmailQAService.js');
    const report = await analyzeEmail({ html: rendered.html, subject: rendered.subject });

    // Store the report (one per template — latest wins)
    await db.query(
      `INSERT INTO email_qa_reports (template_id, report, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (template_id) DO UPDATE SET report = $2, placement = NULL, updated_at = NOW()`,
      [templateId, JSON.stringify(report)]
    );

    res.json({ success: true, data: report });
  } catch (err) {
    console.error('[analyze-email] failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /qa-report/:templateId — fetch the stored QA report (for the (i) button)
router.get('/qa-report/:templateId', async (req, res) => {
  try {
    const { rows: [row] } = await db.query(
      'SELECT report, placement, updated_at FROM email_qa_reports WHERE template_id = $1',
      [parseInt(req.params.templateId)]
    );
    if (!row) return res.json({ success: true, data: null });
    res.json({ success: true, data: { ...row.report, placement: row.placement, generatedAt: row.updated_at } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /check-placement — real inbox placement (Inbox/Spam) of a sent email,
// read via IMAP on the seed inbox. Body: { subject }.
router.post('/check-placement', async (req, res) => {
  try {
    const subject = req.body?.subject || '';
    const templateId = req.body?.templateId ? parseInt(req.body.templateId) : null;
    const { checkInboxPlacement } = await import('../services/EmailQAService.js');
    const result = await checkInboxPlacement({ subject, sinceMinutes: 120 });
    // Persist placement onto the stored report so the (i) button shows it too
    if (templateId) {
      await db.query(
        `UPDATE email_qa_reports SET placement = $2, updated_at = NOW() WHERE template_id = $1`,
        [templateId, JSON.stringify(result)]
      ).catch(() => {});
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/search-contacts', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ data: [] });

    const prefix    = `${q.toLowerCase()}%`;   // 'rock%'   — uses B-tree index on lower(email)
    const substring = `%${q.toLowerCase()}%`;  // '%rock%'  — seq scan fallback

    // UNION: prefix matches come first (fast, index-friendly),
    // then substring fallback for mid-string / name hits.
    const { rows } = await db.query(`
      (
        SELECT id, email, name, contact_type, 0 AS rank
          FROM unified_contacts
         WHERE email IS NOT NULL AND email <> ''
           AND lower(email) LIKE $1
         LIMIT 20
      )
      UNION ALL
      (
        SELECT id, email, name, contact_type, 1 AS rank
          FROM unified_contacts
         WHERE email IS NOT NULL AND email <> ''
           AND (lower(name) LIKE $2 OR lower(email) LIKE $2)
           AND lower(email) NOT LIKE $1
         LIMIT 20
      )
      ORDER BY rank, email
      LIMIT 20
    `, [prefix, substring]);

    res.json({ data: rows.map(({ rank: _r, ...r }) => r) });
  } catch (err) { next(err); }
});

// ── daily auto-send schedule ──────────────────────────────────────────────

// List all schedules (static routes must come before /:id routes)
router.get('/schedule/list', async (_req, res, next) => {
  try {
    const { listSchedules } = await import('../services/TestSendScheduler.js');
    res.json({ data: await listSchedules() });
  } catch (err) { next(err); }
});

// Create + start a new schedule
router.post('/schedule/start', async (req, res, next) => {
  try {
    const { start } = await import('../services/TestSendScheduler.js');
    const status = await start({
      destinationKey: req.body?.destinationKey || 'singapore',
      loop:           req.body?.loop === true,
      emails:         req.body?.emails || [],
      baseUrl:        `http://localhost:${process.env.PORT || 3001}`,
    });
    res.json({ data: status });
  } catch (err) { next(err); }
});

// Per-schedule operations — :id must come after all static sub-paths
router.post('/schedule/:id/stop', async (req, res, next) => {
  try {
    const { stop } = await import('../services/TestSendScheduler.js');
    res.json({ data: await stop(parseInt(req.params.id)) });
  } catch (err) { next(err); }
});

router.post('/schedule/:id/tick', async (req, res, next) => {
  try {
    const { tick } = await import('../services/TestSendScheduler.js');
    res.json({ data: await tick(parseInt(req.params.id)) });
  } catch (err) { next(err); }
});

router.post('/schedule/:id/remove-email', async (req, res, next) => {
  try {
    const { removeEmail } = await import('../services/TestSendScheduler.js');
    const email = req.body?.email;
    if (!email) return res.status(400).json({ error: 'email is required' });
    res.json({ data: await removeEmail(parseInt(req.params.id), email) });
  } catch (err) { next(err); }
});

// Per-schedule send queue (recent email_send_log entries filtered by time + emails)
router.get('/schedule/:id/queue', async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit || '100'));
    const { rows } = await db.query(`
      SELECT
        esl.id, esl.email, esl.contact_name, esl.day_number, esl.template_label,
        esl.source, esl.status, esl.error_message,
        esl.sent_at, esl.opened_at, esl.clicked_at, esl.duration_ms, esl.created_at
      FROM email_send_log esl
      WHERE esl.source IN ('test-send', 'scheduled-send')
      ORDER BY esl.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Per-schedule logs — all email_send_log entries for this schedule's recipients
// since the schedule started_at (approximate but correct for QA use)
router.get('/schedule/:id/logs', async (req, res, next) => {
  try {
    const scheduleId = parseInt(req.params.id);
    const { rows } = await db.query(`
      SELECT DISTINCT ON (email, day_number)
        id, email, contact_name, day_number, template_label, source,
        status, error_message, sent_at, opened_at, clicked_at, duration_ms, created_at
      FROM email_send_log
      WHERE source = $1
      ORDER BY email, day_number, created_at DESC
      LIMIT 500
    `, [`schedule-${scheduleId}`]);

    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── DAY 1: Welcome ────────────────────────────────────────────────────────

router.post('/day1', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const { rankTrendingWelcome, _internals: rankInternals } = await import('../services/Day1WelcomeRankingService.js');
    const { buildDay1WelcomeData, _internals: dataInternals } = await import('../services/Day1WelcomeDataService.js');
    const { renderDay1Welcome } = await import('../services/Day1WelcomeRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    let ranking;
    if (useClaude) {
      ranking = await cachedRanking('day1', rankTrendingWelcome);
    } else {
      const visaRows = await rankInternals.loadVisaCatalog();
      const visaMap  = Object.fromEntries(visaRows.map(r => [r.key, r]));
      ranking = {
        ranking: rankInternals.buildFallbackRanking({
          holidayMap:  dataInternals.HOLIDAY_DESTINATIONS,
          cruiseMap:   dataInternals.CRUISE_DESTINATIONS,
          activityMap: dataInternals.ACTIVITY_DESTINATIONS,
          visaMap,
        }),
        source: 'fallback',
      };
    }

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day1-welcome-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Your Rayna Tours Journey Starts Here';

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();

    const sendOne = async (r) => {
      const data = await buildDay1WelcomeData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay1Welcome(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 1 - Welcome', source, dayNumber:1, journeyId, nodeId });
    };

    // For large batches (>100), respond immediately and process in background
    if (recipients.length > 100) {
      const jobId = `day1_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 1, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background (20 parallel)` } });
      // Background processing
      parallelMap(recipients, sendOne).then(results => {
        const sent = results.filter(r => r.success).length;
        batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() });
        console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`);
      }).catch(err => {
        batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message });
        console.error(`[Batch:${jobId}] Error:`, err.message);
      });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 1, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── DAY 2: Cruise Spotlight ───────────────────────────────────────────────

router.post('/day2', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const { rankTrendingCruises, _internals: rankInternals } = await import('../services/Day2CruiseRankingService.js');
    const { buildDay2CruiseData } = await import('../services/Day2CruiseDataService.js');
    const { renderDay2Cruise } = await import('../services/Day2CruiseRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    const ranking = useClaude ? await cachedRanking('day2', rankTrendingCruises) : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day2-cruise-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Set Sail: Cruise Highlights from Rayna Tours';

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();
    const sendOne = async (r) => {
      const data = await buildDay2CruiseData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay2Cruise(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 2 - Cruise Spotlight', source, dayNumber:2, journeyId, nodeId });
    };
    if (recipients.length > 100) {
      const jobId = `day2_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 2, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background` } });
      parallelMap(recipients, sendOne).then(results => { const sent = results.filter(r => r.success).length; batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() }); console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`); }).catch(err => { batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message }); });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 2, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── DAY 3: Visa Hub ───────────────────────────────────────────────────────

router.post('/day3', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const { rankTrendingVisas, _internals: rankInternals } = await import('../services/VisaRankingService.js');
    const { buildDay3VisaData } = await import('../services/Day3VisaDataService.js');
    const { renderDay3Visa } = await import('../services/Day3VisaRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    const ranking = useClaude ? await cachedRanking('day3', rankTrendingVisas) : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    // Day3VisaDataService expects ratings_keys but VisaRankingService doesn't produce it
    if (!ranking.ranking.ratings_keys) {
      ranking.ranking.ratings_keys = ['rayna', 'trustpilot', 'tripadvisor', 'google'];
    }

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day3-visa-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Your Visa, Sorted | Rayna Tours';

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();
    const sendOne = async (r) => {
      const data = await buildDay3VisaData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay3Visa(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 3 - Visa Hub', source, dayNumber:3, journeyId, nodeId });
    };
    if (recipients.length > 100) {
      const jobId = `day3_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 3, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background` } });
      parallelMap(recipients, sendOne).then(results => { const sent = results.filter(r => r.success).length; batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() }); console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`); }).catch(err => { batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message }); });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 3, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── DAY 4: Holidays ───────────────────────────────────────────────────────

router.post('/day4', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const { rankTrendingHolidays, _internals: rankInternals } = await import('../services/Day4HolidaysRankingService.js');
    const { buildDay4HolidaysData } = await import('../services/Day4HolidaysDataService.js');
    const { renderDay4Holidays } = await import('../services/Day4HolidaysRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    const ranking = useClaude ? await cachedRanking('day4', rankTrendingHolidays) : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day4-holidays-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Curated Trips Selected for You | Rayna Tours';

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();
    const sendOne = async (r) => {
      const data = await buildDay4HolidaysData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay4Holidays(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 4 - Holidays', source, dayNumber:4, journeyId, nodeId });
    };
    if (recipients.length > 100) {
      const jobId = `day4_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 4, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background` } });
      parallelMap(recipients, sendOne).then(results => { const sent = results.filter(r => r.success).length; batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() }); console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`); }).catch(err => { batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message }); });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 4, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── DAY 5: Activities ─────────────────────────────────────────────────────

router.post('/day5', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const { rankTrendingActivities, _internals: rankInternals } = await import('../services/Day5ActivitiesRankingService.js');
    const { buildDay5ActivitiesData } = await import('../services/Day5ActivitiesDataService.js');
    const { renderDay5Activities } = await import('../services/Day5ActivitiesRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    const ranking = useClaude ? await cachedRanking('day5', rankTrendingActivities) : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day5-activities-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'World-Class Activities, Instantly Booked | Rayna Tours';

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();
    const sendOne = async (r) => {
      const data = await buildDay5ActivitiesData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay5Activities(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 5 - Activities', source, dayNumber:5, journeyId, nodeId });
    };
    if (recipients.length > 100) {
      const jobId = `day5_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 5, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background` } });
      parallelMap(recipients, sendOne).then(results => { const sent = results.filter(r => r.success).length; batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() }); console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`); }).catch(err => { batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message }); });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 5, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── DAY 6: Destination Spotlight (per-destination) ────────────────────────

router.post('/day6', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const destinationKey = (req.body?.destinationKey || 'singapore').toLowerCase();

    const { rankDestinationSpotlight, _internals: rankInternals } = await import('../services/Day6DestinationRankingService.js');
    const { buildDay6DestinationData, _internals: dataInternals } = await import('../services/Day6DestinationDataService.js');
    const { renderDay6Destination } = await import('../services/Day6DestinationRenderer.js');

    const dest = dataInternals.DESTINATION_CATALOG[destinationKey];
    if (!dest) return res.status(400).json({ error: `Unknown destinationKey: ${destinationKey}`, valid: Object.keys(dataInternals.DESTINATION_CATALOG) });

    const useClaude = req.body?.noClaude !== true;
    let ranking;
    if (useClaude) {
      ranking = await cachedRanking(`day6:${destinationKey}`, () => rankDestinationSpotlight({ destinationKey }));
    } else {
      const [holidayCandidates, activityCandidates, cruiseCandidates] = await Promise.all([
        rankInternals.fetchHolidayCandidates(dest.productCity),
        rankInternals.fetchActivityCandidates(dest.productCity),
        rankInternals.fetchCruiseCandidates(dest.cruiseCategory),
      ]);
      ranking = { ranking: rankInternals.buildFallbackRanking({ holidayCandidates, activityCandidates, cruiseCandidates }), source: 'fallback' };
    }

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day6-destination-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || `${dest.name}, Your Way | Rayna Tours`;

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();
    const sendOne = async (r) => {
      const data = await buildDay6DestinationData({ contactId: r.unified_id, destinationKey, ranking: ranking.ranking });
      const html = renderDay6Destination(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 6 - Destination Spotlight', source, dayNumber:6, journeyId, nodeId });
    };
    if (recipients.length > 100) {
      const jobId = `day6_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 6, destinationKey, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background` } });
      parallelMap(recipients, sendOne).then(results => { const sent = results.filter(r => r.success).length; batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() }); console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`); }).catch(err => { batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message }); });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 6, destinationKey, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── DAY 7: Abandoned Cart ─────────────────────────────────────────────────

router.post('/day7', async (req, res, next) => {
  try {
    const recipients = await resolveRecipients(req.body?.emails);
    if (recipients.length === 0) return res.status(404).json({ error: 'No valid recipients found in unified_contacts' });

    const { rankAbandonedCartFallback, _internals: rankInternals } = await import('../services/Day7AbandonedCartRankingService.js');
    const { buildDay7AbandonedCartData } = await import('../services/Day7AbandonedCartDataService.js');
    const { renderDay7AbandonedCart } = await import('../services/Day7AbandonedCartRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    let ranking;
    if (useClaude) {
      ranking = await cachedRanking('day7', rankAbandonedCartFallback);
    } else {
      const [activities, holidays, cruises, visas] = await Promise.all([
        rankInternals.fetchCandidates('activities'),
        rankInternals.fetchCandidates('holiday'),
        rankInternals.fetchCandidates('cruise'),
        rankInternals.fetchVisaKeys(),
      ]);
      ranking = { ranking: rankInternals.buildFallbackRanking({ activities, holidays, cruises, visas }), source: 'fallback' };
    }

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day7-abandoned-cart-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'You Left Something Behind | Rayna Tours';

    const source = req.body?.source || 'test-send';
    const journeyId = req.body?.journeyId;
    const nodeId = req.body?.nodeId;
    const EmailChannel = await loadEmailChannel();
    const sendOne = async (r) => {
      const data = await buildDay7AbandonedCartData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay7AbandonedCart(template, data);
      if (!leftoversCheck(html)) return { email: r.email, success: false, error: 'placeholders left' };
      return sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 7 - Abandoned Cart', source, dayNumber:7, journeyId, nodeId });
    };
    if (recipients.length > 100) {
      const jobId = `day7_${Date.now()}`;
      batchJobs.set(jobId, { status: 'processing', total: recipients.length, sent: 0, failed: 0, results: [], startedAt: new Date().toISOString() });
      res.json({ data: { day: 7, recipients: recipients.length, async: true, jobId, message: `Sending to ${recipients.length} recipients in background` } });
      parallelMap(recipients, sendOne).then(results => { const sent = results.filter(r => r.success).length; batchJobs.set(jobId, { status: 'done', total: recipients.length, sent, failed: recipients.length - sent, results, startedAt: batchJobs.get(jobId)?.startedAt, completedAt: new Date().toISOString() }); console.log(`[Batch:${jobId}] Done — ${sent}/${recipients.length} sent`); }).catch(err => { batchJobs.set(jobId, { ...batchJobs.get(jobId), status: 'error', error: err.message }); });
    } else {
      const results = await parallelMap(recipients, sendOne);
      res.json({ data: { day: 7, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
    }
  } catch (err) { next(err); }
});

// ── Batch job status (for async large sends) ─────────────────────────

router.get('/batch-status/:jobId', (req, res) => {
  const job = batchJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { results, ...summary } = job;
  // Only include results when done (avoid sending huge arrays while processing)
  if (job.status === 'done' || job.status === 'error') {
    res.json({ data: { ...summary, resultCount: results?.length || 0 } });
  } else {
    res.json({ data: summary });
  }
});

// ── Send Tracking — read routes ───────────────────────────────────────────

/**
 * GET /api/v3/test-sends/send-log
 *
 * Paginated list of all tracked sends.
 *
 * Query params:
 *   page      – page number (default 1)
 *   limit     – rows per page (default 50, max 200)
 *   status    – queued | sent | failed | opened | clicked
 *   email     – partial match on recipient email
 *   dayNumber – 1-7
 *   source    – test-send | campaign | journey
 *   dateFrom  – ISO 8601 (e.g. 2025-01-01)
 *   dateTo    – ISO 8601
 */
router.get('/send-log', async (req, res, next) => {
  try {
    const page      = Math.max(1, parseInt(req.query.page  || '1'));
    const limit     = Math.min(200, Math.max(1, parseInt(req.query.limit || '50')));
    const { status, email, dayNumber, source, dateFrom, dateTo, subscriptionStatus, journeyId, nodeId } = req.query;

    const result = await SendTrackService.getLog({ page, limit, status, email, dayNumber, source, dateFrom, dateTo, subscriptionStatus, journeyId, nodeId });
    res.json({ data: result });
  } catch (err) { next(err); }
});

/**
 * GET /api/v3/test-sends/send-log/summary
 *
 * Aggregate stats: counts by status + open-rate breakdown per day template.
 */
router.get('/send-log/summary', async (_req, res, next) => {
  try {
    const summary = await SendTrackService.getSummary();
    res.json({ data: summary });
  } catch (err) { next(err); }
});

/**
 * GET /api/v3/test-sends/send-log/user/:unifiedId
 *
 * All sends to a specific contact (most recent first).
 * Optional query param: limit (default 30)
 */
router.get('/send-log/user/:unifiedId', async (req, res, next) => {
  try {
    const unifiedId = parseInt(req.params.unifiedId);
    if (isNaN(unifiedId)) return res.status(400).json({ error: 'unifiedId must be a number' });

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '30')));
    const rows  = await SendTrackService.getByUnifiedId(unifiedId, { limit });
    res.json({ data: { unifiedId, count: rows.length, rows } });
  } catch (err) { next(err); }
});

// ── UTM Visit Log ────────────────────────────────────────────────────────────

router.get('/utm-log', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1'));
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '50')));
    const result = await SendTrackService.getUtmLog({
      page, limit,
      utmSource:   req.query.utm_source   || undefined,
      utmMedium:   req.query.utm_medium   || undefined,
      utmCampaign: req.query.utm_campaign || undefined,
      utmContent:  req.query.utm_content  || undefined,
      email:       req.query.email        || undefined,
      dateFrom:    req.query.dateFrom     || undefined,
      dateTo:      req.query.dateTo       || undefined,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

router.get('/utm-log/summary', async (_req, res, next) => {
  try {
    const summary = await SendTrackService.getUtmSummary();
    res.json({ data: summary });
  } catch (err) { next(err); }
});

// ── Pre-warm: generate all 7 day rankings in parallel before schedule starts ──

router.post('/prewarm', async (req, res, next) => {
  try {
    const destinationKey = req.body?.destinationKey || 'singapore';
    console.log('[Prewarm] Starting pre-generation of all 7 day rankings in parallel...');

    const [
      { rankTrendingWelcome },
      { rankTrendingCruises },
      { rankTrendingVisas },
      { rankTrendingHolidays },
      { rankTrendingActivities },
      { rankDestinationSpotlight },
      { rankAbandonedCartFallback },
    ] = await Promise.all([
      import('../services/Day1WelcomeRankingService.js'),
      import('../services/Day2CruiseRankingService.js'),
      import('../services/VisaRankingService.js'),
      import('../services/Day4HolidaysRankingService.js'),
      import('../services/Day5ActivitiesRankingService.js'),
      import('../services/Day6DestinationRankingService.js'),
      import('../services/Day7AbandonedCartRankingService.js'),
    ]);

    const results = await Promise.allSettled([
      cachedRanking('day1', rankTrendingWelcome),
      cachedRanking('day2', rankTrendingCruises),
      cachedRanking('day3', rankTrendingVisas),
      cachedRanking('day4', rankTrendingHolidays),
      cachedRanking('day5', rankTrendingActivities),
      cachedRanking(`day6:${destinationKey}`, () => rankDestinationSpotlight({ destinationKey })),
      cachedRanking('day7', rankAbandonedCartFallback),
    ]);

    const summary = results.map((r, i) => ({
      day:    i + 1,
      label:  ['Welcome','Cruise Spotlight','Visa Hub','Holidays','Activities','Destination Spotlight','Abandoned Cart'][i],
      status: r.status === 'fulfilled' ? 'ready' : 'failed',
      source: r.status === 'fulfilled' ? (r.value?.source || 'cache') : null,
      error:  r.status === 'rejected'  ? r.reason?.message : null,
    }));

    console.log('[Prewarm] Complete:', summary.map(s => `Day${s.day}(${s.status})`).join(' '));
    res.json({ data: { summary, ready: summary.filter(s => s.status === 'ready').length, total: 7 } });
  } catch (err) { next(err); }
});


export default router;
