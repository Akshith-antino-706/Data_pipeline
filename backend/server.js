import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import https from 'https';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// import { spawn } from 'child_process'; // disabled — no cron jobs
import pool from './src/config/database.js';
import analyticsRouter from './src/routes/analytics.js';
import segmentsRouter from './src/routes/segments.js';
import strategiesRouter from './src/routes/strategies.js';
import contentRouter from './src/routes/content.js';
import campaignsRouter from './src/routes/campaigns.js';
import enrichmentRouter from './src/routes/enrichment.js';
import segmentsV3Router from './src/routes/segmentsV3.js';
import journeysRouter from './src/routes/journeys.js';
import unsubscribeRouter from './src/routes/unsubscribe.js';
import agentsRouter from './src/routes/agents.js';
import utmRouter from './src/routes/utm.js';
import gtmRouter from './src/routes/gtm.js';
import productsRouter from './src/routes/products.js';
import affinityRouter from './src/routes/productAffinity.js';
import baseTemplatesRouter from './src/routes/baseTemplates.js';
import recommendationsRouter from './src/routes/recommendations.js';
import syncRouter from './src/routes/sync.js';
import mysqlSyncRouter from './src/routes/mysqlSync.js';
import cron from 'node-cron';
import DailyBillingSync from './src/services/DailyBillingSync.js';
import JourneyService from './src/services/JourneyService.js';
import UnsubscribeSyncService from './src/services/UnsubscribeSyncService.js';
import ContactEnrichmentService from './src/services/ContactEnrichmentService.js';
import ChatsSyncService from './src/services/ChatsSyncService.js';
import UnifiedContactService from './src/services/UnifiedContactService.js';
// import BigQuerySyncService from './src/services/BigQuerySyncService.js'; // disabled
// import MySQLSyncService from './src/services/MySQLSyncService.js'; // disabled
// RaynaSyncService — no longer uses ACICO API; data ingested via POST /api/v3/rayna-sync/ingest
import raynaSyncRouter from './src/routes/raynaSync.js';
import dailyReportRouter from './src/routes/dailyReport.js';
import unifiedContactsRouter from './src/routes/unifiedContacts.js';
import testE2ERouter from './src/routes/testE2E.js';
import gupshupRouter from './src/routes/gupshup.js';
import testSendsRouter from './src/routes/testSends.js';
import authRouter from './src/routes/auth.js';
import customSegmentsRouter from './src/routes/customSegments.js';
import sesWebhookRouter from './src/routes/sesWebhook.js';
import { flushAll as flushCache } from './src/config/cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Trust first hop (devtunnel / reverse proxy) so X-Forwarded-For is honored
// by rate-limit and Express uses the real client IP.
app.set('trust proxy', 1);

// ── Security Middleware ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,  // API server, not serving HTML
}));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://51.20.2.45:5176,http://ec2-51-20-2-45.eu-north-1.compute.amazonaws.com:5176,https://raynatours.com,https://www.raynatours.com,https://raynadata.netlify.app').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server, mobile)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
}));

// Always echo Access-Control-Allow-Credentials: true on every response — required for
// browsers that attach devtunnel session cookies regardless of fetch credentials mode.
app.use((req, res, next) => {
  if (req.headers.origin && ALLOWED_ORIGINS.includes(req.headers.origin)) {
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  next();
});

// ── SES Webhook (before rate limiter — SNS sends many events) ──
app.use('/api/webhooks', express.text({ type: 'text/plain' }), sesWebhookRouter);

// ── Public unsubscribe page — under /api so the prod reverse-proxy routes it to the
// backend (the frontend owns all non-/api paths). No auth, no rate limiter. ──
app.use('/api/unsubscribe', express.urlencoded({ extended: true }), unsubscribeRouter);

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
// Auth
app.use('/api/auth', authRouter);

// Legacy API (v1 — backward compatible with existing frontend)
app.use('/api', analyticsRouter);

// New API v2 (omnichannel platform)
app.use('/api/v2/segments', segmentsRouter);
app.use('/api/v2/strategies', strategiesRouter);
app.use('/api/v2/content', contentRouter);
app.use('/api/v2/recommendations', recommendationsRouter);
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
app.use('/api/v3/test', testE2ERouter);
app.use('/api/v3/gupshup', gupshupRouter);
app.use('/api/v3/test-sends', testSendsRouter);
app.use('/api/v3/custom-segments', customSegmentsRouter);

// ── Health check ────────────────────────────────────────────
app.get('/api/health', async (_, res) => {
  const start = Date.now();
  const checks = {};

  // ── PostgreSQL ──
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    checks.postgres = { status: 'ok', latencyMs: Date.now() - t0 };
  } catch (err) {
    checks.postgres = { status: 'error', error: err.message };
  }

  // ── Redis + BullMQ queues ──
  try {
    const { queueCounts, getConnection } = await import('./src/services/queue/index.js');
    const t0 = Date.now();
    await getConnection().ping();
    const redisPingMs = Date.now() - t0;

    const [emailQ, waQ, smsQ] = await Promise.all([
      queueCounts('email').catch(() => null),
      queueCounts('whatsapp').catch(() => null),
      queueCounts('sms').catch(() => null),
    ]);

    checks.redis = { status: 'ok', latencyMs: redisPingMs };
    checks.bullmq = {
      status: 'ok',
      queues: {
        email:    emailQ,
        whatsapp: waQ,
        sms:      smsQ,
      },
    };
  } catch (err) {
    checks.redis  = { status: 'error', error: err.message };
    checks.bullmq = { status: 'error', error: err.message };
  }

  // ── Email API (Chathead / AWS) ──
  try {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('http://95.211.169.194/apis/aws/send/index.php', {
      method: 'HEAD',
      signal: ctrl.signal,
    }).catch(() => null);
    clearTimeout(timer);
    checks.emailApi = {
      status: r ? 'ok' : 'unreachable',
      httpStatus: r?.status || null,
      latencyMs: Date.now() - t0,
    };
  } catch {
    checks.emailApi = { status: 'unreachable' };
  }

  // ── Workers ──
  try {
    const { _workers } = await import('./src/services/queue/workers.js');
    const w = _workers;
    checks.workers = {
      status: w ? 'running' : 'stopped',
      email:    w?.email  ? 'running' : 'stopped',
      whatsapp: w?.wa     ? 'running' : 'stopped',
      sms:      w?.sms    ? 'running' : 'stopped',
    };
  } catch {
    checks.workers = { status: 'unknown' };
  }

  // ── Journey engine ──
  try {
    const { rows: [r] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')    AS active_journeys,
        COUNT(*) FILTER (WHERE status = 'paused')    AS paused_journeys,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_journeys
      FROM journey_flows
    `);
    const { rows: [e] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')    AS active_entries,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_entries,
        COUNT(*) FILTER (WHERE status = 'converted') AS converted_entries
      FROM journey_entries
    `);
    checks.journeyEngine = {
      status: 'ok',
      journeys: { active: +r.active_journeys, paused: +r.paused_journeys, completed: +r.completed_journeys },
      entries:  { active: +e.active_entries, completed: +e.completed_entries, converted: +e.converted_entries },
    };
  } catch (err) {
    checks.journeyEngine = { status: 'error', error: err.message };
  }

  const httpStatus = checks.postgres?.status === 'ok' ? 200 : 503;

  res.status(httpStatus).json({
    status: httpStatus === 200 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    totalMs: Date.now() - start,
    checks,
  });
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

app.post('/api/v3/migrate-snapshot', async (_, res) => {
  try {
    await runMigrationFile('077_segmentation_tree_snapshot.sql');
    res.json({ success: true, message: 'Segmentation tree snapshot table created (077). POST /api/v3/snapshot/refresh to populate it.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manually trigger the segmentation tree snapshot refresh (all 3 variants)
app.post('/api/v3/snapshot/refresh', async (_, res) => {
  try {
    const result = await UnifiedContactService.refreshSegmentationSnapshot();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-journey', async (_, res) => {
  try {
    await runMigrationFile('071_journey_snapshot.sql');
    await runMigrationFile('072_journey_test_mode.sql');
    await runMigrationFile('073_fix_journey_entries_fk.sql');
    await runMigrationFile('074_journey_entries_columns.sql');
    await runMigrationFile('075_unsubscribe_log.sql');
    await runMigrationFile('076_email_send_log_journey.sql');
    await runMigrationFile('081_journey_node_rankings.sql');
    await runMigrationFile('082_journey_node_statuses.sql');
    await runMigrationFile('083_journey_node_emails.sql');
    await runMigrationFile('084_daily_ai_templates.sql');
    await runMigrationFile('085_email_qa_reports.sql');
    await runMigrationFile('086_journey_node_synced.sql');
    await runMigrationFile('087_journey_type.sql');
    await runMigrationFile('088_journey_trigger_event.sql');
    res.json({ success: true, message: 'Journey migrations (071-088) completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v3/migrate-all', async (_, res) => {
  try {
    for (const file of [
      '003_complete_data_schema.sql',
      '010_rfm_utm_coupons_approval.sql',
      '012_lifecycle_winback_segmentation.sql',
      '014_product_affinity_engine.sql',
      '015_sync_metadata.sql',
      '017_full_segment_content_journeys_campaigns.sql',
      '021_fresh_mysql_tables.sql',
      '032_user_utm_links.sql',
      '034_fresh_strategies_journeys.sql',
      '036_fresh_campaigns_utm.sql',
      '045_journey_audience.sql',
      '046_journey_entry_track.sql',
      '047_missing_infrastructure.sql',
      '048_dept_contact_type.sql',
      '049_users_from_rayna.sql',
      '050_crm_booking_columns.sql',
      '051_hotels_unified_id.sql',
      '052_visas_flights_unified_id.sql',
      '053_auth_users.sql',
      '058_wire_journeys_to_segments.sql',
      '062_create_user_segment_revenue.sql',
      '063_email_send_tracking.sql',
      '064_utm_visits.sql',
      '065_gtm_events_unified_id.sql',
      '067_custom_segments.sql',
      '068_custom_segments_status.sql',
      '069_journey_next_fire.sql',
      '070_journey_exit_on_conversion.sql',
      '071_journey_snapshot.sql',
      '072_journey_test_mode.sql',
    ]) {
      await runMigrationFile(file);
    }
    res.json({ success: true, message: 'All v3 migrations completed successfully' });
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

// migrate-rayna-sync removed — old ACICO API tables replaced with new billing schema

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

// Open-tracking pixel for email_send_log (test-send routes)
app.get('/api/track/email-send/open/:id', async (req, res) => {
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache' });
  res.send(pixel);
  const id = parseInt(req.params.id);
  if (!isNaN(id)) {
    try {
      const { SendTrackService } = await import('./src/services/SendTrackService.js');
      await SendTrackService.markOpened(id);
    } catch (e) { console.error('[Track] email-send open error:', e.message); }
  }
});

// Click-tracking redirect for test-send emails
// Every link in the email points here first, then redirects to the real URL with UTM params.
app.get('/api/track/email-send/click/:id', async (req, res) => {
  let destination = req.query.url;
  if (!destination) return res.status(400).send('Missing url');

  // Gmail double-encodes the url param through its safety redirect wrapper.
  try {
    if (destination.includes('%3A%2F%2F') || destination.includes('%253A')) {
      destination = decodeURIComponent(destination);
    }
  } catch { /* keep original if decode fails */ }

  // Unsubscribe links go to our CONFIRMATION page (prefetch-safe — the actual opt-out
  // happens on the confirmation POST, not on this GET). All other links redirect normally.
  let redirectTo = destination;
  try {
    const d = new URL(destination);
    if (d.pathname.includes('unsubscribe') || d.searchParams.has('unsubscribe')) {
      const base = process.env.TRACKING_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      redirectTo = `${base}/api/unsubscribe?log=${req.params.id}`;
    }
  } catch { /* keep destination if URL invalid */ }

  // Redirect first — don't keep the recipient waiting
  res.redirect(302, redirectTo);

  const id = parseInt(req.params.id);
  if (!isNaN(id)) {
    try {
      const { SendTrackService } = await import('./src/services/SendTrackService.js');

      // Extract UTM params from the destination URL
      let utmData = {};
      try {
        const destUrl = new URL(destination);
        utmData = {
          utmSource:   destUrl.searchParams.get('utm_source'),
          utmMedium:   destUrl.searchParams.get('utm_medium'),
          utmCampaign: destUrl.searchParams.get('utm_campaign'),
          utmContent:  destUrl.searchParams.get('utm_content'),
          utmTerm:     destUrl.searchParams.get('utm_term'),
          rid:         destUrl.searchParams.get('rid'),
        };
      } catch { /* skip if URL invalid */ }

      // Fetch email/unified_id + journey context from the log row
      const db = await import('./src/config/database.js').then(m => m.default);
      const logRows = await db.query(
        'SELECT unified_id, email, journey_id, node_id FROM email_send_log WHERE id = $1', [id]
      ).then(r => r.rows[0] || {});

      const tasks = [
        SendTrackService.markClicked(id),
        SendTrackService.logUtmVisit({
          logId: id,
          unifiedId: logRows.unified_id,
          email: logRows.email,
          destinationUrl: destination,
          ...utmData,
        }),
      ];

      // NOTE: unsubscribe is NO LONGER performed here. Clicking an unsubscribe link now
      // redirects (above) to the /unsubscribe confirmation page, and the opt-out happens
      // only when the recipient confirms (POST). This prevents mailbox/scanner link
      // prefetch from falsely unsubscribing people.

      await Promise.all(tasks);
    } catch (e) { console.error('[Track] email-send click error:', e.message); }
  }
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
  const safeMsg = err.message || 'Internal server error';
  res.status(status).json({ success: false, error: safeMsg });
});

// ── Graceful shutdown ───────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  // Flush any buffered email_send_log rows before the pool closes (no-op unless
  // JOURNEY_LOG_BATCH is enabled).
  import('./src/services/SendTrackService.js')
    .then(({ SendTrackService }) => SendTrackService.flushLogs())
    .catch(() => {})
    .finally(() => {
      pool.end().then(() => {
        console.log('Database pool closed.');
        process.exit(0);
      }).catch(() => process.exit(1));
    });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── All cron jobs DISABLED ──────────────────────────────────
// To re-enable, uncomment the relevant sections below.

// [DISABLED] GA4 BigQuery Sync
// [DISABLED] MySQL Sync (incremental_sync.py)
// [DISABLED] Server Pull (MySQL contacts + chats)
// [DISABLED] Unified Contacts Sync + Segmentation
// [DISABLED] Cache Refresh (users table)
// [DISABLED] Popularity Prewarm (journey engine)
// [DISABLED] Journey Engine (process active journeys)
// [DISABLED] Product Affinity refresh
// [DISABLED] Test Auto-Send (day 1-7 emails)

// import UnifiedContactSync from './src/services/UnifiedContactSync.js'; // disabled
// import ConversionDetector from './src/services/ConversionDetector.js'; // disabled
// import ProductAffinityService from './src/services/ProductAffinityService.js'; // disabled

// ── Daily Billing Sync — 1 AM Dubai time (UTC+4) ────────────
// Retries up to 3 times with 10-minute gaps if any step fails.
// After all retries exhausted, logs the error and waits for next day.
const MAX_SYNC_RETRIES = 3;
const RETRY_DELAY_MS   = 10 * 60 * 1000; // 10 minutes

async function runDailySyncWithRetry() {
  for (let attempt = 1; attempt <= MAX_SYNC_RETRIES; attempt++) {
    try {
      console.log(`[Cron] Daily billing sync attempt ${attempt}/${MAX_SYNC_RETRIES}...`);
      const result = await DailyBillingSync.run();
      console.log(`[Cron] Daily billing sync succeeded (attempt ${attempt}):`, JSON.stringify(result));
      return; // success — stop retrying
    } catch (err) {
      console.error(`[Cron] Daily billing sync attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_SYNC_RETRIES) {
        console.log(`[Cron] Retrying in ${RETRY_DELAY_MS / 60000} minutes...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.error('[Cron] All 3 retry attempts exhausted. Will try again tomorrow at 1 AM.');
      }
    }
  }
}

cron.schedule('0 1 * * *', () => { runDailySyncWithRetry(); }, { timezone: 'Asia/Dubai' });
console.log('[Cron] Daily billing sync scheduled at 1:00 AM Dubai time (3 retries, 10min gap)');

// ── Segmentation tree snapshot — 2 AM Dubai time ─────────────────────────────
// Runs after daily billing sync so revenue figures are fresh.
// Sequential (B2C → B2B → All) to avoid DB pool saturation.
async function runSnapshotRefresh() {
  try {
    console.log('[Cron:Snapshot] Starting nightly segmentation tree refresh...');
    await UnifiedContactService.refreshSegmentationSnapshot();
  } catch (err) {
    console.error('[Cron:Snapshot] Refresh failed:', err.message);
  }
}

cron.schedule('0 2 * * *', runSnapshotRefresh, { timezone: 'Asia/Dubai' });
console.log('[Cron] Segmentation tree snapshot scheduled at 2:00 AM Dubai time');

// ── Daily AI templates — render all 7 Day templates via Claude once/day at 3 AM Dubai ──
// Runs before the journey engine fires (every 5 min) so journeys snapshot from a fresh master.
cron.schedule('0 3 * * *', async () => {
  try {
    const { generateDailyAITemplates } = await import('./src/services/JourneyService.js');
    const results = await generateDailyAITemplates();
    console.log('[Cron:DailyAI] Generated daily templates:', JSON.stringify(results));
  } catch (err) {
    console.error('[Cron:DailyAI] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Daily AI templates scheduled at 3:00 AM Dubai time (7 Claude calls)');

// ── Unsubscribe Sync — MySQL → RDS daily at 2 AM Dubai ──────────────
cron.schedule('0 2 * * *', async () => {
  try {
    const result = await UnsubscribeSyncService.sync();
    console.log(`[Cron:UnsubscribeSync] Done — Yes: ${result.setYes}, No: ${result.setNo}`);
  } catch (err) {
    console.error('[Cron:UnsubscribeSync] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Unsubscribe sync scheduled at 2:00 AM Dubai time');

// ── Contact Enrichment — validate emails + format mobiles daily at 1:30 AM Dubai ──
cron.schedule('30 1 * * *', async () => {
  try {
    const result = await ContactEnrichmentService.enrichNew();
    console.log(`[Cron:Enrichment] Done — emails fixed: ${result.emailsFixed}, invalid: ${result.emailsMarkedInvalid}, mobiles formatted: ${result.mobilesFormatted}`);
  } catch (err) {
    console.error('[Cron:Enrichment] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Contact enrichment scheduled at 1:30 AM Dubai time (new contacts only)');

// ── Chats Sync — MySQL → RDS insert-only at 3:30 AM Dubai, plus unified_id backfill ──
cron.schedule('30 3 * * *', async () => {
  try {
    const result = await ChatsSyncService.sync();
    console.log(`[Cron:ChatsSync] Done — inserted: ${result.inserted}, unified_id matched: ${result.unifiedMatched}, elapsed: ${(result.elapsedMs / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('[Cron:ChatsSync] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Chats sync scheduled at 3:30 AM Dubai time');

// ── Daily journey re-snapshot — 2:30 AM Dubai ──
// Fixed journeys with recommendation_type IN ('on_trip','future_trip') target
// a ROLLING segment (travel_date window). Users become eligible daily as their
// travel_date rolls in. This cron re-enrolls newly-eligible users into their
// matching rec journeys. Runs after the 2:00 AM segment refresh so
// booking_status is fresh. Additive — only touches journey_entries via ON
// CONFLICT DO NOTHING, no impact on existing snapshot-once fixed journeys.
cron.schedule('30 2 * * *', async () => {
  try {
    const { runDailyJourneyReSnapshot } = await import('./src/crons/dailyJourneyReSnapshot.js');
    await runDailyJourneyReSnapshot();
  } catch (err) {
    console.error('[Cron:JourneyReSnapshot] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Daily journey re-snapshot scheduled at 2:30 AM Dubai time');

// ── Daily category picks — 3:45 AM Dubai ──
// Computes top-5 products per journey-level category (activities / holidays /
// cruises) via Claude. Feeds past-trip AI recs (see dailyPastTripCompute).
// 3 Claude calls per run. Runs AFTER the 3:35 AM on_trip/future_trip compute.
cron.schedule('45 3 * * *', async () => {
  try {
    const { runDailyCategoryPicksCompute } = await import('./src/crons/dailyCategoryPicksCompute.js');
    await runDailyCategoryPicksCompute();
  } catch (err) {
    console.error('[Cron:CategoryPicks] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Daily category picks compute scheduled at 3:45 AM Dubai time');

// ── Daily past-trip user compute — 4:00 AM Dubai ──
// For every PAST_BOOKING user, aggregate their bookings by products.category,
// map to journey-level category (activities/holidays/cruises), then attach the
// daily_category_picks top-5. Pure SQL — no per-user Claude call.
// ~626k users processed in ~15-20 min. Runs AFTER category picks (3:45 AM).
cron.schedule('0 4 * * *', async () => {
  try {
    const { runDailyPastTripCompute } = await import('./src/crons/dailyPastTripCompute.js');
    await runDailyPastTripCompute();
  } catch (err) {
    console.error('[Cron:PastTrip] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Daily past-trip user compute scheduled at 4:00 AM Dubai time');

// ── Daily AI recommendation compute — 3:35 AM Dubai ──
// Precomputes 5 AI-picked products per (user, recommendation_type) for on_trip
// / future_trip / past_trip. Feeds the REC_ONTRIP-style journeys with per-user
// personalized picks read at send time. Only touches user_product_recommendations
// (new table) — no impact on existing journey/segment/render logic.
cron.schedule('35 3 * * *', async () => {
  try {
    const { runDailyRecommendationCompute } = await import('./src/crons/dailyRecommendationCompute.js');
    await runDailyRecommendationCompute();
  } catch (err) {
    console.error('[Cron:RecCompute] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] AI recommendation compute scheduled at 3:35 AM Dubai time');

// ── Weekly enriched products sync — Mondays 5:00 AM Dubai ──
// Pulls all products (tour + holiday + cruise + yacht) from the enriched-feed
// API and upserts into `products`. Writes sync_metadata['products_enriched_sync']
// so the /data-pipeline UI shows last-run info + row count + status.
cron.schedule('0 5 * * 1', async () => {
  try {
    const { default: ProductAffinityService } = await import('./src/services/ProductAffinityService.js');
    const result = await ProductAffinityService.syncProducts();
    console.log(`[Cron:ProductSync] Done — synced=${result.synced} duration=${result.duration}s`);
  } catch (err) {
    console.error('[Cron:ProductSync] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Enriched products sync scheduled: Mondays 05:00 Asia/Dubai');

// ── PhpAdmin weekly sync — pull new MySQL contacts into unified_contacts ──
// Sundays 05:00 Dubai. Incremental (uses sync_metadata.last_synced_at watermark)
// so subsequent runs only scan MySQL rows created since the last successful run.
cron.schedule('0 5 * * 0', async () => {
  try {
    const { runPhpAdminSync } = await import('./src/services/PhpAdminWeeklySync.js');
    const summary = await runPhpAdminSync({ triggeredBy: 'cron' });
    console.log(`[Cron:PhpAdminWeekly] Done — fetched=${summary.mysqlRowsFetched} new=${summary.newlyInserted} status=${summary.status} in ${summary.durationMs}ms`);
  } catch (err) {
    console.error('[Cron:PhpAdminWeekly] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] PhpAdmin weekly sync scheduled: Sundays 05:00 Asia/Dubai');

// ── Journey Engine — process due entries every 5 min ──────────────
cron.schedule('*/5 * * * *', async () => {
  try {
    const result = await JourneyService.processDueEntries();
    if (result.processed > 0) {
      console.log(`[Cron:Journey] Processed ${result.processed} entries: journeys=${result.sent}, converted=${result.converted}`);
    }
  } catch (err) {
    console.error('[Cron:Journey] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Journey engine scheduled: every 5 min (Asia/Dubai)');

// ── CONTINUOUS (gtm) journey engine — every 1 min: fire due per-user state rows ──
cron.schedule('* * * * *', async () => {
  try {
    const { default: ContinuousJourneyService } = await import('./src/services/ContinuousJourneyService.js');
    const r = await ContinuousJourneyService.processDue();
    if (r.enqueued > 0 || r.exited > 0) console.log(`[Cron:Continuous] due=${r.due} enqueued=${r.enqueued} exited=${r.exited}`);
  } catch (err) {
    console.error('[Cron:Continuous] Error:', err.message);
  }
});
console.log('[Cron] Continuous GTM engine scheduled: every 1 min');

// ── Journey auto-start — check every minute for scheduled journeys ──
cron.schedule('* * * * *', async () => {
  try {
    const { rows: due } = await pool.query(`
      SELECT journey_id, name FROM journey_flows
      WHERE status = 'draft'
        AND scheduled_start_at IS NOT NULL
        AND scheduled_start_at <= NOW()
    `);
    for (const j of due) {
      try {
        await JourneyService.startJourney(j.journey_id, { skipScheduleValidation: true });
        console.log(`[Cron:AutoStart] Journey ${j.journey_id} "${j.name}" auto-started`);
      } catch (err) {
        console.error(`[Cron:AutoStart] Journey ${j.journey_id} failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[Cron:AutoStart] Error:', err.message);
  }
}, { timezone: 'Asia/Dubai' });
console.log('[Cron] Journey auto-start scheduled: every 1 min (Asia/Dubai)');

// ── Startup env validation — fail fast in production ──
// Catches missing TRACKING_BASE_URL before workers send emails with localhost
// links (root cause of June 4 incident — broken click tracking for ~500k).
if (process.env.NODE_ENV === 'production') {
  const trackBase = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL;
  if (!trackBase || /localhost|127\.0\.0\.1/.test(trackBase)) {
    console.error(`[Boot] ❌ TRACKING_BASE_URL is missing or localhost in production: "${trackBase || '(unset)'}"`);
    console.error('[Boot] Email tracking links would be broken. Set TRACKING_BASE_URL and force-recreate the container.');
    process.exit(1);
  }
  console.log(`[Boot] ✓ TRACKING_BASE_URL valid: ${trackBase}`);
}

// ── BullMQ workers — always run inline ────────────────
try {
  const { startWorkers } = await import('./src/services/queue/workers.js');
  startWorkers();
  console.log('[Workers] Journey send workers started inline');
} catch (err) {
  console.error(`[Workers] Failed to start: ${err.message}`);
}

// ── Start (HTTP + HTTPS) ─────────────────────────────────────
const HTTPS_PORT = 3443;

app.listen(PORT, async () => {
  console.log(`  HTTP  → http://localhost:${PORT}`);
  await flushCache();

  // Auto-populate snapshot table on first deploy (or after migration).
  // Checks if any variant has computed_at = NULL, then runs a full refresh.
  // Runs in background — does not delay server startup.
  setTimeout(async () => {
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM segmentation_tree_snapshot WHERE computed_at IS NULL LIMIT 1`
      );
      if (rows.length > 0) {
        console.log('[Snapshot] Snapshot table empty — running initial populate...');
        await UnifiedContactService.refreshSegmentationSnapshot();
      } else {
        console.log('[Snapshot] Snapshot table already populated — skipping init populate');
      }
    } catch {
      // Table not yet created (migration not run) — skip silently
    }
  }, 5000); // 5-second delay so server is fully ready before hitting the DB
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
║               /api/v3/rayna-sync (billing data)  ║
║  Health:      /api/health                        ║
║  Migrate v3:  POST /api/v3/migrate-all           ║
╚══════════════════════════════════════════════════╝
    `);
  });
} catch (e) {
  console.log('  HTTPS not available (no SSL certs found)');
}
