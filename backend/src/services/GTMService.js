import db from '../config/database.js';

/**
 * GTM (Google Tag Manager) & BigQuery Integration Service
 * Handles dataLayer events, GTM snippet generation, and BigQuery data sync
 */
class GTMService {

  /**
   * Generate GTM container snippet for embedding
   */
  static getContainerSnippet(containerId = process.env.GTM_CONTAINER_ID || 'GTM-RAYNA001') {
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
   * Generate dataLayer push scripts for various events.
   *
   * All scripts are executable JavaScript — no {{placeholders}}.
   * They use helper functions to read product/cart data from the page.
   *
   * Integration pattern for the Rayna website:
   *   1. Include user_identity script in layout.tsx (runs on every page)
   *   2. Call window.__rayna.trackAddToCart(product) from "Add to Cart" button handlers
   *   3. Call window.__rayna.trackCheckout(cart) from checkout page
   *   4. Call window.__rayna.trackPurchase(booking) from booking confirmation page
   *   5. Scroll depth and page_view fire automatically
   *
   * Each event also POSTs to the backend /api/v3/gtm/events for server-side storage.
   */
  static getDataLayerScripts() {
    const backendUrl = process.env.TRACKING_BASE_URL || process.env.BACKEND_URL || 'http://localhost:3001';

    return {
      user_identity: this.getUserIdentityScript(),

      page_view: `// ═══ Page View — fires automatically on every page load ═══
(function() {
  window.dataLayer = window.dataLayer || [];
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var payload = {
    'event': 'page_view',
    'page_title': document.title,
    'page_location': window.location.href,
    'page_path': window.location.pathname,
    'rayna_user_id': rid
  };
  window.dataLayer.push(payload);

  // Also POST to backend for server-side storage
  if (navigator.sendBeacon) {
    navigator.sendBeacon('${backendUrl}/api/v3/gtm/events', JSON.stringify({
      eventName: 'page_view',
      pageUrl: window.location.href,
      pageTitle: document.title,
      rid: rid,
      sessionId: sessionStorage.getItem('rayna_session') || Math.random().toString(36).slice(2),
      deviceType: /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      browser: navigator.userAgent.split(' ').pop()
    }));
  }
})();`,

      add_to_cart: `// ═══ Add to Cart — call window.__rayna.trackAddToCart(product) ═══
// product = { id, name, category, price, quantity, currency }
window.__rayna = window.__rayna || {};
window.__rayna.trackAddToCart = function(product) {
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var p = product || {};
  var payload = {
    'event': 'add_to_cart',
    'rayna_user_id': rid,
    'ecommerce': {
      'currency': p.currency || 'AED',
      'value': Number(p.price) || 0,
      'items': [{
        'item_id': String(p.id || ''),
        'item_name': p.name || '',
        'item_category': p.category || '',
        'price': Number(p.price) || 0,
        'quantity': Number(p.quantity) || 1
      }]
    }
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);

  // POST to backend
  fetch('${backendUrl}/api/v3/gtm/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'add_to_cart', rid: rid, pageUrl: window.location.href,
      ecommerceData: payload.ecommerce, sessionId: sessionStorage.getItem('rayna_session') || null })
  }).catch(function() {});
};`,

      begin_checkout: `// ═══ Begin Checkout — call window.__rayna.trackCheckout(cart) ═══
// cart = { total, coupon, items: [{ id, name, category, price, quantity }] }
window.__rayna = window.__rayna || {};
window.__rayna.trackCheckout = function(cart) {
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var c = cart || {};
  var payload = {
    'event': 'begin_checkout',
    'rayna_user_id': rid,
    'ecommerce': {
      'currency': 'AED',
      'value': Number(c.total) || 0,
      'coupon': c.coupon || '',
      'items': Array.isArray(c.items) ? c.items.map(function(i) {
        return { item_id: String(i.id || ''), item_name: i.name || '', item_category: i.category || '', price: Number(i.price) || 0, quantity: Number(i.quantity) || 1 };
      }) : []
    }
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);

  fetch('${backendUrl}/api/v3/gtm/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'begin_checkout', rid: rid, pageUrl: window.location.href,
      ecommerceData: payload.ecommerce, sessionId: sessionStorage.getItem('rayna_session') || null })
  }).catch(function() {});
};`,

      purchase: `// ═══ Purchase — call window.__rayna.trackPurchase(booking) ═══
// booking = { bookingId, total, coupon, tax, items: [{ id, name, category, price, quantity }] }
window.__rayna = window.__rayna || {};
window.__rayna.trackPurchase = function(booking) {
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var b = booking || {};
  var payload = {
    'event': 'purchase',
    'rayna_user_id': rid,
    'ecommerce': {
      'transaction_id': String(b.bookingId || ''),
      'value': Number(b.total) || 0,
      'currency': 'AED',
      'coupon': b.coupon || '',
      'shipping': 0,
      'tax': Number(b.tax) || 0,
      'items': Array.isArray(b.items) ? b.items.map(function(i) {
        return { item_id: String(i.id || ''), item_name: i.name || '', item_category: i.category || '', price: Number(i.price) || 0, quantity: Number(i.quantity) || 1 };
      }) : []
    }
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);

  fetch('${backendUrl}/api/v3/gtm/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'purchase', rid: rid, pageUrl: window.location.href,
      ecommerceData: payload.ecommerce, sessionId: sessionStorage.getItem('rayna_session') || null })
  }).catch(function() {});
};`,

      lead_submit: `// ═══ Lead Submit — call window.__rayna.trackLead(lead) ═══
// lead = { type, source, productName }
window.__rayna = window.__rayna || {};
window.__rayna.trackLead = function(lead) {
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var params = new URLSearchParams(window.location.search);
  var l = lead || {};
  var payload = {
    'event': 'lead_submit',
    'lead_type': l.type || 'enquiry',
    'source': l.source || window.location.pathname,
    'product_interest': l.productName || '',
    'rayna_user_id': rid,
    'utm_source': params.get('utm_source') || sessionStorage.getItem('rayna_utm_source') || '',
    'utm_medium': params.get('utm_medium') || sessionStorage.getItem('rayna_utm_medium') || '',
    'utm_campaign': params.get('utm_campaign') || sessionStorage.getItem('rayna_utm_campaign') || ''
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);

  fetch('${backendUrl}/api/v3/gtm/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'lead_submit', rid: rid, pageUrl: window.location.href,
      eventCategory: 'lead', eventAction: l.type || 'enquiry', eventLabel: l.productName || '',
      sessionId: sessionStorage.getItem('rayna_session') || null })
  }).catch(function() {});
};`,

      whatsapp_click: `// ═══ WhatsApp Click — call window.__rayna.trackWhatsApp(context) ═══
// context = { location, productName }
window.__rayna = window.__rayna || {};
window.__rayna.trackWhatsApp = function(context) {
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var ctx = context || {};
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    'event': 'whatsapp_click',
    'click_location': ctx.location || window.location.pathname,
    'product_context': ctx.productName || '',
    'rayna_user_id': rid
  });

  fetch('${backendUrl}/api/v3/gtm/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'whatsapp_click', rid: rid, pageUrl: window.location.href,
      eventCategory: 'engagement', eventAction: 'whatsapp_click', eventLabel: ctx.productName || '',
      sessionId: sessionStorage.getItem('rayna_session') || null })
  }).catch(function() {});
};`,

      view_item: `// ═══ View Item — call window.__rayna.trackViewItem(product) ═══
// product = { id, name, category, price, currency }
window.__rayna = window.__rayna || {};
window.__rayna.trackViewItem = function(product) {
  var rid = window.__rayna_rid || sessionStorage.getItem('rayna_rid') || null;
  var p = product || {};
  var payload = {
    'event': 'view_item',
    'rayna_user_id': rid,
    'ecommerce': {
      'currency': p.currency || 'AED',
      'value': Number(p.price) || 0,
      'items': [{
        'item_id': String(p.id || ''),
        'item_name': p.name || '',
        'item_category': p.category || '',
        'price': Number(p.price) || 0
      }]
    }
  };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);

  fetch('${backendUrl}/api/v3/gtm/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'view_item', rid: rid, pageUrl: window.location.href,
      ecommerceData: payload.ecommerce, sessionId: sessionStorage.getItem('rayna_session') || null })
  }).catch(function() {});
};`,

      email_open: `// Pixel-based tracking — automatically injected into email HTML by the backend.
// No script needed on the website. The open pixel is:
// <img src="${backendUrl}/api/track/email-send/open/{logId}" width="1" height="1" />`,

      scroll_depth: `// ═══ Scroll Depth — fires automatically at 25%, 50%, 75%, 100% ═══
(function() {
  var scrollThresholds = [25, 50, 75, 100];
  var fired = {};
  window.addEventListener('scroll', function() {
    var depth = Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100);
    scrollThresholds.forEach(function(t) {
      if (depth >= t && !fired[t]) {
        fired[t] = true;
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ 'event': 'scroll_depth', 'depth_threshold': t, 'page_path': window.location.pathname, 'rayna_user_id': window.__rayna_rid || null });
      }
    });
  });
})();`
    };
  }

  /**
   * Get a ready-to-deploy tracking bundle for raynatours.com.
   * Returns { headScript, bodyScript, instructions } that should be
   * pasted into the Rayna frontend's layout.tsx.
   */
  static getTrackingBundle() {
    const containerId = process.env.GTM_CONTAINER_ID || 'GTM-RAYNA001';
    const snippet = this.getContainerSnippet(containerId);
    const identityScript = this.getUserIdentityScript();
    const scripts = this.getDataLayerScripts();

    const headScript = `${snippet.head}
<script>
// ═══ Session ID for event correlation ═══
(function() {
  if (!sessionStorage.getItem('rayna_session')) {
    sessionStorage.setItem('rayna_session', Date.now().toString(36) + Math.random().toString(36).slice(2));
  }
})();

// ═══ Persist UTM params for the session ═══
(function() {
  var params = new URLSearchParams(window.location.search);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function(k) {
    var v = params.get(k);
    if (v) sessionStorage.setItem('rayna_' + k, v);
  });
})();

${identityScript}
</script>`;

    const bodyScript = snippet.body;

    // Auto-fire scripts (page_view + scroll_depth)
    const autoScripts = `<script>
${scripts.page_view}

${scripts.scroll_depth}
</script>`;

    // Event tracking library (add_to_cart, checkout, purchase, etc.)
    const eventLibrary = `<script>
${scripts.add_to_cart}

${scripts.begin_checkout}

${scripts.purchase}

${scripts.lead_submit}

${scripts.whatsapp_click}

${scripts.view_item}
</script>`;

    return {
      headScript,
      bodyScript,
      autoScripts,
      eventLibrary,
      containerId,
      instructions: [
        '1. Add headScript inside <head> tag in layout.tsx',
        '2. Add bodyScript right after <body> tag in layout.tsx',
        '3. Add autoScripts before </body> tag in layout.tsx (fires page_view + scroll_depth automatically)',
        '4. Add eventLibrary before </body> tag in layout.tsx (exposes window.__rayna.trackAddToCart, etc.)',
        '5. In your "Add to Cart" button handler, call: window.__rayna.trackAddToCart({ id, name, category, price, quantity })',
        '6. On checkout page load, call: window.__rayna.trackCheckout({ total, coupon, items: [...] })',
        '7. On booking confirmation page, call: window.__rayna.trackPurchase({ bookingId, total, items: [...] })',
        '8. On WhatsApp click, call: window.__rayna.trackWhatsApp({ location, productName })',
        '9. On enquiry form submit, call: window.__rayna.trackLead({ type, source, productName })',
      ],
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
        'SELECT id FROM unified_contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [customerId]
      );
      if (uc) resolvedUnifiedId = uc.id;
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

    // customer_id column is bigint — only insert numeric values, not emails/strings
    const numericCustomerId = /^\d+$/.test(customerId) ? parseInt(customerId) : null;

    const { rows: [event] } = await db.query(`
      INSERT INTO gtm_events (event_name, customer_id, session_id, page_url, page_title, event_category, event_action, event_label, event_value, ecommerce_data, utm_source, utm_medium, utm_campaign, utm_content, device_type, browser, country, city, unified_id, raw_payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `, [eventName, numericCustomerId, sessionId, pageUrl, pageTitle, eventCategory, eventAction, eventLabel, eventValue, JSON.stringify(ecommerceData || {}), utmSource, utmMedium, utmCampaign, utmContent, deviceType, browser, country, city, resolvedUnifiedId, JSON.stringify(body)]);
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
