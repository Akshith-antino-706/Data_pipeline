import { Router } from 'express';
import BigQuerySyncService from '../services/BigQuerySyncService.js';

const router = Router();

// GET /api/v3/sync/status — check sync status for all tables
router.get('/status', async (_req, res) => {
  try {
    const status = await BigQuerySyncService.getSyncStatus();
    res.json({ success: true, tables: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/sync/trigger — manually trigger a full sync (all tables)
router.post('/trigger', async (_req, res) => {
  try {
    const results = await BigQuerySyncService.syncAll();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/sync/trigger/:table — sync a single table
router.post('/trigger/:table', async (req, res) => {
  try {
    const result = await BigQuerySyncService.pullTable(req.params.table);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/sync/gtm-gaps — detect missing GTM events (PG vs BigQuery)
router.get('/gtm-gaps', async (req, res) => {
  try {
    const hoursBack = parseInt(req.query.hours || '24');
    const gaps = await BigQuerySyncService.detectGTMGaps(hoursBack);
    res.json({ success: true, gaps, totalMissing: gaps.reduce((s, g) => s + g.missing, 0) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/sync/backfill-gtm — backfill missing GTM events from BigQuery
router.post('/backfill-gtm', async (req, res) => {
  try {
    const hoursBack = parseInt(req.query.hours || '24');
    const result = await BigQuerySyncService.backfillGTMEvents(hoursBack);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
