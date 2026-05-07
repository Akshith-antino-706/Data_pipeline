import { Router } from 'express';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import MySQLSyncService from '../services/MySQLSyncService.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DEFAULT_PYTHON = process.env.PYTHON_BIN || join(REPO_ROOT, '.venv', 'bin', 'python3');
const SCRIPT_PATH = join(REPO_ROOT, 'incremental_sync.py');

function runPythonSync(args = [], timeoutMs = 480000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(DEFAULT_PYTHON, [SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT, env: process.env,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', code => {
      clearTimeout(killer);
      resolve({
        exitCode: code,
        durationMs: Date.now() - start,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-2000),
      });
    });
    child.on('error', err => {
      clearTimeout(killer);
      resolve({ exitCode: -1, durationMs: Date.now() - start, stdout, stderr: err.message });
    });
  });
}

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

// POST /api/v3/mysql-sync/trigger — run incremental_sync.py for all tables
router.post('/trigger', async (req, res) => {
  const full = req.query.full === 'true';
  const result = await runPythonSync(full ? ['--full'] : []);
  const ok = result.exitCode === 0;
  res.status(ok ? 200 : 500).json({ success: ok, ...result });
});

// POST /api/v3/mysql-sync/trigger/:table — run incremental_sync.py for a single table
// tickets is optional-only. travel was removed 2026-04-22 after one-time historical dump.
const ALLOWED_TABLES = ['contacts', 'chats', 'unsubscribed', 'tickets'];
router.post('/trigger/:table', async (req, res) => {
  const table = req.params.table;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ success: false, error: `Invalid table. Allowed: ${ALLOWED_TABLES.join(', ')}` });
  }
  const full = req.query.full === 'true';
  const result = await runPythonSync(full ? [table, '--full'] : [table]);
  const ok = result.exitCode === 0;
  res.status(ok ? 200 : 500).json({ success: ok, ...result });
});

export default router;
