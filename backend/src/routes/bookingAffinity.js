import { Router } from 'express';
import BookingAffinityService, { SERVICES } from '../services/BookingAffinityService.js';

const router = Router();

// Tables are created on first use, so a fresh database works before the first build.
router.use(async (_req, _res, next) => {
  try { await BookingAffinityService.ensureTables(); next(); } catch (err) { next(err); }
});

// Query string → filters. Unknown values fall back to "no filter".
function parseFilters(q) {
  return {
    businessType: q.businessType,
    excludeBulk: q.excludeBulk === '1' || q.excludeBulk === 'true',
    period: q.period,
    view: q.view === 'product' ? 'product' : 'service',
    service: SERVICES.includes(q.service) ? q.service : null,
    product: q.product ? String(q.product) : null,
    search: q.search ? String(q.search).trim().slice(0, 100) : null,
    sort: q.sort,
    limit: q.limit,
    page: q.page,
  };
}

// GET /api/v3/booking-affinity/summary — build status + customers by #1 service / #1 product's service
router.get('/summary', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await BookingAffinityService.getSummary(parseFilters(req.query))) });
  } catch (err) { next(err); }
});

// GET /api/v3/booking-affinity/top-products — most common #1 products for the filters
router.get('/top-products', async (req, res, next) => {
  try {
    const data = await BookingAffinityService.getTopProducts(parseFilters(req.query), req.query.limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/booking-affinity/products?search= — product catalog (pickers)
router.get('/products', async (req, res, next) => {
  try {
    const search = req.query.search ? String(req.query.search).trim().slice(0, 100) : null;
    const data = await BookingAffinityService.searchProducts(search, req.query.limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v3/booking-affinity/customers — customers with their top 3 services and products
router.get('/customers', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await BookingAffinityService.getCustomers(parseFilters(req.query))) });
  } catch (err) { next(err); }
});

// GET /api/v3/booking-affinity/customers.csv — same list as CSV
router.get('/customers.csv', async (req, res, next) => {
  try {
    const csv = await BookingAffinityService.getCustomersCsv(parseFilters(req.query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customer_affinity.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/v3/booking-affinity/customers/:id — every service and product of one customer, ranked
router.get('/customers/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid customer id' });
    const data = await BookingAffinityService.getCustomerDetail(id);
    if (!data) return res.status(404).json({ success: false, error: 'Customer has no bookings in the affinity data' });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// POST /api/v3/booking-affinity/rebuild — rebuild now (runs in the background, a few minutes)
router.post('/rebuild', (_req, res) => {
  if (BookingAffinityService.isRunning()) return res.json({ success: true, started: false, message: 'A build is already running' });
  BookingAffinityService.build().catch(() => { /* logged + recorded in sync_metadata */ });
  res.status(202).json({ success: true, started: true });
});

export default router;
