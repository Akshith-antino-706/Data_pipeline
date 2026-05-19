/**
 * BullMQ workers for journey-driven sends.
 *
 * Each job carries the full context the worker needs to render + send + log
 * + advance the journey entry, so workers don't need to re-fetch journey
 * structure or recipient identity from the DB on every job.
 *
 * Job payload (all required unless noted):
 *   {
 *     entryId, customerId, journeyId, nodeId, runId,
 *     channel:        'email' | 'whatsapp' | 'sms',
 *     templateId:     content_templates.id
 *     htmlTemplateId: email_html_templates.id (email channel only — fallback)
 *     name, email, phone,
 *     track:          'indian' | 'rest' | 'all',
 *     edges:          journey edges array (for advancing the entry post-send)
 *     nodes:          minimal node map { id → { id, type, data } } for track-aware edge selection
 *   }
 */
import { Worker } from 'bullmq';
import { getConnection } from './index.js';
import db from '../../config/database.js';
import EmailRenderer from '../EmailRenderer.js';
import GupshupService from '../GupshupService.js';
import { ChatheadEmailChannel } from '../channels/ChatheadEmailChannel.js';
import { renderDayHtml } from '../JourneyService.js';
import { SendTrackService } from '../SendTrackService.js';
import { injectClickTracking, injectOpenPixel } from '../../utils/emailTracking.js';

// Throughput tuning — adjust per provider's actual limits.
const EMAIL_CONCURRENCY = parseInt(process.env.JOURNEY_EMAIL_CONCURRENCY || '20');
const EMAIL_RATE_MAX    = parseInt(process.env.JOURNEY_EMAIL_RATE_MAX    || '50');
const EMAIL_RATE_WINDOW = parseInt(process.env.JOURNEY_EMAIL_RATE_WINDOW || '1000');  // ms

const WA_CONCURRENCY    = parseInt(process.env.JOURNEY_WA_CONCURRENCY    || '10');
const WA_RATE_MAX       = parseInt(process.env.JOURNEY_WA_RATE_MAX       || '20');
const WA_RATE_WINDOW    = parseInt(process.env.JOURNEY_WA_RATE_WINDOW    || '1000');

const SMS_ENABLED       = process.env.JOURNEY_SMS_ENABLED === 'true';

// Override: redirect ALL journey emails to this address (for testing before going live)
const EMAIL_OVERRIDE    = process.env.JOURNEY_EMAIL_OVERRIDE || null;

let _workers = null;

/** Start all journey workers in this process. Idempotent — safe to call once at boot. */
export function startWorkers() {
  if (_workers) return _workers;
  const connection = getConnection();

  const email = new Worker('journey-email', processEmail, {
    connection,
    concurrency: EMAIL_CONCURRENCY,
    limiter: { max: EMAIL_RATE_MAX, duration: EMAIL_RATE_WINDOW },
  });

  const wa = new Worker('journey-wa', processWA, {
    connection,
    concurrency: WA_CONCURRENCY,
    limiter: { max: WA_RATE_MAX, duration: WA_RATE_WINDOW },
  });

  const sms = new Worker('journey-sms', SMS_ENABLED ? processSMS : processSMSDisabled, {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  });

  for (const w of [email, wa, sms]) {
    w.on('failed', (job, err) => {
      console.error(`[Worker:${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts || 1}): ${err.message}`);
    });
    w.on('error', (err) => {
      console.error(`[Worker:${w.name}] worker error: ${err.message}`);
    });
  }

  _workers = { email, wa, sms };
  console.log(`[Workers] Started — email(c=${EMAIL_CONCURRENCY},r=${EMAIL_RATE_MAX}/${EMAIL_RATE_WINDOW}ms) wa(c=${WA_CONCURRENCY},r=${WA_RATE_MAX}/${WA_RATE_WINDOW}ms) sms(${SMS_ENABLED ? 'enabled' : 'disabled'})`);
  return _workers;
}

export async function stopWorkers() {
  if (!_workers) return;
  await Promise.all([_workers.email.close(), _workers.wa.close(), _workers.sms.close()]);
  _workers = null;
}

// ── Job processors ─────────────────────────────────────────────

async function processEmail(job) {
  const d = job.data;
  const recipientEmail = EMAIL_OVERRIDE || d.email;
  if (!recipientEmail) return _logAndAdvance(d, 'action_blocked', { reason: 'no_email' }, /*sent=*/false);
  console.log(`[Worker:email] ── Processing job ${job.id} ──`);
  console.log(`[Worker:email]   entry=${d.entryId} customer=${d.customerId} node=${d.nodeId} journey=${d.journeyId}`);
  console.log(`[Worker:email]   to=${recipientEmail}${EMAIL_OVERRIDE ? ` (override, real=${d.email})` : ''} template=${d.templateId}`);

  // Try renderDayHtml first (Day1-Day7 templates from mail_templates/ folder)
  // Falls back to EmailRenderer if renderDayHtml doesn't match the templateId
  let html, subject;
  const dayRendered = await renderDayHtml(d.templateId, d.customerId).catch(err => {
    console.log(`[Worker] renderDayHtml failed for templateId=${d.templateId}, entry=${d.entryId}: ${err.message}`);
    return null;
  });

  if (dayRendered?.html) {
    html    = dayRendered.html;
    subject = dayRendered.subject || 'Rayna Tours';
    console.log(`[Worker:email]   rendered via renderDayHtml → subject="${subject}" html=${html.length} bytes`);
  } else {
    // Fallback: EmailRenderer with htmlTemplateId from DB
    const htmlTemplateId = d.htmlTemplateId || await _resolveHtmlTemplateId(d.templateId);
    if (!htmlTemplateId) {
      return _logAndAdvance(d, 'action_blocked', { reason: 'no_html_template' }, false);
    }
    const rendered = await EmailRenderer.renderForJourneyNode({
      htmlTemplateId,
      unifiedId: d.customerId,
      journeyId: d.journeyId,
      nodeId: d.nodeId,
      runId: d.runId,
    });
    html    = rendered.html;
    subject = rendered.subject || 'Rayna Tours';
    console.log(`[Worker:email]   rendered via EmailRenderer → subject="${subject}" html=${html.length} bytes`);
  }

  // ── Inject click/open tracking ──
  const baseUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;

  const logId = await SendTrackService.logSend({
    unifiedId: d.customerId,
    email: d.email,
    subject,
    templateLabel: d.nodeId || 'journey',
    dayNumber: 0,
    source: 'journey',
  });

  const campaignSlug = `j${d.journeyId}_${(d.nodeId || '').replace(/[^a-zA-Z0-9]+/g, '_')}`;
  let trackedHtml = injectClickTracking(html, {
    logId,
    baseUrl,
    campaign: campaignSlug,
    content: `journey_${d.journeyId}`,
    source: 'email',
    medium: 'journey',
    unifiedId: d.customerId,
    journeyId: d.journeyId,
    nodeId: d.nodeId,
  });
  trackedHtml = injectOpenPixel(trackedHtml, logId, baseUrl);

  // Send via ChatheadEmailChannel (AWS Email API)
  const sendResult = await ChatheadEmailChannel.send({
    to: recipientEmail,
    subject,
    html: trackedHtml,
  });

  // Update send log status
  if (sendResult.success) {
    console.log(`[Worker:email]   ✓ SENT to=${recipientEmail} provider=${sendResult.provider} externalId=${sendResult.externalId} duration=${sendResult.durationMs}ms`);
    SendTrackService.markSent(logId, { externalId: sendResult.externalId || null, provider: sendResult.provider || null }).catch(() => {});
  } else {
    console.log(`[Worker:email]   ✗ FAILED to=${recipientEmail} error=${sendResult.error} duration=${sendResult.durationMs}ms`);
    SendTrackService.markFailed(logId, { error: sendResult.error || 'send_failed' }).catch(() => {});
  }

  await _logAndAdvance(d, sendResult.success ? 'action_sent' : 'action_failed', {
    templateId: d.templateId,
    channel: 'email',
    track: d.track,
    sendResult: { success: sendResult.success, provider: sendResult.provider, externalId: sendResult.externalId, error: sendResult.error },
  }, sendResult.success);

  if (!sendResult.success) {
    // Surface to BullMQ so it retries with backoff
    throw new Error(`email send failed: ${sendResult.error || 'unknown'}`);
  }
}

async function processWA(job) {
  const d = job.data;
  if (!d.phone) return _logAndAdvance(d, 'action_blocked', { reason: 'no_phone' }, false);

  let approvalBlocked = false;
  let sendResult;
  try {
    await GupshupService.assertApproved(parseInt(d.templateId));
    const firstName = d.name ? d.name.split(' ')[0] : 'there';
    sendResult = await GupshupService.sendWhatsApp({
      to: d.phone,
      templateId: parseInt(d.templateId),
      params: [firstName],
    });
  } catch (err) {
    approvalBlocked = /not approved/i.test(err.message);
    sendResult = { success: false, error: err.message, blocked: approvalBlocked };
  }

  await _logAndAdvance(d,
    approvalBlocked ? 'action_blocked' : (sendResult.success ? 'action_sent' : 'action_failed'),
    {
      templateId: d.templateId, channel: 'whatsapp', track: d.track,
      sendResult: { success: sendResult.success, provider: sendResult.provider, simulated: sendResult.simulated, externalId: sendResult.externalId, error: sendResult.error },
    },
    sendResult.success
  );

  if (!sendResult.success && !sendResult.simulated && !approvalBlocked) {
    throw new Error(`gupshup wa send failed: ${sendResult.error || 'unknown'}`);
  }
}

async function processSMS(job) {
  const d = job.data;
  if (!d.phone) return _logAndAdvance(d, 'action_blocked', { reason: 'no_phone' }, false);

  let approvalBlocked = false;
  let sendResult;
  try {
    await GupshupService.assertApproved(parseInt(d.templateId));
    const { rows: [tpl] } = await db.query('SELECT body FROM content_templates WHERE id = $1', [parseInt(d.templateId)]);
    const firstName = d.name ? d.name.split(' ')[0] : 'there';
    const messageBody = (tpl?.body || '').replace(/\{\{first_name\}\}/g, firstName);
    sendResult = await GupshupService.sendSMS({
      to: d.phone, templateId: parseInt(d.templateId), messageBody,
    });
  } catch (err) {
    approvalBlocked = /not approved/i.test(err.message);
    sendResult = { success: false, error: err.message, blocked: approvalBlocked };
  }

  await _logAndAdvance(d,
    approvalBlocked ? 'action_blocked' : (sendResult.success ? 'action_sent' : 'action_failed'),
    { templateId: d.templateId, channel: 'sms', track: d.track,
      sendResult: { success: sendResult.success, simulated: sendResult.simulated, error: sendResult.error } },
    sendResult.success
  );

  if (!sendResult.success && !sendResult.simulated && !approvalBlocked) {
    throw new Error(`gupshup sms send failed: ${sendResult.error || 'unknown'}`);
  }
}

async function processSMSDisabled(job) {
  await _logAndAdvance(job.data, 'action_blocked', { reason: 'sms_channel_disabled' }, false);
}

// ── helpers ───────────────────────────────────────────────────

async function _resolveHtmlTemplateId(contentTemplateId) {
  if (!contentTemplateId) return null;
  const { rows: [r] } = await db.query(
    'SELECT html_template_id FROM content_templates WHERE id = $1',
    [parseInt(contentTemplateId)]
  );
  return r?.html_template_id || null;
}

/**
 * After the worker finishes its send (success or terminal failure),
 *  - insert a journey_events row
 *  - advance the journey_entry to the next track-matched edge (or complete it)
 */
async function _logAndAdvance(d, eventType, details, sendSucceeded) {
  await db.query(
    `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [d.entryId, d.nodeId, eventType, d.channel, JSON.stringify(details || {})]
  );

  const edges = d.edges || [];
  const nodeMap = d.nodes || {};
  const entryTrack = d.track || 'all';
  const matchesTrack = (nodeId) => {
    const n = nodeMap[nodeId];
    if (!n) return false;
    const t = n?.data?.track || 'all';
    return t === 'all' || t === entryTrack;
  };

  const outEdges = edges.filter(e => e.source === d.nodeId);
  const trackEdges = outEdges.filter(e => matchesTrack(e.target));
  const chosen = trackEdges[0] || outEdges[0];

  if (chosen) {
    await db.query(
      `UPDATE journey_entries SET current_node_id = $1, bullmq_job_id = NULL WHERE entry_id = $2`,
      [chosen.target, d.entryId]
    );
  } else {
    await db.query(
      `UPDATE journey_entries SET status = 'completed', completed_at = NOW(), bullmq_job_id = NULL
       WHERE entry_id = $1`,
      [d.entryId]
    );
    await _checkJourneyCompletion(d.journeyId);
  }
}

async function _checkJourneyCompletion(journeyId) {
  try {
    const { rows: [r] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM journey_entries WHERE journey_id = $1 AND status = 'active'`,
      [journeyId]
    );
    if (parseInt(r.cnt) > 0) return;

    const { rows: [total] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM journey_entries WHERE journey_id = $1`,
      [journeyId]
    );
    if (parseInt(total.cnt) === 0) return;

    const { rowCount } = await db.query(
      `UPDATE journey_flows SET status = 'completed', updated_at = NOW()
       WHERE journey_id = $1 AND status = 'active'`,
      [journeyId]
    );
    if (rowCount > 0) {
      console.log(`[Worker] Journey ${journeyId} auto-completed — all entries done.`);
    }
  } catch (err) {
    console.error(`[Worker] Journey completion check failed for ${journeyId}: ${err.message}`);
  }
}

export default { startWorkers, stopWorkers };
