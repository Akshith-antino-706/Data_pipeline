import { Router } from 'express';
import { CronExpressionParser } from 'cron-parser';
import RaynaSyncService from '../services/RaynaSyncService.js';
import pool, { query } from '../config/database.js';
import UnifiedContactBuilder from '../services/UnifiedContactBuilder.js';
import { parseBusinessType } from '../utils/contactTypes.js';
import DailyBillingSync from '../services/DailyBillingSync.js';
import type { CronJobCard } from '../types/routesRaynaSync.js';
import type { U2SyncMetaRow, U2CountRow, U2LatestRow } from '../types/u2Routes.js';

const router = Router();

// Best-effort next-run computation from a cron expression in Asia/Dubai.
// Returns ISO string or null. Never throws — the UI just hides the field.
function nextRunISO(expr: string): string | null {
  try {
    return CronExpressionParser.parse(expr, { tz: 'Asia/Dubai' }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

// Run contact rebuild after any data ingest
async function postSyncRecompute() {
  await UnifiedContactBuilder.rebuild();
}

// GET /api/v3/rayna-sync/status — table counts + sync metadata
router.get('/status', async (_req, res) => {
  try {
    const status = await RaynaSyncService.getSyncStatus();
    const counts = await RaynaSyncService.getTableCounts();

    // Override the stale rayna_* sync_metadata rows (legacy May 2026 rows carry a
    // dead "billno" schema error) with fresh MAX(created_at) from Postgres.
    // Current DailyBillingSync populates rayna_* directly and doesn't write here.
    const freshDates: Record<string, Date | null> = {};
    try {
      const { rows } = await query<{ t: string; latest: Date | null }>(`
        SELECT 'rayna_tours'    AS t, MAX(created_at) AS latest FROM rayna_tours
        UNION ALL SELECT 'rayna_hotels',   MAX(created_at) FROM rayna_hotels
        UNION ALL SELECT 'rayna_visas',    MAX(created_at) FROM rayna_visas
        UNION ALL SELECT 'rayna_flights',  MAX(created_at) FROM rayna_flights
        UNION ALL SELECT 'rayna_packages', MAX(created_at) FROM rayna_packages
        UNION ALL SELECT 'rayna_others',   MAX(created_at) FROM rayna_others
      `);
      for (const r of rows) freshDates[r.t] = r.latest;
    } catch { /* keep stale values as fallback */ }

    // Aggregate MAX across all rayna_* tables — used as fallback for tables
    // that have 0 rows (e.g. rayna_flights) so we still clear the dead error.
    const aggregateMax = Object.values(freshDates).filter(Boolean)
      .sort((a, b) => (new Date(b!) as unknown as number) - (new Date(a!) as unknown as number))[0] || null;

    const augmented = status.map((row: Record<string, unknown> & { table_name?: string }) => {
      if (!row.table_name?.startsWith('rayna_')) return row;
      const fresh = freshDates[row.table_name] || aggregateMax;
      return {
        ...row,
        last_synced_at: fresh || row.last_synced_at,
        sync_status: 'success',
        error_message: null,
      };
    });

    res.json({ success: true, tables: augmented, counts });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// GET /api/v3/rayna-sync/mapping-stats — data-pipeline page payload.
// Allowed source tables: rayna_tours, rayna_hotels, rayna_visas,
// rayna_flights, rayna_packages, rayna_others, chats, unified_contacts, sync_metadata.
//
// Cost: one scan of unified_contacts, one scan per rayna_* table (count + mapped +
// latest in a single pass), one COUNT on chats, one read of sync_metadata and three
// best-effort MAX() reads from remote MySQL. Results are cached per business type
// (fresh for MAPPING_STATS_TTL_MS, served stale while a refresh runs in the
// background); `?fresh=1` bypasses the cache.
export const MAPPING_STATS_TTL_MS = 60_000;
const MAPPING_STATS_STALE_MS = 10 * 60_000;
const MYSQL_SOURCE_TIMEOUT_MS = 3_000;
const RAYNA_SOURCES = ['tours', 'hotels', 'visas', 'flights', 'packages', 'others'] as const;
type RaynaSource = typeof RAYNA_SOURCES[number];

interface MappingStatsBody {
  success: true;
  overall: { totalMapped: number; customersWithBookings: number; totalCustomers: number; matchRate: string | number };
  coverage: Record<RaynaSource, { total: number; mapped: number; lastDataAt: string | null }>;
  dataOverview: Record<string, number>;
  mysqlStatus: U2SyncMetaRow[];
  cronJobs: CronJobCard[];
  computedAt: string;
}
const mappingStatsCache = new Map<string, { at: number; body: MappingStatsBody }>();
const mappingStatsInflight = new Map<string, Promise<MappingStatsBody>>();
/** Test hook: forget cached payloads. */
export function clearMappingStatsCache(): void { mappingStatsCache.clear(); mappingStatsInflight.clear(); }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
const toInt = (v: unknown): number => { const n = parseInt(String(v ?? '0'), 10); return Number.isFinite(n) ? n : 0; };
const toIso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

async function computeMappingStats(bt: string | undefined): Promise<MappingStatsBody> {
  let UC_FILTER: string, PROFIT_FILTER: string;
  if (bt === 'B2B')      { UC_FILTER = "contact_type = 'B2B'"; PROFIT_FILTER = "is_b2b = '1'"; }
  else if (bt === 'B2C') { UC_FILTER = "contact_type = 'B2C'"; PROFIT_FILTER = "is_b2b = '0'"; }
  // Bookings carry no affiliate flag — count the bookings of Affiliate contacts
  else if (bt === 'Affiliate') {
    UC_FILTER = "contact_type = 'Affiliate'";
    PROFIT_FILTER = "unified_id IN (SELECT id FROM unified_contacts WHERE contact_type = 'Affiliate')";
  }
  else                   { UC_FILTER = "1=1";                    PROFIT_FILTER = "1=1"; }

  // One pass over unified_contacts gives every contact figure the page shows.
  const contactsQ = query<Record<string, string>>(`
    SELECT
      COUNT(*)                                                                                   AS total_all,
      COUNT(*) FILTER (WHERE ${UC_FILTER})                                                       AS total_customers,
      COUNT(*) FILTER (WHERE ${UC_FILTER} AND booking_status NOT IN ('PROSPECT'))                AS customers_with_bookings,
      COUNT(*) FILTER (WHERE ${UC_FILTER} AND email IS NOT NULL AND email <> '')                 AS with_email,
      COUNT(*) FILTER (WHERE ${UC_FILTER} AND mobile IS NOT NULL AND mobile <> '')               AS with_mobile
    FROM unified_contacts
  `);
  // One pass per booking table: how many, how many linked to a contact, when data last landed.
  const sourceQs = RAYNA_SOURCES.map(src => query<Record<string, string | Date | null>>(`
    SELECT
      COUNT(*) FILTER (WHERE ${PROFIT_FILTER})                             AS total,
      COUNT(*) FILTER (WHERE ${PROFIT_FILTER} AND unified_id IS NOT NULL)  AS mapped,
      MAX(created_at)                                                      AS latest
    FROM rayna_${src}
  `));
  const chatsQ = query<U2CountRow>('SELECT COUNT(*) AS count FROM chats');
  const syncMetaQ = query<U2SyncMetaRow>('SELECT * FROM sync_metadata').then(r => r.rows, () => [] as U2SyncMetaRow[]);

  // Latest source timestamps from remote MySQL — "Source updated" on the matching job.
  // Best-effort and time-boxed: a slow or down MySQL must not hold the page.
  const { mysqlQuery } = await import('../config/mysql.js');
  const safeMax = async (sql: string, poolName: string): Promise<string | null> => {
    try {
      const rows = await withTimeout(mysqlQuery<U2LatestRow[]>(sql, [], poolName), MYSQL_SOURCE_TIMEOUT_MS);
      return toIso(rows[0]?.latest);
    } catch (e) {
      console.warn(`[mapping-stats] source-latest fetch skipped (${poolName}):`, (e as Error).message);
      return null;
    }
  };
  const sourceLatestQ = Promise.all([
    safeMax('SELECT MAX(created_at) AS latest FROM contacts',     'primary'),
    safeMax('SELECT MAX(created_at) AS latest FROM unsubscribed', 'chats'),
    safeMax('SELECT MAX(created_at) AS latest FROM chats',        'chats'),
  ]);

  const [contactsR, sourceRs, chatsR, smRows, [phpadminSourceLatestAt, unsubscribeSourceLatestAt, chatsSourceLatestAt]] =
    await Promise.all([contactsQ, Promise.all(sourceQs), chatsQ, syncMetaQ, sourceLatestQ]);

  const contacts = contactsR.rows[0] ?? {};
  const coverage = {} as MappingStatsBody['coverage'];
  let travelBookings = 0;
  let dailyBillingSourceLatestAt: string | null = null;
  RAYNA_SOURCES.forEach((src, i) => {
    const row = sourceRs[i].rows[0] ?? {};
    const total = toInt(row.total), mapped = toInt(row.mapped), lastDataAt = toIso(row.latest);
    coverage[src] = { total, mapped, lastDataAt };
    travelBookings += total;
    if (lastDataAt && (!dailyBillingSourceLatestAt || lastDataAt > dailyBillingSourceLatestAt)) dailyBillingSourceLatestAt = lastDataAt;
  });

  const sm = Object.fromEntries(smRows.map(r => [r.table_name, r]));
  // Chats-related sync rows only (the old "Chats sync" card).
  const mysqlStatus = smRows.filter(r => /chat/i.test(r.table_name)).sort((a, b) => a.table_name.localeCompare(b.table_name));

  // Cron jobs — full enumeration of the schedules registered in backend/server.ts.
  //   meta            → sync_metadata row (if the cron writes there); null otherwise
  //   sourceLatestAt  → MAX(created_at) from source DB (MySQL-sourced crons only)
  //   nextRun         → next fire time in Asia/Dubai (computed via cron-parser)
  // DailyBillingSync doesn't write to sync_metadata; MAX(created_at) across the
  // rayna_* tables is the freshness signal (when data actually last landed).
  const dailyBillingMeta = dailyBillingSourceLatestAt
    ? { last_synced_at: dailyBillingSourceLatestAt, rows_synced: null, sync_status: 'success', error_message: null, sync_duration_ms: null }
    : null;
  // This cron runs all three registration feeds in one pass, while each
  // feed records its own metadata row. Aggregate them for one UI card.
  const registrationMetas = [sm.registration_affiliate_sync, sm.registration_guestuser_sync, sm.registration_agent_sync].filter(Boolean);
  const registrationMeta = registrationMetas.length
    ? {
        last_synced_at: registrationMetas.map(m => toIso(m.last_synced_at)).filter(Boolean).sort().reverse()[0] || null,
        rows_synced: registrationMetas.reduce((sum, m) => sum + (Number(m.rows_synced) || 0), 0),
        sync_status: registrationMetas.some(m => m.sync_status === 'error') ? 'error' : 'success',
        error_message: registrationMetas.map(m => m.error_message).filter(Boolean).join('; ') || null,
        sync_duration_ms: registrationMetas.reduce((sum, m) => sum + (Number(m.sync_duration_ms) || 0), 0),
      }
    : null;
  const cronDefs: Omit<CronJobCard, 'nextRun'>[] = [
    // ── Data-ingest crons ─────────────────────────────
    { name: 'registration_data_sync',    label: 'Registration Data Sync',     category: 'ingest',   schedule: '30 0 * * *',  humanSchedule: 'Daily at 12:30 AM Dubai',       description: 'Syncs the last 7 days of affiliate, guest-user, and agent registrations into the registration tables.', meta: registrationMeta },
    { name: 'daily_billing_sync',        label: 'Daily Billing Sync',         category: 'ingest',   schedule: '0 1 * * *',   humanSchedule: 'Daily at 1:00 AM Dubai',        description: 'Pulls yesterday’s bookings from Rayna Billing API into rayna_* tables.',                       meta: dailyBillingMeta,                                       sourceLatestAt: dailyBillingSourceLatestAt, sourceLabel: 'Rayna Billing API' },
    { name: 'contact_enrichment',        label: 'Contact Enrichment',         category: 'ingest',   schedule: '30 1 * * *',  humanSchedule: 'Daily at 1:30 AM Dubai',        description: 'Validates emails and normalises mobile numbers for newly-added contacts.',                        meta: sm.contact_enrichment || null },
    { name: 'unsubscribe_sync',          label: 'Unsubscribe Sync',           category: 'ingest',   schedule: '0 2 * * *',   humanSchedule: 'Daily at 2:00 AM Dubai',        description: 'Syncs the email unsubscribe list from phpAdmin into unified_contacts.email_unsubscribe.',         meta: sm.unsubscribed || sm.unsubscribe_sync || null,         sourceLatestAt: unsubscribeSourceLatestAt,  sourceLabel: 'phpAdmin' },
    { name: 'wa_unsubscribe_sync',       label: 'WhatsApp Unsub Sync',        category: 'ingest',   schedule: '15 2 * * *',  humanSchedule: 'Daily at 2:15 AM Dubai',        description: 'Syncs WhatsApp unsubscribe events from phpAdmin (MYSQL2) into unified_contacts.wa_unsubscribe.',   meta: sm.wa_unsubscribe_sync || null,                         sourceLatestAt: unsubscribeSourceLatestAt,  sourceLabel: 'phpAdmin' },
    { name: 'chats_sync',                label: 'Chats Sync',                 category: 'ingest',   schedule: '30 3 * * *',  humanSchedule: 'Daily at 3:30 AM Dubai',        description: 'Incremental sync of WhatsApp chat messages from phpAdmin (MYSQL2) into the chats table.',          meta: sm.chats_sync || null,                                  sourceLatestAt: chatsSourceLatestAt,        sourceLabel: 'phpAdmin' },
    { name: 'phpadmin_weekly_sync',      label: 'phpAdmin Contacts Sync',     category: 'ingest',   schedule: '0 5 * * 0',   humanSchedule: 'Weekly on Sunday 5:00 AM Dubai', description: 'Weekly bulk pull of new contacts from the phpAdmin contacts table into unified_contacts.',        meta: sm.phpadmin_weekly_sync || null,                        sourceLatestAt: phpadminSourceLatestAt,     sourceLabel: 'phpAdmin' },
    { name: 'products_enriched_sync',    label: 'Enriched Products Sync',     category: 'ingest',   schedule: '0 5 * * 1',   humanSchedule: 'Weekly on Monday 5:00 AM Dubai', description: 'Weekly refresh of enriched product metadata (categories, tags, images).',                          meta: sm.products_enriched_sync || null },
    // ── Compute / snapshot crons ──────────────────────
    { name: 'snapshot_refresh',          label: 'Segmentation Snapshot',      category: 'compute',  schedule: '0 2 * * *',   humanSchedule: 'Daily at 2:00 AM Dubai',        description: 'Nightly snapshot of the segmentation tree counts used by dashboards.',                            meta: null },
    { name: 'daily_ai_templates',        label: 'Daily AI Templates',         category: 'compute',  schedule: '0 3 * * *',   humanSchedule: 'Daily at 3:00 AM Dubai',        description: 'Generates 7 fresh AI-personalised email templates each day via Claude.',                            meta: sm.daily_ai_templates || null },
    { name: 'journey_resnapshot',        label: 'Journey Re-snapshot',        category: 'compute',  schedule: '30 2 * * *',  humanSchedule: 'Daily at 2:30 AM Dubai',        description: 'Re-computes per-journey enrollment snapshots for the day.',                                        meta: sm.journey_resnapshot || null },
    { name: 'ai_recommendation',         label: 'AI Recommendation Compute',  category: 'compute',  schedule: '35 3 * * *',  humanSchedule: 'Daily at 3:35 AM Dubai',        description: 'Computes per-user AI product recommendations feeding into content templates.',                    meta: sm.ai_recommendation || null },
    { name: 'category_picks',            label: 'Category Picks Compute',     category: 'compute',  schedule: '45 3 * * *',  humanSchedule: 'Daily at 3:45 AM Dubai',        description: 'Computes personalised category picks per user (top tour categories).',                             meta: sm.category_picks || null },
    { name: 'past_trip_users',           label: 'Past-trip User Compute',     category: 'compute',  schedule: '0 4 * * *',   humanSchedule: 'Daily at 4:00 AM Dubai',        description: 'Identifies users returning from a past trip so re-engagement journeys can target them.',           meta: sm.past_trip_users || null },
    { name: 'per_user_reenroll',         label: 'Per-user Re-enrollment',     category: 'compute',  schedule: '0 4 * * *',   humanSchedule: 'Daily at 4:00 AM Dubai',        description: 'Re-evaluates users for journey re-enrollment based on updated segments.',                          meta: sm.per_user_reenroll || null },
    // ── High-frequency engines ───────────────────────
    { name: 'journey_engine',            label: 'Journey Engine',             category: 'engine',   schedule: '*/5 * * * *', humanSchedule: 'Every 5 minutes',               description: 'Advances every active journey enrollment through its node graph.',                                 meta: null },
    { name: 'gtm_engine',                label: 'Continuous GTM Engine',      category: 'engine',   schedule: '* * * * *',   humanSchedule: 'Every 1 minute',                description: 'Continuously processes GTM / BigQuery events for real-time journey enrollment.',                    meta: null },
    { name: 'journey_autostart',         label: 'Journey Auto-start',         category: 'engine',   schedule: '* * * * *',   humanSchedule: 'Every 1 minute',                description: 'Auto-starts journeys whose scheduled_start_at time has passed.',                                    meta: null },
  ];
  const cronJobs: CronJobCard[] = cronDefs.map(j => ({ ...j, nextRun: nextRunISO(j.schedule) }));

  const totalCustomers = toInt(contacts.total_customers);
  const customersWithBookings = toInt(contacts.customers_with_bookings);
  return {
    success: true,
    overall: {
      totalMapped: customersWithBookings,
      customersWithBookings,
      totalCustomers,
      matchRate: totalCustomers > 0 ? ((customersWithBookings / totalCustomers) * 100).toFixed(2) : 0,
    },
    coverage,
    dataOverview: {
      users: totalCustomers,
      unifiedContacts: totalCustomers,
      totalUsers: toInt(contacts.total_all),
      uniqueEmails: toInt(contacts.with_email),
      phones: toInt(contacts.with_mobile),
      travelBookings,
      chats: toInt(chatsR.rows[0]?.count),
      ...Object.fromEntries(RAYNA_SOURCES.map(src => [src, coverage[src].total])),
    },
    mysqlStatus,
    cronJobs,
    computedAt: new Date().toISOString(),
  };
}

router.get('/mapping-stats', async (req, res) => {
  const bt = parseBusinessType(req.query.businessType);
  const key = bt ?? 'All';
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
  try {
    const hit = mappingStatsCache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && !fresh && age < MAPPING_STATS_TTL_MS) return res.json({ ...hit.body, cached: true });

    let inflight = mappingStatsInflight.get(key);
    if (!inflight) {
      inflight = computeMappingStats(bt)
        .then(body => { mappingStatsCache.set(key, { at: Date.now(), body }); return body; })
        .finally(() => { mappingStatsInflight.delete(key); });
      mappingStatsInflight.set(key, inflight);
    }
    // Stale but usable: answer now, let the refresh finish in the background.
    if (hit && !fresh && age < MAPPING_STATS_STALE_MS) {
      inflight.catch(() => undefined);
      return res.json({ ...hit.body, cached: true, stale: true });
    }
    res.json(await inflight);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/v3/rayna-sync/refresh-mapping — re-run booking ↔ customer mapping
router.post('/refresh-mapping', async (_req, res) => {
  try {
    const { readFile } = await import('fs/promises');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const sql = await readFile(join(__dirname, '../migrations/026_booking_customer_mapping.sql'), 'utf8');
    await query(sql);
    res.json({ success: true, message: 'Booking ↔ Customer mapping refreshed' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/v3/rayna-sync/ingest — ingest billing records (JSON array)
// Body: [ { BillSerial, BillNo, BillType, ... }, ... ]
router.post('/ingest', async (req, res) => {
  try {
    const records = req.body as Parameters<typeof RaynaSyncService.ingestRecords>[0] | undefined;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected non-empty JSON array of billing records' });
    }
    const result = await RaynaSyncService.ingestRecords(records);
    await postSyncRecompute();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/v3/rayna-sync/ingest-dedup — ingest with duplicate check
// Body: [ { BillSerial, BillNo, BillType, ... }, ... ]
router.post('/ingest-dedup', async (req, res) => {
  try {
    const records = req.body as Parameters<typeof RaynaSyncService.ingestRecordsDedup>[0] | undefined;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected non-empty JSON array of billing records' });
    }
    const result = await RaynaSyncService.ingestRecordsDedup(records);
    await postSyncRecompute();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/v3/rayna-sync/rebuild-contacts — full pipeline: extract → link → segment
router.post('/rebuild-contacts', async (_req, res) => {
  try {
    const result = await UnifiedContactBuilder.rebuild();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/v3/rayna-sync/daily-sync — manually trigger yesterday's billing sync
router.post('/daily-sync', async (_req, res) => {
  try {
    const result = await DailyBillingSync.run();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
