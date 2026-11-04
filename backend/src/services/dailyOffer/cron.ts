/**
 * Daily offer email — cron registration (called once from server.js).
 *
 * Does nothing unless DAILY_OFFER_ENABLED=true. Three jobs (Dubai time):
 *   create      every 30 min between createAt and retryUntil (09:00–14:00); a no-op once
 *               today's journey exists, so a success at 9:00 means no further downloads.
 *   final check once at checkAt (15:45) → schedules the 16:00 start, or records why not.
 *   send check  once at sendCheckAt (17:30) → were any emails actually sent?
 * A day that will not go out emails the team once (alert.js).
 */
import { getDailyOfferConfig, dubaiDate, dubaiMinutes, hhmmToMinutes } from './config.js';
import DailyOfferService from './DailyOfferService.js';
import type cronLib from 'node-cron';
import { alertFor, alertRecipients, sendFailureAlert } from './alert.js';
import type { AlertInfo, AlertStage, JobResult } from './alert.js';

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export function registerDailyOfferCrons(
  cron: Pick<typeof cronLib, 'schedule'>,
  { env = process.env, log = console }: { env?: NodeJS.ProcessEnv; log?: Logger } = {},
): boolean {
  const config = getDailyOfferConfig(env);
  if (!config.enabled) {
    log.log('[Cron] Daily offer email: OFF (set DAILY_OFFER_ENABLED=true to enable)');
    return false;
  }
  let running = false;
  const alerted = new Set<string>();      // Dubai dates already reported — at most one alert per day
  const alert = async (stage: AlertStage, info: AlertInfo | null): Promise<void> => {
    const date = dubaiDate();
    if (!info || alerted.has(date)) return;
    alerted.add(date);
    await sendFailureAlert({ date, stage, segmentId: config.segmentId, env, log, ...info });
  };
  const guarded = (
    name: AlertStage,
    fn: (svc: DailyOfferService) => Promise<JobResult>,
    opts: () => { lastTry?: boolean } = () => ({}),
  ) => async (): Promise<void> => {
    if (running) { log.warn(`[Cron:DailyOffer] ${name} skipped — another run is in progress`); return; }
    running = true;
    try {
      const res = await fn(new DailyOfferService({ config }));
      log.log(`[Cron:DailyOffer] ${name}: ${JSON.stringify(res)}`);
      await alert(name, alertFor(name, res, opts()));
    } catch (err) {
      const message = (err as Error).message;
      log.error(`[Cron:DailyOffer] ${name} error: ${message}`);
      // A create crash with retries left is not a lost day yet.
      if (name !== 'create' || opts().lastTry) await alert(name, { reason: 'crash', message });
    } finally {
      running = false;
    }
  };

  const from = hhmmToMinutes(config.createAt);
  const until = hhmmToMinutes(config.retryUntil);
  cron.schedule('*/30 * * * *', async () => {
    const m = dubaiMinutes();
    if (m < from || m > until) return;
    // The last attempt of the day is the one whose failure means no email today.
    await guarded('create', svc => svc.runCreate(), () => ({ lastTry: m + 30 > until }))();
  }, { timezone: 'Asia/Dubai' });

  const [ch, cm] = config.checkAt.split(':').map(Number);
  cron.schedule(`${cm} ${ch} * * *`, guarded('final check', svc => svc.runFinalCheck()), { timezone: 'Asia/Dubai' });

  const [sh, sm] = config.sendCheckAt.split(':').map(Number);
  cron.schedule(`${sm} ${sh} * * *`, guarded('send check', svc => svc.runSendCheck()), { timezone: 'Asia/Dubai' });

  log.log(`[Cron] Daily offer email: create ${config.createAt}–${config.retryUntil} (every 30 min), final check ${config.checkAt}, send ${config.sendAt}, send check ${config.sendCheckAt} Dubai → segment ${config.segmentId}; failure alerts → ${alertRecipients(env).length} inbox(es)`);
  return true;
}
