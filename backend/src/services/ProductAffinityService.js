import { query } from '../config/database.js';

/**
 * ProductAffinityService — Syncs product catalog + builds per-user product affinity
 *
 * Product sync: Pulls from Rayna product API (data-projects-flax.vercel.app)
 * Affinity scoring: Weights GTM events to score products per user
 *
 * Weights:
 *   purchase    = 100 (strongest signal — they bought it)
 *   checkout    = 50  (strong intent — started paying)
 *   add_to_cart = 25  (medium intent — added to cart)
 *   wishlist    = 15  (soft intent — saved for later)
 *   view_item   = 5   (browsing — weakest but most common)
 *
 * Score = (purchase_count * 100) + (checkout_count * 50) + (cart_count * 25) + (wishlist_count * 15) + (view_count * 5)
 */

const PRODUCT_API = 'https://data-projects-flax.vercel.app/api/generate-feed?format=json';

const AFFINITY_WEIGHTS = {
  purchase: 100,
  begin_checkout: 50,
  add_to_cart: 25,
  add_to_wishlist: 15,
  view_item: 5,
};

export default class ProductAffinityService {

  // ── Product Catalog Sync ──────────────────────────────────────

  /**
   * Pull all products from Rayna product API and upsert into local products table
   */
  static async syncProducts() {
    console.log('[ProductSync] Fetching product catalog...');
    const start = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(PRODUCT_API, { signal: controller.signal });
      if (!res.ok) throw new Error(`Product API returned ${res.status}`);

      const data = await res.json();
      const products = data.products || [];
      console.log(`[ProductSync] Received ${products.length} products`);

      if (products.length === 0) return { synced: 0 };

      // Deduplicate by productId (API may return dupes)
      const seen = new Set();
      const uniqueProducts = products.filter(p => {
        const id = p.productId || p.name;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      console.log(`[ProductSync] ${products.length} → ${uniqueProducts.length} after dedup`);

      // Batch upsert
      let synced = 0;
      const BATCH = 100;

      for (let i = 0; i < uniqueProducts.length; i += BATCH) {
        const batch = uniqueProducts.slice(i, i + BATCH);
        const values = [];
        const placeholders = batch.map((p, idx) => {
          const base = idx * 12;
          values.push(
            p.productId || (900000 + i + idx), p.name, p.type, p.item_group_id,
            p.normalPrice, p.salePrice, p.currency || 'AED',
            p.country, p.city, p.cityId,
            p.url, p.image
          );
          return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12})`;
        });

        await query(`
          INSERT INTO products (product_id, name, type, category, normal_price, sale_price, currency, country, city, city_id, url, image_url)
          VALUES ${placeholders.join(',')}
          ON CONFLICT (product_id) DO UPDATE SET
            name = EXCLUDED.name, type = EXCLUDED.type, category = EXCLUDED.category,
            normal_price = EXCLUDED.normal_price, sale_price = EXCLUDED.sale_price,
            country = EXCLUDED.country, city = EXCLUDED.city, city_id = EXCLUDED.city_id,
            url = EXCLUDED.url, image_url = EXCLUDED.image_url, synced_at = NOW()
        `, values);

        synced += batch.length;
      }

      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[ProductSync] Done — ${synced} products synced in ${duration}s`);
      return { synced, duration };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Affinity Scoring ──────────────────────────────────────────

  /**
   * Build/refresh user product affinity from GTM + GA4 events
   * Scans for view_item, add_to_cart, begin_checkout, purchase, add_to_wishlist
   * and aggregates per unified_id + product
   */
  static async refreshAffinity() {
    console.log('[Affinity] Refreshing user product affinity...');
    const start = Date.now();
    let total = 0;

    const eventMap = [
      { event: 'view_item',       col: 'view_count' },
      { event: 'add_to_cart',     col: 'cart_count' },
      { event: 'begin_checkout',  col: 'checkout_count' },
      { event: 'purchase',        col: 'purchase_count' },
      { event: 'add_to_wishlist', col: 'wishlist_count' },
    ];

    // From GTM events
    for (const { event, col } of eventMap) {
      try {
        const { rowCount } = await query(`
          INSERT INTO user_product_affinity (unified_id, product_name, product_category, product_url, ${col}, first_seen_at, last_seen_at)
          SELECT
            ge.unified_id,
            COALESCE(
              ge.ecommerce_data->'items'->0->>'item_name',
              ge.raw_payload->>'product_interest',
              ge.raw_payload->>'product_context',
              ge.event_label,
              ge.page_title
            ),
            COALESCE(
              ge.ecommerce_data->'items'->0->>'item_category',
              ge.event_category
            ),
            ge.page_url,
            COUNT(*),
            MIN(ge.created_at),
            MAX(ge.created_at)
          FROM gtm_events ge
          WHERE ge.event_name = $1
            AND ge.unified_id IS NOT NULL
            AND COALESCE(
              ge.ecommerce_data->'items'->0->>'item_name',
              ge.raw_payload->>'product_interest',
              ge.raw_payload->>'product_context',
              ge.event_label,
              ge.page_title
            ) IS NOT NULL
          GROUP BY ge.unified_id,
            COALESCE(ge.ecommerce_data->'items'->0->>'item_name', ge.raw_payload->>'product_interest', ge.raw_payload->>'product_context', ge.event_label, ge.page_title),
            COALESCE(ge.ecommerce_data->'items'->0->>'item_category', ge.event_category),
            ge.page_url
          ON CONFLICT (unified_id, product_name) DO UPDATE SET
            ${col} = EXCLUDED.${col},
            product_category = COALESCE(EXCLUDED.product_category, user_product_affinity.product_category),
            product_url = COALESCE(EXCLUDED.product_url, user_product_affinity.product_url),
            last_seen_at = GREATEST(user_product_affinity.last_seen_at, EXCLUDED.last_seen_at),
            updated_at = NOW()
        `, [event]);
        total += rowCount;
        if (rowCount > 0) console.log(`[Affinity] GTM ${event}: ${rowCount} rows`);
      } catch (err) {
        console.error(`[Affinity] GTM ${event} failed:`, err.message);
      }
    }

    // From GA4 events — use DISTINCT ON to avoid duplicate conflict keys in same batch
    try {
      const { rowCount } = await query(`
        INSERT INTO user_product_affinity (unified_id, product_name, product_url, view_count, first_seen_at, last_seen_at)
        SELECT DISTINCT ON (unified_id, product_name)
          unified_id, product_name, product_url, cnt, first_at, last_at
        FROM (
          SELECT
            ge.unified_id,
            COALESCE(ge.page_title, ge.page_location) as product_name,
            ge.page_location as product_url,
            COUNT(*) as cnt,
            MIN(ge.event_ts) as first_at,
            MAX(ge.event_ts) as last_at
          FROM ga4_events ge
          WHERE ge.event_name IN ('page_view', 'view_item')
            AND ge.unified_id IS NOT NULL
            AND ge.page_location LIKE '%raynatours.com%'
            AND ge.page_title IS NOT NULL AND ge.page_title != ''
          GROUP BY ge.unified_id, COALESCE(ge.page_title, ge.page_location), ge.page_location
        ) sub
        ORDER BY unified_id, product_name, cnt DESC
        ON CONFLICT (unified_id, product_name) DO UPDATE SET
          view_count = user_product_affinity.view_count + EXCLUDED.view_count,
          product_url = COALESCE(EXCLUDED.product_url, user_product_affinity.product_url),
          last_seen_at = GREATEST(user_product_affinity.last_seen_at, EXCLUDED.last_seen_at),
          updated_at = NOW()
      `);
      total += rowCount;
      if (rowCount > 0) console.log(`[Affinity] GA4 views: ${rowCount} rows`);
    } catch (err) {
      console.error(`[Affinity] GA4 failed:`, err.message);
    }

    // Link product_id from products table
    await query(`
      UPDATE user_product_affinity upa SET product_id = p.product_id
      FROM products p
      WHERE upa.product_id IS NULL
        AND (LOWER(TRIM(upa.product_name)) = LOWER(TRIM(p.name))
          OR upa.product_url LIKE '%/' || p.product_id || '%')
    `);

    // Recalculate affinity scores
    await query(`
      UPDATE user_product_affinity SET
        affinity_score = (view_count * ${AFFINITY_WEIGHTS.view_item})
          + (cart_count * ${AFFINITY_WEIGHTS.add_to_cart})
          + (checkout_count * ${AFFINITY_WEIGHTS.begin_checkout})
          + (purchase_count * ${AFFINITY_WEIGHTS.purchase})
          + (wishlist_count * ${AFFINITY_WEIGHTS.add_to_wishlist}),
        updated_at = NOW()
    `);

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Affinity] Done — ${total} affinity rows in ${duration}s`);
    return { total, duration };
  }

  // ── Query Methods ─────────────────────────────────────────────

  /**
   * Get top products for a user by affinity score
   */
  static async getUserAffinity(unifiedId, limit = 5) {
    const { rows } = await query(`
      SELECT upa.*, p.sale_price, p.image_url, p.url as product_page_url, p.city, p.type
      FROM user_product_affinity upa
      LEFT JOIN products p ON p.product_id = upa.product_id
      WHERE upa.unified_id = $1 AND upa.affinity_score > 0
      ORDER BY upa.affinity_score DESC
      LIMIT $2
    `, [unifiedId, limit]);
    return rows;
  }

  /**
   * Get personalized product recommendations for a user
   * Top affinity products + similar products from same category
   */
  static async getRecommendations(unifiedId, limit = 6) {
    const topAffinity = await this.getUserAffinity(unifiedId, 3);

    if (topAffinity.length === 0) {
      // No affinity — return popular products
      const { rows } = await query(`
        SELECT product_id, name, type, category, sale_price, city, url, image_url
        FROM products ORDER BY RANDOM() LIMIT $1
      `, [limit]);
      return { affinity: [], recommendations: rows, type: 'popular' };
    }

    // Get similar products from same categories
    const categories = [...new Set(topAffinity.map(a => a.product_category).filter(Boolean))];
    const seenProducts = topAffinity.map(a => a.product_name);

    let recommendations = [];
    if (categories.length > 0) {
      const { rows } = await query(`
        SELECT product_id, name, type, category, sale_price, city, url, image_url
        FROM products WHERE category = ANY($1) AND name != ALL($2)
        ORDER BY sale_price ASC LIMIT $3
      `, [categories, seenProducts, limit]);
      recommendations = rows;
    }

    if (recommendations.length < limit) {
      const { rows: popular } = await query(`
        SELECT product_id, name, type, category, sale_price, city, url, image_url
        FROM products WHERE name != ALL($1)
        ORDER BY RANDOM() LIMIT $2
      `, [seenProducts, limit - recommendations.length]);
      recommendations = [...recommendations, ...popular];
    }

    return { affinity: topAffinity, recommendations, type: 'personalized' };
  }

  /**
   * Get products formatted for journey template rendering
   * Returns primary product (what they browsed) + recommendations
   */
  static async getTemplateProducts(unifiedId) {
    const { affinity, recommendations, type } = await this.getRecommendations(unifiedId, 4);

    const primaryProduct = affinity[0] ? {
      name: affinity[0].product_name,
      price: affinity[0].sale_price ? `AED ${affinity[0].sale_price}` : null,
      image: affinity[0].image_url,
      url: affinity[0].product_page_url || affinity[0].product_url,
      reason: affinity[0].purchase_count > 0 ? 'You purchased this' :
              affinity[0].cart_count > 0 ? 'Still in your cart' :
              affinity[0].checkout_count > 0 ? 'You almost booked this' :
              'You were viewing this',
    } : null;

    const recProducts = recommendations.map(r => ({
      name: r.name,
      price: r.sale_price ? `AED ${r.sale_price}` : null,
      image: r.image_url,
      url: r.url,
      city: r.city,
      category: r.category,
    }));

    return { primaryProduct, recommendations: recProducts, type };
  }

  /**
   * Run full product sync + affinity refresh
   */
  static async runAll() {
    const products = await this.syncProducts();
    const affinity = await this.refreshAffinity();
    return { products, affinity };
  }
}
