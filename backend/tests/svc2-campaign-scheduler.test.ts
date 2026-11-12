import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  release: vi.fn(),
  render: vi.fn<(t: unknown, c: unknown) => { body: string; subject: string }>(),
  baseRender: vi.fn<(name: string, vars: Record<string, unknown>) => string>(),
  getForSegment: vi.fn<(s: string, n: number) => Promise<Array<Record<string, unknown>>>>(),
  segProducts: vi.fn<(s: string) => Array<{ product_url: string }>>(),
  emailSend: vi.fn<(a: { to: string; subject: string; html: string }) => Promise<{ success: boolean; externalId?: string; error?: string }>>(),
}));

vi.mock('../src/config/database.js', () => {
  const client = { query: m.clientQuery, release: m.release };
  const transaction = async <T>(fn: (c: typeof client) => Promise<T>): Promise<T> => {
    await client.query('BEGIN');
    try { const r = await fn(client); await client.query('COMMIT'); return r; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  };
  return { default: { query: m.query }, query: m.query, transaction };
});
vi.mock('../src/services/ContentService.js', () => ({ ContentService: { renderTemplate: m.render } }));
vi.mock('../src/services/BaseTemplateService.js', () => ({ BaseTemplateService: { render: m.baseRender } }));
vi.mock('../src/services/ProductService.js', () => ({ default: { getForSegment: m.getForSegment } }));
vi.mock('../src/templates/segmentProducts.js', () => ({ getSegmentProducts: m.segProducts }));
vi.mock('../src/templates/segmentEmailConfig.js', () => ({ default: { VIP: { subject: 'VIP subj', cta_url: 'https://r.com/vip', coupon_code: 'C1' } } }));
vi.mock('../src/services/channels/EmailChannel.js', () => ({ EmailChannel: { send: m.emailSend } }));
vi.mock('../src/services/AuthService.js', () => ({ default: { signServiceToken: () => 'tok' } }));

import { CampaignService } from '../src/services/CampaignService.js';
import * as Sched from '../src/services/TestSendScheduler.js';

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  for (const f of [m.query, m.clientQuery, m.render, m.baseRender, m.getForSegment, m.segProducts, m.emailSend, m.release]) f.mockReset();
  m.query.mockResolvedValue({ rows: [] });
  m.clientQuery.mockResolvedValue({ rows: [] });
  m.render.mockReturnValue({ body: '<p>Hi</p>', subject: 'S' });
  m.baseRender.mockReturnValue('<html>wrapped</html>');
  m.segProducts.mockReturnValue([{ product_url: 'https://r.com/p' }]);
  m.getForSegment.mockResolvedValue([]);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('CampaignService', () => {
  it('getAll builds filters/pagination and parses total', async () => {
    m.query.mockImplementation(async (sql) => sql.startsWith('SELECT COUNT') ? { rows: [{ total: '12' }] } : { rows: [{ id: 1 }] });
    const r = await CampaignService.getAll({ status: 'running', channel: 'email', page: 2, limit: 5 });
    expect(r).toEqual({ data: [{ id: 1 }], total: 12, page: 2, limit: 5 });
    const data = m.query.mock.calls.find(([s]) => s.includes('LIMIT'));
    expect(data?.[0]).toContain('LIMIT $3 OFFSET $4');
    expect(data?.[1]).toEqual(['running', 'email', 5, 5]);
    expect(data?.[0]).toContain('CASE WHEN c.sent_count > 0');
    m.query.mockClear();
    await CampaignService.getAll({ search: ' 50%_x ', limit: 10 });
    const searched = m.query.mock.calls.find(([s]) => s.includes('LIMIT'));
    expect(searched?.[0]).toContain('c.name ILIKE $1 OR c.segment_label ILIKE $1');
    expect(searched?.[1]).toEqual(['%50\\%\\_x%', 10, 0]);
  });
  it('getById null when missing; otherwise merges analytics', async () => {
    expect(await CampaignService.getById(1)).toBeNull();
    m.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [{ hour_bucket: 'h' }] }).mockResolvedValueOnce({ rows: [{ status: 'sent', count: '2' }] });
    expect(await CampaignService.getById(1)).toMatchObject({ id: 1, analytics: [{ hour_bucket: 'h' }], statusBreakdown: [{ status: 'sent' }] });
  });
  it('create counts per-channel opt-in audience and sets draft vs scheduled', async () => {
    m.query.mockImplementation(async (sql) => sql.includes('COUNT(*) AS count') ? { rows: [{ count: '8' }] } : { rows: [{ id: 3 }] });
    await CampaignService.create({ name: 'n', segmentLabel: 'VIP', channel: 'whatsapp' });
    expect(m.query.mock.calls[0][0]).toContain('can_whatsapp = TRUE');
    const ins = m.query.mock.calls[1][1] ?? [];
    expect(ins[5]).toBe('draft');
    expect(ins[6]).toBe(8);
    expect(ins[7]).toBe('{}');
    m.query.mockClear();
    await CampaignService.create({ name: 'n', segmentLabel: 'VIP', channel: 'sms', scheduledAt: '2026-01-01' });
    expect(m.query.mock.calls[1][1]?.[5]).toBe('scheduled');
  });
  it('execute: missing campaign rolls back', async () => {
    await expect(CampaignService.execute(1)).rejects.toThrow('Campaign not found');
    expect(m.clientQuery.mock.calls.map(([s]) => s)).toContain('ROLLBACK');
    expect(m.release).toHaveBeenCalled();
  });
  it('execute: refuses running/completed campaigns', async () => {
    m.clientQuery.mockImplementation(async (sql) => sql.includes('FROM campaigns') ? { rows: [{ id: 1, status: 'running' }] } : { rows: [] });
    await expect(CampaignService.execute(1)).rejects.toThrow(/running status/);
  });
  it('execute: queues one message per opted-in customer, wraps email with UTM and sets target_count', async () => {
    m.clientQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM campaigns')) return { rows: [{ id: 1, name: 'Big Sale!', status: 'draft', channel: 'email', segment_label: 'VIP', template_id: 4 }] };
      if (sql.includes('FROM content_templates')) return { rows: [{ id: 4, body: 'b', subject: 's' }] };
      if (sql.includes('FROM customer_segments')) return { rows: [{ email: 'a@x', full_name: 'Ann Lee' }, { email: 'b@x', full_name: null }] };
      return { rows: [] };
    });
    const r = await CampaignService.execute(1);
    expect(r).toEqual({ campaignId: 1, queued: 2 });
    const cq = m.clientQuery.mock.calls.find(([s]) => s.includes('FROM customer_segments'));
    expect(cq?.[0]).toContain('can_email = TRUE');
    const inserts = m.clientQuery.mock.calls.filter(([s]) => s.includes('INSERT INTO message_log'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual([1, 'a@x', 'email', 4, '<html>wrapped</html>', 'VIP subj']);
    const vars = m.baseRender.mock.calls[0][1];
    expect(vars.customer_name).toBe('Ann');
    expect(m.baseRender.mock.calls[1][1].customer_name).toBe('Traveler');
    expect(vars.cta_url).toBe('https://r.com/vip?utm_source=rayna_platform&utm_medium=email&utm_campaign=vip&utm_content=big_sale');
    expect(vars.coupon_code).toBe('C1');
    const upd = m.clientQuery.mock.calls.find(([s]) => s.includes("status = 'running'"));
    expect(upd?.[1]).toEqual([1, 2]);
    expect(m.clientQuery.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('processQueue counts sent/failed and refreshes aggregates', async () => {
    m.query.mockImplementation(async (sql) => sql.includes("WHERE ml.status = 'queued'")
      ? { rows: [
        { id: 1, channel: 'email', customer_email: 'a@x', rendered_body: '<body></body>', rendered_subject: null },
        { id: 2, channel: 'email', customer_email: 'b@x', rendered_body: 'x', rendered_subject: 's' },
        { id: 3, channel: 'sms', customer_email: 'c@x', rendered_body: 'x', rendered_subject: 's' },
      ] }
      : { rows: [] });
    m.emailSend.mockResolvedValueOnce({ success: true, externalId: 'e1' }).mockResolvedValueOnce({ success: false, error: 'bounce' });
    expect(await CampaignService.processQueue(10)).toEqual({ sent: 2, failed: 1 });
    expect(m.emailSend.mock.calls[0][0].subject).toBe('Rayna Tours');
    expect(m.emailSend.mock.calls[0][0].html).toContain('/api/track/open/1');
    const failed = m.query.mock.calls.find(([s]) => s.includes("status = 'failed'"));
    expect(failed?.[1]).toEqual([2, 'bounce']);
    expect(m.query.mock.calls.at(-1)?.[0]).toContain("WHEN sub.queued = 0 AND c.status = 'running' THEN 'completed'");
  });
  // BUG: the aggregate sets sent_count = COUNT(status='sent') only. Once a message moves on to
  // delivered/read/clicked its status is no longer 'sent', so sent_count goes DOWN as engagement
  // goes up (and delivery_rate = delivered/sent can exceed 100%). CampaignService.ts:280,297.
  it('campaign sent_count includes messages that progressed past sent', async () => {
    await CampaignService.processQueue(1);
    const agg = m.query.mock.calls.at(-1)?.[0] ?? '';
    expect(agg).toMatch(/FILTER \(WHERE status IN \('sent',\s*'delivered',\s*'read',\s*'clicked'/);
  });
  it('performance summary guards divide-by-zero', async () => {
    await CampaignService.getPerformanceSummary();
    expect(m.query.mock.calls[0][0]).toContain('CASE WHEN SUM(sent_count) > 0');
  });
});

describe('TestSendScheduler', () => {
  const row = (o: Record<string, unknown>) => ({ id: 1, is_running: true, next_day_to_send: 1, emails: ['a@x'], loop: false, destination_key: null, ...o });
  it('tick skip reasons', async () => {
    expect(await Sched.tick(1)).toMatchObject({ skipped: true, reason: 'No schedule row' });
    m.query.mockResolvedValueOnce({ rows: [row({ is_running: false })] });
    expect((await Sched.tick(1)).reason).toBe('Not running');
    m.query.mockResolvedValueOnce({ rows: [row({ next_day_to_send: 8 })] });
    expect((await Sched.tick(1)).reason).toMatch(/Invalid/);
    m.query.mockResolvedValueOnce({ rows: [row({ emails: [] })] });
    expect((await Sched.tick(1)).reason).toBe('No recipient emails');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('tick day 6 sends destinationKey and advances', async () => {
    m.query.mockResolvedValueOnce({ rows: [row({ next_day_to_send: 6 })] });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { results: [{ success: true }, { success: false }] } }), { status: 200 }));
    const r = await Sched.tick(1, { baseUrl: 'http://h' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://h/api/v3/test-sends/day6');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ destinationKey: 'singapore', source: 'schedule-1' });
    expect(r).toMatchObject({ day: 6, label: 'Destination Spotlight', sentTo: 1, failed: 1, sequenceDone: false });
    expect(m.query.mock.calls[1][1]).toEqual([1, 6, 7, true]);
  });
  it('day 7 wraps to 1 and stops without loop; keeps running with loop', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { async: true, recipients: 50, jobId: 'j' } }), { status: 200 }));
    m.query.mockResolvedValueOnce({ rows: [row({ next_day_to_send: 7 })] });
    const r = await Sched.tick(1);
    expect(r).toMatchObject({ sequenceDone: true, sentTo: 50, failed: 0, async: true, jobId: 'j' });
    expect(m.query.mock.calls[1][1]).toEqual([1, 7, 1, false]);
    m.query.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    m.query.mockResolvedValueOnce({ rows: [row({ next_day_to_send: 7, loop: true })] });
    expect((await Sched.tick(1)).sequenceDone).toBe(false);
  });
  it('tick throws on HTTP error and does not advance', async () => {
    m.query.mockResolvedValueOnce({ rows: [row({})] });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 500 }));
    await expect(Sched.tick(1)).rejects.toThrow('Day-1 send failed: HTTP 500 nope');
    expect(m.query).toHaveBeenCalledTimes(1);
  });
  it('start requires emails', async () => {
    await expect(Sched.start({ emails: [] })).rejects.toThrow(/at least one/);
    expect(m.query).not.toHaveBeenCalled();
  });
  it('start → prewarm → timer ticks; stop clears timer (fake timers)', async () => {
    vi.useFakeTimers();
    m.query.mockImplementation(async (sql) => {
      if (sql.includes('INSERT INTO test_segment_schedule')) return { rows: [row({ id: 5 })] };
      if (sql.startsWith('SELECT * FROM test_segment_schedule WHERE id')) return { rows: [row({ id: 5, is_running: false })] };
      return { rows: [row({ id: 5, is_running: false })] };
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { ready: 7, summary: ['s'] } }), { status: 200 }));
    const r = await Sched.start({ emails: ['a@x'], baseUrl: 'http://h' });
    expect(r.id).toBe(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(Sched.getPrewarmState(5)).toMatchObject({ status: 'ready', readyCount: 7 });
    await vi.advanceTimersByTimeAsync(600);
    // auto tick sees not running -> clears interval; no more sends
    const fetches = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 * 2);
    expect(fetchMock.mock.calls.length).toBe(fetches);
    const s = await Sched.stop(5);
    expect(s.prewarm.status).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('prewarm failure is recorded', async () => {
    vi.useFakeTimers();
    m.query.mockImplementation(async (sql) => sql.includes('INSERT') ? { rows: [row({ id: 6 })] } : { rows: [] });
    fetchMock.mockRejectedValue(new Error('refused'));
    await Sched.start({ emails: ['a@x'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(Sched.getPrewarmState(6)).toMatchObject({ status: 'failed', error: 'refused' });
    await Sched.stop(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('removeEmail stops schedule when last recipient removed; throws if missing', async () => {
    await expect(Sched.removeEmail(1, 'a@x')).rejects.toThrow('Schedule not found');
    m.query.mockResolvedValueOnce({ rows: [row({ emails: [] })] });
    const r = await Sched.removeEmail(1, '  A@X ');
    expect(m.query.mock.calls[1][1]).toEqual([1, 'a@x']);
    expect(r).toMatchObject({ is_running: false, emails: [] });
    expect(m.query.mock.calls.some(([s]) => s.includes('is_running = FALSE'))).toBe(true);
  });
  it('listSchedules attaches idle prewarm', async () => {
    m.query.mockResolvedValueOnce({ rows: [row({ id: 99 })] });
    expect((await Sched.listSchedules())[0].prewarm.status).toBe('idle');
  });
});
