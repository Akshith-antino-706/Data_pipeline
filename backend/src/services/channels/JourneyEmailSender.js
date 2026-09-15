/**
 * JourneyEmailSender — picks the email transport for a journey send based on the
 * journey's chosen credential (set in the create-journey modal, stored on
 * journey_flows.email_credential).
 *
 *   'default'  → AWS Email API      (ChatheadEmailChannel — the normal journey sender)
 *   'giveaway' → giveaway SMTP       (nodemailer, GIVEAWAY_SMTP_* / GIVEAWAY_FROM)
 *
 * Both branches return the same result shape so callers don't care which was used.
 */
import nodemailer from 'nodemailer';
import ChatheadEmailChannel from './ChatheadEmailChannel.js';
import { isEmailAllowed } from '../../utils/emailAllowlist.js';

let _giveawayTx = null;
function giveawayTransport() {
  if (_giveawayTx) return _giveawayTx;
  _giveawayTx = nodemailer.createTransport({
    host: process.env.GIVEAWAY_SMTP_HOST,
    port: parseInt(process.env.GIVEAWAY_SMTP_PORT || '465', 10),
    secure: process.env.GIVEAWAY_SMTP_SECURE === 'true',
    auth: { user: process.env.GIVEAWAY_SMTP_USER, pass: process.env.GIVEAWAY_SMTP_PASS },
  });
  return _giveawayTx;
}

async function sendViaGiveawaySmtp({ to, subject, html }) {
  // Same allow-list backstop the AWS channel enforces.
  if (!isEmailAllowed(to)) {
    console.log(`[Giveaway SMTP] Skipped — ${to} not in WELCOME_EMAILS allow-list`);
    return { success: false, skipped: true, reason: 'not_in_allowlist', provider: 'allowlist' };
  }
  if (!process.env.GIVEAWAY_SMTP_HOST || !process.env.GIVEAWAY_SMTP_USER) {
    return { success: false, error: 'giveaway SMTP not configured (GIVEAWAY_SMTP_* missing)', provider: 'giveaway-smtp' };
  }
  const start = Date.now();
  try {
    const info = await giveawayTransport().sendMail({
      from: process.env.GIVEAWAY_FROM || process.env.GIVEAWAY_SMTP_USER,
      to, subject, html,
    });
    return { success: true, provider: 'giveaway-smtp', externalId: info.messageId, durationMs: Date.now() - start };
  } catch (err) {
    return { success: false, provider: 'giveaway-smtp', error: err.message, durationMs: Date.now() - start };
  }
}

/**
 * Send a journey email through the transport selected by `emailCredential`.
 * @param {{ emailCredential?: string, to: string, subject: string, html: string }} args
 */
export async function sendJourneyEmail({ emailCredential, to, subject, html }) {
  if (emailCredential === 'giveaway') {
    return sendViaGiveawaySmtp({ to, subject, html });
  }
  return ChatheadEmailChannel.send({ to, subject, html });
}

export default { sendJourneyEmail };
