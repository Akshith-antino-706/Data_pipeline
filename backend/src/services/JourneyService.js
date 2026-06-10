import db from '../config/database.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PopularityService from './PopularityService.js';
import { enqueueBatch } from './queue/index.js';
import CustomSegmentService from './CustomSegmentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const MAIL_TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'mail_templates');

// Cache rankings for 1 hour so Claude is called once per batch, not once per email
const _rankingCache = new Map();
// Tracks the source ('claude' | 'fallback' | ...) of the most recent ranking fetch
// in this render. Read by getDailyAITemplate immediately after renderDayHtml (the
// daily generation loop is sequential, so no cross-render race).
let _lastRankingSource = 'claude';
async function _getCachedRanking(key, fetchFn) {
  const cached = _rankingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) { _lastRankingSource = cached.source || 'claude'; return cached.ranking; }
  const result = await fetchFn();
  const ranking = result.ranking || result;
  _lastRankingSource = result.source || 'claude';
  _rankingCache.set(key, { ranking, source: _lastRankingSource, expiresAt: Date.now() + 60 * 60 * 1000 });
  return ranking;
}

// Global serialization lock for Claude ranking calls. Anthropic rate-limits
// concurrent web_search requests — firing several rankings at once (multiple
// journeys, the Day6 6-destination loop, preview while a journey runs) makes some
// 429 and fall back. We chain all Claude ranking calls so only ONE runs at a time.
let _claudeLock = Promise.resolve();
function _serializeClaude(fn) {
  const run = _claudeLock.then(fn, fn);
  // Keep the chain alive regardless of this call's outcome
  _claudeLock = run.then(() => {}, () => {});
  return run;
}

// Calls the ranking fn, retrying once on a non-key failure (transient rate-limit/
// timeout) before accepting a fallback. Serialized so calls never burst.
async function _rankWithRetry(fetchFn) {
  return _serializeClaude(async () => {
    let result = await fetchFn();
    // 'fallback' = Claude was attempted but errored (429/timeout). Retry once.
    // 'fallback_no_api_key' = key missing — retry is pointless, accept it.
    if (result?.source === 'fallback') {
      await new Promise(r => setTimeout(r, 3000));
      const retry = await fetchFn();
      if (retry?.source === 'claude') result = retry;
    }
    return result;
  });
}

/**
 * Frozen per-node ranking. The ranking for a (journey, node) is computed ONCE
 * (Claude called once) and persisted in journey_node_rankings. Every subsequent
 * read — preview OR actual send — returns the SAME frozen ranking, so the preview
 * is byte-identical to the email contacts receive.
 *
 * Falls back to the in-memory global cache when journeyId/nodeId aren't provided
 * (e.g. generic content previews).
 */
async function _getFrozenRanking(journeyId, nodeId, rankingType, fetchFn) {
  if (!journeyId || !nodeId) {
    return _getCachedRanking(rankingType, fetchFn);
  }
  // 1. Return frozen ranking if it exists
  const { rows: [existing] } = await db.query(
    'SELECT ranking FROM journey_node_rankings WHERE journey_id = $1 AND node_id = $2 AND ranking_type = $3',
    [journeyId, nodeId, rankingType]
  );
  if (existing?.ranking) return existing.ranking;

  // 2. First time — call Claude (serialized + retry-once), then freeze it
  const result = await _rankWithRetry(fetchFn);
  const ranking = result.ranking || result;
  await db.query(
    `INSERT INTO journey_node_rankings (journey_id, node_id, ranking_type, ranking, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (journey_id, node_id, ranking_type) DO NOTHING`,
    [journeyId, nodeId, rankingType, JSON.stringify(ranking), result.source || 'claude']
  );
  // Re-read in case a concurrent worker won the INSERT race — guarantees all
  // workers for this node use the exact same frozen ranking.
  const { rows: [frozen] } = await db.query(
    'SELECT ranking FROM journey_node_rankings WHERE journey_id = $1 AND node_id = $2 AND ranking_type = $3',
    [journeyId, nodeId, rankingType]
  );
  return frozen?.ranking || ranking;
}

// Day6 destination list — module-level so render + prewarm agree.
const DAY6_DESTINATIONS = ['singapore', 'bangkok', 'phuket', 'bali', 'kuala_lumpur', 'istanbul'];

// Pick ONE destination per (journey, node) — deterministic, same for every contact
// AND the preview. This makes Day6 behave like Day4/5: one shared, frozen, AI-ranked
// destination that all users receive, so preview == sent.
function _day6DestKey(journeyId, nodeId) {
  const seed = `${journeyId}_${nodeId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return DAY6_DESTINATIONS[hash % DAY6_DESTINATIONS.length];
}

// Render the real Day HTML for a contact using the same Day renderers.
// Uses fallback ranking (no Claude API call) to keep sends fast.
export async function renderDayHtml(templateId, contactId, { journeyId, nodeId, extraVars = {} } = {}) {
  const id = parseInt(templateId);
  const tplFile = (name) => fs.readFileSync(path.join(MAIL_TEMPLATES_DIR, name), 'utf8');

  // Apply extra variable substitutions to a rendered result
  const applyExtraVars = (result) => {
    if (!result || !extraVars || Object.keys(extraVars).length === 0) return result;
    let { html, subject } = result;
    for (const [key, val] of Object.entries(extraVars)) {
      const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      html    = html.replace(re, String(val ?? ''));
      subject = subject.replace(re, String(val ?? ''));
    }
    return { ...result, html, subject };
  };

  if (id === 1) {
    const { default: rankTrendingWelcome }    = await import('./Day1WelcomeRankingService.js');
    const { buildDay1WelcomeData }            = await import('./Day1WelcomeDataService.js');
    const { renderDay1Welcome }               = await import('./Day1WelcomeRenderer.js');
    const ranking = await _getFrozenRanking(journeyId, nodeId, 'welcome', rankTrendingWelcome);
    const data = await buildDay1WelcomeData({ contactId, ranking, journeyId, nodeId });
    return applyExtraVars({ html: renderDay1Welcome(tplFile('day1-welcome-dynamic.html'), data), subject: 'Your Rayna Tours Journey Starts Here' });
  }
  if (id === 2) {
    const { default: rankTrendingCruises }    = await import('./Day2CruiseRankingService.js');
    const { buildDay2CruiseData }             = await import('./Day2CruiseDataService.js');
    const { renderDay2Cruise }                = await import('./Day2CruiseRenderer.js');
    const ranking = await _getFrozenRanking(journeyId, nodeId, 'cruise', rankTrendingCruises);
    const data    = await buildDay2CruiseData({ contactId, ranking, journeyId, nodeId });
    return applyExtraVars({ html: renderDay2Cruise(tplFile('day2-cruise-dynamic.html'), data), subject: 'Set Sail: Cruise Highlights from Rayna Tours' });
  }
  if (id === 3) {
    const { rankTrendingVisas }             = await import('./VisaRankingService.js');
    const { buildDay3VisaData }             = await import('./Day3VisaDataService.js');
    const { renderDay3Visa }                = await import('./Day3VisaRenderer.js');
    const ranking = await _getFrozenRanking(journeyId, nodeId, 'visa', rankTrendingVisas);
    if (!ranking.ratings_keys) ranking.ratings_keys = ['rayna', 'trustpilot', 'tripadvisor', 'google'];
    const data = await buildDay3VisaData({ contactId, ranking, journeyId, nodeId });
    return applyExtraVars({ html: renderDay3Visa(tplFile('day3-visa-dynamic.html'), data), subject: 'Your Visa, Sorted | Rayna Tours' });
  }
  if (id === 4) {
    const { default: rankTrendingHolidays } = await import('./Day4HolidaysRankingService.js');
    const { buildDay4HolidaysData } = await import('./Day4HolidaysDataService.js');
    const { renderDay4Holidays }    = await import('./Day4HolidaysRenderer.js');
    const ranking = await _getFrozenRanking(journeyId, nodeId, 'holidays', rankTrendingHolidays);
    const data    = await buildDay4HolidaysData({ contactId, ranking, journeyId, nodeId });
    return applyExtraVars({ html: renderDay4Holidays(tplFile('day4-holidays-dynamic.html'), data), subject: 'Curated Trips Selected for You | Rayna Tours' });
  }
  if (id === 5) {
    const { default: rankTrendingActivities } = await import('./Day5ActivitiesRankingService.js');
    const { buildDay5ActivitiesData } = await import('./Day5ActivitiesDataService.js');
    const { renderDay5Activities }    = await import('./Day5ActivitiesRenderer.js');
    const ranking = await _getFrozenRanking(journeyId, nodeId, 'activities', rankTrendingActivities);
    const data    = await buildDay5ActivitiesData({ contactId, ranking, journeyId, nodeId });
    return applyExtraVars({ html: renderDay5Activities(tplFile('day5-activities-dynamic.html'), data), subject: 'Top Activities in Dubai | Rayna Tours' });
  }
  if (id === 6) {
    const { default: rankDestinationSpotlight } = await import('./Day6DestinationRankingService.js');
    const { buildDay6DestinationData } = await import('./Day6DestinationDataService.js');
    const { renderDay6Destination }    = await import('./Day6DestinationRenderer.js');
    // ONE destination per node (deterministic) — same for every contact + preview,
    // so Claude is called once and all users at this node get the identical email.
    const destKey = _day6DestKey(journeyId, nodeId);
    const ranking = await _getFrozenRanking(journeyId, nodeId, `destination_${destKey}`, () => rankDestinationSpotlight({ destinationKey: destKey }));
    const data    = await buildDay6DestinationData({ contactId, destinationKey: destKey, ranking, journeyId, nodeId });
    return applyExtraVars({ html: renderDay6Destination(tplFile('day6-destination-dynamic.html'), data), subject: 'Your Next Destination Awaits | Rayna Tours' });
  }
  if (id === 7) {
    const { buildDay7AbandonedCartData } = await import('./Day7AbandonedCartDataService.js');
    const { renderDay7AbandonedCart }    = await import('./Day7AbandonedCartRenderer.js');
    const data = await buildDay7AbandonedCartData({ contactId, journeyId, nodeId });
    return applyExtraVars({ html: renderDay7AbandonedCart(tplFile('day7-abandoned-cart-dynamic.html'), data), subject: 'You Left Something Behind | Rayna Tours' });
  }
  return null; // unknown template — fall back to EmailRenderer
}

/**
 * Daily AI master template. Claude is called at most ONCE per (template, day):
 *   - Returns today's stored row if it exists.
 *   - Else renders via renderDayHtml (Claude/fallback), stores today's row, returns it.
 *
 * Used by /content "Preview AI" and as the SOURCE journey nodes snapshot from.
 * `dateStr` defaults to today (UTC); pass a specific date to read a past day's master.
 */
export async function getDailyAITemplate(templateId, dateStr = null) {
  const tid = parseInt(templateId);
  const day = dateStr || new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  const { rows: [existing] } = await db.query(
    'SELECT subject, html, source FROM daily_ai_templates WHERE template_id = $1 AND render_date = $2',
    [tid, day]
  );
  if (existing?.html) {
    return { html: existing.html, subject: existing.subject, source: existing.source, day, stored: true };
  }

  // Not generated yet today — render once (Claude) and store. No journeyId/nodeId →
  // renderDayHtml uses the in-memory cached ranking (Claude), not per-node freezing.
  const rendered = await renderDayHtml(tid, 'preview', {});
  if (!rendered?.html) return null; // not a dynamic Day template (1-7)
  const source = _lastRankingSource || 'claude'; // captured during the render above

  await db.query(
    `INSERT INTO daily_ai_templates (template_id, render_date, subject, html, source)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (template_id, render_date) DO NOTHING`,
    [tid, day, rendered.subject, rendered.html, source]
  );
  const { rows: [frozen] } = await db.query(
    'SELECT subject, html, source FROM daily_ai_templates WHERE template_id = $1 AND render_date = $2',
    [tid, day]
  );
  return frozen?.html
    ? { html: frozen.html, subject: frozen.subject, source: frozen.source, day, stored: true }
    : { html: rendered.html, subject: rendered.subject, source, day, stored: false };
}

/**
 * Generate + store today's daily master for all 7 dynamic templates. Called by the
 * daily cron (and can be triggered manually). One Claude call per template, serialized.
 */
export async function generateDailyAITemplates() {
  const results = [];
  for (const tid of [1, 2, 3, 4, 5, 6, 7]) {
    try {
      const r = await getDailyAITemplate(tid);
      results.push({ templateId: tid, source: r?.source || 'none', bytes: r?.html?.length || 0 });
    } catch (err) {
      results.push({ templateId: tid, error: err.message });
    }
  }
  return results;
}

/**
 * Get the per-node frozen email for a journey node. Snapshots from the DAILY MASTER
 * at first touch (send or preview), so:
 *   - Claude is NOT called per node — it copies today's daily master.
 *   - The snapshot is frozen forever, so preview of this node always == what was sent,
 *     even after the daily master regenerates on later days.
 *
 * Returns null if the template isn't a dynamic Day template (caller falls back).
 */
export async function getOrGenerateNodeEmail({ journeyId, nodeId, templateId }) {
  if (!journeyId || !nodeId) return null;

  // 1. Return the node's frozen snapshot if it exists
  const { rows: [stored] } = await db.query(
    'SELECT subject, html, source FROM journey_node_emails WHERE journey_id = $1 AND node_id = $2',
    [journeyId, nodeId]
  );
  if (stored?.html) {
    return { html: stored.html, subject: stored.subject, source: stored.source, stored: true };
  }

  // 2. First touch — copy TODAY's daily master into this node's frozen snapshot
  const master = await getDailyAITemplate(templateId);
  if (!master?.html) return null; // not a Day template — caller handles fallback

  await db.query(
    `INSERT INTO journey_node_emails (journey_id, node_id, template_id, subject, html, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (journey_id, node_id) DO NOTHING`,
    [journeyId, nodeId, parseInt(templateId), master.subject, master.html, master.source]
  );
  // Re-read so concurrent first-callers all return the exact same frozen snapshot
  const { rows: [frozen] } = await db.query(
    'SELECT subject, html, source FROM journey_node_emails WHERE journey_id = $1 AND node_id = $2',
    [journeyId, nodeId]
  );
  return frozen?.html
    ? { html: frozen.html, subject: frozen.subject, source: frozen.source, stored: true }
    : { html: master.html, subject: master.subject, source: master.source, stored: false };
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

    // Get entry stats.
    // exited_unsubscribed = all exits with exit_reason='unsubscribed' (includes pre-existing).
    // unsubscribed_from_journey = distinct users who explicitly clicked the unsubscribe link
    //   in an email from THIS journey (sourced from unsubscribe_log, campaign='email_link').
    // pre_existing_unsub = exited as unsubscribed but never received any send from this journey
    //   (bulk-exited on first cron tick because already unsubscribed at enrollment time).
    const [entryStatsRes, unsubLogRes, nodeUnsubLogRes] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) AS total_entries,
          COUNT(*) FILTER (WHERE status = 'snapshot') AS snapshot,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'converted') AS converted,
          COUNT(*) FILTER (WHERE status = 'exited') AS exited,
          COUNT(*) FILTER (WHERE status = 'exited' AND exit_reason = 'booked') AS exited_booked,
          COUNT(*) FILTER (WHERE status = 'exited' AND exit_reason = 'unsubscribed') AS exited_unsubscribed,
          COUNT(*) FILTER (WHERE status = 'exited' AND exit_reason = 'unsubscribed' AND NOT had_send) AS pre_existing_unsub
        FROM (
          SELECT je.*,
            EXISTS (
              SELECT 1 FROM journey_events jev
              WHERE jev.entry_id = je.entry_id AND jev.event_type = 'action_sent'
            ) AS had_send
          FROM journey_entries je
          WHERE je.journey_id = $1
        ) t
      `, [journeyId]),
      // Header total: distinct users who unsubscribed from this journey (any source)
      db.query(
        `SELECT COUNT(DISTINCT unified_id) AS unsubscribed_from_journey
         FROM unsubscribe_log WHERE journey_id = $1`,
        [journeyId]
      ),
      // Per-node unsub counts: how many users unsubscribed attributed to each node
      db.query(
        `SELECT node_id, COUNT(DISTINCT unified_id) AS unsub_count
         FROM unsubscribe_log
         WHERE journey_id = $1 AND node_id IS NOT NULL
         GROUP BY node_id`,
        [journeyId]
      ),
    ]);

    const entryStats = {
      ...entryStatsRes.rows[0],
      unsubscribed_from_journey: parseInt(unsubLogRes.rows[0]?.unsubscribed_from_journey) || 0,
    };

    // Build per-node unsub map: { node_id → count }
    const nodeUnsubCounts = {};
    for (const row of nodeUnsubLogRes.rows) {
      nodeUnsubCounts[row.node_id] = parseInt(row.unsub_count) || 0;
    }

    // Get per-node analytics
    const { rows: nodeAnalytics } = await db.query(`
      SELECT node_id, event_type, channel, COUNT(*) AS event_count
      FROM journey_events je
      JOIN journey_entries jen ON jen.entry_id = je.entry_id
      WHERE jen.journey_id = $1
      GROUP BY node_id, event_type, channel
      ORDER BY node_id
    `, [journeyId]);

    // Compute per-node lifecycle status from live journey_entries.
    // 6 possible statuses:
    //   pending   – no entry has reached this node yet
    //   running   – cron is actively advancing entries (trigger / condition / goal / wait elapsed)
    //   sending   – entries are queued in BullMQ, workers are sending (action nodes)
    //   waiting   – entries are here but next_fire_at is in the future (wait nodes serving time)
    //   paused    – journey is paused, entries frozen at this node
    //   completed – all entries have passed through, none remain active here
    let node_statuses = {};
    const nodes = journey.nodes || [];
    if (journey.status === 'draft') {
      nodes.forEach(n => { node_statuses[n.id] = 'pending'; });
    } else if (journey.status === 'completed') {
      nodes.forEach(n => { node_statuses[n.id] = 'completed'; });
    } else {
      // active / paused — derive from entries
      // Richer query: per-node entry breakdown
      //   enqueued = stamped with last_enqueued_at in last 2 hours (in BullMQ queue)
      //   in_wait  = next_fire_at is in the future (wait node time-guard active)
      const { rows: activeOnNode } = await db.query(`
        SELECT
          current_node_id,
          COUNT(*)                                                                          AS total,
          COUNT(*) FILTER (WHERE next_fire_at IS NULL OR next_fire_at <= NOW())             AS due_now,
          COUNT(*) FILTER (WHERE last_enqueued_at IS NOT NULL
            AND last_enqueued_at > NOW() - INTERVAL '2 hours'
            AND (next_fire_at IS NULL OR next_fire_at <= NOW()))                           AS enqueued,
          COUNT(*) FILTER (WHERE next_fire_at > NOW())                                     AS in_wait
        FROM journey_entries
        WHERE journey_id = $1 AND status = 'active'
        GROUP BY current_node_id
      `, [journeyId]);

      const { rows: processedNodes } = await db.query(
        `SELECT DISTINCT je.node_id
         FROM journey_events je
         JOIN journey_entries jen ON jen.entry_id = je.entry_id
         WHERE jen.journey_id = $1
           AND je.event_type IN ('action_sent','action_blocked','action_failed','condition_evaluated','converted')`,
        [journeyId]
      );

      // Build lookup maps
      const activeSet    = new Set(activeOnNode.map(r => r.current_node_id));
      const processedSet = new Set(processedNodes.map(r => r.node_id));
      const inWaitMap    = Object.fromEntries(activeOnNode.map(r => [r.current_node_id, parseInt(r.in_wait)  || 0]));
      const dueNowMap    = Object.fromEntries(activeOnNode.map(r => [r.current_node_id, parseInt(r.due_now)  || 0]));
      const isPaused     = journey.status === 'paused';

      // Lowest sequential index among nodes currently holding active entries (used for paused boundary)
      const runningIndexes = nodes.reduce((acc, n, i) => { if (activeSet.has(n.id)) acc.push(i); return acc; }, []);
      const minRunning = runningIndexes.length > 0 ? Math.min(...runningIndexes) : nodes.length;

      // Linear "leading edge" view: only the EARLIEST action node actively sending
      // shows SENDING; the FIRST wait node after it shows WAITING. Everything else
      // shows PENDING — even if stragglers from previous runs are sitting downstream.
      // This keeps the dashboard reflecting the main-wave's current step, not noise.

      // 1. Earliest action node with entries currently due to fire
      // Using due_now (next_fire_at <= NOW) rather than the unreliable
      // last_enqueued_at timestamp, which becomes stale during long bursts.
      let sendingIdx = -1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.type === 'action' && activeSet.has(n.id) && (dueNowMap[n.id] || 0) > 0) {
          sendingIdx = i;
          break;
        }
      }

      // 2. First wait node positioned after the sending node
      let waitingIdx = -1;
      if (sendingIdx !== -1) {
        for (let i = sendingIdx + 1; i < nodes.length; i++) {
          if (nodes[i].type === 'wait') { waitingIdx = i; break; }
        }
      }

      nodes.forEach((n, i) => {
        if (isPaused) {
          node_statuses[n.id] = i < minRunning ? 'completed' : 'paused';
          return;
        }

        // Trigger node: always completed once journey is active and entries moved past it
        if (n.type === 'trigger' && !activeSet.has(n.id)) {
          node_statuses[n.id] = 'completed';
          return;
        }

        if (sendingIdx !== -1) {
          // Active send wave in progress — use leading-edge view
          if (i === sendingIdx)               node_statuses[n.id] = 'sending';
          else if (i === waitingIdx)          node_statuses[n.id] = 'waiting';
          else if (n.type === 'goal')         node_statuses[n.id] = 'monitoring';
          else if (i < sendingIdx && processedSet.has(n.id)) node_statuses[n.id] = 'completed';
          else                                node_statuses[n.id] = 'pending';
        } else {
          // No action node currently due (sendHour-blocked, between waves, or all done).
          if (activeSet.has(n.id)) {
            const inWait = inWaitMap[n.id] || 0;
            node_statuses[n.id] = (n.type === 'wait' || inWait > 0) ? 'waiting' : 'sending';
          } else if (n.type === 'goal') {
            node_statuses[n.id] = 'monitoring';
          } else if (processedSet.has(n.id)) {
            node_statuses[n.id] = 'completed';
          } else {
            node_statuses[n.id] = 'pending';
          }
        }
      });

      // Persist node_statuses to DB so it's available without recomputing
      await db.query(
        `UPDATE journey_flows SET node_statuses = $1 WHERE journey_id = $2`,
        [JSON.stringify(node_statuses), journeyId]
      );
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

    // ── Per-node user stats (active, exited by reason, completed at each node) ──
    const { rows: nodeUserStats } = await db.query(`
      SELECT current_node_id, status, exit_reason, COUNT(*)::int AS cnt
      FROM journey_entries WHERE journey_id = $1
      GROUP BY current_node_id, status, exit_reason
    `, [journeyId]);

    const node_stats = {};
    for (const row of nodeUserStats) {
      const nid = row.current_node_id;
      if (!node_stats[nid]) node_stats[nid] = { snapshot: 0, active: 0, exited_booked: 0, exited_unsubscribed: 0, completed: 0, total: 0 };
      const s = node_stats[nid];
      s.total += row.cnt;
      if (row.status === 'snapshot') s.snapshot += row.cnt;
      else if (row.status === 'active') s.active += row.cnt;
      else if (row.status === 'completed') s.completed += row.cnt;
      else if (row.status === 'exited' || row.status === 'converted') {
        if (row.exit_reason === 'booked') s.exited_booked += row.cnt;
        else if (row.exit_reason === 'unsubscribed') s.exited_unsubscribed += row.cnt;
        else s.exited_booked += row.cnt; // fallback
      }
    }

    // Per-node ranking source ('claude' | 'fallback' | 'fallback_no_api_key')
    // so the UI can flag nodes that fell back instead of AI-ranking.
    const { rows: rankingRows } = await db.query(
      `SELECT node_id, ARRAY_AGG(DISTINCT source) AS sources
       FROM journey_node_rankings WHERE journey_id = $1 GROUP BY node_id`,
      [journeyId]
    );
    const node_ranking_sources = {};
    for (const r of rankingRows) {
      // If any ranking_type for this node used claude, mark claude; else fallback
      node_ranking_sources[r.node_id] = (r.sources || []).includes('claude') ? 'claude' : 'fallback';
    }

    return { ...journey, entryStats, nodeAnalytics, nodeEntryCounts, nodeUnsubCounts, node_statuses, node_stats, node_ranking_sources };
  }

  /**
   * Populate journey_entries for a journey in batches.
   * - Standard segment: single SQL INSERT...SELECT (fast, all server-side)
   * - Custom segment: paginated 5 000-row batches to avoid huge $3::bigint[] arrays
   * Returns final snapshotCount and updates journey_flows.snapshot_count.
   */
  static async _snapshotEntries(journeyId, { customSegmentId, stdSegmentId, audience, firstNodeId }) {
    let snapshotCount = 0;

    if (customSegmentId) {
      // Use buildSegmentSQL to get a pure-SQL subquery — no OFFSET pagination, fully server-side.
      const seg = await CustomSegmentService.getById(customSegmentId);
      if (!seg) throw new Error(`Custom segment ${customSegmentId} not found`);

      const { sql: segSql, params: segParams } =
        CustomSegmentService.buildSegmentSQL(seg.conditions || [], { select: 'uc.id, uc.is_indian' });

      // Audience filter appended as a WHERE on the outer query
      let audienceWhere = '';
      if (audience === 'indian') audienceWhere = 'AND seg.is_indian = true';
      else if (audience === 'rest') audienceWhere = 'AND seg.is_indian = false';

      // segParams are $1…$N; journeyId becomes $(N+1), firstNodeId becomes $(N+2)
      const nBase = segParams.length;
      const { rowCount } = await db.query(`
        INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track, status)
        SELECT $${nBase + 1}, seg.id, $${nBase + 2},
               CASE WHEN seg.is_indian THEN 'indian' ELSE 'rest' END,
               'snapshot'
        FROM   (${segSql}) AS seg
        WHERE  true ${audienceWhere}
        ON CONFLICT DO NOTHING
      `, [...segParams, journeyId, firstNodeId]);
      snapshotCount = rowCount;

    } else if (stdSegmentId) {
      // Standard segment — pure SQL JOIN, PostgreSQL handles millions of rows efficiently
      let audienceFilter = '';
      if (audience === 'indian') audienceFilter = 'AND uc.is_indian = true';
      else if (audience === 'rest') audienceFilter = 'AND uc.is_indian = false';

      const { rowCount } = await db.query(`
        INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track, status)
        SELECT $1, sc.customer_id, $2,
               CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END,
               'snapshot'
        FROM   segment_customers sc
        JOIN   unified_contacts uc ON uc.id = sc.customer_id
        WHERE  sc.segment_id = $3 AND sc.is_active = true ${audienceFilter}
        ON CONFLICT DO NOTHING
      `, [journeyId, firstNodeId, stdSegmentId]);
      snapshotCount = rowCount;
    }

    await db.query(
      'UPDATE journey_flows SET snapshot_count = $1, total_entries = $1 WHERE journey_id = $2',
      [snapshotCount, journeyId]
    );
    return snapshotCount;
  }

  static async create({ name, description, segmentId, strategyId, nodes, edges, goalType, goalValue, createdBy, audience, exitOnConversion, scheduledStartAt, testMode, testEmail, testWaitSec }) {
    // Parse custom segment format "custom:ID"
    let stdSegmentId = null;
    let customSegmentId = null;
    if (segmentId && String(segmentId).startsWith('custom:')) {
      customSegmentId = parseInt(String(segmentId).split(':')[1]) || null;
    } else if (segmentId) {
      stdSegmentId = segmentId;
    }

    const { rows: [journey] } = await db.query(`
      INSERT INTO journey_flows (name, description, segment_id, custom_segment_id, strategy_id, nodes, edges, goal_type, goal_value, created_by, audience, exit_on_conversion, scheduled_start_at, test_mode, test_email, test_interval_min)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [name, description, stdSegmentId, customSegmentId, strategyId, JSON.stringify(nodes || []), JSON.stringify(edges || []), goalType, goalValue, createdBy, audience || 'all', exitOnConversion !== false, scheduledStartAt || null, testMode || false, testEmail || null, testWaitSec || 30]);

    // ── Snapshot segment users at creation time ──────────────────────────
    const journeyId = journey.journey_id;
    const firstNodeId = (nodes || [])[0]?.id || 'node_0';
    const snapshotArgs = { customSegmentId, stdSegmentId, audience, firstNodeId };

    if (customSegmentId || stdSegmentId) {
      // Both paths are now pure SQL — safe to await even for 1 M rows.
      const count = await this._snapshotEntries(journeyId, snapshotArgs);
      journey.snapshot_count = count;
    }

    return journey;
  }

  static async update(journeyId, fields) {
    const sets = [];
    const params = [journeyId];
    const allowed = { name: 'name', description: 'description', segment_id: 'segment_id', custom_segment_id: 'custom_segment_id', nodes: 'nodes', edges: 'edges', status: 'status', goal_type: 'goal_type', goal_value: 'goal_value', audience: 'audience', exit_on_conversion: 'exit_on_conversion', scheduled_start_at: 'scheduled_start_at', test_mode: 'test_mode', test_email: 'test_email', test_interval_min: 'test_interval_min' };

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

    // If segment or audience changed, rebuild snapshot entries
    const segmentChanged = fields.segment_id !== undefined || fields.custom_segment_id !== undefined;
    const audienceChanged = fields.audience !== undefined;
    if ((segmentChanged || audienceChanged) && journey) {
      // Determine IDs from updated journey record
      let customSegmentId = journey.custom_segment_id || null;
      let stdSegmentId    = journey.segment_id || null;
      const audience      = journey.audience || 'all';
      const firstNodeId   = (Array.isArray(journey.nodes) ? journey.nodes[0]?.id : null) || 'node_0';

      // Wipe existing snapshot entries first
      await db.query(
        `DELETE FROM journey_entries WHERE journey_id = $1 AND status = 'snapshot'`,
        [journeyId]
      );
      await db.query(
        `UPDATE journey_flows SET snapshot_count = 0, total_entries = 0 WHERE journey_id = $1`,
        [journeyId]
      );

      const snapshotArgs = { customSegmentId, stdSegmentId, audience, firstNodeId };
      if (customSegmentId || stdSegmentId) {
        await this._snapshotEntries(journeyId, snapshotArgs);
      }
    }

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
    // Known test user emails — used when mode='test_users' and no unifiedIds given
    const TEST_EMAILS = new Set([
      'akshith@antino.io',
      'anket@antino.io',
      'vaibhav@antino.io',
      'alok@antino.io',
    ]);

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
      // Custom segment — paginated batch enroll (handles 1 M+ without memory/array-size issues)
      const ENROLL_BATCH = 5_000;
      let page = 1;
      rows = [];
      while (true) {
        const segResult = await CustomSegmentService.getCustomers(journey.custom_segment_id, { page, limit: ENROLL_BATCH });
        const segCustomers = segResult?.data || [];
        if (segCustomers.length === 0) break;

        const ids = segCustomers
          .filter(c => {
            if (journey.audience === 'indian' && !c.is_indian) return false;
            if (journey.audience === 'rest'   &&  c.is_indian) return false;
            return true;
          })
          .map(c => c.id);

        if (ids.length > 0) {
          const { rows: inserted } = await db.query(`
            INSERT INTO journey_entries (journey_id, customer_id, current_node_id, track)
            SELECT $1, uc.id, $2,
                   CASE WHEN uc.is_indian THEN 'indian' ELSE 'rest' END
            FROM   unified_contacts uc
            WHERE  uc.id = ANY($3::bigint[])
              AND  NOT EXISTS (
                SELECT 1 FROM journey_entries je
                WHERE  je.journey_id = $1 AND je.customer_id = uc.id
              )
            ON CONFLICT DO NOTHING
            RETURNING entry_id
          `, [journeyId, firstNodeId, ids]);
          rows.push(...inserted);
        }

        if (segCustomers.length < ENROLL_BATCH) break;
        page++;
        await new Promise(r => setImmediate(r));
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
    // First action node — unsub-only check applies here; purchased exit skipped
    const firstActionNodeId = nodes.find(n => n.type === 'action')?.id || null;

    // Pre-fetch Claude ranking ONCE before any emails are enqueued.
    // Workers share the same module-level _rankingCache, so every renderDayHtml
    // call inside the worker gets a cache hit — Claude is never called per-email.
    await JourneyService._prewarmRankingCache(journeyId, nodeMap);

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

    let processed = 0;
    let actioned = 0;
    let waited = 0;
    let conditioned = 0;
    let converted = 0;
    let enqueued = 0;

    // Action sends are batched and enqueued at the end of the loop so we minimize
    // BullMQ round-trips. One batch per channel.
    const enqueueByChannel = { email: [], whatsapp: [], sms: [] };
    // Collect entry IDs to stamp last_run_id in one bulk UPDATE per batch
    let toStampIds = [];
    // Collect sendHour-blocked entries: nextWindowAt ISO → { at, ids[] }
    // Bulk-updated after each page so the cron SQL skips them until the window opens
    let waitedEntries = new Map();

    // ── BULK EXIT CHECK (scalable for 15 lakh+ users) ──
    // Exit booked + unsubscribed users in a single batch UPDATE before the per-entry loop.
    // This avoids N individual queries for exit conditions.
    if (journey.exit_on_conversion !== false) {
      // Bulk exit: booked users
      const { rows: bookedExits } = await db.query(`
        UPDATE journey_entries je
        SET status = 'exited', exit_reason = 'booked', completed_at = NOW(), next_fire_at = NULL
        FROM unified_contacts uc
        WHERE je.journey_id = $1 AND je.status = 'active'
          AND uc.id = je.customer_id
          AND LOWER(uc.booking_status) IN ('booked', 'confirmed')
        RETURNING je.entry_id, je.current_node_id
      `, [journeyId]);
      for (const ex of bookedExits) {
        await db.query(
          `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details) VALUES ($1, $2, 'converted', NULL, $3)`,
          [ex.entry_id, ex.current_node_id, JSON.stringify({ converted: true, reason: 'booked' })]
        );
      }

      // Bulk exit: unsubscribed users
      const { rows: unsubExits } = await db.query(`
        UPDATE journey_entries je
        SET status = 'exited', exit_reason = 'unsubscribed', completed_at = NOW(), next_fire_at = NULL
        FROM unified_contacts uc
        WHERE je.journey_id = $1 AND je.status = 'active'
          AND uc.id = je.customer_id
          AND uc.email_unsubscribe = 'Yes'
        RETURNING je.entry_id, je.current_node_id
      `, [journeyId]);

      // Bulk exit: purchased users (ON_TRIP or FUTURE_TRAVEL + gtm purchase event)
      // Only applies to entries past the first action node — first email always sends
      const { rows: purchasedExits } = await db.query(`
        UPDATE journey_entries je
        SET status = 'exited', exit_reason = 'purchased', completed_at = NOW(), next_fire_at = NULL
        FROM unified_contacts uc
        WHERE je.journey_id = $1 AND je.status = 'active'
          AND uc.id = je.customer_id
          AND je.current_node_id != $2
          AND uc.booking_status IN ('ON_TRIP', 'FUTURE_TRAVEL')
          AND EXISTS (
            SELECT 1 FROM gtm_events ge
            WHERE ge.unified_id = je.customer_id
              AND ge.journey_id = $1
              AND ge.event_name = 'purchase'
          )
        RETURNING je.entry_id, je.current_node_id
      `, [journeyId, firstActionNodeId]);
      for (const ex of purchasedExits) {
        await db.query(
          `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
           VALUES ($1, $2, 'exited', NULL, $3)`,
          [ex.entry_id, ex.current_node_id, JSON.stringify({ reason: 'purchased' })]
        );
      }
      if (purchasedExits.length > 0) {
        console.log(`[Journey ${journeyId}] Bulk exited: ${purchasedExits.length} purchased (ON_TRIP/FUTURE_TRAVEL + gtm purchase)`);
      }
      for (const ex of unsubExits) {
        await db.query(
          `INSERT INTO journey_events (entry_id, node_id, event_type, channel, details) VALUES ($1, $2, 'converted', NULL, $3)`,
          [ex.entry_id, ex.current_node_id, JSON.stringify({ converted: true, reason: 'unsubscribed' })]
        );
      }

      converted = bookedExits.length + unsubExits.length;
      if (converted > 0) {
        console.log(`[Journey ${journeyId}] Bulk exited: ${bookedExits.length} booked, ${unsubExits.length} unsubscribed`);
      }
    }

    // Re-fetch active entries after bulk exit — paginated to handle 800K+ without OOM
    const FETCH_BATCH = 5000;
    let offset = 0;
    let hasMore = true;
    let firstEntry = true;

    while (hasMore) {
      const { rows: activeEntries } = await db.query(`
        SELECT je.*, uc.name, uc.email, uc.mobile AS phone,
          uc.booking_status, uc.email_unsubscribe, uc.is_indian
        FROM journey_entries je
        JOIN unified_contacts uc ON uc.id = je.customer_id
        WHERE je.journey_id = $1 AND je.status = 'active'
          AND (je.next_fire_at IS NULL OR je.next_fire_at <= NOW())
        ORDER BY je.entry_id
        LIMIT $2 OFFSET $3
      `, [journeyId, FETCH_BATCH, offset]);

      if (activeEntries.length === 0) { hasMore = false; break; }

    for (const entry of activeEntries) {

      const currentNode = nodeMap[entry.current_node_id];
      if (!currentNode) { console.log(`[DBG] entry ${entry.entry_id} — no node for '${entry.current_node_id}'`); continue; }

      // DEBUG: log first entry's node info
      if (firstEntry) {
        firstEntry = false;
        console.log(`[DBG] first entry: node=${currentNode.id}, type='${currentNode.type}', data=`, JSON.stringify(currentNode.data || {}).slice(0, 200));
      }

      const entryTrack = entry.track || 'all';

      // ── WAIT node: check if wait has elapsed ──
      // Primary guard: the SQL fetch query already filters next_fire_at <= NOW(),
      // so when next_fire_at is properly set (calculateNextFireAt sets it to
      // entered_at + waitDays when the entry arrives here), reaching this code
      // means the wait is done — fall straight through to advance.
      // Fallback for legacy entries where next_fire_at was never set (NULL):
      // use entered_at as the reference point.
      if (currentNode.type === 'wait') {
        if (!entry.next_fire_at) {
          const waitDays = currentNode.data?.waitDays || 1;
          const elapsedMs = Date.now() - new Date(entry.entered_at).getTime();
          if (elapsedMs < waitDays * 86_400_000) {
            waited++;
            continue;
          }
        }
        // Wait complete — fall through to advance to next node
      }

      // ── ACTION node: enqueue a BullMQ job for the worker to send + advance ──
      // We do NOT send inline anymore. Instead we resolve the effective channel
      // + template per entry track, build a self-contained job payload, and add
      // it to the channel-specific queue. The worker handles render → send →
      // journey_events insert → entry advance. This is what scales the journey
      // run from a synchronous loop to ~18 lakh recipients.
      if (currentNode.type === 'action') {
        // ── SEND-HOUR GATE (Dubai timezone) — skipped entirely in test mode ──
        const sendHour = currentNode.data?.sendHour;
        if (!journey.test_mode && sendHour !== undefined && sendHour !== null) {
          const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
          const targetH = typeof sendHour === 'number' ? sendHour : parseInt(String(sendHour).split(':')[0]);
          const targetM = typeof sendHour === 'number' ? 0 : parseInt(String(sendHour).split(':')[1] || '0');
          const curH = dubaiNow.getHours();
          const curM = dubaiNow.getMinutes();
          // Allow a 5-minute window so the cron interval doesn't miss the exact minute
          const targetTotal = targetH * 60 + targetM;
          const curTotal = curH * 60 + curM;
          if (curTotal < targetTotal || curTotal > targetTotal + 5) {
            // Compute exact UTC time when the window next opens so the cron
            // SQL (next_fire_at <= NOW) skips this entry until then instead of
            // loading and blocking it on every 5-minute tick.
            const _dayMs = 24 * 60 * 60 * 1000;
            const _dubaiOffset = 4 * 60; // UTC+4 in minutes
            const _dubaiDate = new Date(Date.now() + _dubaiOffset * 60000);
            _dubaiDate.setHours(targetH, targetM, 0, 0);
            let _nextWindow = new Date(_dubaiDate.getTime() - _dubaiOffset * 60000);
            if (_nextWindow <= new Date()) _nextWindow = new Date(_nextWindow.getTime() + _dayMs);
            const _key = _nextWindow.toISOString();
            if (!waitedEntries.has(_key)) waitedEntries.set(_key, { at: _nextWindow, ids: [] });
            waitedEntries.get(_key).ids.push(entry.entry_id);
            waited++;
            processed++;
            continue;
          }
        }

        // Skip if this entry was enqueued recently (within 2 min) — prevents double
        // enqueue when processJourney() is re-triggered while workers are still draining.
        // Time-based instead of runId so multi-node journeys can re-fire on the same day.
        const recentlyEnqueued = entry.last_enqueued_at
          && (Date.now() - new Date(entry.last_enqueued_at).getTime()) < 2 * 60_000;
        if (recentlyEnqueued) {
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

        // In test mode: redirect all emails to the journey's test_email address
        const recipientEmail = (journey.test_mode && journey.test_email) ? journey.test_email : entry.email;

        // Dubai date at enqueue time — workers skip the job if day has rolled over
        const _dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
        const enqueuedDubaiDate = `${_dubaiNow.getFullYear()}-${String(_dubaiNow.getMonth()+1).padStart(2,'0')}-${String(_dubaiNow.getDate()).padStart(2,'0')}`;

        const jobData = {
          entryId:           entry.entry_id,
          customerId:        entry.customer_id,
          journeyId,
          nodeId:            currentNode.id,
          runId,
          channel,
          templateId,
          htmlTemplateId,
          name:              entry.name,
          email:             recipientEmail,
          phone:             entry.phone,
          isIndian:          entry.is_indian,
          track:             entryTrack,
          autoPaired,
          originalChannel:   rawChannel,
          edges,
          nodes:             nodeMap,
          templateVariables:  currentNode.data?.templateVariables || {},
          enqueuedDubaiDate,
          firstActionNodeId,
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
        // jobId must include nodeId — runId is constant per (journey, day), so without
        // nodeId every node an entry passes through reuses the same id and BullMQ
        // silently dedupes the send against the previous node's cached job.
        // BullMQ forbids ':' in custom job ids (Redis key separator) — use '_'.
        // nodeId is included so each node an entry passes gets a unique job id
        // (runId is constant per journey/day, so without nodeId BullMQ would dedupe
        // a node's send against the previous node's cached job).
        enqueueByChannel[channel].push({ data: jobData, opts: { jobId: `${journeyId}_${entry.entry_id}_${currentNode.id}_${runId}` } });

        // Collect for bulk stamp below (avoids 800K individual UPDATEs)
        toStampIds.push(entry.entry_id);
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
          const nextNode = nodeMap[nextNodeId];
          const nextFireAt = JourneyService.calculateNextFireAt(nextNode, new Date());
          await db.query(
            'UPDATE journey_entries SET current_node_id = $1, next_fire_at = $2, last_run_id = NULL WHERE entry_id = $3',
            [nextNodeId, nextFireAt, entry.entry_id]
          );
        } else {
          // No outgoing edge for this condition branch — complete the entry instead of looping
          await db.query(
            `UPDATE journey_entries SET status = 'completed', completed_at = NOW(), last_run_id = NULL WHERE entry_id = $1`,
            [entry.entry_id]
          );
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
        const nextNode = nodeMap[chosen.target];
        const nextFireAt = JourneyService.calculateNextFireAt(nextNode, new Date());
        await db.query(
          'UPDATE journey_entries SET current_node_id = $1, next_fire_at = $2, last_run_id = NULL WHERE entry_id = $3',
          [chosen.target, nextFireAt, entry.entry_id]
        );
      } else {
        await db.query(
          "UPDATE journey_entries SET status = 'completed', completed_at = NOW() WHERE entry_id = $1",
          [entry.entry_id]
        );
      }
      processed++;
    } // end for (entry of activeEntries)

    // Bulk stamp last_run_id for all enqueued entries in this page (1 query vs N)
    if (toStampIds.length > 0) {
      await db.query(
        `UPDATE journey_entries SET last_run_id = $1, last_enqueued_at = NOW()
         WHERE entry_id = ANY($2::bigint[])`,
        [runId, toStampIds]
      );
      toStampIds = [];
    }

    // Bulk update next_fire_at for sendHour-blocked entries (one query per unique window time)
    if (waitedEntries.size > 0) {
      for (const { at, ids } of waitedEntries.values()) {
        await db.query(
          'UPDATE journey_entries SET next_fire_at = $1 WHERE entry_id = ANY($2::bigint[])',
          [at, ids]
        );
      }
      waitedEntries = new Map();
    }

    // ════════════════════════════════════════════════════════════════
    //  Drain per-channel batches into BullMQ after each page
    // ════════════════════════════════════════════════════════════════
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
          const entryIds = slice.map(j => j.data.entryId);
          await db.query(
            `UPDATE journey_entries SET last_run_id = NULL, last_enqueued_at = NULL
               WHERE entry_id = ANY($1::bigint[]) AND last_run_id = $2`,
            [entryIds, runId]
          ).catch(() => {});
        }
      }
      enqueueByChannel[channel] = []; // reset for next page
    }

    offset += activeEntries.length;
    if (activeEntries.length < FETCH_BATCH) hasMore = false;
    } // end while (hasMore)

    // Update journey stats
    await db.query(`
      UPDATE journey_flows SET
        total_conversions = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1 AND status IN ('converted','exited')),
        total_exits = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1 AND status = 'exited'),
        conversion_rate = CASE WHEN total_entries > 0
          THEN ((SELECT COUNT(*)::numeric FROM journey_entries WHERE journey_id = $1 AND status IN ('converted','exited')) / total_entries * 100)
          ELSE 0 END
      WHERE journey_id = $1
    `, [journeyId]);

    // ── Auto-complete journey when all entries are done (no active entries left) ──
    const { rows: [{ active_cnt }] } = await db.query(
      `SELECT COUNT(*) AS active_cnt FROM journey_entries WHERE journey_id = $1 AND status = 'active'`,
      [journeyId]
    );
    if (parseInt(active_cnt) === 0) {
      await db.query(
        `UPDATE journey_flows SET status = 'completed', updated_at = NOW() WHERE journey_id = $1 AND status = 'active'`,
        [journeyId]
      );
      console.log(`[Journey ${journeyId}] Auto-completed — all entries finished.`);
    }

    return { processed, actioned, waited, conditioned, converted, enqueued, runId };
  }

  // ── processJourney helpers ────────────────────────────────────

  /**
   * Called once at the START of processJourney before any emails are enqueued.
   * Finds which action nodes have active+due entries, checks their templateId,
   * and pre-fetches the Claude ranking for templates that need it (2=cruise, 3=visa).
   * Result is stored in the module-level _rankingCache so every subsequent
   * renderDayHtml call inside the BullMQ workers gets a cache hit — Claude is
   * called exactly once per node batch, not once per email.
   */
  static async _prewarmRankingCache(journeyId, nodeMap) {
    // Find distinct action nodes that have active+due entries right now
    const { rows: activeNodes } = await db.query(`
      SELECT DISTINCT current_node_id
      FROM journey_entries
      WHERE journey_id = $1 AND status = 'active'
        AND (next_fire_at IS NULL OR next_fire_at <= NOW())
      LIMIT 100
    `, [journeyId]);

    // Collect (nodeId, templateId) pairs — ranking is frozen per node, not per template
    const nodeTemplatePairs = [];
    for (const { current_node_id } of activeNodes) {
      const node = nodeMap[current_node_id];
      if (!node || node.type !== 'action') continue;
      const ch  = (node.data?.channel || '').toLowerCase();
      const tid = node.data?.templateId
        || (ch === 'email' ? node.data?.emailTemplateId : null);
      if (tid) nodeTemplatePairs.push({ nodeId: current_node_id, templateId: parseInt(tid) });
    }

    for (const { nodeId, templateId } of nodeTemplatePairs) {
      try {
        if (templateId === 1) {
          const { default: rankTrendingWelcome } = await import('./Day1WelcomeRankingService.js');
          await _getFrozenRanking(journeyId, nodeId, 'welcome', rankTrendingWelcome);
        } else if (templateId === 2) {
          const { default: rankTrendingCruises } = await import('./Day2CruiseRankingService.js');
          await _getFrozenRanking(journeyId, nodeId, 'cruise', rankTrendingCruises);
        } else if (templateId === 3) {
          const { rankTrendingVisas } = await import('./VisaRankingService.js');
          await _getFrozenRanking(journeyId, nodeId, 'visa', rankTrendingVisas);
        } else if (templateId === 4) {
          const { default: rankTrendingHolidays } = await import('./Day4HolidaysRankingService.js');
          await _getFrozenRanking(journeyId, nodeId, 'holidays', rankTrendingHolidays);
        } else if (templateId === 5) {
          const { default: rankTrendingActivities } = await import('./Day5ActivitiesRankingService.js');
          await _getFrozenRanking(journeyId, nodeId, 'activities', rankTrendingActivities);
        } else if (templateId === 6) {
          // Day6 — one destination per node (same for all contacts). Freeze only that one.
          const { default: rankDestinationSpotlight } = await import('./Day6DestinationRankingService.js');
          const destKey = _day6DestKey(journeyId, nodeId);
          await _getFrozenRanking(journeyId, nodeId, `destination_${destKey}`, () => rankDestinationSpotlight({ destinationKey: destKey }));
        }
        if (templateId >= 1 && templateId <= 6) {
          console.log(`[Journey ${journeyId}] Ranking frozen for node=${nodeId} template=${templateId} (Claude/fallback called once).`);
        }
        // Template 7 (abandoned cart) uses per-contact data, no shared ranking.
      } catch (err) {
        console.warn(`[Journey ${journeyId}] Prewarm failed for node=${nodeId} template=${templateId}: ${err.message} — will use fallback at send time.`);
      }
    }
  }

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

        const lastEventTs = new Date(entry.last_event || entry.entered_at).getTime();
        const fireTs = lastEventTs + (currentNode.data?.waitDays || 1) * 86_400_000;

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
        'UPDATE journey_entries SET current_node_id = $1, next_fire_at = $2, last_run_id = NULL WHERE entry_id = $3',
        [chosen.target, nextFireAt, entryId]
      );
    } else {
      await db.query(
        "UPDATE journey_entries SET status = 'completed', completed_at = NOW(), next_fire_at = NULL, last_run_id = NULL WHERE entry_id = $1",
        [entryId]
      );
    }
  }

  /**
   * Check whether an entry should exit the journey.
   * Exit conditions:
   *   1. User has booked (unified_contacts.booking_status is 'booked' or 'confirmed')
   *   2. User has unsubscribed from email (email_unsubscribe = 'Yes')
   * Returns: { converted: bool, reason: 'booked' | 'unsubscribed' | null, details?: {...} }
   */
  static async checkConversion(entry) {
    const { rows: [uc] } = await db.query(
      `SELECT booking_status, email_unsubscribe FROM unified_contacts WHERE id = $1`,
      [entry.customer_id]
    );
    if (!uc) return { converted: false, reason: null };

    // 1. Booking-based exit
    const bs = (uc.booking_status || '').toLowerCase();
    if (bs === 'booked' || bs === 'confirmed') {
      return { converted: true, reason: 'booked', details: { booking_status: uc.booking_status } };
    }

    // 2. Unsubscribe-based exit
    if (uc.email_unsubscribe === 'Yes') {
      return { converted: true, reason: 'unsubscribed', details: {} };
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

    // Per-node fire time stats for wait node countdown timers
    const { rows: nodeFireTimes } = await db.query(`
      SELECT
        current_node_id,
        MIN(next_fire_at)   AS earliest_fire_at,
        MAX(next_fire_at)   AS latest_fire_at,
        MIN(last_enqueued_at) AS earliest_enqueued,
        COUNT(*)            AS active_count
      FROM journey_entries
      WHERE journey_id = $1
        AND status = 'active'
        AND next_fire_at IS NOT NULL
      GROUP BY current_node_id
    `, [journeyId]);

    return { nodeStats, funnelData, nodeFireTimes };
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
        ct.body AS template_body, ct.name AS template_name
      FROM campaigns c
      LEFT JOIN content_templates ct ON ct.id = c.template_id
      WHERE c.journey_id = $2 OR c.segment_label = $1
      ORDER BY c.created_at ASC
    `, [segmentLabel, journeyId]);

    // Click counts per node from email_send_log — rows with clicked_at set
    const { rows: clickRows } = await db.query(`
      SELECT node_id, COUNT(*) AS click_count
      FROM email_send_log
      WHERE journey_id = $1 AND node_id IS NOT NULL AND clicked_at IS NOT NULL
      GROUP BY node_id
    `, [journeyId]);
    const gtmClickMap = Object.fromEntries(clickRows.map(r => [r.node_id, parseInt(r.click_count) || 0]));

    // Open counts per node from email_send_log — unique users who opened (distinct unified_id)
    const { rows: openRows } = await db.query(`
      SELECT node_id, COUNT(DISTINCT unified_id) AS open_count
      FROM email_send_log
      WHERE journey_id = $1 AND node_id IS NOT NULL AND opened_at IS NOT NULL
      GROUP BY node_id
    `, [journeyId]);
    const openMap = Object.fromEntries(openRows.map(r => [r.node_id, parseInt(r.open_count) || 0]));

    // Delivered counts per node via SES events (event_type = 'Delivery')
    const { rows: deliveredRows } = await db.query(`
      SELECT esl.node_id, COUNT(*) AS delivered_count
      FROM email_send_log esl
      JOIN ses_events se ON se.message_id = esl.external_id
      WHERE esl.journey_id = $1 AND esl.node_id IS NOT NULL AND se.event_type = 'Delivery'
      GROUP BY esl.node_id
    `, [journeyId]);
    const deliveredByNodeMap = Object.fromEntries(deliveredRows.map(r => [r.node_id, parseInt(r.delivered_count) || 0]));

    // Bounced counts per node via SES events (event_type = 'Bounce')
    const { rows: bounceRows } = await db.query(`
      SELECT esl.node_id, COUNT(*) AS bounce_count
      FROM email_send_log esl
      JOIN ses_events se ON se.message_id = esl.external_id
      WHERE esl.journey_id = $1 AND esl.node_id IS NOT NULL AND se.event_type = 'Bounce'
      GROUP BY esl.node_id
    `, [journeyId]);
    const bouncedByNodeMap = Object.fromEntries(bounceRows.map(r => [r.node_id, parseInt(r.bounce_count) || 0]));

    // Merge click counts into each campaign row by node_id
    const campaignsWithClicks = campaigns.map(c => ({
      ...c,
      gtm_click_count: gtmClickMap[c.journey_node_id] || 0,
    }));

    // Aggregate totals
    const totals = {
      total_sent: campaignsWithClicks.reduce((s, c) => s + (parseInt(c.sent_count) || 0), 0),
      total_delivered: Object.values(deliveredByNodeMap).reduce((s, n) => s + n, 0),
      total_read: Object.values(openMap).reduce((s, n) => s + n, 0),
      total_clicked: Object.values(gtmClickMap).reduce((s, n) => s + n, 0),
      total_bounced: Object.values(bouncedByNodeMap).reduce((s, n) => s + n, 0),
      total_failed: campaignsWithClicks.reduce((s, c) => s + (parseInt(c.fail_count) || 0), 0),
      total_conversions: campaignsWithClicks.reduce((s, c) => s + (parseInt(c.conversion_count) || 0), 0),
      total_revenue: campaignsWithClicks.reduce((s, c) => s + (parseFloat(c.revenue_total) || 0), 0),
    };

    return {
      journey: journey[0], campaigns: campaignsWithClicks, totals,
      target_count: targetCount,
      gtm_clicks: gtmClickMap,
      opens: openMap,
      delivered_by_node: deliveredByNodeMap,
      bounced_by_node: bouncedByNodeMap,
    };
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
        uc.name, uc.email, uc.mobile AS phone, uc.country,
        uc.booking_status, uc.segments
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

    // waitDays is ONLY honoured on 'wait' type nodes. Action / trigger / condition
    // / goal nodes fire immediately (or at sendHour) — delays belong in wait nodes.
    // sendHour is ONLY honoured on 'action' type nodes — wait nodes use pure time.
    const isWaitNode   = node.type === 'wait';
    const isActionNode = node.type === 'action';
    const waitDays  = isWaitNode   ? (node.data?.waitDays ?? 1) : 0;
    const sendHour  = isActionNode ? node.data?.sendHour : undefined;
    const dayMs    = 24 * 60 * 60 * 1000;

    const target = new Date(fromTime.getTime() + waitDays * dayMs);

    // If no sendHour specified, fire immediately after wait
    if (sendHour === undefined || sendHour === null) return target;

    const targetH = typeof sendHour === 'number' ? sendHour : parseInt(String(sendHour).split(':')[0]);
    const targetM = typeof sendHour === 'number' ? 0 : parseInt(String(sendHour).split(':')[1] || '0');

    // Convert target to Dubai time (UTC+4) and set the desired hour:minute.
    // Must use UTC-based arithmetic — getTimezoneOffset() varies by server locale.
    const dubaiOffsetMs = 4 * 60 * 60 * 1000;
    const dubaiDate = new Date(target.getTime() + dubaiOffsetMs);
    dubaiDate.setUTCHours(targetH, targetM, 0, 0);

    // Convert back to UTC
    let fireAt = new Date(dubaiDate.getTime() - dubaiOffsetMs);

    // If the calculated time is in the past, push forward by one day
    if (fireAt <= new Date()) {
      fireAt = new Date(fireAt.getTime() + dayMs);
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
  static async startJourney(journeyId, { skipScheduleValidation = false, manual = false } = {}) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');
    if (journey.status === 'active') throw new Error('Journey is already active');

    const nodes = journey.nodes || [];
    if (nodes.length === 0) throw new Error('Journey has no nodes — add at least one node before starting');

    // ── Validate scheduled_start_at hasn't passed (skip when called from auto-start cron) ──
    if (!skipScheduleValidation && !manual && journey.scheduled_start_at && new Date(journey.scheduled_start_at) < new Date()) {
      throw new Error('Journey start date and time has already passed. Please update the start date before starting.');
    }

    // ── Check snapshot entries exist (snapshotted at creation time) ──
    const { rows: [{ cnt: snapshotCount }] } = await db.query(
      `SELECT COUNT(*) AS cnt FROM journey_entries WHERE journey_id = $1 AND status = 'snapshot'`,
      [journeyId]
    );
    if (parseInt(snapshotCount) === 0) {
      throw new Error('No users snapshotted for this journey. Please select a segment with users.');
    }

    // 1. Set status to 'active'. Manual start clears scheduled_start_at so the
    //    auto-start cron won't double-fire after the user clicked Start Now.
    await db.query(
      `UPDATE journey_flows
       SET status = 'active', updated_at = NOW()
           ${manual ? ', scheduled_start_at = NULL' : ''}
       WHERE journey_id = $1`,
      [journeyId]
    );

    // 2. Flip all snapshot entries to 'active' (users were already locked at creation)
    const { rowCount: enrolled } = await db.query(
      `UPDATE journey_entries SET status = 'active' WHERE journey_id = $1 AND status = 'snapshot'`,
      [journeyId]
    );

    // 3. Set next_fire_at = NOW() for all entries so processJourney picks them up immediately.
    //    Always use NOW() regardless of scheduled_start_at — the schedule only controls WHEN
    //    startJourney is called (by the auto-start cron). Once startJourney runs, entries must
    //    fire immediately. Using scheduled_start_at here caused entries to be stuck at the
    //    trigger node until the scheduled time, even after the journey was already started.
    if (enrolled > 0) {
      await db.query(`
        UPDATE journey_entries
        SET next_fire_at = NOW()
        WHERE journey_id = $1 AND status = 'active' AND next_fire_at IS NULL
      `, [journeyId]);
      console.log(`[Journey ${journeyId}] Set next_fire_at=NOW() for ${enrolled} entries — trigger will advance immediately`);
    }

    // 4. Run first process immediately — advances entries past the trigger node (node_0 → node_1)
    let processResult = { processed: 0, enqueued: 0, converted: 0 };
    try {
      processResult = await this.processJourney(journeyId);
    } catch (err) {
      console.error(`[Journey ${journeyId}] First process error: ${err.message}`);
    }

    // 5. Run a second process immediately — fires the first action node (node_1) without
    //    waiting for the next cron tick. The trigger advance and action send can't happen
    //    in the same loop pass, so a back-to-back call handles both in one start.
    try {
      const secondResult = await this.processJourney(journeyId);
      processResult.enqueued  = (processResult.enqueued  || 0) + (secondResult.enqueued  || 0);
      processResult.converted = (processResult.converted || 0) + (secondResult.converted || 0);
    } catch (err) {
      console.error(`[Journey ${journeyId}] Second process error: ${err.message}`);
    }

    return { started: true, enrolled, ...processResult };
  }

  /**
   * Toggle pause/resume for a journey.
   * Resume is allowed if at least one journey_event exists (one node has fired).
   */
  static async pauseJourney(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT * FROM journey_flows WHERE journey_id = $1', [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const newStatus = journey.status === 'paused' ? 'active' : 'paused';

    // On resume: recalculate next_fire_at per node so the cron picks them up.
    // Group entries by current_node_id and bulk-update per node to avoid N+1 queries.
    if (newStatus === 'active') {
      const nodes = journey.nodes || [];
      const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
      const { rows: activeEntries } = await db.query(
        `SELECT entry_id, current_node_id FROM journey_entries WHERE journey_id = $1 AND status = 'active'`,
        [journeyId]
      );
      const grouped = new Map();
      for (const entry of activeEntries) {
        if (!grouped.has(entry.current_node_id)) grouped.set(entry.current_node_id, []);
        grouped.get(entry.current_node_id).push(entry.entry_id);
      }
      for (const [nodeId, entryIds] of grouped) {
        const currentNode = nodeMap[nodeId];
        const nextFireAt = this.calculateNextFireAt(currentNode, new Date());
        await db.query(
          'UPDATE journey_entries SET next_fire_at = $1 WHERE entry_id = ANY($2::int[])',
          [nextFireAt, entryIds]
        );
      }
    }

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
             uc.segments AS current_segment,
             jf.nodes, jf.edges, jf.segment_id, jf.exit_on_conversion,
             sd.segment_name AS journey_segment
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      JOIN unified_contacts uc ON uc.id = je.customer_id
      LEFT JOIN segment_definitions sd ON sd.segment_id = jf.segment_id
      WHERE je.status = 'active'
        AND (je.next_fire_at IS NULL OR je.next_fire_at <= NOW())
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
    // Group by (journey_id, current_node_id) — all entries on the same node
    // get the same nextFireAt, so one bulk UPDATE per node instead of N per entry.
    const { rows: staleNodes } = await db.query(`
      SELECT DISTINCT je.journey_id, je.current_node_id, jf.nodes
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      WHERE je.status = 'active'
        AND jf.status = 'active'
        AND je.next_fire_at IS NULL
    `);

    for (const row of staleNodes) {
      const nodes = row.nodes || [];
      const currentNode = nodes.find(n => n.id === row.current_node_id);
      if (!currentNode) continue;

      // Action nodes fire at the next sendHour opportunity — leave next_fire_at NULL
      // so processJourney picks them up immediately on the next cron run.
      // Only wait nodes need a scheduled fire time.
      if (currentNode.type !== 'wait') continue;

      const nextFireAt = this.calculateNextFireAt(currentNode, new Date());
      if (nextFireAt) {
        await db.query(`
          UPDATE journey_entries
          SET next_fire_at = $1
          WHERE journey_id = $2
            AND current_node_id = $3
            AND status = 'active'
            AND next_fire_at IS NULL
        `, [nextFireAt, row.journey_id, row.current_node_id]);
      }
    }
  }

  /**
   * Per-node trigger timeline for the journey detail UI.
   * Returns for every node:
   *   - status: completed | active | waiting | pending
   *   - triggeredAt  (IST) — when it fired (completed nodes, from journey_events)
   *   - nextFireAt   (IST) — when it will fire (active/waiting nodes, from journey_entries)
   *   - predictedAt  (IST) — estimated time for future (pending) nodes
   *   - entryCount   — how many entries are/were at this node
   */
  static async getJourneyTimeline(journeyId) {
    const { rows: [journey] } = await db.query(
      'SELECT journey_id, nodes, edges, status, scheduled_start_at FROM journey_flows WHERE journey_id = $1',
      [journeyId]
    );
    if (!journey) throw new Error('Journey not found');

    const nodes = journey.nodes || [];

    // ── 1. Actual fire times from journey_events (completed nodes) ──
    const { rows: eventRows } = await db.query(`
      SELECT je.node_id,
             MIN(je.created_at) AS first_fired_at,
             MAX(je.created_at) AS last_fired_at,
             COUNT(DISTINCT jen.entry_id) AS entry_count
      FROM journey_events je
      JOIN journey_entries jen ON jen.entry_id = je.entry_id
      WHERE jen.journey_id = $1
        AND je.event_type IN ('action_sent','action_blocked','action_failed','condition_evaluated','converted')
      GROUP BY je.node_id
    `, [journeyId]);
    const eventMap = Object.fromEntries(eventRows.map(r => [r.node_id, r]));

    // ── 2. next_fire_at for currently active entries ──
    const { rows: entryRows } = await db.query(`
      SELECT current_node_id,
             MIN(next_fire_at) AS earliest_fire,
             MAX(next_fire_at) AS latest_fire,
             COUNT(*) AS entry_count
      FROM journey_entries
      WHERE journey_id = $1 AND status = 'active'
      GROUP BY current_node_id
    `, [journeyId]);
    const entryMap = Object.fromEntries(entryRows.map(r => [r.current_node_id, r]));

    const IST_OFFSET = 5.5 * 60 * 60 * 1000; // +5:30 in ms
    const toIST = (d) => d ? new Date(new Date(d).getTime() + IST_OFFSET).toISOString().replace('T', ' ').slice(0, 16) + ' IST' : null;

    // ── 3. Walk nodes in order, estimate pending node times ──
    // For pending nodes we propagate: last known time + node delays
    let rollingTime = null; // carries forward the estimated completion time

    // Seed rolling time from the earliest active next_fire_at, or NOW for draft
    if (entryRows.length > 0) {
      const minFire = entryRows.reduce((min, r) => (!min || r.earliest_fire < min) ? r.earliest_fire : min, null);
      rollingTime = minFire ? new Date(minFire) : new Date();
    } else if (eventRows.length > 0) {
      const maxEvent = eventRows.reduce((max, r) => (!max || r.last_fired_at > max) ? r.last_fired_at : max, null);
      rollingTime = maxEvent ? new Date(maxEvent) : new Date();
    } else {
      rollingTime = journey.scheduled_start_at ? new Date(journey.scheduled_start_at) : new Date();
    }

    const timeline = nodes.map((node) => {
      const ev = eventMap[node.id];
      const en = entryMap[node.id];

      // Completed node — has real event timestamps
      if (ev) {
        rollingTime = new Date(ev.last_fired_at);
        return {
          nodeId:      node.id,
          nodeType:    node.type,
          label:       node.data?.label || node.type,
          status:      'completed',
          triggeredAt: toIST(ev.first_fired_at),
          completedAt: toIST(ev.last_fired_at),
          nextFireAt:  null,
          predictedAt: null,
          entryCount:  parseInt(ev.entry_count) || 0,
        };
      }

      // Active node — entries sitting here with a real next_fire_at
      if (en) {
        rollingTime = new Date(en.latest_fire || en.earliest_fire);
        return {
          nodeId:      node.id,
          nodeType:    node.type,
          label:       node.data?.label || node.type,
          status:      node.type === 'wait' ? 'waiting' : 'active',
          triggeredAt: null,
          completedAt: null,
          nextFireAt:  toIST(en.earliest_fire),
          latestFireAt: toIST(en.latest_fire),
          predictedAt: null,
          entryCount:  parseInt(en.entry_count) || 0,
        };
      }

      // Pending node — estimate based on rolling time + node config
      const predictedFireAt = JourneyService.calculateNextFireAt(node, rollingTime);
      if (predictedFireAt) rollingTime = predictedFireAt;

      return {
        nodeId:      node.id,
        nodeType:    node.type,
        label:       node.data?.label || node.type,
        status:      'pending',
        triggeredAt: null,
        completedAt: null,
        nextFireAt:  null,
        predictedAt: toIST(predictedFireAt),
        entryCount:  0,
        sendHour:    node.data?.sendHour || null,
        waitDays:    node.type === 'wait' ? (node.data?.waitDays ?? 1) : null,
      };
    });

    return { journeyId, journeyStatus: journey.status, scheduledStartAt: toIST(journey.scheduled_start_at), timeline };
  }
}

export default JourneyService;
