/**
 * Daily offer email — cron registration (called once from server.js).
 *
 * Does nothing unless DAILY_OFFER_ENABLED=true (B2C) / DAILY_OFFER_B2B_ENABLED=true (B2B).
 * Three jobs per audience (Dubai time; B2C values shown, B2B: 09:15–11:15 / 11:45 / 12:00 / 13:30):
 *   create      every 30 min between createAt and retryUntil (09:00–14:00); a no-op once
 *               today's journey exists, so a success at 9:00 means no further downloads.
 *   final check once at checkAt (15:45) → schedules the 16:00 start, or records why not.
 *   send check  once at sendCheckAt (17:30) → were any emails actually sent?
 * A day that will not go out emails the team once (alert.js).
 */
import { getDailyOfferConfig, dubaiDate, dubaiMinutes, hhmmToMinutes } from './config.js';
import type { DailyOfferConfig } from './config.js';
import DailyOfferService from './DailyOfferService.js';
import type cronLib from 'node-cron';
import { alertFor, alertRecipients, sendFailureAlert } from './alert.js';
import type { AlertInfo, AlertStage, JobResult } from './alert.js';

type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

/** The three runs the jobs call — a fake with this shape is injected in tests. */
export type OfferJobs = Pick<DailyOfferService, 'runCreate' | 'runFinalCheck' | 'runSendCheck'>;

/** Test hooks; production uses the defaults (real service, real alert email, real clock). */
export interface CronDeps {
  makeService?: (config: DailyOfferConfig) => OfferJobs;
  sendAlert?: typeof sendFailureAlert;
  now?: () => Date;
}

type CronLib = Pick<typeof cronLib, 'schedule'>;
type AudienceDeps = { env: NodeJS.ProcessEnv; log: Logger } & Required<CronDeps>;

/**
 * One set of jobs is registered per enabled audience: 'b2c' (DAILY_OFFER_ENABLED) and
 * 'b2b' (DAILY_OFFER_B2B_ENABLED), each with its own times, segment, no-overlap guard
 * and one-alert-per-day memory.
 */
export function registerDailyOfferCrons(
  cron: CronLib,
  {
    env = process.env, log = console,
    makeService = (config) => new DailyOfferService({ config }),
    sendAlert = sendFailureAlert,
    now = () => new Date(),
  }: { env?: NodeJS.ProcessEnv; log?: Logger } & CronDeps = {},
): boolean {
  const configs = (['b2c', 'b2b'] as const).map(a => getDailyOfferConfig(env, a)).filter(c => c.enabled);
  if (!configs.length) {
    log.log('[Cron] Daily offer email: OFF (set DAILY_OFFER_ENABLED=true to enable; DAILY_OFFER_B2B_ENABLED=true for the B2B copy)');
    return false;
  }
  for (const config of configs) registerAudience(cron, config, { env, log, makeService, sendAlert, now });
  return true;
}

function registerAudience(cron: CronLib, config: DailyOfferConfig, { env, log, makeService, sendAlert, now }: AudienceDeps): void {
  const tag = config.audience === 'b2b' ? 'Cron:DailyOffer:B2B' : 'Cron:DailyOffer';
  let running = false;
  const alerted = new Set<string>();      // Dubai dates already reported — at most one alert per day
  const alert = async (stage: AlertStage, info: AlertInfo | null): Promise<void> => {
    const date = dubaiDate(now());
    if (!info || alerted.has(date)) return;
    alerted.add(date);
    await sendAlert({ date, stage, segmentId: config.segmentId, audience: config.audience, env, log, ...info });
  };
  const guarded = (
    name: AlertStage,
    fn: (svc: OfferJobs) => Promise<JobResult>,
    opts: () => { lastTry?: boolean } = () => ({}),
  ) => async (): Promise<void> => {
    if (running) { log.warn(`[${tag}] ${name} skipped — another run is in progress`); return; }
    running = true;
    try {
      const res = await fn(makeService(config));
      log.log(`[${tag}] ${name}: ${JSON.stringify(res)}`);
      await alert(name, alertFor(name, res, opts()));
    } catch (err) {
      const message = (err as Error).message;
      log.error(`[${tag}] ${name} error: ${message}`);
      // A create crash with retries left is not a lost day yet.
      if (name !== 'create' || opts().lastTry) await alert(name, { reason: 'crash', message });
    } finally {
      running = false;
    }
  };

  const from = hhmmToMinutes(config.createAt);
  const until = hhmmToMinutes(config.retryUntil);
  // Attempts every 30 min on createAt's minute (09:00 → :00/:30; the B2B 09:15 → :15/:45,
  // so it runs after the B2C attempt it copies).
  const offset = from % 30;
  cron.schedule(offset === 0 ? '*/30 * * * *' : `${offset},${offset + 30} * * * *`, async () => {
    const m = dubaiMinutes(now());
    if (m < from || m > until) return;
    // The last attempt of the day is the one whose failure means no email today.
    await guarded('create', svc => svc.runCreate(), () => ({ lastTry: m + 30 > until }))();
  }, { timezone: 'Asia/Dubai' });

  const [ch, cm] = config.checkAt.split(':').map(Number);
  cron.schedule(`${cm} ${ch} * * *`, guarded('final check', svc => svc.runFinalCheck()), { timezone: 'Asia/Dubai' });

  const [sh, sm] = config.sendCheckAt.split(':').map(Number);
  cron.schedule(`${sm} ${sh} * * *`, guarded('send check', svc => svc.runSendCheck()), { timezone: 'Asia/Dubai' });

  log.log(`[Cron] Daily offer email (${config.audience.toUpperCase()}): create ${config.createAt}–${config.retryUntil} (every 30 min), final check ${config.checkAt}, send ${config.sendAt}, send check ${config.sendCheckAt} Dubai → segment ${config.segmentId}; failure alerts → ${alertRecipients(env).length} inbox(es)`);
}
