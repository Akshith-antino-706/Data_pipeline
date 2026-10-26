/**
 * JourneyEmailSender — picks the email transport for a journey send based on the
 * journey's chosen credential (set in the create-journey modal, stored on
 * journey_flows.email_credential).
 *
 *   'default'   → AWS Email API   (ChatheadEmailChannel — the normal journey sender)
 *   'giveaway'  → giveaway SMTP   (nodemailer, GIVEAWAY_SMTP_*  / GIVEAWAY_FROM)
 *   'affiliate' → affiliate SMTP  (nodemailer, AFFILIATE_SMTP_* / AFFILIATE_FROM)
 *
 * Every branch returns the same result shape so callers don't care which was used.
 * Adding another mailbox is a new entry in SMTP_CREDENTIALS plus its env vars — the
 * send path itself doesn't change.
 */
import nodemailer from 'nodemailer';
import ChatheadEmailChannel from './ChatheadEmailChannel.js';
import { isEmailAllowed } from '../../utils/emailAllowlist.js';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { EmailSendResult, JourneyEmailArgs } from '../../types/channels.js';
import { signUnsubToken } from '../../utils/unsubToken.js';

// Host serving /api/unsubscribe (the prod reverse proxy gives every non-/api path to the frontend).
const UNSUB_SITE = (process.env.PUBLIC_UNSUB_URL || 'https://promotions.raynatours.com').replace(/\/+$/, '');

/**
 * RFC 8058 one-click unsubscribe headers.
 *
 * Gmail and Yahoo have required these of bulk senders since February 2024 — mail without them
 * is filtered on policy, however clean SPF/DKIM/DMARC are. The URL is the POST endpoint that
 * performs the opt-out, carrying a signed token so no extra lookup is needed. Returns {} when
 * there's no contact id, so the pair is never sent half-formed (a List-Unsubscribe that 404s
 * is worse than none at all).
 */
function unsubscribeHeaders(unifiedId: string | number | null | undefined): Record<string, string> {
  if (unifiedId == null || `${unifiedId}` === '') return {};
  const url = `${UNSUB_SITE}/api/unsubscribe/confirm?t=${encodeURIComponent(signUnsubToken(unifiedId))}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Plain-text alternative. HTML-only mail scores worse with every major filter, so send a
 * readable text part rather than none. Intentionally simple — strip script/style/comments,
 * turn block ends into newlines, drop remaining tags, decode the entities our templates use.
 */
function htmlToText(html: string | null | undefined): string {
  return String(html || '')
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#8204;|&zwnj;/gi, ' ')
    .replace(/&middot;/gi, '·').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// credential → env prefix. Each needs <PREFIX>_SMTP_HOST/PORT/SECURE/USER/PASS and
// optionally <PREFIX>_FROM (defaults to the SMTP user).
const SMTP_CREDENTIALS = {
  giveaway:  'GIVEAWAY',
  affiliate: 'AFFILIATE',
} as const;

type SmtpCredential = keyof typeof SMTP_CREDENTIALS;
type SmtpPrefix = (typeof SMTP_CREDENTIALS)[SmtpCredential];
type SmtpTransporter = Transporter<SMTPTransport.SentMessageInfo>;

function isSmtpCredential(c: string | null | undefined): c is SmtpCredential {
  return c != null && Object.prototype.hasOwnProperty.call(SMTP_CREDENTIALS, c);
}

const _transports = new Map<SmtpCredential, SmtpTransporter>();   // credential → nodemailer transport (built once, reused)

function smtpTransport(credential: SmtpCredential, prefix: SmtpPrefix): SmtpTransporter {
  const cached = _transports.get(credential);
  if (cached) return cached;
  const tx = nodemailer.createTransport({
    host:   process.env[`${prefix}_SMTP_HOST`],
    port:   parseInt(process.env[`${prefix}_SMTP_PORT`] || '465', 10),
    secure: process.env[`${prefix}_SMTP_SECURE`] === 'true',
    auth: {
      user: process.env[`${prefix}_SMTP_USER`],
      pass: process.env[`${prefix}_SMTP_PASS`],
    },
  });
  _transports.set(credential, tx);
  return tx;
}

interface SmtpSendArgs extends Omit<JourneyEmailArgs, 'emailCredential'> {
  credential: SmtpCredential;
  prefix: SmtpPrefix;
}

async function sendViaSmtp({ credential, prefix, to, subject, html, unifiedId }: SmtpSendArgs): Promise<EmailSendResult> {
  const provider = `${credential}-smtp`;
  // Same allow-list backstop the AWS channel enforces.
  if (!isEmailAllowed(to)) {
    console.log(`[${provider}] Skipped — ${to} not in WELCOME_EMAILS allow-list`);
    return { success: false, skipped: true, reason: 'not_in_allowlist', provider: 'allowlist' };
  }
  if (!process.env[`${prefix}_SMTP_HOST`] || !process.env[`${prefix}_SMTP_USER`]) {
    return { success: false, error: `${credential} SMTP not configured (${prefix}_SMTP_* missing)`, provider };
  }
  const start = Date.now();
  try {
    const info = await smtpTransport(credential, prefix).sendMail({
      from: process.env[`${prefix}_FROM`] || process.env[`${prefix}_SMTP_USER`],
      to, subject, html,
      text: htmlToText(html),                  // multipart/alternative — HTML-only scores worse
      headers: unsubscribeHeaders(unifiedId),  // RFC 8058 one-click opt-out (Gmail/Yahoo require it)
    });
    return { success: true, provider, externalId: info.messageId, durationMs: Date.now() - start };
  } catch (err) {
    return { success: false, provider, error: (err as Error).message, durationMs: Date.now() - start };
  }
}

/**
 * Send a journey email through the transport selected by `emailCredential`.
 * An unknown credential falls back to the default AWS channel rather than failing the send.
 */
export async function sendJourneyEmail({ emailCredential, to, subject, html, unifiedId = null }: JourneyEmailArgs): Promise<EmailSendResult> {
  if (isSmtpCredential(emailCredential)) {
    return sendViaSmtp({ credential: emailCredential, prefix: SMTP_CREDENTIALS[emailCredential], to, subject, html, unifiedId });
  }
  // The AWS channel posts a fixed JSON payload to the relay and has no header field, so the
  // List-Unsubscribe pair can't be attached there — those templates carry {{UNSUBSCRIBE_URL}}
  // in the body instead.
  return ChatheadEmailChannel.send({ to, subject, html });
}

export default { sendJourneyEmail };
