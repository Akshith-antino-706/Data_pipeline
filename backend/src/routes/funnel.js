import { Router } from 'express';
import ConversionFunnel from '../services/ConversionFunnel.js';
const router = Router();

// Get full funnel overview
router.get('/overview', async (req, res, next) => {
  try {
    const data = await ConversionFunnel.getFunnelOverview();
    res.json({ data });
  } catch (err) { next(err); }
});

// Get segment-specific funnel
router.get('/segment/:id', async (req, res, next) => {
  try {
    const data = await ConversionFunnel.getSegmentFunnel(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Segment not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Record a conversion
router.post('/convert', async (req, res, next) => {
  try {
    const { customerId, segmentId, conversionType } = req.body;
    if (!customerId || !segmentId || !conversionType) {
      return res.status(400).json({ error: 'customerId, segmentId, and conversionType are required' });
    }
    const data = await ConversionFunnel.recordConversion(req.body);
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Get channel effectiveness
router.get('/channels', async (req, res, next) => {
  try {
    const data = await ConversionFunnel.getChannelEffectiveness();
    res.json({ data });
  } catch (err) { next(err); }
});

// Get key success metrics
router.get('/metrics', async (req, res, next) => {
  try {
    const data = await ConversionFunnel.getKeyMetrics();
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;
