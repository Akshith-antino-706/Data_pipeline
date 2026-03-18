import { Router } from 'express';
import MySQLSyncService from '../services/MySQLSyncService.js';

const router = Router();

// GET /api/v3/mysql-sync/status — check sync status for all MySQL tables
router.get('/status', async (_req, res) => {
  try {
    const status = await MySQLSyncService.getSyncStatus();
    res.json({ success: true, tables: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/mysql-sync/discover-schema — inspect remote MySQL table schemas
router.get('/discover-schema', async (_req, res) => {
  try {
    const schemas = await MySQLSyncService.discoverSchema();
    res.json({ success: true, schemas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/mysql-sync/trigger — manually trigger a full sync (all tables)
router.post('/trigger', async (_req, res) => {
  try {
    const results = await MySQLSyncService.syncAll();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/mysql-sync/trigger/:table — sync a single table
router.post('/trigger/:table', async (req, res) => {
  try {
    const result = await MySQLSyncService.pullTable(req.params.table);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
