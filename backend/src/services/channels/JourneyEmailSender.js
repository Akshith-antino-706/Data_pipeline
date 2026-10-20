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

// credential → env prefix. Each needs <PREFIX>_SMTP_HOST/PORT/SECURE/USER/PASS and
// optionally <PREFIX>_FROM (defaults to the SMTP user).
const SMTP_CREDENTIALS = {
  giveaway:  'GIVEAWAY',
  affiliate: 'AFFILIATE',
};

const _transports = new Map();   // credential → nodemailer transport (built once, reused)

function smtpTransport(credential, prefix) {
  if (_transports.has(credential)) return _transports.get(credential);
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

async function sendViaSmtp({ credential, prefix, to, subject, html }) {
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
    return { success: false, provider, error: err.message, durationMs: Date.now() - start };
  }
}

/**
 * Send a journey email through the transport selected by `emailCredential`.
 * An unknown credential falls back to the default AWS channel rather than failing the send.
 * @param {{ emailCredential?: string, to: string, subject: string, html: string }} args
 */
export async function sendJourneyEmail({ emailCredential, to, subject, html }) {
  const prefix = SMTP_CREDENTIALS[emailCredential];
  if (prefix) {
    return sendViaSmtp({ credential: emailCredential, prefix, to, subject, html });
  }
  return ChatheadEmailChannel.send({ to, subject, html });
}

export default { sendJourneyEmail };
