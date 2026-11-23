import { Router } from 'express';
import UTMService from '../services/UTMService.js';
import type { U2JourneyNodeBody } from '../types/u2Routes.js';

const router = Router();

// POST /api/v3/utm/build — Build a single UTM URL
// Body accepts optional journeyId, nodeId to embed in utm_content
router.post('/build', async (req, res) => {
  try {
    const url = UTMService.buildUTM(req.body as Parameters<typeof UTMService.buildUTM>[0]);
    res.json({ utm_url: url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/v3/utm/segments — Get all segments with UTM stats (for dropdown)
router.get('/segments', async (req, res) => {
  try {
    const data = await UTMService.getSegmentsList();
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/v3/utm/segment/:label — Generate UTM for all templates in a segment
// Body accepts optional { journeyId, nodeId }
router.post('/segment/:label', async (req, res) => {
  try {
    const { journeyId, nodeId } = req.body as U2JourneyNodeBody | undefined || {};
    const links = await UTMService.generateForSegment(decodeURIComponent(req.params.label), { journeyId, nodeId });
    res.json({ segment: req.params.label, links });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/v3/utm/generate-all — Generate UTM for ALL segments
// Body accepts optional { journeyId, nodeId }
router.post('/generate-all', async (req, res) => {
  try {
    const { journeyId, nodeId } = req.body as U2JourneyNodeBody | undefined || {};
    const results = await UTMService.generateForAllSegments({ journeyId, nodeId });
    const totalLinks = results.reduce((sum, r) => sum + r.links_generated, 0);
    res.json({ segments_processed: results.length, total_links: totalLinks, results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/v3/utm/campaign/:id — Generate UTM for a campaign
// Body accepts optional { journeyId, nodeId }
router.post('/campaign/:id', async (req, res) => {
  try {
    const { journeyId, nodeId } = req.body as U2JourneyNodeBody | undefined || {};
    const result = await UTMService.generateForCampaign(req.params.id, { journeyId, nodeId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/v3/utm/analytics — UTM tracking analytics
router.get('/analytics', async (req, res) => {
  try {
    const data = await UTMService.getAnalytics(req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/v3/utm/:id/click — Record a UTM click
router.post('/:id/click', async (req, res) => {
  try {
    await UTMService.recordClick(req.params.id);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/v3/utm/:id/conversion — Record a UTM conversion
router.post('/:id/conversion', async (req, res) => {
  try {
    await UTMService.recordConversion(req.params.id, (req.body as { revenue?: unknown } | undefined)?.revenue);
    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PER-USER UTM LINKS — Unique trackable URL per contact
// ═══════════════════════════════════════════════════════════════

// GET /api/v3/utm/track/:token — Click redirect (this URL goes in emails)
// User clicks → we record click → redirect to Rayna website with rid param
router.get('/track/:token', async (req, res) => {
  try {
    const link = await UTMService.trackClick(req.params.token) as { destination_url: string } | null;
    if (!link) return res.status(404).send('Link not found');
    res.redirect(302, link.destination_url);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/v3/utm/user-links/:campaignId — Generate per-user links for a campaign
router.post('/user-links/:campaignId', async (req, res) => {
  try {
    const result = await UTMService.generateUserLinks(req.params.campaignId, req.body as Parameters<typeof UTMService.generateUserLinks>[1]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/v3/utm/user-links — List user links with filters
router.get('/user-links', async (req, res) => {
  try {
    const data = await UTMService.getUserLinks(req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/v3/utm/user-links-stats — Per-campaign user link stats
router.get('/user-links-stats', async (req, res) => {
  try {
    const data = await UTMService.getUserLinkStats();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
