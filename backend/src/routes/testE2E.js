import { Router } from 'express';
import { query } from '../config/database.js';
import { EmailChannel } from '../services/channels/EmailChannel.js';
import EmailRenderer from '../services/EmailRenderer.js';

const router = Router();

const TEST_USERS = [
  { unified_id: 1369472, name: 'Akshith Kumar', email: 'akshith@antino.com' },
  { unified_id: 1811248, name: 'Vaibhav Gupta', email: 'vaibhav@raynatours.com' },
  { unified_id: 1811249, name: 'Alok', email: 'alok@raynatours.com' },
  { unified_id: 90551, name: 'Anket Hinge', email: 'anket@raynatours.com' },
];

/**
 * POST /api/v3/test/send-journey-emails
 * Sends the first email from each user's segment journey with real HTML templates + UTM links
 */
router.post('/send-journey-emails', async (_req, res, next) => {
  try {
    const results = [];

    for (const user of TEST_USERS) {
      // Get user's segment
      const { rows: [uc] } = await query('SELECT * FROM unified_contacts WHERE unified_id = $1', [user.unified_id]);
      if (!uc) { results.push({ user: user.name, error: 'not found' }); continue; }

      // Find the first email template for this segment
      const { rows: [tpl] } = await query(`
        SELECT ct.* FROM content_templates ct
        WHERE ct.segment_label = $1 AND ct.channel = 'email' AND ct.html_template_id IS NOT NULL
        ORDER BY ct.id LIMIT 1
      `, [uc.booking_status]);

      if (!tpl) { results.push({ user: user.name, segment: uc.booking_status, error: 'no email template' }); continue; }

      // Find campaign for this segment+channel
      const { rows: [campaign] } = await query(
        "SELECT * FROM campaigns WHERE segment_label = $1 AND channel = 'email' LIMIT 1",
        [uc.booking_status]
      );

      // Generate user-level UTM link
      let utmLink = 'https://www.raynatours.com/activities';
      if (campaign) {
        try {
          const { rows: [utm] } = await query('SELECT * FROM utm_tracking WHERE campaign_id = $1 LIMIT 1', [campaign.id]);
          if (utm) {
            // Create or get user-level link
            const { rows: [existing] } = await query(
              'SELECT * FROM user_utm_links WHERE utm_id = $1 AND unified_id = $2',
              [utm.utm_id, user.unified_id]
            );
            if (existing) {
              utmLink = `/api/v3/utm/track/${existing.token}`;
            } else {
              const token = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
              await query(
                'INSERT INTO user_utm_links (utm_id, unified_id, token, destination_url, customer_email, customer_name) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
                [utm.utm_id, user.unified_id, token, utm.full_url || 'https://www.raynatours.com/activities', user.email, user.name]
              );
              utmLink = `/api/v3/utm/track/${token}`;
            }
            // Make it a full URL
            const host = _req.get('host');
            const proto = _req.protocol;
            utmLink = `${proto}://${host}${utmLink}`;
          }
        } catch (e) { console.error('UTM gen failed:', e.message); }
      }

      // Render HTML email
      const rendered = await EmailRenderer.render(tpl.id, user.unified_id, { utm_link: utmLink });

      // Send real email
      const sendResult = await EmailChannel.send({
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.plainText,
      });

      // Log journey event if enrolled
      const { rows: [entry] } = await query(
        "SELECT entry_id FROM journey_entries WHERE customer_id = $1 AND status = 'active' LIMIT 1",
        [user.unified_id]
      );
      if (entry) {
        await query(
          "INSERT INTO journey_events (entry_id, node_id, event_type, channel, details) VALUES ($1, 'test-send', 'action_sent', 'email', $2)",
          [entry.entry_id, JSON.stringify({ templateId: tpl.id, to: user.email, utmLink })]
        );
      }

      // Update campaign sent count
      if (campaign) {
        await query('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1', [campaign.id]);
      }

      results.push({
        user: user.name,
        email: user.email,
        segment: uc.booking_status,
        template: tpl.name,
        htmlTemplate: tpl.html_template_id ? 'YES' : 'text-only',
        utmLink,
        sent: sendResult.success,
        messageId: sendResult.externalId,
        error: sendResult.error,
      });
    }

    res.json({ success: true, results });
  } catch (err) { next(err); }
});

/**
 * POST /api/v3/test/enroll-users
 * Enroll all 4 test users into their segment's journey
 */
router.post('/enroll-users', async (_req, res, next) => {
  try {
    const results = [];

    for (const user of TEST_USERS) {
      const { rows: [uc] } = await query('SELECT booking_status FROM unified_contacts WHERE unified_id = $1', [user.unified_id]);
      if (!uc) { results.push({ user: user.name, error: 'not found' }); continue; }

      // Find journey for this segment
      const { rows: [journey] } = await query(`
        SELECT journey_id, name FROM journey_flows
        WHERE status = 'active' AND nodes->0->'data'->>'segmentLabel' = $1
        LIMIT 1
      `, [uc.booking_status]);

      if (!journey) { results.push({ user: user.name, segment: uc.booking_status, error: 'no journey' }); continue; }

      // Enroll (skip if already enrolled)
      const { rowCount } = await query(`
        INSERT INTO journey_entries (journey_id, customer_id, current_node_id, status)
        VALUES ($1, $2, 'trigger-1', 'active')
        ON CONFLICT (journey_id, customer_id) DO NOTHING
      `, [journey.journey_id, user.unified_id]);

      results.push({
        user: user.name,
        segment: uc.booking_status,
        journey: journey.name,
        enrolled: rowCount > 0 ? 'NEW' : 'ALREADY_ENROLLED',
      });
    }

    res.json({ success: true, results });
  } catch (err) { next(err); }
});

/**
 * GET /api/v3/test/status
 * Check status of all test users — segment, journey position, UTM clicks, affinity
 */
router.get('/status', async (_req, res, next) => {
  try {
    const results = [];

    for (const user of TEST_USERS) {
      const { rows: [uc] } = await query(`
        SELECT unified_id, name, email, booking_status, product_tier, geography, is_indian, segment_label,
          current_occasion, total_tour_bookings, total_chats
        FROM unified_contacts WHERE unified_id = $1
      `, [user.unified_id]);

      // Journey status
      const { rows: entries } = await query(`
        SELECT je.entry_id, je.current_node_id, je.status, je.entered_at, je.converted_at, je.exit_reason,
          jf.name as journey_name
        FROM journey_entries je
        JOIN journey_flows jf ON jf.journey_id = je.journey_id
        WHERE je.customer_id = $1
        ORDER BY je.entered_at DESC
      `, [user.unified_id]);

      // UTM clicks
      const { rows: clicks } = await query(`
        SELECT uul.token, uul.click_count, uul.first_clicked_at, uul.last_clicked_at,
          ut.utm_campaign, c.name as campaign_name
        FROM user_utm_links uul
        JOIN utm_tracking ut ON ut.utm_id = uul.utm_id
        LEFT JOIN campaigns c ON c.id = ut.campaign_id
        WHERE uul.unified_id = $1
      `, [user.unified_id]);

      // Product affinity
      const { rows: affinity } = await query(`
        SELECT product_name, affinity_score, view_count, cart_count, purchase_count, last_seen_at
        FROM user_product_affinity
        WHERE unified_id = $1 AND affinity_score > 0
        ORDER BY affinity_score DESC LIMIT 5
      `, [user.unified_id]);

      // Journey events
      const { rows: events } = await query(`
        SELECT je.event_type, je.channel, je.node_id, je.created_at
        FROM journey_events je
        JOIN journey_entries jen ON jen.entry_id = je.entry_id
        WHERE jen.customer_id = $1
        ORDER BY je.created_at DESC LIMIT 10
      `, [user.unified_id]);

      results.push({
        ...uc,
        journeys: entries,
        utmClicks: clicks,
        productAffinity: affinity,
        recentEvents: events,
      });
    }

    res.json({ success: true, results });
  } catch (err) { next(err); }
});

/**
 * POST /api/v3/test/generate-utm-links
 * Generate user-level UTM links for all test users across all their segment campaigns
 */
router.post('/generate-utm-links', async (_req, res, next) => {
  try {
    const results = [];

    for (const user of TEST_USERS) {
      const { rows: [uc] } = await query('SELECT booking_status FROM unified_contacts WHERE unified_id = $1', [user.unified_id]);
      if (!uc) continue;

      // Get all campaigns for this segment
      const { rows: campaigns } = await query(
        'SELECT c.id, c.name, c.channel, ut.utm_id, ut.full_url FROM campaigns c JOIN utm_tracking ut ON ut.campaign_id = c.id WHERE c.segment_label = $1',
        [uc.booking_status]
      );

      for (const c of campaigns) {
        const token = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        const { rowCount } = await query(
          'INSERT INTO user_utm_links (utm_id, unified_id, token, destination_url, customer_email, customer_name) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
          [c.utm_id, user.unified_id, token, c.full_url || 'https://www.raynatours.com/activities', user.email, user.name]
        );

        if (rowCount > 0) {
          results.push({ user: user.name, campaign: c.name, channel: c.channel, token });
        }
      }
    }

    res.json({ success: true, generated: results.length, links: results });
  } catch (err) { next(err); }
});

export default router;
