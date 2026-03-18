/**
 * Base Templates API — serves Rayna Tours production email templates
 */

import { Router } from 'express';
import { BaseTemplateService } from '../services/BaseTemplateService.js';

const router = Router();

/** GET / — List all base templates (metadata only) */
router.get('/', (req, res) => {
  try {
    const templates = BaseTemplateService.listTemplates();
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /:id — Get single template metadata + raw HTML */
router.get('/:id', (req, res) => {
  try {
    const template = BaseTemplateService.getTemplate(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /:id/preview — Render with sample data for preview */
router.get('/:id/preview', (req, res) => {
  try {
    const html = BaseTemplateService.preview(req.params.id);
    res.json({ success: true, data: { html } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /:id/render — Render template with provided data */
router.post('/:id/render', (req, res) => {
  try {
    const html = BaseTemplateService.render(req.params.id, req.body);
    const subject = BaseTemplateService.renderSubject(req.params.id, req.body);
    res.json({ success: true, data: { html, subject } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /:id/use — Create a content_template from a base template */
router.post('/:id/use', async (req, res) => {
  try {
    const meta = BaseTemplateService.getTemplate(req.params.id);
    if (!meta) return res.status(404).json({ success: false, error: 'Template not found' });

    const { name, data } = req.body;
    const html = data ? BaseTemplateService.render(req.params.id, data) : meta.html;
    const subject = data ? BaseTemplateService.renderSubject(req.params.id, data) : meta.subject;

    // Import ContentService dynamically to avoid circular deps
    const { ContentService } = await import('../services/ContentService.js');
    const template = await ContentService.create({
      name: name || `${meta.name} — ${new Date().toLocaleDateString()}`,
      channel: 'email',
      subject,
      body: html,
      variables: meta.variables,
      cta_url: data?.cta_url || 'https://www.raynatours.com',
      cta_text: 'Book Now',
    });

    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /clear-cache — Clear template file cache */
router.post('/clear-cache', (req, res) => {
  BaseTemplateService.clearCache();
  res.json({ success: true, message: 'Template cache cleared' });
});

// ═══════════════════════════════════════════════════════════
// Segment-Specific Email Templates (all 28 segments)
// ═══════════════════════════════════════════════════════════

/** GET /segments — List all segment email configs */
router.get('/segments/all', (req, res) => {
  try {
    const configs = BaseTemplateService.listSegmentTemplates();
    res.json({ success: true, data: configs, total: configs.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /segments/:name — Get config for a specific segment */
router.get('/segments/:name', (req, res) => {
  try {
    const config = BaseTemplateService.getSegmentConfig(decodeURIComponent(req.params.name));
    if (!config) return res.status(404).json({ success: false, error: 'No template for this segment' });
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /segments/:name/preview — Preview segment email with sample data */
router.get('/segments/:name/preview', (req, res) => {
  try {
    const result = BaseTemplateService.previewForSegment(decodeURIComponent(req.params.name));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /segments/:name/render — Render segment email with real data */
router.post('/segments/:name/render', (req, res) => {
  try {
    const { customerName, products } = req.body;
    const result = BaseTemplateService.renderForSegment(
      decodeURIComponent(req.params.name),
      { customerName, products }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /segments/:name/use — Create content_template for a segment */
router.post('/segments/:name/use', async (req, res) => {
  try {
    const segmentName = decodeURIComponent(req.params.name);
    const result = BaseTemplateService.previewForSegment(segmentName);
    const config = BaseTemplateService.getSegmentConfig(segmentName);
    if (!config) return res.status(404).json({ success: false, error: 'No template for this segment' });

    const { ContentService } = await import('../services/ContentService.js');
    const template = await ContentService.create({
      name: req.body.name || `${segmentName} — Email Template`,
      channel: 'email',
      subject: result.subject,
      body: result.html,
      variables: ['customer_name'],
      cta_url: config.cta_url || 'https://www.raynatours.com',
      cta_text: config.cta_text || 'Book Now',
    });

    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
