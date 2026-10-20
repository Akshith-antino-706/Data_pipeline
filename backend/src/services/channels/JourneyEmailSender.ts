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

async function sendViaSmtp({ credential, prefix, to, subject, html }: SmtpSendArgs): Promise<EmailSendResult> {
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
export async function sendJourneyEmail({ emailCredential, to, subject, html }: JourneyEmailArgs): Promise<EmailSendResult> {
  if (isSmtpCredential(emailCredential)) {
    return sendViaSmtp({ credential: emailCredential, prefix: SMTP_CREDENTIALS[emailCredential], to, subject, html });
  }
  return ChatheadEmailChannel.send({ to, subject, html });
}

export default { sendJourneyEmail };
