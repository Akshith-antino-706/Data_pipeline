import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CapResult, CapTarget } from '../src/types/utilsEmail.js';

vi.mock('ioredis', () => {
  class FakeRedis {
    on(): this { return this; }
    multi(): never { throw new Error('redis unavailable'); }
  }
  return { default: FakeRedis };
});

type Reserve = (t: CapTarget | null) => Promise<CapResult>;

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('reserveSend(null)', () => {
  it('does not throw when the cap is disabled', async () => {
    const mod = await import('../src/utils/emailFrequencyCap.js');
    const r = await (mod.reserveSend as Reserve)(null);
    expect(r.allowed).toBe(true);
  });

  it('does not throw when the cap is enabled (fail-open)', async () => {
    vi.stubEnv('EMAIL_CAP_ENABLED', 'true');
    const mod = await import('../src/utils/emailFrequencyCap.js');
    await expect((mod.reserveSend as Reserve)(null)).resolves.toMatchObject({ allowed: true });
    await expect(mod.reserveSend(undefined)).resolves.toMatchObject({ allowed: true });
    await expect(mod.reserveSend({})).resolves.toMatchObject({ allowed: true });
  });
});
