import { Router } from 'express';
import db from '../config/database.js';

const router = Router();

/**
 * POST /api/webhooks/ses
 *
 * Receives AWS SES event notifications via SNS.
 * SNS sends Content-Type: text/plain, so we parse the body manually.
 *
 * Handles:
 * 1. SubscriptionConfirmation — auto-confirms SNS subscription
 * 2. Notification — stores SES event + auto-unsubscribes on bounce/complaint
 */
router.post('/ses', async (req, res) => {
  try {
    // SNS sends text/plain — body may be string or already parsed JSON
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { return res.status(400).send('Invalid JSON'); }
    }

    const messageType = req.headers['x-amz-sns-message-type'] || payload?.Type;

    // ── 1. SNS Subscription Confirmation ──
    if (messageType === 'SubscriptionConfirmation') {
      const subscribeUrl = payload.SubscribeURL;
      console.log('[SES Webhook] SNS SubscriptionConfirmation received');
      if (subscribeUrl) {
        // Auto-confirm by fetching the URL
        await fetch(subscribeUrl);
        console.log('[SES Webhook] SNS subscription confirmed');
      }
      return res.status(200).send('OK');
    }

    // ── 2. SNS Notification — SES Event ──
    if (messageType === 'Notification') {
      let message = payload.Message;
      if (typeof message === 'string') {
        try { message = JSON.parse(message); } catch { return res.status(400).send('Invalid Message JSON'); }
      }

      const eventType = message.eventType || message.notificationType;
      if (!eventType) return res.status(200).send('OK');

      // Extract email and details based on event type
      let email = null;
      let bounceType = null;
      let complaintType = null;

      switch (eventType) {
        case 'Bounce': {
          const bounce = message.bounce;
          bounceType = bounce?.bounceType || null;
          email = bounce?.bouncedRecipients?.[0]?.emailAddress || null;
          break;
        }
        case 'Complaint': {
          const complaint = message.complaint;
          complaintType = complaint?.complaintFeedbackType || null;
          email = complaint?.complainedRecipients?.[0]?.emailAddress || null;
          break;
        }
        case 'Delivery': {
          email = message.delivery?.recipients?.[0] || null;
          break;
        }
        case 'Send': {
          email = message.mail?.destination?.[0] || null;
          break;
        }
        case 'Open': {
          email = message.mail?.destination?.[0] || null;
          break;
        }
        case 'Click': {
          email = message.mail?.destination?.[0] || null;
          break;
        }
        default:
          email = message.mail?.destination?.[0] || null;
      }

      const messageId = message.mail?.messageId || null;

      // Store event in DB
      await db.query(`
        INSERT INTO ses_events (event_type, email, message_id, bounce_type, complaint_type, raw_payload)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [eventType, email?.toLowerCase(), messageId, bounceType, complaintType, JSON.stringify(message)]);

      // ── Update email_send_log status via messageId ──
      if (messageId) {
        const statusMap = {
          Delivery:  { status: 'delivered' },
          Bounce:    { status: 'bounced' },
          Complaint: { status: 'complained' },
          Open:      { status: 'opened',  extra: ", opened_at = COALESCE(opened_at, NOW())" },
          Click:     { status: 'clicked', extra: ", opened_at = COALESCE(opened_at, NOW()), clicked_at = COALESCE(clicked_at, NOW())" },
        };
        const mapping = statusMap[eventType];
        if (mapping) {
          await db.query(`
            UPDATE email_send_log
            SET status = $1 ${mapping.extra || ''}
            WHERE external_id = $2
              AND status NOT IN ('bounced', 'complained')
              AND CASE
                WHEN $1 = 'delivered' THEN status IN ('queued', 'sent')
                WHEN $1 = 'opened'    THEN status NOT IN ('clicked')
                ELSE TRUE
              END
          `, [mapping.status, messageId]);
        }
      }

      // Auto-unsubscribe on permanent bounce or complaint
      if (email && (eventType === 'Complaint' || (eventType === 'Bounce' && bounceType === 'Permanent'))) {
        const normalizedEmail = email.toLowerCase().trim();
        const { rowCount } = await db.query(`
          UPDATE unified_contacts
          SET email_unsubscribe = 'Yes', updated_at = NOW()
          WHERE LOWER(TRIM(email)) = $1 AND email_unsubscribe <> 'Yes'
        `, [normalizedEmail]);

        if (rowCount > 0) {
          // Log to unsubscribe_log — join email_send_log via messageId to get journey/node context
          await db.query(`
            INSERT INTO unsubscribe_log (unified_id, email, journey_id, node_id, campaign, source_log_id)
            SELECT
              COALESCE(esl.unified_id, uc.id),
              $1,
              esl.journey_id,
              esl.node_id,
              $3,
              esl.id
            FROM unified_contacts uc
            LEFT JOIN email_send_log esl
              ON esl.external_id = $2 AND esl.unified_id = uc.id
            WHERE LOWER(TRIM(uc.email)) = $1
            LIMIT 1
          `, [normalizedEmail, messageId, eventType.toLowerCase()]);
        }
        console.log(`[SES Webhook] ${eventType} (${bounceType || complaintType}) → unsubscribed: ${email}`);
      }

      return res.status(200).send('OK');
    }

    // Unknown type — still return 200 so SNS doesn't retry
    res.status(200).send('OK');
  } catch (err) {
    console.error('[SES Webhook] Error:', err.message);
    res.status(500).send('Error');
  }
});

export default router;
