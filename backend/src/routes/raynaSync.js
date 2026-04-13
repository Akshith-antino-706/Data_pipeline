import { Router } from 'express';
import RaynaSyncService from '../services/RaynaSyncService.js';
import { query } from '../config/database.js';

const router = Router();

// GET /api/v3/rayna-sync/status — sync status for all Rayna API tables
router.get('/status', async (_req, res) => {
  try {
    const status = await RaynaSyncService.getSyncStatus();
    const counts = await RaynaSyncService.getTableCounts();
    res.json({ success: true, tables: status, counts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v3/rayna-sync/mapping-stats — booking ↔ customer mapping stats
router.get('/mapping-stats', async (_req, res) => {
  try {
    // Overall stats from unified_contacts
    const { rows: [overall] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM unified_contacts WHERE total_travel_bookings > 0 OR total_tour_bookings > 0) as total_mapped,
        (SELECT COUNT(*) FROM unified_contacts WHERE total_travel_bookings > 0) as customers_with_bookings,
        (SELECT COUNT(*) FROM unified_contacts) as total_customers
    `);

    // Top customers by bookings from unified_contacts
    const { rows: topCustomers } = await query(`
      SELECT unified_id as id, name, email, phone, company_name, country,
        total_travel_bookings as total_bookings, total_booking_revenue,
        first_travel_at as first_booking_at, last_travel_at as last_booking_at,
        total_chats, total_tour_bookings, total_hotel_bookings, total_visa_bookings, total_flight_bookings
      FROM unified_contacts
      WHERE total_travel_bookings > 0 OR total_tour_bookings > 0
      ORDER BY total_travel_bookings DESC, total_booking_revenue DESC
      LIMIT 20
    `);

    // Coverage counts
    const { rows: [unmatched] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM rayna_tours) as total_tours,
        (SELECT COUNT(*) FROM rayna_hotels) as total_hotels,
        (SELECT COUNT(*) FROM rayna_visas) as total_visas,
        (SELECT COUNT(*) FROM rayna_flights) as total_flights,
        (SELECT COUNT(*) FROM rayna_tours WHERE unified_id IS NOT NULL) as mapped_tours,
        (SELECT COUNT(*) FROM rayna_hotels WHERE unified_id IS NOT NULL) as mapped_hotels,
        (SELECT COUNT(*) FROM rayna_visas WHERE unified_id IS NOT NULL) as mapped_visas,
        (SELECT COUNT(*) FROM rayna_flights WHERE unified_id IS NOT NULL) as mapped_flights
    `);

    // Sync status
    let mysqlStatus = [];
    try {
      const { rows } = await query("SELECT * FROM sync_metadata ORDER BY table_name");
      mysqlStatus = rows;
    } catch { /* ignore */ }

    // GA4 BigQuery sync status
    const { rows: ga4Status } = await query(
      "SELECT * FROM sync_metadata WHERE table_name LIKE 'ga4%' OR table_name IN ('bigquery_events','user_profiles') ORDER BY table_name"
    );

    // Comprehensive data overview — all data sources
    const dataOverviewQueries = [
      query("SELECT COUNT(*) as count FROM users"),
      query("SELECT COUNT(*) as count FROM user_emails"),
      query("SELECT COUNT(*) as count FROM user_phones"),
      query("SELECT COUNT(*) as count FROM departments"),
      query("SELECT COUNT(*) as count FROM dept_emails"),
      query("SELECT COUNT(*) as count FROM tickets"),
      query("SELECT COUNT(*) as count FROM travel_bookings"),
      query("SELECT COUNT(*) as count FROM chats"),
      query("SELECT COUNT(*) as count FROM unified_contacts"),
      query("SELECT COUNT(*) as count FROM rayna_tours"),
      query("SELECT COUNT(*) as count FROM rayna_hotels"),
      query("SELECT COUNT(*) as count FROM rayna_visas"),
      query("SELECT COUNT(*) as count FROM rayna_flights"),
    ];
    const [usersR, emailsR, phonesR, deptsR, deptEmailsR, ticketsR, bookingsR, chatsR, unifiedContactsR, toursR, hotelsR, visasR, flightsR] = await Promise.all(dataOverviewQueries);

    let ga4Count = 0;
    let ga4Users = 0;
    try {
      const { rows: [ga4] } = await query("SELECT COUNT(*) as count, COUNT(DISTINCT user_pseudo_id) as users FROM ga4_events");
      ga4Count = parseInt(ga4.count);
      ga4Users = parseInt(ga4.users);
    } catch { /* table may not exist */ }

    // Department breakdown — B2B vs B2C from unified_contacts
    let deptBreakdown = [];
    try {
      const { rows } = await query(`
        SELECT
          CASE WHEN chat_departments LIKE '%B2B%' AND chat_departments LIKE '%B2C%' THEN 'B2B, B2C'
               WHEN chat_departments LIKE '%B2B%' THEN 'B2B'
               WHEN chat_departments LIKE '%B2C%' THEN 'B2C'
               ELSE 'Unknown' END as name,
          COUNT(*) as customers,
          SUM(total_chats) as chats,
          SUM(total_travel_bookings) as bookings
        FROM unified_contacts
        WHERE chat_departments IS NOT NULL
        GROUP BY 1
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
      },
      dataOverview: {
        firstMsgFetched: parseInt((await query("SELECT COUNT(*) as c FROM chats WHERE first_msg_text IS NOT NULL")).rows[0].c),
        firstMsgPending: parseInt((await query("SELECT COUNT(*) as c FROM chats WHERE first_msg_text IS NULL AND wa_id IS NOT NULL")).rows[0].c),
        users: parseInt(usersR.rows[0].count),
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

// POST /api/v3/rayna-sync/trigger — manually trigger full sync (all 4 endpoints)
router.post('/trigger', async (_req, res) => {
  try {
    const results = await RaynaSyncService.syncAll();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/rayna-sync/trigger/:endpoint — sync a single endpoint (tours|hotels|visas|flights)
router.post('/trigger/:endpoint', async (req, res) => {
  try {
    const result = await RaynaSyncService.syncEndpoint(req.params.endpoint);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v3/rayna-sync/catch-up — re-fetch last N days to pick up modified records (default 90 days)
// Body: { "days": 90 }
router.post('/catch-up', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.body.days) || 90, 365);
    const results = await RaynaSyncService.syncCatchUp(days);
    res.json({ success: true, results });
  } catch (err) {
    console.error('[rayna-sync] catch-up error:', err.message);
    res.status(500).json({ success: false, error: 'Catch-up sync failed' });
  }
});

// POST /api/v3/rayna-sync/historical/:endpoint — pull historical data (default 6 months, chunked by month)
// Body: { "months": 6 }
router.post('/historical/:endpoint', async (req, res) => {
  try {
    const months = parseInt(req.body.months) || 6;
    const result = await RaynaSyncService.syncHistorical(req.params.endpoint, months);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
