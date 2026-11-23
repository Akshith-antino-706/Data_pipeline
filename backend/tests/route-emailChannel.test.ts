import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery, createTransport } = vi.hoisted(() => ({ mockQuery: vi.fn(), createTransport: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('@sendgrid/mail', () => ({ default: { setApiKey: vi.fn(), send: vi.fn() } }));
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import { EmailChannel } from '../src/services/channels/EmailChannel.js';

const fetchSpy = vi.fn(() => Promise.reject(new Error('external fetch blocked in tests')));
const args = { to: 'someone@example.com', subject: 'Hi', html: '<p>x</p>' };

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  createTransport.mockReset();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  for (const k of ['SENDGRID_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) vi.stubEnv(k, '');
  vi.stubEnv('WELCOME_EMAILS', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('EmailChannel.send without a configured transport', () => {
  it('production + sendgrid without key → success:false provider none', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'sendgrid');
    const r = await EmailChannel.send({ ...args, to: 'p1@example.com' });
    expect(r).toMatchObject({ success: false, provider: 'none' });
    expect(r.error).toMatch(/SENDGRID_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('production + smtp without SMTP config → success:false provider none', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    const r = await EmailChannel.send({ ...args, to: 'p2@example.com' });
    expect(r).toMatchObject({ success: false, provider: 'none' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('production + default provider (unset) without SMTP → fails, not simulated', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_PROVIDER', '');
    const r = await EmailChannel.send({ ...args, to: 'p3@example.com' });
    expect(r.success).toBe(false);
    expect(r.provider).toBe('none');
  });

  it('development + smtp without config → simulated success', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    const r = await EmailChannel.send({ ...args, to: 'd1@example.com' });
    expect(r).toMatchObject({ success: true, simulated: true, provider: 'simulated' });
    expect(r.externalId).toMatch(/^sim_/);
  });

  it('development + sendgrid without key → simulated success, no network', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_PROVIDER', 'sendgrid');
    const r = await EmailChannel.send({ ...args, to: 'd2@example.com' });
    expect(r).toMatchObject({ success: true, simulated: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocked (unsubscribed) addresses are refused before any transport', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const r = await EmailChannel.send({ ...args, to: 'blocked@example.com' });
    expect(r).toMatchObject({ success: false, blocked: true });
  });

  it('isBlocked treats empty/null emails as blocked without querying', async () => {
    expect(await EmailChannel.isBlocked('')).toBe(true);
    expect(await EmailChannel.isBlocked(null)).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allow-list rejects off-list recipients', async () => {
    vi.stubEnv('WELCOME_EMAILS', 'only@example.com');
    const r = await EmailChannel.send({ ...args, to: 'other@example.com' });
    expect(r.success).toBe(false);
  });
});
