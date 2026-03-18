import { Router } from 'express';
import SegmentEngine from '../services/SegmentEngine.js';
const router = Router();

// Get full funnel overview (7 stages with segments + customer counts)
router.get('/funnel', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getFunnelOverview();
    res.json({ data });
  } catch (err) { next(err); }
});

// Get complete page data (stages + segments + strategies + schema) — powers the segmentation dashboard
router.get('/page-data', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getFullPageData();
    res.json({ data });
  } catch (err) { next(err); }
});

// Get summary stats
router.get('/summary', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getSummaryStats();
    res.json({ data });
  } catch (err) { next(err); }
});

// Run segmentation engine (assign customers to segments)
router.post('/run', async (req, res, next) => {
  try {
    const result = await SegmentEngine.runSegmentation();
    res.json({ data: result });
  } catch (err) { next(err); }
});

// Get single segment detail
router.get('/:id', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getSegmentDetail(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Segment not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Get segment customers with pagination
router.get('/:id/customers', async (req, res, next) => {
  try {
    const { page, limit, search, sortBy, sortDir } = req.query;
    const data = await SegmentEngine.getSegmentCustomers(parseInt(req.params.id), {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 25,
      search,
      sortBy,
      sortDir
    });
    res.json(data);
  } catch (err) { next(err); }
});

// Get conversion metrics for a segment
router.get('/:id/conversions', async (req, res, next) => {
  try {
    const data = await SegmentEngine.getConversionMetrics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;
