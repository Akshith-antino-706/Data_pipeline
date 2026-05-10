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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..', '..');

const router = express.Router();

const TEMPLATE_DIR = path.join(ROOT, 'mail_templates');

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
  const { EmailChannel } = await import('../services/channels/EmailChannel.js');
  return EmailChannel;
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
async function sendAndLog({ EmailChannel, recipient, subject, html, templateLabel, dayNumber }) {
  const baseUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;

  const logId = await SendTrackService.logSend({
    unifiedId:     recipient.unified_id,
    email:         recipient.email,
    subject,
    templateLabel,
    dayNumber,
    source: 'test-send',
  });

  // Inject open-tracking pixel before sending
  const pixel = `<img src="${baseUrl}/api/track/email-send/open/${logId}" width="1" height="1" style="display:none" alt="" />`;
  const trackedHtml = html.includes('</body>')
    ? html.replace('</body>', `${pixel}</body>`)
    : html + pixel;

  const start = Date.now();
  let result;
  try {
    result = await EmailChannel.send({ to: recipient.email, subject, html: trackedHtml });
  } catch (err) {
    result = { success: false, error: err.message || String(err), provider: null };
  }
  const ms = Date.now() - start;

  if (result?.success) {
    await SendTrackService.markSent(logId, { externalId: result.externalId || null, provider: result.provider || null, durationMs: ms });
  } else {
    await SendTrackService.markFailed(logId, { error: result?.error || result?.reason || 'unknown', provider: result?.provider || null, durationMs: ms });
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

// ── contact search ───────────────────────────────────────────────────────

router.get('/search-contacts', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ data: [] });

    const { rows } = await db.query(`
      SELECT id, email, name
        FROM unified_contacts
       WHERE email IS NOT NULL AND email <> ''
         AND (
           email ILIKE $1
           OR name ILIKE $1
         )
       ORDER BY email
       LIMIT 20
    `, [`%${q}%`]);

    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ── daily auto-send schedule ──────────────────────────────────────────────

router.get('/schedule', async (_req, res, next) => {
  try {
    const { getStatus } = await import('../services/TestSendScheduler.js');
    const status = await getStatus();
    res.json({ data: status });
  } catch (err) { next(err); }
});

router.post('/schedule/start', async (req, res, next) => {
  try {
    const { start } = await import('../services/TestSendScheduler.js');
    const status = await start({
      destinationKey: req.body?.destinationKey || 'singapore',
      loop: req.body?.loop === true,
    });
    res.json({ data: status });
  } catch (err) { next(err); }
});

router.post('/schedule/stop', async (_req, res, next) => {
  try {
    const { stop } = await import('../services/TestSendScheduler.js');
    const status = await stop();
    res.json({ data: status });
  } catch (err) { next(err); }
});

// Manual tick — useful for "Send today's email now" without waiting for cron
router.post('/schedule/tick', async (_req, res, next) => {
  try {
    const { tick } = await import('../services/TestSendScheduler.js');
    const result = await tick();
    res.json({ data: result });
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
      ranking = await rankTrendingWelcome();
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
    const subject  = req.body?.subject || 'Welcome to Rayna Tours — Your Dream Holiday Starts Here';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay1WelcomeData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay1Welcome(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 1 - Welcome', dayNumber: 1 }));
    }
    res.json({ data: { day: 1, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
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
    const ranking = useClaude ? await rankTrendingCruises() : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day2-cruise-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Set Sail: Cruise Highlights from Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay2CruiseData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay2Cruise(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 2 - Cruise Spotlight', dayNumber: 2 }));
    }
    res.json({ data: { day: 2, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
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
    const ranking = useClaude ? await rankTrendingVisas() : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    // Day3VisaDataService expects ratings_keys but VisaRankingService doesn't produce it
    if (!ranking.ranking.ratings_keys) {
      ranking.ranking.ratings_keys = ['rayna', 'trustpilot', 'tripadvisor', 'google'];
    }

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day3-visa-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Your Visa, Sorted — Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay3VisaData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay3Visa(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 3 - Visa Hub', dayNumber: 3 }));
    }
    res.json({ data: { day: 3, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
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
    const ranking = useClaude ? await rankTrendingHolidays() : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day4-holidays-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Dream Holiday Destinations — Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay4HolidaysData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay4Holidays(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 4 - Holidays', dayNumber: 4 }));
    }
    res.json({ data: { day: 4, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
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
    const ranking = useClaude ? await rankTrendingActivities() : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day5-activities-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'World-Class Activities, Instantly Booked — Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay5ActivitiesData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay5Activities(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 5 - Activities', dayNumber: 5 }));
    }
    res.json({ data: { day: 5, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
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
      ranking = await rankDestinationSpotlight({ destinationKey });
    } else {
      const [holidayCandidates, activityCandidates, cruiseCandidates] = await Promise.all([
        rankInternals.fetchHolidayCandidates(dest.productCity),
        rankInternals.fetchActivityCandidates(dest.productCity),
        rankInternals.fetchCruiseCandidates(dest.cruiseCategory),
      ]);
      ranking = { ranking: rankInternals.buildFallbackRanking({ holidayCandidates, activityCandidates, cruiseCandidates }), source: 'fallback' };
    }

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day6-destination-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || `${dest.name}, Your Way — Rayna Tours`;

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay6DestinationData({ contactId: r.unified_id, destinationKey, ranking: ranking.ranking });
      const html = renderDay6Destination(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 6 - Destination Spotlight', dayNumber: 6 }));
    }
    res.json({ data: { day: 6, destinationKey, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
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
      ranking = await rankAbandonedCartFallback();
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
    const subject  = req.body?.subject || 'You Left Something Behind — Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay7AbandonedCartData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay7AbandonedCart(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendAndLog({ EmailChannel, recipient: r, subject, html, templateLabel: 'Day 7 - Abandoned Cart', dayNumber: 7 }));
    }
    res.json({ data: { day: 7, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
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
    const { status, email, dayNumber, source, dateFrom, dateTo } = req.query;

    const result = await SendTrackService.getLog({ page, limit, status, email, dayNumber, source, dateFrom, dateTo });
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

export default router;
