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
    // Mapping breakdown by source and match type
    const { rows: breakdown } = await query(`
      SELECT booking_source, match_type,
        COUNT(*) as matched_bookings,
        COUNT(DISTINCT customer_master_id) as unique_customers
      FROM booking_customer_map
      GROUP BY booking_source, match_type
      ORDER BY booking_source, match_type
    `);

    // Overall stats
    const { rows: [overall] } = await query(`
      SELECT
        COUNT(*) as total_mapped,
        COUNT(DISTINCT customer_master_id) as customers_with_bookings,
        (SELECT COUNT(*) FROM customer_master) as total_customers
      FROM booking_customer_map
    `);

    // Top customers by revenue
    const { rows: topCustomers } = await query(`
      SELECT cm.id, cm.name, cm.email, cm.phone,
        cm.total_tour_bookings, cm.total_hotel_bookings,
        cm.total_flight_bookings, cm.total_visa_bookings,
        cm.total_booking_revenue,
        cm.first_booking_at, cm.last_booking_at,
        cm.total_chats, cm.chat_departments
      FROM customer_master cm
      WHERE cm.total_booking_revenue > 0
      ORDER BY cm.total_booking_revenue DESC
      LIMIT 20
    `);

    // Unmatched booking counts
    const { rows: [unmatched] } = await query(`
      SELECT
        (SELECT COUNT(*) FROM rayna_tours) as total_tours,
        (SELECT COUNT(*) FROM rayna_hotels) as total_hotels,
        (SELECT COUNT(*) FROM rayna_visas) as total_visas,
        (SELECT COUNT(*) FROM rayna_flights) as total_flights,
        (SELECT COUNT(*) FROM booking_customer_map WHERE booking_source='tours') as mapped_tours,
        (SELECT COUNT(*) FROM booking_customer_map WHERE booking_source='hotels') as mapped_hotels,
        (SELECT COUNT(*) FROM booking_customer_map WHERE booking_source='visas') as mapped_visas,
        (SELECT COUNT(*) FROM booking_customer_map WHERE booking_source='flights') as mapped_flights
    `);

    // MySQL sync status
    const { rows: mysqlStatus } = await query(
      "SELECT * FROM sync_metadata WHERE table_name LIKE 'mysql_%' ORDER BY table_name"
    );

    // GA4 BigQuery sync status
    const { rows: ga4Status } = await query(
      "SELECT * FROM sync_metadata WHERE table_name LIKE 'ga4%' OR table_name IN ('bigquery_events','user_profiles') ORDER BY table_name"
    );

    // Comprehensive data overview — all data sources
    const dataOverviewQueries = [
      query("SELECT COUNT(*) as count FROM mysql_contacts"),
      query("SELECT COUNT(*) as count FROM mysql_tickets"),
      query("SELECT COUNT(*) as count FROM mysql_chats"),
      query("SELECT COUNT(*) as count FROM mysql_departments"),
      query("SELECT COUNT(*) as count FROM customer_master"),
      query("SELECT COUNT(*) as count, COUNT(DISTINCT department_name) as depts FROM mysql_contacts WHERE department_name IS NOT NULL"),
      query("SELECT COUNT(*) as count, COUNT(DISTINCT department_name) as depts FROM mysql_tickets WHERE department_name IS NOT NULL"),
      query("SELECT COUNT(*) as count, COUNT(DISTINCT department_name) as depts FROM mysql_chats WHERE department_name IS NOT NULL"),
      query(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'ga4_events'`),
    ];
    const [contacts, tickets, chats, departments, custMaster, contactDepts, ticketDepts, chatDepts, ga4Exists] = await Promise.all(dataOverviewQueries);

    let ga4Count = 0;
    let ga4Users = 0;
    if (parseInt(ga4Exists.rows[0].count) > 0) {
      try {
        const { rows: [ga4] } = await query("SELECT COUNT(*) as count, COUNT(DISTINCT user_pseudo_id) as users FROM ga4_events");
        ga4Count = parseInt(ga4.count);
        ga4Users = parseInt(ga4.users);
      } catch { /* table may not exist */ }
    }

    // Department breakdown — unified across all 3 sources
    // Chats use mysql_departments.name, tickets use email (mapped via mysql_department_emails), contacts have their own labels
    let deptBreakdown = [];
    try {
      const { rows } = await query(`
        WITH
        chat_depts AS (
          SELECT department_name as dept, COUNT(*) as cnt FROM mysql_chats
          WHERE department_name IS NOT NULL AND department_name != ''
          GROUP BY department_name
        ),
        ticket_depts AS (
          SELECT COALESCE(de.dept_name, t.department_name) as dept, COUNT(*) as cnt
          FROM mysql_tickets t
          LEFT JOIN mysql_department_emails de ON LOWER(t.department_name) = LOWER(de.email)
          WHERE t.department_name IS NOT NULL AND t.department_name != ''
          GROUP BY COALESCE(de.dept_name, t.department_name)
        ),
        contact_depts AS (
          SELECT department_name as dept, COUNT(*) as cnt FROM mysql_contacts
          WHERE department_name IS NOT NULL AND department_name != ''
          GROUP BY department_name
        ),
        all_depts AS (
          SELECT dept FROM chat_depts
          UNION SELECT dept FROM ticket_depts
          UNION SELECT dept FROM contact_depts
        )
        SELECT
          ad.dept as name,
          COALESCE(co.cnt, 0) as contacts,
          COALESCE(tk.cnt, 0) as tickets,
          COALESCE(ch.cnt, 0) as chats
        FROM all_depts ad
        LEFT JOIN contact_depts co ON co.dept = ad.dept
        LEFT JOIN ticket_depts tk ON tk.dept = ad.dept
        LEFT JOIN chat_depts ch ON ch.dept = ad.dept
        ORDER BY (COALESCE(co.cnt,0) + COALESCE(tk.cnt,0) + COALESCE(ch.cnt,0)) DESC
        LIMIT 40
      `);
      deptBreakdown = rows;
    } catch { /* ignore if table missing */ }

    res.json({
      success: true,
      breakdown,
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
        contacts: parseInt(contacts.rows[0].count),
        tickets: parseInt(tickets.rows[0].count),
        chats: parseInt(chats.rows[0].count),
        departments: parseInt(departments.rows[0].count),
        customerMaster: parseInt(custMaster.rows[0].count),
        contactDepts: parseInt(contactDepts.rows[0].depts),
        ticketDepts: parseInt(ticketDepts.rows[0].depts),
        chatDepts: parseInt(chatDepts.rows[0].depts),
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
