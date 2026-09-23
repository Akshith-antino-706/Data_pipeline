/**
 * Standalone giveaway RabbitMQ consumer process.
 *
 * Run as its OWN process (not inline in server.js) so there's exactly ONE RabbitMQ connection —
 * the CloudAMQP Little Lemur plan caps at 20 connections shared with the producer, so we must
 * not open one per web replica.
 *
 *   npm run giveaway:consumer
 *
 * Requires GIVEAWAY_RABBITMQ_URL (CloudAMQP). Without it the consumer stays idle (logs a notice).
 * Requires GIVEAWAY_ENV = the producer's ENVIRONMENT (e.g. prod / dev) — it scopes the binding
 *   `giveaway.email.<env>.*` and the queue names. Without it the consumer stays idle.
 * Sending is gated by GIVEAWAY_SEND_ENABLED=true (default OFF → log-only).
 */
import 'dotenv/config';
import { startGiveawayRabbitConsumer, stopGiveawayRabbitConsumer } from './services/giveaway/giveawayRabbitConsumer.js';

console.log('[GiveawayMQ] starting standalone consumer…');
await startGiveawayRabbitConsumer();

const shutdown = async (sig) => {
  console.log(`[GiveawayMQ] ${sig} — shutting down`);
  await stopGiveawayRabbitConsumer();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
