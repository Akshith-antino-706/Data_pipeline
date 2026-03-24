import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import https from 'https';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import pool from './src/config/database.js';
import analyticsRouter from './src/routes/analytics.js';
import segmentsRouter from './src/routes/segments.js';
import strategiesRouter from './src/routes/strategies.js';
import contentRouter from './src/routes/content.js';
import campaignsRouter from './src/routes/campaigns.js';
import enrichmentRouter from './src/routes/enrichment.js';
import segmentsV3Router from './src/routes/segmentsV3.js';
import journeysRouter from './src/routes/journeys.js';
import funnelRouter from './src/routes/funnel.js';
import agentsRouter from './src/routes/agents.js';
import rfmRouter from './src/routes/rfm.js';
import utmRouter from './src/routes/utm.js';
import couponsRouter from './src/routes/coupons.js';
import approvalsRouter from './src/routes/approvals.js';
import gtmRouter from './src/routes/gtm.js';
import productsRouter from './src/routes/products.js';
import affinityRouter from './src/routes/productAffinity.js';
import baseTemplatesRouter from './src/routes/baseTemplates.js';
import syncRouter from './src/routes/sync.js';
import mysqlSyncRouter from './src/routes/mysqlSync.js';
import cron from 'node-cron';
import BigQuerySyncService from './src/services/BigQuerySyncService.js';
import MySQLSyncService from './src/services/MySQLSyncService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: true,  // Allow all origins (GTM tags fire from raynatours.com via HTTPS)
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));

// Request logging
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    const ms = Date.now() - start;
    if (!req.path.includes('/health')) {
      console.log(`${req.method} ${req.path} ${_res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// ── Routes ──────────────────────────────────────────────────
// Legacy API (v1 — backward compatible with existing frontend)
app.use('/api', analyticsRouter);

// New API v2 (omnichannel platform)
app.use('/api/v2/segments', segmentsRouter);
app.use('/api/v2/strategies', strategiesRouter);
app.use('/api/v2/content', contentRouter);
app.use('/api/v2/campaigns', campaignsRouter);
app.use('/api/v2/enrichment', enrichmentRouter);

// New API v3 (28-segment engine + journeys + funnel + AI agents)
app.use('/api/v3/segments', segmentsV3Router);
app.use('/api/v3/journeys', journeysRouter);
app.use('/api/v3/funnel', funnelRouter);
app.use('/api/v3/agents', agentsRouter);
app.use('/api/v3/rfm', rfmRouter);
app.use('/api/v3/utm', utmRouter);
app.use('/api/v3/coupons', couponsRouter);
app.use('/api/v3/approvals', approvalsRouter);
app.use('/api/v3/gtm', gtmRouter);
app.use('/api/v3/products', productsRouter);
app.use('/api/v3/affinity', affinityRouter);
app.use('/api/v3/base-templates', baseTemplatesRouter);
app.use('/api/v3/sync', syncRouter);
app.use('/api/v3/mysql-sync', mysqlSyncRouter);

// ── Health check ────────────────────────────────────────────
app.get('/api/health', async (_, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ── DB Migration helper ─────────────────────────────────────
async function runMigrationFile(filename) {
  const sql = await readFile(join(__dirname, `src/migrations/${filename}`), 'utf8');
  await pool.query(sql);
}

app.post('/api/v2/migrate', async (_, res) => {
  try {
    await runMigrationFile('001_omnichannel_schema.sql');
    res.json({ success: true, message: 'Migration completed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v2/migrate-channels', async (_, res) => {
  try {
    await runMigrationFile('002_channels.sql');
    res.json({ success: true, message: 'Channels migration completed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-schema', async (_, res) => {
  try {
    await runMigrationFile('003_complete_data_schema.sql');
    res.json({ success: true, message: 'Complete data schema migration (003) succeeded' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-segments', async (_, res) => {
  try {
    await runMigrationFile('012_lifecycle_winback_segmentation.sql');
    res.json({ success: true, message: 'Lifecycle segmentation rebuild (012) succeeded' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-rfm', async (_, res) => {
  try {
    await runMigrationFile('010_rfm_utm_coupons_approval.sql');
    res.json({ success: true, message: 'RFM/UTM/Coupons/Approvals migration (010) succeeded' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-all', async (_, res) => {
  try {
    for (const file of ['003_complete_data_schema.sql', '010_rfm_utm_coupons_approval.sql', '012_lifecycle_winback_segmentation.sql', '014_product_affinity_engine.sql', '015_sync_metadata.sql', '016_mysql_sync_tables.sql', '017_full_segment_content_journeys_campaigns.sql']) {
      await runMigrationFile(file);
    }
    res.json({ success: true, message: 'All v3 migrations (003, 010, 012) completed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-sync', async (_, res) => {
  try {
    await runMigrationFile('015_sync_metadata.sql');
    res.json({ success: true, message: 'Sync metadata migration (015) succeeded' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-mysql', async (_, res) => {
  try {
    await runMigrationFile('016_mysql_sync_tables.sql');
    res.json({ success: true, message: 'MySQL sync tables migration (016) succeeded' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Test Email Endpoint ─────────────────────────────────────
app.post('/api/v2/email/test', async (req, res) => {
  try {
    const { EmailChannel } = await import('./src/services/channels/EmailChannel.js');
    const { to, subject, html } = req.body;
    const recipient = to || process.env.SMTP_USER;
    const result = await EmailChannel.send({
      to: recipient,
      subject: subject || 'Rayna Tours — SMTP Test Email',
      html: html || `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:32px;border-radius:12px;text-align:center">
          <h1 style="margin:0">Rayna Tours</h1>
          <p style="margin:8px 0 0;opacity:0.9">Omnichannel Marketing Platform</p>
        </div>
        <div style="padding:24px 0">
          <h2>SMTP Configuration Successful!</h2>
          <p>This is a test email from your Rayna Tours marketing platform.</p>
          <p>Your SMTP connection is working correctly via <b>${process.env.SMTP_HOST}:${process.env.SMTP_PORT}</b></p>
          <p style="color:#888;font-size:12px">Sent at ${new Date().toISOString()}</p>
        </div>
      </div>`,
    });
    res.json({ success: result.success, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Error handler ───────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Error:', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Graceful shutdown ───────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  pool.end().then(() => {
    console.log('Database pool closed.');
    process.exit(0);
  }).catch(() => process.exit(1));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── GA4 BigQuery Sync Cron (every 30 seconds) ──────────────
if (process.env.BQ_SYNC_ENABLED === 'true') {
  const schedule = process.env.BQ_SYNC_CRON || '*/30 * * * * *';
  let syncing = false;
  cron.schedule(schedule, async () => {
    if (syncing) return; // skip if previous sync still running
    syncing = true;
    console.log('[GA4 Sync] Scheduled sync starting...');
    try {
      const results = await BigQuerySyncService.syncAll();
      console.log('[GA4 Sync] Completed:', JSON.stringify(results));
    } catch (err) {
      console.error('[GA4 Sync] Failed:', err.message);
    }
    syncing = false;
  }, { scheduled: true });
  console.log(`[GA4 Sync] Cron scheduled: ${schedule} (every 30 seconds)`);
}

// ── MySQL Sync Cron (every 30 minutes) ──────────────────
if (process.env.MYSQL_SYNC_ENABLED === 'true') {
  const schedule = process.env.MYSQL_SYNC_CRON || '*/30 * * * *';
  cron.schedule(schedule, async () => {
    console.log('[MySQL Sync] Scheduled sync starting...');
    try {
      const results = await MySQLSyncService.syncAll();
      console.log('[MySQL Sync] Scheduled sync completed:', JSON.stringify(results));
    } catch (err) {
      console.error('[MySQL Sync] Scheduled sync failed:', err.message);
    }
  });
  console.log(`[MySQL Sync] Cron scheduled: ${schedule}`);
}

// ── Start (HTTP + HTTPS) ─────────────────────────────────────
const HTTPS_PORT = 3443;

app.listen(PORT, () => {
  console.log(`  HTTP  → http://localhost:${PORT}`);
});

// HTTPS server for GTM events (avoids mixed-content blocking)
try {
  const sslKey = await readFile(join(__dirname, 'key.pem'));
  const sslCert = await readFile(join(__dirname, 'cert.pem'));
  https.createServer({ key: sslKey, cert: sslCert }, app).listen(HTTPS_PORT, () => {
    console.log(`  HTTPS → https://localhost:${HTTPS_PORT}`);
    console.log(`
╔══════════════════════════════════════════════════╗
║  Rayna Tours — Omnichannel Marketing Platform    ║
║                                                  ║
║  HTTP:   http://localhost:${PORT}                   ║
║  HTTPS:  https://localhost:${HTTPS_PORT}                  ║
║                                                  ║
║  GTM Tag URL → https://localhost:${HTTPS_PORT}            ║
║                                                  ║
║  Legacy API:  /api/*                             ║
║  Platform v2: /api/v2/segments|strategies|...    ║
║  Engine v3:   /api/v3/segments (28 segments)     ║
║               /api/v3/journeys (flow builder)    ║
║               /api/v3/funnel  (conversions)      ║
║               /api/v3/agents  (AI decision)      ║
║               /api/v3/rfm    (RFM analysis)      ║
║               /api/v3/utm    (UTM tracking)      ║
║               /api/v3/coupons (coupon system)    ║
║               /api/v3/approvals (human review)   ║
║               /api/v3/gtm    (GTM + BigQuery)    ║
║               /api/v3/base-templates (5 email)   ║
║               /api/v3/sync  (BQ pipeline)        ║
║               /api/v3/mysql-sync (MySQL pull)    ║
║  Health:      /api/health                        ║
║  Migrate v3:  POST /api/v3/migrate-all           ║
╚══════════════════════════════════════════════════╝
    `);
  });
} catch (e) {
  console.log('  HTTPS not available (no SSL certs found)');
}
