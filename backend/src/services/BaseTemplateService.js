/**
 * Base Template Service — manages Rayna Tours production email templates
 *
 * Loads HTML templates from /templates/email/, renders with variable substitution,
 * and provides metadata for the Content page template gallery.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import SEGMENT_EMAIL_CONFIG from '../templates/segmentEmailConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '..', 'templates', 'email');

// Template metadata registry
const TEMPLATE_REGISTRY = {
  'cart-abandonment': {
    id: 'cart-abandonment',
    name: 'Cart Abandonment',
    description: 'Recover abandoned carts with urgency messaging and product details',
    category: 'recovery',
    thumbnail: 'https://d1i3enf1i5tb1f.cloudfront.net/assets/Email-Temp/cart.png',
    subject: 'Your Adventure Awaits — Complete Your Booking!',
    hasProducts: true,
    hasCoupon: false,
    variables: ['customer_name', 'cta_url', 'product_image', 'product_category', 'product_name', 'event_date', 'product_variant', 'adult_count', 'child_count', 'product_price', 'product_strike_price'],
    bestFor: ['Cart Abandoners', 'Browse Abandoners', 'Payment Failed'],
  },
  'exclusive-coupon': {
    id: 'exclusive-coupon',
    name: 'Exclusive Coupon',
    description: 'Coupon-driven email to incentivize bookings with discount codes',
    category: 'promotion',
    thumbnail: 'https://d1i3enf1i5tb1f.cloudfront.net/assets/Email-Temp/deal.png',
    subject: 'Exclusive Offer Just For You — {{coupon_discount}}!',
    hasProducts: false,
    hasCoupon: true,
    variables: ['customer_name', 'email_heading', 'email_body', 'coupon_code', 'coupon_discount', 'coupon_expiry'],
    bestFor: ['Discount Seekers', 'Price Sensitive', 'Win-back Targets'],
  },
  'product-recommendation': {
    id: 'product-recommendation',
    name: 'Product Recommendation + Coupon',
    description: 'Personalized product recommendations with coupon code and ratings',
    category: 'engagement',
    thumbnail: 'https://d1i3enf1i5tb1f.cloudfront.net/assets/Email-Temp/star.png',
    subject: 'Discover the Magic of the UAE — {{coupon_discount}}!',
    hasProducts: true,
    hasCoupon: true,
    variables: ['customer_name', 'email_heading', 'email_body', 'coupon_code', 'coupon_discount', 'coupon_expiry', 'product_image', 'product_category', 'product_name', 'product_rating', 'product_reviews', 'product_price', 'product_strike_price', 'product_url'],
    bestFor: ['High Value Customers', 'Repeat Bookers', 'New Explorers'],
  },
  'wishlist-reminder': {
    id: 'wishlist-reminder',
    name: 'Wishlist Reminder',
    description: 'Urgency-based wishlist reminder with price increase warning',
    category: 'recovery',
    thumbnail: 'https://d1i3enf1i5tb1f.cloudfront.net/assets/Email-Temp/clock-dash.png',
    subject: 'Your Adventure Awaits — Prices About to Increase!',
    hasProducts: true,
    hasCoupon: false,
    variables: ['customer_name', 'cta_url', 'product_image', 'product_category', 'product_name', 'product_rating', 'product_reviews', 'product_price', 'product_strike_price', 'product_url'],
    bestFor: ['Wishlist Users', 'Browse Abandoners', 'Engaged Non-Bookers'],
  },
  'welcome-back': {
    id: 'welcome-back',
    name: 'Welcome Back / Win-back',
    description: 'Re-engage dormant customers with optional coupon and product picks',
    category: 'winback',
    thumbnail: 'https://d1i3enf1i5tb1f.cloudfront.net/assets/Email-Temp/wishlist.png',
    subject: '{{email_heading}}',
    hasProducts: true,
    hasCoupon: true,
    variables: ['customer_name', 'email_heading', 'email_body', 'coupon_code', 'coupon_discount', 'coupon_expiry', 'product_image', 'product_category', 'product_name', 'product_rating', 'product_reviews', 'product_price', 'product_strike_price', 'product_url'],
    bestFor: ['Dormant Customers', 'Churned Customers', 'Lapsed Bookers', 'Win-back Targets'],
  },
};

// Cache loaded templates in memory
const _templateCache = {};

export class BaseTemplateService {

  /** List all available base templates with metadata */
  static listTemplates() {
    return Object.values(TEMPLATE_REGISTRY);
  }

  /** Get single template metadata + raw HTML */
  static getTemplate(templateId) {
    const meta = TEMPLATE_REGISTRY[templateId];
    if (!meta) return null;

    const html = this._loadHTML(templateId);
    return { ...meta, html };
  }

  /** Render a template with data — replaces {{variables}} and handles {{#products}} blocks */
  static render(templateId, data = {}) {
    const meta = TEMPLATE_REGISTRY[templateId];
    if (!meta) throw new Error(`Template not found: ${templateId}`);

    let html = this._loadHTML(templateId);

    // Handle {{#if variable}}...{{/if}} blocks
    html = html.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varName, content) => {
      return data[varName] ? content : '';
    });

    // Handle {{#products}}...{{/products}} repeating blocks
    html = html.replace(/\{\{#products\}\}([\s\S]*?)\{\{\/products\}\}/g, (match, productBlock) => {
      const products = data.products || [];
      if (products.length === 0) return '';

      return products.map(product => {
        let block = productBlock;
        // Replace product-level variables
        for (const [key, value] of Object.entries(product)) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          block = block.replace(regex, value || '');
        }
        return block;
      }).join('');
    });

    // Replace top-level {{variables}}
    for (const [key, value] of Object.entries(data)) {
      if (key === 'products') continue; // Already handled above
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      html = html.replace(regex, value || '');
    }

    // Clean up any remaining unreplaced variables
    html = html.replace(/\{\{[a-z_]+\}\}/g, '');

    return html;
  }

  /** Render template subject with variables */
  static renderSubject(templateId, data = {}) {
    const meta = TEMPLATE_REGISTRY[templateId];
    if (!meta) return '';

    let subject = meta.subject;
    for (const [key, value] of Object.entries(data)) {
      if (key === 'products') continue;
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      subject = subject.replace(regex, value || '');
    }
    return subject;
  }

  /** Preview a template with sample data */
  static preview(templateId) {
    const sampleData = {
      customer_name: 'Sarah Johnson',
      email_heading: 'Discover the Magic of the UAE',
      email_body: 'Based on your interests, we\'ve handpicked the most popular UAE experiences. From thrilling desert safaris to iconic city landmarks, explore the best of Dubai and beyond with our exclusive discount.',
      cta_url: 'https://www.raynatours.com',
      coupon_code: 'RAYNA2026',
      coupon_discount: 'Flat 15% Off',
      coupon_expiry: '48 hours',
      products: [
        {
          product_image: 'https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_300,h_200/f_auto/q_auto/https://d31sl6cu4pqx6g.cloudfront.net/City-Images/13668/dubai-city.png',
          product_category: 'Desert Safari',
          product_name: 'Premium Desert Safari with BBQ Dinner',
          product_rating: '4.8',
          product_reviews: '2,341',
          product_price: '149',
          product_strike_price: '199',
          product_url: 'https://www.raynatours.com',
          product_variant: 'Shared Transfer',
          event_date: 'Mar 20, 2026',
          adult_count: '2',
          child_count: '1',
        },
        {
          product_image: 'https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_300,h_200/f_auto/q_auto/https://d31sl6cu4pqx6g.cloudfront.net/City-Images/13236/abu-dhabi.jpg',
          product_category: 'City Tour',
          product_name: 'Burj Khalifa At The Top — 124th Floor',
          product_rating: '4.9',
          product_reviews: '5,892',
          product_price: '169',
          product_strike_price: '199',
          product_url: 'https://www.raynatours.com',
          product_variant: 'Skip the Line',
          event_date: 'Mar 22, 2026',
          adult_count: '2',
          child_count: '0',
        },
        {
          product_image: 'https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_300,h_200/f_auto/q_auto/https://d31sl6cu4pqx6g.cloudfront.net/City-Images/14644/ras-al-khaimah-city.png',
          product_category: 'Cruise',
          product_name: 'Dubai Marina Luxury Dhow Cruise with Dinner',
          product_rating: '4.7',
          product_reviews: '1,205',
          product_price: '99',
          product_strike_price: '149',
          product_url: 'https://www.raynatours.com',
          product_variant: 'Private Transfer',
          event_date: 'Mar 25, 2026',
          adult_count: '2',
          child_count: '2',
        },
      ],
    };

    return this.render(templateId, sampleData);
  }

  // ═══════════════════════════════════════════════════════
  // Segment-Specific Templates (all 28 segments)
  // ═══════════════════════════════════════════════════════

  /** List all segment template configs */
  static listSegmentTemplates() {
    return Object.entries(SEGMENT_EMAIL_CONFIG).map(([segmentName, config]) => ({
      segmentName,
      baseTemplate: config.baseTemplate,
      subject: config.subject,
      email_heading: config.email_heading,
      hasCoupon: !!config.coupon_code,
      coupon_code: config.coupon_code || null,
      coupon_discount: config.coupon_discount || null,
    }));
  }

  /** Get template config for a specific segment */
  static getSegmentConfig(segmentName) {
    return SEGMENT_EMAIL_CONFIG[segmentName] || null;
  }

  /** Render a segment-specific email with products and customer data */
  static renderForSegment(segmentName, { customerName, products } = {}) {
    const config = SEGMENT_EMAIL_CONFIG[segmentName];
    if (!config) throw new Error(`No email template configured for segment: ${segmentName}`);

    const data = {
      customer_name: customerName || 'Valued Customer',
      email_heading: config.email_heading,
      email_body: config.email_body,
      cta_url: config.cta_url || 'https://www.raynatours.com',
      coupon_code: config.coupon_code || '',
      coupon_discount: config.coupon_discount || '',
      coupon_expiry: config.coupon_expiry || '',
      products: products || [],
    };

    const html = this.render(config.baseTemplate, data);
    const subject = config.subject;

    return { html, subject, baseTemplate: config.baseTemplate, segmentName };
  }

  /** Preview a segment-specific template with sample products */
  static previewForSegment(segmentName) {
    const sampleProducts = [
      {
        product_image: 'https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_300,h_200/f_auto/q_auto/https://d31sl6cu4pqx6g.cloudfront.net/City-Images/13668/dubai-city.png',
        product_category: 'Desert Safari',
        product_name: 'Premium Desert Safari with BBQ Dinner',
        product_rating: '4.8',
        product_reviews: '2,341',
        product_price: '149',
        product_strike_price: '199',
        product_url: 'https://www.raynatours.com',
        product_variant: 'Shared Transfer',
        event_date: 'Mar 20, 2026',
        adult_count: '2',
        child_count: '1',
      },
      {
        product_image: 'https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_300,h_200/f_auto/q_auto/https://d31sl6cu4pqx6g.cloudfront.net/City-Images/13236/abu-dhabi.jpg',
        product_category: 'City Tour',
        product_name: 'Burj Khalifa At The Top — 124th Floor',
        product_rating: '4.9',
        product_reviews: '5,892',
        product_price: '169',
        product_strike_price: '199',
        product_url: 'https://www.raynatours.com',
        product_variant: 'Skip the Line',
        event_date: 'Mar 22, 2026',
        adult_count: '2',
        child_count: '0',
      },
      {
        product_image: 'https://res.cloudinary.com/dzsl8v8yw/image/fetch/c_fill,w_300,h_200/f_auto/q_auto/https://d31sl6cu4pqx6g.cloudfront.net/City-Images/14644/ras-al-khaimah-city.png',
        product_category: 'Cruise',
        product_name: 'Dubai Marina Luxury Dhow Cruise with Dinner',
        product_rating: '4.7',
        product_reviews: '1,205',
        product_price: '99',
        product_strike_price: '149',
        product_url: 'https://www.raynatours.com',
        product_variant: 'Private Transfer',
        event_date: 'Mar 25, 2026',
        adult_count: '2',
        child_count: '2',
      },
    ];

    return this.renderForSegment(segmentName, {
      customerName: 'Sarah Johnson',
      products: sampleProducts,
    });
  }

  /** Load HTML from file (with caching) */
  static _loadHTML(templateId) {
    if (_templateCache[templateId]) return _templateCache[templateId];

    try {
      const filePath = join(TEMPLATE_DIR, `${templateId}.html`);
      const html = readFileSync(filePath, 'utf-8');
      _templateCache[templateId] = html;
      return html;
    } catch (err) {
      throw new Error(`Template file not found: ${templateId}.html`);
    }
  }

  /** Clear template cache (useful after editing templates) */
  static clearCache() {
    Object.keys(_templateCache).forEach(k => delete _templateCache[k]);
  }
}
