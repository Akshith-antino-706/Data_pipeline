import { Router } from 'express';
import RaynaSyncService from '../services/RaynaSyncService.js';
import pool, { query } from '../config/database.js';
import UnifiedContactBuilder from '../services/UnifiedContactBuilder.js';
import DailyBillingSync from '../services/DailyBillingSync.js';

const router = Router();

// Run contact rebuild after any data ingest
async function postSyncRecompute() {
  await UnifiedContactBuilder.rebuild();
}

// GET /api/v3/rayna-sync/status — table counts + sync metadata
router.get('/status', async (_req, res) => {
  try {
    const status = await RaynaSyncService.getSyncStatus();
    const counts = await RaynaSyncService.getTableCounts();
    res.json({ success: true, tables: status, counts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/rayna-sync/mapping-stats — data-pipeline page payload.
// Allowed source tables: rayna_tours, rayna_hotels, rayna_visas,
// rayna_flights, rayna_packages, rayna_others, chats, unified_contacts.
router.get('/mapping-stats', async (req, res) => {
  try {
    const bt = (req.query.businessType || '').toUpperCase();
    let UC_FILTER, PROFIT_FILTER;
    if (bt === 'B2B')      { UC_FILTER = "contact_type = 'B2B'"; PROFIT_FILTER = "is_b2b = '1'"; }
    else if (bt === 'B2C') { UC_FILTER = "contact_type = 'B2C'"; PROFIT_FILTER = "is_b2b = '0'"; }
    else                   { UC_FILTER = "1=1";                    PROFIT_FILTER = "1=1"; }

    // Overall stats from unified_contacts
    const { rows: [overall] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM unified_contacts WHERE booking_status NOT IN ('PROSPECT') AND ${UC_FILTER}) as total_mapped,
        (SELECT COUNT(*) FROM unified_contacts WHERE booking_status NOT IN ('PROSPECT') AND ${UC_FILTER}) as customers_with_bookings,
        (SELECT COUNT(*) FROM unified_contacts WHERE ${UC_FILTER}) as total_customers
    `);

    // Top customers by revenue (from unified_contacts + rayna_*)
    const { rows: topCustomers } = await query(`
      SELECT uc.id, uc.name, uc.email, uc.mobile, uc.country, uc.contact_type,
        uc.booking_status, uc.product_tier, uc.geography, uc.sources,
        COALESCE(b.total_bookings, 0) as total_bookings,
        COALESCE(b.total_revenue, 0) as total_booking_revenue
      FROM unified_contacts uc
      LEFT JOIN (
        SELECT unified_id, COUNT(*) as total_bookings, SUM(selling_price) as total_revenue
        FROM (
          SELECT unified_id, selling_price FROM rayna_tours    WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_packages WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_hotels   WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_visas    WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_flights  WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_others   WHERE unified_id IS NOT NULL AND is_cancel <> '1'
        ) all_bookings
        GROUP BY unified_id
      ) b ON b.unified_id = uc.id
      WHERE uc.booking_status NOT IN ('PROSPECT') AND ${UC_FILTER}
      ORDER BY b.total_revenue DESC NULLS LAST
      LIMIT 20
    `);

    // Booking coverage (rayna_* with unified_id linked)
    const { rows: [unmatched] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM rayna_tours    WHERE ${PROFIT_FILTER}) as total_tours,
        (SELECT COUNT(*) FROM rayna_hotels   WHERE ${PROFIT_FILTER}) as total_hotels,
        (SELECT COUNT(*) FROM rayna_visas    WHERE ${PROFIT_FILTER}) as total_visas,
        (SELECT COUNT(*) FROM rayna_flights  WHERE ${PROFIT_FILTER}) as total_flights,
        (SELECT COUNT(*) FROM rayna_packages WHERE ${PROFIT_FILTER}) as total_packages,
        (SELECT COUNT(*) FROM rayna_others   WHERE ${PROFIT_FILTER}) as total_others,
        (SELECT COUNT(*) FROM rayna_tours    WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_tours,
        (SELECT COUNT(*) FROM rayna_hotels   WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_hotels,
        (SELECT COUNT(*) FROM rayna_visas    WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_visas,
        (SELECT COUNT(*) FROM rayna_flights  WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_flights,
        (SELECT COUNT(*) FROM rayna_packages WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_packages,
        (SELECT COUNT(*) FROM rayna_others   WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_others
    `);

    // MySQL sync card — limited to chats-related sync_metadata rows only.
    let mysqlStatus = [];
    try {
      const { rows } = await query(
        "SELECT * FROM sync_metadata WHERE table_name ILIKE '%chat%' ORDER BY table_name"
      );
      mysqlStatus = rows;
    } catch { /* ignore */ }

    // Cron jobs — registered in backend/server.js. Last-run pulled from
    // sync_metadata where the cron writes there; null otherwise.
    let cronJobs = [];
    try {
      const { rows: smRows } = await query("SELECT * FROM sync_metadata");
      const sm = Object.fromEntries(smRows.map(r => [r.table_name, r]));
      const latestRayna = ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_packages', 'rayna_others']
        .map(k => sm[k]).filter(Boolean)
        .sort((a, b) => new Date(b.last_synced_at) - new Date(a.last_synced_at))[0];
      cronJobs = [
        { name: 'daily_billing_sync', label: 'Daily Billing Sync',     schedule: '0 1 * * *',   humanSchedule: 'Daily at 1:00 AM Dubai', meta: latestRayna || null },
        { name: 'contact_enrichment', label: 'Contact Enrichment',     schedule: '30 1 * * *',  humanSchedule: 'Daily at 1:30 AM Dubai', meta: sm.contact_enrichment || null },
        { name: 'snapshot_refresh',   label: 'Segmentation Snapshot',  schedule: '0 2 * * *',   humanSchedule: 'Daily at 2:00 AM Dubai', meta: null },
        { name: 'unsubscribe_sync',   label: 'Unsubscribe Sync',       schedule: '0 2 * * *',   humanSchedule: 'Daily at 2:00 AM Dubai', meta: sm.unsubscribed || sm.unsubscribe_sync || null },
        { name: 'chats_sync',            label: 'Chats Sync',              schedule: '30 3 * * *',  humanSchedule: 'Daily at 3:30 AM Dubai',       meta: sm.chats_sync || null },
        { name: 'phpadmin_weekly_sync',  label: 'phpAdmin Contacts Sync',  schedule: '0 5 * * 0',   humanSchedule: 'Weekly on Sunday 5:00 AM Dubai', meta: sm.phpadmin_weekly_sync || null },
        { name: 'journey_engine',        label: 'Journey Engine',          schedule: '*/5 * * * *', humanSchedule: 'Every 5 minutes',              meta: null },
        { name: 'journey_autostart',     label: 'Journey Auto-start',      schedule: '* * * * *',   humanSchedule: 'Every minute',                 meta: null },
      ];
    } catch { /* ignore */ }

    // Data overview — only reads from the allowed tables (rayna_*, chats, unified_contacts).
    const dataOverviewQueries = [
      query(`SELECT COUNT(*) as count FROM unified_contacts WHERE ${UC_FILTER}`),
      query(`SELECT COUNT(*) as count FROM unified_contacts WHERE email IS NOT NULL AND email <> '' AND ${UC_FILTER}`),
      query(`SELECT COUNT(*) as count FROM unified_contacts WHERE mobile IS NOT NULL AND mobile <> '' AND ${UC_FILTER}`),
      query(`SELECT (SELECT COUNT(*) FROM rayna_tours WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_hotels WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_visas WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_flights WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_packages WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_others WHERE ${PROFIT_FILTER}) as count`),
      query(`SELECT COUNT(*) as count FROM chats`),
      query(`SELECT COUNT(*) as count FROM rayna_tours WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_hotels WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_visas WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_flights WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_packages WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_others WHERE ${PROFIT_FILTER}`),
    ];
    const [unifiedContactsR, emailsR, phonesR, bookingsR, chatsR, toursR, hotelsR, visasR, flightsR, packagesR, othersR] = await Promise.all(dataOverviewQueries);

    // Contact type breakdown (B2B vs B2C from unified_contacts)
    let deptBreakdown = [];
    try {
      const { rows } = await query(`
        SELECT contact_type as name,
          COUNT(*) as customers,
          COUNT(*) FILTER (WHERE booking_status NOT IN ('PROSPECT')) as with_bookings
        FROM unified_contacts
        WHERE contact_type IS NOT NULL AND ${UC_FILTER}
        GROUP BY contact_type
        ORDER BY COUNT(*) DESC
      `);
      deptBreakdown = rows;
    } catch { /* ignore */ }

    res.json({
      success: true,
      breakdown: [],
      overall: {
        totalMapped: parseInt(overall.total_mapped),
        customersWithBookings: parseInt(overall.customers_with_bookings),
        totalCustomers: parseInt(overall.total_customers),
        matchRate: overall.total_customers > 0
          ? ((parseInt(overall.customers_with_bookings) / parseInt(overall.total_customers)) * 100).toFixed(2)
          : 0,
      },
      coverage: {
        tours: { total: parseInt(unmatched.total_tours), mapped: parseInt(unmatched.mapped_tours) },
        hotels: { total: parseInt(unmatched.total_hotels), mapped: parseInt(unmatched.mapped_hotels) },
        visas: { total: parseInt(unmatched.total_visas), mapped: parseInt(unmatched.mapped_visas) },
        flights: { total: parseInt(unmatched.total_flights), mapped: parseInt(unmatched.mapped_flights) },
        packages: { total: parseInt(unmatched.total_packages), mapped: parseInt(unmatched.mapped_packages) },
        others: { total: parseInt(unmatched.total_others), mapped: parseInt(unmatched.mapped_others) },
      },
      dataOverview: {
        firstMsgFetched: parseInt((await query(`SELECT COUNT(*) as c FROM chats WHERE first_msg_text IS NOT NULL`)).rows[0].c),
        firstMsgPending: parseInt((await query(`SELECT COUNT(*) as c FROM chats WHERE first_msg_text IS NULL AND wa_id IS NOT NULL`)).rows[0].c),
        users: parseInt(unifiedContactsR.rows[0].count),
        totalUsers: parseInt((await query("SELECT COUNT(*) as c FROM unified_contacts")).rows[0].c),
        notSetUsers: parseInt((await query("SELECT COUNT(*) as c FROM unified_contacts WHERE contact_type IS NULL OR contact_type = ''")).rows[0].c),
        uniqueEmails: parseInt(emailsR.rows[0].count),
        phones: parseInt(phonesR.rows[0].count),
        travelBookings: parseInt(bookingsR.rows[0].count),
        chats: parseInt(chatsR.rows[0].count),
        unifiedContacts: parseInt(unifiedContactsR.rows[0].count),
        tours: parseInt(toursR.rows[0].count),
        hotels: parseInt(hotelsR.rows[0].count),
        visas: parseInt(visasR.rows[0].count),
        flights: parseInt(flightsR.rows[0].count),
        packages: parseInt(packagesR.rows[0].count),
        others: parseInt(othersR.rows[0].count),
      },
      deptBreakdown,
      topCustomers,
      mysqlStatus,
      cronJobs,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/rayna-sync/ingest — ingest billing records (JSON array)
// Body: [ { BillSerial, BillNo, BillType, ... }, ... ]
router.post('/ingest', async (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected non-empty JSON array of billing records' });
    }
    const result = await RaynaSyncService.ingestRecords(records);
    await postSyncRecompute();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/rayna-sync/ingest-dedup — ingest with duplicate check
// Body: [ { BillSerial, BillNo, BillType, ... }, ... ]
router.post('/ingest-dedup', async (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected non-empty JSON array of billing records' });
    }
    const result = await RaynaSyncService.ingestRecordsDedup(records);
    await postSyncRecompute();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/rayna-sync/rebuild-contacts — full pipeline: extract → link → segment
router.post('/rebuild-contacts', async (_req, res) => {
  try {
    const result = await UnifiedContactBuilder.rebuild();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/rayna-sync/daily-sync — manually trigger yesterday's billing sync
router.post('/daily-sync', async (_req, res) => {
  try {
    const result = await DailyBillingSync.run();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
