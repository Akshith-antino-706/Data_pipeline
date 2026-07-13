import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../config/database.js';
import { getConnection, enqueueGtmJourney } from './queue/index.js';
import WelcomeEmailService from './WelcomeEmailService.js';
import { SendTrackService } from './SendTrackService.js';
import { injectClickTracking, injectOpenPixel } from '../utils/emailTracking.js';
import { renderTemplate, buildLiquidVars } from '../utils/placeholderResolver.js';
import LiquidRenderer from './LiquidRenderer.js';
import { isEmailAllowed } from '../utils/emailAllowlist.js';
import { reserveSend, releaseSend } from '../utils/emailFrequencyCap.js';
import { buildReviewUrl } from '../utils/reviewUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE_PATH = path.join(__dirname, '../templates/email/gtm-welcome.html');

/**
 * GTM (event-triggered) journeys.
 *
 *   journey_type='gtm' + trigger_event='view_item' (etc.)
 *
 * When a contact fires the trigger event, send them a per-user, welcome-style
 * email personalised withenv THAT event's data (item, image, page). Deduped per
 * DISTINCT item per user per journey — so a user who views 6 different tours gets
 * 6 emails (one per tour), but viewing the same tour repeatedly = 1 email.
 *
 * Flow:  recordEvent() → onEvent() → (dedup by itemId) → delayed BullMQ job
 *        → processJob() → render welcome template with payload → send → log.
 *
 * Safety: only WELCOME_EMAILS-allow-listed recipients receive mail (see emailAllowlist).
 */
class GtmJourneyService {
  static get _delayMs() {
    return (parseFloat(process.env.GTM_JOURNEY_DELAY_MIN || '2')) * 60_000;
  }
  // Dedup is per (journey, user, NODE) so the SAME item can send once at each step
  // of a multi-node gtm journey (action → wait → action → …).
  static _dedupKey(journeyId, unifiedId, nodeId) { return `gtmj:j${journeyId}:u${unifiedId}:${nodeId || 'n1'}`; }

  // Wait-node duration → ms. Honors JOURNEY_WAIT_SECS_PER_DAY for testing
  // (e.g. 10 → 1 day = 10s); 0/unset → real days, same as the normal engine.
  static _waitMs(waitDays) {
    const d = parseFloat(waitDays) || 1;
    const secsPerDay = parseFloat(process.env.JOURNEY_WAIT_SECS_PER_DAY || '0');
    return secsPerDay > 0 ? d * secsPerDay * 1000 : d * 86_400_000;
  }

  /**
   * Walk the flow from `fromNodeId` to the NEXT action node, summing any wait-node
   * delays in between (so gtm journeys honor wait nodes just like normal journeys).
   * Returns { nodeId, delayMs } for the next action, or null if the sequence ends.
   */
  static _nextStep(nodes, edges, fromNodeId) {
    const nodeMap = Object.fromEntries((nodes || []).map(n => [n.id, n]));
    let delayMs = 0, cur = fromNodeId;
    const seen = new Set();
    for (;;) {
      const edge = (edges || []).find(e => e.source === cur);
      if (!edge) return null;
      const next = nodeMap[edge.target];
      if (!next || seen.has(next.id)) return null;
      seen.add(next.id);
      if (next.type === 'wait')   { delayMs += this._waitMs(next.data?.waitDays); cur = next.id; continue; }
      if (next.type === 'action') return { nodeId: next.id, delayMs };
      return null; // goal/condition — gtm journeys stop here
    }
  }

  /**
   * Called (fire-and-forget) from GTMService.recordEvent after an event is stored.
   * Finds active gtm journeys listening to this event and enqueues a per-user send,
   * deduped on (journey, user, itemId).
   */
  static async onEvent({ eventName, unifiedId, eventId, itemId }) {
    if (!eventName || !unifiedId) return;
    const { rows: journeys } = await db.query(
      `SELECT journey_id, nodes, edges, custom_segment_id, segment_id, audience
         FROM journey_flows
       WHERE status = 'active' AND journey_type = 'gtm'
         AND trigger_event IS NOT NULL
         AND $1 = ANY(string_to_array(replace(trigger_event, ' ', ''), ','))
         -- DATE CUTOFF: skip real-time enrollment until the journey's trigger_from_date
         -- has arrived (future-dated picker). The event fires "now", so NOW() is its time.
         AND (trigger_from_date IS NULL OR trigger_from_date <= NOW())`,
      [eventName]
    );
    if (!journeys.length) return;

    // CONTINUOUS engine: real-time entry → write a per-user state row (idempotent via the
    // UNIQUE(journey,user,item) constraint). The progression cron fires it; no BullMQ delay.
    const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
    const itemKey = String(itemId ?? '_noitem');
    for (const j of journeys) {
      try {
        // SEGMENT GUARD: the trigger event alone must NOT grant entry. A user only enters
        // if they ALSO belong to the journey's selected segment (+ audience). Without this,
        // any contact firing the trigger blasts into the journey regardless of who was
        // targeted (e.g. a 2-person test segment leaking emails to real customers).
        if (!(await this._isSegmentMember(j, unifiedId))) continue;
        // Entry node + delay = leading wait from the trigger (PDF N1 +1h/+2h/+24h…).
        const triggerNode = (j.nodes || []).find(n => n.type === 'trigger');
        const firstStep = triggerNode ? this._nextStep(j.nodes || [], j.edges || [], triggerNode.id) : null;
        const firstNodeId = firstStep?.nodeId || (j.nodes || []).find(n => n.type === 'action')?.id || null;
        if (!firstNodeId) continue;
        const id = await ContinuousJourneyService.enter({
          journeyId: j.journey_id, unifiedId, itemId: itemKey, eventId,
          firstNodeId, entryDelayMs: firstStep ? firstStep.delayMs : 0,
        });
        if (id) console.log(`[Continuous ${j.journey_id}] entered uid=${unifiedId} item=${itemKey} @ ${firstNodeId} delay=${Math.round((firstStep?.delayMs||0)/1000)}s (${eventName})`);
      } catch (e) { console.error(`[GtmJourney ${j.journey_id}] onEvent failed: ${e.message}`); }
    }
  }

  /**
   * Is `unifiedId` a member of THIS journey's segment (respecting audience)? Used by the
   * real-time onEvent entry path so the trigger event can never bypass the segment the
   * user selected. Reuses JourneyService._journeySegmentRows (the same SQL the start
   * fan-out uses) so membership is defined identically everywhere. Imported dynamically
   * to avoid the JourneyService↔GtmJourneyService circular import.
   *
   * Returns false when the journey has no segment — a trigger journey with no segment has
   * no audience to honour, so we don't enter anyone (prevents the J193-style blast).
   */
  static async _isSegmentMember(journey, unifiedId) {
    if (!unifiedId) return false;
    const { default: JourneyService } = await import('./JourneyService.js');
    const segRows = await JourneyService._journeySegmentRows(journey).catch(() => null);
    if (!segRows) {
      console.warn(`[Continuous ${journey.journey_id}] no segment — onEvent entry skipped for uid=${unifiedId}`);
      return false;
    }
    const { sql, params } = segRows;
    const { rows } = await db.query(
      `SELECT 1 FROM (${sql}) m WHERE m.id = $${params.length + 1} LIMIT 1`,
      [...params, unifiedId]
    );
    return rows.length > 0;
  }

  /**
   * Fan-out at journey START (segment-based, like a normal journey). Given the
   * pre-resolved rows [{ unifiedId, eventId, itemId }] — one per (segment user ×
   * DISTINCT triggered item) — enqueue one prefilled email each, deduped per
   * (journey, user, item). Users with no matching event aren't in `rows`, so they
   * are skipped automatically. Returns the number of emails queued.
   */
  static async enqueueForStart(journeyId, rows, firstNodeId) {
    const conn = getConnection();
    let queued = 0;
    for (const r of rows) {
      try {
        const itemKey = String(r.itemId ?? '_noitem');
        const key = this._dedupKey(journeyId, r.unifiedId, firstNodeId);
        if (await conn.sismember(key, itemKey)) continue;   // already emailed this item at node 1
        await conn.sadd(key, itemKey);
        await enqueueGtmJourney({ journeyId, unifiedId: r.unifiedId, eventId: r.eventId, nodeId: firstNodeId, itemId: itemKey }, this._delayMs);
        queued++;
      } catch (e) { console.error(`[GtmJourney ${journeyId}] enqueueForStart failed uid=${r.unifiedId}: ${e.message}`); }
    }
    return queued;
  }

  /** Worker entry — render the node's email, send, then schedule the next node (after any wait). */
  static async processJob({ entryId, journeyId, unifiedId, eventId, nodeId: jobNodeId, itemId }) {
    if (!unifiedId) return;

    // Full contact row — feeds the USER_*, RID, BOOKING_STATUS, PRODUCT_TIER, etc. keys.
    const { rows: [c] } = await db.query(
      `SELECT id, email, name, mobile, city, country, is_indian, booking_status,
              product_tier, segments, geography, email_unsubscribe
       FROM unified_contacts WHERE id = $1`, [unifiedId]
    );
    if (!c?.email) { console.warn(`[GtmJourney ${journeyId}] uid=${unifiedId} no email — skip`); return; }

    // ── Per-node snapshot refresh: re-apply the GTM exit conditions at EVERY node ──
    // (not just the start fan-out). So a user who unsubscribes, or buys this item during
    // the wait between nodes, is dropped from the rest of the sequence — no further sends.
    // IMPORTANT: also MARK the entry exited (not just skip the send), so a purchase that
    // lands after the cron already enqueued this job still flips the row to 'exited' here.
    const _exit = async (reason) => {
      if (entryId) await db.query(
        `UPDATE gtm_journey_entries SET status='exited', exit_reason=$2, next_fire_at=NULL, updated_at=NOW() WHERE id=$1 AND status='active'`,
        [entryId, reason]
      ).catch(() => {});
      console.log(`[GtmJourney ${journeyId}] uid=${unifiedId} item=${itemId} ${reason} — EXITED at node ${jobNodeId}, send skipped`);
    };
    if (String(c.email_unsubscribe || '').toLowerCase() === 'yes') { await _exit('unsubscribed'); return; }
    if (itemId && itemId !== '_noitem') {
      const { rows: [bought] } = await db.query(
        `SELECT 1 FROM gtm_events
         WHERE unified_id = $1 AND event_name = 'purchase'
           AND COALESCE(raw_payload->>'itemId', '') = $2 LIMIT 1`,
        [unifiedId, String(itemId)]
      );
      if (bought) { await _exit('purchased'); return; }
    }

    // Full triggering event — feeds PAGE_URL, EVENT_*, JOURNEY_ID, NODE_ID + raw_payload.
    let eventRow = { event_id: eventId, event_name: null, page_url: null, page_title: null, raw_payload: {}, created_at: null, journey_id: journeyId, node_id: null };
    if (eventId) {
      const { rows: [ev] } = await db.query(
        `SELECT event_id, event_name, page_url, page_title, raw_payload, created_at, journey_id, node_id
         FROM gtm_events WHERE event_id = $1`, [eventId]
      );
      if (ev) eventRow = ev;
    }

    // ── Template selected on the journey's action node ──
    // Each GTM event can have its own template using ANY of the 60 master placeholder
    // keys; the universal resolver fills them all from contact + event + raw_payload +
    // ecommerce + generated URLs. Falls back to the bundled gtm-welcome.html if none.
    const { rows: [jf] } = await db.query('SELECT nodes, edges FROM journey_flows WHERE journey_id = $1', [journeyId]);
    const nodes = jf?.nodes || [];
    // Send the SPECIFIC node this job is for (multi-step); fall back to the first action node.
    const actionNode = (jobNodeId ? nodes.find(n => n.id === jobNodeId && n.type === 'action') : null)
      || nodes.find(n => n.type === 'action');
    const nodeId = actionNode?.id || null;

    // WELCOME_EMAILS allow-list gate (validate the real user). Off-list → skip the send
    // and advance the entry so the continuous journey progresses (no send, no retry storm).
    if (!isEmailAllowed(c.email)) {
      console.log(`[GtmJourney ${journeyId}] uid=${unifiedId} ${c.email} not in WELCOME_EMAILS — send skipped`);
      if (entryId) {
        const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
        await ContinuousJourneyService.advance(entryId, journeyId, nodeId).catch(() => {});
      }
      return;
    }

    const templateId = actionNode?.data?.emailTemplateId ?? actionNode?.data?.templateId ?? null;

    let tplBody = null, tplSubject = null;
    if (templateId) {
      const { rows: [t] } = await db.query('SELECT subject, body, html_template_id FROM content_templates WHERE id = $1', [parseInt(templateId)]).catch(() => ({ rows: [] }));
      if (t?.body) tplBody = t.body;
      if (t?.subject) tplSubject = t.subject;
      // The HTML for most templates lives in the linked email_html_templates row
      // (content_templates.body is often empty). Use that when there's no inline body.
      if (!tplBody && t?.html_template_id) {
        const { rows: [h] } = await db.query('SELECT html_body, subject_line FROM email_html_templates WHERE id = $1', [t.html_template_id]).catch(() => ({ rows: [] }));
        if (h?.html_body) tplBody = h.html_body;
        if (!tplSubject && h?.subject_line) tplSubject = h.subject_line;
      }
    }
    if (!tplBody) { tplBody = fs.readFileSync(DEFAULT_TEMPLATE_PATH, 'utf8'); console.warn(`[GtmJourney ${journeyId}] node template ${templateId} has no HTML — using default welcome template`); }

    // Universal placeholder fill — body AND subject (subjects may contain keys too).
    const ctx = { contact: c, event: eventRow, payload: eventRow.raw_payload || {} };
    // Liquid templates (contain {% … %}) render via LiquidRenderer with the full items[]
    // array so {% for item in items %} shows every cart product; plain {{KEY}}-only
    // templates keep the regex resolver (items[0] scalars only).
    let html = /\{%/.test(tplBody)
      ? await LiquidRenderer.render(tplBody, buildLiquidVars(ctx))
      : renderTemplate(tplBody, ctx);
    let subject = renderTemplate(tplSubject || 'Welcome to Rayna Tours 🌴', ctx);

    // Per-recipient review link (post-trip templates carry the %%REVIEW_URL%% sentinel).
    // placeholderResolver leaves it untouched, so swap it here for a feedback link
    // pre-filled with THIS contact's most recent trip. Same as the normal-journey worker.
    if (html && html.includes('%%REVIEW_URL%%')) {
      const reviewUrl = await buildReviewUrl(c.id).catch(() => null);
      if (reviewUrl) {
        html = html.split('%%REVIEW_URL%%').join(reviewUrl);
        console.log(`[GtmJourney ${journeyId}] injected review link for uid=${c.id}`);
      }
    }

    // ── AI recommendation injection + allowlist gate — additive. Existing
    //    GTM journeys have recommendation_type = NULL → this whole block is
    //    skipped. When set, REC_JOURNEY_ALLOWLIST decides delivery. ──
    let recAllowlistBlocked = false;
    try {
      const { rows: [jf] } = await db.query(
        `SELECT recommendation_type FROM journey_flows WHERE journey_id = $1`,
        [journeyId]
      );
      if (jf?.recommendation_type) {
        const { injectPerUserProducts, isRecipientAllowedForRec } = await import('./RecommendationRenderer.js');
        if (!isRecipientAllowedForRec(c.email)) {
          console.log(`[GtmJourney ${journeyId}] REC ALLOWLIST BLOCKED — ${c.email} not in REC_JOURNEY_ALLOWLIST (type=${jf.recommendation_type}). Skipping send + advancing.`);
          recAllowlistBlocked = true;
        } else if (html && html.includes('{{#products}}')) {
          const injected = await injectPerUserProducts({
            templateHtml:       html,
            unifiedId:          c.id,
            recommendationType: jf.recommendation_type,
            vars: { customer_name: c.name || '' },
          });
          if (injected?.html) {
            html = injected.html;
            console.log(`[GtmJourney ${journeyId}] AI recs injected → type=${jf.recommendation_type} products=${injected.productsUsed?.length || 0} source=${injected.source} fromCache=${injected.fromCache}`);
          }
        }
      }
    } catch (recErr) {
      console.warn(`[GtmJourney ${journeyId}] AI rec injection failed (falling back): ${recErr.message}`);
    }

    // If the recipient was blocked by REC_JOURNEY_ALLOWLIST, don't send — but
    // still advance the entry so the journey doesn't spin on this user.
    if (recAllowlistBlocked) {
      if (entryId) {
        const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
        await ContinuousJourneyService.advance(entryId, journeyId, nodeId).catch(() => {});
      }
      return;
    }

    const recipientEmail = c.email;

    // Frequency cap (max N / 24h per recipient) — skip + advance if over the limit.
    const _cap = await reserveSend({ unifiedId: c.id, email: recipientEmail });
    if (!_cap.allowed) {
      console.log(`[GtmJourney ${journeyId}] FREQUENCY CAPPED uid=${c.id} count=${_cap.count} — skip + advance`);
      if (entryId) {
        const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
        await ContinuousJourneyService.advance(entryId, journeyId, nodeId).catch(() => {});
      }
      return;
    }

    const logId = await SendTrackService.logSend({
      unifiedId: c.id, email: recipientEmail, contactName: c.name, subject,
      templateLabel: `GTM Journey ${journeyId}`, source: 'gtm_journey', journeyId, nodeId,
    });

    // Inject click/open tracking (so product links + opens are tracked, like normal sends)
    let baseUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || 'https://promotions.raynatours.com';
    // Safety net: a mis-set env (e.g. TRACKING_BASE_URL=http://localhost:3001) must NEVER
    // ship localhost tracking links on real sends. In production, force the public domain.
    // (Local dev keeps localhost so tracking can be tested against a local server.)
    if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(baseUrl)) {
      baseUrl = 'https://promotions.raynatours.com';
    }
    html = injectClickTracking(html, { logId, baseUrl, campaign: `gtm_${journeyId}`, content: 'gtm_journey', unifiedId: c.id, journeyId, nodeId });
    html = injectOpenPixel(html, logId, baseUrl);

    const EmailChannel = await WelcomeEmailService._loadEmailChannel();
    const start = Date.now();
    const res = await EmailChannel.send({ to: recipientEmail, subject, html });
    const ms = Date.now() - start;

    if (res?.success) {
      await SendTrackService.markSent(logId, { externalId: res.externalId || null, provider: res.provider || null, durationMs: ms }).catch(() => {});
      console.log(`[GtmJourney ${journeyId}] ✓ sent to=${recipientEmail} node=${nodeId}`);

      // ── Advance the per-user state row: next action node (after any wait) or complete ──
      // CONTINUOUS engine: the wait lives in gtm_journey_entries.next_fire_at; the 1-min
      // cron fires the next node. (Wait nodes work: action → wait N days → next action.)
      try {
        if (entryId) {
          const { default: ContinuousJourneyService } = await import('./ContinuousJourneyService.js');
          const r = await ContinuousJourneyService.advance(entryId, journeyId, nodeId);
          console.log(`[Continuous ${journeyId}] entry=${entryId} ${r.completed ? 'COMPLETED' : `→ ${r.advancedTo} in ${Math.round(r.delayMs / 1000)}s`}`);
        }
      } catch (e) { console.error(`[GtmJourney ${journeyId}] advance failed: ${e.message}`); }
    } else {
      releaseSend({ unifiedId: c.id, email: recipientEmail }); // failed send doesn't consume a slot
      await SendTrackService.markFailed(logId, { error: res?.error || 'unknown', provider: res?.provider || null, durationMs: ms }).catch(() => {});
      throw new Error(res?.error || 'gtm journey send failed'); // let BullMQ retry
    }
  }
}

export default GtmJourneyService;
