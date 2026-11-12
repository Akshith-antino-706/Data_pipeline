/**
 * /api/v2/recommendations/*
 *
 * New route file — mounted additively in server.js. No touch to existing
 * content/journey routes.
 *
 * Endpoints:
 *   GET  /api/v2/recommendations/preview
 *        Query: city (required), excludeProductId, topN (default 5),
 *               templateId (required), customerName, destination
 *        Returns rendered HTML as JSON. NO SMTP.
 *
 *   POST /api/v2/recommendations/test-send
 *        Body: { to, city, excludeProductId, topN, templateId, customerName, destination }
 *        Hard allowlist on `to` — defaults to REC_TEST_ALLOWLIST env var,
 *        or falls back to a single test address baked in below. Any other
 *        address returns 403.
 *
 *   GET  /api/v2/recommendations/rank
 *        Query: city, excludeProductId, topN
 *        Diagnostic — returns { productIds, source, candidates, rationale }
 *        without rendering. Useful to sanity-check Claude picks.
 */

import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import type { QueryRequest } from '../types/routesCommon.js';
import type { RecTemplateRow, RecTestSendBody } from '../types/u6Services.js';
import db from '../config/database.js';
import { rankRecommendations } from '../services/RecommendationRankingService.js';
import { renderRecommendationEmail } from '../services/RecommendationRenderer.js';
import { EmailChannel } from '../services/channels/EmailChannel.js';
import { escapeHtml } from '../utils/validate.js';

const router = Router();

// Hard-coded fallback allowlist for test-send. Prefer REC_TEST_ALLOWLIST env
// var (comma-separated) in production.
const FALLBACK_TEST_ALLOWLIST = ['akshith@raynatours.com'];

function _testAllowlist() {
  const env = (process.env.REC_TEST_ALLOWLIST || '').trim();
  if (!env) return FALLBACK_TEST_ALLOWLIST;
  return env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/** Load a content_templates row → { body, subject }.
 *  Falls back to email_html_templates.html_body if the row is linked. */
async function _loadTemplate(templateId: string | number) {
  const { rows } = await db.query<RecTemplateRow>(`
    SELECT ct.id, ct.subject, ct.body, ct.name,
           COALESCE(NULLIF(eht.html_body, ''), ct.body) AS html_body
    FROM content_templates ct
    LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
    WHERE ct.id = $1
  `, [templateId]);
  return rows[0] || null;
}

// ── GET /rank — diagnostic ───────────────────────────────────────────────
router.get('/rank', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const city = req.query.city;
    if (!city) return res.status(400).json({ error: 'city query param is required' });
    const excludeProductId = req.query.excludeProductId || null;
    const topN = Math.min(10, Math.max(1, parseInt(req.query.topN) || 5));
    const ranking = await rankRecommendations({ destinationCity: city, excludeProductId, topN });
    res.json({ success: true, ...ranking });
  } catch (err) { next(err); }
});

// ── GET /preview — render only, no send ──────────────────────────────────
router.get('/preview', async (req: QueryRequest, res: Response, next: NextFunction) => {
  try {
    const city = req.query.city;
    const templateId = parseInt(req.query.templateId);
    if (!city) return res.status(400).json({ error: 'city query param is required' });
    if (!templateId) return res.status(400).json({ error: 'templateId query param is required' });

    const template = await _loadTemplate(templateId);
    if (!template) return res.status(404).json({ error: `Template ${templateId} not found` });

    const excludeProductId = req.query.excludeProductId || null;
    const topN = Math.min(10, Math.max(1, parseInt(req.query.topN) || 5));

    const ranking = await rankRecommendations({ destinationCity: city, excludeProductId, topN });

    const vars = {
      customer_name:  req.query.customerName || 'there',
      destination:    req.query.destination || city,
      email_heading:  req.query.emailHeading || `More to explore in ${city}`,
      email_body:     req.query.emailBody || `We picked ${topN} experiences we think you'll love while you're in ${city}.`,
      coupon_code:    req.query.couponCode || '',
      coupon_discount:req.query.couponDiscount || '',
      coupon_expiry:  req.query.couponExpiry || '',
    };

    const { html, productsUsed } = await renderRecommendationEmail({
      templateHtml: template.html_body || template.body || '',
      ranking,
      vars,
    });

    res.json({
      success: true,
      subject:      template.subject || '',
      html,
      templateName: template.name,
      ranking: { productIds: ranking.productIds, source: ranking.source, rationale: ranking.rationale, candidates: ranking.candidates },
      productsUsed: productsUsed.map(p => ({ product_id: p.product_id, product_name: p.product_name, product_price: p.product_price })),
    });
  } catch (err) { next(err); }
});

// ── POST /test-send — allowlist-gated live send ──────────────────────────
router.post('/test-send', async (req, res, next) => {
  try {
    const to = String((req.body as RecTestSendBody)?.to || '').trim().toLowerCase();
    if (!to) return res.status(400).json({ error: '`to` is required' });

    const allowlist = _testAllowlist();
    if (!allowlist.includes(to)) {
      return res.status(403).json({
        error: 'Recipient not in test allowlist',
        hint:  `Only ${allowlist.join(', ')} allowed. Set REC_TEST_ALLOWLIST env var to override.`,
      });
    }

    const city = (req.body as RecTestSendBody)?.city;
    const templateId = parseInt((req.body as RecTestSendBody)?.templateId);
    if (!city) return res.status(400).json({ error: 'city is required' });
    if (!templateId) return res.status(400).json({ error: 'templateId is required' });

    const template = await _loadTemplate(templateId);
    if (!template) return res.status(404).json({ error: `Template ${templateId} not found` });

    const excludeProductId = (req.body as RecTestSendBody)?.excludeProductId || null;
    const topN = Math.min(10, Math.max(1, parseInt((req.body as RecTestSendBody)?.topN) || 5));

    const ranking = await rankRecommendations({ destinationCity: city, excludeProductId, topN });

    const vars = {
      customer_name:  (req.body as RecTestSendBody)?.customerName || 'there',
      destination:    (req.body as RecTestSendBody)?.destination || city,
      email_heading:  (req.body as RecTestSendBody)?.emailHeading || `More to explore in ${city}`,
      email_body:     (req.body as RecTestSendBody)?.emailBody || `We picked ${topN} experiences we think you'll love while you're in ${city}.`,
      coupon_code:    (req.body as RecTestSendBody)?.couponCode || '',
      coupon_discount:(req.body as RecTestSendBody)?.couponDiscount || '',
      coupon_expiry:  (req.body as RecTestSendBody)?.couponExpiry || '',
    };

    const { html, productsUsed } = await renderRecommendationEmail({
      templateHtml: template.html_body || template.body || '',
      ranking,
      vars,
    });

    // Prepend a bright banner so a real inbox sees "TEST" clearly.
    const banner = `<div style="background:#fef3c7;border:2px solid #d97706;color:#92400e;padding:12px;text-align:center;font-family:Arial;font-size:13px;">
      ⚠️ TEST SEND — Rec journey preview. City: ${escapeHtml(city)}. templateId: ${escapeHtml(templateId)}. Ranking source: ${escapeHtml(ranking.source)}.
    </div>`;
    const brandedHtml = banner + html;

    const sendResult = await EmailChannel.send({
      to,
      subject: `[TEST] ${template.subject || 'Rayna Tours recommendations'}`,
      html: brandedHtml,
    });

    // Log the test send for later inspection. Non-blocking — if the log table
    // schema drifts, don't fail the send.
    try {
      await db.query(`
        INSERT INTO email_send_log
          (email, subject, template_label, source, external_id, provider, status, sent_at)
        VALUES ($1, $2, $3, 'rec-test', $4, $5, $6, NOW())
      `, [to, template.subject || '', template.name, sendResult.externalId || null, sendResult.provider || 'unknown', sendResult.success ? 'sent' : 'failed']);
    } catch (logErr) {
      console.warn('[recommendations/test-send] send-log insert failed:', (logErr as Error).message);
    }

    res.json({
      success: sendResult.success,
      simulated: !!sendResult.simulated,
      skipped: !!sendResult.skipped,
      to,
      subject: template.subject,
      templateName: template.name,
      ranking: { productIds: ranking.productIds, source: ranking.source, rationale: ranking.rationale },
      productsUsed: productsUsed.map(p => ({ product_id: p.product_id, product_name: p.product_name })),
      sendResult,
    });
  } catch (err) { next(err); }
});

export default router;
