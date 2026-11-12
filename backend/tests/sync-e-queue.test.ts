import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
  const queues: FakeQueue[] = [];
  const events: { name: string; opts: unknown }[] = [];
  const redisCtor = vi.fn();
  const quit = vi.fn(async () => 'OK');
  class FakeQueue {
    name: string; opts: { connection: unknown; defaultJobOptions?: unknown };
    add = vi.fn(async (name: string, data: unknown, opts: unknown) => ({ id: 'j1', name, data, opts }));
    addBulk = vi.fn(async (jobs: unknown[]) => jobs);
    pause = vi.fn(async () => undefined);
    resume = vi.fn(async () => undefined);
    drain = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    getJobCounts = vi.fn(async () => ({ waiting: 1 }));
    constructor(name: string, opts: { connection: unknown; defaultJobOptions?: unknown }) { this.name = name; this.opts = opts; queues.push(this); }
  }
  class FakeQueueEvents { constructor(name: string, opts: unknown) { events.push({ name, opts }); } }
  class FakeRedis { quit = quit; constructor(url: string, opts: unknown) { redisCtor(url, opts); } }
  return { queues, events, redisCtor, quit, FakeQueue, FakeQueueEvents, FakeRedis };
});

vi.mock('bullmq', () => ({ Queue: m.FakeQueue, QueueEvents: m.FakeQueueEvents, Worker: vi.fn() }));
vi.mock('ioredis', () => ({ default: m.FakeRedis }));
vi.mock('amqplib', () => ({ default: { connect: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

import * as Q from '../src/services/queue/index.js';

beforeEach(async () => {
  await Q.closeQueues();
  m.queues.length = 0;
  m.events.length = 0;
  m.redisCtor.mockClear();
  m.quit.mockClear();
});

describe('queue/index — connection', () => {
  it('importing does not connect; getConnection is lazy and memoised with BullMQ-safe options', () => {
    expect(m.redisCtor).not.toHaveBeenCalled();
    const a = Q.getConnection();
    const b = Q.getConnection();
    expect(a).toBe(b);
    expect(m.redisCtor).toHaveBeenCalledTimes(1);
    const [url, opts] = m.redisCtor.mock.calls[0] as [string, { maxRetriesPerRequest: null; enableReadyCheck: boolean; connectTimeout: number; retryStrategy: (n: number) => number }];
    expect(url).toBe('redis://127.0.0.1:1');   // from tests/setup.ts, never a real host
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.enableReadyCheck).toBe(false);
    expect(opts.connectTimeout).toBe(5000);
    expect([1, 2, 6, 100].map(opts.retryStrategy)).toEqual([500, 1000, 3000, 3000]);
  });
});

describe('queue/index — getQueue', () => {
  it('maps each channel to its queue and builds all 6 once with shared defaults', () => {
    const map: Record<string, string> = {
      email: 'journey-email', whatsapp: 'journey-wa', sms: 'journey-sms', rcs: 'journey-rcs',
      welcome: 'welcome-email', gtmJourney: 'gtm-journey',
    };
    for (const [ch, name] of Object.entries(map)) expect(Q.getQueue(ch).name).toBe(name);
    expect(m.queues).toHaveLength(6);
    expect(m.queues[0].opts.defaultJobOptions).toEqual({
      attempts: 3, backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86400, count: 50000 }, removeOnFail: { age: 604800, count: 50000 },
    });
  });

  it('unknown channel throws', () => {
    expect(() => Q.getQueue('fax')).toThrow('Unknown channel for queue: fax');
  });
});

describe('queue/index — enqueue helpers', () => {
  it('enqueueWelcome / enqueueGtmJourney add delayed jobs, negative delay clamped to 0', async () => {
    await Q.enqueueWelcome({ email: 'a@b.co' } as unknown as Parameters<typeof Q.enqueueWelcome>[0], 60_000);
    await Q.enqueueGtmJourney({ journeyId: 1 } as unknown as Parameters<typeof Q.enqueueGtmJourney>[0], -5);
    await Q.enqueueWelcome({ email: 'c@d.co' } as unknown as Parameters<typeof Q.enqueueWelcome>[0]);
    const welcome = Q.getQueue('welcome') as unknown as InstanceType<typeof m.FakeQueue>;
    const gtm = Q.getQueue('gtmJourney') as unknown as InstanceType<typeof m.FakeQueue>;
    expect(welcome.add.mock.calls[0]).toEqual(['welcome-send', { email: 'a@b.co' }, { delay: 60000 }]);
    expect(welcome.add.mock.calls[1][2]).toEqual({ delay: 0 });
    expect(gtm.add.mock.calls[0]).toEqual(['gtm-journey-send', { journeyId: 1 }, { delay: 0 }]);
  });

  it('enqueueBatch: empty / null → [] without building queues; default names and opts', async () => {
    expect(await Q.enqueueBatch('email', [])).toEqual([]);
    expect(await Q.enqueueBatch('email', null)).toEqual([]);
    expect(m.queues).toHaveLength(0);
    await Q.enqueueBatch('whatsapp', [
      { data: { a: 1 } }, { name: 'custom', data: { b: 2 }, opts: { priority: 1 } },
    ] as unknown as Parameters<typeof Q.enqueueBatch>[1]);
    const wa = Q.getQueue('whatsapp') as unknown as InstanceType<typeof m.FakeQueue>;
    expect(wa.addBulk).toHaveBeenCalledWith([
      { name: 'whatsapp-send', data: { a: 1 }, opts: {} },
      { name: 'custom', data: { b: 2 }, opts: { priority: 1 } },
    ]);
  });

  it('enqueueBatch on an unknown channel rejects', async () => {
    await expect(Q.enqueueBatch('pigeon', [{ data: {} }] as unknown as Parameters<typeof Q.enqueueBatch>[1])).rejects.toThrow('Unknown channel');
  });
});

describe('queue/index — admin helpers', () => {
  it('pause / resume / drain(true) / counts delegate to the right queue', async () => {
    await Q.pauseQueue('sms');
    await Q.resumeQueue('sms');
    await Q.drainQueue('sms');
    const counts = await Q.queueCounts('sms');
    const sms = Q.getQueue('sms') as unknown as InstanceType<typeof m.FakeQueue>;
    expect(sms.pause).toHaveBeenCalled();
    expect(sms.resume).toHaveBeenCalled();
    expect(sms.drain).toHaveBeenCalledWith(true);
    expect(sms.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
    expect(counts).toEqual({ waiting: 1 });
  });

  it('closeQueues closes every queue, quits redis, and later calls rebuild fresh', async () => {
    const first = Q.getQueue('email');
    await Q.closeQueues();
    expect(m.queues.every(q => q.close.mock.calls.length === 1)).toBe(true);
    expect(m.quit).toHaveBeenCalledTimes(1);
    expect(Q.getQueue('email')).not.toBe(first);
    expect(m.redisCtor).toHaveBeenCalledTimes(2);
  });

  it('closeQueues with nothing open is a no-op', async () => {
    await Q.closeQueues();
    expect(m.quit).not.toHaveBeenCalled();
  });

  it('getQueueEvents supports email/whatsapp/sms/rcs and rejects others', () => {
    Q.getQueueEvents('email'); Q.getQueueEvents('whatsapp'); Q.getQueueEvents('sms'); Q.getQueueEvents('rcs');
    expect(m.events.map(e => e.name)).toEqual(['journey-email', 'journey-wa', 'journey-sms', 'journey-rcs']);
    expect(() => Q.getQueueEvents('welcome')).toThrow('Unknown channel for queue events: welcome');
  });
});
