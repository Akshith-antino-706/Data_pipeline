import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { ContentService } from '../services/ContentService.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const TEMPLATES_DIR = process.env.NODE_ENV === 'production'
  ? '/mail_templates'
  : path.resolve(path.dirname(__filename), '..', '..', '..', 'mail_templates');

// Each Day has its own fallback-ranking signature (the dry-run scripts
// in backend/scripts/send_dayN_*.js diverge for each). The dispatcher
// below mirrors what `--dry-run --no-claude` produces, inlined so the
// preview is fast (no Claude, no HTTP). DB queries are still allowed —
// some fallbacks fetch product candidates from the products table.

async function renderDayTemplatePreview(day) {
  try {
    if (day === 1) {
      const { renderDay1Welcome }    = await import('../services/Day1WelcomeRenderer.js');
      const { buildDay1WelcomeData, _internals: dataInternals } = await import('../services/Day1WelcomeDataService.js');
      const { _internals: rankInternals } = await import('../services/Day1WelcomeRankingService.js');
      const visaRows = await rankInternals.loadVisaCatalog();
      const visaMap  = Object.fromEntries(visaRows.map(r => [r.key, r]));
      const ranking  = rankInternals.buildFallbackRanking({
        holidayMap:  dataInternals.HOLIDAY_DESTINATIONS,
        cruiseMap:   dataInternals.CRUISE_DESTINATIONS,
        activityMap: dataInternals.ACTIVITY_DESTINATIONS,
        visaMap,
      });
      const data = await buildDay1WelcomeData({ contactId: 'preview', ranking });
      return renderDay1Welcome(path.join(TEMPLATES_DIR, 'day1-welcome-dynamic.html'), data);
    }

    if (day === 2) {
      const { renderDay2Cruise }    = await import('../services/Day2CruiseRenderer.js');
      const { buildDay2CruiseData } = await import('../services/Day2CruiseDataService.js');
      const ranking = {
        saver_product_ids:    [900965, 900972, 900983],
        regional_product_ids: [900981, 900983, 900984, 900986],
        cruise_line_keys:     ['msc', 'costa', 'royal_caribbean', 'genting_dreams'],
        departure_city_keys:  ['abu_dhabi', 'saudi_arabia', 'singapore', 'europe'],
        hero_variant_key:           'horizon',
        regional_copy_variant_key:  'mediterranean',
        hero_product_id:            900965,
      };
      const data = await buildDay2CruiseData({ contactId: 'preview', ranking });
      return renderDay2Cruise(path.join(TEMPLATES_DIR, 'day2-cruise-dynamic.html'), data);
    }

    if (day === 3) {
      const { renderDay3Visa }      = await import('../services/Day3VisaRenderer.js');
      const { buildDay3VisaData }   = await import('../services/Day3VisaDataService.js');
      const { _internals: rankInternals } = await import('../services/VisaRankingService.js');
      const catalog = await rankInternals.loadVisaCatalog();
      // The fallback omits `ratings_keys` because Claude doesn't pick those —
      // the send script injects them after the rank call. Mirror that here.
      const ranking = {
        ...rankInternals.buildFallbackRanking(catalog),
        ratings_keys: ['rayna', 'trustpilot', 'tripadvisor', 'google'],
      };
      const data = await buildDay3VisaData({ contactId: 'preview', ranking });
      return renderDay3Visa(path.join(TEMPLATES_DIR, 'day3-visa-dynamic.html'), data);
    }

    if (day === 4) {
      const { renderDay4Holidays }    = await import('../services/Day4HolidaysRenderer.js');
      const { buildDay4HolidaysData } = await import('../services/Day4HolidaysDataService.js');
      const { _internals: rankInternals } = await import('../services/Day4HolidaysRankingService.js');
      const ranking = rankInternals.buildFallbackRanking();
      const data    = await buildDay4HolidaysData({ contactId: 'preview', ranking });
      return renderDay4Holidays(path.join(TEMPLATES_DIR, 'day4-holidays-dynamic.html'), data);
    }

    if (day === 5) {
      const { renderDay5Activities }    = await import('../services/Day5ActivitiesRenderer.js');
      const { buildDay5ActivitiesData } = await import('../services/Day5ActivitiesDataService.js');
      const { _internals: rankInternals } = await import('../services/Day5ActivitiesRankingService.js');
      const ranking = rankInternals.buildFallbackRanking();
      const data    = await buildDay5ActivitiesData({ contactId: 'preview', ranking });
      return renderDay5Activities(path.join(TEMPLATES_DIR, 'day5-activities-dynamic.html'), data);
    }

    if (day === 6) {
      const { renderDay6Destination }    = await import('../services/Day6DestinationRenderer.js');
      const { buildDay6DestinationData, _internals: dataInternals } = await import('../services/Day6DestinationDataService.js');
      const { _internals: rankInternals } = await import('../services/Day6DestinationRankingService.js');
      // Pick the first destination in the catalog as the preview default.
      const destinationKey = Object.keys(dataInternals.DESTINATION_CATALOG || {})[0] || 'bali';
      const dest = dataInternals.DESTINATION_CATALOG[destinationKey];
      const [holidayCandidates, activityCandidates, cruiseCandidates] = await Promise.all([
        rankInternals.fetchHolidayCandidates(dest.productCity),
        rankInternals.fetchActivityCandidates(dest.productCity),
        rankInternals.fetchCruiseCandidates(dest.cruiseCategory),
      ]);
      const ranking = rankInternals.buildFallbackRanking({ holidayCandidates, activityCandidates, cruiseCandidates });
      const data    = await buildDay6DestinationData({ contactId: 'preview', destinationKey, ranking });
      return renderDay6Destination(path.join(TEMPLATES_DIR, 'day6-destination-dynamic.html'), data);
    }

    if (day === 7) {
      const { renderDay7AbandonedCart }    = await import('../services/Day7AbandonedCartRenderer.js');
      const { buildDay7AbandonedCartData } = await import('../services/Day7AbandonedCartDataService.js');
      const { _internals: rankInternals } = await import('../services/Day7AbandonedCartRankingService.js');
      const [activities, holidays, cruises, visas] = await Promise.all([
        rankInternals.fetchCandidates('activities'),
        rankInternals.fetchCandidates('holiday'),
        rankInternals.fetchCandidates('cruise'),
        rankInternals.fetchVisaKeys(),
      ]);
      const ranking = rankInternals.buildFallbackRanking({ activities, holidays, cruises, visas });
      // contactId must be numeric (used in ga4_events lookup); null short-circuits the query.
      const data    = await buildDay7AbandonedCartData({ contactId: null, ranking });
      return renderDay7AbandonedCart(path.join(TEMPLATES_DIR, 'day7-abandoned-cart-dynamic.html'), data);
    }

    return null;
  } catch (err) {
    console.error(`[content preview] Day ${day} render failed:`, err.stack || err);
    return null;
  }
}

// GET /api/v2/content/templates — list all 7 day-templates
router.get('/templates', async (req, res, next) => {
  try {
    const { channel, status, search, page, limit } = req.query;
    const data = await ContentService.getAll({
      channel, status, search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v2/content/templates/:id
router.get('/templates/:id', async (req, res, next) => {
  try {
    const data = await ContentService.getById(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/content/templates/:id/preview — render via the file-based Day{N} renderer
router.get('/templates/:id/preview', async (req, res, next) => {
  try {
    const template = await ContentService.getById(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
    if (template.channel !== 'email') {
      return res.json({ success: true, data: { html: template.body } });
    }

    const dayMatch = (template.name || '').match(/^Day\s+(\d)\s*-/i);
    if (!dayMatch) {
      return res.json({ success: true, data: { html: template.body || '<p>No content</p>' } });
    }
    const html = await renderDayTemplatePreview(parseInt(dayMatch[1]));
    if (!html) {
      return res.status(500).json({
        success: false,
        error: `Day ${dayMatch[1]} renderer failed — check server logs.`,
      });
    }
    res.json({ success: true, data: { html } });
  } catch (err) { next(err); }
});

// GET /api/v2/content/templates/:id/preview-ai — render the REAL AI version (Claude ranking)
// Only for the dynamic Day1-7 templates. Slow (~15-25s on first call), then cached 1h.
router.get('/templates/:id/preview-ai', async (req, res, next) => {
  try {
    const template = await ContentService.getById(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });

    // Reads today's daily master (generated by the daily cron). Generates on-demand
    // if today's row doesn't exist yet. No live per-request Claude unless missing.
    const { getDailyAITemplate } = await import('../services/JourneyService.js');
    const rendered = await getDailyAITemplate(parseInt(req.params.id));
    if (!rendered?.html) {
      return res.status(400).json({ success: false, error: 'This template has no AI/dynamic renderer (only Day 1-7 templates are AI-ranked).' });
    }
    res.json({ success: true, data: { html: rendered.html, subject: rendered.subject, source: rendered.source, day: rendered.day } });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates/:id/preview — preview with custom variable values
// Body: { variables: { offer_tag: "20% off", holiday_name: "Diwali", ... } }
router.post('/templates/:id/preview', async (req, res, next) => {
  try {
    const template = await ContentService.getById(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });

    // Static Day N templates use the file-based renderer, not EmailRenderer
    const dayMatch = template.channel === 'email' && (template.name || '').match(/^Day\s+(\d)\s*-/i);
    if (dayMatch) {
      const html = await renderDayTemplatePreview(parseInt(dayMatch[1]));
      if (!html) return res.status(500).json({ success: false, error: `Day ${dayMatch[1]} renderer failed` });
      return res.json({ success: true, data: { html, subject: template.subject || '' } });
    }

    const { default: EmailRenderer } = await import('../services/EmailRenderer.js');
    const result = await EmailRenderer.renderPreview(parseInt(req.params.id), req.body?.variables || {});
    res.json({ success: true, data: { html: result.html, subject: result.subject } });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates
router.post('/templates', async (req, res, next) => {
  try {
    const data = await ContentService.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/v2/content/templates/:id
router.put('/templates/:id', async (req, res, next) => {
  try {
    const data = await ContentService.update(req.params.id, req.body);
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates/:id/approve
router.post('/templates/:id/approve', async (req, res, next) => {
  try {
    const data = await ContentService.approve(req.params.id, req.body.approvedBy || 'system');
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates/:id/reject
router.post('/templates/:id/reject', async (req, res, next) => {
  try {
    const data = await ContentService.reject(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/v2/content/templates/:id
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const deleted = await ContentService.delete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
