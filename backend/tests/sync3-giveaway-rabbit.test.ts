import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

type ConsumeCb = (msg: { content: Buffer } | null) => void;

class FakeChannel extends EventEmitter {
  assertExchange = vi.fn<(n: string, t: string, o: unknown) => Promise<void>>(async () => {});
  assertQueue = vi.fn<(n: string, o: unknown) => Promise<void>>(async () => {});
  bindQueue = vi.fn<(q: string, e: string, k: string) => Promise<void>>(async () => {});
  prefetch = vi.fn<(n: number) => Promise<void>>(async () => {});
  ack = vi.fn<(m: unknown) => void>();
  nack = vi.fn<(m: unknown, a: boolean, r: boolean) => void>();
  close = vi.fn<() => Promise<void>>(async () => {});
  cb: ConsumeCb | null = null;
  consume = vi.fn<(q: string, cb: ConsumeCb, o: unknown) => Promise<void>>(async (_q, cb) => { this.cb = cb; });
}
class FakeConn extends EventEmitter {
  ch = new FakeChannel();
  createChannel = vi.fn<() => Promise<FakeChannel>>(async () => this.ch);
  close = vi.fn<() => Promise<void>>(async () => {});
}

const m = vi.hoisted(() => ({
  connect: vi.fn(),
  sendMail: vi.fn<(o: Record<string, unknown>) => Promise<{ messageId: string }>>(),
  createTransport: vi.fn(),
  set: vi.fn<(...a: unknown[]) => Promise<string | null>>(),
  del: vi.fn<(k: string) => Promise<number>>(),
  exec: vi.fn<() => Promise<unknown>>(),
  lpush: vi.fn<(k: string, v: string) => void>(),
  ingest: vi.fn<(p: unknown) => Promise<{ unifiedId: number | null; stored: boolean }>>(),
  onEvent: vi.fn<(a: unknown) => Promise<number>>(),
  logSend: vi.fn<(a: unknown) => Promise<number>>(),
  markSent: vi.fn<(id: number, a: unknown) => Promise<void>>(),
  markFailed: vi.fn<(id: number, a: unknown) => Promise<void>>(),
}));

vi.mock('amqplib', () => ({ default: { connect: m.connect } }));
vi.mock('nodemailer', () => ({ default: { createTransport: m.createTransport } }));
vi.mock('../src/services/queue/index.js', () => {
  const multi = {
    lpush: (k: string, v: string) => { m.lpush(k, v); return multi; },
    ltrim: () => multi,
    expire: () => multi,
    exec: () => m.exec(),
  };
  return { getConnection: () => ({ set: m.set, del: m.del, multi: () => multi }) };
});
vi.mock('../src/services/giveaway/giveawayIngest.js', () => ({ ingestGiveawayEvent: m.ingest }));
vi.mock('../src/services/GiveawayJourneyService.js', () => ({ default: { onEvent: m.onEvent } }));
vi.mock('../src/services/SendTrackService.js', () => ({
  SendTrackService: { logSend: m.logSend, markSent: m.markSent, markFailed: m.markFailed },
}));

const ENV_KEYS = ['GIVEAWAY_RABBITMQ_URL', 'GIVEAWAY_SEND_ENABLED', 'GIVEAWAY_MAX_SEND_RETRIES', 'GIVEAWAY_PREFETCH', 'GIVEAWAY_FROM'];
const saved: Record<string, string | undefined> = {};

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

type Consumer = typeof import('../src/services/giveaway/giveawayRabbitConsumer.js');
let mod: Consumer | null = null;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GIVEAWAY_RABBITMQ_URL = 'amqp://127.0.0.1:1';
  m.createTransport.mockReturnValue({ sendMail: m.sendMail });
  m.set.mockResolvedValue('OK');
  m.del.mockResolvedValue(1);
  m.exec.mockResolvedValue([]);
  m.ingest.mockResolvedValue({ unifiedId: null, stored: true });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (mod) await mod.stopGiveawayRabbitConsumer();
  mod = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
});

async function load(env: Record<string, string> = {}): Promise<Consumer> {
  Object.assign(process.env, env);
  mod = await import('../src/services/giveaway/giveawayRabbitConsumer.js');
  return mod;
}
async function started(env: Record<string, string> = {}): Promise<FakeConn> {
  const conn = new FakeConn();
  m.connect.mockResolvedValue(conn);
  const c = await load(env);
  await c.startGiveawayRabbitConsumer();
  return conn;
}
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) {
    await vi.advanceTimersByTimeAsync(50);
    await new Promise<void>(r => setImmediate(r));
  }
  if (!cond()) throw new Error('condition never met');
}
function deliver(conn: FakeConn, body: unknown): { content: Buffer } {
  const msg = { content: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) };
  conn.ch.cb?.(msg);
  return msg;
}
const settled = (conn: FakeConn) => () => conn.ch.ack.mock.calls.length + conn.ch.nack.mock.calls.length > 0;
const events = () => m.lpush.mock.calls.map(c => JSON.parse(c[1]) as { outcome: string; reason?: string });

const valid = { version: 1, id: 'g-1', type: 'winner', to: { email: 'a@b.co', name: 'Ann' }, subject: 'You won', body: 'Hi <b>&\nbye' };

describe('giveawayRabbitConsumer — connection & topology', () => {
  it('stays idle when GIVEAWAY_RABBITMQ_URL is unset', async () => {
    process.env.GIVEAWAY_RABBITMQ_URL = '';
    const c = await load();
    await c.startGiveawayRabbitConsumer();
    expect(m.connect).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('connects with heartbeat 30 + connection name, asserts topology, prefetch, manual ack', async () => {
    const conn = await started({ GIVEAWAY_PREFETCH: '7' });
    expect(m.connect).toHaveBeenCalledWith('amqp://127.0.0.1:1', { heartbeat: 30, clientProperties: { connection_name: 'rayna-giveaway-consumer' } });
    const ch = conn.ch;
    expect(ch.assertExchange.mock.calls).toEqual([['giveaways', 'topic', { durable: true }], ['giveaways.dlx', 'fanout', { durable: true }]]);
    expect(ch.assertQueue.mock.calls).toEqual([
      ['giveaways.email.dlq', { durable: true }],
      ['giveaways.email.send', { durable: true, arguments: { 'x-dead-letter-exchange': 'giveaways.dlx' } }],
    ]);
    expect(ch.bindQueue.mock.calls).toEqual([['giveaways.email.dlq', 'giveaways.dlx', ''], ['giveaways.email.send', 'giveaways', 'giveaway.email.prod.*']]);
    expect(ch.prefetch).toHaveBeenCalledWith(7);
    expect(ch.consume.mock.calls[0][0]).toBe('giveaways.email.send');
    expect(ch.consume.mock.calls[0][2]).toEqual({ noAck: false });
  });

  it('connect failure schedules a single reconnect with exponential backoff (1s, 2s, 4s…)', async () => {
    const conn = new FakeConn();
    m.connect.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockRejectedValueOnce(new Error('again')).mockResolvedValue(conn);
    const c = await load();
    await c.startGiveawayRabbitConsumer();
    expect(m.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(m.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(m.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.connect).toHaveBeenCalledTimes(3);
    expect(conn.ch.consume).toHaveBeenCalled();
  });

  it('closes a half-open connection when channel setup fails (no leak)', async () => {
    const conn = new FakeConn();
    conn.createChannel.mockRejectedValueOnce(new Error('406'));
    m.connect.mockResolvedValue(conn);
    const c = await load();
    await c.startGiveawayRabbitConsumer();
    expect(conn.close).toHaveBeenCalledTimes(1);
  });

  it('connection close (e.g. missed heartbeat) triggers reconnect; backoff resets after success', async () => {
    const conn = await started();
    conn.emit('error', new Error('heartbeat timeout'));
    conn.emit('close');
    conn.emit('close'); // duplicate close must not start a second loop
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.connect).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it('channel close closes the connection so the reconnect path runs', async () => {
    const conn = await started();
    conn.ch.emit('error', new Error('PRECONDITION_FAILED'));
    conn.ch.emit('close');
    expect(conn.close).toHaveBeenCalledTimes(1);
  });

  it('stop closes channel+connection and suppresses reconnects', async () => {
    const conn = await started();
    const c = mod!;
    await c.stopGiveawayRabbitConsumer();
    expect(conn.ch.close).toHaveBeenCalled();
    expect(conn.close).toHaveBeenCalled();
    conn.emit('close');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.connect).toHaveBeenCalledTimes(1);
  });

  // Regression (fixed): stopGiveawayRabbitConsumer() does not clear a pending _reconnectTimer
  // (src/services/giveaway/giveawayRabbitConsumer.ts:272-277). stop → start inside the backoff
  // window connects immediately, then the stale timer fires connect() again and opens a SECOND
  // connection, overwriting _conn/_ch and leaking the first (CloudAMQP caps connections).
  it('stop then start during a pending reconnect opens only one connection', async () => {
    m.connect.mockRejectedValueOnce(new Error('down')).mockImplementation(async () => new FakeConn());
    const c = await load();
    await c.startGiveawayRabbitConsumer();      // fails → timer pending (1s)
    await c.stopGiveawayRabbitConsumer();
    await c.startGiveawayRabbitConsumer();      // connects (#2)
    await vi.advanceTimersByTimeAsync(1000);    // stale timer fires → #3
    expect(m.connect).toHaveBeenCalledTimes(2);
  });
});

describe('giveawayRabbitConsumer — message handling', () => {
  it('null deliveries (consumer cancelled) are ignored', async () => {
    const conn = await started();
    conn.ch.cb?.(null);
    await vi.advanceTimersByTimeAsync(10);
    expect(conn.ch.ack).not.toHaveBeenCalled();
  });

  it('malformed JSON → ack + drop (never requeued)', async () => {
    const conn = await started();
    const msg = deliver(conn, '{not json');
    await until(settled(conn));
    expect(conn.ch.ack).toHaveBeenCalledWith(msg);
    expect(conn.ch.nack).not.toHaveBeenCalled();
    expect(events()[0]).toMatchObject({ outcome: 'poison', reason: 'malformed_json' });
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null, 'not_an_object'],
    ['wrong version', { ...valid, version: '1' }, 'unknown_version:1'],
    ['missing id', { ...valid, id: undefined }, 'missing_id'],
    ['bad type', { ...valid, type: 'x' }, 'bad_type:x'],
    ['bad email', { ...valid, to: { email: 'a b@c.d' } }, 'invalid_email'],
    ['missing subject', { ...valid, subject: undefined }, 'missing_subject'],
    ['missing body', { ...valid, body: null }, 'missing_body'],
  ])('poison (%s) → ack, logged, not ingested', async (_n, body, reason) => {
    const conn = await started();
    deliver(conn, body);
    await until(settled(conn));
    expect(conn.ch.ack).toHaveBeenCalledTimes(1);
    expect(events()[0]).toMatchObject({ outcome: 'poison', reason });
    expect(m.ingest).not.toHaveBeenCalled();
  });

  it('log-only mode (default): ingests, claims id, acks without sending', async () => {
    const conn = await started();
    deliver(conn, valid);
    await until(settled(conn));
    expect(m.ingest).toHaveBeenCalledWith(valid);
    expect(m.set).toHaveBeenCalledWith('giveaway:email:g-1', '1', 'NX', 'EX', 604800);
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(events()[0]).toMatchObject({ outcome: 'received' });
  });

  it('duplicate redelivery → ack, no send', async () => {
    m.set.mockResolvedValue(null);
    const conn = await started({ GIVEAWAY_SEND_ENABLED: 'true' });
    deliver(conn, valid);
    await until(settled(conn));
    expect(conn.ch.ack).toHaveBeenCalled();
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(events()[0].outcome).toBe('duplicate');
  });

  it('contact handled by a giveaway journey → ack and skip the direct email', async () => {
    m.ingest.mockResolvedValue({ unifiedId: 5, stored: true });
    m.onEvent.mockResolvedValue(2);
    const conn = await started({ GIVEAWAY_SEND_ENABLED: 'true' });
    deliver(conn, valid);
    await until(settled(conn));
    expect(m.onEvent).toHaveBeenCalledWith({ giveawayType: 'winner', unifiedId: 5, eventId: 'g-1' });
    expect(m.set).not.toHaveBeenCalled();
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(events()[0].outcome).toBe('journey_handled');
  });

  it('ingest failure is logged but the message still proceeds', async () => {
    m.ingest.mockRejectedValue(new Error('db'));
    const conn = await started();
    deliver(conn, valid);
    await until(settled(conn));
    expect(conn.ch.ack).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('send enabled: sends text verbatim + escaped HTML with id header, acks, marks sent', async () => {
    m.ingest.mockResolvedValue({ unifiedId: 5, stored: true });
    m.onEvent.mockResolvedValue(0);
    m.logSend.mockResolvedValue(77);
    m.markSent.mockResolvedValue();
    m.sendMail.mockResolvedValue({ messageId: '<m@x>' });
    const conn = await started({ GIVEAWAY_SEND_ENABLED: 'true', GIVEAWAY_FROM: 'g@r.co' });
    deliver(conn, valid);
    await until(settled(conn));
    const mail = m.sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ from: 'g@r.co', to: 'Ann <a@b.co>', subject: 'You won', text: valid.body, headers: { 'X-Giveaway-Email-Id': 'g-1' } });
    expect(String(mail.html)).toContain('Hi &lt;b&gt;&amp;<br>bye');
    expect(m.markSent).toHaveBeenCalledWith(77, expect.objectContaining({ externalId: '<m@x>', provider: 'giveaway-smtp' }));
    expect(conn.ch.ack).toHaveBeenCalled();
  });

  it('SMTP keeps failing → retries MAX times, releases the claim, nack(requeue=false) → DLQ', async () => {
    m.logSend.mockRejectedValue(new Error('log down')); // logging must never block the send
    m.sendMail.mockRejectedValue(new Error('421'));
    const conn = await started({ GIVEAWAY_SEND_ENABLED: 'true', GIVEAWAY_MAX_SEND_RETRIES: '3' });
    const msg = deliver(conn, { ...valid, to: { email: 'a@b.co' } });
    await until(settled(conn));
    expect(m.sendMail).toHaveBeenCalledTimes(3);
    expect(m.sendMail.mock.calls[0][0].to).toBe('a@b.co');
    expect(m.del).toHaveBeenCalledWith('giveaway:email:g-1');
    expect(conn.ch.nack).toHaveBeenCalledWith(msg, false, false);
    expect(conn.ch.ack).not.toHaveBeenCalled();
    expect(events()[0]).toMatchObject({ outcome: 'failed', reason: '421' });
  });

  it('transient SMTP failure then success → ack', async () => {
    m.sendMail.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ messageId: 'ok' });
    const conn = await started({ GIVEAWAY_SEND_ENABLED: 'true' });
    deliver(conn, valid);
    await until(settled(conn));
    expect(m.sendMail).toHaveBeenCalledTimes(2);
    expect(conn.ch.ack).toHaveBeenCalled();
  });

  it('handler crash (Redis down) → nack to DLQ, never requeue; Redis event recording errors are swallowed', async () => {
    m.set.mockRejectedValue(new Error('redis down'));
    m.exec.mockRejectedValue(new Error('redis down'));
    const conn = await started();
    const msg = deliver(conn, valid);
    await until(settled(conn));
    expect(conn.ch.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('acks on the channel the message arrived on, not a newer one after reconnect', async () => {
    const conn1 = new FakeConn();
    const conn2 = new FakeConn();
    m.connect.mockResolvedValueOnce(conn1).mockResolvedValueOnce(conn2);
    let release: () => void = () => {};
    m.ingest.mockImplementation(() => new Promise(r => { release = () => r({ unifiedId: null, stored: true }); }));
    const c = await load();
    await c.startGiveawayRabbitConsumer();
    deliver(conn1, valid);
    conn1.emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.connect).toHaveBeenCalledTimes(2);
    release();
    await until(settled(conn1));
    expect(conn1.ch.ack).toHaveBeenCalled();
    expect(conn2.ch.ack).not.toHaveBeenCalled();
  });
});
