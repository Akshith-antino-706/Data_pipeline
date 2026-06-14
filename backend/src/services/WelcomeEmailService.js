import db from '../config/database.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SendTrackService } from './SendTrackService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '../templates/email/gtm-welcome.html');

/**
 * GTM event → welcome email.
 *
 * When a GTM event is recorded for a known contact (unified_id), send a short
 * welcome email to that contact after a short delay. Fully ASYNCHRONOUS and
 * non-blocking — `schedule()` returns immediately; the send runs later on a timer
 * and never affects the GTM event request/response.
 *
 * SAFETY — fires on live traffic, so it is OFF by default and allowlisted:
 *   WELCOME_ENABLED=true                       # master switch (default false)
 *   WELCOME_EMAILS=rocky@x.com,avinash@y.com   # only these emails may receive it
 *                                              #   (empty = nobody, so live users are never emailed)
 *   WELCOME_DELAY_MIN=2                         # minutes to wait after the trigger
 *
 * Per requirement, it fires on EVERY event (no once-only dedupe). Each send is
 * logged to email_send_log (source='gtm_welcome').
 */
class WelcomeEmailService {
  static _warned = false;

  static get _cfg() {
    return {
      enabled:  String(process.env.WELCOME_ENABLED || '').toLowerCase() === 'true',
      emails:   new Set((process.env.WELCOME_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
      delayMin: parseFloat(process.env.WELCOME_DELAY_MIN || '2'),
    };
  }

  /**
   * Fire-and-forget scheduler. Called (without await) from GTMService.recordEvent().
   * Enqueues a DURABLE delayed BullMQ job (no setTimeout) — survives restarts. The
   * welcome worker runs processJob() after the delay, off the request path.
   */
  static async schedule({ unifiedId, eventName, eventId }) {
    const cfg = this._cfg;
    if (!cfg.enabled || !unifiedId || cfg.emails.size === 0) return;

    // Gate at ENQUEUE time by the email allowlist so prod live traffic doesn't flood
    // the welcome queue with jobs that the worker would only skip. Resolve the contact
    // email first; only allowlisted contacts (rocky/avinash) ever create a job.
    const { rows: [c] } = await db.query('SELECT email FROM unified_contacts WHERE id = $1', [unifiedId]);
    if (!c?.email || !cfg.emails.has(c.email.toLowerCase())) return;

    const delayMs = Math.max(0, cfg.delayMin * 60_000);
    const delayLabel = cfg.delayMin < 1 ? `${Math.round(cfg.delayMin * 60)}s` : `${cfg.delayMin}m`;
    const { enqueueWelcome } = await import('./queue/index.js');
    const job = await enqueueWelcome({ unifiedId, eventName, eventId }, delayMs);
    console.log(`[Welcome] enqueued job#${job.id} uid=${unifiedId} <${c.email}> (trigger: ${eventName} #${eventId}) → send in ${delayLabel}`);
  }

  /** Called by the welcome BullMQ worker when the delayed job becomes due. */
  static async processJob({ unifiedId, eventName, eventId }) {
    if (!unifiedId) return;
    await this._send(unifiedId, eventName, eventId);
  }

  static async _send(unifiedId, triggerEvent, eventId) {
    const { rows: [c] } = await db.query(
      'SELECT id, email, name, email_unsubscribe FROM unified_contacts WHERE id = $1', [unifiedId]
    );
    if (!c?.email) { console.warn(`[Welcome] uid=${unifiedId} has no email — skipped`); return; }

    const cfg = this._cfg;
    if (cfg.emails.size > 0 && !cfg.emails.has(c.email.toLowerCase())) {
      console.log(`[Welcome] skip uid=${unifiedId} — ${c.email} not in WELCOME_EMAILS allowlist`);
      return;
    }
    if (String(c.email_unsubscribe || '').toLowerCase() === 'yes') {
      console.log(`[Welcome] skip uid=${unifiedId} — ${c.email} is unsubscribed`);
      return;
    }

    // Fetch the GTM event that triggered this so the email can show which event/data it came from
    let eventInfo = { eventName: triggerEvent, eventId, payload: {}, pageUrl: null, createdAt: null };
    if (eventId) {
      const { rows: [ev] } = await db.query(
        'SELECT event_id, event_name, page_url, raw_payload, created_at FROM gtm_events WHERE event_id = $1', [eventId]
      );
      if (ev) eventInfo = { eventName: ev.event_name, eventId: ev.event_id, payload: ev.raw_payload || {}, pageUrl: ev.page_url, createdAt: ev.created_at };
    }

    const { subject, html } = this._template(c, eventInfo);

    // Log the attempt to email_send_log (source='gtm_welcome') for visibility
    const logId = await SendTrackService.logSend({
      unifiedId: c.id, email: c.email, subject, templateLabel: 'GTM Welcome', source: 'gtm_welcome',
    });

    const EmailChannel = await this._loadEmailChannel();
    const start = Date.now();
    const result = await EmailChannel.send({ to: c.email, subject, html });
    const ms = Date.now() - start;

    if (result?.success) {
      await SendTrackService.markSent(logId, { externalId: result.externalId || null, provider: result.provider || null, durationMs: ms }).catch(() => {});
      console.log(`[Welcome] ✓ sent to ${c.email} (uid=${unifiedId}, trigger: ${triggerEvent}, log#${logId})`);
    } else {
      await SendTrackService.markFailed(logId, { error: result?.error || 'unknown', provider: result?.provider || null, durationMs: ms }).catch(() => {});
      console.log(`[Welcome] ✗ send failed to ${c.email}: ${result?.error || 'unknown'}`);
    }
  }

  static async _loadEmailChannel() {
    const { ChatheadEmailChannel } = await import('./channels/ChatheadEmailChannel.js');
    if (ChatheadEmailChannel.isConfigured()) return ChatheadEmailChannel;
    const { EmailChannel } = await import('./channels/EmailChannel.js');
    return EmailChannel;
  }

  static _template(contact, eventInfo = {}) {
    const name = (contact.name || '').split(' ')[0] || 'there';
    const ev = eventInfo || {};
    const p = ev.payload || {};
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const subject = `Welcome to Rayna Tours 🌴${ev.eventName ? ` — ${ev.eventName}` : ''}`;
    const rawJson = esc(JSON.stringify(p, null, 2));
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const html = raw
      .replaceAll('{{customer_name}}', esc(name))
      .replaceAll('{{cta_url}}', 'https://www.raynatours.com')
      .replaceAll('{{event_name}}',  esc(ev.eventName || '—'))
      .replaceAll('{{event_id}}',    esc(ev.eventId ?? '—'))
      .replaceAll('{{item_name}}',   esc(p.itemName || '—'))
      .replaceAll('{{page_url}}',    esc(ev.pageUrl || p.pageUrl || '—'))
      .replaceAll('{{event_time}}',  esc(ev.createdAt ? new Date(ev.createdAt).toLocaleString() : (p.timestamp || '—')))
      .replaceAll('{{raw_payload}}', rawJson);
    return { subject, html };
  }
}

export default WelcomeEmailService;
