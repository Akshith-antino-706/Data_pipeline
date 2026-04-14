import { Router } from 'express';
import ProductAffinityService from '../services/ProductAffinityService.js';

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
router.get('/user/:id', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getUserAffinity(parseInt(req.params.id), parseInt(req.query.limit) || 10);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/affinity/user/:id/recommendations — get personalized product recommendations
router.get('/user/:id/recommendations', async (req, res, next) => {
  try {
    const data = await ProductAffinityService.getRecommendations(parseInt(req.params.id), parseInt(req.query.limit) || 6);
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
