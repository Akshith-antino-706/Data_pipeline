import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'rayna_data_pipe',
  user: 'akshithkumaryv',
  password: '7884',
});

// ── KPIs ──────────────────────────────────────────────────────
app.get('/api/kpis', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM chats)                                             AS total_chats,
      (SELECT COUNT(*) FILTER (WHERE status=2) FROM chats)                    AS closed_chats,
      (SELECT COUNT(*) FILTER (WHERE status=1) FROM chats)                    AS open_chats,
      (SELECT COUNT(*) FILTER (WHERE spam=1) FROM chats)                      AS wa_spam,
      (SELECT ROUND(COUNT(*) FILTER (WHERE status=2)*100.0/NULLIF(COUNT(*),0),1) FROM chats) AS wa_close_rate,
      (SELECT COUNT(*) FROM tickets)                                           AS total_tickets,
      (SELECT COUNT(*) FILTER (WHERE status IN ('3','16','48','70','99')) FROM tickets) AS closed_tickets,
      (SELECT COUNT(*) FILTER (WHERE status NOT IN ('3','16','48','70','99')) FROM tickets) AS open_tickets,
      (SELECT COUNT(*) FILTER (WHERE spam='1') FROM tickets)                  AS email_spam,
      (SELECT ROUND(COUNT(*) FILTER (WHERE status IN ('3','16','48','70','99'))*100.0/NULLIF(COUNT(*),0),1) FROM tickets) AS email_close_rate,
      (SELECT COUNT(*) FROM travel_data)                                       AS total_bookings,
      (SELECT ROUND(SUM(CASE WHEN bill_total ~ '^[0-9]+(\.[0-9]+)?$' THEN bill_total::numeric ELSE 0 END)::numeric,0) FROM tickets) AS total_revenue,
      (SELECT COUNT(*) FROM customer_segments)                                 AS total_customers,
      (SELECT COUNT(*) FILTER (WHERE identifier_type='email') FROM customer_segments) AS email_profiles,
      (SELECT COUNT(*) FILTER (WHERE identifier_type='whatsapp') FROM customer_segments) AS wa_profiles,
      (SELECT COUNT(DISTINCT assign_to) FROM chats WHERE assign_to > 0)       AS wa_agents,
      (SELECT COUNT(DISTINCT assign_to) FROM tickets WHERE assign_to ~ '^[0-9]+$' AND assign_to != '0') AS email_agents,
      (SELECT COUNT(*) FILTER (WHERE can_whatsapp) FROM customer_segments)    AS can_whatsapp,
      (SELECT COUNT(*) FILTER (WHERE can_email) FROM customer_segments)       AS can_email
  `);
  res.json(rows[0]);
});

// ── Chat hourly distribution ──────────────────────────────────
app.get('/api/chat-hourly', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS count
    FROM chats WHERE created_at IS NOT NULL
    GROUP BY hour ORDER BY hour
  `);
  res.json(rows);
});

// ── Chat daily distribution ───────────────────────────────────
app.get('/api/chat-daily', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT
      EXTRACT(DOW FROM created_at)::int AS dow,
      TRIM(TO_CHAR(created_at,'Day')) AS day_name,
      COUNT(*) AS count,
      COUNT(*) FILTER (WHERE status=2) AS closed
    FROM chats WHERE created_at IS NOT NULL
    GROUP BY dow, day_name ORDER BY dow
  `);
  res.json(rows);
});

// ── Department scorecard (both channels) ─────────────────────
app.get('/api/scorecard', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM department_scorecard ORDER BY total_volume DESC
  `);
  res.json(rows);
});

// ── WhatsApp department detail ────────────────────────────────
app.get('/api/whatsapp-depts', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM dept_whatsapp_performance ORDER BY total_chats DESC
  `);
  res.json(rows);
});

// ── Email department detail ───────────────────────────────────
app.get('/api/email-depts', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM dept_ticket_performance ORDER BY total_tickets DESC
  `);
  res.json(rows);
});

// ── Top agents (WhatsApp) ─────────────────────────────────────
app.get('/api/top-agents/whatsapp', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT agent_id, department_phone,
           SUM(total_chats) AS total_chats, SUM(closed_chats) AS closed_chats,
           ROUND(AVG(close_rate_pct),1) AS close_rate_pct,
           ROUND(AVG(avg_response_min),1) AS avg_response_min
    FROM agent_whatsapp_performance
    GROUP BY agent_id, department_phone
    ORDER BY total_chats DESC LIMIT 20
  `);
  res.json(rows);
});

// ── Top agents (Email) ────────────────────────────────────────
app.get('/api/top-agents/email', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT agent_id, department_name, department_email,
           SUM(total_tickets) AS total_tickets, SUM(closed_tickets) AS closed_tickets,
           ROUND(AVG(close_rate_pct),1) AS close_rate_pct,
           ROUND(AVG(avg_thread_depth),1) AS avg_thread_depth
    FROM agent_ticket_performance
    GROUP BY agent_id, department_name, department_email
    ORDER BY total_tickets DESC LIMIT 20
  `);
  res.json(rows);
});

// ── Ticket products ───────────────────────────────────────────
app.get('/api/ticket-products', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT produc AS product, COUNT(*) AS count
    FROM tickets
    WHERE produc IS NOT NULL AND produc != '' AND spam != '1'
    GROUP BY produc ORDER BY count DESC LIMIT 12
  `);
  res.json(rows);
});

// ── Travel services ───────────────────────────────────────────
app.get('/api/travel-services', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT service_name, COUNT(*) AS count
    FROM travel_data WHERE service_name IS NOT NULL
    GROUP BY service_name ORDER BY count DESC LIMIT 12
  `);
  res.json(rows);
});

// ── Travel nationalities ──────────────────────────────────────
app.get('/api/travel-nationalities', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT INITCAP(LOWER(nationality)) AS nationality, SUM(cnt) AS count
    FROM (
      SELECT nationality, COUNT(*) AS cnt
      FROM travel_data
      WHERE nationality IS NOT NULL AND nationality != ''
        AND LENGTH(TRIM(nationality)) > 2
      GROUP BY nationality
    ) t
    GROUP BY INITCAP(LOWER(nationality))
    ORDER BY count DESC LIMIT 12
  `);
  res.json(rows);
});

// ── Travel bill types ─────────────────────────────────────────
app.get('/api/travel-types', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT LOWER(bill_type) AS bill_type, COUNT(*) AS count
    FROM travel_data WHERE bill_type IS NOT NULL
    GROUP BY LOWER(bill_type) ORDER BY count DESC
  `);
  res.json(rows);
});

// ── Segment overview ──────────────────────────────────────────
app.get('/api/segments', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT segment_label, identifier_type, COUNT(*) AS count
    FROM customer_segments
    GROUP BY segment_label, identifier_type ORDER BY count DESC
  `);
  res.json(rows);
});

// ── Segment stats ─────────────────────────────────────────────
app.get('/api/segment-stats', async (_, res) => {
  const { rows } = await pool.query(`
    SELECT
      customer_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE can_email)    AS can_email,
      COUNT(*) FILTER (WHERE can_whatsapp) AS can_whatsapp,
      ROUND(AVG(total_bookings),1)         AS avg_bookings,
      ROUND(AVG(frequency),1)              AS avg_frequency
    FROM customer_segments
    WHERE customer_type IS NOT NULL
    GROUP BY customer_type
  `);
  res.json(rows);
});

app.listen(3001, () => console.log('API running on http://localhost:3001'));
