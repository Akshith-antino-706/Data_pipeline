import { Router } from 'express';
import { StrategyService } from '../services/StrategyService.js';
import { AIService } from '../services/AIService.js';

const router = Router();

// GET /api/v2/strategies
router.get('/', async (req, res, next) => {
  try {
    const data = await StrategyService.getAll();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/strategies/:id
router.get('/:id', async (req, res, next) => {
  try {
    const data = await StrategyService.getById(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Strategy not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/strategies
router.post('/', async (req, res, next) => {
  try {
    const { name, description, segmentLabel, channels, flowSteps } = req.body;
    if (!name || !segmentLabel) {
      return res.status(400).json({ success: false, error: 'name and segmentLabel are required' });
    }
    const data = await StrategyService.create({ name, description, segmentLabel, channels, flowSteps });
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/v2/strategies/:id
router.put('/:id', async (req, res, next) => {
  try {
    const data = await StrategyService.update(req.params.id, req.body);
    if (!data) return res.status(404).json({ success: false, error: 'Strategy not found or nothing to update' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/strategies/segment/:label
router.get('/segment/:label', async (req, res, next) => {
  try {
    const data = await StrategyService.getBySegment(req.params.label);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/strategies/:id/optimize — run AI optimization
router.post('/:id/optimize', async (req, res, next) => {
  try {
    const result = await AIService.optimizeStrategy(parseInt(req.params.id));
    if (!result) return res.status(404).json({ success: false, error: 'Strategy not found' });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

export default router;
