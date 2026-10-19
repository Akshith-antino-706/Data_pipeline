import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory ioredis double — no real Redis connection is ever attempted.
const h = vi.hoisted(() => {
  const store = new Map<string, number>();
  const state = { connectFails: false, throwOnIncr: false, execResult: undefined as unknown, instances: 0 };
  const expireCalls: Array<[string, number, string | undefined]> = [];
  class FakeRedis {
    constructor() { state.instances += 1; }
    connect(): Promise<void> { return state.connectFails ? Promise.reject(new Error('no redis')) : Promise.resolve(); }
    on(): this { return this; }
    async incr(k: string): Promise<number> {
      if (state.throwOnIncr) throw new Error('boom');
      const n = (store.get(k) ?? 0) + 1; store.set(k, n); return n;
    }
    async expire(k: string, s: number): Promise<number> { expireCalls.push([k, s, undefined]); return 1; }
    async decr(k: string): Promise<number> {
      if (state.throwOnIncr) throw new Error('boom');
      const n = (store.get(k) ?? 0) - 1; store.set(k, n); return n;
    }
    multi() {
      const ops: Array<() => Promise<[Error | null, number]>> = [];
      const chain = {
        incr: (k: string) => { ops.push(async () => { const n = (store.get(k) ?? 0) + 1; store.set(k, n); return [null, n]; }); return chain; },
        expire: (k: string, s: number, mode?: string) => { ops.push(async () => { expireCalls.push([k, s, mode]); return [null, 1]; }); return chain; },
        exec: async (): Promise<unknown> => {
          if (state.throwOnIncr) throw new Error('boom');
          if (state.execResult !== undefined) return state.execResult;
          const out: Array<[Error | null, number]> = [];
          for (const op of ops) out.push(await op());
          return out;
        },
      };
      return chain;
    }
  }
  return { store, state, expireCalls, FakeRedis };
});
vi.mock('ioredis', () => ({ default: h.FakeRedis, Redis: h.FakeRedis }));

type CapModule = typeof import('../src/utils/emailFrequencyCap.js');

async function load(env: Record<string, string | undefined>): Promise<CapModule> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return import('../src/utils/emailFrequencyCap.js');
}

const flush = () => new Promise<void>(r => setTimeout(r, 0));

beforeEach(() => {
  h.store.clear();
  h.expireCalls.length = 0;
  h.state.connectFails = false;
  h.state.throwOnIncr = false;
  h.state.execResult = undefined;
  h.state.instances = 0;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('email cap: disabled (default)', () => {
  it('allows everything and never creates a Redis client', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: undefined, EMAIL_CAP_PER_24H: undefined });
    expect(m.isCapEnabled()).toBe(false);
    expect(m.capLimit()).toBe(3);
    for (let i = 0; i < 10; i++) expect(await m.reserveSend({ unifiedId: 1 })).toEqual({ allowed: true, count: 0, capped: false });
    await m.releaseSend({ unifiedId: 1 });
    expect(h.state.instances).toBe(0);
  });

  it('only the exact string "true" enables it', async () => {
    expect((await load({ EMAIL_CAP_ENABLED: 'TRUE' })).isCapEnabled()).toBe(false);
    expect((await load({ EMAIL_CAP_ENABLED: '1' })).isCapEnabled()).toBe(false);
  });
});

describe('email cap: enabled', () => {
  it('allows up to exactly CAP, blocks CAP+1', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '2', EMAIL_CAP_WINDOW_SEC: '60' });
    expect(await m.reserveSend({ unifiedId: 7 })).toEqual({ allowed: true, count: 1, capped: false });
    expect(await m.reserveSend({ unifiedId: 7 })).toEqual({ allowed: true, count: 2, capped: false });
    expect(await m.reserveSend({ unifiedId: 7 })).toEqual({ allowed: false, count: 3, capped: true });
    expect(h.store.get('cap:u:7')).toBe(3);
    expect(h.expireCalls[0]).toEqual(['cap:u:7', 60, 'NX']);
  });

  it('CAP=0 blocks the very first send', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '0' });
    expect((await m.reserveSend({ unifiedId: 1 })).allowed).toBe(false);
  });

  it('prefers unifiedId (incl. 0) over email; email key is trimmed+lowercased', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true' });
    await m.reserveSend({ unifiedId: 0, email: 'x@y.com' });
    await m.reserveSend({ unifiedId: '', email: '  X@Y.com ' });
    await m.reserveSend({ unifiedId: null, email: 'x@y.com' });
    expect(h.store.get('cap:u:0')).toBe(1);
    expect(h.store.get('cap:e:x@y.com')).toBe(2);
  });

  it.each([undefined, {}, { unifiedId: null, email: '' }, { phone: '123' }])('no identity %j -> allowed without counting', async (t) => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true' });
    expect(await m.reserveSend(t)).toEqual({ allowed: true, count: 0, capped: false });
    expect(h.store.size).toBe(0);
  });

  it('release decrements the counter, freeing a slot', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '1' });
    expect((await m.reserveSend({ email: 'a@b.c' })).allowed).toBe(true);
    await m.releaseSend({ email: 'a@b.c' });
    expect((await m.reserveSend({ email: 'a@b.c' })).allowed).toBe(true);
    await m.releaseSend(undefined);
  });

  it('bypass list wins over cap (case-insensitive)', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '0', EMAIL_CAP_BYPASS_EMAILS: ' QA@Test.com , ' });
    expect(await m.reserveSend({ unifiedId: 1, email: 'qa@test.COM' })).toEqual({ allowed: true, count: 0, capped: false, bypassed: true });
    await m.releaseSend({ email: 'qa@test.com' });
    expect(h.store.size).toBe(0);
  });

  it('fails open when Redis errors', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '0' });
    h.state.throwOnIncr = true;
    expect(await m.reserveSend({ unifiedId: 1 })).toEqual({ allowed: true, count: 0, capped: false });
    await expect(m.releaseSend({ unifiedId: 1 })).resolves.toBeUndefined();
  });

  it('fails open when exec returns null (aborted transaction)', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '0' });
    h.state.execResult = null;
    expect((await m.reserveSend({ unifiedId: 1 })).allowed).toBe(true);
  });

  it('fails open after the connection fails', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: '0' });
    h.state.connectFails = true;
    await m.reserveSend({ unifiedId: 1 });
    await flush();
    expect(await m.reserveSend({ unifiedId: 2 })).toEqual({ allowed: true, count: 0, capped: false });
    await m.releaseSend({ unifiedId: 2 });
  });

  it('non-numeric cap env yields NaN and therefore never caps', async () => {
    const m = await load({ EMAIL_CAP_ENABLED: 'true', EMAIL_CAP_PER_24H: 'abc' });
    expect(m.capLimit()).toBeNaN();
    for (let i = 0; i < 5; i++) expect((await m.reserveSend({ unifiedId: 1 })).allowed).toBe(true);
  });
});

describe('WhatsApp cap', () => {
  it('disabled by default', async () => {
    const m = await load({ WHATSAPP_CAP_ENABLED: undefined });
    expect(m.isWaCapEnabled()).toBe(false);
    expect(m.waCapLimit()).toBe(3);
    expect(await m.reserveWaSend({ phone: '1' })).toEqual({ allowed: true, count: 0, capped: false });
    await m.releaseWaSend({ phone: '1' });
  });

  it('caps at boundary and sets TTL only on first increment', async () => {
    const m = await load({ WHATSAPP_CAP_ENABLED: 'true', WHATSAPP_CAP_PER_24H: '2', WHATSAPP_CAP_WINDOW_SEC: '30' });
    expect((await m.reserveWaSend({ unifiedId: 5 })).count).toBe(1);
    expect((await m.reserveWaSend({ unifiedId: 5 })).allowed).toBe(true);
    expect(await m.reserveWaSend({ unifiedId: 5 })).toEqual({ allowed: false, count: 3, capped: true });
    expect(h.expireCalls).toEqual([['capwa:u:5', 30, undefined]]);
  });

  it('key priority unifiedId > email > phone digits; separate from email counter', async () => {
    const m = await load({ WHATSAPP_CAP_ENABLED: 'true', EMAIL_CAP_ENABLED: 'true' });
    await m.reserveWaSend({ email: ' A@B.c ' });
    await m.reserveWaSend({ phone: '+971 (50) 123-4567' });
    await m.reserveSend({ email: 'a@b.c' });
    expect(h.store.get('capwa:e:a@b.c')).toBe(1);
    expect(h.store.get('capwa:p:971501234567')).toBe(1);
    expect(h.store.get('cap:e:a@b.c')).toBe(1);
  });

  it('no identity -> allowed, not counted', async () => {
    const m = await load({ WHATSAPP_CAP_ENABLED: 'true' });
    expect(await m.reserveWaSend({ phone: '' })).toEqual({ allowed: true, count: 0, capped: false });
    await m.releaseWaSend({});
    expect(h.store.size).toBe(0);
  });

  it('bypass is the union of the email and WhatsApp lists', async () => {
    const m = await load({ WHATSAPP_CAP_ENABLED: 'true', WHATSAPP_CAP_PER_24H: '0', EMAIL_CAP_BYPASS_EMAILS: 'e@x.com', WHATSAPP_CAP_BYPASS_EMAILS: 'W@x.com' });
    expect((await m.reserveWaSend({ email: 'e@x.com' })).bypassed).toBe(true);
    expect((await m.reserveWaSend({ email: 'w@X.com' })).bypassed).toBe(true);
    expect((await m.reserveWaSend({ email: 'z@x.com' })).allowed).toBe(false);
    await m.releaseWaSend({ email: 'w@x.com' });
  });

  it('release decrements; fails open on errors', async () => {
    const m = await load({ WHATSAPP_CAP_ENABLED: 'true', WHATSAPP_CAP_PER_24H: '1' });
    await m.reserveWaSend({ unifiedId: 1 });
    await m.releaseWaSend({ unifiedId: 1 });
    expect(h.store.get('capwa:u:1')).toBe(0);
    h.state.throwOnIncr = true;
    expect((await m.reserveWaSend({ unifiedId: 1 })).allowed).toBe(true);
    await expect(m.releaseWaSend({ unifiedId: 1 })).resolves.toBeUndefined();
  });
});
