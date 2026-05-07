import { query } from '../config/database.js';
import ProductAffinityService from './ProductAffinityService.js';
import PopularityService from './PopularityService.js';

/**
 * EmailRenderer — Renders HTML email templates with dynamic data
 *
 * Takes a content_template (which links to an email_html_template) and injects:
 *   - {{first_name}}, {{offer_tag}}, {{holiday_name}} — simple variable replacement
 *   - {{utm_link}} — user-specific UTM tracking link
 *   - Product affinity cards — for cart abandonment template (dynamic product injection)
 *   - Destination-specific content — for destination templates (city swap)
 *   - Popular-product slots — for templates marked uses_popular_products=true,
 *     filled from a frozen popularity_snapshots row keyed by (journey_id, node_id, run_id)
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

    // 6. Inject product affinity cards ONLY for dynamic/cart-abandonment templates.
    //    Static templates (Day 1–5) must render exactly as designed.
    if (unifiedId && (tpl.html_type === 'dynamic' || tpl.html_category === 'cart_abandonment')) {
      html = await this.injectProductCards(html, unifiedId, vars.utm_link);
    }

    // 7. Append UTM params to all raynatours.com links (preserves paths).
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
   * Append UTM query params (and rid) to every raynatours.com link, preserving paths.
   * Accepts either:
   *   - A per-user tracking URL (e.g. https://track.rayna.com/u/<token>) — used as-is for CTAs
   *     that should hit the redirect-tracker; other links get UTM params appended.
   *   - A full UTM URL (e.g. https://www.raynatours.com/activities?utm_source=...) — we extract
   *     its query string and append it to each link.
   * Links that already carry utm_source are left untouched.
   */
  static injectUTMLinks(html, utmLink) {
    if (!utmLink) return html;

    // Extract the UTM query string from the provided link (if any).
    let utmQuery = '';
    try {
      const u = new URL(utmLink);
      const params = new URLSearchParams();
      for (const [k, v] of u.searchParams) {
        if (k.startsWith('utm_') || k === 'rid') params.append(k, v);
      }
      utmQuery = params.toString();
    } catch { /* utmLink is not a full URL (e.g. tracker path) — nothing to extract */ }

    if (!utmQuery) return html;

    return html.replace(
      /href="(https?:\/\/(?:www\.)?raynatours\.com[^"]*)"/g,
      (_m, url) => {
        if (/[?&]utm_source=/.test(url)) return `href="${url}"`;
        const sep = url.includes('?') ? '&' : '?';
        return `href="${url}${sep}${utmQuery}"`;
      }
    );
  }

  /**
   * Render an HTML email for a single journey entry, expanding any
   * `<!-- SLOT:product_grid ... -->` markers from the run's popularity snapshot.
   *
   * @param {object} args
   * @param {number} args.htmlTemplateId  email_html_templates.id
   * @param {number} args.unifiedId       unified_contacts.unified_id (for personalization + UTM rid)
   * @param {number} args.journeyId       journey_flows.id (used as snapshot key)
   * @param {string} args.nodeId          journey node id (used as snapshot key)
   * @param {string} args.runId           journey run uuid (used as snapshot key)
   * @param {object} [args.extraVars]     additional {{var}} substitutions
   * @returns {{ subject, html, plainText, slotsFilled }}
   */
  static async renderForJourneyNode({ htmlTemplateId, unifiedId, journeyId, nodeId, runId, extraVars = {} }) {
    const { rows: [tpl] } = await query(
      `SELECT id, name, html_body, preview_text,
              uses_popular_products, product_type, product_limit
         FROM email_html_templates WHERE id = $1`,
      [htmlTemplateId]
    );
    if (!tpl) throw new Error(`html_template ${htmlTemplateId} not found`);

    let user = {};
    if (unifiedId) {
      const { rows: [u] } = await query(
        `SELECT unified_id, name, email, phone, country, city, company_name,
                booking_status, occasion_offer_tag, current_occasion
           FROM unified_contacts WHERE unified_id = $1`,
        [unifiedId]
      );
      user = u || {};
    }

    const utmLink = extraVars.utm_link
      || this._buildUtmLink({ journeyId, nodeId, htmlTemplateName: tpl.name, unifiedId });

    const vars = {
      first_name:       user.name?.split(' ')[0] || 'there',
      full_name:        user.name || 'Valued Traveller',
      email:            user.email || '',
      phone:            user.phone || '',
      country:          user.country || '',
      city:             user.city || '',
      offer_tag:        extraVars.offer_tag    || user.occasion_offer_tag || '',
      holiday_name:     extraVars.holiday_name || user.current_occasion   || '',
      city_name:        extraVars.city_name    || user.city || 'Dubai',
      utm_link:         utmLink,
      unsubscribe_link: `https://www.raynatours.com/unsubscribe?uid=${unifiedId || ''}`,
      ...extraVars,
    };

    let subject = (extraVars.subject_override || tpl.preview_text || tpl.name || '').toString();
    let html    = tpl.html_body || '';

    for (const [k, v] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
      subject = subject.replace(re, v);
      html    = html.replace(re, v);
    }

    let slotsFilled = 0;
    if (tpl.uses_popular_products && journeyId && nodeId && runId) {
      // Hero image first — it pulls from the same snapshot but is rendered as
      // a full-width <img> using the #1 ranked product's image, not a card grid.
      const heroOut = await this.expandHeroImageSlots({
        html, journeyId, nodeId, runId, fallbackProductType: tpl.product_type, utmLink,
      });
      html = heroOut.html;
      slotsFilled += heroOut.slotsFilled;

      const { html: filled, slotsFilled: n } = await this.expandProductSlots({
        html, journeyId, nodeId, runId, fallbackProductType: tpl.product_type, utmLink,
      });
      html = filled;
      slotsFilled += n;
    }

    html = this.injectUTMLinks(html, utmLink);

    return { subject, html, plainText: subject, slotsFilled };
  }

  /**
   * Replace every `<!-- SLOT:product_grid ... -->` comment in `html` with a
   * grid of product cards built from the journey-run popularity snapshot.
   *
   * Slot syntax (HTML comment):
   *   <!-- SLOT:product_grid product_type="activity" theme="thrill" count="4" cols="2" -->
   *
   * Attributes:
   *   product_type   required — must match a snapshot row's product_type
   *   theme          optional — pulls only rows whose theme matches
   *   count          how many cards to render (defaults to all matching rows)
   *   cols           grid width (defaults to 2)
   */
  static async expandProductSlots({ html, journeyId, nodeId, runId, fallbackProductType, utmLink }) {
    const slotRe = /<!--\s*SLOT:product_grid\s+([^>]*?)-->/g;
    const matches = [...html.matchAll(slotRe)];
    if (matches.length === 0) return { html, slotsFilled: 0 };

    // Group lookups by product_type so we hit popularity_snapshots once per type.
    const types = new Set();
    const parsedSlots = matches.map(m => {
      const attrs = this._parseSlotAttrs(m[1]);
      const productType = attrs.product_type || fallbackProductType;
      types.add(productType);
      return { match: m[0], productType, theme: attrs.theme || null,
               count: attrs.count ? parseInt(attrs.count) : null,
               cols: attrs.cols ? parseInt(attrs.cols) : 2 };
    });

    const snapshots = new Map();          // productType → Map(theme → rows)
    for (const t of types) {
      const grouped = await PopularityService.getSnapshot({ journeyId, nodeId, runId, productType: t });
      snapshots.set(t, grouped);
    }

    let out = html;
    let filled = 0;
    for (const slot of parsedSlots) {
      const grouped = snapshots.get(slot.productType);
      const themeKey = slot.theme || '_default';
      let rows = grouped?.get(themeKey)
              || grouped?.get('_default')
              || [];
      if (slot.count) rows = rows.slice(0, slot.count);

      const grid = rows.length > 0
        ? this._buildProductGrid(rows, slot.cols, utmLink)
        : '';                              // empty snapshot → drop the marker silently

      out = out.replace(slot.match, grid);
      if (rows.length > 0) filled++;
    }

    return { html: out, slotsFilled: filled };
  }

  /**
   * Build the deterministic UTM link for a journey node send.
   *
   *   utm_source   = email
   *   utm_medium   = journey
   *   utm_campaign = general_broadcast      (sliced by /utm_campaign in GA)
   *   utm_content  = j<journeyId>_<nodeId>  (per-node attribution)
   *   utm_term     = <html-template-slug>   (theme — activities/cruise/etc.)
   *   rid          = <unifiedId>            (recipient id for click tracking)
   *
   * Per-node UTMs let GA/UTM dashboards split open/click/booking conversion
   * by node — which day in the drip is actually driving the booking.
   */
  static _buildUtmLink({ journeyId, nodeId, htmlTemplateName, unifiedId, base = 'https://www.raynatours.com/' }) {
    const slug = (s) => String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const params = new URLSearchParams({
      utm_source:   'email',
      utm_medium:   'journey',
      utm_campaign: 'general_broadcast',
    });
    if (journeyId && nodeId) params.set('utm_content', `j${journeyId}_${slug(nodeId)}`);
    if (htmlTemplateName)    params.set('utm_term',    slug(htmlTemplateName));
    if (unifiedId)           params.set('rid',         String(unifiedId));
    return `${base}${base.includes('?') ? '&' : '?'}${params.toString()}`;
  }

  /**
   * Replace every `<!-- SLOT:hero_image ... -->` comment with an <img> tag
   * built from the #1-ranked product in the run's popularity snapshot. The
   * marker pulls from the same snapshot a SLOT:product_grid would — so the
   * hero image is always the same cruise/holiday/activity that ranks first
   * in the cards below it. No extra LLM call.
   *
   * Slot syntax:
   *   <!-- SLOT:hero_image product_type="cruise" height="280" -->
   *
   * Attributes:
   *   product_type   required — must match a snapshot row's product_type
   *   theme          optional — pulls only rows whose theme matches
   *   height         optional — px height of the hero band (default 280)
   *   alt            optional — override alt text (default = product name)
   */
  static async expandHeroImageSlots({ html, journeyId, nodeId, runId, fallbackProductType, utmLink }) {
    const slotRe = /<!--\s*SLOT:hero_image\s+([^>]*?)-->/g;
    const matches = [...html.matchAll(slotRe)];
    if (matches.length === 0) return { html, slotsFilled: 0 };

    const types = new Set();
    const parsed = matches.map(m => {
      const a = this._parseSlotAttrs(m[1]);
      const productType = a.product_type || fallbackProductType;
      types.add(productType);
      return { match: m[0], productType, theme: a.theme || null,
               height: parseInt(a.height || '280'), alt: a.alt || null };
    });

    const snapshots = new Map();
    for (const t of types) {
      const grouped = await PopularityService.getSnapshot({ journeyId, nodeId, runId, productType: t });
      snapshots.set(t, grouped);
    }

    const utmQs = this._extractUtmQuery(utmLink);
    const linkWithUtm = (url) => {
      if (!url) return '#';
      if (/[?&]utm_source=/.test(url)) return url;
      if (!utmQs) return url;
      return url + (url.includes('?') ? '&' : '?') + utmQs;
    };

    let out = html;
    let filled = 0;
    for (const slot of parsed) {
      const grouped = snapshots.get(slot.productType);
      const themeKey = slot.theme || '_default';
      const rows = grouped?.get(themeKey) || grouped?.get('_default') || [];
      const top = rows[0];
      if (!top || !top.image_url) {
        // No snapshot row → drop the marker silently (keeps the rest of the
        // template intact even if popularity backfill failed for this node).
        out = out.replace(slot.match, '');
        continue;
      }

      const altText = this._escapeAttr(slot.alt || top.name || 'Featured');
      const linked  = this._escapeAttr(linkWithUtm(top.product_url));
      const heroHtml = `<a href="${linked}" style="display: block; line-height: 0;"><img src="${this._escapeAttr(top.image_url)}" alt="${altText}" width="600" style="display: block; width: 100%; max-width: 600px; height: ${slot.height}px; object-fit: cover; border: 0;" /></a>`;
      out = out.replace(slot.match, heroHtml);
      filled++;
    }

    return { html: out, slotsFilled: filled };
  }

  // ── slot helpers ────────────────────────────────────────────────

  static _parseSlotAttrs(attrString) {
    const out = {};
    const re = /(\w+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(attrString)) !== null) out[m[1]] = m[2];
    return out;
  }

  /**
   * Build the same 2×N table-card grid the original day5 / day4 / day2 templates
   * used. Pixel-identical chrome — only the per-card data is supplied here.
   */
  static _buildProductGrid(rows, cols, utmLink) {
    const utmQs = this._extractUtmQuery(utmLink);
    const linkWithUtm = (url) => {
      if (!url) return '#';
      if (/[?&]utm_source=/.test(url)) return url;
      if (!utmQs) return url;
      return url + (url.includes('?') ? '&' : '?') + utmQs;
    };

    const card = (r) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; height: 280px">
      <tr>
        <td valign="bottom" style="height: 220px; background-color: #101010; background-image: linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url(&quot;${this._escapeAttr(r.image_url || '')}&quot;); background-size: cover; background-position: center; background-repeat: no-repeat; padding: 40px 20px 20px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%">
            <tr><td align="left" style="font-family: Arial, Helvetica, sans-serif; font-size: 8px; line-height: 12px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; color: #ffffff;"><span style="opacity: 0.8">${this._escape(r.category || '')}${r.location ? ' - ' + this._escape(r.location) : ''}</span></td></tr>
            <tr><td align="left" style="font-family: Georgia, &quot;Times New Roman&quot;, serif; font-size: 20px; line-height: 30px; font-weight: 400; color: #ffffff; padding-top: 6px;">${this._escape(r.name || '')}</td></tr>
            <tr><td align="left" style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 16px; color: #e0e0e0; padding-top: 6px;">${this._escape(r.duration || '')}</td></tr>
            <tr><td align="left" style="font-family: Georgia, &quot;Times New Roman&quot;, serif; font-size: 18px; line-height: 22px; font-weight: 700; color: #ffffff; padding-top: 6px;">${this._escape(r.price || '')}</td></tr>
            <tr><td align="left" style="padding-top: 10px"><a href="${this._escapeAttr(linkWithUtm(r.product_url))}" style="font-family: Arial, Helvetica, sans-serif; font-size: 9px; line-height: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #1a1a1a; text-decoration: none; background-color: #ffffff; display: inline-block; padding: 8px 14px;">Book Now -&gt;</a></td></tr>
          </table>
        </td>
      </tr>
    </table>`;

    const colWidth = `${Math.floor(100 / cols)}%`;
    const tdCell = (r) => `<td width="${colWidth}" valign="top" style="padding: 0 5px 10px 5px">${card(r)}</td>`;

    let body = '';
    for (let i = 0; i < rows.length; i += cols) {
      const cells = rows.slice(i, i + cols).map(tdCell).join('');
      body += `<tr>${cells}</tr>`;
    }

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse">${body}</table>`;
  }

  static _extractUtmQuery(utmLink) {
    if (!utmLink) return '';
    try {
      const u = new URL(utmLink);
      const p = new URLSearchParams();
      for (const [k, v] of u.searchParams) {
        if (k.startsWith('utm_') || k === 'rid') p.append(k, v);
      }
      return p.toString();
    } catch {
      return '';
    }
  }

  static _escape(s)     { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  static _escapeAttr(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

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
