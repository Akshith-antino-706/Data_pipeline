import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

/**
 * BullMQ infrastructure for journey-driven mass send.
 *
 * Queues:
 *   journey-email  → Chathead email send
 *   journey-wa     → Gupshup WhatsApp send (template approval gated)
 *   journey-sms    → Gupshup SMS send (DLT gated; not active yet)
 *
 * Each queued job carries enough payload that the worker can do the full
 * render → send → log → advance cycle without touching shared in-process state.
 */

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

function buildConnection() {
  const url = process.env.REDIS_URL || DEFAULT_REDIS_URL;
  return new IORedis(url, {
    maxRetriesPerRequest: null,                  // BullMQ requires this
    enableReadyCheck: false,
  });
}

// Lazily build so importing this module doesn't open a Redis socket if the
// app doesn't actually use the queue (cron-only mode, scripts, etc.).
let _connection;
export function getConnection() {
  if (!_connection) _connection = buildConnection();
  return _connection;
}

const QUEUE_DEFAULTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 50_000 },
  removeOnFail:     { age: 7 * 86_400 },
};

let _queues;
function _initQueues() {
  if (_queues) return _queues;
  const conn = getConnection();
  _queues = {
    email: new Queue('journey-email', { connection: conn, defaultJobOptions: QUEUE_DEFAULTS }),
    wa:    new Queue('journey-wa',    { connection: conn, defaultJobOptions: QUEUE_DEFAULTS }),
    sms:   new Queue('journey-sms',   { connection: conn, defaultJobOptions: QUEUE_DEFAULTS }),
  };
  return _queues;
}

export function getQueue(channel) {
  const q = _initQueues();
  if (channel === 'email')    return q.email;
  if (channel === 'whatsapp') return q.wa;
  if (channel === 'sms')      return q.sms;
  throw new Error(`Unknown channel for queue: ${channel}`);
}

/**
 * Bulk add jobs to a channel's queue. BullMQ's addBulk handles up to a few
 * thousand jobs efficiently in a single round-trip; producers should chunk
 * large recipient lists into batches of ~1000 before calling this.
 */
export async function enqueueBatch(channel, jobs) {
  if (!jobs || jobs.length === 0) return [];
  const queue = getQueue(channel);
  return queue.addBulk(
    jobs.map(j => ({ name: j.name || `${channel}-send`, data: j.data, opts: j.opts || {} }))
  );
}

/** Pause / resume / drain helpers — wired up to a route or CLI for incident response. */
export async function pauseQueue(channel)  { return getQueue(channel).pause(); }
export async function resumeQueue(channel) { return getQueue(channel).resume(); }
export async function drainQueue(channel)  { return getQueue(channel).drain(true); }

export async function queueCounts(channel) {
  return getQueue(channel).getJobCounts('waiting','active','delayed','completed','failed','paused');
}

export async function closeQueues() {
  if (!_queues) return;
  await Promise.all([
    _queues.email.close(),
    _queues.wa.close(),
    _queues.sms.close(),
  ]);
  _queues = null;
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}

/** QueueEvents subscription — useful for the API to stream live progress to the UI. */
export function getQueueEvents(channel) {
  const conn = getConnection();
  if (channel === 'email')    return new QueueEvents('journey-email', { connection: conn });
  if (channel === 'whatsapp') return new QueueEvents('journey-wa',    { connection: conn });
  if (channel === 'sms')      return new QueueEvents('journey-sms',   { connection: conn });
  throw new Error(`Unknown channel for queue events: ${channel}`);
}
