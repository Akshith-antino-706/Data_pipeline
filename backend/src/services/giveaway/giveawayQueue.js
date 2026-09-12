/**
 * Giveaway email queue (BullMQ) — the giveaway analogue of the journey queues.
 *
 * Instead of the handoff doc's RabbitMQ/CloudAMQP transport, we reuse the project's
 * existing BullMQ + Redis setup. A "producer" (an HTTP call, or us) enqueues one job per
 * giveaway email using the §3 JSON contract; the giveaway worker consumes + processes it.
 *
 * jobId = payload.id (the sent_emails uuid) → BullMQ itself dedupes a re-enqueued id, and
 * the worker adds a Redis SET-NX guard on top for at-least-once redelivery safety.
 */
import { Queue } from 'bullmq';
import { getConnection } from '../queue/index.js';

export const GIVEAWAY_EMAIL_QUEUE = 'giveaway-email';

let _queue = null;
export function getGiveawayQueue() {
  if (!_queue) {
    _queue = new Queue(GIVEAWAY_EMAIL_QUEUE, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 7 * 86_400 },   // keep failures ~7d for inspection (DLQ analogue)
      },
    });
  }
  return _queue;
}

/** Enqueue one giveaway email (the §3 contract payload). id → jobId for idempotency. */
export async function enqueueGiveawayEmail(payload) {
  return getGiveawayQueue().add('giveaway.email', payload, {
    jobId: payload?.id ? String(payload.id) : undefined,
  });
}

export async function giveawayQueueCounts() {
  return getGiveawayQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
}

/**
 * Recent giveaway jobs across all states, newest first — powers the log view.
 * Reads straight from BullMQ (completed jobs are retained ~24h / 1000 rows), so there's
 * no separate log table to maintain.
 */
export async function recentGiveawayJobs(limit = 50) {
  const q = getGiveawayQueue();
  const [completed, failed, active, waiting, delayed] = await Promise.all([
    q.getJobs(['completed'], 0, limit - 1, false),
    q.getJobs(['failed'],    0, limit - 1, false),
    q.getJobs(['active'],    0, limit - 1, false),
    q.getJobs(['waiting'],   0, limit - 1, false),
    q.getJobs(['delayed'],   0, limit - 1, false),
  ]);

  const outcome = (state, rv, failedReason) => {
    if (state === 'failed')  return { label: 'failed',    detail: failedReason || 'error' };
    if (state === 'active')  return { label: 'processing', detail: '' };
    if (state === 'waiting' || state === 'delayed') return { label: 'queued', detail: '' };
    if (rv?.dropped)    return { label: 'dropped',   detail: rv.reason || '' };
    if (rv?.duplicate)  return { label: 'duplicate', detail: '' };
    if (rv?.logged)     return { label: 'received',  detail: 'would send (SMTP not wired)' };
    return { label: 'completed', detail: '' };
  };

  const map = (j, state) => ({
    jobId: j.id, id: j.data?.id, type: j.data?.type,
    email: j.data?.to?.email, name: j.data?.to?.name,
    subject: j.data?.subject, tenantId: j.data?.tenantId, giveawayId: j.data?.giveawayId,
    state, attemptsMade: j.attemptsMade,
    createdAt: j.timestamp || null, processedOn: j.processedOn || null, finishedOn: j.finishedOn || null,
    ...outcome(state, j.returnvalue, j.failedReason),
  });

  const all = [
    ...completed.map(j => map(j, 'completed')),
    ...failed.map(j => map(j, 'failed')),
    ...active.map(j => map(j, 'active')),
    ...waiting.map(j => map(j, 'waiting')),
    ...delayed.map(j => map(j, 'delayed')),
  ];
  all.sort((a, b) => (b.finishedOn || b.processedOn || b.createdAt || 0) - (a.finishedOn || a.processedOn || a.createdAt || 0));
  return all.slice(0, limit);
}
