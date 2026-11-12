import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { QueryRequest } from '../types/routesCommon.js';
import ProductAffinityService from '../services/ProductAffinityService.js';
import { clampInt, parseId } from '../utils/validate.js';

const router = Router();

// POST /api/v3/affinity/sync — sync products + refresh affinity
router.post('/sync', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.runAll();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// POST /api/v3/affinity/sync-products — sync product catalog only
router.post('/sync-products', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.syncProducts();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// POST /api/v3/affinity/refresh — refresh affinity scores from GTM/GA4
router.post('/refresh', async (_req, res, next) => {
  try {
    const data = await ProductAffinityService.refreshAffinity();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/user/:id — get user's product affinity
router.get('/user/:id', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, error: 'id must be a positive integer' });
    const data = await ProductAffinityService.getUserAffinity(id, clampInt(req.query.limit, 10, 50));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/user/:id/recommendations — get personalized product recommendations
router.get('/user/:id/recommendations', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, error: 'id must be a positive integer' });
    const data = await ProductAffinityService.getRecommendations(id, clampInt(req.query.limit, 6, 50));
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/user/:id/template-products — get products formatted for email/WA templates
router.get('/user/:id/template-products', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getTemplateProducts(parseInt(req.params.id));
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

export default router;
