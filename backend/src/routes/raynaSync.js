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

// GET /api/v3/rayna-sync/mapping-stats — booking ↔ customer mapping stats (filtered by businessType)
router.get('/mapping-stats', async (req, res) => {
  try {
    const bt = (req.query.businessType || '').toUpperCase();

    let UC_FILTER, PROFIT_FILTER, USER_TYPE_FILTER, DEPT_FILTER;
    if (bt === 'B2B') {
      UC_FILTER = "contact_type = 'B2B'";
      PROFIT_FILTER = "is_b2b = '1'";
      USER_TYPE_FILTER = "UPPER(u.contact_type) = 'B2B'";
      DEPT_FILTER = "contact_type = 'B2B'";
    } else if (bt === 'B2C') {
      UC_FILTER = "contact_type = 'B2C'";
      PROFIT_FILTER = "is_b2b = '0'";
      USER_TYPE_FILTER = "UPPER(u.contact_type) = 'B2C'";
      DEPT_FILTER = "contact_type = 'B2C'";
    } else {
      UC_FILTER = "1=1";
      PROFIT_FILTER = "1=1";
      USER_TYPE_FILTER = "1=1";
      DEPT_FILTER = "1=1";
    }

    // Overall stats from unified_contacts (booking_status != PROSPECT means has bookings)
    const { rows: [overall] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM unified_contacts WHERE booking_status NOT IN ('PROSPECT') AND ${UC_FILTER}) as total_mapped,
        (SELECT COUNT(*) FROM unified_contacts WHERE booking_status NOT IN ('PROSPECT') AND ${UC_FILTER}) as customers_with_bookings,
        (SELECT COUNT(*) FROM unified_contacts WHERE ${UC_FILTER}) as total_customers
    `);

    // Top customers by revenue (computed from rayna tables)
    const { rows: topCustomers } = await query(`
      SELECT uc.id, uc.name, uc.email, uc.mobile, uc.country, uc.contact_type,
        uc.booking_status, uc.product_tier, uc.geography, uc.sources,
        COALESCE(b.total_bookings, 0) as total_bookings,
        COALESCE(b.total_revenue, 0) as total_booking_revenue
      FROM unified_contacts uc
      LEFT JOIN (
        SELECT unified_id,
          COUNT(*) as total_bookings,
          SUM(selling_price) as total_revenue
        FROM (
          SELECT unified_id, selling_price FROM rayna_tours WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_packages WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_hotels WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_visas WHERE unified_id IS NOT NULL AND is_cancel <> '1'
          UNION ALL SELECT unified_id, selling_price FROM rayna_others WHERE unified_id IS NOT NULL AND is_cancel <> '1'
        ) all_bookings
        GROUP BY unified_id
      ) b ON b.unified_id = uc.id
      WHERE uc.booking_status NOT IN ('PROSPECT') AND ${UC_FILTER}
      ORDER BY b.total_revenue DESC NULLS LAST
      LIMIT 20
    `);

    // Coverage counts
    const { rows: [unmatched] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM rayna_tours WHERE ${PROFIT_FILTER}) as total_tours,
        (SELECT COUNT(*) FROM rayna_hotels WHERE ${PROFIT_FILTER}) as total_hotels,
        (SELECT COUNT(*) FROM rayna_visas WHERE ${PROFIT_FILTER}) as total_visas,
        (SELECT COUNT(*) FROM rayna_flights WHERE ${PROFIT_FILTER}) as total_flights,
        (SELECT COUNT(*) FROM rayna_packages WHERE ${PROFIT_FILTER}) as total_packages,
        (SELECT COUNT(*) FROM rayna_others WHERE ${PROFIT_FILTER}) as total_others,
        (SELECT COUNT(*) FROM rayna_tours WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_tours,
        (SELECT COUNT(*) FROM rayna_hotels WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_hotels,
        (SELECT COUNT(*) FROM rayna_visas WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_visas,
        (SELECT COUNT(*) FROM rayna_flights WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_flights,
        (SELECT COUNT(*) FROM rayna_packages WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_packages,
        (SELECT COUNT(*) FROM rayna_others WHERE unified_id IS NOT NULL AND ${PROFIT_FILTER}) as mapped_others
    `);

    // Sync status
    let mysqlStatus = [];
    try {
      const { rows } = await query("SELECT * FROM sync_metadata ORDER BY table_name");
      mysqlStatus = rows;
    } catch { /* ignore */ }

    // GA4 BigQuery sync status
    let ga4Status = [];
    try {
      const { rows } = await query(
        "SELECT * FROM sync_metadata WHERE table_name LIKE 'ga4%' OR table_name IN ('bigquery_events','user_profiles') ORDER BY table_name"
      );
      ga4Status = rows;
    } catch { /* ignore */ }

    // Data overview (filtered by businessType)
    const dataOverviewQueries = [
      query(`SELECT COUNT(*) as count FROM users WHERE ${USER_TYPE_FILTER.replace('u.', '')}`),
      query(`SELECT COUNT(*) as count FROM user_emails ue JOIN users u ON ue.user_id = u.id WHERE ${USER_TYPE_FILTER}`),
      query(`SELECT COUNT(*) as count FROM user_phones up JOIN users u ON up.user_id = u.id WHERE ${USER_TYPE_FILTER}`),
      query(`SELECT COUNT(*) as count FROM departments WHERE ${DEPT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM dept_emails WHERE ${DEPT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM tickets t JOIN users u ON t.user_id = u.id WHERE ${USER_TYPE_FILTER}`),
      query(`SELECT (SELECT COUNT(*) FROM rayna_tours WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_hotels WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_visas WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_flights WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_packages WHERE ${PROFIT_FILTER}) + (SELECT COUNT(*) FROM rayna_others WHERE ${PROFIT_FILTER}) as count`),
      query(`SELECT COUNT(*) as count FROM chats c JOIN users u ON c.user_id = u.id WHERE ${USER_TYPE_FILTER}`),
      query(`SELECT COUNT(*) as count FROM unified_contacts WHERE ${UC_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_tours WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_hotels WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_visas WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_flights WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_packages WHERE ${PROFIT_FILTER}`),
      query(`SELECT COUNT(*) as count FROM rayna_others WHERE ${PROFIT_FILTER}`),
    ];
    const [usersR, emailsR, phonesR, deptsR, deptEmailsR, ticketsR, bookingsR, chatsR, unifiedContactsR, toursR, hotelsR, visasR, flightsR, packagesR, othersR] = await Promise.all(dataOverviewQueries);

    let ga4Count = 0;
    let ga4Users = 0;
    try {
      const { rows: [ga4] } = await query("SELECT COUNT(*) as count, COUNT(DISTINCT user_pseudo_id) as users FROM ga4_events");
      ga4Count = parseInt(ga4.count);
      ga4Users = parseInt(ga4.users);
    } catch { /* table may not exist */ }

    // Contact type breakdown (replaces old chat_departments breakdown)
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
        firstMsgFetched: parseInt((await query(`SELECT COUNT(*) as c FROM chats c JOIN users u ON c.user_id = u.id WHERE c.first_msg_text IS NOT NULL AND ${USER_TYPE_FILTER}`)).rows[0].c),
        firstMsgPending: parseInt((await query(`SELECT COUNT(*) as c FROM chats c JOIN users u ON c.user_id = u.id WHERE c.first_msg_text IS NULL AND c.wa_id IS NOT NULL AND ${USER_TYPE_FILTER}`)).rows[0].c),
        users: parseInt(usersR.rows[0].count),
        totalUsers: parseInt((await query("SELECT COUNT(*) as c FROM users")).rows[0].c),
        notSetUsers: parseInt((await query("SELECT COUNT(*) as c FROM users WHERE contact_type IS NULL OR contact_type = ''")).rows[0].c),
        uniqueEmails: parseInt(emailsR.rows[0].count),
        phones: parseInt(phonesR.rows[0].count),
        departments: parseInt(deptsR.rows[0].count),
        deptEmails: parseInt(deptEmailsR.rows[0].count),
        tickets: parseInt(ticketsR.rows[0].count),
        travelBookings: parseInt(bookingsR.rows[0].count),
        chats: parseInt(chatsR.rows[0].count),
        unifiedContacts: parseInt(unifiedContactsR.rows[0].count),
        tours: parseInt(toursR.rows[0].count),
        hotels: parseInt(hotelsR.rows[0].count),
        visas: parseInt(visasR.rows[0].count),
        flights: parseInt(flightsR.rows[0].count),
        packages: parseInt(packagesR.rows[0].count),
        others: parseInt(othersR.rows[0].count),
        ga4Events: ga4Count,
        ga4Users: ga4Users,
      },
      deptBreakdown,
      topCustomers,
      mysqlStatus,
      ga4Status,
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
