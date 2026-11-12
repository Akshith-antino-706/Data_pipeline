import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
interface SendArgs { to: string; subject: string; html: string }
interface SendRes { success: boolean; externalId?: string; provider?: string; error?: string }
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  reserveSend: vi.fn(async () => ({ allowed: true, count: 1 })),
  releaseSend: vi.fn(async () => undefined),
  logSend: vi.fn(async () => 77),
  markSent: vi.fn(async () => undefined),
  markFailed: vi.fn(async () => undefined),
  chatheadConfigured: vi.fn(() => false),
  chatheadSend: vi.fn<(a: SendArgs) => Promise<SendRes>>(async () => ({ success: true })),
  emailSend: vi.fn<(a: SendArgs) => Promise<SendRes>>(async () => ({ success: true, externalId: 'e1', provider: 'ses' })),
  enqueueWelcome: vi.fn(async () => ({ id: 'job1' })),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('../src/utils/emailFrequencyCap.js', () => ({ reserveSend: m.reserveSend, releaseSend: m.releaseSend }));
vi.mock('../src/services/SendTrackService.js', () => ({ SendTrackService: { logSend: m.logSend, markSent: m.markSent, markFailed: m.markFailed } }));
vi.mock('../src/services/channels/ChatheadEmailChannel.js', () => ({ ChatheadEmailChannel: { isConfigured: m.chatheadConfigured, send: m.chatheadSend } }));
vi.mock('../src/services/channels/EmailChannel.js', () => ({ EmailChannel: { send: m.emailSend } }));
vi.mock('../src/services/queue/index.js', () => ({ enqueueWelcome: m.enqueueWelcome }));

import WelcomeEmailService from '../src/services/WelcomeEmailService.js';

const contact = { id: 9, email: 'Rocky@X.com', name: 'Rocky Balboa', email_unsubscribe: null };
const routeDb = (c: Record<string, unknown> | null, ev: Record<string, unknown> | null = null): void => {
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM gtm_events')) return { rows: ev ? [ev] : [] };
    return { rows: c ? [c] : [] };
  });
};

beforeEach(() => {
  vi.stubEnv('WELCOME_ENABLED', 'true');
  vi.stubEnv('WELCOME_EMAILS', ' rocky@x.com , ');
  vi.stubEnv('WELCOME_DELAY_MIN', '2');
  for (const f of [m.query, m.reserveSend, m.releaseSend, m.logSend, m.markSent, m.markFailed, m.chatheadSend, m.emailSend, m.enqueueWelcome]) f.mockClear();
  m.reserveSend.mockResolvedValue({ allowed: true, count: 1 });
  m.emailSend.mockResolvedValue({ success: true, externalId: 'e1', provider: 'ses' });
  m.chatheadConfigured.mockReturnValue(false);
  routeDb(contact);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('WelcomeEmailService._cfg', () => {
  it('parses the switch, allowlist (trim/lower/drop blanks) and delay', () => {
    expect(WelcomeEmailService._cfg).toEqual({ enabled: true, emails: new Set(['rocky@x.com']), delayMin: 2 });
    vi.stubEnv('WELCOME_ENABLED', 'TRUE ');
    expect(WelcomeEmailService._cfg.enabled).toBe(false);
  });
});

describe('WelcomeEmailService.schedule', () => {
  it.each([
    ['disabled', () => vi.stubEnv('WELCOME_ENABLED', 'false')],
    ['empty allowlist', () => vi.stubEnv('WELCOME_EMAILS', '')],
  ])('does nothing when %s', async (_l, setup) => {
    setup();
    await WelcomeEmailService.schedule({ unifiedId: 9, eventName: 'view', eventId: 1 });
    expect(m.query).not.toHaveBeenCalled();
    expect(m.enqueueWelcome).not.toHaveBeenCalled();
  });

  it('skips contacts not on the allowlist', async () => {
    routeDb({ email: 'someone@else.com' });
    await WelcomeEmailService.schedule({ unifiedId: 9, eventName: 'view', eventId: 1 });
    expect(m.enqueueWelcome).not.toHaveBeenCalled();
  });

  it('enqueues allowlisted contacts with delay in ms (case-insensitive match)', async () => {
    vi.stubEnv('WELCOME_DELAY_MIN', '0.5');
    await WelcomeEmailService.schedule({ unifiedId: 9, eventName: 'view', eventId: 1 });
    expect(m.enqueueWelcome).toHaveBeenCalledWith({ unifiedId: 9, eventName: 'view', eventId: 1 }, 30_000);
  });
});

describe('WelcomeEmailService._send', () => {
  it('skips contacts without email, unsubscribed, or off-allowlist', async () => {
    routeDb({ ...contact, email: null });
    await WelcomeEmailService._send(9, 'x', undefined);
    routeDb({ ...contact, email_unsubscribe: 'YES' });
    await WelcomeEmailService._send(9, 'x', undefined);
    routeDb({ ...contact, email: 'nope@x.com' });
    await WelcomeEmailService._send(9, 'x', undefined);
    expect(m.reserveSend).not.toHaveBeenCalled();
    expect(m.emailSend).not.toHaveBeenCalled();
  });

  it('respects the frequency cap', async () => {
    m.reserveSend.mockResolvedValueOnce({ allowed: false, count: 3 });
    await WelcomeEmailService._send(9, 'x', undefined);
    expect(m.logSend).not.toHaveBeenCalled();
    expect(m.emailSend).not.toHaveBeenCalled();
  });

  it('sends, logs as gtm_welcome and marks sent', async () => {
    routeDb(contact, { event_id: 5, event_name: 'add_to_cart', page_url: 'https://p', raw_payload: { itemName: 'Safari' }, created_at: null });
    await WelcomeEmailService._send(9, 'view', 5);
    expect(m.logSend).toHaveBeenCalledWith(expect.objectContaining({ unifiedId: 9, source: 'gtm_welcome', subject: 'Welcome to Rayna Tours 🌴 — add_to_cart' }));
    const sent = m.emailSend.mock.calls[0]![0];
    expect(sent.to).toBe('Rocky@X.com');
    expect(sent.html).toContain('Safari');
    expect(m.markSent).toHaveBeenCalledWith(77, expect.objectContaining({ externalId: 'e1', provider: 'ses' }));
    expect(m.releaseSend).not.toHaveBeenCalled();
  });

  it('prefers the Chathead channel when configured', async () => {
    m.chatheadConfigured.mockReturnValue(true);
    await WelcomeEmailService._send(9, 'x', undefined);
    expect(m.chatheadSend).toHaveBeenCalledTimes(1);
    expect(m.emailSend).not.toHaveBeenCalled();
  });

  it('on failure releases the cap slot and marks failed', async () => {
    m.emailSend.mockResolvedValueOnce({ success: false, error: 'bounced' });
    await WelcomeEmailService._send(9, 'x', undefined);
    expect(m.releaseSend).toHaveBeenCalledWith({ unifiedId: 9, email: 'Rocky@X.com' });
    expect(m.markFailed).toHaveBeenCalledWith(77, expect.objectContaining({ error: 'bounced' }));
  });

  it('processJob ignores a missing unifiedId', async () => {
    await WelcomeEmailService.processJob({ unifiedId: 0, eventName: 'x', eventId: 1 });
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe('WelcomeEmailService._template', () => {
  it('uses the first name, escapes HTML and fills every placeholder in the override', () => {
    const tpl = '{{customer_name}}|{{event_name}}|{{event_id}}|{{item_name}}|{{page_url}}|{{event_time}}|{{cta_url}}|{{raw_payload}}';
    const { subject, html } = WelcomeEmailService._template({ name: '<b>Ana</b> Maria' }, { eventName: 'a"b', eventId: 3, payload: { itemName: 'x&y', timestamp: 'T' } }, tpl);
    expect(subject).toBe('Welcome to Rayna Tours 🌴 — a"b');
    expect(html.split('|')).toEqual(['&lt;b&gt;Ana&lt;/b&gt;', 'a&quot;b', '3', 'x&amp;y', '—', 'T', 'https://www.raynatours.com', '{\n  &quot;itemName&quot;: &quot;x&amp;y&quot;,\n  &quot;timestamp&quot;: &quot;T&quot;\n}']);
  });

  it('defaults name to "there" and falls back to the bundled template for blank overrides', () => {
    const { subject, html } = WelcomeEmailService._template({ name: null }, null, '   ');
    expect(subject).toBe('Welcome to Rayna Tours 🌴');
    expect(html).toContain('there');
    expect(html).not.toMatch(/\{\{[a-z_]+\}\}/);
  });
});
