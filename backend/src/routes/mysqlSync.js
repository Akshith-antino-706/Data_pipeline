import { Router } from 'express';
import MySQLSyncService from '../services/MySQLSyncService.js';

const router = Router();

// GET /api/v3/mysql-sync/status — check sync status for all MySQL tables
router.get('/status', async (_req, res) => {
  try {
    const status = await MySQLSyncService.getSyncStatus();
    res.json({ success: true, tables: status });
  } catch (err) {
    console.error('[mysql-sync] status error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch sync status' });
  }
});

// GET /api/v3/mysql-sync/discover-schema — inspect remote MySQL table schemas
router.get('/discover-schema', async (_req, res) => {
  try {
    const schemas = await MySQLSyncService.discoverSchema();
    res.json({ success: true, schemas });
  } catch (err) {
    console.error('[mysql-sync] schema error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to discover schema' });
  }
});

// POST /api/v3/mysql-sync/trigger — manually trigger a full sync (all tables)
router.post('/trigger', async (_req, res) => {
  try {
    const results = await MySQLSyncService.syncAll();
    res.json({ success: true, results });
  } catch (err) {
    console.error('[mysql-sync] sync error:', err.message);
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

// POST /api/v3/mysql-sync/trigger/:table — sync a single table (?full=true to force full re-sync)
const ALLOWED_TABLES = ['contacts', 'tickets', 'chats', 'travel_data', 'departments', 'department_emails'];
router.post('/trigger/:table', async (req, res) => {
  try {
    const table = req.params.table;
    if (!ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ success: false, error: `Invalid table. Allowed: ${ALLOWED_TABLES.join(', ')}` });
    }
    const forceFullSync = req.query.full === 'true';
    const result = await MySQLSyncService.pullTable(table, { forceFullSync });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Sync failed' });
  }
});

export default router;
