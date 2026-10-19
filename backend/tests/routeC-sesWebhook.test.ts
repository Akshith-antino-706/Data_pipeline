// SES/SNS webhook route tests. DB is fully mocked; outbound fetch (AWS) is intercepted.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[]; rowCount?: number }
const { mockQuery, outbound } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
  outbound: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery }, query: mockQuery }));

import sesRouter from '../src/routes/sesWebhook.js';

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
  // Mirrors server.ts: SNS posts text/plain.
  app.use(express.text({ type: 'text/plain' }));
  app.use(express.json());
  app.use('/', sesRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  outbound.mockReset();
  outbound.mockRejectedValue(new Error('external fetch blocked in tests'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

async function post(body: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const r = await fetch(`${base}/ses`, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body });
  return { status: r.status, text: await r.text() };
}
const notification = (message: unknown): string =>
  JSON.stringify({ Type: 'Notification', Message: JSON.stringify(message) });
const sqlCalls = (): string[] => mockQuery.mock.calls.map(c => c[0]);
const tick = (ms = 30): Promise<void> => new Promise(r => setTimeout(r, ms));

describe('SES webhook — payload shape', () => {
  it('rejects invalid outer JSON with 400', async () => {
    const r = await post('{not json');
    expect(r.status).toBe(400);
    expect(r.text).toBe('Invalid JSON');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects invalid inner Message JSON with 400', async () => {
    const r = await post(JSON.stringify({ Type: 'Notification', Message: '{oops' }));
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('acks an empty body (no type) with 200 and does nothing', async () => {
    const r = await post('');
    expect([200, 400]).toContain(r.status);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('acks an unknown message type with 200', async () => {
    const r = await post(JSON.stringify({ Type: 'UnsubscribeConfirmation' }));
    expect(r.status).toBe(200);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('acks a notification with no eventType and writes nothing', async () => {
    const r = await post(notification({ mail: { messageId: 'm1' } }));
    expect(r.status).toBe(200);
    await tick();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('accepts application/json bodies too (already-parsed object)', async () => {
    const r = await fetch(`${base}/ses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Type: 'Notification', Message: { eventType: 'Send', mail: { messageId: 'j1', destination: ['a@b.co'] } } }),
    });
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
    expect(sqlCalls()[0]).toMatch(/INSERT INTO ses_events/);
  });
});

describe('SES webhook — SNS subscription confirmation', () => {
  it('confirms via a genuine AWS SNS https URL (fetch mocked)', async () => {
    outbound.mockResolvedValueOnce(new Response('ok'));
    const url = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc';
    const r = await post(JSON.stringify({ Type: 'SubscriptionConfirmation', SubscribeURL: url }));
    expect(r.status).toBe(200);
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(outbound.mock.calls[0][0]).toBe(url);
  });

  it('uses the x-amz-sns-message-type header when Type is absent', async () => {
    outbound.mockResolvedValueOnce(new Response('ok'));
    const r = await post(JSON.stringify({ SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/x' }),
      { 'x-amz-sns-message-type': 'SubscriptionConfirmation' });
    expect(r.status).toBe(200);
    expect(outbound).toHaveBeenCalledTimes(1);
  });

  for (const evil of [
    'http://sns.us-east-1.amazonaws.com/x',
    'https://sns.us-east-1.amazonaws.com.evil.com/x',
    'https://evil.com/?sns.us-east-1.amazonaws.com',
    'https://169.254.169.254/latest/meta-data',
    'javascript:alert(1)',
    'not a url',
  ]) {
    it(`refuses to fetch a non-SNS SubscribeURL: ${evil}`, async () => {
      const r = await post(JSON.stringify({ Type: 'SubscriptionConfirmation', SubscribeURL: evil }));
      expect(r.status).toBe(200);
      expect(outbound).not.toHaveBeenCalled();
    });
  }

  it('returns 200 when SubscribeURL is missing', async () => {
    const r = await post(JSON.stringify({ Type: 'SubscriptionConfirmation' }));
    expect(r.status).toBe(200);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('returns 500 (not crash) when the AWS confirm call fails', async () => {
    outbound.mockRejectedValueOnce(new Error('network'));
    const r = await post(JSON.stringify({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.us-east-1.amazonaws.com/x' }));
    expect(r.status).toBe(500);
  });
});

describe('SES webhook — bounce / complaint / unsubscribe handling', () => {
  it('permanent bounce: stores event, marks log bounced, unsubscribes and audits', async () => {
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(/UPDATE unified_contacts/.test(sql) ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 0 }));
    const r = await post(notification({
      eventType: 'Bounce', mail: { messageId: 'msg-1' },
      bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: '  USER@Example.COM ' }] },
    }));
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(4));
    const [ins, upd, unsub, audit] = mockQuery.mock.calls;
    expect(ins[0]).toMatch(/INSERT INTO ses_events/);
    expect(ins[1]?.[0]).toBe('Bounce');
    expect(ins[1]?.[3]).toBe('Permanent');
    expect(typeof ins[1]?.[5]).toBe('string'); // raw payload kept for bounces
    expect(upd[0]).toMatch(/UPDATE email_send_log/);
    expect(upd[1]).toEqual(['bounced', 'msg-1']);
    expect(unsub[0]).toMatch(/UPDATE unified_contacts/);
    expect(unsub[1]).toEqual(['user@example.com']);
    expect(audit[0]).toMatch(/INSERT INTO unsubscribe_log/);
    expect(audit[1]).toEqual(['user@example.com', 'msg-1', 'bounce']);
  });

  it('transient bounce does not unsubscribe', async () => {
    await post(notification({
      eventType: 'Bounce', mail: { messageId: 'msg-2' },
      bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'a@b.co' }] },
    }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));
    await tick();
    expect(sqlCalls().some(s => /unified_contacts/.test(s))).toBe(false);
  });

  it('complaint (legacy notificationType) unsubscribes', async () => {
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(/UPDATE unified_contacts/.test(sql) ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 0 }));
    await post(notification({
      notificationType: 'Complaint', mail: { messageId: 'msg-3' },
      complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'c@d.co' }] },
    }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(4));
    expect(mockQuery.mock.calls[0][1]?.[4]).toBe('abuse');
    expect(mockQuery.mock.calls[1][1]).toEqual(['complained', 'msg-3']);
    expect(mockQuery.mock.calls[3][1]).toEqual(['c@d.co', 'msg-3', 'complaint']);
  });

  it('duplicate complaint for an already-unsubscribed contact skips the audit insert', async () => {
    const msg = notification({
      eventType: 'Complaint', mail: { messageId: 'dup' },
      complaint: { complainedRecipients: [{ emailAddress: 'x@y.co' }] },
    });
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(/UPDATE unified_contacts/.test(sql) ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 0 }));
    await post(msg);
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(4));
    mockQuery.mockClear();
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));
    await post(msg);
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(3));
    await tick();
    expect(sqlCalls().some(s => /unsubscribe_log/.test(s))).toBe(false);
  });

  it('bounce with no recipients and no messageId only stores the event', async () => {
    await post(notification({ eventType: 'Bounce', bounce: { bounceType: 'Permanent' } }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
    await tick();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]?.[1]).toBeNull();
  });

  it('Open is not stored in ses_events but updates the log with UA/IP params', async () => {
    await post(notification({
      eventType: 'Open', mail: { messageId: 'o1', destination: ['a@b.co'] },
      open: { userAgent: "Mozilla'; DROP TABLE x;--", ipAddress: '1.2.3.4' },
    }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE email_send_log/);
    expect(sql).toMatch(/open_ua/);
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toEqual(['opened', 'o1', "Mozilla'; DROP TABLE x;--", '1.2.3.4']);
  });

  it('Click sets clicked status with click_ua column', async () => {
    await post(notification({ eventType: 'Click', mail: { messageId: 'k1' }, click: {} }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1));
    expect(mockQuery.mock.calls[0][0]).toMatch(/click_ua/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['clicked', 'k1', null, null]);
  });

  it('Delivery stores without raw payload and marks delivered', async () => {
    await post(notification({ eventType: 'Delivery', mail: { messageId: 'd1' }, delivery: { recipients: ['A@B.CO'] } }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));
    expect(mockQuery.mock.calls[0][1]).toEqual(['Delivery', 'a@b.co', 'd1', null, null, null]);
    expect(mockQuery.mock.calls[1][1]).toEqual(['delivered', 'd1']);
  });

  it('injection strings in the email are only ever bound as parameters', async () => {
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(/UPDATE unified_contacts/.test(sql) ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 0 }));
    const evil = "x'); DELETE FROM unified_contacts;--@e.co";
    await post(notification({ eventType: 'Complaint', mail: { messageId: 'i1' }, complaint: { complainedRecipients: [{ emailAddress: evil }] } }));
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(4));
    for (const s of sqlCalls()) expect(s).not.toContain('DELETE FROM');
  });

  it('DB failure during async processing still acks 200', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const r = await post(notification({ eventType: 'Send', mail: { messageId: 's1', destination: ['a@b.co'] } }));
    expect(r.status).toBe(200);
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
  });

  // BUG (src/routes/sesWebhook.ts:28-57): SNS message signatures (Signature/SigningCertURL) are
  // never verified, so anyone who can reach the endpoint can forge a Complaint and unsubscribe
  // any address. This test describes the expected (secure) behaviour and currently fails.
  it.fails('rejects a forged, unsigned Complaint notification', async () => {
    mockQuery.mockImplementation((sql: string) =>
      Promise.resolve(/UPDATE unified_contacts/.test(sql) ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 0 }));
    await post(notification({ eventType: 'Complaint', mail: { messageId: 'f1' }, complaint: { complainedRecipients: [{ emailAddress: 'victim@e.co' }] } }));
    await tick(80);
    expect(sqlCalls().some(s => /UPDATE unified_contacts/.test(s))).toBe(false);
  });
});
