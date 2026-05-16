import { Router } from 'express';
import JourneyService from '../services/JourneyService.js';
import ConversionDetector from '../services/ConversionDetector.js';
const router = Router();

// List journeys (supports ?audience=indian|rest|all)
router.get('/', async (req, res, next) => {
  try {
    const { status, audience, page, limit } = req.query;
    const data = await JourneyService.getAll({ status, audience, page: parseInt(page) || 1, limit: parseInt(limit) || 20 });
    res.json(data);
  } catch (err) { next(err); }
});

// Get journey detail
router.get('/:id', async (req, res, next) => {
  try {
    const data = await JourneyService.getById(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Journey not found' });
    res.json({ data });
  } catch (err) { next(err); }
});

// Create journey
router.post('/', async (req, res, next) => {
  try {
    const data = await JourneyService.create(req.body);
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Update journey
router.put('/:id', async (req, res, next) => {
  try {
    const data = await JourneyService.update(parseInt(req.params.id), req.body);
    res.json({ data });
  } catch (err) { next(err); }
});

// Delete journey
router.delete('/:id', async (req, res, next) => {
  try {
    await JourneyService.delete(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Node-level CRUD (used by the UI editor) ──
router.post('/:id/nodes', async (req, res, next) => {
  try {
    const { node, afterNodeId } = req.body;
    const data = await JourneyService.addNode(parseInt(req.params.id), node, afterNodeId);
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

router.patch('/:id/nodes/:nodeId', async (req, res, next) => {
  try {
    const data = await JourneyService.updateNode(parseInt(req.params.id), req.params.nodeId, req.body);
    res.json({ data });
  } catch (err) { next(err); }
});

router.delete('/:id/nodes/:nodeId', async (req, res, next) => {
  try {
    const data = await JourneyService.deleteNode(parseInt(req.params.id), req.params.nodeId);
    res.json({ data });
  } catch (err) { next(err); }
});

// Manual test-send for a single action node (email / sms / whatsapp).
// Body: { recipient: "<email or phone>" }
router.post('/:id/nodes/:nodeId/test', async (req, res, next) => {
  try {
    const data = await JourneyService.testSendNode(
      parseInt(req.params.id),
      req.params.nodeId,
      req.body?.recipient
    );
    res.json({ data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Batch test-send — sends to all recipients in parallel, returns per-recipient logs.
// Body: { recipients: string[] }
router.post('/:id/nodes/:nodeId/test-batch', async (req, res, next) => {
  try {
    const { recipients } = req.body;
    const data = await JourneyService.testSendNodeBatch(
      parseInt(req.params.id),
      req.params.nodeId,
      recipients
    );
    res.json({ data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk test-send — generates email+1, email+2 ... email+N (Gmail + trick)
// so all land in the same inbox. Body: { email, count }
router.post('/:id/nodes/:nodeId/bulk-test', async (req, res, next) => {
  try {
    const { email, count = 100 } = req.body;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const n = Math.min(Math.max(parseInt(count) || 100, 1), 5000);
    const [local, domain] = email.trim().split('@');

    // Generate local+test1@domain … local+testN@domain
    const recipients = Array.from({ length: n }, (_, i) => `${local}+test${i + 1}@${domain}`);

    // Send in parallel batches of 50 to avoid overwhelming SMTP
    const BATCH = 50;
    let sent = 0, failed = 0;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        batch.map(r => JourneyService.testSendNode(parseInt(req.params.id), req.params.nodeId, r))
      );
      settled.forEach(r => r.status === 'fulfilled' && r.value?.success ? sent++ : failed++);
    }

    res.json({ data: { total: n, sent, failed, baseEmail: email.trim() } });
  } catch (err) { next(err); }
});

// Segment test send — sends to real segment customers but overrides delivery email
// to testEmail+testN@domain so all land in one inbox. Body: { testEmail, limit }
router.post('/:id/nodes/:nodeId/segment-test', async (req, res, next) => {
  try {
    const { testEmail = 'rocky.86agency@gmail.com', limit = 100 } = req.body;
    if (!testEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testEmail.trim())) {
      return res.status(400).json({ error: 'Valid testEmail required' });
    }
    const data = await JourneyService.testSendNodeToSegment(
      parseInt(req.params.id),
      req.params.nodeId,
      testEmail.trim(),
      parseInt(limit) || 100
    );
    res.json({ data });
  } catch (err) { next(err); }
});

// Get persisted send log for a specific action node (campaign stats)
router.get('/:id/nodes/:nodeId/send-log', async (req, res, next) => {
  try {
    const data = await JourneyService.getNodeSendLog(parseInt(req.params.id), req.params.nodeId);
    res.json({ data });
  } catch (err) { next(err); }
});

// Auto-generate journey from strategy
router.post('/generate-from-strategy/:strategyId', async (req, res, next) => {
  try {
    const data = await JourneyService.generateFromStrategy(parseInt(req.params.strategyId));
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

// Start journey: activate + enroll + first process
router.post('/:id/start', async (req, res, next) => {
  try {
    const data = await JourneyService.startJourney(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Pause or resume journey (toggle)
router.post('/:id/pause', async (req, res, next) => {
  try {
    const data = await JourneyService.pauseJourney(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Enroll segment customers into journey
router.post('/:id/enroll', async (req, res, next) => {
  try {
    const data = await JourneyService.enrollSegment(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Process journey (advance customers through nodes)
router.post('/:id/process', async (req, res, next) => {
  try {
    const data = await JourneyService.processJourney(parseInt(req.params.id), parseInt(req.query.batch) || 100);
    res.json({ data });
  } catch (err) { next(err); }
});

// Get journey entries (real flow data)
router.get('/:id/entries', async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const data = await JourneyService.getEntries(parseInt(req.params.id), { page: parseInt(page) || 1, limit: parseInt(limit) || 50, status });
    res.json(data);
  } catch (err) { next(err); }
});

// Get journey analytics
router.get('/:id/analytics', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyAnalytics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Get campaign analytics inside journey (sent, delivered, read, click, bounce per node)
router.get('/:id/campaign-analytics', async (req, res, next) => {
  try {
    const data = await JourneyService.getJourneyCampaignAnalytics(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Check conversions (BigQuery purchase + offline booking) and stop converted enrollments
router.post('/:id/check-conversions', async (req, res, next) => {
  try {
    const data = await JourneyService.checkConversions(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Get enrollment status for a journey
router.get('/:id/enrollments', async (req, res, next) => {
  try {
    const data = await JourneyService.getEnrollments(parseInt(req.params.id));
    res.json({ data });
  } catch (err) { next(err); }
});

// Run conversion detection + auto-enrollment across all journeys
router.post('/detect-conversions', async (_req, res, next) => {
  try {
    const data = await ConversionDetector.runAll();
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// Process all active journeys at once
router.post('/process-all', async (_req, res, next) => {
  try {
    const { rows: journeys } = await (await import('../config/database.js')).default.query(
      "SELECT journey_id FROM journey_flows WHERE status = 'active'"
    );
    const results = [];
    for (const j of journeys) {
      const r = await JourneyService.processJourney(j.journey_id);
      results.push({ journey_id: j.journey_id, ...r });
    }
    res.json({ success: true, results });
  } catch (err) { next(err); }
});

export default router;
