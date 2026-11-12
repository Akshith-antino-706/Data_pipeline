// Gupshup route tests. GupshupService + DB are mocked; external fetch is intercepted.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[]; rowCount?: number }
const { mockQuery, outbound, svc } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
  outbound: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  svc: {
    isWhatsAppConfigured: vi.fn<() => boolean>(),
    isSMSConfigured: vi.fn<() => boolean>(),
    isRCSConfigured: vi.fn<() => boolean>(),
    isRcsTemplateApiConfigured: vi.fn<() => boolean>(),
    submitTemplate: vi.fn<(id: number) => Promise<unknown>>(),
    checkTemplateStatus: vi.fn<(id: number) => Promise<unknown>>(),
    setExternalId: vi.fn<(id: number, ext: string, opts: unknown) => Promise<unknown>>(),
    getEvents: vi.fn<(id: number) => Promise<unknown>>(),
    bulkSubmit: vi.fn<() => Promise<unknown>>(),
    handleWebhook: vi.fn<(body: unknown) => Promise<Record<string, unknown>>>(),
    sendSMS: vi.fn<(o: { to: string; templateId: number; messageBody: string | null }) => Promise<Record<string, unknown>>>(),
    sendRCS: vi.fn<(o: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
    listRcsTemplates: vi.fn<() => Promise<{ templates: unknown[] }>>(),
    getRcsTemplate: vi.fn<(code: string) => Promise<unknown>>(),
    smsConfig: { senderId: 'RAYNA' },
  },
}));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/GupshupService.js', () => ({ default: svc }));

import gupshupRouter from '../src/routes/gupshup.js';

const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
  return outbound(url, init);
});

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', gupshupRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  outbound.mockReset();
  outbound.mockRejectedValue(new Error('external fetch blocked in tests'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.unstubAllEnvs();
});

interface Body { success?: boolean; received?: boolean; error?: string; data?: unknown; note?: string; source?: string; [k: string]: unknown }
async function call(path: string, method = 'GET', body?: unknown, raw?: string): Promise<{ status: number; body: Body }> {
  const init: RequestInit = { method };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  if (init.body !== undefined) init.headers = { 'content-type': 'application/json' };
  const r = await fetch(`${base}${path}`, init);
  const text = await r.text();
  let parsed: Body = {};
  try { parsed = JSON.parse(text) as Body; } catch { /* non-JSON */ }
  return { status: r.status, body: parsed };
}

describe('config', () => {
  it('reports provider configuration', async () => {
    svc.isWhatsAppConfigured.mockReturnValue(true);
    svc.isSMSConfigured.mockReturnValue(false);
    svc.isRCSConfigured.mockReturnValue(false);
    const r = await call('/config');
    expect(r.body).toEqual({ whatsapp: { configured: true }, sms: { configured: false }, rcs: { configured: false } });
  });
});

describe('template approval', () => {
  it('submit passes the numeric id and returns data', async () => {
    svc.submitTemplate.mockResolvedValue({ ok: 1 });
    const r = await call('/templates/42/submit', 'POST');
    expect(r.status).toBe(200);
    expect(svc.submitTemplate).toHaveBeenCalledWith(42);
  });

  it('submit returns 400 when the service throws', async () => {
    svc.submitTemplate.mockRejectedValue(new Error('not found'));
    const r = await call('/templates/x/submit', 'POST');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('not found');
  });

  it('check-status / events / bulk-submit map service errors to 400', async () => {
    svc.checkTemplateStatus.mockRejectedValue(new Error('a'));
    svc.getEvents.mockRejectedValue(new Error('b'));
    svc.bulkSubmit.mockRejectedValue(new Error('c'));
    expect((await call('/templates/1/check-status', 'POST')).status).toBe(400);
    expect((await call('/templates/1/events')).status).toBe(400);
    expect((await call('/bulk-submit', 'POST')).status).toBe(400);
  });

  it('events / bulk-submit success', async () => {
    svc.getEvents.mockResolvedValue([{ id: 1 }]);
    svc.bulkSubmit.mockResolvedValue({ submitted: 2 });
    expect((await call('/templates/1/events')).body.data).toEqual([{ id: 1 }]);
    expect((await call('/bulk-submit', 'POST')).body.data).toEqual({ submitted: 2 });
  });

  it('set-external-id requires externalId (empty body → 400, service untouched)', async () => {
    const r = await call('/templates/5/set-external-id', 'POST');
    expect(r.status).toBe(400);
    expect(svc.setExternalId).not.toHaveBeenCalled();
    expect((await call('/templates/5/set-external-id', 'POST', {})).status).toBe(400);
  });

  it('set-external-id forwards fields', async () => {
    svc.setExternalId.mockResolvedValue({ id: 5 });
    const r = await call('/templates/5/set-external-id', 'POST', { externalId: 'DLT1', status: 'approved', category: 'x' });
    expect(r.status).toBe(200);
    expect(svc.setExternalId).toHaveBeenCalledWith(5, 'DLT1', { status: 'approved', category: 'x' });
  });

  it('force-approve: unknown template → 400', async () => {
    const r = await call('/templates/9/force-approve', 'POST');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Template not found');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('force-approve: email template refused', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ external_status: null, channel: 'email' }] });
    const r = await call('/templates/9/force-approve', 'POST');
    expect(r.status).toBe(400);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('force-approve: whatsapp template updated + audited', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ external_status: 'pending', channel: 'whatsapp' }] });
    const r = await call('/templates/9/force-approve', 'POST');
    expect(r.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE content_templates/);
    expect(mockQuery.mock.calls[1][1]).toEqual([9]);
    expect(mockQuery.mock.calls[2][1]?.[1]).toBe('pending');
  });
});

describe('webhooks', () => {
  it('WA webhook passes the body to the service', async () => {
    svc.handleWebhook.mockResolvedValue({ updated: 1 });
    const payload = { type: 'template-event', payload: { id: 't1', status: 'APPROVED' } };
    const r = await call('/webhook/wa', 'POST', payload);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, updated: 1 });
    expect(svc.handleWebhook).toHaveBeenCalledWith(payload);
  });

  it('WA webhook: duplicate events are each forwarded (idempotency is the service’s job)', async () => {
    svc.handleWebhook.mockResolvedValue({});
    const payload = { type: 'template-event', payload: { id: 'dup' } };
    await call('/webhook/wa', 'POST', payload);
    await call('/webhook/wa', 'POST', payload);
    expect(svc.handleWebhook).toHaveBeenCalledTimes(2);
  });

  it('WA webhook: service throwing still returns 200 so Gupshup does not retry', async () => {
    svc.handleWebhook.mockRejectedValue(new Error('bad shape'));
    const r = await call('/webhook/wa', 'POST', { junk: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, error: 'bad shape' });
  });

  it('WA webhook: empty body reaches the service as undefined', async () => {
    svc.handleWebhook.mockResolvedValue({});
    const r = await call('/webhook/wa', 'POST');
    expect(r.status).toBe(200);
    expect(svc.handleWebhook).toHaveBeenCalledWith(undefined);
  });

  it('WA webhook: malformed JSON is rejected by the parser (400) before the service', async () => {
    const r = await call('/webhook/wa', 'POST', undefined, '{bad json');
    expect(r.status).toBe(400);
    expect(svc.handleWebhook).not.toHaveBeenCalled();
  });

  it('SMS webhook acks anything and touches no DB', async () => {
    const r = await call('/webhook/sms', 'POST', { externalId: "x'; DROP TABLE sms_send_log;--", status: 'DELIVERED' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // FIXED (was BUG gupshup.ts "TODO: verify Gupshup signature"): when GUPSHUP_WEBHOOK_SECRET is
  // set, the WA webhook requires the shared secret (x-gupshup-secret header or ?token=).
  it('WA webhook rejects an unsigned callback when GUPSHUP_WEBHOOK_SECRET is set', async () => {
    vi.stubEnv('GUPSHUP_WEBHOOK_SECRET', 's3cret');
    try {
      svc.handleWebhook.mockResolvedValue({});
      expect((await call('/webhook/wa', 'POST', { type: 'template-event' })).status).toBe(401);
      expect((await call('/webhook/wa?token=wrong', 'POST', { type: 'template-event' })).status).toBe(401);
      expect(svc.handleWebhook).not.toHaveBeenCalled();
      expect((await call('/webhook/wa?token=s3cret', 'POST', { type: 'template-event' })).status).toBe(200);
      const r = await fetch(`${base}/webhook/wa`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gupshup-secret': 's3cret' }, body: '{}' });
      expect(r.status).toBe(200);
      await r.text();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('WA webhook stays open when GUPSHUP_WEBHOOK_SECRET is unset', async () => {
    vi.stubEnv('GUPSHUP_WEBHOOK_SECRET', '');
    try {
      svc.handleWebhook.mockResolvedValue({});
      expect((await call('/webhook/wa', 'POST', { type: 'template-event' })).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('SMS', () => {
  it('sms/config exposes senderId', async () => {
    svc.isSMSConfigured.mockReturnValue(true);
    expect((await call('/sms/config')).body.data).toEqual({ configured: true, senderId: 'RAYNA' });
  });

  it('sms/templates: DB error → 500', async () => {
    mockQuery.mockRejectedValue(new Error('down'));
    expect((await call('/sms/templates')).status).toBe(500);
  });

  for (const phone of [undefined, '', '12345', 'abc', '+1234567890123456']) {
    it(`sms/test-send rejects phone=${String(phone)}`, async () => {
      const r = await call('/sms/test-send', 'POST', { phone, templateId: 1 });
      expect(r.status).toBe(400);
      expect(svc.sendSMS).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it('sms/test-send: empty body → 400', async () => {
    expect((await call('/sms/test-send', 'POST')).status).toBe(400);
  });

  it('sms/test-send: missing templateId → 400', async () => {
    expect((await call('/sms/test-send', 'POST', { phone: '971501234567' })).status).toBe(400);
  });

  it('sms/test-send: normalises phone, renders first_name, logs sent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rows: [{ body: 'Hi {{first_name}}!' }] })
      .mockResolvedValueOnce({ rows: [] });
    svc.sendSMS.mockResolvedValue({ success: true, externalId: 'e1', provider: 'gupshup-sms' });
    const r = await call('/sms/test-send', 'POST', { phone: '+971 50-123-4567', templateId: '3', name: 'Asha K' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(svc.sendSMS).toHaveBeenCalledWith({ to: '971501234567', templateId: 3, messageBody: 'Hi Asha!' });
    const log = mockQuery.mock.calls[2][1] ?? [];
    expect(log[0]).toBe(77);
    expect(log[7]).toBe('sent');
  });

  it('sms/test-send: "not approved" error is logged as blocked', async () => {
    svc.sendSMS.mockRejectedValue(new Error('Template not approved'));
    const r = await call('/sms/test-send', 'POST', { phone: '9715012345678', templateId: 1 });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
    const insert = mockQuery.mock.calls.find(c => /INSERT INTO sms_send_log/.test(c[0]));
    expect(insert?.[1]?.[7]).toBe('blocked');
  });

  it('sms/test-send: log failure never fails the send', async () => {
    svc.sendSMS.mockResolvedValue({ success: true, simulated: true });
    mockQuery.mockRejectedValue(new Error('db down'));
    const r = await call('/sms/test-send', 'POST', { phone: '9715012345678', templateId: 1 });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  // FIXED (was BUG src/routes/gupshup.ts:149-150): templateId is only checked for truthiness, so "abc"
  // becomes NaN and is passed to sendSMS + the DB. Expected a 400.
  it('sms/test-send rejects a non-numeric templateId', async () => {
    svc.sendSMS.mockResolvedValue({ success: true });
    const r = await call('/sms/test-send', 'POST', { phone: '971501234567', templateId: "1 OR 1=1" });
    expect(r.status).toBe(400);
  });
});

describe('RCS', () => {
  it('rcs/config reports CTM env', async () => {
    svc.isRCSConfigured.mockReturnValue(false);
    vi.stubEnv('GUPSHUP_CTM_TOKEN', 't');
    vi.stubEnv('GUPSHUP_CTM_SERVICE_ID', 's');
    expect((await call('/rcs/config')).body.data).toEqual({ configured: false, ctmConfigured: true });
  });

  it('rcs/templates uses the official API when configured', async () => {
    svc.isRcsTemplateApiConfigured.mockReturnValue(true);
    svc.listRcsTemplates.mockResolvedValue({ templates: [{ code: 'a' }] });
    const r = await call('/rcs/templates');
    expect(r.body).toEqual({ success: true, data: [{ code: 'a' }], source: 'official' });
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rcs/templates official API error → 200 success:false', async () => {
    svc.isRcsTemplateApiConfigured.mockReturnValue(true);
    svc.listRcsTemplates.mockRejectedValue(new Error('auth'));
    const r = await call('/rcs/templates');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
  });

  it('rcs/templates without any creds returns an empty list + note', async () => {
    svc.isRcsTemplateApiConfigured.mockReturnValue(false);
    vi.stubEnv('GUPSHUP_CTM_TOKEN', '');
    vi.stubEnv('GUPSHUP_CTM_SERVICE_ID', '');
    const r = await call('/rcs/templates');
    expect(r.body.data).toEqual([]);
    expect(r.body.note).toMatch(/unavailable/);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('rcs/templates CTM 401 → expired token message', async () => {
    svc.isRcsTemplateApiConfigured.mockReturnValue(false);
    vi.stubEnv('GUPSHUP_CTM_TOKEN', 't');
    vi.stubEnv('GUPSHUP_CTM_SERVICE_ID', 's');
    outbound.mockResolvedValue(new Response('{}', { status: 401 }));
    const r = await call('/rcs/templates');
    expect(r.body.success).toBe(false);
    expect(r.body.error).toMatch(/expired/);
  });

  it('rcs/templates CTM parses the component tree', async () => {
    svc.isRcsTemplateApiConfigured.mockReturnValue(false);
    vi.stubEnv('GUPSHUP_CTM_TOKEN', 't');
    vi.stubEnv('GUPSHUP_CTM_SERVICE_ID', 's');
    outbound.mockResolvedValue(new Response(JSON.stringify({
      templates: [{
        id: 'x', status: 'APPROVED', channelParams: { elementName: 'promo_1', templateType: 'RICH' },
        components: [{ type: 'text', text: { body: 'Hello' } }, { type: 'image', image: { url: 'https://i/1.png' } },
          { type: 'button', button: { text: 'Go', action: { type: 'URL' } } }],
      }],
    })));
    const r = await call('/rcs/templates');
    expect(r.body.source).toBe('ctm');
    expect(r.body.data).toEqual([{ code: 'promo_1', status: 'APPROVED', type: 'RICH', body: 'Hello', buttons: [{ text: 'Go', action: 'URL' }], image: 'https://i/1.png', createdOn: null }]);
  });

  it('rcs/templates CTM non-JSON body → empty list', async () => {
    svc.isRcsTemplateApiConfigured.mockReturnValue(false);
    vi.stubEnv('GUPSHUP_CTM_TOKEN', 't');
    vi.stubEnv('GUPSHUP_CTM_SERVICE_ID', 's');
    outbound.mockResolvedValue(new Response('<html>'));
    expect((await call('/rcs/templates')).body.data).toEqual([]);
  });

  it('rcs preview error → 200 success:false', async () => {
    svc.getRcsTemplate.mockRejectedValue(new Error('nope'));
    const r = await call('/rcs/templates/abc/preview');
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
  });

  it('rcs/test-send validates phone and templateCode', async () => {
    expect((await call('/rcs/test-send', 'POST', {})).status).toBe(400);
    expect((await call('/rcs/test-send', 'POST', { phone: '971501234567' })).status).toBe(400);
    expect(svc.sendRCS).not.toHaveBeenCalled();
  });

  it('rcs/test-send logs simulated sends with templateCode in message_body', async () => {
    svc.sendRCS.mockResolvedValue({ success: true, simulated: true });
    const r = await call('/rcs/test-send', 'POST', { phone: '971501234567', templateCode: 'promo', customParams: { a: 1 } });
    expect(r.body.success).toBe(true);
    const insert = mockQuery.mock.calls.find(c => /INSERT INTO sms_send_log/.test(c[0]));
    expect(insert?.[1]?.[5]).toBe('simulated');
    expect(insert?.[1]?.[7]).toBe('RCS templateCode=promo params={"a":1}');
  });

  it('rcs/test-send: service throwing → failed log, 200 success:false', async () => {
    svc.sendRCS.mockRejectedValue(new Error('rbm down'));
    const r = await call('/rcs/test-send', 'POST', { phone: '971501234567', templateCode: 'p' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
    const insert = mockQuery.mock.calls.find(c => /INSERT INTO sms_send_log/.test(c[0]));
    expect(insert?.[1]?.[5]).toBe('failed');
  });
});
