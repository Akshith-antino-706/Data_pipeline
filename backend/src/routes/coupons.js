import { Router } from 'express';
import CouponService from '../services/CouponService.js';

const router = Router();

// GET /api/v3/coupons — List all coupons
router.get('/', async (req, res) => {
  try {
    const coupons = await CouponService.getAll();
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/coupons/:id — Get coupon details with usage
router.get('/:id', async (req, res) => {
  try {
    const coupon = await CouponService.getById(req.params.id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/coupons — Create a new coupon
router.post('/', async (req, res) => {
  try {
    const coupon = await CouponService.create(req.body);
    res.status(201).json(coupon);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v3/coupons/:id — Update a coupon
router.put('/:id', async (req, res) => {
  try {
    const coupon = await CouponService.update(req.params.id, req.body);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v3/coupons/:id — Delete a coupon
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await CouponService.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Coupon not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/coupons/validate — Validate a coupon code
router.post('/validate', async (req, res) => {
  try {
    const result = await CouponService.validate(req.body.code, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/coupons/apply — Apply a coupon
router.post('/apply', async (req, res) => {
  try {
    const result = await CouponService.apply(req.body.code, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/coupons/segment/:label — Get coupons for a segment
router.get('/segment/:label', async (req, res) => {
  try {
    const coupons = await CouponService.getForSegment(req.params.label);
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
