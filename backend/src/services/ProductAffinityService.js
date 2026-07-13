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

// Enriched feed API — returns full product records (tour + holiday + cruise + yacht)
// with all metadata (content, location, amenities, reviews, options) pre-populated.
// Replaces the older /generate-feed + /product-details two-step flow.
const PRODUCT_API = 'https://data-projects-flax.vercel.app/api/enriched-feed?format=json&types=tour,holiday,cruise,yacht';
const PRODUCT_DETAILS_API = 'https://data-projects-flax.vercel.app/api/product-details';
const DETAIL_CONCURRENCY = 12;

// Coerce API values to safe DB inputs.
// - Empty strings → null (avoids "" polluting text columns that we later NULL-check)
// - Numeric strings → Number (some fields come as strings like "175")
// - Objects/arrays → JSON.stringify for JSONB columns
const _txt  = (v) => (v === undefined || v === null || v === '') ? null : String(v);
const _num  = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const _int  = (v) => { const n = _num(v); return n === null ? null : Math.trunc(n); };
const _bool = (v) => (v === undefined || v === null) ? null : (v === true || v === 'true' || v === 1 || v === '1');
const _jsn  = (v) => (v === undefined || v === null) ? null : JSON.stringify(v);
const _ts   = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

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
   * Pull all products from the ENRICHED Rayna product API and upsert into the
   * local products table with FULL detail (content, location, amenities,
   * reviews, options, type-specific fields for tour/holiday/cruise/yacht).
   *
   * All columns added by migration 094 are populated here — one flat row per
   * product. Writes a sync_metadata row so the /data-pipeline UI shows the
   * last-run info.
   */
  static async syncProducts() {
    console.log('[ProductSync] Fetching enriched product catalog...');
    const start = Date.now();
    const startedAt = new Date();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    let synced = 0;
    let errMsg = null;
    try {
      const res = await fetch(PRODUCT_API, { signal: controller.signal });
      if (!res.ok) throw new Error(`Product API returned ${res.status}`);

      const data = await res.json();
      const products = data.products || [];
      console.log(`[ProductSync] Received ${products.length} products from enriched-feed`);
      if (products.length === 0) {
        return { synced: 0, duration: '0.0' };
      }

      // Deduplicate by productId (API can return dupes across types)
      const seen = new Set();
      const uniqueProducts = products.filter(p => {
        const id = p.productId ?? p.name;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      console.log(`[ProductSync] ${products.length} → ${uniqueProducts.length} after dedup`);

      // Batch smaller (50) since each row is much wider now (~74 columns).
      const BATCH = 50;

      const COLUMN_LIST = [
        // Existing 15 columns
        'product_id','name','type','category','normal_price','sale_price','currency',
        'country','city','city_id','url','image_url','page_title','page_description',
        'synced_at',
        // New enriched columns (48)
        'listing_rating','listing_review_count','listing_amenities','enriched_flag',
        'detail_title','detail_share_url','detail_promotion_badge',
        'location_address','location_title','location_latitude','location_longitude',
        'amenities_all','amenity_duration','amenity_pickup','amenity_transport',
        'amenity_meals','amenity_language','amenity_group_size','amenity_hotel',
        'amenity_nights','amenity_confirmation','amenity_voucher','amenity_cancellation',
        'transfer_types',
        'description_text','content_overview','content_highlights','content_inclusions',
        'content_exclusions','content_how_to_redeem','content_know_before_you_go','content_sections',
        'meta_title','meta_description','meta_keywords','meta_h1',
        'available','next_available_dates','options','options_count','lowest_option_price',
        'review_average_rating','review_total_count',
        'review_excellent','review_very_good','review_average','review_poor','review_terrible',
        'cruise_next_date','cruise_total_dates',
        'holiday_hotels','holiday_tours','holiday_categories',
        'yacht_type','yacht_min_guests','yacht_max_guests',
        'all_image_links','image_count','first_seen_date',
      ];

      // Everything EXCEPT product_id is overwritten on conflict.
      const UPDATE_COLS = COLUMN_LIST.slice(1).map(c => `${c} = EXCLUDED.${c}`).join(', ');
      const COLS_PER_ROW = COLUMN_LIST.length;   // = 74 total (15 existing + 59 enriched)

      for (let i = 0; i < uniqueProducts.length; i += BATCH) {
        const batch = uniqueProducts.slice(i, i + BATCH);
        const values = [];
        const placeholders = batch.map((p, idx) => {
          const base = idx * COLS_PER_ROW;
          values.push(
            // Existing 15
            _int(p.productId) ?? (900000 + i + idx),
            _txt(p.name), _txt(p.type), _txt(p.item_group_id),
            _num(p.normalPrice), _num(p.salePrice), _txt(p.currency) || 'AED',
            _txt(p.country), _txt(p.city), _int(p.cityId),
            _txt(p.url), _txt(p.image),
            _txt(p.meta_title || p.name), _txt(p.meta_description),
            new Date().toISOString(),                              // synced_at
            // Listing / detail
            _num(p.listing_rating), _int(p.listing_reviewCount), _txt(p.listing_amenities),
            _bool(p._enriched),
            _txt(p.detail_title), _txt(p.detail_shareUrl), _txt(p.detail_promotionBadge),
            // Location
            _txt(p.location_address), _txt(p.location_title),
            _num(p.location_latitude), _num(p.location_longitude),
            // Amenities
            _txt(p.amenities_all), _txt(p.amenity_duration), _txt(p.amenity_pickup),
            _txt(p.amenity_transport), _txt(p.amenity_meals), _txt(p.amenity_language),
            _txt(p.amenity_group_size), _txt(p.amenity_hotel), _txt(p.amenity_nights),
            _txt(p.amenity_confirmation), _txt(p.amenity_voucher), _txt(p.amenity_cancellation),
            _txt(p.transfer_types),
            // Content
            _txt(p.description_text), _txt(p.content_overview), _txt(p.content_highlights),
            _txt(p.content_inclusions), _txt(p.content_exclusions),
            _txt(p.content_how_to_redeem), _txt(p.content_know_before_you_go),
            _jsn(p.content_sections),
            // Meta / SEO
            _txt(p.meta_title), _txt(p.meta_description), _txt(p.meta_keywords), _txt(p.meta_h1),
            // Availability / booking
            _bool(p.available), _jsn(p.next_available_dates), _jsn(p.options),
            _int(p.options_count), _num(p.lowest_option_price),
            // Reviews
            _num(p.review_averageRating), _int(p.review_totalCount),
            _int(p.review_excellent), _int(p.review_veryGood), _int(p.review_average),
            _int(p.review_poor), _int(p.review_terrible),
            // Cruise
            _ts(p.cruise_nextDate), _int(p.cruise_totalDates),
            // Holiday
            _jsn(p.holiday_hotels), _jsn(p.holiday_tours), _jsn(p.holiday_categories),
            // Yacht
            _txt(p.yacht_type), _int(p.yacht_minGuests), _int(p.yacht_maxGuests),
            // Media / lifecycle
            _jsn(p.all_image_links), _int(p.image_count), _ts(p.first_seen_date),
          );
          const params = Array.from({ length: COLS_PER_ROW }, (_, k) => `$${base + k + 1}`).join(',');
          return `(${params})`;
        });

        await query(`
          INSERT INTO products (${COLUMN_LIST.join(', ')})
          VALUES ${placeholders.join(',')}
          ON CONFLICT (product_id) DO UPDATE SET ${UPDATE_COLS}
        `, values);

        synced += batch.length;
      }

      const durationMs = Date.now() - start;
      const duration = (durationMs / 1000).toFixed(1);
      console.log(`[ProductSync] Done — ${synced} products synced in ${duration}s`);

      // Record run in sync_metadata so /data-pipeline UI shows the last-run info.
      // Fail-safe — a metadata write failure never blocks the sync result.
      await query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ('products_enriched_sync', $1, $2, 'success', NULL, $3, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          last_synced_at   = EXCLUDED.last_synced_at,
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = 'success',
          error_message    = NULL,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [startedAt, synced, durationMs]).catch(err =>
        console.warn('[ProductSync] sync_metadata write failed:', err.message)
      );

      return { synced, duration };
    } catch (err) {
      errMsg = err.message;
      const durationMs = Date.now() - start;
      // Write failure metadata so the UI shows the error.
      await query(`
        INSERT INTO sync_metadata (table_name, last_synced_at, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
        VALUES ('products_enriched_sync', $1, $2, 'error', $3, $4, NOW())
        ON CONFLICT (table_name) DO UPDATE SET
          last_synced_at   = EXCLUDED.last_synced_at,
          rows_synced      = EXCLUDED.rows_synced,
          sync_status      = 'error',
          error_message    = EXCLUDED.error_message,
          sync_duration_ms = EXCLUDED.sync_duration_ms,
          updated_at       = NOW()
      `, [startedAt, synced, errMsg, durationMs]).catch(() => {});
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Enrich products with real SEO title + meta description from /api/product-details.
   * The bulk feed only returns the product name as pageTitle and an empty pageDescription,
   * so we fan out per-URL calls to populate the actual marketing copy.
   */
  static async enrichProductDetails({ onlyMissing = false } = {}) {
    const productsRes = await query(
      onlyMissing
        ? `SELECT product_id, url FROM products WHERE url IS NOT NULL AND url <> '' AND (page_description IS NULL OR page_description = '')`
        : `SELECT product_id, url FROM products WHERE url IS NOT NULL AND url <> ''`
    );
    const products = productsRes.rows;
    console.log(`[ProductSync] Enriching ${products.length} products from /api/product-details (concurrency=${DETAIL_CONCURRENCY})...`);
    const start = Date.now();
    let updated = 0;
    let failed = 0;

    let cursor = 0;
    const workers = Array.from({ length: DETAIL_CONCURRENCY }, async () => {
      while (cursor < products.length) {
        const idx = cursor++;
        const { product_id, url } = products[idx];
        try {
          const res = await fetch(`${PRODUCT_DETAILS_API}?url=${encodeURIComponent(url)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) { failed++; continue; }
          const data = await res.json();
          const title = (data.title || '').trim();
          const description = (data.description || '').trim();
          if (!title && !description) { failed++; continue; }
          await query(
            `UPDATE products
               SET page_title = COALESCE(NULLIF($1,''), page_title),
                   page_description = COALESCE(NULLIF($2,''), page_description),
                   synced_at = NOW()
             WHERE product_id = $3`,
            [title, description, product_id]
          );
          updated++;
          if (updated % 100 === 0) {
            console.log(`[ProductSync]   enriched ${updated}/${products.length}`);
          }
        } catch {
          failed++;
        }
      }
    });
    await Promise.all(workers);

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[ProductSync] Enrichment done — ${updated} updated, ${failed} failed in ${duration}s`);
    return { updated, failed, duration };
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
