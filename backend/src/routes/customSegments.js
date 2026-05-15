import { Router } from 'express';
import CustomSegmentService from '../services/CustomSegmentService.js';

const router = Router();

// POST /preview-count — must be before /:id to avoid conflict
router.post('/preview-count', async (req, res, next) => {
  try {
    const { conditions } = req.body;
    if (!conditions || !Array.isArray(conditions)) {
      return res.status(400).json({ success: false, error: 'conditions[] is required' });
    }
    const count = await CustomSegmentService.getCountPreview(conditions);
    res.json({ success: true, count });
  } catch (err) { next(err); }
});

// GET / — list all active custom segments (optional ?status=active|draft)
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const data = await CustomSegmentService.getAll({ status });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST / — create a new custom segment
router.post('/', async (req, res, next) => {
  try {
    const { name, description, color, icon, conditions, status } = req.body;
    if (!name || !conditions || !Array.isArray(conditions)) {
      return res.status(400).json({ success: false, error: 'name and conditions[] are required' });
    }
    const data = await CustomSegmentService.create({ name, description, color, icon, conditions, status });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /:id — single segment
router.get('/:id', async (req, res, next) => {
  try {
    const data = await CustomSegmentService.getById(parseInt(req.params.id));
    if (!data) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /:id — update segment
router.put('/:id', async (req, res, next) => {
  try {
    const data = await CustomSegmentService.update(parseInt(req.params.id), req.body);
    if (!data) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /:id — soft-delete
router.delete('/:id', async (req, res, next) => {
  try {
    await CustomSegmentService.delete(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /:id/customers — paginated customers in segment
router.get('/:id/customers', async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const result = await CustomSegmentService.getCustomers(parseInt(req.params.id), {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 25,
      search,
    });
    if (!result) return res.status(404).json({ success: false, error: 'Segment not found' });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

export default router;
