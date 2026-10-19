import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job, ConnectionOptions } from 'bullmq';
import type { ConsumeMessage } from 'amqplib';
import type { GiveawayMessage, GiveawayJobResult } from '../src/types/giveaway.js';

type Q = { rows: unknown[]; rowCount?: number };

const m = vi.hoisted(() => {
  process.env.GIVEAWAY_SEND_ENABLED = 'true';
  process.env.GIVEAWAY_MAX_SEND_RETRIES = '2';
  process.env.GIVEAWAY_FROM = 'Rayna <g@x.test>';
  const clientQuery = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  // Redis (ioredis via getConnection)
  const redisSet = vi.fn<(...a: unknown[]) => Promise<'OK' | null>>();
  const redisDel = vi.fn(async () => 1);
  const multiExec = vi.fn(async () => []);
  const multi: { lpush: ReturnType<typeof vi.fn<(k: string, v: string) => unknown>>; ltrim: () => unknown; expire: () => unknown; exec: () => Promise<unknown[]> } = { lpush: vi.fn((_k: string, _v: string) => multi), ltrim: vi.fn(() => multi), expire: vi.fn(() => multi), exec: multiExec };
  const redis = { set: redisSet, del: redisDel, multi: vi.fn(() => multi), quit: vi.fn() };
  // BullMQ
  const queueAdd = vi.fn(async (name: string, data: unknown, opts: unknown) => ({ name, data, opts }));
  const getJobs = vi.fn<(types: string[], s: number, e: number, asc: boolean) => Promise<unknown[]>>(async () => []);
  const getJobCounts = vi.fn(async () => ({ waiting: 0 }));
  const queueCtor = vi.fn();
  class FakeQueue {
    add = queueAdd; getJobs = getJobs; getJobCounts = getJobCounts;
    constructor(name: string, opts: unknown) { queueCtor(name, opts); }
  }
  const workerCtor = vi.fn();
  const workerOn = vi.fn<(ev: string, cb: unknown) => void>();
  const workerClose = vi.fn(async () => undefined);
  class FakeWorker {
    on = workerOn; close = workerClose;
    constructor(name: string, proc: unknown, opts: unknown) { workerCtor(name, proc, opts); }
  }
  // amqplib
  const ch = {
    assertExchange: vi.fn(async () => ({})), assertQueue: vi.fn(async () => ({})), bindQueue: vi.fn(async () => ({})),
    prefetch: vi.fn(async () => ({})), consume: vi.fn(async (_q: string, _cb: unknown, _o: unknown) => ({})), on: vi.fn(), ack: vi.fn(), nack: vi.fn(),
    close: vi.fn(async () => undefined),
  };
  const conn = { on: vi.fn(), createChannel: vi.fn(async () => ch), close: vi.fn(async () => undefined) };
  const amqpConnect = vi.fn(async () => conn);
  const sendMail = vi.fn<(o: Record<string, unknown>) => Promise<{ messageId: string }>>();
  const createTransport = vi.fn(() => ({ sendMail }));
  const ingest = vi.fn<(p: unknown) => Promise<{ unifiedId: number | null; stored: boolean }>>();
  const onEvent = vi.fn<(a: unknown) => Promise<number>>();
  const logSend = vi.fn(async () => 77);
  const markSent = vi.fn(async () => undefined);
  const markFailed = vi.fn(async () => undefined);
  return { clientQuery, release, connect, redisSet, redisDel, multi, multiExec, redis, queueAdd, getJobs, getJobCounts, queueCtor,
    FakeQueue, FakeWorker, workerCtor, workerOn, workerClose, ch, conn, amqpConnect, sendMail, createTransport, ingest, onEvent,
    logSend, markSent, markFailed };
});

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('bullmq', () => ({ Queue: m.FakeQueue, Worker: m.FakeWorker, QueueEvents: vi.fn() }));
vi.mock('ioredis', () => ({ default: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: m.amqpConnect } }));
vi.mock('nodemailer', () => ({ default: { createTransport: m.createTransport } }));
vi.mock('../src/config/database.js', () => ({ default: { connect: m.connect, query: vi.fn() }, query: vi.fn(), transaction: vi.fn() }));
vi.mock('../src/services/queue/index.js', () => ({ getConnection: () => m.redis }));
vi.mock('../src/services/GiveawayJourneyService.js', () => ({ default: { onEvent: m.onEvent } }));
vi.mock('../src/services/SendTrackService.js', () => ({ SendTrackService: { logSend: m.logSend, markSent: m.markSent, markFailed: m.markFailed } }));

vi.mock('../src/services/giveaway/giveawayIngest.js', () => ({ ingestGiveawayEvent: m.ingest }));

// The consumer gets the mocked ingest; the ingest tests use the real module (its DB is mocked).
const { ingestGiveawayEvent } = await vi.importActual<typeof import('../src/services/giveaway/giveawayIngest.js')>('../src/services/giveaway/giveawayIngest.js');
import * as GQ from '../src/services/giveaway/giveawayQueue.js';
import { startGiveawayWorker, stopGiveawayWorker } from '../src/services/giveaway/giveawayWorker.js';
import { startGiveawayRabbitConsumer, stopGiveawayRabbitConsumer } from '../src/services/giveaway/giveawayRabbitConsumer.js';

const valid = (over: Partial<GiveawayMessage> = {}): GiveawayMessage => ({
  version: 1, id: 'u-1', type: 'winner', tenantId: 3, giveawayId: 'g9',
  to: { email: 'win@x.test', name: 'Win' }, subject: 'You won', body: 'Hi <b>&\nthere', createdAt: '2026-10-19T00:00:00Z', ...over,
});

beforeEach(() => {
  for (const fn of [m.clientQuery, m.release, m.redisSet, m.redisDel, m.multiExec, m.queueAdd, m.getJobs, m.getJobCounts, m.workerCtor, m.workerOn,
    m.workerClose, m.amqpConnect, m.sendMail, m.createTransport, m.ingest, m.onEvent, m.logSend, m.markSent, m.markFailed,
    m.ch.consume, m.ch.ack, m.ch.nack, m.ch.on, m.ch.close, m.ch.assertExchange, m.ch.assertQueue, m.ch.bindQueue, m.ch.prefetch,
    m.conn.on, m.conn.close, m.conn.createChannel]) fn.mockClear();
  m.clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  m.redisSet.mockReset().mockResolvedValue('OK');
  m.sendMail.mockReset().mockResolvedValue({ messageId: '<m1>' });
  m.ingest.mockReset().mockResolvedValue({ unifiedId: null, stored: true });
  m.onEvent.mockReset().mockResolvedValue(0);
  m.getJobs.mockReset().mockResolvedValue([]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════ giveawayIngest ═══════════════════════
describe('ingestGiveawayEvent', () => {
  const route = (found: { id: number; sources: string | null } | null, inserted = 1) =>
    m.clientQuery.mockImplementation(async (sql: string): Promise<Q> => {
      if (sql.startsWith('SELECT id, sources')) return { rows: found ? [found] : [] };
      if (sql.includes('INSERT INTO unified_contacts')) return { rows: [{ id: 500 }] };
      if (sql.includes('INSERT INTO giveaway_events')) return { rows: [], rowCount: inserted };
      return { rows: [], rowCount: 1 };
    });
  const sqls = () => m.clientQuery.mock.calls.map(c => c[0].trim().split(/\s+/).slice(0, 3).join(' '));

  it('new email → advisory lock, creates B2C contact, stores event, commits', async () => {
    route(null);
    const r = await ingestGiveawayEvent(valid({ data: { winner: { rank: '1st', code: 'C' }, prize: { value: 0 }, user: { name: '' } } }));
    expect(r).toEqual({ unifiedId: 500, stored: true });
    expect(sqls()[0]).toBe('BEGIN');
    expect(m.clientQuery.mock.calls[1]).toEqual([expect.stringContaining('pg_advisory_xact_lock'), ['win@x.test']]);
    expect(m.clientQuery.mock.calls.find(c => c[0].includes('INSERT INTO unified_contacts'))?.[1]).toEqual(['win@x.test', 'Win']);
    const ev = m.clientQuery.mock.calls.find(c => c[0].includes('giveaway_events'))![1]!;
    expect(ev.slice(0, 8)).toEqual(['u-1', 1, 'winner', '3', 'g9', 500, 'win@x.test', 'Win']);   // empty user.name → to.name
    expect(ev[14]).toBe('0');     // prize value 0 kept (not null)
    expect(ev[15]).toBe(1);       // rank '1st' → 1
    expect(JSON.parse(String(ev[26]))).toMatchObject({ id: 'u-1' });
    expect(sqls().at(-1)).toBe('COMMIT');
    expect(m.release).toHaveBeenCalledTimes(1);
  });

  it('existing contact without giveaway source → appends source; with it → no UPDATE', async () => {
    route({ id: 7, sources: 'web, booking' });
    expect((await ingestGiveawayEvent(valid())).unifiedId).toBe(7);
    expect(m.clientQuery.mock.calls.filter(c => c[0].includes('UPDATE unified_contacts'))[0][1]).toEqual([7]);
    m.clientQuery.mockClear();
    route({ id: 7, sources: 'web, giveaway' });
    await ingestGiveawayEvent(valid());
    expect(m.clientQuery.mock.calls.some(c => c[0].includes('UPDATE unified_contacts'))).toBe(false);
  });

  it('redelivery (event already stored) → stored:false; no email → no contact lookup, unifiedId null', async () => {
    route(null, 0);
    const r = await ingestGiveawayEvent({ id: 'x', type: 'loser' });
    expect(r).toEqual({ unifiedId: null, stored: false });
    expect(m.clientQuery.mock.calls.some(c => c[0].includes('advisory'))).toBe(false);
    const ev = m.clientQuery.mock.calls.find(c => c[0].includes('giveaway_events'))![1]!;
    expect(ev[1]).toBe(1);      // version defaults to 1
    expect(ev[3]).toBe('');     // tenantId missing → ''
  });

  it('DB error → ROLLBACK, release, rethrow', async () => {
    m.clientQuery.mockImplementation(async (sql: string): Promise<Q> => {
      if (sql.includes('giveaway_events')) throw new Error('constraint');
      if (sql.includes('INSERT INTO unified_contacts')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });
    await expect(ingestGiveawayEvent(valid())).rejects.toThrow('constraint');
    expect(m.clientQuery.mock.calls.some(c => c[0] === 'ROLLBACK')).toBe(true);
    expect(m.release).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════ giveawayQueue ═══════════════════════
describe('giveawayQueue', () => {
  it('builds one giveaway-email queue lazily; enqueue uses payload id as jobId', async () => {
    expect(GQ.GIVEAWAY_EMAIL_QUEUE).toBe('giveaway-email');
    await GQ.enqueueGiveawayEmail(valid({ id: 42 }));
    await GQ.enqueueGiveawayEmail({ version: 1 });
    expect(GQ.getGiveawayQueue()).toBe(GQ.getGiveawayQueue());
    expect(m.queueCtor).toHaveBeenCalledTimes(1);
    expect(m.queueCtor.mock.calls[0][0]).toBe('giveaway-email');
    expect(m.queueAdd.mock.calls[0][0]).toBe('giveaway.email');
    expect(m.queueAdd.mock.calls[0][2]).toEqual({ jobId: '42' });
    expect(m.queueAdd.mock.calls[1][2]).toEqual({ jobId: undefined });
  });

  it('giveawayQueueCounts asks for the 5 states', async () => {
    await GQ.giveawayQueueCounts();
    expect(m.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'completed', 'failed');
  });

  it('recentGiveawayJobs labels outcomes and sorts newest first, capped at limit', async () => {
    const job = (id: string, t: number, rv?: GiveawayJobResult, failedReason?: string) =>
      ({ id, data: valid({ id }), attemptsMade: 1, timestamp: t, processedOn: undefined, finishedOn: t, returnvalue: rv, failedReason });
    m.getJobs.mockImplementation(async (types: string[]) => {
      switch (types[0]) {
        case 'completed': return [job('c1', 10, { logged: true }), job('c2', 50, { dropped: true, reason: 'invalid_email' }), job('c3', 5, { duplicate: true }), job('c4', 1, {})];
        case 'failed': return [job('f1', 40, undefined, 'smtp')];
        case 'active': return [job('a1', 30)];
        case 'waiting': return [job('w1', 20)];
        default: return [];
      }
    });
    const rows = await GQ.recentGiveawayJobs(6);
    expect(m.getJobs).toHaveBeenCalledWith(['completed'], 0, 5, false);
    expect(rows.map(r => [r.jobId, r.label, r.detail])).toEqual([
      ['c2', 'dropped', 'invalid_email'], ['f1', 'failed', 'smtp'], ['a1', 'processing', ''],
      ['w1', 'queued', ''], ['c1', 'received', 'would send (SMTP not wired)'], ['c3', 'duplicate', ''],
    ]);
    expect(rows[0]).toMatchObject({ email: 'win@x.test', subject: 'You won', tenantId: 3, state: 'completed' });
  });

  it('recentGiveawayJobs with no jobs → []', async () => {
    expect(await GQ.recentGiveawayJobs()).toEqual([]);
  });
});

// ═══════════════════════ giveawayWorker ═══════════════════════
type Processor = (job: Job<GiveawayMessage, GiveawayJobResult>) => Promise<GiveawayJobResult>;
describe('giveawayWorker', () => {
  let proc: Processor;
  beforeEach(async () => {
    await stopGiveawayWorker();
    startGiveawayWorker();
    proc = m.workerCtor.mock.calls.at(-1)![1] as Processor;
  });
  const run = (data: GiveawayMessage) => proc({ id: 'j', data } as unknown as Job<GiveawayMessage, GiveawayJobResult>);

  it('starts one worker on giveaway-email with concurrency; second start returns same; stop closes', async () => {
    const w = startGiveawayWorker();
    expect(m.workerCtor).toHaveBeenCalledTimes(1);
    const opts = m.workerCtor.mock.calls[0][2] as { connection: ConnectionOptions; concurrency: number };
    expect(m.workerCtor.mock.calls[0][0]).toBe('giveaway-email');
    expect(opts.concurrency).toBe(10);
    expect(opts.connection).toBe(m.redis);
    expect(m.workerOn.mock.calls.map(c => c[0])).toEqual(['failed', 'error']);
    expect(startGiveawayWorker()).toBe(w);
    await stopGiveawayWorker();
    expect(m.workerClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...valid(), version: 2 }, 'unknown_version:2'],
    [{ ...valid(), id: undefined }, 'missing_id'],
    [{ ...valid(), type: 'spam' }, 'bad_type:spam'],
    [{ ...valid(), to: { email: 'nope' } }, 'invalid_email'],
    [{ ...valid(), subject: '' }, 'missing_subject'],
    [{ ...valid(), body: undefined }, 'missing_body'],
  ])('poison %# → dropped (%s), never touches redis', async (data, reason) => {
    expect(await run(data)).toEqual({ dropped: true, reason });
    expect(m.redisSet).not.toHaveBeenCalled();
  });

  it('null job data defaults to {} → unknown_version', async () => {
    expect(await proc({ id: 'j', data: null } as unknown as Job<GiveawayMessage, GiveawayJobResult>)).toEqual({ dropped: true, reason: 'unknown_version:undefined' });
  });

  it('valid first time → SET NX EX 7d, logged:true; duplicate → duplicate:true', async () => {
    expect(await run(valid())).toEqual({ logged: true });
    expect(m.redisSet).toHaveBeenCalledWith('giveaway:email:u-1', '1', 'NX', 'EX', 604800);
    m.redisSet.mockResolvedValueOnce(null);
    expect(await run(valid())).toEqual({ duplicate: true });
  });

  it('redis failure throws so BullMQ retries', async () => {
    m.redisSet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(run(valid())).rejects.toThrow('ECONNREFUSED');
  });
});

// ═══════════════════════ giveawayRabbitConsumer ═══════════════════════
type Handler = (msg: ConsumeMessage | null) => void;
describe('giveawayRabbitConsumer', () => {
  const ORIG = process.env.GIVEAWAY_RABBITMQ_URL;
  let handler: Handler;
  const msg = (body: string): ConsumeMessage => ({ content: Buffer.from(body), fields: {}, properties: {} } as unknown as ConsumeMessage);
  // handle() is fire-and-forget inside consume; flush microtasks until ack/nack lands.
  const deliver = async (body: string) => {
    const mm = msg(body);
    handler(mm);
    for (let i = 0; i < 50 && !m.ch.ack.mock.calls.length && !m.ch.nack.mock.calls.length; i++) await new Promise(r => setImmediate(r));
    return mm;
  };
  const lastEvent = () => JSON.parse(String(m.multi.lpush.mock.calls.at(-1)?.[1])) as { outcome: string; reason?: string; msgId?: string };

  beforeEach(async () => {
    process.env.GIVEAWAY_RABBITMQ_URL = 'amqp://127.0.0.1:1';
    await startGiveawayRabbitConsumer();
    handler = m.ch.consume.mock.calls.at(-1)![1] as Handler;
    m.ch.ack.mockClear(); m.ch.nack.mockClear(); m.multi.lpush.mockClear();
  });
  afterEach(async () => { await stopGiveawayRabbitConsumer(); process.env.GIVEAWAY_RABBITMQ_URL = ORIG; });

  it('declares topology (exchange, DLX, DLQ, binding giveaway.email.prod.*), prefetch 10, manual ack', () => {
    expect(m.amqpConnect).toHaveBeenCalledWith('amqp://127.0.0.1:1', expect.objectContaining({ heartbeat: 30 }));
    expect(m.ch.assertExchange.mock.calls).toEqual([['giveaways', 'topic', { durable: true }], ['giveaways.dlx', 'fanout', { durable: true }]]);
    expect(m.ch.assertQueue).toHaveBeenCalledWith('giveaways.email.send', { durable: true, arguments: { 'x-dead-letter-exchange': 'giveaways.dlx' } });
    expect(m.ch.bindQueue).toHaveBeenCalledWith('giveaways.email.send', 'giveaways', 'giveaway.email.prod.*');
    expect(m.ch.bindQueue).toHaveBeenCalledWith('giveaways.email.dlq', 'giveaways.dlx', '');
    expect(m.ch.prefetch).toHaveBeenCalledWith(10);
    expect(m.ch.consume.mock.calls.at(-1)![0]).toBe('giveaways.email.send');
    expect(m.ch.consume.mock.calls.at(-1)![2]).toEqual({ noAck: false });
  });

  it('no URL → stays idle, never connects', async () => {
    await stopGiveawayRabbitConsumer();
    m.amqpConnect.mockClear();
    process.env.GIVEAWAY_RABBITMQ_URL = '';
    await startGiveawayRabbitConsumer();
    expect(m.amqpConnect).not.toHaveBeenCalled();
  });

  it('malformed JSON → ack + poison event, no ingest', async () => {
    const mm = await deliver('{not json');
    expect(m.ch.ack).toHaveBeenCalledWith(mm);
    expect(m.ingest).not.toHaveBeenCalled();
    expect(lastEvent()).toMatchObject({ outcome: 'poison', reason: 'malformed_json' });
  });

  it('invalid contract → ack (never requeue) with reason', async () => {
    await deliver(JSON.stringify(valid({ type: 'bogus' })));
    expect(m.ch.ack).toHaveBeenCalledTimes(1);
    expect(m.ch.nack).not.toHaveBeenCalled();
    expect(lastEvent()).toMatchObject({ outcome: 'poison', reason: 'bad_type:bogus' });
  });

  it('valid + SMTP ok → SET NX claim, sends escaped html + verbatim text, logs send, ack', async () => {
    await deliver(JSON.stringify(valid()));
    expect(m.redisSet).toHaveBeenCalledWith('giveaway:email:u-1', '1', 'NX', 'EX', 604800);
    const mail = m.sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      from: 'Rayna <g@x.test>', to: 'Win <win@x.test>', subject: 'You won', text: 'Hi <b>&\nthere',
      headers: { 'X-Giveaway-Email-Id': 'u-1' },
    });
    expect(String(mail.html)).toContain('Hi &lt;b&gt;&amp;<br>there');
    expect(m.logSend).toHaveBeenCalledWith(expect.objectContaining({ email: 'win@x.test', source: 'giveaway', templateLabel: 'Giveaway: winner' }));
    expect(m.markSent).toHaveBeenCalledWith(77, expect.objectContaining({ externalId: '<m1>', provider: 'giveaway-smtp' }));
    expect(m.ch.ack).toHaveBeenCalledTimes(1);
    expect(lastEvent()).toMatchObject({ outcome: 'sent', msgId: '<m1>' });
  });

  it('a journey handles the contact → no direct email, ack', async () => {
    m.ingest.mockResolvedValue({ unifiedId: 5, stored: true });
    m.onEvent.mockResolvedValue(1);
    await deliver(JSON.stringify(valid()));
    expect(m.onEvent).toHaveBeenCalledWith({ giveawayType: 'winner', unifiedId: 5, eventId: 'u-1' });
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(m.redisSet).not.toHaveBeenCalled();
    expect(lastEvent().outcome).toBe('journey_handled');
  });

  it('ingest failure is non-fatal → still sends', async () => {
    m.ingest.mockRejectedValue(new Error('db down'));
    await deliver(JSON.stringify(valid()));
    expect(m.sendMail).toHaveBeenCalledTimes(1);
    expect(m.ch.ack).toHaveBeenCalledTimes(1);
  });

  it('duplicate redelivery → ack without sending', async () => {
    m.redisSet.mockResolvedValue(null);
    await deliver(JSON.stringify(valid()));
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(lastEvent().outcome).toBe('duplicate');
  });

  it('SMTP keeps failing → retries, releases claim, marks failed, nack(false,false) → DLQ', async () => {
    m.sendMail.mockRejectedValue(new Error('421 busy'));
    const mm = msg(JSON.stringify(valid()));
    handler(mm);
    for (let i = 0; i < 200 && !m.ch.nack.mock.calls.length; i++) await new Promise(r => setTimeout(r, 10));
    expect(m.sendMail).toHaveBeenCalledTimes(2);
    expect(m.redisDel).toHaveBeenCalledWith('giveaway:email:u-1');
    expect(m.markFailed).toHaveBeenCalledWith(77, expect.objectContaining({ error: '421 busy' }));
    expect(m.ch.nack).toHaveBeenCalledWith(mm, false, false);
    expect(m.ch.ack).not.toHaveBeenCalled();
  });

  it('null delivery (consumer cancelled) is ignored', () => {
    expect(() => handler(null)).not.toThrow();
  });

  it('connect failure → schedules a single reconnect and closes the stale connection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await stopGiveawayRabbitConsumer();
    m.amqpConnect.mockClear();
    m.conn.createChannel.mockRejectedValueOnce(new Error('406'));
    await startGiveawayRabbitConsumer();
    expect(m.conn.close).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('reconnecting in'));
    await vi.advanceTimersByTimeAsync(1_100);
    expect(m.amqpConnect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('stop closes channel + connection and is safe twice', async () => {
    await stopGiveawayRabbitConsumer();
    await stopGiveawayRabbitConsumer();
    expect(m.ch.close).toHaveBeenCalledTimes(1);
  });
});
