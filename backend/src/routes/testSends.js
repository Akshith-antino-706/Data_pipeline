/**
 * /api/v3/test-sends — internal QA endpoint to send any of the 7 day templates
 * to the TEST_USERS segment (segment_id=95) without going through journeys.
 *
 * Behaviour:
 *   - Resolves the recipient list by reading segment_customers JOIN unified_contacts
 *     where segment_name='TEST_USERS'. Single source of truth.
 *   - Runs the appropriate ranking once, then fans out per-recipient render+send.
 *   - Returns per-recipient MessageId so the UI can show the result.
 *
 * Endpoints:
 *   POST /api/v3/test-sends/day1
 *   POST /api/v3/test-sends/day2
 *   POST /api/v3/test-sends/day3
 *   POST /api/v3/test-sends/day4
 *   POST /api/v3/test-sends/day5
 *   POST /api/v3/test-sends/day6              (body: { destinationKey })
 *   POST /api/v3/test-sends/day7
 *   GET  /api/v3/test-sends/recipients         — list current TEST_USERS members
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import db from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..', '..', '..');

const router = express.Router();

const TEMPLATE_DIR = path.join(ROOT, 'mail_templates');

// ── shared helpers ────────────────────────────────────────────────────────

async function fetchTestRecipients() {
  const { rows } = await db.query(`
    SELECT DISTINCT uc.id AS unified_id, LOWER(uc.email) AS email
      FROM segment_customers sc
      JOIN segment_definitions sd ON sd.segment_id = sc.segment_id
      JOIN unified_contacts uc    ON uc.id = sc.customer_id
     WHERE sd.segment_name = 'TEST_USERS'
       AND sc.is_active    = TRUE
       AND uc.email IS NOT NULL AND uc.email <> ''
       AND COALESCE(uc.email_unsubscribe, 'No') <> 'Yes'
  `);
  // Dedup by email (the unified_contacts table may have duplicate email rows
  // — pick the first unified_id encountered)
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.email)) seen.set(r.email, r);
  }
  return Array.from(seen.values());
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

async function sendOne({ EmailChannel, recipient, subject, html }) {
  const start = Date.now();
  try {
    const result = await EmailChannel.send({ to: recipient.email, subject, html });
    return {
      email: recipient.email,
      unifiedId: recipient.unified_id,
      success: !!result?.success,
      externalId: result?.externalId || null,
      error: result?.error || null,
      ms: Date.now() - start,
    };
  } catch (err) {
    return {
      email: recipient.email,
      unifiedId: recipient.unified_id,
      success: false,
      externalId: null,
      error: err.message || String(err),
      ms: Date.now() - start,
    };
  }
}

// ── recipient list ────────────────────────────────────────────────────────

router.get('/recipients', async (_req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    res.json({ data: recipients });
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
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

    const { rankTrendingWelcome, _internals: rankInternals } = await import('../services/Day1WelcomeRankingService.js');
    const { buildDay1WelcomeData } = await import('../services/Day1WelcomeDataService.js');
    const { renderDay1Welcome } = await import('../services/Day1WelcomeRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    const ranking = useClaude ? await rankTrendingWelcome() : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day1-welcome-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Welcome to Rayna Tours — Your Dream Holiday Starts Here';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay1WelcomeData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay1Welcome(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 1, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
});

// ── DAY 2: Cruise Spotlight ───────────────────────────────────────────────

// Day-2 uses a hardcoded ranking (no Anthropic). Verified product_ids in `products`.
const DAY2_RANKING = {
  saver_product_ids:    [900965, 900972, 900983],
  regional_product_ids: [900981, 900983, 900984, 900986],
  cruise_line_keys:     ['msc', 'costa', 'royal_caribbean', 'genting_dreams'],
  departure_city_keys:  ['abu_dhabi', 'dubai', 'saudi_arabia', 'singapore', 'europe'],
  hero_variant_key:           'horizon',
  regional_copy_variant_key:  'mediterranean',
  hero_product_id:            900965,
};

router.post('/day2', async (req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

    const { buildDay2CruiseData } = await import('../services/Day2CruiseDataService.js');
    const { renderDay2Cruise } = await import('../services/Day2CruiseRenderer.js');

    const ranking = DAY2_RANKING;
    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day2-cruise-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Set Sail: Cruise Highlights from Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay2CruiseData({ contactId: r.unified_id, ranking });
      const html = renderDay2Cruise(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 2, recipients: recipients.length, results, ranking: { source: 'hardcoded' } } });
  } catch (err) { next(err); }
});

// ── DAY 3: Visa Hub ───────────────────────────────────────────────────────

router.post('/day3', async (req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

    const { rankTrendingVisas, _internals: rankInternals } = await import('../services/VisaRankingService.js');
    const { buildDay3VisaData } = await import('../services/Day3VisaDataService.js');
    const { renderDay3Visa } = await import('../services/Day3VisaRenderer.js');

    const useClaude = req.body?.noClaude !== true;
    const ranking = useClaude ? await rankTrendingVisas() : { ranking: rankInternals.buildFallbackRanking(), source: 'fallback' };

    const template = fs.readFileSync(path.join(TEMPLATE_DIR, 'day3-visa-dynamic.html'), 'utf8');
    const subject  = req.body?.subject || 'Your Visa, Sorted — Rayna Tours';

    const EmailChannel = await loadEmailChannel();
    const results = [];
    for (const r of recipients) {
      const data = await buildDay3VisaData({ contactId: r.unified_id, ranking: ranking.ranking });
      const html = renderDay3Visa(template, data);
      if (!leftoversCheck(html)) { results.push({ email: r.email, success: false, error: 'placeholders left' }); continue; }
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 3, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
});

// ── DAY 4: Holidays ───────────────────────────────────────────────────────

router.post('/day4', async (req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

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
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 4, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
});

// ── DAY 5: Activities ─────────────────────────────────────────────────────

router.post('/day5', async (req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

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
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 5, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
});

// ── DAY 6: Destination Spotlight (per-destination) ────────────────────────

router.post('/day6', async (req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

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
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 6, destinationKey, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
});

// ── DAY 7: Abandoned Cart ─────────────────────────────────────────────────

router.post('/day7', async (req, res, next) => {
  try {
    const recipients = await fetchTestRecipients();
    if (recipients.length === 0) return res.status(404).json({ error: 'No TEST_USERS recipients' });

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
      results.push(await sendOne({ EmailChannel, recipient: r, subject, html }));
    }
    res.json({ data: { day: 7, recipients: recipients.length, results, ranking: { source: ranking.source, themes: ranking.trendingThemes } } });
  } catch (err) { next(err); }
});

export default router;
