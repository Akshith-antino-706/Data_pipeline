/**
 * Standalone BullMQ worker process for journey-driven sends.
 *
 *   node backend/scripts/start-workers.js
 *
 * Runs the email + WhatsApp + (optional) SMS workers. The API server can stay
 * lean and just enqueue; this process actually does the render + send.
 *
 * Env (see backend/src/services/queue/workers.js for all knobs):
 *   REDIS_URL                     redis://localhost:6379 by default
 *   JOURNEY_EMAIL_CONCURRENCY     default 20
 *   JOURNEY_EMAIL_RATE_MAX        default 50 / 1000ms
 *   JOURNEY_WA_CONCURRENCY        default 10
 *   JOURNEY_WA_RATE_MAX           default 20 / 1000ms
 *   JOURNEY_SMS_ENABLED           true to route SMS jobs (default false)
 *   CHATHEAD_API_TOKEN            required for real email sends (else simulation)
 *   GUPSHUP_API_KEY etc           required for real WA sends (else simulation)
 */
import 'dotenv/config';
import { startWorkers, stopWorkers } from '../src/services/queue/workers.js';
import { closeQueues } from '../src/services/queue/index.js';

console.log('[start-workers] booting…');
startWorkers();
console.log('[start-workers] ready — waiting for jobs (Ctrl-C to stop)');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[start-workers] ${signal} received — draining…`);
  try {
    await stopWorkers();
    await closeQueues();
  } catch (err) {
    console.error(`[start-workers] shutdown error: ${err.message}`);
  }
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
