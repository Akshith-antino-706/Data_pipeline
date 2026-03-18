import pool from '../config/database.js';

const ProductAffinityService = {

  // Get full affinity data for all 28 segments
  async getAll() {
    const { rows } = await pool.query(`SELECT * FROM v_segment_affinity ORDER BY segment_number`);
    return rows;
  },

  // Get affinity for a specific segment
  async getBySegmentId(segmentId) {
    const { rows } = await pool.query(`SELECT * FROM v_segment_affinity WHERE segment_id = $1`, [segmentId]);
    return rows[0] || null;
  },

  // Get WHAT to sell for a segment
  async getWhatToSell(segmentId) {
    const { rows } = await pool.query(`
      SELECT segment_name, primary_products, cross_sell_products, upsell_products,
             hero_product, hero_product_url, hero_product_image, affinity_score, expected_aov
      FROM v_segment_affinity WHERE segment_id = $1
    `, [segmentId]);
    if (!rows[0]) return null;

    const r = rows[0];
    return {
      segment: r.segment_name,
      primary: r.primary_products || [],
      crossSell: r.cross_sell_products || [],
      upsell: r.upsell_products || [],
      hero: { product: r.hero_product, url: r.hero_product_url, image: r.hero_product_image },
      affinityScore: parseFloat(r.affinity_score),
      expectedAOV: parseFloat(r.expected_aov),
    };
  },

  // Get WHEN to sell for a segment
  async getWhenToSell(segmentId) {
    const { rows } = await pool.query(`
      SELECT segment_name, best_send_day, best_send_time, urgency_level, send_frequency,
             trigger_event, follow_up_days
      FROM v_segment_affinity WHERE segment_id = $1
    `, [segmentId]);
    if (!rows[0]) return null;

    const r = rows[0];
    return {
      segment: r.segment_name,
      bestDay: r.best_send_day,
      bestTime: r.best_send_time,
      urgency: r.urgency_level,
      frequency: r.send_frequency,
      trigger: r.trigger_event,
      followUpDays: r.follow_up_days || [],
    };
  },

  // Get HOW to sell for a segment
  async getHowToSell(segmentId) {
    const { rows } = await pool.query(`
      SELECT segment_name, recommended_channel, secondary_channel, tone,
             discount_strategy, discount_value, cta_text,
             personalization_fields, social_proof, scarcity_messaging,
             expected_conversion_rate
      FROM v_segment_affinity WHERE segment_id = $1
    `, [segmentId]);
    if (!rows[0]) return null;

    const r = rows[0];
    return {
      segment: r.segment_name,
      channel: { primary: r.recommended_channel, secondary: r.secondary_channel },
      tone: r.tone,
      discount: { strategy: r.discount_strategy, value: r.discount_value },
      cta: r.cta_text,
      personalization: r.personalization_fields || [],
      socialProof: r.social_proof,
      scarcity: r.scarcity_messaging,
      expectedConversion: parseFloat(r.expected_conversion_rate),
    };
  },

  // Get full recommendation card for a segment (WHAT + WHEN + HOW combined)
  async getRecommendation(segmentId) {
    const [what, when, how] = await Promise.all([
      this.getWhatToSell(segmentId),
      this.getWhenToSell(segmentId),
      this.getHowToSell(segmentId),
    ]);
    if (!what) return null;
    return { what, when, how };
  },

  // Get department-product mapping
  async getDepartmentMap() {
    const { rows } = await pool.query(`
      SELECT department_pattern, product_category, product_line, avg_ticket_value, priority
      FROM department_product_map ORDER BY priority, product_line
    `);
    return rows;
  },

  // Get product affinity distribution across all customers
  async getCustomerAffinityStats() {
    const { rows } = await pool.query(`
      SELECT
        preferred_products[1] AS top_product,
        COUNT(*) AS customer_count,
        ROUND(AVG(total_revenue)::numeric, 2) AS avg_revenue,
        ROUND(AVG(total_bookings)::numeric, 1) AS avg_bookings
      FROM customers
      WHERE preferred_products IS NOT NULL AND array_length(preferred_products, 1) > 0
      GROUP BY preferred_products[1]
      ORDER BY customer_count DESC
    `);
    return rows;
  },

  // Get segment affinity matrix — which segments share product interests
  async getAffinityMatrix() {
    const { rows } = await pool.query(`
      SELECT
        a.segment_number AS seg_a,
        b.segment_number AS seg_b,
        a.segment_name AS name_a,
        b.segment_name AS name_b,
        (SELECT COUNT(*) FROM unnest(a.primary_products) x
         WHERE x = ANY(b.primary_products)) AS shared_products
      FROM v_segment_affinity a
      CROSS JOIN v_segment_affinity b
      WHERE a.segment_number < b.segment_number
        AND (SELECT COUNT(*) FROM unnest(a.primary_products) x WHERE x = ANY(b.primary_products)) > 0
      ORDER BY shared_products DESC, a.segment_number
      LIMIT 30
    `);
    return rows;
  },
};

export default ProductAffinityService;
