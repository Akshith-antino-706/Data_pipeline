import { Router } from 'express';
import JourneyService from '../services/JourneyService.js';
import ConversionDetector from '../services/ConversionDetector.js';
const router = Router();

// List journeys
router.get('/', async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const data = await JourneyService.getAll({ status, page: parseInt(page) || 1, limit: parseInt(limit) || 20 });
    res.json(data);
  } catch (err) { next(err); }
});

// Get journey detail
router.get('/:id', async (req, res, next) => {
  try {
    const data = await JourneyService.getById(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Journey not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Create journey
router.post('/', async (req, res, next) => {
  try {
    const data = await JourneyService.create(req.body);
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Update journey
router.put('/:id', async (req, res, next) => {
  try {
    const data = await JourneyService.update(parseInt(req.params.id), req.body);
    res.json({ data });
  } catch (err) { next(err); }
});

// Delete journey
router.delete('/:id', async (req, res, next) => {
  try {
    await JourneyService.delete(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Auto-generate journey from strategy
router.post('/generate-from-strategy/:strategyId', async (req, res, next) => {
  try {
    const data = await JourneyService.generateFromStrategy(parseInt(req.params.strategyId));
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Enroll segment customers into journey
router.post('/:id/enroll', async (req, res, next) => {
  try {
    const data = await JourneyService.enrollSegment(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Process journey (advance customers through nodes)
router.post('/:id/process', async (req, res, next) => {
  try {
    const data = await JourneyService.processJourney(parseInt(req.params.id), parseInt(req.query.batch) || 100);
    res.json({ data });
  } catch (err) { next(err); }
});

// Get journey analytics
router.get('/:id/analytics', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyAnalytics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Get campaign analytics inside journey (sent, delivered, read, click, bounce per node)
router.get('/:id/campaign-analytics', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyCampaignAnalytics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Check conversions (BigQuery purchase + offline booking) and stop converted enrollments
router.post('/:id/check-conversions', async (req, res, next) => {
  try {
    const data = await JourneyService.checkConversions(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Get enrollment status for a journey
router.get('/:id/enrollments', async (req, res, next) => {
  try {
    const data = await JourneyService.getEnrollments(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Run conversion detection + auto-enrollment across all journeys
router.post('/detect-conversions', async (_req, res, next) => {
  try {
    const data = await ConversionDetector.runAll();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// Process all active journeys at once
router.post('/process-all', async (_req, res, next) => {
  try {
    const { rows: journeys } = await (await import('../config/database.js')).default.query(
      "SELECT journey_id FROM journey_flows WHERE status = 'active'"
    );
    const results = [];
    for (const j of journeys) {
      const r = await JourneyService.processJourney(j.journey_id);
      results.push({ journey_id: j.journey_id, ...r });
    }
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

export default router;
