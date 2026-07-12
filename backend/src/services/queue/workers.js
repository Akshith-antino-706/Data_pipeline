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
import JourneyService, { getOrGenerateNodeEmail } from '../JourneyService.js';
import { SendTrackService } from '../SendTrackService.js';
import { injectClickTracking, injectOpenPixel } from '../../utils/emailTracking.js';
import WelcomeEmailService from '../WelcomeEmailService.js';
<<<<<<< Updated upstream
=======
import GtmJourneyService from '../GtmJourneyService.js';
import { isEmailAllowed } from '../../utils/emailAllowlist.js';
import { reserveSend, releaseSend } from '../../utils/emailFrequencyCap.js';
import { buildReviewUrl } from '../../utils/reviewUrl.js';
import { instrumentWorkerMetrics, traceJob } from '../../telemetry/metrics.js';

// ── Per-journey graph cache ──
// Workers need the journey's nodes+edges only to advance an entry after a send.
// We no longer ship the full graph inside every job payload — that bloated Redis
// (~8 KB × ~1.3M jobs ≈ 6–10 GB, well over the 3 GB cap, causing OOM during big
// broadcasts). Instead load the graph once per journey and cache it in-process
// with a short TTL so structural edits still propagate within a minute.
const _graphCache = new Map(); // journeyId → { at, edges, nodeMap }
const GRAPH_TTL_MS = 60_000;
async function getJourneyGraph(journeyId) {
  const hit = _graphCache.get(journeyId);
  if (hit && (Date.now() - hit.at) < GRAPH_TTL_MS) return hit;
  const { rows: [jf] } = await db.query(
    'SELECT nodes, edges FROM journey_flows WHERE journey_id = $1', [journeyId]
  );
  const nodeMap = {};
  for (const n of (jf?.nodes || [])) nodeMap[n.id] = n;
  const entry = { at: Date.now(), edges: jf?.edges || [], nodeMap };
  _graphCache.set(journeyId, entry);
  return entry;
}
// Prefer the graph embedded in legacy in-flight jobs (during a rolling deploy);
// otherwise load+cache from the DB. New jobs no longer carry edges/nodes.
async function _resolveGraph(d) {
  if (d.edges && d.nodes) return { edges: d.edges, nodeMap: d.nodes };
  return getJourneyGraph(d.journeyId);
}
>>>>>>> Stashed changes

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

// Throttle auto-processJourney calls: one trigger per journey per 20 seconds max
const _processThrottle = new Map(); // journeyId → lastTriggerMs
function _scheduleProcess(journeyId, nextNodeType) {
  // Wait nodes handle their own timing via next_fire_at — no need to trigger immediately
  if (nextNodeType === 'wait') return;
  const now = Date.now();
  const last = _processThrottle.get(journeyId) || 0;
  if (now - last < 20_000) return;
  _processThrottle.set(journeyId, now);
  // Fire async after a short settle delay so concurrent workers can finish advancing
  setTimeout(() => {
    JourneyService.processJourney(journeyId)
      .catch(e => console.error(`[Worker] Auto-process j${journeyId} failed: ${e.message}`));
  }, 2000);
}

let _workers = null;

/** Start all journey workers in this process. Idempotent — safe to call once at boot. */
export function startWorkers() {
  if (_workers) return _workers;
  const connection = getConnection();

  // Processors are wrapped with traceJob(): a transparent span around each job
  // (worker traces). If tracing is unavailable it returns the processor unchanged.
  const email = new Worker('journey-email', traceJob('journey-email', processEmail), {
    connection,
    concurrency: EMAIL_CONCURRENCY,
    limiter: { max: EMAIL_RATE_MAX, duration: EMAIL_RATE_WINDOW },
  });

  const wa = new Worker('journey-wa', traceJob('journey-wa', processWA), {
    connection,
    concurrency: WA_CONCURRENCY,
    limiter: { max: WA_RATE_MAX, duration: WA_RATE_WINDOW },
  });

  const sms = new Worker('journey-sms', traceJob('journey-sms', SMS_ENABLED ? processSMS : processSMSDisabled), {
    connection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  });

  // GTM event → welcome email (delayed job; durable replacement for setTimeout).
  // Rate-limited so a traffic spike can't blast the email provider.
  const welcome = new Worker('welcome-email', traceJob('welcome-email', processWelcome), {
    connection,
    concurrency: 3,
    limiter: { max: 5, duration: 1000 },   // ≤5 welcome emails/sec
  });

<<<<<<< Updated upstream
=======
  // GTM (event-triggered) journey → per-user welcome-style email (delayed, rate-limited)
  const gtmJourney = new Worker('gtm-journey', traceJob('gtm-journey', processGtmJourney), {
    connection,
    concurrency: EMAIL_CONCURRENCY,
    limiter: { max: EMAIL_RATE_MAX, duration: EMAIL_RATE_WINDOW },
  });

>>>>>>> Stashed changes
  // After all retries exhausted: advance the entry so it doesn't block forever.
  // Shared handler used by email, wa, and sms queues.
  const _onExhausted = (channel) => async (job, err) => {
    const attempts = job?.opts?.attempts || 3;
    console.error(`[Worker:${channel}] job ${job?.id} EXHAUSTED (${job?.attemptsMade}/${attempts}): ${err.message}`);
    if (job?.attemptsMade >= attempts && job?.data?.entryId) {
      const d = job.data;
      try {
        await db.query(
          `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
           VALUES ($1, $2, 'action_failed', $3, $4)`,
          [d.entryId, d.nodeId, channel, JSON.stringify({ reason: 'all_retries_exhausted', error: err.message })]
        );
        const edges = d.edges || [];
        const nodeMap = d.nodes || {};
        const outEdge = edges.find(e => e.source === d.nodeId);
        if (outEdge) {
          const nextNode = nodeMap[outEdge.target];
          const nextFireAt = JourneyService.calculateNextFireAt(nextNode, new Date());
          const { rowCount } = await db.query(
            `UPDATE journey_entries
             SET current_node_id = $1, bullmq_job_id = NULL,
                 last_run_id = NULL, last_enqueued_at = NULL,
                 next_fire_at = $3
             WHERE entry_id = $2 AND current_node_id = $4`,
            [outEdge.target, d.entryId, nextFireAt, d.nodeId]
          );
          if (rowCount === 0) {
            console.log(`[Worker:${channel}] Stale exhausted job skipped for entry=${d.entryId} node=${d.nodeId}`);
          }
        } else {
          const { rowCount } = await db.query(
            `UPDATE journey_entries SET status = 'completed', completed_at = NOW(), bullmq_job_id = NULL
             WHERE entry_id = $1 AND current_node_id = $2`,
            [d.entryId, d.nodeId]
          );
          if (rowCount > 0) await _checkJourneyCompletion(d.journeyId);
        }
        console.log(`[Worker:${channel}] entry=${d.entryId} advanced after all retries exhausted`);
      } catch (advErr) {
        console.error(`[Worker:${channel}] failed to advance entry ${d.entryId}: ${advErr.message}`);
      }
    }
  };

  email.on('failed', _onExhausted('email'));
  wa.on('failed',    _onExhausted('whatsapp'));
  sms.on('failed',   _onExhausted('sms'));

  welcome.on('error', (err) => console.error(`[Worker:welcome] worker error: ${err.message}`));
  welcome.on('failed', (job, err) => console.error(`[Worker:welcome] job ${job?.id} failed: ${err.message}`));

  for (const w of [email, wa, sms]) {
    w.on('error', (err) => {
      console.error(`[Worker:${w.name}] worker error: ${err.message}`);
    });
  }

<<<<<<< Updated upstream
  _workers = { email, wa, sms, welcome };
=======
  _workers = { email, wa, sms, welcome, gtmJourney };
  // Attach Prometheus job metrics (completed/failed counts + duration). Listeners only —
  // does not affect processing, retries, or the existing 'failed' handlers above.
  for (const [name, w] of Object.entries(_workers)) instrumentWorkerMetrics(w, name);
>>>>>>> Stashed changes
  console.log(`[Workers] Started — email(c=${EMAIL_CONCURRENCY},r=${EMAIL_RATE_MAX}/${EMAIL_RATE_WINDOW}ms) wa(c=${WA_CONCURRENCY},r=${WA_RATE_MAX}/${WA_RATE_WINDOW}ms) sms(${SMS_ENABLED ? 'enabled' : 'disabled'})`);
  return _workers;
}

export async function stopWorkers() {
  if (!_workers) return;
  await Promise.all([_workers.email.close(), _workers.wa.close(), _workers.sms.close(), _workers.welcome.close()]);
  _workers = null;
}

/** Welcome-email worker: runs the (delayed) send for a GTM-triggered welcome. */
async function processWelcome(job) {
  const { unifiedId, eventName, eventId } = job.data || {};
  await WelcomeEmailService.processJob({ unifiedId, eventName, eventId });
  return { ok: true };
}

// ── Job processors ─────────────────────────────────────────────

/**
 * Returns true if the current Dubai calendar date is past the date the job was enqueued.
 * Jobs enqueued on Jun 4 must not be processed on Jun 5+ — advance the entry without sending.
 */
function _isDayCrossed(d) {
  if (!d.enqueuedDubaiDate) return false; // legacy jobs without the field — let them through
  const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  const todayDubai = `${dubaiNow.getFullYear()}-${String(dubaiNow.getMonth()+1).padStart(2,'0')}-${String(dubaiNow.getDate()).padStart(2,'0')}`;
  return todayDubai !== d.enqueuedDubaiDate;
}

async function processEmail(job) {
  const d = job.data;
  const recipientEmail = EMAIL_OVERRIDE || d.email;
  if (!recipientEmail) return _logAndAdvance(d, 'action_blocked', { reason: 'no_email' }, /*sent=*/false);

  if (_isDayCrossed(d)) {
    console.log(`[Worker:email] DAY CROSSED — job enqueued ${d.enqueuedDubaiDate}, skipping send for entry=${d.entryId} node=${d.nodeId}`);
    return _logAndAdvance(d, 'action_blocked', { reason: 'day_crossed', enqueuedDate: d.enqueuedDubaiDate }, false);
  }

  // Stale-job guard: skip send if entry already advanced past this node
  const { rows: [entryRow] } = await db.query(
    'SELECT current_node_id, status FROM journey_entries WHERE entry_id = $1', [d.entryId]
  );
  if (!entryRow || entryRow.current_node_id !== d.nodeId || entryRow.status !== 'active') {
    console.log(`[Worker:email] STALE JOB — entry=${d.entryId} is at node=${entryRow?.current_node_id} (expected ${d.nodeId}), skipping send`);
    return;
  }

  // Re-check unsubscribe + purchased status at send time
  const { rows: [contact] } = await db.query(
    'SELECT email_unsubscribe, booking_status FROM unified_contacts WHERE id = $1', [d.customerId]
  );

  if (contact?.email_unsubscribe === 'Yes') {
    console.log(`[Worker:email] UNSUBSCRIBED — skipping send for entry=${d.entryId} customer=${d.customerId}`);
    await db.query(
      `INSERT INTO unsubscribe_log (unified_id, email, journey_id, node_id, campaign)
       VALUES ($1, $2, $3, $4, 'pre_send_check')
       ON CONFLICT DO NOTHING`,
      [d.customerId, d.email, d.journeyId, d.nodeId]
    ).catch(() => {});
    return _logAndAdvance(d, 'action_blocked', { reason: 'unsubscribed' }, false);
  }

  // Purchased exit: ON_TRIP or FUTURE_TRAVEL + gtm purchase event — skip for first action node
  if (
    d.nodeId !== d.firstActionNodeId &&
    (contact?.booking_status === 'ON_TRIP' || contact?.booking_status === 'FUTURE_TRAVEL')
  ) {
    const { rows: [gtmRow] } = await db.query(
      `SELECT 1 FROM gtm_events WHERE unified_id = $1 AND journey_id = $2 AND event_name = 'purchase' LIMIT 1`,
      [d.customerId, d.journeyId]
    );
    if (gtmRow) {
      console.log(`[Worker:email] PURCHASED — skipping send for entry=${d.entryId} customer=${d.customerId} status=${contact.booking_status}`);
      return _logAndAdvance(d, 'action_blocked', { reason: 'purchased', booking_status: contact.booking_status }, false);
    }
  }
  console.log(`[Worker:email] ── Processing job ${job.id} ──`);
  console.log(`[Worker:email]   entry=${d.entryId} customer=${d.customerId} node=${d.nodeId} journey=${d.journeyId}`);
  console.log(`[Worker:email]   to=${recipientEmail}${EMAIL_OVERRIDE ? ` (override, real=${d.email})` : ''} template=${d.templateId}`);

  // Stored node email first — the SAME rendered HTML for every contact at this node,
  // so the preview is byte-identical to what's sent. First touch renders (Claude/
  // fallback) + stores; all subsequent sends read the stored HTML.
  let html, subject;
  const dayRendered = await getOrGenerateNodeEmail({
    journeyId: d.journeyId, nodeId: d.nodeId, templateId: d.templateId, contactId: d.customerId,
  }).catch(err => {
    console.log(`[Worker] getOrGenerateNodeEmail failed for templateId=${d.templateId}, entry=${d.entryId}: ${err.message}`);
    return null;
  });

  if (dayRendered?.html) {
    html    = dayRendered.html;
    subject = dayRendered.subject || 'Rayna Tours';
    console.log(`[Worker:email]   ${dayRendered.stored ? 'using STORED' : 'rendered+stored'} node email → subject="${subject}" html=${html.length} bytes source=${dayRendered.source}`);
  } else {
    // Fallback 1: EmailRenderer.renderForJourneyNode — needs html_template_id (linked HTML template)
    const htmlTemplateId = d.htmlTemplateId || await _resolveHtmlTemplateId(d.templateId);
    if (htmlTemplateId) {
      const rendered = await EmailRenderer.renderForJourneyNode({
        htmlTemplateId,
        unifiedId: d.customerId,
        journeyId: d.journeyId,
        nodeId: d.nodeId,
        runId: d.runId,
        extraVars: d.templateVariables || {},
      });
      html    = rendered.html;
      subject = rendered.subject || 'Rayna Tours';
      console.log(`[Worker:email]   rendered via EmailRenderer.renderForJourneyNode → subject="${subject}" html=${html.length} bytes`);
    } else {
      // Fallback 2: template has HTML stored directly in content_templates.body (user-uploaded)
      const rendered = await EmailRenderer.render(d.templateId, d.customerId, d.templateVariables || {});
      if (!rendered?.html) {
        return _logAndAdvance(d, 'action_blocked', { reason: 'no_html_template' }, false);
      }
      html    = rendered.html;
      subject = rendered.subject || 'Rayna Tours';
      console.log(`[Worker:email]   rendered via EmailRenderer.render (body fallback) → subject="${subject}" html=${html.length} bytes`);
    }
  }

  // ── Inject click/open tracking ──
  const baseUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;

  // Hard-fail in production if baseUrl is localhost — prevents shipping broken
  // tracking links to real recipients (root cause of the June 4 incident).
  if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(baseUrl)) {
    const err = `[Worker:email] REFUSING to send — TRACKING_BASE_URL is localhost in production. Set TRACKING_BASE_URL env and force-recreate the container.`;
    console.error(err);
    return _logAndAdvance(d, 'action_blocked', { reason: 'localhost_base_url', baseUrl }, false);
  }

  const logId = await SendTrackService.logSend({
    unifiedId: d.customerId,
    email: recipientEmail || d.email || 'unknown',
    subject,
    templateLabel: d.nodeId || 'journey',
    dayNumber: 0,
    source: 'journey',
    journeyId: d.journeyId || null,
    nodeId: d.nodeId || null,
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

  if (!sendResult.success) {
    // Log the failure but do NOT advance the entry — let BullMQ retry.
    // Only advance after all retries are exhausted (handled by the failed event below).
    await db.query(
      `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
       VALUES ($1, $2, 'action_failed', $3, $4)`,
      [d.entryId, d.nodeId, 'email', JSON.stringify({
        templateId: d.templateId, track: d.track,
        sendResult: { success: false, error: sendResult.error, provider: sendResult.provider },
        attempt: job.attemptsMade + 1,
        willRetry: (job.attemptsMade + 1) < (job.opts?.attempts || 3),
      })]
    );
    console.error(`[Worker:email] FAILED entry=${d.entryId} attempt=${job.attemptsMade + 1}: ${sendResult.error}`);
    throw new Error(`email send failed: ${sendResult.error || 'unknown'}`);
  }

  await _logAndAdvance(d, 'action_sent', {
    templateId: d.templateId,
    channel: 'email',
    track: d.track,
    sendResult: { success: true, provider: sendResult.provider, externalId: sendResult.externalId },
  }, true);
}

async function processWA(job) {
  const d = job.data;
  if (!d.phone) return _logAndAdvance(d, 'action_blocked', { reason: 'no_phone' }, false);

  if (_isDayCrossed(d)) {
    console.log(`[Worker:wa] DAY CROSSED — job enqueued ${d.enqueuedDubaiDate}, skipping send for entry=${d.entryId} node=${d.nodeId}`);
    return _logAndAdvance(d, 'action_blocked', { reason: 'day_crossed', enqueuedDate: d.enqueuedDubaiDate }, false);
  }

  const { rows: [contactWA] } = await db.query(
    'SELECT wa_unsubscribe FROM unified_contacts WHERE id = $1', [d.customerId]
  );
  if (contactWA?.wa_unsubscribe === 'Yes') {
    console.log(`[Worker:wa] WA_UNSUBSCRIBED — skipping for entry=${d.entryId} customer=${d.customerId}`);
    return _logAndAdvance(d, 'action_blocked', { reason: 'unsubscribed' }, false);
  }

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

  if (_isDayCrossed(d)) {
    console.log(`[Worker:sms] DAY CROSSED — job enqueued ${d.enqueuedDubaiDate}, skipping send for entry=${d.entryId} node=${d.nodeId}`);
    return _logAndAdvance(d, 'action_blocked', { reason: 'day_crossed', enqueuedDate: d.enqueuedDubaiDate }, false);
  }

  const { rows: [contactSMS] } = await db.query(
    'SELECT email_unsubscribe FROM unified_contacts WHERE id = $1', [d.customerId]
  );
  if (contactSMS?.email_unsubscribe === 'Yes') {
    console.log(`[Worker:sms] UNSUBSCRIBED — skipping for entry=${d.entryId} customer=${d.customerId}`);
    return _logAndAdvance(d, 'action_blocked', { reason: 'unsubscribed' }, false);
  }

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
async function _logAndAdvance(d, eventType, details, _sendSucceeded) {
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
    const nextNode = nodeMap[chosen.target];
    const nextFireAt = JourneyService.calculateNextFireAt(nextNode, new Date(), d.testIntervalMin || null);
    // Guard: only advance if entry is still at this node (stale job protection).
    const { rowCount } = await db.query(
      `UPDATE journey_entries
       SET current_node_id = $1, bullmq_job_id = NULL,
           last_run_id = NULL, last_enqueued_at = NULL,
           next_fire_at = $3
       WHERE entry_id = $2 AND current_node_id = $4`,
      [chosen.target, d.entryId, nextFireAt, d.nodeId]
    );
    if (rowCount === 0) {
      console.log(`[Worker] Stale job skipped advance for entry=${d.entryId} node=${d.nodeId} (already advanced)`);
    } else {
      // Trigger processJourney so next action node fires immediately without waiting for cron
      _scheduleProcess(d.journeyId, nextNode?.type);
    }
  } else {
    const { rowCount } = await db.query(
      `UPDATE journey_entries SET status = 'completed', completed_at = NOW(), bullmq_job_id = NULL
       WHERE entry_id = $1 AND current_node_id = $2`,
      [d.entryId, d.nodeId]
    );
    if (rowCount > 0) await _checkJourneyCompletion(d.journeyId);
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
