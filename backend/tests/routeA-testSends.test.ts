import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

const m = vi.hoisted(() => ({
  query: vi.fn(),
  st: { getLog: vi.fn(), getSummary: vi.fn(), getByUnifiedId: vi.fn(), getUtmLog: vi.fn(), getUtmSummary: vi.fn(), create: vi.fn() },
  sched: { listSchedules: vi.fn(), start: vi.fn(), stop: vi.fn(), tick: vi.fn(), removeEmail: vi.fn() },
  analyzeEmail: vi.fn(),
  checkInboxPlacement: vi.fn(),
  emailSend: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn((_k: string, fn: () => unknown) => fn()), del: vi.fn(), default: {} }));
vi.mock('../src/services/SendTrackService.js', () => ({ SendTrackService: m.st }));
vi.mock('../src/utils/emailTracking.js', () => ({ injectClickTracking: vi.fn((h: string) => h), injectOpenPixel: vi.fn((h: string) => h) }));
vi.mock('../src/utils/emailFrequencyCap.js', () => ({ reserveSend: vi.fn(() => Promise.resolve(true)), releaseSend: vi.fn() }));
vi.mock('../src/services/affinityVars.js', () => ({ SAMPLE_AFFINITY_VARS: {} }));
vi.mock('../src/services/TestSendScheduler.js', () => m.sched);
vi.mock('../src/services/EmailQAService.js', () => ({ analyzeEmail: m.analyzeEmail, checkInboxPlacement: m.checkInboxPlacement }));
vi.mock('../src/services/channels/EmailChannel.js', () => ({ EmailChannel: { send: m.emailSend } }));
vi.mock('../src/services/channels/ChatheadEmailChannel.js', () => ({ ChatheadEmailChannel: { send: m.emailSend } }));

import testSendsRouter from '../src/routes/testSends.js';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/', testSendsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ error: err.message }); });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

interface Body { success?: boolean; data?: unknown; error?: string }
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as Body };
}
beforeEach(() => {
  m.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  for (const f of [...Object.values(m.st), ...Object.values(m.sched), m.analyzeEmail, m.checkInboxPlacement, m.emailSend]) f.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /contacts/filter-options', () => {
  it('maps rows into the option lists', async () => {
    m.query.mockResolvedValue({ rows: [{ val: 'A', id: 1, name: 'n' }] });
    const r = await call('GET', '/contacts/filter-options');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(expect.objectContaining({ booking_status: ['A'], segments: [{ val: 'A', id: 1, name: 'n' }] }));
    expect(m.query).toHaveBeenCalledTimes(7);
  });
  it('500 when any query fails', async () => {
    m.query.mockRejectedValue(new Error('db'));
    expect((await call('GET', '/contacts/filter-options')).status).toBe(500);
  });
});

describe('GET /contacts', () => {
  it('unfiltered uses the planner estimate and default paging', async () => {
    m.query.mockImplementation((sql: string) => Promise.resolve(sql.includes('pg_class') ? { rows: [{ total: 99 }] } : { rows: [{ id: 1 }] }));
    const r = await call('GET', '/contacts');
    expect(r.body.data).toEqual({ contacts: [{ id: 1 }], total: 99, limit: 50, offset: 0 });
  });
  it('clamps limit to 500 and negative offset to 0; binds filters', async () => {
    const evil = "IN'; DROP TABLE unified_contacts;--";
    const r = await call('GET', `/contacts?limit=10000&offset=-5&country=${encodeURIComponent(evil)}&is_indian=true`);
    const d = r.body.data as { limit: number; offset: number };
    expect(d.limit).toBe(500);
    expect(d.offset).toBe(0);
    expect(m.query).toHaveBeenCalledWith(expect.not.stringContaining(evil), [evil, true, 500, 0]);
  });
  it('a 1-char q is ignored, a longer q becomes a prefix bind', async () => {
    await call('GET', '/contacts?q=a');
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('pg_class'));
    m.query.mockClear();
    await call('GET', '/contacts?q=Bob');
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('LIKE $1'), ['bob%', 50, 0]);
  });
  it('a failing count returns total=null instead of 500', async () => {
    m.query.mockImplementation((sql: string) => (sql.includes('pg_class') ? Promise.reject(new Error('slow')) : Promise.resolve({ rows: [] })));
    const r = await call('GET', '/contacts');
    expect(r.status).toBe(200);
    expect((r.body.data as { total: unknown }).total).toBeNull();
  });
  // FIXED (was BUG) (src/routes/testSends.ts:246): `parseInt(limit)` for a non-numeric ?limit= is NaN and
  // Math.min(500, NaN) is NaN, so "LIMIT NaN" is sent to Postgres (500) instead of the default 50.
  it('non-numeric limit falls back to 50', async () => {
    const r = await call('GET', '/contacts?limit=abc');
    expect((r.body.data as { limit: number }).limit).toBe(50);
  });
});

describe('GET /search-contacts', () => {
  it('returns [] for short queries without hitting the db', async () => {
    expect((await call('GET', '/search-contacts?q=a')).body).toEqual({ data: [] });
    expect((await call('GET', '/search-contacts')).body).toEqual({ data: [] });
    expect(m.query).not.toHaveBeenCalled();
  });
  it('strips rank and binds prefix/substring', async () => {
    m.query.mockResolvedValue({ rows: [{ id: 1, email: 'x@y', rank: 0 }] });
    const r = await call('GET', `/search-contacts?q=${encodeURIComponent("Ab' OR 1=1")}`);
    expect(r.body).toEqual({ data: [{ id: 1, email: 'x@y' }] });
    expect(m.query).toHaveBeenCalledWith(expect.any(String), ["ab' or 1=1%", "%ab' or 1=1%"]);
  });
});

describe('schedule endpoints', () => {
  it('list / start with defaults', async () => {
    m.sched.listSchedules.mockResolvedValue([1]);
    expect((await call('GET', '/schedule/list')).body).toEqual({ data: [1] });
    m.sched.start.mockResolvedValue({ id: 3 });
    await call('POST', '/schedule/start');
    expect(m.sched.start).toHaveBeenCalledWith(expect.objectContaining({ destinationKey: 'singapore', loop: false, emails: [] }));
  });
  it('loop must be literally true', async () => {
    m.sched.start.mockResolvedValue({});
    await call('POST', '/schedule/start', { loop: 'true' });
    expect(m.sched.start).toHaveBeenCalledWith(expect.objectContaining({ loop: false }));
  });
  it('stop / tick parse id', async () => {
    m.sched.stop.mockResolvedValue('s');
    m.sched.tick.mockResolvedValue('t');
    await call('POST', '/schedule/4/stop');
    await call('POST', '/schedule/5/tick');
    expect(m.sched.stop).toHaveBeenCalledWith(4);
    expect(m.sched.tick).toHaveBeenCalledWith(5);
  });
  it('remove-email requires email', async () => {
    expect((await call('POST', '/schedule/4/remove-email', {})).status).toBe(400);
    m.sched.removeEmail.mockResolvedValue({ ok: true });
    await call('POST', '/schedule/4/remove-email', { email: 'a@b.c' });
    expect(m.sched.removeEmail).toHaveBeenCalledWith(4, 'a@b.c');
  });
  it('queue clamps limit to 200; logs binds schedule source', async () => {
    await call('GET', '/schedule/1/queue?limit=9999');
    expect(m.query).toHaveBeenLastCalledWith(expect.any(String), [200]);
    await call('GET', '/schedule/7/logs');
    expect(m.query).toHaveBeenLastCalledWith(expect.any(String), ['schedule-7']);
  });
  it('scheduler error → 500', async () => {
    m.sched.listSchedules.mockRejectedValue(new Error('x'));
    expect((await call('GET', '/schedule/list')).status).toBe(500);
  });
});

describe('QA endpoints', () => {
  it('qa-report returns null when no report', async () => {
    expect((await call('GET', '/qa-report/3')).body).toEqual({ success: true, data: null });
  });
  it('qa-report merges report + placement', async () => {
    m.query.mockResolvedValue({ rows: [{ report: { score: 9 }, placement: 'inbox', updated_at: 'T' }] });
    expect((await call('GET', '/qa-report/3')).body.data).toEqual({ score: 9, placement: 'inbox', generatedAt: 'T' });
  });
  it('qa-report → 500 JSON on db error', async () => {
    m.query.mockRejectedValue(new Error('db'));
    expect(await call('GET', '/qa-report/3')).toEqual({ status: 500, body: { success: false, error: 'db' } });
  });
  it('check-placement persists only with a templateId', async () => {
    m.checkInboxPlacement.mockResolvedValue({ folder: 'Inbox' });
    let r = await call('POST', '/check-placement', { subject: 'S' });
    expect(r.body).toEqual({ success: true, data: { folder: 'Inbox' } });
    expect(m.query).not.toHaveBeenCalled();
    r = await call('POST', '/check-placement', { subject: 'S', templateId: '8' });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE email_qa_reports'), [8, JSON.stringify({ folder: 'Inbox' })]);
  });
  it('analyze-email requires a numeric templateId', async () => {
    expect((await call('POST', '/analyze-email', {})).status).toBe(400);
    expect((await call('POST', '/analyze-email', { templateId: 'abc' })).status).toBe(400);
  });
});

describe('send endpoints: validation', () => {
  for (const p of ['/send-daily-ai', '/send-template']) {
    it(`${p} 400 without templateId`, async () => {
      expect((await call('POST', p, { emails: ['a@b.c'] })).status).toBe(400);
      expect(m.emailSend).not.toHaveBeenCalled();
    });
    it(`${p} 404 when no email matches a contact`, async () => {
      const r = await call('POST', p, { templateId: 1, emails: ['nobody@x.test'] });
      expect(r.status).toBe(404);
      expect(m.emailSend).not.toHaveBeenCalled();
    });
  }
  it('/send-template 404 for unknown template and 400 for a non-email template', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ unified_id: 1, email: 'a@b.c' }] }).mockResolvedValueOnce({ rows: [] });
    expect((await call('POST', '/send-template', { templateId: 9, emails: ['a@b.c'] })).status).toBe(404);
    m.query.mockResolvedValueOnce({ rows: [{ unified_id: 1, email: 'a@b.c' }] }).mockResolvedValueOnce({ rows: [{ id: 9, channel: 'whatsapp', name: 'W' }] });
    expect((await call('POST', '/send-template', { templateId: 9, emails: ['a@b.c'] })).status).toBe(400);
    expect(m.emailSend).not.toHaveBeenCalled();
  });
  // FIXED (was BUG) (src/routes/testSends.ts:73-76 + 347/385): a missing/empty `emails` array is a client
  // input error but resolveRecipients throws and the route answers 500 instead of 400.
  it('/send-template with no emails is a 400, not 500', async () => {
    expect((await call('POST', '/send-template', { templateId: 1 })).status).toBe(400);
  });
  it('/day1 with an empty body → 400 (missing emails) and sends nothing', async () => {
    const r = await call('POST', '/day1');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('emails[] is required');
    expect(m.emailSend).not.toHaveBeenCalled();
  });
});

describe('batch-status and send-log reads', () => {
  it('unknown job → 404', async () => {
    expect((await call('GET', '/batch-status/nope')).status).toBe(404);
  });
  it('send-log clamps paging and forwards filters', async () => {
    m.st.getLog.mockResolvedValue({ rows: [] });
    await call('GET', '/send-log?page=0&limit=1000&status=sent&email=a');
    expect(m.st.getLog).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 200, status: 'sent', email: 'a' }));
  });
  it('send-log/summary forwards days', async () => {
    m.st.getSummary.mockResolvedValue({});
    await call('GET', '/send-log/summary?days=7');
    expect(m.st.getSummary).toHaveBeenCalledWith({ days: '7' });
  });
  it('send-log/user/:unifiedId rejects non-numeric ids', async () => {
    expect((await call('GET', '/send-log/user/abc')).status).toBe(400);
    expect(m.st.getByUnifiedId).not.toHaveBeenCalled();
  });
  it('send-log/user/:unifiedId returns count', async () => {
    m.st.getByUnifiedId.mockResolvedValue([{}, {}]);
    const r = await call('GET', '/send-log/user/12?limit=0');
    expect(r.body.data).toEqual({ unifiedId: 12, count: 2, rows: [{}, {}] });
    expect(m.st.getByUnifiedId).toHaveBeenCalledWith(12, { limit: 1 });
  });
  it('utm-log maps query names; utm-log/summary; 500 on error', async () => {
    m.st.getUtmLog.mockResolvedValue({});
    await call('GET', '/utm-log?utm_source=fb&email=');
    expect(m.st.getUtmLog).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 50, utmSource: 'fb', email: undefined }));
    m.st.getUtmSummary.mockRejectedValue(new Error('x'));
    expect((await call('GET', '/utm-log/summary')).status).toBe(500);
  });
});
