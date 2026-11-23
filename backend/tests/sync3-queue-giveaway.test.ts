import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Handler = (...args: unknown[]) => void;
interface Created { name: string; opts: Record<string, unknown> }
interface WorkerRec { name: string; processor: (job: unknown) => Promise<unknown>; opts: Record<string, unknown>; handlers: Record<string, Handler> }

const st = vi.hoisted(() => ({
  queues: [] as { name: string; opts: Record<string, unknown> }[],
  events: [] as string[],
  workers: [] as { name: string; processor: (job: unknown) => Promise<unknown>; opts: Record<string, unknown>; handlers: Record<string, (...args: unknown[]) => void> }[],
  redisArgs: [] as unknown[][],
  add: vi.fn<(q: string, name: string, data: unknown, opts?: unknown) => Promise<{ id: string }>>(),
  addBulk: vi.fn<(q: string, jobs: unknown[]) => Promise<unknown[]>>(),
  pause: vi.fn<(q: string) => Promise<void>>(),
  resume: vi.fn<(q: string) => Promise<void>>(),
  drain: vi.fn<(q: string, d: boolean) => Promise<void>>(),
  counts: vi.fn<(q: string, ...s: string[]) => Promise<Record<string, number>>>(),
  getJobs: vi.fn<(q: string, types: string[], s: number, e: number, asc: boolean) => Promise<unknown[]>>(),
  close: vi.fn<(q: string) => Promise<void>>(),
  quit: vi.fn<() => Promise<string>>(),
  set: vi.fn<(...a: unknown[]) => Promise<string | null>>(),
  workerClose: vi.fn<() => Promise<void>>(),
  poolConnect: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    name: string;
    constructor(name: string, opts: Record<string, unknown>) { this.name = name; st.queues.push({ name, opts }); }
    add(n: string, d: unknown, o?: unknown) { return st.add(this.name, n, d, o); }
    addBulk(j: unknown[]) { return st.addBulk(this.name, j); }
    pause() { return st.pause(this.name); }
    resume() { return st.resume(this.name); }
    drain(d: boolean) { return st.drain(this.name, d); }
    getJobCounts(...s: string[]) { return st.counts(this.name, ...s); }
    getJobs(t: string[], s: number, e: number, a: boolean) { return st.getJobs(this.name, t, s, e, a); }
    close() { return st.close(this.name); }
  },
  QueueEvents: class { constructor(name: string) { st.events.push(name); } },
  Worker: class {
    rec: { name: string; processor: (job: unknown) => Promise<unknown>; opts: Record<string, unknown>; handlers: Record<string, (...args: unknown[]) => void> };
    constructor(name: string, processor: (job: unknown) => Promise<unknown>, opts: Record<string, unknown>) {
      this.rec = { name, processor, opts, handlers: {} };
      st.workers.push(this.rec);
    }
    on(ev: string, h: (...args: unknown[]) => void) { this.rec.handlers[ev] = h; return this; }
    close() { return st.workerClose(); }
  },
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor(...a: unknown[]) { st.redisArgs.push(a); }
    quit() { return st.quit(); }
    set(...a: unknown[]) { return st.set(...a); }
  },
}));
vi.mock('../src/config/database.js', () => ({ default: { connect: st.poolConnect }, query: vi.fn(), transaction: vi.fn() }));

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  st.queues.length = 0; st.events.length = 0; st.workers.length = 0; st.redisArgs.length = 0;
  st.add.mockImplementation(async (_q, _n, d) => ({ id: String((d as { id?: unknown })?.id ?? 'x') }));
  st.addBulk.mockImplementation(async (_q, j) => j);
  st.quit.mockResolvedValue('OK');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore(); delete process.env.GIVEAWAY_PREFETCH; });

// ─────────────────────────── queue/index ───────────────────────────
describe('services/queue', () => {
  it('importing does not open Redis; the connection is lazy and a singleton', async () => {
    const q = await import('../src/services/queue/index.js');
    expect(st.redisArgs).toHaveLength(0);
    const a = q.getConnection();
    expect(q.getConnection()).toBe(a);
    expect(st.redisArgs).toHaveLength(1);
    const [url, opts] = st.redisArgs[0] as [string, { maxRetriesPerRequest: null; enableReadyCheck: boolean; connectTimeout: number; retryStrategy: (n: number) => number }];
    expect(url).toBe('redis://127.0.0.1:1'); // from tests/setup.ts
    expect(opts.maxRetriesPerRequest).toBeNull();
    expect(opts.enableReadyCheck).toBe(false);
    expect(opts.connectTimeout).toBe(5000);
    expect([1, 2, 6, 7, 100].map(opts.retryStrategy)).toEqual([500, 1000, 3000, 3000, 3000]);
  });

  it('creates the six queues with 3 attempts + exponential 5s backoff', async () => {
    const q = await import('../src/services/queue/index.js');
    q.getQueue('email');
    expect(st.queues.map(x => x.name)).toEqual(['journey-email', 'journey-wa', 'journey-sms', 'journey-rcs', 'welcome-email', 'gtm-journey']);
    for (const c of st.queues) {
      expect(c.opts.defaultJobOptions).toEqual({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400, count: 50000 },
        removeOnFail: { age: 604800, count: 50000 },
      });
    }
    q.getQueue('sms');
    expect(st.queues).toHaveLength(6);
  });

  it.each([['email', 'journey-email'], ['whatsapp', 'journey-wa'], ['sms', 'journey-sms'], ['rcs', 'journey-rcs'], ['welcome', 'welcome-email'], ['gtmJourney', 'gtm-journey']])(
    'getQueue(%s) → %s', async (ch, name) => {
      const q = await import('../src/services/queue/index.js');
      expect((q.getQueue(ch) as unknown as { name: string }).name).toBe(name);
    });

  it('unknown channels throw', async () => {
    const q = await import('../src/services/queue/index.js');
    expect(() => q.getQueue('fax')).toThrow('Unknown channel for queue: fax');
    expect(() => q.getQueueEvents('welcome')).toThrow('Unknown channel for queue events: welcome');
  });

  it('enqueueWelcome / enqueueGtmJourney add delayed jobs, clamping negative delays to 0', async () => {
    const q = await import('../src/services/queue/index.js');
    await q.enqueueWelcome({ unifiedId: 1 } as unknown as Parameters<typeof q.enqueueWelcome>[0], -50);
    await q.enqueueGtmJourney({ unifiedId: 2 } as unknown as Parameters<typeof q.enqueueGtmJourney>[0], 3000);
    await q.enqueueWelcome({ unifiedId: 3 } as unknown as Parameters<typeof q.enqueueWelcome>[0]);
    expect(st.add.mock.calls.map(c => [c[0], c[1], c[3]])).toEqual([
      ['welcome-email', 'welcome-send', { delay: 0 }],
      ['gtm-journey', 'gtm-journey-send', { delay: 3000 }],
      ['welcome-email', 'welcome-send', { delay: 0 }],
    ]);
  });

  it('enqueueBatch: empty/null is a no-op; defaults name and opts', async () => {
    const q = await import('../src/services/queue/index.js');
    expect(await q.enqueueBatch('email', [])).toEqual([]);
    expect(await q.enqueueBatch('email', null)).toEqual([]);
    expect(st.queues).toHaveLength(0);
    await q.enqueueBatch('whatsapp', [{ data: { a: 1 } }, { name: 'custom', data: { b: 2 }, opts: { priority: 1 } }] as unknown as Parameters<typeof q.enqueueBatch>[1]);
    expect(st.addBulk).toHaveBeenCalledWith('journey-wa', [
      { name: 'whatsapp-send', data: { a: 1 }, opts: {} },
      { name: 'custom', data: { b: 2 }, opts: { priority: 1 } },
    ]);
  });

  it('pause/resume/drain/counts delegate to the right queue', async () => {
    const q = await import('../src/services/queue/index.js');
    st.counts.mockResolvedValue({ waiting: 1 });
    await q.pauseQueue('sms'); await q.resumeQueue('sms'); await q.drainQueue('rcs');
    expect(await q.queueCounts('email')).toEqual({ waiting: 1 });
    expect(st.pause).toHaveBeenCalledWith('journey-sms');
    expect(st.resume).toHaveBeenCalledWith('journey-sms');
    expect(st.drain).toHaveBeenCalledWith('journey-rcs', true);
    expect(st.counts).toHaveBeenCalledWith('journey-email', 'waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
  });

  it('closeQueues closes all queues and quits Redis; a no-op when never opened', async () => {
    const q = await import('../src/services/queue/index.js');
    await q.closeQueues();
    expect(st.close).not.toHaveBeenCalled();
    q.getQueue('email');
    await q.closeQueues();
    expect(st.close).toHaveBeenCalledTimes(6);
    expect(st.quit).toHaveBeenCalledTimes(1);
    q.getQueue('email');
    expect(st.queues).toHaveLength(12); // rebuilt after close
    expect(st.redisArgs).toHaveLength(2);
  });

  it('getQueueEvents maps channels', async () => {
    const q = await import('../src/services/queue/index.js');
    q.getQueueEvents('email'); q.getQueueEvents('whatsapp'); q.getQueueEvents('sms'); q.getQueueEvents('rcs');
    expect(st.events).toEqual(['journey-email', 'journey-wa', 'journey-sms', 'journey-rcs']);
  });
});

// ─────────────────────────── giveawayQueue ───────────────────────────
describe('giveawayQueue', () => {
  it('uses queue "giveaway-email" with retries/backoff and jobId = payload id', async () => {
    const g = await import('../src/services/giveaway/giveawayQueue.js');
    expect(g.GIVEAWAY_EMAIL_QUEUE).toBe('giveaway-email');
    await g.enqueueGiveawayEmail({ id: 42, version: 1 });
    await g.enqueueGiveawayEmail({ version: 1 });
    expect(st.queues).toHaveLength(1);
    expect(st.queues[0].opts.defaultJobOptions).toEqual({
      attempts: 3, backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 604800 },
    });
    expect(st.add.mock.calls[0]).toEqual(['giveaway-email', 'giveaway.email', { id: 42, version: 1 }, { jobId: '42' }]);
    expect(st.add.mock.calls[1][3]).toEqual({ jobId: undefined });
  });

  it('giveawayQueueCounts requests the five states', async () => {
    const g = await import('../src/services/giveaway/giveawayQueue.js');
    st.counts.mockResolvedValue({});
    await g.giveawayQueueCounts();
    expect(st.counts).toHaveBeenCalledWith('giveaway-email', 'waiting', 'active', 'delayed', 'completed', 'failed');
  });

  it('recentGiveawayJobs labels each state and sorts newest first, limited', async () => {
    const job = (id: string, ts: number, extra: Record<string, unknown> = {}) => ({ id, data: { id, type: 'winner', to: { email: `${id}@x.io` } }, timestamp: ts, attemptsMade: 1, ...extra });
    st.getJobs.mockImplementation(async (_q, types) => {
      switch (types[0]) {
        case 'completed': return [
          job('c1', 1, { finishedOn: 100, returnvalue: { dropped: true, reason: 'bad' } }),
          job('c2', 1, { finishedOn: 90, returnvalue: { duplicate: true } }),
          job('c3', 1, { finishedOn: 80, returnvalue: { logged: true } }),
          job('c4', 1, { finishedOn: 70 }),
        ];
        case 'failed': return [job('f1', 1, { finishedOn: 95, failedReason: '' })];
        case 'active': return [job('a1', 1, { processedOn: 85 })];
        case 'waiting': return [job('w1', 60)];
        default: return [{ id: 'd1', data: undefined, timestamp: 0, attemptsMade: 0 }];
      }
    });
    const g = await import('../src/services/giveaway/giveawayQueue.js');
    const r = await g.recentGiveawayJobs(7);
    expect(st.getJobs.mock.calls[0]).toEqual(['giveaway-email', ['completed'], 0, 6, false]);
    expect(r.map(x => [x.jobId, x.label, x.detail])).toEqual([
      ['c1', 'dropped', 'bad'], ['f1', 'failed', 'error'], ['c2', 'duplicate', ''], ['a1', 'processing', ''],
      ['c3', 'received', 'would send (SMTP not wired)'], ['c4', 'completed', ''], ['w1', 'queued', ''],
    ]);
  });
});

// ─────────────────────────── giveawayWorker ───────────────────────────
describe('giveawayWorker', () => {
  const valid = { version: 1, id: 'm1', type: 'winner', to: { email: 'a@b.co', name: 'A' }, subject: 'Hi', body: 'x'.repeat(200) };
  async function start(): Promise<WorkerRec> {
    const w = await import('../src/services/giveaway/giveawayWorker.js');
    w.startGiveawayWorker();
    return st.workers[0];
  }

  it('starts once on queue giveaway-email with GIVEAWAY_PREFETCH concurrency; stop closes it', async () => {
    process.env.GIVEAWAY_PREFETCH = '4';
    const w = await import('../src/services/giveaway/giveawayWorker.js');
    const a = w.startGiveawayWorker();
    expect(w.startGiveawayWorker()).toBe(a);
    expect(st.workers).toHaveLength(1);
    expect(st.workers[0].name).toBe('giveaway-email');
    expect(st.workers[0].opts.concurrency).toBe(4);
    await w.stopGiveawayWorker();
    await w.stopGiveawayWorker();
    expect(st.workerClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, 'not_an_object'],
    [{ ...valid, version: 2 }, 'unknown_version:2'],
    [{ ...valid, id: '' }, 'missing_id'],
    [{ ...valid, type: 'spam' }, 'bad_type:spam'],
    [{ ...valid, to: { email: 'nope' } }, 'invalid_email'],
    [{ ...valid, to: undefined }, 'invalid_email'],
    [{ ...valid, subject: '' }, 'missing_subject'],
    [{ ...valid, body: 5 }, 'missing_body'],
  ])('poison %# → dropped (%s), never retried, no Redis claim', async (data, reason) => {
    const w = await start();
    const r = await w.processor({ id: 'j', data });
    expect(r).toEqual({ dropped: true, reason: data === null ? 'unknown_version:undefined' : reason });
    expect(st.set).not.toHaveBeenCalled();
  });

  it('first delivery claims the id with SET NX EX 7d and logs', async () => {
    st.set.mockResolvedValue('OK');
    const w = await start();
    expect(await w.processor({ id: 'j', data: valid })).toEqual({ logged: true });
    expect(st.set).toHaveBeenCalledWith('giveaway:email:m1', '1', 'NX', 'EX', 604800);
    expect(logSpy.mock.calls.some(c => String(c[0]).includes('…'))).toBe(true); // body > 140 truncated
  });

  it('duplicate delivery is completed without "sending"', async () => {
    st.set.mockResolvedValue(null);
    const w = await start();
    expect(await w.processor({ id: 'j', data: valid })).toEqual({ duplicate: true });
  });

  it('a transient Redis error throws so BullMQ retries', async () => {
    st.set.mockRejectedValue(new Error('redis down'));
    const w = await start();
    await expect(w.processor({ id: 'j', data: valid })).rejects.toThrow('redis down');
  });

  it('failed/error events are logged, tolerating a missing job', async () => {
    const w = await start();
    w.handlers.failed(undefined, new Error('x'));
    w.handlers.failed({ id: 'j', data: { id: 'm' }, attemptsMade: 3 }, new Error('y'));
    w.handlers.error(new Error('z'));
    expect(errSpy).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────── giveawayIngest ───────────────────────────
describe('giveawayIngest', () => {
  type Q = (sql: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
  function client(h: Q) { return { query: vi.fn<Q>(h), release: vi.fn<() => void>() }; }
  const msg = {
    id: 'e1', version: 1, type: 'winner', tenantId: 7, giveawayId: 'g1',
    to: { email: ' A@B.co ', name: 'Ann' }, subject: 'S', body: 'B', bodyFormat: 'text', createdAt: '2026-01-01',
    data: { user: { name: '' }, winner: { rank: '#3rd', code: 'C' }, prize: { value: 0 }, participant: { position: 2 } },
  };

  it('creates a new B2C contact and stores the event with normalised fields', async () => {
    const c = client(async (sql) => {
      if (sql.startsWith('SELECT id')) return { rows: [] };
      if (sql.includes('INSERT INTO unified_contacts')) return { rows: [{ id: 55 }] };
      if (sql.includes('INSERT INTO giveaway_affiliate_events')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    st.poolConnect.mockResolvedValue(c);
    const { ingestGiveawayEvent } = await import('../src/services/giveaway/giveawayIngest.js');
    expect(await ingestGiveawayEvent(msg)).toEqual({ unifiedId: 55, stored: true });
    const sqls = c.query.mock.calls.map(x => x[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toContain('pg_advisory_xact_lock');
    expect(sqls.at(-1)).toBe('COMMIT');
    const ev = c.query.mock.calls.find(x => x[0].includes('giveaway_affiliate_events'))?.[1] ?? [];
    expect(ev[3]).toBe('GIVEAWAY');    // source column
    expect(ev[4]).toBe('7');           // tenant id stringified
    expect(ev[8]).toBe('Ann');         // empty user.name falls back to to.name
    expect(ev[15]).toBe('0');          // prize value 0 kept
    expect(ev[16]).toBe(3);            // rank '#3rd' → 3
    expect(ev[21]).toBe('2');
    expect(JSON.parse(String(ev[27]))).toEqual(msg);
    expect(c.release).toHaveBeenCalled();
  });

  it('existing contact gets the giveaway source appended only once; redelivery reports stored=false', async () => {
    let sources = 'web, giveaway';
    const c = client(async (sql) => {
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 9, sources }] };
      return { rows: [], rowCount: 0 };
    });
    st.poolConnect.mockResolvedValue(c);
    const { ingestGiveawayEvent } = await import('../src/services/giveaway/giveawayIngest.js');
    expect(await ingestGiveawayEvent(msg)).toEqual({ unifiedId: 9, stored: false });
    expect(c.query.mock.calls.some(x => x[0].includes('UPDATE unified_contacts'))).toBe(false);
    sources = 'web';
    await ingestGiveawayEvent(msg);
    expect(c.query.mock.calls.filter(x => x[0].includes('UPDATE unified_contacts'))).toHaveLength(1);
  });

  it('no email → no contact, event still stored with unified_id null', async () => {
    const c = client(async () => ({ rows: [], rowCount: 1 }));
    st.poolConnect.mockResolvedValue(c);
    const { ingestGiveawayEvent } = await import('../src/services/giveaway/giveawayIngest.js');
    expect(await ingestGiveawayEvent({ id: 'x', type: 'loser' })).toEqual({ unifiedId: null, stored: true });
    expect(c.query.mock.calls.some(x => x[0].includes('advisory'))).toBe(false);
  });

  it('rolls back and releases on error, even if ROLLBACK itself fails', async () => {
    const c = client(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rb');
      if (sql.includes('giveaway_affiliate_events')) throw new Error('insert boom');
      return { rows: [{ id: 1, sources: null }] };
    });
    st.poolConnect.mockResolvedValue(c);
    const { ingestGiveawayEvent } = await import('../src/services/giveaway/giveawayIngest.js');
    await expect(ingestGiveawayEvent(msg)).rejects.toThrow('insert boom');
    expect(c.release).toHaveBeenCalled();
  });
});
