import { Router } from 'express';
import ProductService from '../services/ProductService.js';

const router = Router();

// GET /api/v3/products — list all products (with optional filters)
router.get('/', async (req, res) => {
  try {
    const products = await ProductService.getAll(req.query);
    res.json({ products, count: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/products/categories — get categories with counts
router.get('/categories', async (req, res) => {
  try {
    res.json(await ProductService.getCategories());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/products/:id — get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await ProductService.getById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v3/products/segment/:label — get recommended products for a segment
router.get('/segment/:label', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 3;
    const products = await ProductService.getForSegment(req.params.label, limit);
    res.json({ products, count: products.length, segment: req.params.label });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/products/generate-email — generate HTML email with products
router.post('/generate-email', async (req, res) => {
  try {
    const { segmentLabel, heading, subheading, ctaText, ctaUrl, couponCode, productCount } = req.body;
    const products = await ProductService.getForSegment(segmentLabel, productCount || 3);

    const html = ProductService.generateProductEmailHTML({
      products,
      heading: heading || 'Explore Amazing Experiences',
      subheading: subheading || 'Handpicked just for you',
      ctaText: ctaText || 'View All Tours',
      ctaUrl: ctaUrl || 'https://www.raynatours.com?utm_source=AI_marketer&utm_medium=email',
      couponCode,
      segmentLabel,
    });

    const waMessage = ProductService.generateProductWAMessage({
      products,
      intro: `Hi! 👋 Check out these amazing experiences we picked for you:`,
      couponCode,
    });

    res.json({ html, waMessage, products, productCount: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v3/products/generate-wa — generate WhatsApp message with products
router.post('/generate-wa', async (req, res) => {
  try {
    const { segmentLabel, intro, couponCode, productCount } = req.body;
    const products = await ProductService.getForSegment(segmentLabel, productCount || 3);

    const message = ProductService.generateProductWAMessage({
      products,
      intro: intro || 'Hi! 👋 Check out these experiences:',
      couponCode,
    });

    res.json({ message, products, productCount: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
