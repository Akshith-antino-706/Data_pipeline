import { Router } from 'express';
import { ContentService } from '../services/ContentService.js';
import { AIService } from '../services/AIService.js';
import { BaseTemplateService } from '../services/BaseTemplateService.js';
import { getSegmentProducts } from '../templates/segmentProducts.js';
import ProductService from '../services/ProductService.js';
import SEGMENT_EMAIL_CONFIG from '../templates/segmentEmailConfig.js';

const router = Router();

// GET /api/v2/content/templates
router.get('/templates', async (req, res, next) => {
  try {
    const { channel, status, page, limit } = req.query;
    const data = await ContentService.getAll({
      channel, status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    res.json({ success: true, ...data });
  } catch (err) { next(err); }
});

// GET /api/v2/content/templates/:id
router.get('/templates/:id', async (req, res, next) => {
  try {
    const data = await ContentService.getById(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/v2/content/templates/:id/preview — Render full email preview with base template
router.get('/templates/:id/preview', async (req, res, next) => {
  try {
    const template = await ContentService.getById(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });

    if (template.channel !== 'email') {
      return res.json({ success: true, data: { html: template.body } });
    }

    // Find matching segment config from template name
    const segmentName = Object.keys(SEGMENT_EMAIL_CONFIG).find(s => template.name?.includes(s));
    const segConfig = SEGMENT_EMAIL_CONFIG[segmentName] || {};
    let products;
    try {
      const dynamic = await ProductService.getForSegment(segmentName || 'Registered Not Booked', 3);
      if (dynamic.length > 0) {
        products = dynamic.map(p => ({
          product_url: p.url || 'https://www.raynatours.com',
          product_image: p.image || '',
          product_category: (p.item_group_id || '').replace(/-/g, ' '),
          product_name: p.name || '',
          product_rating: p.rating || '4.8',
          product_reviews: String(p.reviewCount || ''),
          product_price: String(p.salePrice || ''),
          product_strike_price: String(p.normalPrice || ''),
        }));
      }
    } catch { /* API down */ }
    if (!products || products.length === 0) {
      products = getSegmentProducts(segmentName || 'Registered Not Booked');
    }
    const baseTemplate = segConfig.baseTemplate || 'product-recommendation';

    const html = BaseTemplateService.render(baseTemplate, {
      customer_name: 'Traveler',
      email_heading: segConfig.email_heading || 'Explore Amazing Experiences',
      email_body: segConfig.email_body || template.body?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      cta_url: segConfig.cta_url || 'https://www.raynatours.com/activities',
      ...(segConfig.coupon_code ? {
        coupon_code: template.coupon_code || segConfig.coupon_code,
        coupon_discount: segConfig.coupon_discount || 'Flat 15% Off',
        coupon_expiry: segConfig.coupon_expiry || '7 days',
      } : {}),
      products,
    });

    res.json({ success: true, data: { html } });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates
router.post('/templates', async (req, res, next) => {
  try {
    const data = await ContentService.create(req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/v2/content/templates/:id
router.put('/templates/:id', async (req, res, next) => {
  try {
    const data = await ContentService.update(req.params.id, req.body);
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates/:id/approve
router.post('/templates/:id/approve', async (req, res, next) => {
  try {
    const data = await ContentService.approve(req.params.id, req.body.approvedBy || 'system');
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/content/templates/:id/reject
router.post('/templates/:id/reject', async (req, res, next) => {
  try {
    const data = await ContentService.reject(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/v2/content/generate — AI content generation
router.post('/generate', async (req, res, next) => {
  try {
    const { channel, segmentLabel, tone, goal, productContext } = req.body;
    if (!channel || !segmentLabel) {
      return res.status(400).json({ success: false, error: 'channel and segmentLabel are required' });
    }
    const content = await AIService.generateContent({ channel, segmentLabel, tone, goal, productContext });
    res.json({ success: true, data: content });
  } catch (err) { next(err); }
});

// POST /api/v2/content/generate-with-products — Generate content with real product data + images
router.post('/generate-with-products', async (req, res, next) => {
  try {
    const { segmentLabel, channel, heading, subheading, ctaText, ctaUrl, couponCode, productCount } = req.body;
    if (!segmentLabel) {
      return res.status(400).json({ success: false, error: 'segmentLabel is required' });
    }

    const products = await ProductService.getForSegment(segmentLabel, productCount || 3);
    const ch = channel || 'email';

    if (ch === 'email') {
      const html = ProductService.generateProductEmailHTML({
        products,
        heading: heading || `Top Picks for You`,
        subheading: subheading || `Curated experiences from Rayna Tours`,
        ctaText: ctaText || 'View All Tours',
        ctaUrl: ctaUrl || `https://www.raynatours.com?utm_source=AI_marketer&utm_medium=email&utm_campaign=segment_${encodeURIComponent(segmentLabel)}`,
        couponCode,
        segmentLabel,
      });

      res.json({
        success: true,
        data: {
          channel: 'email',
          body: html,
          subject: heading || `Your Curated Dubai Experiences`,
          products,
          media_urls: products.map(p => p.image),
        }
      });
    } else {
      const message = ProductService.generateProductWAMessage({
        products,
        intro: heading || `Hi! 👋 Check out these amazing experiences we picked for you:`,
        couponCode,
      });

      res.json({
        success: true,
        data: {
          channel: 'whatsapp',
          body: message,
          products,
          media_urls: products.map(p => p.image),
        }
      });
    }
  } catch (err) { next(err); }
});

export default router;
