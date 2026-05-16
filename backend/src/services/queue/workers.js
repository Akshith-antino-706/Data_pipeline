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
 *     templateId:     content_templates.id (the per-channel template; for email this points to email_html_templates via content_templates.html_template_id)
 *     htmlTemplateId: email_html_templates.id (email channel only — what the renderer expands)
 *     name, email, phone,
 *     track:          'indian' | 'rest' | 'all',
 *     edges:          journey edges array (for advancing the entry post-send)
 *     nodes:          minimal node map { id → { id, type, data } } for track-aware edge selection
 *   }
 */
import { Worker } from 'bullmq';
import { getConnection } from './index.js';
import JourneyService from '../JourneyService.js';
import db from '../../config/database.js';
import EmailRenderer from '../EmailRenderer.js';
import GupshupService from '../GupshupService.js';
import { EmailChannel } from '../channels/EmailChannel.js';
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

  const testSend = new Worker('journey-test-send', async (job) => {
    const { journeyId, nodeId, recipient } = job.data;
    return JourneyService.testSendNode(journeyId, nodeId, recipient);
  }, { connection, concurrency: 10 });

  for (const w of [email, wa, sms, testSend]) {
    w.on('failed', (job, err) => {
      console.error(`[Worker:${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts || 1}): ${err.message}`);
    });
    w.on('error', (err) => {
      console.error(`[Worker:${w.name}] worker error: ${err.message}`);
    });
  }

  _workers = { email, wa, sms, testSend };
  console.log(`[Workers] Started — email(c=${EMAIL_CONCURRENCY},r=${EMAIL_RATE_MAX}/${EMAIL_RATE_WINDOW}ms) wa(c=${WA_CONCURRENCY},r=${WA_RATE_MAX}/${WA_RATE_WINDOW}ms) sms(${SMS_ENABLED ? 'enabled' : 'disabled'})`);
  return _workers;
}

export async function stopWorkers() {
  if (!_workers) return;
  await Promise.all([_workers.email.close(), _workers.wa.close(), _workers.sms.close(), _workers.testSend.close()]);
  _workers = null;
}

// ── Job processors ─────────────────────────────────────────────

async function processEmail(job) {
  const d = job.data;
  if (!d.email) return _logAndAdvance(d, 'action_blocked', { reason: 'no_email' }, /*sent=*/false);

  // The action node's content_template references an html_template_id; the
  // renderer expands SLOT markers from popularity_snapshots.
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

  // ── Inject click/open tracking (same as test-sends) ──
  const baseUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  const subject = rendered.subject || 'Rayna Tours';

  const logId = await SendTrackService.logSend({
    unifiedId: d.customerId,
    email: d.email,
    subject,
    templateLabel: d.nodeId || 'journey',
    dayNumber: 0,
    source: 'journey',
  });

  const campaignSlug = `j${d.journeyId}_${(d.nodeId || '').replace(/[^a-zA-Z0-9]+/g, '_')}`;
  let trackedHtml = injectClickTracking(rendered.html, {
    logId,
    baseUrl,
    campaign: campaignSlug,
    content: `journey_${d.journeyId}`,
    source: 'email',
    medium: 'journey',
    unifiedId: d.customerId,
  });
  trackedHtml = injectOpenPixel(trackedHtml, logId, baseUrl);

  const sendResult = await EmailChannel.send({
    to: d.email,
    subject,
    html: trackedHtml,
    text: rendered.plainText,
  });

  // Update send log status
  if (sendResult.success || sendResult.simulated) {
    SendTrackService.markSent(logId, { externalId: sendResult.externalId || null, provider: sendResult.provider || null }).catch(() => {});
  } else if (sendResult.blocked) {
    SendTrackService.markFailed(logId, { error: sendResult.reason || 'blocked' }).catch(() => {});
  }

  // EmailChannel returns { blocked: true } for unsubscribed/bounced contacts —
  // not a retryable failure; record as action_blocked and advance.
  if (sendResult.blocked) {
    await _logAndAdvance(d, 'action_blocked', {
      templateId: d.templateId, htmlTemplateId, channel: 'email', track: d.track,
      reason: sendResult.reason || 'unsubscribed_or_bounced',
    }, false);
    return;
  }

  await _logAndAdvance(d, sendResult.success ? 'action_sent' : 'action_failed', {
    templateId: d.templateId,
    htmlTemplateId,
    channel: 'email',
    track: d.track,
    slotsFilled: rendered.slotsFilled,
    sendResult: { success: sendResult.success, provider: sendResult.provider, simulated: sendResult.simulated, externalId: sendResult.externalId, error: sendResult.error },
  }, sendResult.success);

  if (!sendResult.success && !sendResult.simulated) {
    // Surface to BullMQ so it retries with backoff
    throw new Error(`smtp send failed: ${sendResult.error || 'unknown'}`);
  }
}

async function processWA(job) {
  const d = job.data;
  if (!d.phone) return _logAndAdvance(d, 'action_blocked', { reason: 'no_phone' }, false);

  // Approval gate is enforced by GupshupService.assertApproved → throws if not approved.
  // We catch and log as 'action_blocked' so the journey advances and the worker
  // doesn't retry an unapprovable template.
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
 *
 * Failed-with-retry-pending sends never call this — they throw and BullMQ
 * re-runs the job, which writes a fresh attempt log via the on('failed') handler.
 */
async function _logAndAdvance(d, eventType, details, sendSucceeded) {
  await db.query(
    `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [d.entryId, d.nodeId, eventType, d.channel, JSON.stringify(details || {})]
  );

  // Advance the entry to the next node via the same track-aware edge selection
  // processJourney() uses for non-action nodes.
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
    // Last node finished — check if the whole journey is now done
    await _checkJourneyCompletion(d.journeyId);
  }
}

async function _checkJourneyCompletion(journeyId) {
  try {
    const { rows: [r] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM journey_entries WHERE journey_id = $1 AND status = 'active'`,
      [journeyId]
    );
    if (parseInt(r.cnt) > 0) return; // still active entries

    const { rows: [total] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM journey_entries WHERE journey_id = $1`,
      [journeyId]
    );
    if (parseInt(total.cnt) === 0) return; // no entries at all — journey not started yet

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
