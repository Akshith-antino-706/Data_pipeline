import db from '../config/database.js';

class RFMService {

  /**
   * Get RFM distribution across all customers
   */
  static async getRFMOverview() {
    const { rows: distribution } = await db.query(`
      SELECT rfm_segment_label AS label,
        COUNT(*) AS count,
        AVG(rfm_total_score)::NUMERIC(4,1) AS avg_score,
        AVG(rfm_recency_score)::NUMERIC(3,1) AS avg_recency,
        AVG(rfm_frequency_score)::NUMERIC(3,1) AS avg_frequency,
        AVG(rfm_monetary_score)::NUMERIC(3,1) AS avg_monetary,
        AVG(winback_probability)::NUMERIC(5,1) AS avg_winback_prob,
        AVG(total_revenue)::NUMERIC(12,2) AS avg_revenue
      FROM customers
      WHERE rfm_segment_label IS NOT NULL
      GROUP BY rfm_segment_label
      ORDER BY avg_score DESC
    `);

    const { rows: [totals] } = await db.query(`
      SELECT COUNT(*) AS total_customers,
        AVG(rfm_total_score)::NUMERIC(4,1) AS avg_rfm_score,
        COUNT(*) FILTER (WHERE rfm_segment_label = 'Champions') AS champions,
        COUNT(*) FILTER (WHERE rfm_segment_label = 'Lost') AS lost,
        COUNT(*) FILTER (WHERE winback_probability >= 50) AS high_winback
      FROM customers
    `);

    return { distribution, totals };
  }

  /**
   * Get RFM analysis for a specific segment
   */
  static async getSegmentRFM(segmentId) {
    const { rows: [analysis] } = await db.query(`
      SELECT
        sd.segment_name, sd.rfm_profile, sd.winback_goal, sd.end_goal,
        sd.product_affinity AS segment_product_affinity, sd.recommended_coupon,
        COUNT(DISTINCT sc.customer_id) AS customer_count,
        AVG(c.rfm_recency_score)::NUMERIC(3,1) AS avg_recency,
        AVG(c.rfm_frequency_score)::NUMERIC(3,1) AS avg_frequency,
        AVG(c.rfm_monetary_score)::NUMERIC(3,1) AS avg_monetary,
        AVG(c.rfm_total_score)::NUMERIC(4,1) AS avg_rfm_score,
        AVG(c.winback_probability)::NUMERIC(5,1) AS avg_winback_prob,
        mode() WITHIN GROUP (ORDER BY c.rfm_segment_label) AS dominant_rfm_label,
        mode() WITHIN GROUP (ORDER BY c.winback_strategy) AS primary_winback_strategy
      FROM segment_definitions sd
      LEFT JOIN segment_customers sc ON sc.segment_id = sd.segment_id AND sc.is_active = true
      LEFT JOIN customers c ON c.customer_id = sc.customer_id
      WHERE sd.segment_id = $1
      GROUP BY sd.segment_id
    `, [segmentId]);

    if (!analysis) return null;

    // Get RFM label breakdown for this segment
    const { rows: rfmBreakdown } = await db.query(`
      SELECT c.rfm_segment_label, COUNT(*) AS count,
        AVG(c.winback_probability)::NUMERIC(5,1) AS avg_winback
      FROM segment_customers sc
      JOIN customers c ON c.customer_id = sc.customer_id
      WHERE sc.segment_id = $1 AND sc.is_active = true
      GROUP BY c.rfm_segment_label
      ORDER BY count DESC
    `, [segmentId]);

    // Get product affinity for this segment
    const { rows: productAffinity } = await db.query(`
      SELECT elem->>'product' AS product,
        AVG((elem->>'score')::NUMERIC)::NUMERIC(3,2) AS avg_score,
        COUNT(*) AS customers_with_affinity
      FROM segment_customers sc
      JOIN customers c ON c.customer_id = sc.customer_id,
      LATERAL jsonb_array_elements(COALESCE(c.product_affinity, '[]'::jsonb)) AS elem
      WHERE sc.segment_id = $1 AND sc.is_active = true
      GROUP BY elem->>'product'
      ORDER BY avg_score DESC
    `, [segmentId]);

    return { ...analysis, rfm_breakdown: rfmBreakdown, product_affinity: productAffinity };
  }

  /**
   * Recalculate RFM scores for all customers
   */
  static async recalculate() {
    await db.query(`
      UPDATE customers SET
        rfm_recency_score = CASE
          WHEN days_since_last_booking IS NULL OR days_since_last_booking = 0 THEN
            CASE WHEN total_bookings > 0 THEN 3 ELSE 1 END
          WHEN days_since_last_booking <= 30  THEN 5
          WHEN days_since_last_booking <= 60  THEN 4
          WHEN days_since_last_booking <= 90  THEN 3
          WHEN days_since_last_booking <= 180 THEN 2
          ELSE 1
        END,
        rfm_frequency_score = CASE
          WHEN total_bookings >= 5  THEN 5
          WHEN total_bookings = 4   THEN 4
          WHEN total_bookings = 3   THEN 3
          WHEN total_bookings = 2   THEN 2
          WHEN total_bookings = 1   THEN 1
          ELSE 0
        END,
        rfm_monetary_score = CASE
          WHEN total_revenue >= 5000 THEN 5
          WHEN total_revenue >= 3000 THEN 4
          WHEN total_revenue >= 1500 THEN 3
          WHEN total_revenue >= 500  THEN 2
          WHEN total_revenue > 0     THEN 1
          ELSE 0
        END,
        rfm_updated_at = NOW()
    `);

    await db.query(`UPDATE customers SET rfm_total_score = rfm_recency_score + rfm_frequency_score + rfm_monetary_score`);

    await db.query(`
      UPDATE customers SET rfm_segment_label = CASE
        WHEN rfm_total_score >= 13 THEN 'Champions'
        WHEN rfm_total_score >= 11 THEN 'Loyal Customers'
        WHEN rfm_total_score >= 9  THEN 'Potential Loyalists'
        WHEN rfm_total_score >= 7  THEN 'At Risk'
        WHEN rfm_total_score >= 5  THEN 'Need Attention'
        WHEN rfm_total_score >= 3  THEN 'Hibernating'
        ELSE 'Lost'
      END
    `);

    await db.query(`
      UPDATE customers SET winback_probability = CASE
        WHEN total_bookings = 0 THEN 15.0
        WHEN rfm_segment_label = 'Champions'         THEN 95.0
        WHEN rfm_segment_label = 'Loyal Customers'    THEN 85.0
        WHEN rfm_segment_label = 'Potential Loyalists' THEN 70.0
        WHEN rfm_segment_label = 'At Risk'            THEN 50.0
        WHEN rfm_segment_label = 'Need Attention'     THEN 35.0
        WHEN rfm_segment_label = 'Hibernating'        THEN 20.0
        ELSE 10.0
      END
    `);

    return { message: 'RFM recalculation complete', updated: (await db.query('SELECT COUNT(*) FROM customers')).rows[0].count };
  }
}

export default RFMService;
