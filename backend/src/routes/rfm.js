import { Router } from 'express';
import RFMService from '../services/RFMService.js';

const router = Router();

// GET /api/v3/rfm — RFM overview with distribution
router.get('/', async (req, res) => {
  try {
    const data = await RFMService.getRFMOverview();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/rfm/segment/:id — RFM analysis for a specific segment
router.get('/segment/:id', async (req, res) => {
  try {
    const data = await RFMService.getSegmentRFM(req.params.id);
    if (!data) return res.status(404).json({ error: 'Segment not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/rfm/recalculate — Recalculate all RFM scores
router.post('/recalculate', async (req, res) => {
  try {
    const result = await RFMService.recalculate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
