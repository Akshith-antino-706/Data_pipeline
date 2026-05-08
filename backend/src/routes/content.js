import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { ContentService } from '../services/ContentService.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const TEMPLATES_DIR = path.resolve(path.dirname(__filename), '..', '..', '..', 'mail_templates');

// Map Day N → renderer + data service config. Each entry mirrors what
// backend/scripts/send_dayN_*.js does in --dry-run --no-claude mode but
// is inlined so the preview is fast and has no external dependencies
// (no Claude, no DB writes, no HTTP fetches).
const DAY_TEMPLATES = {
  1: {
    template: 'day1-welcome-dynamic.html',
    rendererModule: '../services/Day1WelcomeRenderer.js',
    renderFn: 'renderDay1Welcome',
    dataModule: '../services/Day1WelcomeDataService.js',
    buildFn: 'buildDay1WelcomeData',
    rankingModule: '../services/Day1WelcomeRankingService.js',
  },
  2: {
    template: 'day2-cruise-dynamic.html',
    rendererModule: '../services/Day2CruiseRenderer.js',
    renderFn: 'renderDay2Cruise',
    dataModule: '../services/Day2CruiseDataService.js',
    buildFn: 'buildDay2CruiseData',
    defaultRanking: {
      saver_product_ids:    [900965, 900972, 900983],
      regional_product_ids: [900981, 900983, 900984, 900986],
      cruise_line_keys:     ['msc', 'costa', 'royal_caribbean', 'genting_dreams'],
      departure_city_keys:  ['abu_dhabi', 'saudi_arabia', 'singapore', 'europe'],
      hero_variant_key:           'horizon',
      regional_copy_variant_key:  'mediterranean',
      hero_product_id:            900965,
    },
  },
  3: {
    template: 'day3-visa-dynamic.html',
    rendererModule: '../services/Day3VisaRenderer.js',
    renderFn: 'renderDay3Visa',
    dataModule: '../services/Day3VisaDataService.js',
    buildFn: 'buildDay3VisaData',
    rankingModule: '../services/Day3VisaRankingService.js',
  },
  4: {
    template: 'day4-holidays-dynamic.html',
    rendererModule: '../services/Day4HolidaysRenderer.js',
    renderFn: 'renderDay4Holidays',
    dataModule: '../services/Day4HolidaysDataService.js',
    buildFn: 'buildDay4HolidaysData',
    rankingModule: '../services/Day4HolidaysRankingService.js',
  },
  5: {
    template: 'day5-activities-dynamic.html',
    rendererModule: '../services/Day5ActivitiesRenderer.js',
    renderFn: 'renderDay5Activities',
    dataModule: '../services/Day5ActivitiesDataService.js',
    buildFn: 'buildDay5ActivitiesData',
    rankingModule: '../services/Day5ActivitiesRankingService.js',
  },
  6: {
    template: 'day6-destination-dynamic.html',
    rendererModule: '../services/Day6DestinationRenderer.js',
    renderFn: 'renderDay6Destination',
    dataModule: '../services/Day6DestinationDataService.js',
    buildFn: 'buildDay6DestinationData',
    rankingModule: '../services/Day6DestinationRankingService.js',
  },
  7: {
    template: 'day7-abandoned-cart-dynamic.html',
    rendererModule: '../services/Day7AbandonedCartRenderer.js',
    renderFn: 'renderDay7AbandonedCart',
    dataModule: '../services/Day7AbandonedCartDataService.js',
    buildFn: 'buildDay7AbandonedCartData',
    rankingModule: '../services/Day7AbandonedCartRankingService.js',
  },
};

async function renderDayTemplatePreview(day) {
  const cfg = DAY_TEMPLATES[day];
  if (!cfg) return null;
  try {
    const rendererMod = await import(cfg.rendererModule);
    const renderFn    = rendererMod[cfg.renderFn];
    const dataMod     = await import(cfg.dataModule);
    const buildFn     = dataMod[cfg.buildFn];
    if (typeof renderFn !== 'function' || typeof buildFn !== 'function') return null;

    let ranking = cfg.defaultRanking;
    if (!ranking && cfg.rankingModule) {
      try {
        const rankMod = await import(cfg.rankingModule);
        const internals = rankMod._internals;
        if (internals?.buildFallbackRanking) {
          const dataInternals = dataMod._internals || {};
          ranking = internals.buildFallbackRanking(dataInternals);
        }
      } catch { /* ranking module unavailable — fall through */ }
    }
    if (!ranking) return null;

    const data = await buildFn({ contactId: 'preview', ranking });
    const templatePath = path.join(TEMPLATES_DIR, cfg.template);
    return renderFn(templatePath, data);
  } catch (err) {
    console.error(`[content preview] Day ${day} render failed:`, err.message);
    return null;
  }
}

// GET /api/v2/content/templates — list all 7 day-templates
router.get('/templates', async (req, res, next) => {
  try {
    const { channel, status, page, limit } = req.query;
    const data = await ContentService.getAll({
      channel, status,
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
      return res.status(400).json({
        success: false,
        error: `Preview only supported for the 7 day-templates (Day 1..Day 7). Got: ${template.name}`,
      });
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

export default router;
