import { Router } from 'express';
import UnifiedContactService from '../services/UnifiedContactService.js';
import UnifiedContactSync from '../services/UnifiedContactSync.js';

const router = Router();

// POST /api/v3/unified-contacts/sync — trigger incremental sync
router.post('/sync', async (_req, res, next) => {
  try {
    const result = await UnifiedContactSync.run();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.getStats();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/filters', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.getFilterOptions();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const search = req.query.search ? String(req.query.search).slice(0, 200).trim() : undefined;
    const { sortBy, sortDir } = req.query;
    const source = req.query.source || undefined;
    const country = req.query.country || undefined;
    const contactType = req.query.contactType || undefined;
    const bookingStatus = req.query.bookingStatus || undefined;
    const productTier = req.query.productTier || undefined;
    const geography = req.query.geography || undefined;
    const hasChats = req.query.hasChats || undefined;
    const hasBookings = req.query.hasBookings || undefined;
    const waStatus = req.query.waStatus || undefined;
    const emailStatus = req.query.emailStatus || undefined;
    const result = await UnifiedContactService.getAll({ page, limit, search, sortBy, sortDir, source, country,
      contactType, bookingStatus, productTier, geography, hasChats, hasBookings, waStatus, emailStatus });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segmentation-tree — 3-step decision tree dashboard data
router.get('/segmentation-tree', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.getSegmentationTree();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v3/unified-contacts/segment-customers — customers for a specific segment combo
router.get('/segment-customers', async (req, res, next) => {
  try {
    const { bookingStatus, productTier, geography, page, limit, search } = req.query;
    const result = await UnifiedContactService.getSegmentCustomers({
      bookingStatus, productTier, geography,
      page: parseInt(page) || 1, limit: parseInt(limit) || 25, search,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const contact = await UnifiedContactService.getById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: contact });
  } catch (err) { next(err); }
});

export default router;
