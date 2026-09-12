/**
 * Giveaway email endpoints.
 *
 *   POST /api/v3/giveaways/email        → enqueue one giveaway email (§3 contract JSON)
 *   POST /api/v3/giveaways/email/test   → enqueue a SAMPLE message (quick trigger to watch logs)
 *   GET  /api/v3/giveaways/stats        → queue counts (waiting/active/completed/failed)
 *
 * The worker (log-only for now) consumes the queue and logs each message — no email is sent yet.
 */
import { Router } from 'express';
import { enqueueGiveawayEmail, giveawayQueueCounts, recentGiveawayJobs } from '../services/giveaway/giveawayQueue.js';

const router = Router();

// Producer → enqueue one giveaway email. We validate lightly here; the worker does full
// §3-contract validation. We do NOT send here.
router.post('/email', async (req, res) => {
  try {
    const p = req.body;
    if (!p?.id || !p?.to?.email) {
      return res.status(400).json({ ok: false, error: 'id and to.email are required' });
    }
    const job = await enqueueGiveawayEmail(p);
    res.json({ ok: true, queued: true, jobId: job.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Quick trigger — enqueue a sample message so you can watch the worker logs immediately.
// Body (all optional): { id, type, email, name }
router.post('/email/test', async (req, res) => {
  const b = req.body || {};
  const type = b.type || 'winner';
  const name = b.name || 'Test User';
  const sample = {
    version: 1,
    id: b.id || `test-${Date.now()}`,
    type,
    tenantId: b.tenantId || 'raynatours.com',
    giveawayId: b.giveawayId || 'sample-giveaway',
    to: { email: b.email || 'test@example.com', name },
    subject: b.subject || `Giveaway ${type} — test`,
    body: b.body || `Hi ${name},\n\nThis is a ${type} giveaway test message.\n\n— Rayna`,
    bodyFormat: 'text',
    createdAt: new Date().toISOString(),
  };
  try {
    const job = await enqueueGiveawayEmail(sample);
    res.json({ ok: true, queued: true, jobId: job.id, sample });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    res.json({ ok: true, queue: 'giveaway-email', counts: await giveawayQueueCounts() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Recent giveaway events (newest first) — powers the log view.
router.get('/log', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50')));
    const [events, counts] = await Promise.all([recentGiveawayJobs(limit), giveawayQueueCounts()]);
    res.json({ ok: true, counts, events });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
