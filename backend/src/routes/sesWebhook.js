import { Router } from 'express';
import db from '../config/database.js';

const router = Router();

// Skip Open/Click rows from ses_events — they're the highest-volume event types
// (scanner pre-fetch flood) and we already capture them via email_send_log.opened_at
// / clicked_at. Storing every Open/Click here adds millions of useless rows.
const EVENT_TYPES_TO_STORE = new Set(['Delivery', 'Bounce', 'Complaint', 'Send']);

// Only store raw_payload for events we'd actually debug. Skipping for Delivery
// (the highest-volume one we DO store) cuts ses_events row size by ~80%.
const EVENT_TYPES_TO_STORE_RAW = new Set(['Bounce', 'Complaint']);

/**
 * POST /api/webhooks/ses
 *
 * Receives AWS SES event notifications via SNS.
 * SNS sends Content-Type: text/plain, so we parse the body manually.
 *
 * Flow:
 *   1. SubscriptionConfirmation → auto-confirm
 *   2. Notification → ACK SNS immediately, then process DB writes asynchronously
 *      so the HTTP response time stays in single-digit ms regardless of DB load.
 *      Prevents SNS retry storms that compound DB pressure under high event rates.
 */
router.post('/ses', async (req, res) => {
  try {
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
      const eventType = message?.eventType || message?.notificationType;
      if (!eventType) return res.status(200).send('OK');

      // Ack SNS first; process in background.
      res.status(200).send('OK');
      processEventAsync(message, eventType).catch(err =>
        console.error('[SES Webhook] async processing failed:', err.message)
      );
      return;
    }

    // Unknown type — still 200 so SNS doesn't retry.
    res.status(200).send('OK');
  } catch (err) {
    console.error('[SES Webhook] Error:', err.message);
    res.status(500).send('Error');
  }
});

/**
 * Async DB work — runs after the HTTP response is sent. Errors are logged but
 * not surfaced to SNS (avoids retry storms). For analytics events, the next
 * event for the same message_id will retry the update anyway.
 */
async function processEventAsync(message, eventType) {
  try {
    let email = null;
    let bounceType = null;
    let complaintType = null;

    switch (eventType) {
      case 'Bounce':
        bounceType = message.bounce?.bounceType || null;
        email = message.bounce?.bouncedRecipients?.[0]?.emailAddress || null;
        break;
      case 'Complaint':
        complaintType = message.complaint?.complaintFeedbackType || null;
        email = message.complaint?.complainedRecipients?.[0]?.emailAddress || null;
        break;
      case 'Delivery':
        email = message.delivery?.recipients?.[0] || null;
        break;
      default:
        // Send / Open / Click / unknown — recipient is in mail.destination
        email = message.mail?.destination?.[0] || null;
    }

    const messageId = message.mail?.messageId || null;

    // Store event in ses_events — only for the types we actually query for analytics.
    // Open/Click are filtered out; their effect lives in email_send_log instead.
    if (EVENT_TYPES_TO_STORE.has(eventType)) {
      const rawPayload = EVENT_TYPES_TO_STORE_RAW.has(eventType) ? JSON.stringify(message) : null;
      await db.query(`
        INSERT INTO ses_events (event_type, email, message_id, bounce_type, complaint_type, raw_payload)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [eventType, email?.toLowerCase() || null, messageId, bounceType, complaintType, rawPayload]);
    }

    // Update email_send_log status via messageId (works for all event types incl. Open/Click).
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

    // Auto-unsubscribe on permanent bounce or complaint.
    if (email && (eventType === 'Complaint' || (eventType === 'Bounce' && bounceType === 'Permanent'))) {
      const normalizedEmail = email.toLowerCase().trim();
      const { rowCount } = await db.query(`
        UPDATE unified_contacts
        SET email_unsubscribe = 'Yes', updated_at = NOW()
        WHERE LOWER(TRIM(email)) = $1 AND email_unsubscribe <> 'Yes'
      `, [normalizedEmail]);

      if (rowCount > 0) {
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
        console.log(`[SES Webhook] ${eventType} (${bounceType || complaintType}) → unsubscribed: ${email}`);
      }
    }
  } catch (err) {
    console.error(`[SES Webhook] processEventAsync(${eventType}) failed:`, err.message);
  }
}

export default router;
