import { Router } from 'express';
import CustomerService from '../services/CustomerService.js';

const router = Router();

// GET /api/v3/customers/stats — summary KPIs
router.get('/stats', async (_req, res, next) => {
  try {
    const data = await CustomerService.getStats();
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/customers — paginated list
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { search, sortBy, sortDir, country, city } = req.query;

    const result = await CustomerService.getAll({ page, limit, search, sortBy, sortDir, country, city });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/v3/customers/:id — single customer detail
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await CustomerService.getById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json({ success: true, data: customer });
  } catch (err) { next(err); }
});

export default router;
