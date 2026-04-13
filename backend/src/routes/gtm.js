import { Router } from 'express';
import cors from 'cors';
import db from '../config/database.js';
import GTMService from '../services/GTMService.js';

const router = Router();

// Allow any origin to POST events (GTM tags fire from raynatours.com)
router.use('/events', cors({ origin: true }));

// GET /api/v3/gtm/snippet — Get GTM container snippet
router.get('/snippet', (req, res) => {
  const containerId = req.query.containerId || 'GTM-RAYNA001';
  res.json(GTMService.getContainerSnippet(containerId));
});

// GET /api/v3/gtm/datalayer — Get all dataLayer scripts
router.get('/datalayer', (req, res) => {
  res.json(GTMService.getDataLayerScripts());
});

// POST /api/v3/gtm/events — Record a GTM event
router.post('/events', async (req, res) => {
  try {
    const event = await GTMService.recordEvent(req.body);
    res.status(201).json(event);
  } catch (err) {
    console.error('[GTM Events] Error recording event:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/gtm/events — Get recent events with full payload
router.get('/events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const eventName = req.query.eventName;
    let sql = 'SELECT * FROM gtm_events';
    const params = [];
    if (eventName) { params.push(eventName); sql += ` WHERE event_name = $1`; }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const { rows } = await db.query(sql, params);
    res.json({ success: true, count: rows.length, events: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/gtm/analytics — Event analytics
router.get('/analytics', async (req, res) => {
  try {
    const data = await GTMService.getEventAnalytics(req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/gtm/events/:eventName — Event detail rows
router.get('/events/:eventName', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT event_id, event_name, customer_id, session_id, page_url, page_title,
        event_category, event_action, event_label, event_value,
        utm_source, utm_medium, utm_campaign, device_type, browser, country, city, created_at
      FROM gtm_events WHERE event_name = $1
      ORDER BY created_at DESC LIMIT 100
    `, [req.params.eventName]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/gtm/export — BigQuery-compatible export
router.get('/export', async (req, res) => {
  try {
    const data = await GTMService.getExportData(req.query);
    res.json({ rows: data, count: data.length, format: 'bigquery_compatible' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/gtm/occasions — Get special occasions
router.get('/occasions', async (req, res) => {
  try {
    const occasions = await GTMService.getSpecialOccasions();
    res.json(occasions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/gtm/occasions — Create special occasion
router.post('/occasions', async (req, res) => {
  try {
    const occasion = await GTMService.createSpecialOccasion(req.body);
    res.status(201).json(occasion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
