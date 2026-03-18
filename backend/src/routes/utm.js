import { Router } from 'express';
import UTMService from '../services/UTMService.js';

const router = Router();

// POST /api/v3/utm/build — Build a single UTM URL
router.post('/build', async (req, res) => {
  try {
    const url = UTMService.buildUTM(req.body);
    res.json({ utm_url: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/utm/segment/:label — Generate UTM for all templates in a segment
router.post('/segment/:label', async (req, res) => {
  try {
    const links = await UTMService.generateForSegment(req.params.label);
    res.json({ segment: req.params.label, links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/utm/campaign/:id — Generate UTM for a campaign
router.post('/campaign/:id', async (req, res) => {
  try {
    const result = await UTMService.generateForCampaign(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/utm/analytics — UTM tracking analytics
router.get('/analytics', async (req, res) => {
  try {
    const data = await UTMService.getAnalytics(req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/utm/:id/click — Record a UTM click
router.post('/:id/click', async (req, res) => {
  try {
    await UTMService.recordClick(req.params.id);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/utm/:id/conversion — Record a UTM conversion
router.post('/:id/conversion', async (req, res) => {
  try {
    await UTMService.recordConversion(req.params.id, req.body.revenue);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
