import { Router } from 'express';
import BigQuerySyncService from '../services/BigQuerySyncService.js';

const router = Router();

// GET /api/v3/sync/status — check sync status for all sources
router.get('/status', async (_req, res) => {
  try {
    const status = await BigQuerySyncService.getSyncStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/sync/trigger — manually trigger GA4 sync
router.post('/trigger', async (_req, res) => {
  try {
    const results = await BigQuerySyncService.syncAll();
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/sync/profiles — rebuild user profiles only
router.post('/profiles', async (_req, res) => {
  try {
    const count = await BigQuerySyncService.rebuildUserProfiles();
    const linked = await BigQuerySyncService.linkToCustomers();
    res.json({ success: true, profiles_rebuilt: count, ...linked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
