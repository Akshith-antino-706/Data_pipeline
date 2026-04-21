import db from '../config/database.js';

/**
 * GTM (Google Tag Manager) & BigQuery Integration Service
 * Handles dataLayer events, GTM snippet generation, and BigQuery data sync
 */
class GTMService {

  /**
   * Generate GTM container snippet for embedding
   */
  static getContainerSnippet(containerId = 'GTM-RAYNA001') {
    return {
      head: `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');</script>
<!-- End Google Tag Manager -->`,
      body: `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`
    };
  }

  /**
   * Generate the user identity script that reads rid from UTM links.
   * Place this BEFORE all other dataLayer scripts on the Rayna website.
   * When a user arrives via a personalized UTM link, rid identifies them.
   * GTM stores it in a cookie/session so all subsequent events are tied to that user.
   */
  static getUserIdentityScript() {
    return `// ═══ Rayna User Identity from Personalized UTM Links ═══
// Reads 'rid' (Rayna ID) from URL and persists it for the session.
// All dataLayer events will include this user's identity.
(function() {
  var params = new URLSearchParams(window.location.search);
  var rid = params.get('rid');

  // If rid is in the URL, store it for this session
  if (rid) {
    try { sessionStorage.setItem('rayna_rid', rid); } catch(e) {}
    try { localStorage.setItem('rayna_rid', rid); } catch(e) {}
  } else {
    // Check if we already have it from a previous page
    rid = sessionStorage.getItem('rayna_rid') || localStorage.getItem('rayna_rid') || null;
  }

  // Push user identity to dataLayer
  window.dataLayer = window.dataLayer || [];
  if (rid) {
    window.dataLayer.push({
      'event': 'user_identified',
      'rayna_user_id': rid,
      'user_source': 'utm_campaign',
      'utm_source': params.get('utm_source'),
      'utm_medium': params.get('utm_medium'),
      'utm_campaign': params.get('utm_campaign'),
      'utm_content': params.get('utm_content')
    });
  }

  // Expose globally so other scripts can use it
  window.__rayna_rid = rid;
})();`;
  }

  /**
   * Generate dataLayer push scripts for various events
   */
  static getDataLayerScripts() {
    return {
      user_identity: this.getUserIdentityScript(),

      page_view: `window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  'event': 'page_view',
  'page_title': document.title,
  'page_location': window.location.href,
  'page_path': window.location.pathname,
  'user_id': window.__rayna_rid || '{{customer_id}}'
});`,

      add_to_cart: `window.dataLayer.push({
  'event': 'add_to_cart',
  'ecommerce': {
    'currency': 'AED',
    'value': {{product_price}},
    'items': [{
      'item_id': '{{product_id}}',
      'item_name': '{{product_name}}',
      'item_category': '{{product_category}}',
      'price': {{product_price}},
      'quantity': {{quantity}}
    }]
  }
});`,

      begin_checkout: `window.dataLayer.push({
  'event': 'begin_checkout',
  'ecommerce': {
    'currency': 'AED',
    'value': {{cart_total}},
    'coupon': '{{coupon_code}}',
    'items': {{cart_items_json}}
  }
});`,

      purchase: `window.dataLayer.push({
  'event': 'purchase',
  'ecommerce': {
    'transaction_id': '{{booking_id}}',
    'value': {{total_value}},
    'currency': 'AED',
    'coupon': '{{coupon_code}}',
    'shipping': 0,
    'tax': {{tax_amount}},
    'items': {{items_json}}
  }
});`,

      lead_submit: `window.dataLayer.push({
  'event': 'lead_submit',
  'lead_type': '{{lead_type}}',
  'source': '{{source}}',
  'product_interest': '{{product_name}}',
  'rayna_user_id': window.__rayna_rid || null,
  'utm_source': '{{utm_source}}',
  'utm_medium': '{{utm_medium}}',
  'utm_campaign': '{{utm_campaign}}'
});`,

      whatsapp_click: `window.dataLayer.push({
  'event': 'whatsapp_click',
  'click_location': '{{click_location}}',
  'product_context': '{{product_name}}',
  'user_id': '{{customer_id}}'
});`,

      cart_abandonment: `window.dataLayer.push({
  'event': 'cart_abandonment',
  'ecommerce': {
    'currency': 'AED',
    'value': {{cart_total}},
    'items': {{cart_items_json}}
  },
  'abandonment_step': '{{step}}',
  'time_on_page': {{seconds_on_page}}
});`,

      exit_intent: `document.addEventListener('mouseleave', function(e) {
  if (e.clientY < 0) {
    window.dataLayer.push({
      'event': 'exit_intent',
      'page_type': '{{page_type}}',
      'cart_value': {{cart_value}},
      'items_in_cart': {{item_count}}
    });
  }
});`,

      view_item: `window.dataLayer.push({
  'event': 'view_item',
  'ecommerce': {
    'currency': 'AED',
    'value': {{product_price}},
    'items': [{
      'item_id': '{{product_id}}',
      'item_name': '{{product_name}}',
      'item_category': '{{product_category}}',
      'price': {{product_price}}
    }]
  }
});`,

      email_open: `// Pixel-based tracking — injected into email template
// <img src="https://api.rayna.com/track/email-open?cid={{campaign_id}}&uid={{customer_id}}" width="1" height="1" />`,

      scroll_depth: `let scrollThresholds = [25, 50, 75, 100];
let fired = {};
window.addEventListener('scroll', function() {
  let depth = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
  scrollThresholds.forEach(function(t) {
    if (depth >= t && !fired[t]) {
      fired[t] = true;
      window.dataLayer.push({ 'event': 'scroll_depth', 'depth_threshold': t, 'page_path': window.location.pathname });
    }
  });
});`
    };
  }

  /**
   * Record a GTM event in our database.
   * Stores both structured fields and the full raw payload.
   */
  static async recordEvent(body) {
    const { eventName, customerId, sessionId, pageUrl, pageTitle, eventCategory, eventAction, eventLabel, eventValue, ecommerceData, utmSource, utmMedium, utmCampaign, utmContent, deviceType, browser, country, city, rid, unifiedId } = body;

    // Resolve unified_id: explicit `rid` / `unifiedId` in payload wins, else try pulling from pageUrl,
    // else fall back to matching customerId (email) against unified_contacts.
    let resolvedUnifiedId = parseInt(rid || unifiedId) || null;
    if (!resolvedUnifiedId && pageUrl) {
      const m = /[?&]rid=(\d+)/.exec(pageUrl);
      if (m) resolvedUnifiedId = parseInt(m[1]);
    }
    if (!resolvedUnifiedId && customerId && customerId.includes('@')) {
      const { rows: [uc] } = await db.query(
        'SELECT unified_id FROM unified_contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [customerId]
      );
      if (uc) resolvedUnifiedId = uc.unified_id;
    }
    // Final fallback: borrow unified_id from a recent event in the same session (last 2 hrs)
    if (!resolvedUnifiedId && sessionId) {
      const { rows: [prev] } = await db.query(
        `SELECT unified_id FROM gtm_events
         WHERE session_id = $1 AND unified_id IS NOT NULL AND created_at > NOW() - INTERVAL '2 hours'
         ORDER BY created_at DESC LIMIT 1`,
        [sessionId]
      );
      if (prev) resolvedUnifiedId = prev.unified_id;
    }

    const { rows: [event] } = await db.query(`
      INSERT INTO gtm_events (event_name, customer_id, session_id, page_url, page_title, event_category, event_action, event_label, event_value, ecommerce_data, utm_source, utm_medium, utm_campaign, utm_content, device_type, browser, country, city, unified_id, raw_payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `, [eventName, customerId, sessionId, pageUrl, pageTitle, eventCategory, eventAction, eventLabel, eventValue, JSON.stringify(ecommerceData || {}), utmSource, utmMedium, utmCampaign, utmContent, deviceType, browser, country, city, resolvedUnifiedId, JSON.stringify(body)]);
    return event;
  }

  /**
   * Get event analytics
   */
  static async getEventAnalytics({ eventName, dateFrom, dateTo, limit = 100 } = {}) {
    let where = '1=1';
    const params = [];
    if (eventName) { params.push(eventName); where += ` AND event_name = $${params.length}`; }
    if (dateFrom) { params.push(dateFrom); where += ` AND created_at >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); where += ` AND created_at <= $${params.length}`; }

    const { rows: summary } = await db.query(`
      SELECT event_name, COUNT(*) AS event_count,
        COUNT(DISTINCT customer_id) AS unique_users,
        SUM(event_value) AS total_value,
        DATE_TRUNC('day', created_at) AS day
      FROM gtm_events
      WHERE ${where}
      GROUP BY event_name, DATE_TRUNC('day', created_at)
      ORDER BY day DESC, event_count DESC
      LIMIT $${params.length + 1}
    `, [...params, limit]);

    const { rows: topEvents } = await db.query(`
      SELECT event_name, COUNT(*) AS count,
        COUNT(DISTINCT customer_id) AS unique_users,
        SUM(event_value) AS total_value
      FROM gtm_events WHERE ${where}
      GROUP BY event_name
      ORDER BY count DESC
    `, params);

    return { daily: summary, top_events: topEvents };
  }

  /**
   * Get BigQuery-compatible export data
   */
  static async getExportData({ dateFrom, dateTo, limit = 1000 } = {}) {
    let where = '1=1';
    const params = [];
    if (dateFrom) { params.push(dateFrom); where += ` AND ge.created_at >= $${params.length}`; }
    if (dateTo) { params.push(dateTo); where += ` AND ge.created_at <= $${params.length}`; }

    const { rows } = await db.query(`
      SELECT ge.*,
        c.first_name, c.last_name, c.email, c.nationality,
        c.rfm_segment_label, c.rfm_total_score, c.total_bookings, c.total_revenue
      FROM gtm_events ge
      LEFT JOIN customers c ON c.customer_id = ge.customer_id
      WHERE ${where}
      ORDER BY ge.created_at DESC
      LIMIT $${params.length + 1}
    `, [...params, limit]);

    return rows;
  }

  /**
   * Get Special Occasions with active campaigns
   */
  static async getSpecialOccasions() {
    const { rows } = await db.query(`
      SELECT so.*,
        c.code AS coupon_code, c.discount_type, c.discount_value, c.is_active AS coupon_active
      FROM special_occasions so
      LEFT JOIN coupons c ON c.code = so.discount_code
      ORDER BY so.start_date ASC
    `);
    return rows;
  }

  static async createSpecialOccasion({ name, occasionType, startDate, endDate, targetMarkets, discountCode, campaignTheme }) {
    const { rows: [occasion] } = await db.query(`
      INSERT INTO special_occasions (name, occasion_type, start_date, end_date, target_markets, discount_code, campaign_theme)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [name, occasionType, startDate, endDate, targetMarkets, discountCode, campaignTheme]);
    return occasion;
  }
}

export default GTMService;
