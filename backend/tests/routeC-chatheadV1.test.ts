// chatheadV1.ts routes. DB, ChatHeadV1Service, WhatsAppDeliverySync mocked; ChatHead HTTP
// calls are intercepted by a fetch stub (only 127.0.0.1 goes to the real network stack).
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[] }
const { mockQuery, outbound, ch, deliv } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
  outbound: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  ch: {
    createBroadcast: vi.fn<(o: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
    sendBroadcast: vi.fn<(o: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
    buildAndSaveDataFile: vi.fn<(c: unknown[], f: string) => Promise<{ id: number; filename: string }>>(),
    uploadDataFile: vi.fn<(f: unknown) => Promise<{ ok: boolean }>>(),
  },
  deliv: {
    syncBroadcast: vi.fn<(id: string) => Promise<unknown>>(),
    syncPending: vi.fn<() => Promise<unknown>>(),
  },
}));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));
vi.mock('../src/services/ChatHeadV1Service.js', () => ({ default: ch }));
vi.mock('../src/services/WhatsAppDeliverySync.js', () => deliv);

import chatheadRouter from '../src/routes/chatheadV1.js';

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
  app.use('/', chatheadRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  outbound.mockReset();
  outbound.mockRejectedValue(new Error('external fetch blocked in tests'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

interface Body { success?: boolean; error?: string; data?: Record<string, unknown> & { content?: string }; emojiRemoved?: boolean; msg?: string; [k: string]: unknown }
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
const sentBody = (i = 0): Record<string, unknown> => JSON.parse(String(outbound.mock.calls[i][1]?.body)) as Record<string, unknown>;

describe('lookups', () => {
  it('channels passthrough', async () => {
    outbound.mockResolvedValue(Response.json({ data: [{ id: 40 }] }));
    expect((await call('/channels')).body).toEqual({ success: true, data: [{ id: 40 }] });
  });
  it('channels upstream failure → 500', async () => {
    expect((await call('/channels')).status).toBe(500);
  });
  it('templates requires channel', async () => {
    expect((await call('/templates')).status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });
  it('templates URL-encodes the channel (no param smuggling)', async () => {
    outbound.mockResolvedValue(Response.json({}));
    const r = await call(`/templates?channel=${encodeURIComponent('40&c=other')}`);
    expect(r.body.data).toEqual([]);
    expect(outbound.mock.calls[0][0]).toContain('channel=40%26c%3Dother');
  });
  it('preview surfaces a ChatHead JSON error', async () => {
    outbound.mockResolvedValue(new Response('{"status":"error","msg":"Login required"}'));
    const r = await call('/templates/7/preview');
    expect(r.body).toEqual({ success: false, error: 'Login required', data: { content: '', bytes: 0 } });
  });
  it('preview returns HTML content', async () => {
    outbound.mockResolvedValue(new Response('<p>Hi</p>'));
    expect((await call('/templates/7/preview')).body.data).toEqual({ content: '<p>Hi</p>', bytes: 9 });
  });
});

describe('POST /broadcasts', () => {
  const ok = { channelId: '40', templateId: '9', name: 'b1' };
  it('empty body → 400', async () => {
    expect((await call('/broadcasts', 'POST')).status).toBe(400);
  });
  for (const missing of ['channelId', 'templateId', 'name'] as const) {
    it(`missing ${missing} → 400`, async () => {
      const b: Record<string, unknown> = { ...ok, contacts: [{ phone: '1' }] };
      delete b[missing];
      expect((await call('/broadcasts', 'POST', b)).status).toBe(400);
    });
  }
  it('no contacts and no dataFileId → 400', async () => {
    expect((await call('/broadcasts', 'POST', { ...ok, contacts: [] })).status).toBe(400);
    expect(ch.sendBroadcast).not.toHaveBeenCalled();
  });
  it('dataFileId not found → 404', async () => {
    expect((await call('/broadcasts', 'POST', { ...ok, dataFileId: 5 })).status).toBe(404);
  });
  it('dataFileId without chathead_filename → 400', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, filename: 'a.data', chathead_filename: null }] });
    expect((await call('/broadcasts', 'POST', { ...ok, dataFileId: 5 })).status).toBe(400);
    expect(ch.createBroadcast).not.toHaveBeenCalled();
  });
  it('reuses an existing data file', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, filename: 'a.data', chathead_filename: '123a.data' }] });
    ch.createBroadcast.mockResolvedValue({ status: 'scheduled' });
    const r = await call('/broadcasts', 'POST', { ...ok, dataFileId: "5' OR '1'='1" });
    expect(r.body.success).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual(["5' OR '1'='1"]);
    expect(ch.createBroadcast.mock.calls[0][0]).toMatchObject({ dataFileId: 5, dataFilename: '123a.data', channelId: 40, templateId: 9 });
  });
  it('builds a new file from contacts', async () => {
    ch.sendBroadcast.mockResolvedValue({ success: true });
    const r = await call('/broadcasts', 'POST', { ...ok, contacts: [{ phone: '971' }], sendTime: '2030-01-01T00:00:00Z' });
    expect(r.body.success).toBe(true);
    const arg = ch.sendBroadcast.mock.calls[0][0];
    expect(String(arg.filename)).toMatch(/^wa-\d+\.data$/);
    expect((arg.sendTime as Date).toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });
  it('service throws → 500', async () => {
    ch.sendBroadcast.mockRejectedValue(new Error('upload failed'));
    expect((await call('/broadcasts', 'POST', { ...ok, contacts: [{ phone: '1' }] })).status).toBe(500);
  });
  // BUG (src/routes/chatheadV1.ts:91): sendTime is never validated; "garbage" becomes an
  // Invalid Date that is passed straight to ChatHeadV1Service. Expected: 400.
  it.fails('rejects an unparseable sendTime', async () => {
    ch.sendBroadcast.mockResolvedValue({ success: true });
    const r = await call('/broadcasts', 'POST', { ...ok, contacts: [{ phone: '1' }], sendTime: 'garbage' });
    expect(r.status).toBe(400);
  });
});

describe('data files', () => {
  it('register validates filename / chatheadFilename / contacts', async () => {
    expect((await call('/data-files/register', 'POST')).status).toBe(400);
    expect((await call('/data-files/register', 'POST', { filename: 'x.csv' })).status).toBe(400);
    expect((await call('/data-files/register', 'POST', { filename: 'x.data' })).status).toBe(400);
    expect((await call('/data-files/register', 'POST', { filename: 'x.data', chatheadFilename: '1x.data', contacts: [] })).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it('register upserts with bound params', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });
    const r = await call('/data-files/register', 'POST', { filename: "x'.data", chatheadFilename: '1x.data', contacts: [{ p: 1 }, { p: 2 }] });
    expect(r.body.data).toEqual({ id: 1 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("x'.data");
    expect(params?.slice(0, 3)).toEqual(["x'.data", '1x.data', 2]);
  });
  it('register DB error → 500', async () => {
    mockQuery.mockRejectedValue(new Error('db'));
    expect((await call('/data-files/register', 'POST', { filename: 'a.data', chatheadFilename: 'b', contacts: [1] })).status).toBe(500);
  });
  it('legacy upload builds + uploads', async () => {
    ch.buildAndSaveDataFile.mockResolvedValue({ id: 3, filename: 'f.data' });
    ch.uploadDataFile.mockResolvedValue({ ok: false });
    const r = await call('/data-files', 'POST', { contacts: [1, 2] });
    expect(r.body.success).toBe(false);
    expect(r.body.data).toMatchObject({ id: 3, contactCount: 2 });
    expect((await call('/data-files', 'POST', {})).status).toBe(400);
  });
  it('list endpoints cap limit at 200 and default to 50', async () => {
    await call('/broadcasts?limit=9999');
    expect(mockQuery.mock.calls[0][1]).toEqual([200]);
    await call('/data-files?limit=abc');
    expect(mockQuery.mock.calls[1][1]).toEqual([50]);
  });
  // BUG (src/routes/chatheadV1.ts:212 and :236): a negative ?limit is truthy, so
  // Math.min(200, -5) = -5 reaches Postgres as LIMIT -5 (an error → 500). Expected clamp to >= 1.
  it.fails('list endpoints clamp a negative limit', async () => {
    await call('/broadcasts?limit=-5');
    expect(Number(mockQuery.mock.calls[0][1]?.[0])).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /test-send', () => {
  it('validates phone/channel/template', async () => {
    expect((await call('/test-send', 'POST')).status).toBe(400);
    expect((await call('/test-send', 'POST', { phone: '123' })).status).toBe(400);
    expect((await call('/test-send', 'POST', { phone: '971501234567' })).status).toBe(400);
    expect((await call('/test-send', 'POST', { phone: '971501234567', channelId: '1' })).status).toBe(400);
    expect(ch.sendBroadcast).not.toHaveBeenCalled();
  });
  it('sends, resolves identity and logs sent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 11 }] });
    ch.sendBroadcast.mockResolvedValue({ success: true, broadcast: { id: 4, chatheadBroadcastId: 99 } });
    const r = await call('/test-send', 'POST', { phone: '+971-50-123-4567', channelId: '40', templateId: '9' });
    expect(r.body.success).toBe(true);
    expect(r.body.data).toMatchObject({ phone: '971501234567', unifiedId: 11 });
    const log = mockQuery.mock.calls[1][1] ?? [];
    expect(log.slice(6, 9)).toEqual([4, '99', 'sent']);
  });
  it('service throwing is logged as failed and still 200', async () => {
    ch.sendBroadcast.mockRejectedValue(new Error('chathead down'));
    const r = await call('/test-send', 'POST', { phone: '971501234567', channelId: '40', templateId: '9' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(false);
    const log = mockQuery.mock.calls[1][1] ?? [];
    expect(log[8]).toBe('failed');
    expect(log[9]).toBe('chathead down');
  });
  it('identity + log DB failures never fail the send', async () => {
    mockQuery.mockRejectedValue(new Error('db'));
    ch.sendBroadcast.mockResolvedValue({ success: true });
    const r = await call('/test-send', 'POST', { phone: '971501234567', channelId: '40', templateId: '9' });
    expect(r.body.success).toBe(true);
  });
});

describe('delivery sync', () => {
  it('sync one / all', async () => {
    deliv.syncBroadcast.mockResolvedValue({ n: 1 });
    deliv.syncPending.mockResolvedValue({ n: 2 });
    expect((await call('/broadcasts/7/sync-delivery', 'POST')).body.data).toEqual({ n: 1 });
    expect(deliv.syncBroadcast).toHaveBeenCalledWith('7');
    expect((await call('/broadcasts/sync-delivery', 'POST')).body.data).toEqual({ n: 2 });
  });
  it('sync throws → 500', async () => {
    deliv.syncPending.mockRejectedValue(new Error('x'));
    expect((await call('/broadcasts/sync-delivery', 'POST')).status).toBe(500);
  });
});

describe('POST /templates/create', () => {
  const base_ = { channel: '40', name: 'promo_1', category: 'marketing', formate: 'text', body: 'Hello {{1}}' };
  it('validation errors', async () => {
    expect((await call('/templates/create', 'POST')).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, name: 'Bad Name' })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, name: "x'; drop" })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, category: 'spam' })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, formate: 'gif' })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, body: '   ' })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, formate: 'media_image' })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, buttons: [{ type: 'bogus' }] })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, buttons: [{ type: 'quick_reply' }] })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, buttons: [{ type: 'url_dynamic', sub_type: 'url', value: 'https://x/', text: 'Go' }] })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, buttons: [{ type: 'url_dynamic', sub_type: 'url', value: 'https://x/{{1}}', text: 'Go' }] })).status).toBe(400);
    expect((await call('/templates/create', 'POST', { ...base_, buttons: [{ type: 'OTP', otp_type: 'ONE_TAP' }] })).status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });
  it('strips emoji, trims buttons, and parses JSON behind PHP noise', async () => {
    outbound.mockResolvedValue(new Response('Deprecated: foo() in x.php\n{"status":"success","data":{"template_id":1},"msg":"ok"}'));
    const r = await call('/templates/create', 'POST', {
      ...base_, body: 'Hi 🎉  there', buttons: [{ type: 'call_to_action', sub_type: 'url', value: ' https://r.co ', text: ' Book 🚀 ' }],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, data: { template_id: 1 }, emojiRemoved: true });
    const sent = sentBody();
    expect(sent.body).toBe('Hi there');
    expect(sent.buttons).toEqual([{ type: 'call_to_action', sub_type: 'url', value: 'https://r.co', text: 'Book' }]);
    expect(sent.channel).toBe(40);
    expect(outbound.mock.calls[0][0]).toMatch(/\/index\.php\?c=rayna$/);
  });
  it('authentication templates default to an OTP COPY_CODE button', async () => {
    outbound.mockResolvedValue(new Response('{"status":"success"}'));
    await call('/templates/create', 'POST', { channel: '40', name: 'otp', category: 'authentication' });
    expect(sentBody().buttons).toEqual([{ type: 'OTP', otp_type: 'COPY_CODE' }]);
  });
  it('non-JSON / empty upstream → 400 with message', async () => {
    outbound.mockResolvedValue(new Response(''));
    expect((await call('/templates/create', 'POST', base_)).body.error).toBe('empty response from ChatHead');
    outbound.mockResolvedValue(new Response('<html>500</html>'));
    const r = await call('/templates/create', 'POST', base_);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/non-JSON/);
  });
  it('upstream network error → 500', async () => {
    expect((await call('/templates/create', 'POST', base_)).status).toBe(500);
  });
});

describe('POST /templates/status', () => {
  it('requires template_id', async () => {
    expect((await call('/templates/status', 'POST')).status).toBe(400);
    expect((await call('/templates/status', 'POST', {})).status).toBe(400);
  });
  it('success / not found', async () => {
    outbound.mockResolvedValueOnce(new Response('{"status":"success","data":{"meta_status":"APPROVED"}}'));
    expect((await call('/templates/status', 'POST', { template_id: 3 })).body.data).toEqual({ meta_status: 'APPROVED' });
    outbound.mockResolvedValueOnce(new Response('{"status":"error","msg":"nope"}'));
    const r = await call('/templates/status', 'POST', { template_id: 3 });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('nope');
  });
});
