import { Router } from 'express';
import UnifiedContactService from '../services/UnifiedContactService.js';

const router = Router();

router.get('/stats', async (_req, res, next) => {
  try {
    const data = await UnifiedContactService.getStats();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { search, sortBy, sortDir, source, country } = req.query;
    const result = await UnifiedContactService.getAll({ page, limit, search, sortBy, sortDir, source, country });
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
