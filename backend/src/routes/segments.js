import { Router } from 'express';
import { SegmentService } from '../services/SegmentService.js';

const router = Router();

// GET /api/v2/segments — overview of all segments
router.get('/', async (req, res, next) => {
  try {
    const data = await SegmentService.getSegmentOverview();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/segments/by-type — segments grouped by B2B/B2C
router.get('/by-type', async (req, res, next) => {
  try {
    const data = await SegmentService.getSegmentByType();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/segments/:label/customers — paginated customers in segment
router.get('/:label/customers', async (req, res, next) => {
  try {
    const { page, limit, search, channel, sortBy, sortDir } = req.query;
    const data = await SegmentService.getSegmentCustomers(req.params.label, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      search, channel, sortBy, sortDir,
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v2/segments/:label/nationalities
router.get('/:label/nationalities', async (req, res, next) => {
  try {
    const data = await SegmentService.getSegmentNationalities(req.params.label);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/segments/:label/genders
router.get('/:label/genders', async (req, res, next) => {
  try {
    const data = await SegmentService.getSegmentGenders(req.params.label);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

export default router;
