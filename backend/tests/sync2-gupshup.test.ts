import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import GupshupService from '../src/services/GupshupService.js';

const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status });
const ENV_KEYS = ['GUPSHUP_API_KEY', 'GUPSHUP_APP_NAME', 'GUPSHUP_APP_ID', 'GUPSHUP_WA_SOURCE', 'GUPSHUP_SMS_USER_ID', 'GUPSHUP_SMS_PASSWORD',
  'GUPSHUP_SMS_SENDER_ID', 'DLT_PRINCIPAL_ENTITY_ID', 'GUPSHUP_RCS_USER_ID', 'GUPSHUP_RCS_PASSWORD', 'GUPSHUP_RCS_APP_ID', 'GUPSHUP_RCS_APP_KEY'];
const tpl = { id: 5, channel: 'whatsapp', external_status: 'approved', external_template_id: 'ext-1', name: 'Promo', body: 'Hello {{1}}' };

const routeDb = (t: Record<string, unknown> | null): void => {
  m.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT') ? { rows: t ? [t] : [] } : { rows: [] });
};
const bodyOf = (i = 0): URLSearchParams => new URLSearchParams(String(m.fetch.mock.calls[i]![1]!.body));

beforeEach(() => {
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.fetch.mockReset();
  vi.stubGlobal('fetch', m.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('config detection', () => {
  it('needs key + app name + app id for WA, user + password for SMS, RCS-specific creds for RCS', () => {
    expect(GupshupService.isWhatsAppConfigured()).toBe(false);
    vi.stubEnv('GUPSHUP_API_KEY', 'k'); vi.stubEnv('GUPSHUP_APP_NAME', 'a');
    expect(GupshupService.isWhatsAppConfigured()).toBe(false);
    vi.stubEnv('GUPSHUP_APP_ID', 'i');
    expect(GupshupService.isWhatsAppConfigured()).toBe(true);
    vi.stubEnv('GUPSHUP_SMS_USER_ID', 'u'); vi.stubEnv('GUPSHUP_SMS_PASSWORD', 'p');
    expect(GupshupService.isSMSConfigured()).toBe(true);
    expect(GupshupService.isRCSConfigured()).toBe(false);
    expect(GupshupService.rcsConfig.userId).toBe('u');
  });
});

describe('helpers', () => {
  it.each([
    [null, 'pending'], ['approved', 'approved'], ['ENABLED', 'approved'], ['rejected', 'rejected'],
    ['FLAGGED', 'paused'], ['PAUSED', 'paused'], ['disabled', 'disabled'], ['IN_APPEAL', 'pending'], ['weird', 'pending'],
  ])('_mapGupshupStatus(%j) = %s', (raw, out) => {
    expect(GupshupService._mapGupshupStatus(raw)).toBe(out);
  });

  it('_slug lowercases, collapses non-alphanumerics and trims underscores', () => {
    expect(GupshupService._slug('  Summer SALE -- 50%!! ')).toBe('summer_sale_50');
    expect(GupshupService._slug(null)).toBe('');
    expect(GupshupService._slug('x'.repeat(600))).toHaveLength(512);
  });
});

describe('assertApproved', () => {
  it('throws for missing template', async () => {
    routeDb(null);
    await expect(GupshupService.assertApproved(1)).rejects.toThrow('Template 1 not found');
  });

  it('email/push bypass approval', async () => {
    routeDb({ channel: 'email', external_status: null, name: 'x' });
    expect(await GupshupService.assertApproved(1)).toBe(true);
  });

  it('blocks unapproved WA templates and logs a send_blocked event', async () => {
    routeDb({ channel: 'whatsapp', external_status: 'pending', name: 'Promo' });
    await expect(GupshupService.assertApproved(1)).rejects.toThrow('not approved for sending via Gupshup (status: pending)');
    const log = m.query.mock.calls.find(([s]) => s.includes('template_approval_events'))!;
    expect(log[1]).toEqual([1, 'send_blocked', 'pending', 'pending', '{"reason":"not_approved"}']);
  });
});

describe('sendWhatsApp', () => {
  it('simulates without credentials and makes no HTTP call', async () => {
    routeDb(tpl);
    const r = await GupshupService.sendWhatsApp({ to: '+97150', templateId: 5 });
    expect(r).toMatchObject({ success: true, simulated: true, provider: 'gupshup-wa' });
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it('builds the form payload (no leading +, template JSON) and maps "submitted" to success', async () => {
    for (const [k, v] of [['GUPSHUP_API_KEY', 'KEY'], ['GUPSHUP_APP_NAME', 'App'], ['GUPSHUP_APP_ID', 'id'], ['GUPSHUP_WA_SOURCE', '9100']]) vi.stubEnv(k!, v!);
    routeDb(tpl);
    m.fetch.mockResolvedValueOnce(json({ status: 'submitted', messageId: 'mid' }));
    const r = await GupshupService.sendWhatsApp({ to: '+97150123', templateId: 5, params: ['Ana'] });
    expect(m.fetch.mock.calls[0]![0]).toBe('https://api.gupshup.io/wa/api/v1/template/msg');
    expect(m.fetch.mock.calls[0]![1]!.headers).toMatchObject({ apikey: 'KEY' });
    const b = bodyOf();
    expect(b.get('destination')).toBe('97150123');
    expect(b.get('source')).toBe('9100');
    expect(b.get('src.name')).toBe('App');
    expect(JSON.parse(b.get('template')!)).toEqual({ id: 'ext-1', params: ['Ana'] });
    expect(r).toMatchObject({ success: true, externalId: 'mid' });
  });

  it('returns provider error message on failure and catches network errors', async () => {
    for (const k of ['GUPSHUP_API_KEY', 'GUPSHUP_APP_NAME', 'GUPSHUP_APP_ID']) vi.stubEnv(k, 'x');
    routeDb(tpl);
    m.fetch.mockResolvedValueOnce(json({ status: 'error', message: 'Invalid template' }, 400));
    expect(await GupshupService.sendWhatsApp({ to: '1', templateId: 5 })).toMatchObject({ success: false, error: 'Invalid template' });
    m.fetch.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await GupshupService.sendWhatsApp({ to: '1', templateId: 5 })).toEqual({ success: false, error: 'ETIMEDOUT', provider: 'gupshup-wa' });
  });
});

describe('sendSMS', () => {
  it('sends DLT fields in the query string; mask only when configured', async () => {
    vi.stubEnv('GUPSHUP_SMS_USER_ID', 'u1'); vi.stubEnv('GUPSHUP_SMS_PASSWORD', 'p w'); vi.stubEnv('DLT_PRINCIPAL_ENTITY_ID', 'ent');
    routeDb({ ...tpl, channel: 'sms', external_template_id: 'dlt9', body: 'Body' });
    m.fetch.mockResolvedValueOnce(json({ response: { status: 'success', id: 'sms1' } }));
    const r = await GupshupService.sendSMS({ to: '+9199', templateId: 5 });
    const url = new URL(m.fetch.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe('https://enterprise.smsgupshup.com/GatewayAPI/rest');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ method: 'SendMessage', send_to: '9199', msg: 'Body', userid: 'u1', password: 'p w', principalEntityId: 'ent', dltTemplateId: 'dlt9' });
    expect(url.searchParams.has('mask')).toBe(false);
    expect(r).toMatchObject({ success: true, externalId: 'sms1' });
  });

  it('surfaces response.details as the error', async () => {
    vi.stubEnv('GUPSHUP_SMS_USER_ID', 'u'); vi.stubEnv('GUPSHUP_SMS_PASSWORD', 'p'); vi.stubEnv('GUPSHUP_SMS_SENDER_ID', 'RAYNA');
    routeDb({ ...tpl, channel: 'sms' });
    m.fetch.mockResolvedValueOnce(json({ response: { status: 'error', details: 'DLT mismatch' } }));
    const r = await GupshupService.sendSMS({ to: '1', templateId: 5, messageBody: 'override' });
    expect(new URL(m.fetch.mock.calls[0]![0]).searchParams.get('mask')).toBe('RAYNA');
    expect(new URL(m.fetch.mock.calls[0]![0]).searchParams.get('msg')).toBe('override');
    expect(r).toMatchObject({ success: false, error: 'DLT mismatch' });
  });
});

describe('sendRCS', () => {
  beforeEach(() => { vi.stubEnv('GUPSHUP_RCS_USER_ID', 'ru'); vi.stubEnv('GUPSHUP_RCS_PASSWORD', 'rp'); });

  it('requires a templateCode', async () => {
    await expect(GupshupService.sendRCS({ to: '1', templateCode: '' })).rejects.toThrow('templateCode is required');
  });

  it('wraps templateCode + stringified customParams in contentMessage', async () => {
    m.fetch.mockResolvedValueOnce(json({ response: { status: 'success', id: 'r1' } }));
    const r = await GupshupService.sendRCS({ to: '+911234567890', templateCode: 'promo', customParams: { NAME: 'Ana' } });
    const b = bodyOf();
    expect(JSON.parse(b.get('msg')!)).toEqual({ contentMessage: { templateMessage: { templateCode: 'promo', customParams: '{"NAME":"Ana"}' } } });
    expect(b.get('auth_scheme')).toBe('plain');
    expect(b.get('userid')).toBe('ru');
    expect(r).toMatchObject({ success: true, externalId: 'r1' });
  });

  it('uses the v2 RCS+SMS envelope when a fallback and sender mask are set', async () => {
    vi.stubEnv('GUPSHUP_SMS_SENDER_ID', 'RAYNA');
    m.fetch.mockResolvedValueOnce(json({ response: { status: 'error', id: '106' } }));
    const r = await GupshupService.sendRCS({ to: '1', templateCode: 'promo', smsFallback: 'plain text' });
    expect(JSON.parse(bodyOf().get('msg')!)).toEqual({ version: 2, RCS: { template: { templateCode: 'promo' } }, SMS: { mask: 'RAYNA', msg: 'plain text' } });
    expect(r.error).toBe('send failed (code 106)');
  });
});

describe('sendRcsBulk', () => {
  it('validates input', async () => {
    await expect(GupshupService.sendRcsBulk({ contacts: [], templateCode: 'x' })).rejects.toThrow('non-empty');
    await expect(GupshupService.sendRcsBulk({ contacts: [{ phone: '1' }], templateCode: '' })).rejects.toThrow('templateCode');
  });

  it('builds a CSV with header, digits-only phones, sanitised values, and drops short numbers', async () => {
    vi.stubEnv('GUPSHUP_RCS_USER_ID', 'ru'); vi.stubEnv('GUPSHUP_RCS_PASSWORD', 'rp');
    m.fetch.mockResolvedValueOnce(json({ response: { status: 'success' }, data: { causeId: 'tx9' } }));
    const r = await GupshupService.sendRcsBulk({
      templateCode: 'promo', varKeys: ['NAME', 'CITY'], msgId: 'm1',
      contacts: [{ phone: '+91 98765-43210', vars: { NAME: 'A, B\nC', CITY: 'Dubai' } }, { phone: '12345' }, { phone: '971501234567' }],
    });
    const form = m.fetch.mock.calls[0]![1]!.body as FormData;
    const csv = await (form.get('xlsFile') as Blob).text();
    expect(csv).toBe('PHONE,%VAR1,%VAR2\r\n919876543210,A  B C,Dubai\r\n971501234567,,\r\n');
    expect(JSON.parse(String(form.get('msg')))).toEqual({ contentMessage: { templateMessage: { templateCode: 'promo', customParams: '{"NAME":"%VAR1","CITY":"%VAR2"}' } } });
    expect(form.get('method')).toBe('xlsUpload');
    expect(form.get('msg_id')).toBe('m1');
    expect(r).toMatchObject({ success: true, transactionId: 'tx9', count: 2 });
  });

  it('returns an error (no HTTP) when no recipient is valid', async () => {
    vi.stubEnv('GUPSHUP_RCS_USER_ID', 'ru'); vi.stubEnv('GUPSHUP_RCS_PASSWORD', 'rp');
    const r = await GupshupService.sendRcsBulk({ templateCode: 'p', contacts: [{ phone: '123' }] });
    expect(r.success).toBe(false);
    expect(m.fetch).not.toHaveBeenCalled();
  });
});

describe('webhook + RCS template API', () => {
  it('ignores payloads without id/status or for unknown templates', async () => {
    expect(await GupshupService.handleWebhook({})).toMatchObject({ ignored: true });
    routeDb(null);
    expect(await GupshupService.handleWebhook({ templateId: 'x', status: 'APPROVED' })).toMatchObject({ reason: 'unknown external template id' });
  });

  it('maps status and updates the row', async () => {
    routeDb({ id: 5, external_status: 'pending' });
    const r = await GupshupService.handleWebhook({ template: { id: 'ext', status: 'REJECTED' }, reason: 'bad' });
    expect(r).toEqual({ templateId: 5, status: 'rejected', previous: 'pending' });
    const upd = m.query.mock.calls.find(([s]) => s.startsWith('UPDATE'))!;
    expect(upd[1]!.slice(0, 3)).toEqual([5, 'rejected', 'bad']);
  });

  it('listRcsTemplates: unconfigured, paged, 401 and API error', async () => {
    expect(await GupshupService.listRcsTemplates()).toMatchObject({ configured: false, templates: [] });
    vi.stubEnv('GUPSHUP_RCS_APP_ID', 'app'); vi.stubEnv('GUPSHUP_RCS_APP_KEY', 'key');
    m.fetch
      .mockResolvedValueOnce(json({ totalPages: 2, data: [{ name: 't1', status: 'APPROVED' }] }))
      .mockResolvedValueOnce(json({ totalPages: 2, data: [{ name: 't2' }] }));
    const r = await GupshupService.listRcsTemplates({ pageSize: 1 });
    expect(r.templates.map(t => t.code)).toEqual(['t1', 't2']);
    expect(m.fetch.mock.calls[1]![0]).toContain('/v2/app/app/template?pageNo=2&size=1');
    m.fetch.mockResolvedValueOnce(json({}, 401));
    await expect(GupshupService.listRcsTemplates()).rejects.toMatchObject({ unauthorized: true });
    m.fetch.mockResolvedValueOnce(json({ status: 400, message: 'Invalid App ID' }));
    await expect(GupshupService.listRcsTemplates()).rejects.toThrow('RCS template API 400: Invalid App ID');
  });

  it('getRcsTemplate base64-encodes the name and flattens cards', async () => {
    vi.stubEnv('GUPSHUP_RCS_APP_ID', 'app'); vi.stubEnv('GUPSHUP_RCS_APP_KEY', 'key');
    m.fetch.mockResolvedValueOnce(json({ templateDetails: { name: 'n', status: 'APPROVED' }, carouselDetails: [
      { cardTitle: 'T', cardDescription: 'D', mediaUrl: 'img', suggestions: [{ displayText: 'Go', url: 'u' }] },
    ] }));
    const r = await GupshupService.getRcsTemplate('n');
    expect(m.fetch.mock.calls[0]![0]).toMatch(/\/template\/bg==$/);
    expect(r).toMatchObject({ body: 'T\n\nD', image: 'img', buttons: [{ text: 'Go', action: 'u' }] });
  });

  it('submitTemplate simulates WA and rejects non-approval channels', async () => {
    routeDb({ ...tpl, channel: 'email' });
    await expect(GupshupService.submitTemplate(5)).rejects.toThrow("Channel 'email'");
    routeDb({ ...tpl, external_status: null });
    const r = await GupshupService.submitTemplate(5);
    expect(r).toMatchObject({ simulated: true, status: 'pending', category: 'MARKETING' });
  });

  it('_logEvent never throws', async () => {
    m.query.mockRejectedValueOnce(new Error('db'));
    await expect(GupshupService._logEvent(1, 'x', null, null, null)).resolves.toBeUndefined();
  });
});
