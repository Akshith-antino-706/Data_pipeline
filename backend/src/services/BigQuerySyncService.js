import { BigQuery } from '@google-cloud/bigquery';
import { query, transaction } from '../config/database.js';

/**
 * BigQuery GA4 → PostgreSQL Sync Service
 * Pulls GA4 events from BigQuery every 10 minutes, builds user profiles,
 * and links them to the segmentation engine.
 */
class BigQuerySyncService {

  static BQ_TABLE = process.env.BQ_FULL_TABLE || 'rayna-ga4-bigquery-483612.shared_dataset.ga4_clean';
  static BATCH_SIZE = parseInt(process.env.BQ_SYNC_BATCH_SIZE || '500');

  // Lazy BigQuery client — uses Application Default Credentials
  static #bq = null;
  static getBQ() {
    if (!this.#bq) {
      this.#bq = new BigQuery({ projectId: process.env.BQ_PROJECT_ID || 'rayna-data-pipeline' });
    }
    return this.#bq;
  }

  // ── Sync Metadata ─────────────────────────────────────────

  static async getLastSyncTime() {
    const { rows } = await query(
      "SELECT last_synced_at FROM sync_metadata WHERE table_name = 'ga4_events'"
    );
    if (!rows.length || !rows[0].last_synced_at || rows[0].last_synced_at.getTime() < 1000) {
      // First sync: pull last 30 days
      const d = new Date(); d.setDate(d.getDate() - 30);
      return d;
    }
    return rows[0].last_synced_at;
  }

  static async updateSyncMeta(status, rowsSynced, error, durationMs) {
    await query(
      `INSERT INTO sync_metadata (table_name, rows_synced, sync_status, error_message, sync_duration_ms, updated_at)
       VALUES ('ga4_events', $1, $2, $3, $4, NOW())
       ON CONFLICT (table_name) DO UPDATE SET
         rows_synced = COALESCE($1, sync_metadata.rows_synced),
         sync_status = $2,
         error_message = $3,
         sync_duration_ms = COALESCE($4, sync_metadata.sync_duration_ms),
         last_synced_at = CASE WHEN $2 = 'success' THEN NOW() ELSE sync_metadata.last_synced_at END,
         updated_at = NOW()`,
      [rowsSynced, status, error, durationMs]
    );
  }

  // ── Core Sync: Pull GA4 events from BigQuery ──────────────

  static async syncEvents() {
    const startTime = Date.now();
    await this.updateSyncMeta('running', null, null, null);
    console.log('[GA4 Sync] Starting event sync...');

    try {
      const lastSync = await this.getLastSyncTime();
      const bq = this.getBQ();
      let totalSynced = 0;

      // Paginate by day to avoid OOM on large datasets
      const startDate = new Date(lastSync);
      const endDate = new Date();
      const dayMs = 86400000;

      for (let d = startDate.getTime(); d < endDate.getTime(); d += dayMs) {
        const dayStart = new Date(d).toISOString();
        const dayEnd = new Date(d + dayMs).toISOString();

        const [rows] = await bq.query({
          query: `
            SELECT
              event_date, event_ts, event_name, user_pseudo_id, user_id,
              hostname, device_category, geo_country, geo_city,
              ga_session_id, ga_session_number,
              ep_source, ep_medium, ep_campaign, ep_campaign_id, gclid,
              page_location, page_referrer, page_title, page_path_clean,
              landing_page_path_clean, session_engaged_final, engagement_time_msec,
              email_any, name_any, contact_number_any, logged_in_status,
              transaction_id, final_order_id, currency,
              item_id, item_name, item_brand, item_category,
              item_price, item_quantity, item_revenue, item_value,
              coupon, discount, coupon_applied, search_term,
              item_adult_count, item_children_count,
              campaign_source, campaign_medium, campaign_name
            FROM \`${this.BQ_TABLE}\`
            WHERE event_ts > @dayStart AND event_ts <= @dayEnd
            ORDER BY event_ts ASC
          `,
          params: { dayStart, dayEnd },
        });

        if (rows.length === 0) continue;

        // Batch upsert
        for (let i = 0; i < rows.length; i += this.BATCH_SIZE) {
          const batch = rows.slice(i, i + this.BATCH_SIZE);
          await this.upsertEventBatch(batch);
          totalSynced += batch.length;
        }

        console.log(`[GA4 Sync] Day ${new Date(d).toISOString().slice(0, 10)}: ${rows.length} events (total: ${totalSynced})`);
      }

      console.log(`[GA4 Sync] Events synced: ${totalSynced}`);
      await this.updateSyncMeta('success', totalSynced, null, Date.now() - startTime);

      // After syncing events, rebuild user profiles + link to customers
      const profileResult = await this.rebuildUserProfiles();
      const linkResult = await this.linkToCustomers();

      return {
        events_synced: totalSynced,
        profiles_updated: profileResult,
        customers_linked: linkResult,
        duration_ms: Date.now() - startTime
      };
    } catch (err) {
      console.error('[GA4 Sync] Failed:', err.message);
      await this.updateSyncMeta('error', null, err.message, Date.now() - startTime);
      throw err;
    }
  }

  static async upsertEventBatch(rows) {
    if (!rows.length) return;

    const cols = [
      'event_date', 'event_ts', 'event_name', 'user_pseudo_id', 'user_id',
      'hostname', 'device_category', 'geo_country', 'geo_city',
      'ga_session_id', 'ga_session_number',
      'ep_source', 'ep_medium', 'ep_campaign', 'ep_campaign_id', 'gclid',
      'page_location', 'page_referrer', 'page_title', 'page_path_clean',
      'landing_page_path_clean', 'session_engaged_final', 'engagement_time_msec',
      'email_any', 'name_any', 'contact_number_any', 'logged_in_status',
      'transaction_id', 'final_order_id', 'currency',
      'item_id', 'item_name', 'item_brand', 'item_category',
      'item_price', 'item_quantity', 'item_revenue', 'item_value',
      'coupon', 'discount', 'coupon_applied', 'search_term',
      'item_adult_count', 'item_children_count',
      'campaign_source', 'campaign_medium', 'campaign_name'
    ];

    const values = [];
    const valueClauses = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const placeholders = [];
      for (let ci = 0; ci < cols.length; ci++) {
        let val = r[cols[ci]];
        // Handle BigQuery date/timestamp objects
        if (val && typeof val === 'object' && val.value !== undefined) val = val.value;
        // Null out empty strings
        if (val === '') val = null;
        // Truncate long strings
        if (typeof val === 'string' && val.length > 2000) val = val.slice(0, 2000);
        values.push(val ?? null);
        placeholders.push(`$${ri * cols.length + ci + 1}`);
      }
      valueClauses.push(`(${placeholders.join(',')})`);
    }

    const sql = `
      INSERT INTO ga4_events (${cols.join(',')})
      VALUES ${valueClauses.join(',')}
      ON CONFLICT (user_pseudo_id, event_name, event_ts, COALESCE(item_name, ''))
      DO NOTHING
    `;

    await query(sql, values);
  }

  // ── Build User Profiles from GA4 events ───────────────────

  static async rebuildUserProfiles() {
    const { rowCount } = await query(`
      INSERT INTO ga4_user_profiles (
        user_pseudo_id, email, name, phone,
        first_seen, last_seen, total_sessions, total_pageviews,
        total_item_views, total_checkouts, total_purchases, total_revenue,
        engagement_time_sec, top_country, top_city, top_device,
        last_source, last_medium, last_campaign,
        viewed_products, checkout_products, purchased_products,
        last_search_term, last_coupon_used, is_engaged, updated_at
      )
      SELECT
        user_pseudo_id,
        MAX(email_any) FILTER (WHERE email_any IS NOT NULL),
        MAX(name_any) FILTER (WHERE name_any IS NOT NULL),
        MAX(contact_number_any) FILTER (WHERE contact_number_any IS NOT NULL),
        MIN(event_date),
        MAX(event_date),
        COUNT(DISTINCT ga_session_id),
        COUNT(*) FILTER (WHERE event_name = 'page_view'),
        COUNT(*) FILTER (WHERE event_name = 'view_item'),
        COUNT(*) FILTER (WHERE event_name = 'begin_checkout'),
        COUNT(*) FILTER (WHERE event_name = 'purchase'),
        COALESCE(SUM(item_revenue) FILTER (WHERE event_name = 'purchase'), 0),
        COALESCE(SUM(engagement_time_msec) / 1000, 0)::INT,
        MODE() WITHIN GROUP (ORDER BY geo_country),
        MODE() WITHIN GROUP (ORDER BY geo_city),
        MODE() WITHIN GROUP (ORDER BY device_category),
        (ARRAY_AGG(ep_source ORDER BY event_ts DESC) FILTER (WHERE ep_source IS NOT NULL))[1],
        (ARRAY_AGG(ep_medium ORDER BY event_ts DESC) FILTER (WHERE ep_medium IS NOT NULL))[1],
        (ARRAY_AGG(ep_campaign ORDER BY event_ts DESC) FILTER (WHERE ep_campaign IS NOT NULL))[1],
        ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY_AGG(DISTINCT item_name) FILTER (WHERE event_name = 'view_item' AND item_name IS NOT NULL)) LIMIT 20),
        ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY_AGG(DISTINCT item_name) FILTER (WHERE event_name = 'begin_checkout' AND item_name IS NOT NULL)) LIMIT 10),
        ARRAY(SELECT DISTINCT unnest FROM unnest(ARRAY_AGG(DISTINCT item_name) FILTER (WHERE event_name = 'purchase' AND item_name IS NOT NULL)) LIMIT 10),
        (ARRAY_AGG(search_term ORDER BY event_ts DESC) FILTER (WHERE search_term IS NOT NULL))[1],
        (ARRAY_AGG(coupon ORDER BY event_ts DESC) FILTER (WHERE coupon IS NOT NULL))[1],
        COUNT(DISTINCT ga_session_id) >= 2 OR SUM(engagement_time_msec) > 60000,
        NOW()
      FROM ga4_events
      WHERE user_pseudo_id IS NOT NULL
      GROUP BY user_pseudo_id
      ON CONFLICT (user_pseudo_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, ga4_user_profiles.email),
        name = COALESCE(EXCLUDED.name, ga4_user_profiles.name),
        phone = COALESCE(EXCLUDED.phone, ga4_user_profiles.phone),
        first_seen = LEAST(EXCLUDED.first_seen, ga4_user_profiles.first_seen),
        last_seen = GREATEST(EXCLUDED.last_seen, ga4_user_profiles.last_seen),
        total_sessions = EXCLUDED.total_sessions,
        total_pageviews = EXCLUDED.total_pageviews,
        total_item_views = EXCLUDED.total_item_views,
        total_checkouts = EXCLUDED.total_checkouts,
        total_purchases = EXCLUDED.total_purchases,
        total_revenue = EXCLUDED.total_revenue,
        engagement_time_sec = EXCLUDED.engagement_time_sec,
        top_country = EXCLUDED.top_country,
        top_city = EXCLUDED.top_city,
        top_device = EXCLUDED.top_device,
        last_source = EXCLUDED.last_source,
        last_medium = EXCLUDED.last_medium,
        last_campaign = EXCLUDED.last_campaign,
        viewed_products = EXCLUDED.viewed_products,
        checkout_products = EXCLUDED.checkout_products,
        purchased_products = EXCLUDED.purchased_products,
        last_search_term = EXCLUDED.last_search_term,
        last_coupon_used = EXCLUDED.last_coupon_used,
        is_engaged = EXCLUDED.is_engaged,
        updated_at = NOW()
    `);

    console.log(`[GA4 Sync] User profiles rebuilt: ${rowCount}`);
    return rowCount;
  }

  // ── Link GA4 profiles to customers (by email) ────────────

  static async linkToCustomers() {
    // Link by email match
    const { rowCount: emailLinked } = await query(`
      UPDATE ga4_user_profiles gp SET linked_customer_id = c.customer_id
      FROM customers c
      WHERE gp.email IS NOT NULL
        AND LOWER(gp.email) = LOWER(c.email)
        AND gp.linked_customer_id IS NULL
    `);

    // Enrich customers with GA4 data
    const { rowCount: enriched } = await query(`
      UPDATE customers c SET
        ga4_user_pseudo_id = gp.user_pseudo_id,
        ga4_sessions = gp.total_sessions,
        ga4_pageviews = gp.total_pageviews,
        ga4_item_views = gp.total_item_views,
        ga4_checkouts = gp.total_checkouts,
        ga4_last_source = gp.last_source,
        ga4_last_medium = gp.last_medium,
        ga4_last_campaign = gp.last_campaign,
        ga4_viewed_products = gp.viewed_products,
        ga4_last_active = gp.last_seen,
        website_sessions_total = gp.total_sessions,
        product_views_count = gp.total_item_views,
        lead_source = COALESCE(c.lead_source, gp.last_source)
      FROM ga4_user_profiles gp
      WHERE gp.linked_customer_id = c.customer_id
    `);

    // Also update segment-relevant fields for customers with GA4 cart abandonment
    await query(`
      UPDATE customers c SET
        last_abandoned_cart_date = sub.last_checkout
      FROM (
        SELECT gp.linked_customer_id, MAX(g.event_ts) AS last_checkout
        FROM ga4_events g
        JOIN ga4_user_profiles gp ON gp.user_pseudo_id = g.user_pseudo_id
        WHERE g.event_name = 'begin_checkout'
          AND gp.linked_customer_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ga4_events g2
            WHERE g2.user_pseudo_id = g.user_pseudo_id
              AND g2.event_name = 'purchase'
              AND g2.event_ts > g.event_ts
          )
        GROUP BY gp.linked_customer_id
      ) sub
      WHERE c.customer_id = sub.linked_customer_id
        AND (c.last_abandoned_cart_date IS NULL OR c.last_abandoned_cart_date < sub.last_checkout)
    `);

    console.log(`[GA4 Sync] Linked ${emailLinked} profiles, enriched ${enriched} customers`);
    return { email_linked: emailLinked, customers_enriched: enriched };
  }

  // ── Full sync (called by cron and API) ────────────────────

  static async syncAll() {
    return this.syncEvents();
  }

  // ── Sync Status ───────────────────────────────────────────

  static async getSyncStatus() {
    const { rows } = await query(
      "SELECT * FROM sync_metadata WHERE table_name IN ('ga4_events', 'mysql_tickets', 'mysql_chats', 'mysql_travel_data', 'mysql_contacts') ORDER BY table_name"
    );

    const { rows: [ga4Stats] } = await query(`
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT user_pseudo_id) AS unique_users,
        COUNT(DISTINCT email_any) FILTER (WHERE email_any IS NOT NULL) AS unique_emails,
        MIN(event_date) AS earliest,
        MAX(event_date) AS latest
      FROM ga4_events
    `);

    const { rows: [profileStats] } = await query(`
      SELECT
        COUNT(*) AS total_profiles,
        COUNT(*) FILTER (WHERE linked_customer_id IS NOT NULL) AS linked_profiles,
        COUNT(*) FILTER (WHERE is_engaged) AS engaged_profiles
      FROM ga4_user_profiles
    `);

    return { sync_metadata: rows, ga4_stats: ga4Stats, profile_stats: profileStats };
  }
}

export default BigQuerySyncService;
