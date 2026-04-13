import { query } from '../config/database.js';

/**
 * ConversionDetector — Checks UTM clicks + GTM events + Rayna bookings
 * against active journey entries to detect conversions.
 *
 * Flow:
 *   1. UTM click   → user clicked campaign link (intent)
 *   2. GTM event   → user activity on site (engagement: add_to_cart, purchase, lead_submit)
 *   3. Rayna API   → actual confirmed booking (conversion)
 *
 * When a conversion is detected:
 *   - Journey entry marked as 'converted'
 *   - Customer stops receiving messages from that journey
 *   - computeSegments() moves them to new segment on next run
 *   - Auto-enrollment puts them into the new segment's journey
 */
export default class ConversionDetector {

  /**
   * Run full conversion detection across all active journeys
   */
  static async runAll() {
    console.log('[ConversionDetector] Starting conversion check...');
    const start = Date.now();

    const utmConversions = await this.checkUTMClicks();
    const gtmConversions = await this.checkGTMEvents();
    const bookingConversions = await this.checkRaynaBookings();
    const exited = await this.exitStaleEntries();
    const enrolled = await this.autoEnroll();

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[ConversionDetector] Done in ${duration}s — UTM: ${utmConversions}, GTM: ${gtmConversions}, Bookings: ${bookingConversions}, Exited: ${exited}, Enrolled: ${enrolled}`);

    return { utmConversions, gtmConversions, bookingConversions, exited, enrolled, duration };
  }

  /**
   * Step 1: Check UTM clicks — mark entries where the user clicked a campaign link
   * This doesn't convert them, but logs the engagement event on the journey entry.
   */
  static async checkUTMClicks() {
    const { rowCount } = await query(`
      INSERT INTO journey_events (entry_id, node_id, event_type, channel, details)
      SELECT je.entry_id, je.current_node_id, 'utm_clicked', 'email',
        jsonb_build_object('token', uul.token, 'click_count', uul.click_count, 'last_clicked_at', uul.last_clicked_at)
      FROM journey_entries je
      JOIN journey_flows jf ON jf.journey_id = je.journey_id
      JOIN campaigns c ON c.journey_id = jf.journey_id
      JOIN utm_tracking ut ON ut.campaign_id = c.id
      JOIN user_utm_links uul ON uul.utm_id = ut.utm_id AND uul.unified_id = je.customer_id
      WHERE je.status = 'active'
        AND uul.click_count > 0
        AND NOT EXISTS (
          SELECT 1 FROM journey_events jev
          WHERE jev.entry_id = je.entry_id AND jev.event_type = 'utm_clicked'
            AND (jev.details->>'token')::text = uul.token
        )
    `);
    if (rowCount > 0) console.log(`[ConversionDetector] UTM clicks logged: ${rowCount}`);
    return rowCount;
  }

  /**
   * Step 2: Check GTM events — detect purchase/lead_submit events from users in active journeys
   * A GTM 'purchase' or 'lead_submit' event = strong conversion signal
   */
  static async checkGTMEvents() {
    let converted = 0;

    // Check for purchase events in gtm_events
    try {
      const { rowCount } = await query(`
        UPDATE journey_entries je SET
          status = 'converted',
          converted_at = g.event_ts,
          exit_reason = 'gtm_purchase'
        FROM (
          SELECT ge.unified_id, MAX(ge.created_at) as event_ts
          FROM gtm_events ge
          WHERE ge.event_name IN ('purchase', 'begin_checkout', 'generate_lead')
            AND ge.unified_id IS NOT NULL
            AND ge.created_at > NOW() - INTERVAL '30 days'
          GROUP BY ge.unified_id
        ) g
        WHERE je.customer_id = g.unified_id
          AND je.status = 'active'
      `);
      converted += rowCount;
      if (rowCount > 0) console.log(`[ConversionDetector] GTM conversions: ${rowCount}`);
    } catch {
      // gtm_events table may not exist
    }

    // Also check ga4_events for purchase events
    try {
      const { rowCount } = await query(`
        UPDATE journey_entries je SET
          status = 'converted',
          converted_at = g.event_ts,
          exit_reason = 'ga4_purchase'
        FROM (
          SELECT ge.unified_id, MAX(ge.event_ts) as event_ts
          FROM ga4_events ge
          WHERE ge.event_name IN ('purchase', 'begin_checkout')
            AND ge.unified_id IS NOT NULL
            AND ge.event_ts > NOW() - INTERVAL '30 days'
          GROUP BY ge.unified_id
        ) g
        WHERE je.customer_id = g.unified_id
          AND je.status = 'active'
      `);
      converted += rowCount;
      if (rowCount > 0) console.log(`[ConversionDetector] GA4 conversions: ${rowCount}`);
    } catch {
      // ga4_events table may not exist
    }

    return converted;
  }

  /**
   * Step 3: Check Rayna booking APIs — the definitive conversion signal
   * If a customer in an active journey has a new booking since they entered the journey,
   * they've converted.
   */
  static async checkRaynaBookings() {
    let converted = 0;

    const tables = [
      { name: 'rayna_tours', dateCol: 'bill_date' },
      { name: 'rayna_hotels', dateCol: 'bill_date' },
      { name: 'rayna_visas', dateCol: 'bill_date' },
      { name: 'rayna_flights', dateCol: 'bill_date' },
    ];

    for (const t of tables) {
      const { rowCount } = await query(`
        UPDATE journey_entries je SET
          status = 'converted',
          converted_at = b.latest_booking,
          exit_reason = 'rayna_booking_${t.name}'
        FROM (
          SELECT unified_id, MAX(${t.dateCol}) as latest_booking
          FROM ${t.name}
          WHERE unified_id IS NOT NULL
          GROUP BY unified_id
        ) b
        WHERE je.customer_id = b.unified_id
          AND je.status = 'active'
          AND b.latest_booking > je.entered_at
      `);
      converted += rowCount;
      if (rowCount > 0) console.log(`[ConversionDetector] ${t.name} conversions: ${rowCount}`);
    }

    // Update journey conversion counts
    await query(`
      UPDATE journey_flows jf SET
        total_conversions = sub.cnt,
        conversion_rate = CASE WHEN jf.total_entries > 0
          THEN ROUND(sub.cnt::numeric / jf.total_entries * 100, 2) ELSE 0 END,
        updated_at = NOW()
      FROM (
        SELECT journey_id, COUNT(*) as cnt
        FROM journey_entries WHERE status = 'converted'
        GROUP BY journey_id
      ) sub
      WHERE jf.journey_id = sub.journey_id
    `);

    return converted;
  }

  /**
   * Exit stale entries — customers whose segment has changed since they entered
   * E.g., ACTIVE_ENQUIRY customer who became PAST_ENQUIRY (30+ days passed, no booking)
   */
  static async exitStaleEntries() {
    // Get journey → segment mapping from trigger nodes
    const { rows: journeys } = await query(`
      SELECT journey_id, nodes->0->'data'->>'segmentLabel' as segment_label
      FROM journey_flows
      WHERE status = 'active'
        AND jsonb_array_length(nodes) > 0
        AND nodes->0->>'type' = 'trigger'
    `);

    let totalExited = 0;

    for (const j of journeys) {
      if (!j.segment_label) continue;

      // Exit entries where the customer's current booking_status no longer matches this journey's segment
      const { rowCount } = await query(`
        UPDATE journey_entries je SET
          status = 'exited',
          exit_reason = 'segment_changed',
          completed_at = NOW()
        FROM unified_contacts uc
        WHERE je.customer_id = uc.unified_id
          AND je.journey_id = $1
          AND je.status = 'active'
          AND uc.booking_status != $2
      `, [j.journey_id, j.segment_label]);

      if (rowCount > 0) {
        totalExited += rowCount;
        console.log(`[ConversionDetector] Exited ${rowCount} from journey ${j.journey_id} (segment: ${j.segment_label})`);
      }

      // Update journey exit count
      await query(`
        UPDATE journey_flows SET
          total_exits = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1 AND status = 'exited'),
          updated_at = NOW()
        WHERE journey_id = $1
      `, [j.journey_id]);
    }

    return totalExited;
  }

  /**
   * Auto-enroll customers into their segment's journey
   * Runs after computeSegments() to pick up newly segmented customers
   */
  static async autoEnroll() {
    // Get all active journeys with their segment labels
    const { rows: journeys } = await query(`
      SELECT journey_id, nodes->0->'data'->>'segmentLabel' as segment_label
      FROM journey_flows
      WHERE status = 'active'
        AND jsonb_array_length(nodes) > 0
        AND nodes->0->>'type' = 'trigger'
    `);

    let totalEnrolled = 0;

    for (const j of journeys) {
      if (!j.segment_label) continue;

      // Enroll unified_contacts in this segment who aren't already in any active journey entry
      const { rowCount } = await query(`
        INSERT INTO journey_entries (journey_id, customer_id, current_node_id, status)
        SELECT $1, uc.unified_id, $3, 'active'
        FROM unified_contacts uc
        WHERE uc.booking_status = $2
          AND uc.email IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM journey_entries je
            WHERE je.customer_id = uc.unified_id
              AND je.journey_id = $1
              AND je.status = 'active'
          )
        LIMIT 1000
      `, [j.journey_id, j.segment_label, 'trigger-1']);

      if (rowCount > 0) {
        totalEnrolled += rowCount;
        console.log(`[ConversionDetector] Enrolled ${rowCount} into ${j.segment_label} journey`);

        // Update journey entry count
        await query(`
          UPDATE journey_flows SET
            total_entries = (SELECT COUNT(*) FROM journey_entries WHERE journey_id = $1),
            updated_at = NOW()
          WHERE journey_id = $1
        `, [j.journey_id]);
      }
    }

    return totalEnrolled;
  }
}
