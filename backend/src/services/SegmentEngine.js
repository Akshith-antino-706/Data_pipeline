import db from '../config/database.js';

/**
 * SegmentEngine — Auto-assigns customers to the 28 defined segments
 * based on their SQL criteria. Runs as a batch job.
 */
class SegmentEngine {

  /**
   * Get all funnel stages with their segments and customer counts
   */
  static async getFunnelOverview() {
    const { rows: stages } = await db.query(`
      SELECT fs.*,
        COALESCE(json_agg(
          json_build_object(
            'segment_id', sd.segment_id,
            'segment_number', sd.segment_number,
            'segment_name', sd.segment_name,
            'segment_description', sd.segment_description,
            'customer_type', sd.customer_type,
            'priority', sd.priority,
            'sql_criteria', sd.sql_criteria,
            'key_points', sd.key_points,
            'customer_count', COALESCE(sc.cnt, 0)
          ) ORDER BY sd.segment_number
        ) FILTER (WHERE sd.segment_id IS NOT NULL), '[]') AS segments
      FROM funnel_stages fs
      LEFT JOIN segment_definitions sd ON sd.stage_id = fs.stage_id
      LEFT JOIN (
        SELECT segment_id, COUNT(*) AS cnt
        FROM segment_customers WHERE is_active = true
        GROUP BY segment_id
      ) sc ON sc.segment_id = sd.segment_id
      GROUP BY fs.stage_id
      ORDER BY fs.stage_number
    `);
    return stages;
  }

  /**
   * Get complete page data: funnel stages with segments + strategies (flow_steps)
   */
  static async getFullPageData() {
    // Get stages with segments
    const { rows: stages } = await db.query(`
      SELECT fs.*,
        COALESCE(json_agg(
          json_build_object(
            'segment_id', sd.segment_id,
            'segment_number', sd.segment_number,
            'segment_name', sd.segment_name,
            'segment_description', sd.segment_description,
            'customer_type', sd.customer_type,
            'priority', sd.priority,
            'sql_criteria', sd.sql_criteria,
            'key_points', sd.key_points,
            'customer_count', COALESCE(sc.cnt, 0),
            'strategy', strat.strategy_data
          ) ORDER BY sd.segment_number
        ) FILTER (WHERE sd.segment_id IS NOT NULL), '[]') AS segments
      FROM funnel_stages fs
      LEFT JOIN segment_definitions sd ON sd.stage_id = fs.stage_id
      LEFT JOIN (
        SELECT segment_id, COUNT(*) AS cnt
        FROM segment_customers WHERE is_active = true
        GROUP BY segment_id
      ) sc ON sc.segment_id = sd.segment_id
      LEFT JOIN LATERAL (
        SELECT json_build_object(
          'name', os.name,
          'channels', os.channels,
          'flow_steps', os.flow_steps
        ) AS strategy_data
        FROM omnichannel_strategies os
        WHERE os.segment_label = sd.segment_name AND os.status = 'active'
        ORDER BY os.created_at DESC
        LIMIT 1
      ) strat ON true
      GROUP BY fs.stage_id
      ORDER BY fs.stage_number
    `);

    // Get summary stats
    const { rows: [stats] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM segment_definitions) AS total_segments,
        (SELECT COUNT(*) FROM funnel_stages) AS total_stages,
        (SELECT COUNT(*) FROM omnichannel_strategies WHERE status = 'active') AS active_strategies,
        (SELECT COUNT(DISTINCT customer_id) FROM segment_customers WHERE is_active = true) AS segmented_customers,
        (SELECT COUNT(*) FROM customers) AS total_customers
    `);

    // Get data schema from information_schema
    const { rows: columns } = await db.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('customers', 'bookings', 'whatsapp_enquiries', 'email_enquiries')
      ORDER BY table_name, ordinal_position
    `);

    return { stages, stats, schema: columns };
  }

  /**
   * Get a single segment with full details + associated strategy + customers
   */
  static async getSegmentDetail(segmentId) {
    const { rows: [segment] } = await db.query(`
      SELECT sd.*, fs.stage_name, fs.stage_number, fs.stage_color,
        (SELECT COUNT(*) FROM segment_customers WHERE segment_id = sd.segment_id AND is_active = true) AS customer_count
      FROM segment_definitions sd
      JOIN funnel_stages fs ON fs.stage_id = sd.stage_id
      WHERE sd.segment_id = $1
    `, [segmentId]);

    if (!segment) return null;

    // Get associated strategy
    const { rows: strategies } = await db.query(`
      SELECT * FROM omnichannel_strategies
      WHERE segment_label = $1
      ORDER BY created_at DESC
    `, [segment.segment_name]);

    // Get customer sample (first 50)
    const { rows: customers } = await db.query(`
      SELECT c.customer_id, c.first_name, c.last_name, c.email, c.phone_number,
             c.customer_type, c.nationality, c.gender, c.total_bookings, c.total_revenue,
             c.days_since_last_booking, c.lead_status, sc.assigned_at, sc.confidence
      FROM segment_customers sc
      JOIN customers c ON c.customer_id = sc.customer_id
      WHERE sc.segment_id = $1 AND sc.is_active = true
      ORDER BY sc.assigned_at DESC
      LIMIT 50
    `, [segmentId]);

    // Get segment metrics
    const { rows: [metrics] } = await db.query(`
      SELECT
        COUNT(*) AS total_customers,
        AVG(c.total_bookings)::NUMERIC(10,1) AS avg_bookings,
        AVG(c.total_revenue)::NUMERIC(12,2) AS avg_revenue,
        AVG(c.days_since_last_booking)::INTEGER AS avg_recency,
        COUNT(*) FILTER (WHERE c.gender = 'male') AS male_count,
        COUNT(*) FILTER (WHERE c.gender = 'female') AS female_count,
        COUNT(*) FILTER (WHERE c.whatsapp_opt_in = true) AS whatsapp_reachable,
        COUNT(*) FILTER (WHERE c.email_opt_in = true) AS email_reachable,
        COUNT(*) FILTER (WHERE c.sms_opt_in = true) AS sms_reachable
      FROM segment_customers sc
      JOIN customers c ON c.customer_id = sc.customer_id
      WHERE sc.segment_id = $1 AND sc.is_active = true
    `, [segmentId]);

    return { ...segment, strategies, customers, metrics };
  }

  /**
   * Get customers in a segment with pagination
   */
  static async getSegmentCustomers(segmentId, { page = 1, limit = 25, search, sortBy = 'assigned_at', sortDir = 'DESC' } = {}) {
    const offset = (page - 1) * limit;
    const allowed = ['assigned_at', 'total_bookings', 'total_revenue', 'days_since_last_booking', 'first_name', 'email'];
    const orderCol = allowed.includes(sortBy) ? sortBy : 'assigned_at';
    const dir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let where = 'sc.segment_id = $1 AND sc.is_active = true';
    const params = [segmentId];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
    }

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM segment_customers sc JOIN customers c ON c.customer_id = sc.customer_id WHERE ${where}`, params
    );

    const { rows } = await db.query(`
      SELECT c.*, sc.assigned_at, sc.confidence, sc.assigned_by
      FROM segment_customers sc
      JOIN customers c ON c.customer_id = sc.customer_id
      WHERE ${where}
      ORDER BY ${orderCol === 'assigned_at' ? 'sc.assigned_at' : 'c.' + orderCol} ${dir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    const totalCount = parseInt(count);
    return { data: rows, total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) };
  }

  /**
   * Run the segment engine: evaluate all 28 segment SQL criteria
   * and assign customers accordingly
   */
  static async runSegmentation() {
    const { rows: segments } = await db.query(
      'SELECT segment_id, segment_name, sql_criteria FROM segment_definitions ORDER BY segment_number'
    );

    const results = [];
    let totalAssigned = 0;

    for (const seg of segments) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Deactivate old assignments for this segment
        await client.query(
          'UPDATE segment_customers SET is_active = false WHERE segment_id = $1', [seg.segment_id]
        );

        // Run the segment SQL criteria against customers table
        const query = `
          INSERT INTO segment_customers (customer_id, segment_id, assigned_by, confidence)
          SELECT customer_id, $1, 'system', 1.0
          FROM customers
          WHERE ${seg.sql_criteria}
          ON CONFLICT (customer_id, segment_id)
          DO UPDATE SET is_active = true, assigned_at = NOW()
        `;

        const result = await client.query(query, [seg.segment_id]);
        await client.query('COMMIT');

        const count = result.rowCount || 0;
        totalAssigned += count;

        results.push({
          segment_id: seg.segment_id,
          segment_name: seg.segment_name,
          customers_assigned: count
        });
      } catch (err) {
        await client.query('ROLLBACK');
        results.push({
          segment_id: seg.segment_id,
          segment_name: seg.segment_name,
          error: err.message
        });
      } finally {
        client.release();
      }
    }

    // Update funnel stage counts
    await db.query(`
      UPDATE funnel_stages fs SET segment_count = (
        SELECT COUNT(*) FROM segment_definitions sd WHERE sd.stage_id = fs.stage_id
      )
    `);

    return { total_segments: segments.length, total_assigned: totalAssigned, results };
  }

  /**
   * Get segment summary stats across all stages
   */
  static async getSummaryStats() {
    const { rows: [stats] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(DISTINCT customer_id) FROM segment_customers WHERE is_active = true) AS segmented_customers,
        (SELECT COUNT(*) FROM segment_definitions) AS total_segments,
        (SELECT COUNT(*) FROM funnel_stages) AS total_stages,
        (SELECT COUNT(*) FROM omnichannel_strategies WHERE status = 'active') AS active_strategies
    `);

    const { rows: stageSummary } = await db.query(`
      SELECT fs.stage_number, fs.stage_name, fs.stage_color,
        COUNT(DISTINCT sc.customer_id) AS customer_count,
        COUNT(DISTINCT sd.segment_id) AS segment_count
      FROM funnel_stages fs
      LEFT JOIN segment_definitions sd ON sd.stage_id = fs.stage_id
      LEFT JOIN segment_customers sc ON sc.segment_id = sd.segment_id AND sc.is_active = true
      GROUP BY fs.stage_id
      ORDER BY fs.stage_number
    `);

    return { ...stats, stages: stageSummary };
  }

  /**
   * Get conversion metrics per segment
   */
  static async getConversionMetrics(segmentId) {
    const { rows } = await db.query(`
      SELECT
        ct.conversion_type,
        COUNT(*) AS conversions,
        SUM(ct.conversion_value) AS total_value,
        ct.source_channel,
        DATE_TRUNC('day', ct.converted_at) AS day
      FROM conversion_tracking ct
      WHERE ct.segment_id = $1
      GROUP BY ct.conversion_type, ct.source_channel, DATE_TRUNC('day', ct.converted_at)
      ORDER BY day DESC
      LIMIT 100
    `, [segmentId]);
    return rows;
  }
}

export default SegmentEngine;
