import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import agentsRouter from './src/routes/agents.js';
import utmRouter from './src/routes/utm.js';
import gtmRouter from './src/routes/gtm.js';
import productsRouter from './src/routes/products.js';
import affinityRouter from './src/routes/productAffinity.js';
import baseTemplatesRouter from './src/routes/baseTemplates.js';
import syncRouter from './src/routes/sync.js';
import mysqlSyncRouter from './src/routes/mysqlSync.js';
import cron from 'node-cron';
import BigQuerySyncService from './src/services/BigQuerySyncService.js';
import MySQLSyncService from './src/services/MySQLSyncService.js';
import RaynaSyncService from './src/services/RaynaSyncService.js';
import raynaSyncRouter from './src/routes/raynaSync.js';
import dailyReportRouter from './src/routes/dailyReport.js';
import unifiedContactsRouter from './src/routes/unifiedContacts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Trust nginx reverse proxy
app.set('trust proxy', 1);

// ── Security Middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,  // API server, not serving HTML
}));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,https://raynatours.com,https://raynadata.netlify.app,https://qh6hjtm8-3001.inc1.devtunnels.ms').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server, mobile)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting — general: 200 req/min, mutations: 30 req/min
const generalLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many requests, slow down' } });
const mutationLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many write requests, slow down' } });
app.use('/api', generalLimiter);
app.use('/api', (req, _res, next) => { if (['POST','PUT','DELETE','PATCH'].includes(req.method)) return mutationLimiter(req, _res, next); next(); });

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

// API v3
app.use('/api/v3/segments', segmentsV3Router);
app.use('/api/v3/journeys', journeysRouter);
app.use('/api/v3/agents', agentsRouter);
app.use('/api/v3/utm', utmRouter);
app.use('/api/v3/gtm', gtmRouter);
app.use('/api/v3/products', productsRouter);
app.use('/api/v3/affinity', affinityRouter);
app.use('/api/v3/base-templates', baseTemplatesRouter);
app.use('/api/v3/sync', syncRouter);
app.use('/api/v3/mysql-sync', mysqlSyncRouter);
app.use('/api/v3/rayna-sync', raynaSyncRouter);
app.use('/api/v3/daily-report', dailyReportRouter);
app.use('/api/v3/unified-contacts', unifiedContactsRouter);

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
  // Phase 1: Core schema (ENUMs, base tables, marketing tables)
  // Phase 2: MySQL sync + renames
  // Phase 3: Rayna API + booking mapping
  // Phase 4: Customer master rebuilds
  // Phase 5: Strategy/journey/campaign rebuilds (supersede 009/017/018)
  // Phase 6: Analytics & unified contacts
  // NOTE: 016 removed (superseded by 021)
  //       013 removed (just updates content_template rows - no DDL)
  //       009 removed (superseded by 034/035 - rebuilds old segment model)
  //       012 removed (superseded by 034/035 - old lifecycle segmentation)
  //       020 removed (sync_call columns - superseded by 021 fresh mysql tables)
  const migrations = [
    '001_omnichannel_schema.sql',
    '002_channels.sql',
    '003_complete_data_schema.sql',
    '010_rfm_utm_coupons_approval.sql',
    '014_product_affinity_engine.sql',
    '015_sync_metadata.sql',
    '019_ga4_bigquery_sync.sql',
    '021_fresh_mysql_tables.sql',
    '022_rename_columns.sql',
    '023_customer_master.sql',
    '024_rayna_api_sync_tables.sql',
    '025_fix_rayna_conflict_keys.sql',
    '026_booking_customer_mapping.sql',
    '027_add_chat_timestamp_columns.sql',
    '028_add_ticket_contact_status.sql',
    '029_fresh_customer_master.sql',
    '030_customer_master_phone_email.sql',
    '031_customer_master_activity_only.sql',
    '033_add_visa_missing_fields.sql',
    '034_fresh_strategies_journeys.sql',
    '035_fresh_content_templates.sql',
    '036_fresh_campaigns_utm.sql',
    '037_link_journey_nodes_to_templates.sql',
    '038_product_affinity.sql',
    '039_segment_daily_log.sql',
    '040_holidays_calendar.sql',
    '041_occasion_strategy_journey.sql',
    '042_b2b_strategies_journeys.sql',
    '043_email_html_templates.sql',
    '044_unified_contacts.sql',
  ];
  const results = [];
  for (const file of migrations) {
    try {
      await runMigrationFile(file);
      results.push({ file, status: 'ok' });
    } catch (err) {
      results.push({ file, status: 'error', error: err.message });
    }
  }
  const failed = results.filter(r => r.status === 'error');
  res.json({ success: failed.length === 0, ran: results.length, failed: failed.length, results });
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
    await runMigrationFile('021_fresh_mysql_tables.sql');
    res.json({ success: true, message: 'Fresh MySQL sync tables migration (021) succeeded — contacts, tickets, chats, departments' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-rename-columns', async (_, res) => {
  try {
    await runMigrationFile('022_rename_columns.sql');
    res.json({ success: true, message: 'Column rename migration (022) succeeded — source_type→department_name, t_to→department_name, wa_id→customer_no, receiver→department_number' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-rayna-sync', async (_, res) => {
  try {
    await runMigrationFile('024_rayna_api_sync_tables.sql');
    await runMigrationFile('025_fix_rayna_conflict_keys.sql');
    res.json({ success: true, message: 'Rayna API sync tables migration (024+025) succeeded — tours, hotels, visas, flights with fixed conflict keys' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-booking-map', async (_, res) => {
  try {
    await runMigrationFile('026_booking_customer_mapping.sql');
    res.json({ success: true, message: 'Booking ↔ Customer mapping migration (026) succeeded — phone + email matching' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-chat-columns', async (_, res) => {
  try {
    await runMigrationFile('027_add_chat_timestamp_columns.sql');
    res.json({ success: true, message: 'Added last_in, last_out, last_msg columns to mysql_chats' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Email Tracking (Open Pixel + Click Redirect) ──────────
// 1x1 pixel for open tracking
app.get('/api/track/open/:messageId', async (req, res) => {
  // Return pixel immediately, track async
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache' });
  res.send(pixel);
  try {
    const { EmailTrackingService } = await import('./src/services/EmailTrackingService.js');
    await EmailTrackingService.trackOpen(req.params.messageId);
  } catch (e) { console.error('[Track] Open error:', e.message); }
});

// Click redirect for link tracking
app.get('/api/track/click/:messageId', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  // Redirect immediately, track async
  res.redirect(url);
  try {
    const { EmailTrackingService } = await import('./src/services/EmailTrackingService.js');
    await EmailTrackingService.trackClick(req.params.messageId, url);
  } catch (e) { console.error('[Track] Click error:', e.message); }
});

// ── First Message Sync ────────────────────────────────────
app.post('/api/v3/sync-first-messages', async (req, res) => {
  try {
    const { default: FirstMessageService } = await import('./src/services/FirstMessageService.js');
    const limit = req.body?.limit;
    if (limit) {
      const result = await FirstMessageService.testRun(limit);
      return res.json({ success: true, ...result });
    }
    // Fire and forget — full sync runs in background
    FirstMessageService.syncAll().then(r => console.log('[FirstMessage] Done:', r));
    res.json({ success: true, message: 'First message sync started in background' });
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
  const status = err.status || 500;
  // Never leak SQL errors, stack traces, or internal paths to clients
  const safeMsg = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ success: false, error: safeMsg });
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

// ── MySQL Sync Cron (every 10 minutes) ──────────────────
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

// ── Rayna API Sync Cron (incremental, every 6 hours) ────────
if (process.env.RAYNA_SYNC_ENABLED === 'true') {
  const schedule = process.env.RAYNA_SYNC_CRON || '0 23 * * *'; // 3 AM Dubai (UTC+4)
  let raynaSyncing = false;
  cron.schedule(schedule, async () => {
    if (raynaSyncing) return;
    raynaSyncing = true;
    console.log('[Rayna Sync] Incremental sync starting (day-by-day)...');
    try {
      const results = await RaynaSyncService.syncAll();
      console.log('[Rayna Sync] Incremental sync completed:', JSON.stringify(results));
    } catch (err) {
      console.error('[Rayna Sync] Incremental sync failed:', err.message);
    }
    raynaSyncing = false;
  });
  console.log(`[Rayna Sync] Incremental cron scheduled: ${schedule}`);

  // Daily catch-up: re-fetch last 30 days at 4 AM Dubai (UTC 00:00) to pick up cancellations/modifications
  cron.schedule('0 0 * * *', async () => {
    console.log('[Rayna Sync] Daily catch-up starting — re-fetching last 30 days for modifications...');
    try {
      const results = await RaynaSyncService.syncCatchUp(30);
      console.log('[Rayna Sync] Daily catch-up completed:', JSON.stringify(results));
    } catch (err) {
      console.error('[Rayna Sync] Daily catch-up failed:', err.message);
    }
  });
  console.log('[Rayna Sync] Daily catch-up cron scheduled: 0 0 * * * (4 AM Dubai daily)');
}

// ── Full Data Pipeline Cron ──────────────────────────────────
// 3:00 AM Dubai — Rayna API sync (already above)
// 3:15 AM Dubai — Pull new data from MySQL servers
// 3:30 AM Dubai — Unified contacts incremental sync + GA4/GTM linking
import UnifiedContactSync from './src/services/UnifiedContactSync.js';

// 3:15 AM — MySQL server pull (contacts + chats)
cron.schedule('15 23 * * *', async () => {
  console.log('[Server Pull] Pulling new data from MySQL servers...');
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const scriptPath = join(__dirname, '..', 'incremental_sync.py');
    const { stdout } = await execFileAsync('python3', [scriptPath, 'contacts', 'chats'], { timeout: 600000 });
    console.log('[Server Pull] Completed:', stdout.slice(-200));
  } catch (err) {
    console.error('[Server Pull] Failed:', err.message);
  }
});
console.log('[Server Pull] Cron scheduled: 15 23 * * * (3:15 AM Dubai daily)');

// 3:30 AM — Unified contacts sync + GA4/GTM linking
cron.schedule('30 23 * * *', async () => {
  console.log('[Unified Sync] Starting incremental sync...');
  try {
    const result = await UnifiedContactSync.run();
    console.log('[Unified Sync] Completed:', JSON.stringify(result));

    // Snapshot daily segment counts after sync
    const { default: UnifiedContactService } = await import('./src/services/UnifiedContactService.js');
    await UnifiedContactService.snapshotDailySegments();
  } catch (err) {
    console.error('[Unified Sync] Failed:', err.message);
  }
});
console.log('[Unified Sync] Cron scheduled: 30 23 * * * (3:30 AM Dubai daily)');

// 4:00 AM — Refresh cached counts on users table
cron.schedule('0 0 * * *', async () => {
  console.log('[Cache Refresh] Updating cached_chats/tickets/bookings on users...');
  try {
    await pool.query(`
      UPDATE users u SET
        cached_chats = COALESCE(ch.cnt, 0),
        cached_tickets = COALESCE(tk.cnt, 0),
        cached_bookings = COALESCE(tb.cnt, 0)
      FROM (SELECT id FROM users) base
      LEFT JOIN (SELECT user_id, COUNT(*)::int as cnt FROM chats GROUP BY user_id) ch ON ch.user_id = base.id
      LEFT JOIN (SELECT user_id, COUNT(*)::int as cnt FROM tickets GROUP BY user_id) tk ON tk.user_id = base.id
      LEFT JOIN (SELECT user_id, COUNT(*)::int as cnt FROM travel_bookings GROUP BY user_id) tb ON tb.user_id = base.id
      WHERE u.id = base.id
    `);
    console.log('[Cache Refresh] Done.');
  } catch (err) {
    console.error('[Cache Refresh] Failed:', err.message);
  }
});
console.log('[Cache Refresh] Cron scheduled: 0 0 * * * (4 AM Dubai daily)');

// 5:00 AM Dubai — Journey processing: advance customers through nodes
import ConversionDetector from './src/services/ConversionDetector.js';
cron.schedule('0 1 * * *', async () => {
  console.log('[Journey Engine] Starting daily journey processing...');
  try {
    // Step 1: Detect conversions (UTM + GTM + bookings)
    const conversions = await ConversionDetector.runAll();
    console.log('[Journey Engine] Conversions:', JSON.stringify(conversions));

    // Step 2: Process all active journeys (advance nodes)
    const { rows: journeys } = await pool.query("SELECT journey_id FROM journey_flows WHERE status = 'active'");
    for (const j of journeys) {
      const result = await (await import('./src/services/JourneyService.js')).default.processJourney(j.journey_id);
      console.log(`[Journey Engine] Journey ${j.journey_id}: ${JSON.stringify(result)}`);
    }
    console.log('[Journey Engine] Done.');
  } catch (err) {
    console.error('[Journey Engine] Failed:', err.message);
  }
});
console.log('[Journey Engine] Cron scheduled: 0 1 * * * (5 AM Dubai daily)');

// 6:00 AM Dubai — Product sync + affinity refresh
import ProductAffinityService from './src/services/ProductAffinityService.js';
cron.schedule('0 2 * * *', async () => {
  console.log('[Product Affinity] Starting product sync + affinity refresh...');
  try {
    const result = await ProductAffinityService.runAll();
    console.log('[Product Affinity] Done:', JSON.stringify(result));
  } catch (err) {
    console.error('[Product Affinity] Failed:', err.message);
  }
});
console.log('[Product Affinity] Cron scheduled: 0 2 * * * (6 AM Dubai daily)');

// ── Auto-migrate critical tables on startup ──────────────────
(async () => {
  try {
    for (const file of ['044_unified_contacts.sql', '039_segment_daily_log.sql']) {
      await runMigrationFile(file);
    }
    console.log('  DB tables verified (unified_contacts, segment_daily_log)');
  } catch (err) {
    console.error('  DB auto-migrate warning:', err.message);
  }
})();

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
║               /api/v3/rayna-sync (API pull)     ║
║  Health:      /api/health                        ║
║  Migrate v3:  POST /api/v3/migrate-all           ║
╚══════════════════════════════════════════════════╝
    `);
  });
} catch (e) {
  console.log('  HTTPS not available (no SSL certs found)');
}
