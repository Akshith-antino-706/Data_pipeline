import { Router } from 'express';
import { CampaignService } from '../services/CampaignService.js';

const router = Router();

// GET /api/v2/campaigns
router.get('/', async (req, res, next) => {
  try {
    const { status, channel, page, limit } = req.query;
    const data = await CampaignService.getAll({
      status, channel,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v2/campaigns/performance — cross-campaign performance
router.get('/performance', async (req, res, next) => {
  try {
    const data = await CampaignService.getPerformanceSummary();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/campaigns/:id
router.get('/:id', async (req, res, next) => {
  try {
    const data = await CampaignService.getById(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Campaign not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/campaigns
router.post('/', async (req, res, next) => {
  try {
    const { name, strategyId, segmentLabel, channel, templateId, filterCriteria, scheduledAt } = req.body;
    if (!name || !segmentLabel || !channel || !templateId) {
      return res.status(400).json({ success: false, error: 'name, segmentLabel, channel, templateId are required' });
    }
    const data = await CampaignService.create({ name, strategyId, segmentLabel, channel, templateId, filterCriteria, scheduledAt });
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/campaigns/:id/execute — launch the campaign
router.post('/:id/execute', async (req, res, next) => {
  try {
    const result = await CampaignService.execute(parseInt(req.params.id));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/v2/campaigns/process-queue — process message queue (worker endpoint)
router.post('/process-queue', async (req, res, next) => {
  try {
    const batchSize = parseInt(req.query.batch) || 100;
    const result = await CampaignService.processQueue(batchSize);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export default router;
