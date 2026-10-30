/**
 * Daily offer email — cron registration (called once from server.js).
 *
 * Does nothing unless DAILY_OFFER_ENABLED=true. Two jobs (Dubai time):
 *   create      every 30 min between createAt and retryUntil (09:00–14:00); a no-op once
 *               today's journey exists, so a success at 9:00 means no further downloads.
 *   final check once at checkAt (15:45) → schedules the 16:00 start, or records why not.
 */
import { getDailyOfferConfig, dubaiMinutes, hhmmToMinutes } from './config.js';
import DailyOfferService from './DailyOfferService.js';

export function registerDailyOfferCrons(cron, { env = process.env, log = console } = {}) {
  const config = getDailyOfferConfig(env);
  if (!config.enabled) {
    log.log('[Cron] Daily offer email: OFF (set DAILY_OFFER_ENABLED=true to enable)');
    return false;
  }
  let running = false;
  const guarded = (name, fn) => async () => {
    if (running) { log.warn(`[Cron:DailyOffer] ${name} skipped — another run is in progress`); return; }
    running = true;
    try {
      const res = await fn(new DailyOfferService({ config }));
      log.log(`[Cron:DailyOffer] ${name}: ${JSON.stringify(res)}`);
    } catch (err) {
      log.error(`[Cron:DailyOffer] ${name} error: ${err.message}`);
    } finally {
      running = false;
    }
  };

  const from = hhmmToMinutes(config.createAt);
  const until = hhmmToMinutes(config.retryUntil);
  cron.schedule('*/30 * * * *', async () => {
    const m = dubaiMinutes();
    if (m < from || m > until) return;
    await guarded('create', svc => svc.runCreate())();
  }, { timezone: 'Asia/Dubai' });

  const [ch, cm] = config.checkAt.split(':').map(Number);
  cron.schedule(`${cm} ${ch} * * *`, guarded('final check', svc => svc.runFinalCheck()), { timezone: 'Asia/Dubai' });

  log.log(`[Cron] Daily offer email: create ${config.createAt}–${config.retryUntil} (every 30 min), final check ${config.checkAt}, send ${config.sendAt} Dubai → segment ${config.segmentId}`);
  return true;
}
