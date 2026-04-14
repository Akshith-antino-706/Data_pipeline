import { query } from '../config/database.js';
import ProductAffinityService from './ProductAffinityService.js';

/**
 * EmailRenderer — Renders HTML email templates with dynamic data
 *
 * Takes a content_template (which links to an email_html_template) and injects:
 *   - {{first_name}}, {{offer_tag}}, {{holiday_name}} — simple variable replacement
 *   - {{utm_link}} — user-specific UTM tracking link
 *   - Product affinity cards — for cart abandonment template (dynamic product injection)
 *   - Destination-specific content — for destination templates (city swap)
 */
export default class EmailRenderer {

  /**
   * Render a full HTML email for a specific user
   * @param {number} templateId - content_templates.id
   * @param {number} unifiedId - unified_contacts.unified_id
   * @param {object} extraVars - additional template variables { holiday_name, offer_tag, etc }
   * @returns {{ subject: string, html: string, plainText: string }}
   */
  static async render(templateId, unifiedId, extraVars = {}) {
    // 1. Load content template + linked HTML template
    const { rows: [tpl] } = await query(`
      SELECT ct.*, eht.html_body, eht.name as html_name, eht.type as html_type, eht.category as html_category
      FROM content_templates ct
      LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
      WHERE ct.id = $1
    `, [templateId]);

    if (!tpl) throw new Error(`Template ${templateId} not found`);

    // 2. Load user data for personalization
    let user = {};
    if (unifiedId) {
      const { rows: [u] } = await query('SELECT * FROM unified_contacts WHERE unified_id = $1', [unifiedId]);
      user = u || {};
    }

    // 3. Build variable map
    const vars = {
      first_name: user.name?.split(' ')[0] || 'there',
      full_name: user.name || 'Valued Customer',
      email: user.email || '',
      phone: user.phone || '',
      country: user.country || '',
      city: user.city || '',
      company: user.company_name || '',
      segment: user.booking_status || '',
      offer_tag: extraVars.offer_tag || user.occasion_offer_tag || '',
      holiday_name: extraVars.holiday_name || user.current_occasion || '',
      city_name: extraVars.city_name || user.city || 'Dubai',
      utm_link: extraVars.utm_link || 'https://www.raynatours.com',
      unsubscribe_link: `https://www.raynatours.com/unsubscribe?uid=${unifiedId || ''}`,
      ...extraVars,
    };

    // 4. Render subject line
    let subject = tpl.subject || '';
    for (const [key, val] of Object.entries(vars)) {
      subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }

    // 5. Render HTML body
    let html = tpl.html_body || tpl.body || '';

    // Simple variable replacement in HTML
    for (const [key, val] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }

    // 6. Inject product affinity cards if this is a dynamic/cart-abandonment template
    if (unifiedId && (tpl.html_category === 'activities' || tpl.segment_label === 'ACTIVE_ENQUIRY')) {
      html = await this.injectProductCards(html, unifiedId, vars.utm_link);
    }

    // 7. Inject UTM links into all CTA buttons
    html = this.injectUTMLinks(html, vars.utm_link);

    // 8. Plain text fallback
    const plainText = tpl.body || subject;

    return { subject, html, plainText };
  }

  /**
   * Inject user's product affinity data into HTML template
   * Replaces product card placeholders or appends product section
   */
  static async injectProductCards(html, unifiedId, baseUtmLink) {
    try {
      const { primaryProduct, recommendations } = await ProductAffinityService.getTemplateProducts(unifiedId);

      if (!primaryProduct && recommendations.length === 0) return html;

      // Build product cards HTML
      let productsHtml = '';

      if (primaryProduct) {
        productsHtml += this.buildProductCard(primaryProduct, primaryProduct.reason, baseUtmLink);
      }

      for (const rec of recommendations.slice(0, 3)) {
        productsHtml += this.buildProductCard(rec, 'Recommended for you', baseUtmLink);
      }

      // Try to inject into existing product section, or append before footer
      if (html.includes('<!-- PRODUCT_CARDS -->')) {
        html = html.replace('<!-- PRODUCT_CARDS -->', productsHtml);
      } else if (html.includes('class="products-section"')) {
        html = html.replace(/<div class="products-section">[\s\S]*?<\/div>/,
          `<div class="products-section">${productsHtml}</div>`);
      }
      // Otherwise just return as-is (static template doesn't need injection)

    } catch (err) {
      console.error('[EmailRenderer] Product injection failed:', err.message);
    }

    return html;
  }

  /**
   * Build a single product card HTML block
   */
  static buildProductCard(product, label, utmLink) {
    const price = product.price || '';
    const image = product.image || 'https://d2cazmkfw8kdtj.cloudfront.net/Tour-Images/placeholder.jpg';
    const url = product.url || utmLink;
    const name = product.name || 'Experience';
    const category = product.category || '';

    return `
      <div style="display:flex;gap:16px;padding:16px 24px;border-bottom:1px solid #F0EDE8;align-items:center;">
        <img src="${image}" alt="${name}" style="width:120px;height:80px;object-fit:cover;border-radius:6px;" />
        <div style="flex:1;">
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:4px;">${category}</div>
          <div style="font-size:15px;font-weight:600;color:#1A1A1A;margin-bottom:4px;">${name}</div>
          <div style="font-size:11px;color:#888;margin-bottom:6px;">${label}</div>
          ${price ? `<div style="font-size:16px;font-weight:700;color:#1A1A1A;">${price}</div>` : ''}
        </div>
        <a href="${url}" style="background:#1A1A1A;color:#FFFFFF;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:10px 20px;display:inline-block;">BOOK NOW →</a>
      </div>
    `;
  }

  /**
   * Replace all href links in CTA buttons with UTM-tracked versions
   */
  static injectUTMLinks(html, utmLink) {
    if (!utmLink || utmLink === 'https://www.raynatours.com') return html;

    // Replace raynatours.com links in CTA buttons with UTM link
    html = html.replace(
      /href="https:\/\/www\.raynatours\.com([^"]*)"/g,
      (match, path) => `href="${utmLink}${path}"`
    );

    return html;
  }

  /**
   * Render a preview with sample data (for Content page preview)
   */
  static async renderPreview(templateId) {
    const sampleVars = {
      first_name: 'Akshith',
      full_name: 'Akshith Kumar',
      offer_tag: 'PREVIEW20',
      holiday_name: 'Diwali',
      city_name: 'Dubai',
      utm_link: 'https://www.raynatours.com',
      unsubscribe_link: '#',
    };

    // Load template
    const { rows: [tpl] } = await query(`
      SELECT ct.*, eht.html_body, eht.name as html_name
      FROM content_templates ct
      LEFT JOIN email_html_templates eht ON eht.id = ct.html_template_id
      WHERE ct.id = $1
    `, [templateId]);

    if (!tpl) throw new Error('Template not found');

    let subject = tpl.subject || '';
    let html = tpl.html_body || tpl.body || '';

    for (const [key, val] of Object.entries(sampleVars)) {
      subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
    }

    return {
      subject,
      html,
      htmlTemplateName: tpl.html_name || null,
      channel: tpl.channel,
      segment: tpl.segment_label,
    };
  }
}
