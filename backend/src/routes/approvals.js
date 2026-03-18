import { Router } from 'express';
import ApprovalService from '../services/ApprovalService.js';

const router = Router();

// GET /api/v3/approvals — Get approval queue
router.get('/', async (req, res) => {
  try {
    const items = await ApprovalService.getQueue(req.query);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/approvals/stats — Get approval stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await ApprovalService.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/approvals/:id — Get single approval
router.get('/:id', async (req, res) => {
  try {
    const item = await ApprovalService.getById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/approvals — Request approval
router.post('/', async (req, res) => {
  try {
    const item = await ApprovalService.requestApproval(req.body);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/approvals/:id/approve — Approve
router.post('/:id/approve', async (req, res) => {
  try {
    const item = await ApprovalService.approve(req.params.id, req.body.reviewedBy);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/approvals/:id/reject — Reject
router.post('/:id/reject', async (req, res) => {
  try {
    const item = await ApprovalService.reject(req.params.id, req.body.reviewedBy);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
