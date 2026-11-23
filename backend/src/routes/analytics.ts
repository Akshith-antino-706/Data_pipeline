import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// ── Legacy KPIs (preserved from original server.js) ─────────
router.get('/kpis', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        (SELECT COUNT(*) FROM chats) AS total_chats,
        (SELECT COUNT(*) FILTER (WHERE status=2) FROM chats) AS closed_chats,
        (SELECT COUNT(*) FILTER (WHERE status=1) FROM chats) AS open_chats,
        (SELECT COUNT(*) FILTER (WHERE spam=1) FROM chats) AS wa_spam,
        (SELECT ROUND(COUNT(*) FILTER (WHERE status=2)*100.0/NULLIF(COUNT(*),0),1) FROM chats) AS wa_close_rate,
        (SELECT COUNT(*) FROM tickets) AS total_tickets,
        (SELECT COUNT(*) FILTER (WHERE status IN ('3','16','48','70','99')) FROM tickets) AS closed_tickets,
        (SELECT COUNT(*) FILTER (WHERE status NOT IN ('3','16','48','70','99')) FROM tickets) AS open_tickets,
        (SELECT COUNT(*) FILTER (WHERE spam='1') FROM tickets) AS email_spam,
        (SELECT ROUND(COUNT(*) FILTER (WHERE status IN ('3','16','48','70','99'))*100.0/NULLIF(COUNT(*),0),1) FROM tickets) AS email_close_rate,
        (SELECT COUNT(*) FROM travel_data) AS total_bookings,
        (SELECT ROUND(SUM(CASE WHEN bill_total ~ '^[0-9]+(\\.[0-9]+)?$' THEN bill_total::numeric ELSE 0 END)::numeric,0) FROM tickets) AS total_revenue,
        (SELECT COUNT(*) FROM customer_segments) AS total_customers,
        (SELECT COUNT(*) FILTER (WHERE identifier_type='email') FROM customer_segments) AS email_profiles,
        (SELECT COUNT(*) FILTER (WHERE identifier_type='whatsapp') FROM customer_segments) AS wa_profiles,
        (SELECT COUNT(DISTINCT assign_to) FROM chats WHERE assign_to > 0) AS wa_agents,
        (SELECT COUNT(DISTINCT assign_to) FROM tickets WHERE assign_to ~ '^[0-9]+$' AND assign_to != '0') AS email_agents,
        (SELECT COUNT(*) FILTER (WHERE can_whatsapp) FROM customer_segments) AS can_whatsapp,
        (SELECT COUNT(*) FILTER (WHERE can_email) FROM customer_segments) AS can_email
    `);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Chat hourly distribution ────────────────────────────────
router.get('/chat-hourly', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS count
      FROM chats WHERE created_at IS NOT NULL
      GROUP BY hour ORDER BY hour
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Chat daily distribution ─────────────────────────────────
router.get('/chat-daily', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        EXTRACT(DOW FROM created_at)::int AS dow,
        TRIM(TO_CHAR(created_at,'Day')) AS day_name,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE status=2) AS closed
      FROM chats WHERE created_at IS NOT NULL
      GROUP BY dow, day_name ORDER BY dow
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Department scorecard ────────────────────────────────────
router.get('/scorecard', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT ds.*,
             ch.name AS department_name
      FROM department_scorecard ds
      LEFT JOIN channels ch
        ON ch.type = 'whatsapp'
       AND ch.connection = ds.department_ref
      ORDER BY ds.total_volume DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── WhatsApp departments ────────────────────────────────────
router.get('/whatsapp-depts', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT dw.*, ch.name AS department_name
      FROM dept_whatsapp_performance dw
      LEFT JOIN channels ch
        ON ch.type = 'whatsapp'
       AND ch.connection = dw.department_phone
      ORDER BY dw.total_chats DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Email departments ───────────────────────────────────────
router.get('/email-depts', async (_, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM dept_ticket_performance ORDER BY total_tickets DESC');
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Top agents ──────────────────────────────────────────────
router.get('/top-agents/whatsapp', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT agent_id, department_phone,
             SUM(total_chats) AS total_chats, SUM(closed_chats) AS closed_chats,
             ROUND(AVG(close_rate_pct),1) AS close_rate_pct,
             ROUND(AVG(avg_response_min),1) AS avg_response_min
      FROM agent_whatsapp_performance
      GROUP BY agent_id, department_phone
      ORDER BY total_chats DESC LIMIT 20
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/top-agents/email', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT agent_id, department_name, department_email,
             SUM(total_tickets) AS total_tickets, SUM(closed_tickets) AS closed_tickets,
             ROUND(AVG(close_rate_pct),1) AS close_rate_pct,
             ROUND(AVG(avg_thread_depth),1) AS avg_thread_depth
      FROM agent_ticket_performance
      GROUP BY agent_id, department_name, department_email
      ORDER BY total_tickets DESC LIMIT 20
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Travel analytics ────────────────────────────────────────
router.get('/ticket-products', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT produc AS product, COUNT(*) AS count
      FROM tickets WHERE produc IS NOT NULL AND produc != '' AND spam != '1'
      GROUP BY produc ORDER BY count DESC LIMIT 12
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/travel-services', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT service_name, COUNT(*) AS count
      FROM travel_data WHERE service_name IS NOT NULL
      GROUP BY service_name ORDER BY count DESC LIMIT 12
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/travel-nationalities', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT INITCAP(LOWER(nationality)) AS nationality, SUM(cnt) AS count
      FROM (
        SELECT nationality, COUNT(*) AS cnt
        FROM travel_data WHERE nationality IS NOT NULL AND nationality != '' AND LENGTH(TRIM(nationality)) > 2
        GROUP BY nationality
      ) t
      GROUP BY INITCAP(LOWER(nationality))
      ORDER BY count DESC LIMIT 12
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/travel-types', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT LOWER(bill_type) AS bill_type, COUNT(*) AS count
      FROM travel_data WHERE bill_type IS NOT NULL
      GROUP BY LOWER(bill_type) ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Segment analytics (legacy compat) ───────────────────────
router.get('/segments', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT segment_label, identifier_type, COUNT(*) AS count
      FROM customer_segments GROUP BY segment_label, identifier_type ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/segment-stats', async (_, res, next) => {
  try {
    const { rows } = await query(`
      SELECT customer_type, COUNT(*) AS total,
        COUNT(*) FILTER (WHERE can_email) AS can_email,
        COUNT(*) FILTER (WHERE can_whatsapp) AS can_whatsapp,
        ROUND(AVG(total_bookings),1) AS avg_bookings,
        ROUND(AVG(frequency),1) AS avg_frequency
      FROM customer_segments WHERE customer_type IS NOT NULL
      GROUP BY customer_type
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Channels ───────────────────────────────────────────────
router.get('/channels', async (_, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM channels ORDER BY name');
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
