/**
 * Daily offer email — failure alert to the team.
 *
 * When a day's email is certain not to go out, one email (daily-email styling) goes to the team
 * (DAILY_OFFER_ALERT_EMAILS, else the EMAIL_CAP_BYPASS_EMAILS QA inboxes) with the
 * date, the step that failed and the reason. "Certain" means:
 *   create       the last create attempt of the day (retryUntil) still skipped
 *   final check  the 3:45 check skipped the journey, or found none
 *   send check   at sendCheckAt (17:30), the journey has no sends at all
 *   crash        any of the above threw
 * Never throws — an alert problem must not affect the email job itself.
 */
import { sendJourneyEmail } from '../channels/JourneyEmailSender.js';
import { ordinalDate } from './DailyOfferService.js';
import { EMAIL_HEAD } from './emailShell.js';
import type { CreateResult, FinalCheckResult, SendCheckResult } from './DailyOfferService.js';

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export type AlertStage = 'create' | 'final check' | 'send check';
export interface AlertInfo { reason: string; message: string; journeyId?: number | null }
export type JobResult = CreateResult | FinalCheckResult | SendCheckResult;

/** Same shape as sendJourneyEmail's result — the alert only reads these fields. */
type SendFn = (m: { to: string; subject: string; html: string }) => Promise<{ success: boolean; error?: string; reason?: string } | null | undefined>;

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Team inboxes that get the alert. */
export function alertRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.DAILY_OFFER_ALERT_EMAILS || env.EMAIL_CAP_BYPASS_EMAILS || '';
  return [...new Set(raw.split(',').map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

/**
 * The alert to send for a job result, or null when there is nothing to report yet.
 *   stage   'create' | 'final check' | 'send check'
 *   result  what the DailyOfferService run returned
 *   lastTry true when no create attempt is left today
 */
export function alertFor(stage: string, result: JobResult | null | undefined, { lastTry = false }: { lastTry?: boolean } = {}): AlertInfo | null {
  if (!result) return null;
  if (stage === 'create') {
    return result.status === 'skipped' && 'reason' in result && lastTry
      ? { reason: result.reason, message: `${result.message} — no more attempts today, so no journey was created.` }
      : null;
  }
  if (stage === 'final check') {
    if (result.status === 'skipped' && 'reason' in result) return { reason: result.reason, message: result.message, journeyId: 'journeyId' in result ? result.journeyId : null };
    if (result.status === 'none') return { reason: 'no_journey', message: 'No daily offer journey was created today (every create attempt failed or the server was down).' };
    return null;
  }
  if (stage === 'send check') {
    return result.status === 'not_sent' && 'message' in result ? { reason: 'not_sent', message: result.message, journeyId: result.journeyId } : null;
  }
  return null;
}

/**
 * Alert body in the daily email's own format — same head (logo, fonts, dark mode) and black
 * footer band, without the promo blocks, review badges or unsubscribe link of a customer email.
 */
export interface AlertEmail extends AlertInfo { date: string; stage: string; segmentId: number }

export function alertHtml({ date, stage, reason, message, journeyId = null, segmentId }: AlertEmail): string {
  const row = (k: string, v: string, last = false): string => `<tr><td class="ff-b dm-label dm-rule" style="padding:10px 14px 10px 0;${last ? '' : 'border-bottom:1px solid #ECECEC;'}font-size:12px;line-height:18px;letter-spacing:.08em;text-transform:uppercase;color:#8A8A8A;white-space:nowrap;vertical-align:top;">${k}</td><td class="ff-b dm-strong dm-rule" style="padding:10px 0;${last ? '' : 'border-bottom:1px solid #ECECEC;'}font-size:14px;line-height:20px;color:#000;">${v}</td></tr>`;
  const rows: Array<[string, string]> = [
    ['Date', esc(ordinalDate(date))],
    ['Failed at', esc(stage)],
    ['Reason', esc(reason)],
    ['Details', esc(message)],
    ...(journeyId ? [['Journey', `#${esc(journeyId)}`] as [string, string]] : []),
    ['Audience', `Segment ${esc(segmentId)}`],
  ];
  const head = EMAIL_HEAD
    .replace('%%DO_TITLE%%', 'Daily offer email not sent')
    .replace('%%DO_PREHEADER%%', esc(`${ordinalDate(date)}: ${reason}`));
  return `${head}
<tr><td class="px dm-cardbg" style="padding:26px 38px 6px 38px;background-color:#FFFFFF;text-align:center;">
<p class="ff-b dm-label" style="margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#B91C1C;">Daily offer alert</p>
<h1 class="ff-d dm-h h1" style="margin:0 0 14px;font-size:28px;line-height:36px;font-weight:600;color:#000;">Today's email was not sent</h1>
<p class="ff-b dm-sub" style="margin:0 auto;max-width:420px;font-size:14px;line-height:23px;font-weight:300;color:#6B6B6B;">The automated daily offer email for ${esc(ordinalDate(date))} will not go out. Tomorrow runs as normal.</p>
</td></tr>
<tr><td class="px dm-cardbg" style="padding:24px 38px 40px 38px;background-color:#FFFFFF;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="dm-box" style="background:#FBF6EA;border:1px solid #E4CE93;"><tr><td style="padding:8px 22px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
${rows.map(([k, v], i) => row(k, v, i === rows.length - 1)).join('\n')}
</table>
</td></tr></table>
</td></tr>
<tr><td class="px dm-foot" style="padding:24px 38px;background-color:#000000;text-align:center;">
<p class="ff-b" style="margin:0 0 6px;font-size:13px;line-height:20px;font-weight:bold;color:#FFFFFF;">Rayna data pipeline</p>
<p class="ff-b" style="margin:0;font-size:10.5px;line-height:17px;color:#8996A5;">Internal alert &middot; sent to the QA inboxes only</p>
</td></tr>
</table>
</div>
<!--[if mso]></td></tr></table><![endif]-->
</center>
</body>
</html>`;
}

/** Email every team inbox about a failed day. Returns how many were sent. */
export async function sendFailureAlert({ date, stage, reason, message, journeyId = null, segmentId, send = sendJourneyEmail, env = process.env, log = console }:
  AlertEmail & { send?: SendFn; env?: NodeJS.ProcessEnv; log?: Logger }): Promise<number> {
  const to = alertRecipients(env);
  if (!to.length) { log.warn('[DailyOffer] failure alert not sent — no DAILY_OFFER_ALERT_EMAILS / EMAIL_CAP_BYPASS_EMAILS'); return 0; }
  const subject = `⚠️ Daily offer email not sent — ${ordinalDate(date)}`;
  const html = alertHtml({ date, stage, reason, message, journeyId, segmentId });
  let sent = 0;
  for (const email of to) {
    try {
      const r = await send({ to: email, subject, html });
      if (r?.success) sent += 1;
      else log.warn(`[DailyOffer] failure alert to ${email} failed: ${r?.error || r?.reason || 'unknown'}`);
    } catch (e) {
      log.warn(`[DailyOffer] failure alert to ${email} failed: ${(e as Error).message}`);
    }
  }
  log.log(`[DailyOffer] failure alert (${stage}: ${reason}) sent to ${sent}/${to.length}`);
  return sent;
}
