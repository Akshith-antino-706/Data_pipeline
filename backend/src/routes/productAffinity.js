import { Router } from 'express';
import ProductAffinityService from '../services/ProductAffinityService.js';

const router = Router();

// GET /api/v3/affinity — full affinity data for all 28 segments
router.get('/', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.getAll();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/segment/:id — full recommendation for a segment
router.get('/segment/:id', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getRecommendation(parseInt(req.params.id));
    if (!data) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/segment/:id/what — WHAT to sell
router.get('/segment/:id/what', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getWhatToSell(parseInt(req.params.id));
    if (!data) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/segment/:id/when — WHEN to sell
router.get('/segment/:id/when', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getWhenToSell(parseInt(req.params.id));
    if (!data) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/segment/:id/how — HOW to sell
router.get('/segment/:id/how', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getHowToSell(parseInt(req.params.id));
    if (!data) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/departments — department → product mapping
router.get('/departments', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.getDepartmentMap();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/stats — customer affinity distribution
router.get('/stats', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.getCustomerAffinityStats();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/matrix — segment affinity overlap matrix
router.get('/matrix', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.getAffinityMatrix();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

export default router;
