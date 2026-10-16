// Manual trigger for ChatsSyncService.sync() — same logic the nightly cron uses.
// Usage:  node scripts/sync-chats-incremental.mjs

import 'dotenv/config';
import ChatsSyncService from '../src/services/ChatsSyncService.js';
import pool from '../src/config/database.js';
import { getMySQLPool } from '../src/config/mysql.js';

try {
  const result = await ChatsSyncService.sync();
  console.log('\nResult:', {
    inserted: result.inserted,
    unifiedMatched: result.unifiedMatched,
    elapsed: `${(result.elapsedMs / 1000).toFixed(1)}s`,
  });
} catch (err) {
  console.error('FAILED:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
  await getMySQLPool('chats').end();
}
