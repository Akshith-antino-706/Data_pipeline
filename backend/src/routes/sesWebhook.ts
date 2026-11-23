import { Router } from 'express';
import db from '../config/database.js';
import type { SesEventMessage } from '../types/routesMisc.js';
import type { U2SnsPayload } from '../types/u2Routes.js';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

const router = Router();

// ── SNS message signature verification ───────────────────────────────────────
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

/** The SNS envelope fields that take part in the signature. */
interface SnsSignedEnvelope extends Omit<U2SnsPayload, 'SubscribeURL'> {
  SubscribeURL?: string;
  MessageId?: string;
  Subject?: string;
  Timestamp?: string;
  Token?: string;
  TopicArn?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
}

const SNS_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;
const SIGNING_ALGS: Record<string, string> = { '1': 'RSA-SHA1', '2': 'RSA-SHA256' };
const CERT_CACHE_MAX = 20;
const certCache = new Map<string, Promise<KeyObject>>();

/** Only https://sns.<region>.amazonaws.com/<...>.pem is an acceptable signing cert URL. */
function isValidCertUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && SNS_HOST_RE.test(u.hostname) && !u.port && !u.username && !u.password
      && u.pathname.endsWith('.pem');
  } catch { return false; }
}

function getSigningKey(url: string): Promise<KeyObject> {
  const hit = certCache.get(url);
  if (hit) return hit;
  const p = (async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!r.ok) throw new Error(`cert fetch failed: HTTP ${r.status}`);
    return createPublicKey(await r.text());
  })();
  p.catch(() => certCache.delete(url));
  if (certCache.size >= CERT_CACHE_MAX) {
    const oldest = certCache.keys().next().value;
    if (oldest !== undefined) certCache.delete(oldest);
  }
  certCache.set(url, p);
  return p;
}

/** Build the SNS canonical string-to-sign for the given message type, or null if a field is missing. */
function snsStringToSign(msg: SnsSignedEnvelope, type: string): string | null {
  const keys = type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] as const
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'] as const;
  const fields: Record<string, unknown> = { ...msg, Type: type };
  let out = '';
  for (const k of keys) {
    const v = fields[k];
    if (v === undefined || v === null) {
      if (k === 'Subject') continue; // Subject is optional on notifications
      return null;
    }
    if (typeof v !== 'string') return null;
    out += `${k}\n${v}\n`;
  }
  return out;
}

/** True only if the message carries a valid AWS SNS signature. Never throws. */
async function verifySnsMessage(msg: SnsSignedEnvelope, type: string): Promise<boolean> {
  try {
    const alg = SIGNING_ALGS[String(msg.SignatureVersion ?? '')];
    if (!alg || typeof msg.Signature !== 'string' || !isValidCertUrl(msg.SigningCertURL)) return false;
    const data = snsStringToSign(msg, type);
    if (data === null) return false;
    const key = await getSigningKey(msg.SigningCertURL);
    return cryptoVerify(alg, Buffer.from(data, 'utf8'), key, Buffer.from(msg.Signature, 'base64'));
  } catch (err) {
    console.warn('[SES Webhook] SNS signature verification error:', (err as Error).message);
    return false;
  }
}

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
    let payload = req.body as U2SnsPayload | string;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload) as U2SnsPayload; } catch { return res.status(400).send('Invalid JSON'); }
    }

    const messageType = req.headers['x-amz-sns-message-type'] || payload?.Type;

    // Every message we act on must carry a valid AWS SNS signature (forged
    // Complaint/Bounce notifications would otherwise unsubscribe arbitrary addresses).
    if (messageType === 'SubscriptionConfirmation' || messageType === 'Notification') {
      if (!(await verifySnsMessage(payload as SnsSignedEnvelope, messageType))) {
        console.warn(`[SES Webhook] Rejected ${messageType} with an invalid SNS signature`);
        return res.status(403).send('Invalid signature');
      }
    }

    // ── 1. SNS Subscription Confirmation ──
    if (messageType === 'SubscriptionConfirmation') {
      const subscribeUrl = payload.SubscribeURL;
      console.log('[SES Webhook] SNS SubscriptionConfirmation received');
      let snsHost = null;
      try {
        const u = new URL(subscribeUrl);
        if (u.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) snsHost = u.hostname;
      } catch { /* invalid URL */ }
      if (snsHost) {
        await fetch(subscribeUrl, { signal: AbortSignal.timeout(10_000) });
        console.log('[SES Webhook] SNS subscription confirmed');
      } else if (subscribeUrl) {
        console.warn('[SES Webhook] Ignored SubscribeURL that is not an AWS SNS https URL');
      }
      return res.status(200).send('OK');
    }

    // ── 2. SNS Notification — SES Event ──
    if (messageType === 'Notification') {
      let message = payload.Message;
      if (typeof message === 'string') {
        try { message = JSON.parse(message) as SesEventMessage; } catch { return res.status(400).send('Invalid Message JSON'); }
      }
      const eventType = message?.eventType || message?.notificationType;
      if (!eventType) return res.status(200).send('OK');

      // Ack SNS first; process in background.
      res.status(200).send('OK');
      processEventAsync(message, eventType).catch((err: Error) =>
        console.error('[SES Webhook] async processing failed:', err.message)
      );
      return;
    }

    // Unknown type — still 200 so SNS doesn't retry.
    res.status(200).send('OK');
  } catch (err) {
    console.error('[SES Webhook] Error:', (err as Error).message);
    res.status(500).send('Error');
  }
});

/**
 * Async DB work — runs after the HTTP response is sent. Errors are logged but
 * not surfaced to SNS (avoids retry storms). For analytics events, the next
 * event for the same message_id will retry the update anyway.
 */
async function processEventAsync(message: SesEventMessage, eventType: string) {
  try {
    let email: string | null = null;
    let bounceType: string | null = null;
    let complaintType: string | null = null;

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
      const statusMap: Record<string, { status: string; extra?: string }> = {
        Delivery:  { status: 'delivered' },
        Bounce:    { status: 'bounced' },
        Complaint: { status: 'complained' },
        Open:      { status: 'opened',  extra: ", opened_at = COALESCE(opened_at, NOW())" },
        Click:     { status: 'clicked', extra: ", opened_at = COALESCE(opened_at, NOW()), clicked_at = COALESCE(clicked_at, NOW())" },
      };
      const mapping = statusMap[eventType];
      if (mapping) {
        // Phase 2: capture UA + IP from the SES Open/Click payload (COALESCE — first wins).
        const uaCol = eventType === 'Open' ? 'open_ua' : eventType === 'Click' ? 'click_ua' : null;
        const ipCol = eventType === 'Open' ? 'open_ip' : eventType === 'Click' ? 'click_ip' : null;
        const ua = eventType === 'Open' ? message.open?.userAgent : eventType === 'Click' ? message.click?.userAgent : null;
        const ip = eventType === 'Open' ? message.open?.ipAddress  : eventType === 'Click' ? message.click?.ipAddress  : null;
        const metaSet = uaCol ? `, ${uaCol} = COALESCE(${uaCol}, $3), ${ipCol} = COALESCE(${ipCol}, $4)` : '';
        const params = uaCol ? [mapping.status, messageId, ua || null, ip || null] : [mapping.status, messageId];
        await db.query(`
          UPDATE email_send_log
          SET status = $1 ${mapping.extra || ''} ${metaSet}
          WHERE external_id = $2
            AND status NOT IN ('bounced', 'complained')
            AND CASE
              WHEN $1 = 'delivered' THEN status IN ('queued', 'sent')
              WHEN $1 = 'opened'    THEN status NOT IN ('clicked')
              ELSE TRUE
            END
        `, params);
      }
    }

    // Auto-unsubscribe on permanent bounce or complaint.
    if (email && (eventType === 'Complaint' || (eventType === 'Bounce' && bounceType === 'Permanent'))) {
      const normalizedEmail = email.toLowerCase().trim();
      const { rowCount } = await db.query(`
        UPDATE unified_contacts
        SET email_unsubscribe = 'Yes', updated_at = NOW()
        WHERE LOWER(TRIM(email)) = $1 AND COALESCE(LOWER(email_unsubscribe), 'no') <> 'yes'
      `, [normalizedEmail]);

      if (rowCount! > 0) {
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
    console.error(`[SES Webhook] processEventAsync(${eventType}) failed:`, (err as Error).message);
  }
}

export default router;
