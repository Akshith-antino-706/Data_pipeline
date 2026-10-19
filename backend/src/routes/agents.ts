import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { QueryRequest } from '../types/routesCommon.js';
import { Copywriter, SegmentAssist, FlowAssist, AnalyticsInsights } from '../services/AIAgents.js';
import db from '../config/database.js';
import { parseId } from '../utils/validate.js';
const router = Router();

// ── Copywriter Agent ──────────────────────────────────────
router.post('/copywriter/generate', async (req: QueryRequest<{ segmentId: string; channel: string; tone?: string }>, res: Response, next: NextFunction) => {
  try {
    const { segmentId, channel, tone } = req.body;
    if (!segmentId || !channel) return res.status(400).json({ error: 'segmentId and channel required' });
    const data = await Copywriter.generateForSegment(parseInt(segmentId), channel, tone);
    res.json({ data });
  } catch (err) { next(err); }
});

// ── SegmentAssist Agent ───────────────────────────────────
router.get('/segment-assist/analyze', async (req, res, next) => {
  try {
    const data = await SegmentAssist.analyzeAndSuggest();
    res.json({ data });
  } catch (err) { next(err); }
});

// ── FlowAssist Agent ──────────────────────────────────────
router.get('/flow-assist/suggest/:journeyId', async (req, res, next) => {
  try {
    const journeyId = parseId(req.params.journeyId);
    if (journeyId === null) return res.status(400).json({ error: 'journeyId must be a positive integer' });
    const data = await FlowAssist.suggestFlowImprovements(journeyId);
    res.json({ data });
  } catch (err) { next(err); }
});

router.post('/flow-assist/auto-optimize/:journeyId', async (req, res, next) => {
  try {
    const journeyId = parseId(req.params.journeyId);
    if (journeyId === null) return res.status(400).json({ error: 'journeyId must be a positive integer' });
    const data = await FlowAssist.autoOptimize(journeyId);
    res.json({ data });
  } catch (err) { next(err); }
});

// ── AnalyticsInsights Agent ───────────────────────────────
router.get('/insights', async (req, res, next) => {
  try {
    const data = await AnalyticsInsights.generateInsights();
    res.json({ data });
  } catch (err) { next(err); }
});

// Auto-optimize all active strategies (Vaibhav: "Claude itself should do it, no human")
router.post('/auto-optimize', async (req, res, next) => {
  try {
    const data = await AnalyticsInsights.autoOptimizeStrategies();
    res.json({ data });
  } catch (err) { next(err); }
});

// ── Agent Logs ────────────────────────────────────────────
router.get('/logs', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const { agent_type, limit } = req.query;
    let where = '1=1';
    const params: string[] = [];
    if (agent_type) { params.push(agent_type); where += ` AND agent_type = $${params.length}`; }
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM ai_agent_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1}`,
      [...params, parseInt(limit) || 50]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

export default router;
