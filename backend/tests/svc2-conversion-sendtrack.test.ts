import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number | null };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
}));
vi.mock('../src/config/database.js', () => ({
  default: { query: m.query },
  query: m.query,
  transaction: vi.fn(),
}));

import ConversionDetector from '../src/services/ConversionDetector.js';
import { SendTrackService } from '../src/services/SendTrackService.js';

const sqls = () => m.query.mock.calls.map(([s]) => s);
const callFor = (frag: string) => m.query.mock.calls.find(([s]) => s.includes(frag));

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('ConversionDetector', () => {
  it('checkGTMEvents sums gtm + ga4 and survives missing tables', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 3 }).mockRejectedValueOnce(new Error('no ga4_events'));
    expect(await ConversionDetector.checkGTMEvents()).toBe(3);
    expect(sqls()[0]).toContain("exit_reason = 'gtm_purchase'");
    expect(sqls()[0]).toContain("INTERVAL '30 days'");
    expect(sqls()[1]).toContain('ga4_events');
  });
  it('checkRaynaBookings: only bookings after entry count; then recompute conversion_rate guarded for 0 entries', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 4 });
    expect(await ConversionDetector.checkRaynaBookings()).toBe(7);
    const s = sqls();
    expect(s).toHaveLength(5);
    for (const t of ['rayna_tours', 'rayna_hotels', 'rayna_visas', 'rayna_flights']) {
      const q = s.find(x => x.includes(`FROM ${t}`));
      expect(q).toContain('b.latest_booking > je.entered_at');
      expect(q).toContain(`rayna_booking_${t}`);
    }
    expect(s[4]).toContain('CASE WHEN jf.total_entries > 0');
  });
  // BUG: GTM/GA4 conversion has no attribution window relative to journey entry —
  // a purchase made BEFORE the contact entered the journey (within 30 days) still marks the
  // entry 'converted'. Rayna bookings correctly require latest_booking > je.entered_at.
  // src/services/ConversionDetector.ts:74-89 and :98-113.
  it('GTM conversion only counts events after the entry was created', async () => {
    await ConversionDetector.checkGTMEvents();
    expect(sqls()[0]).toContain('je.entered_at');
  });
  it('exitStaleEntries skips journeys without a segment label and sums exits', async () => {
    m.query.mockImplementation(async (sql) => {
      if (sql.includes('segment_label')) return { rows: [{ journey_id: 1, segment_label: 'A' }, { journey_id: 2, segment_label: null }], rowCount: 2 };
      if (sql.includes("status = 'exited'") && sql.includes('UPDATE journey_entries')) return { rows: [], rowCount: 5 };
      return { rows: [], rowCount: 0 };
    });
    expect(await ConversionDetector.exitStaleEntries()).toBe(5);
    const exitCall = callFor("exit_reason = 'segment_changed'");
    expect(exitCall?.[1]).toEqual([1, 'A']);
    expect(m.query.mock.calls.filter(([, p]) => Array.isArray(p) && p[0] === 2)).toHaveLength(0);
  });
  it('autoEnroll only refreshes counts when something enrolled', async () => {
    m.query.mockImplementation(async (sql, p) => {
      if (sql.includes('segment_label')) return { rows: [{ journey_id: 1, segment_label: 'A' }, { journey_id: 2, segment_label: 'B' }], rowCount: 2 };
      if (sql.includes('INSERT INTO journey_entries')) return { rows: [], rowCount: p?.[0] === 1 ? 10 : 0 };
      return { rows: [], rowCount: 0 };
    });
    expect(await ConversionDetector.autoEnroll()).toBe(10);
    const updates = m.query.mock.calls.filter(([s]) => s.includes('total_entries = (SELECT COUNT(*)'));
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual([1]);
    expect(callFor('INSERT INTO journey_entries')?.[0]).toContain('uc.email IS NOT NULL');
  });
  it('runAll aggregates and reports a duration string (fake clock)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const r = await ConversionDetector.runAll();
    expect(r).toMatchObject({ gtmConversions: 0, bookingConversions: 0, exited: 0, enrolled: 0, duration: '0.0' });
  });
  // BUG: checkUTMClicks returns pg's rowCount verbatim, which is `null` for some commands /
  // drivers; runAll then reports `UTM: null` instead of a number. ConversionDetector.ts:61-62.
  it('checkUTMClicks always returns a number', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: null });
    expect(typeof (await ConversionDetector.checkUTMClicks())).toBe('number');
  });
});

describe('SendTrackService', () => {
  it('logSend inserts queued row and returns id; empties become null', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: 77 }] });
    const id = await SendTrackService.logSend({ email: 'a@b', subject: 's', templateLabel: 't' });
    expect(id).toBe(77);
    expect(m.query.mock.calls[0][1]).toEqual([null, 'a@b', null, 's', 't', null, 'test-send', null, null]);
  });
  it('markSent/markFailed/markOpened/markClicked send right status and params', async () => {
    await SendTrackService.markSent(1, { externalId: 'x', provider: 'p', durationMs: 5 });
    await SendTrackService.markFailed(2, { error: 'e' });
    await SendTrackService.markOpened(3);
    await SendTrackService.markClicked(4, { ua: 'UA', ip: '1.1.1.1' });
    const c = m.query.mock.calls;
    expect(c[0][0]).toContain("status = 'sent'"); expect(c[0][1]).toEqual([1, 'x', 'p', 5]);
    expect(c[1][0]).toContain("status = 'failed'"); expect(c[1][1]).toEqual([2, 'e', null, null]);
    expect(c[2][0]).toContain("NOT IN ('clicked')"); expect(c[2][1]).toEqual([3, null, null]);
    expect(c[3][1]).toEqual([4, 'UA', '1.1.1.1']);
  });
  it('reserveLogId fetches a block once and hands out ids in order', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: '10' }, { id: '11' }] });
    expect(await SendTrackService.reserveLogId()).toBe(10);
    expect(await SendTrackService.reserveLogId()).toBe(11);
    expect(m.query).toHaveBeenCalledTimes(1);
  });
  it('bufferLog flushes after timer with one multi-row insert', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-02T00:00:00Z'));
    SendTrackService.bufferLog({ id: 1, email: 'a@x' });
    SendTrackService.bufferLog({ id: 2, email: 'b@x', status: 'failed', source: 'gtm' });
    expect(m.query).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.query).toHaveBeenCalledTimes(1);
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sql).toContain('$32');
    expect(params).toHaveLength(32);
    expect(params?.[7]).toBe('journey');
    expect(params?.[10]).toBe('sent');
    expect(params?.[26]).toBe('failed');
    await SendTrackService.flushLogs();
    expect(m.query).toHaveBeenCalledTimes(1);
  });
  it('flushLogs swallows insert errors', async () => {
    SendTrackService.bufferLog({ id: 9, email: 'z' });
    m.query.mockRejectedValueOnce(new Error('dup'));
    await expect(SendTrackService.flushLogs()).resolves.toBeUndefined();
  });
  it('getLog without filters uses planner estimate; with filters builds params', async () => {
    m.query.mockImplementation(async (sql) => sql.includes('reltuples') || sql.includes('COUNT(*) AS total') ? { rows: [{ total: '42' }] } : { rows: [{ id: 1 }] });
    const r = await SendTrackService.getLog();
    expect(r).toMatchObject({ total: 42, estimated: true, page: 1, limit: 50 });
    m.query.mockClear();
    const r2 = await SendTrackService.getLog({ page: 3, limit: 10, status: 'sent', email: 'ab', journeyId: '5', subscriptionStatus: 'unsubscribed' });
    expect(r2).toMatchObject({ estimated: false });
    const list = m.query.mock.calls.find(([s]) => s.includes('ORDER BY esl.sent_at'));
    expect(list?.[1]).toEqual(['sent', '%ab%', 5, 10, 20]);
    expect(list?.[0]).toContain('LIMIT $4 OFFSET $5');
    const count = m.query.mock.calls.find(([s]) => s.includes('COUNT(*) AS total'));
    expect(count?.[0]).toContain('LEFT JOIN unified_contacts');
  });
  it('getLog opened/clicked statuses use timestamps not params', async () => {
    m.query.mockResolvedValue({ rows: [{ total: '0' }] });
    await SendTrackService.getLog({ status: 'clicked' });
    expect(m.query.mock.calls[0][0]).toContain('esl.clicked_at IS NOT NULL');
    expect(m.query.mock.calls[0][1]).toEqual([50, 0]);
  });
  it('whatsapp channel routes to whatsapp_send_log; clicked yields 1 = 0', async () => {
    m.query.mockResolvedValue({ rows: [{ total: '0' }] });
    await SendTrackService.getLog({ channel: 'whatsapp', status: 'clicked', email: 'x' });
    expect(m.query.mock.calls[0][0]).toContain('FROM whatsapp_send_log');
    expect(m.query.mock.calls[0][0]).toContain('1 = 0');
    expect(m.query.mock.calls[0][0]).toContain('wsl.phone ILIKE $1 OR wsl.contact_name ILIKE $1');
  });
  it('getSummary clamps days to [1,365]', async () => {
    await SendTrackService.getSummary({ days: 9999 });
    expect(m.query.mock.calls[0][1]).toEqual(['365']);
    m.query.mockClear();
    const r = await SendTrackService.getSummary({ days: 'abc' });
    expect(r.windowDays).toBe(30);
    m.query.mockClear();
    expect((await SendTrackService.getSummary({ days: -4 })).windowDays).toBe(1);
  });
  it('getSummary open-rate SQL guards divide-by-zero', async () => {
    await SendTrackService.getSummary();
    expect(m.query.mock.calls[1][0]).toContain('NULLIF(');
  });
  it('utm visit insert + log + summary', async () => {
    await SendTrackService.logUtmVisit({ logId: 1, utmCampaign: 'c' });
    expect(m.query.mock.calls[0][1]).toEqual([1, null, null, null, null, 'c', null, null, null, null]);
    m.query.mockResolvedValue({ rows: [{ total: '3' }] });
    const r = await SendTrackService.getUtmLog({ utmCampaign: 'sum', page: 2, limit: 5 });
    expect(r.total).toBe(3);
    expect(m.query.mock.calls[1][1]).toEqual(['%sum%', 5, 5]);
    const s = await SendTrackService.getUtmSummary();
    expect(s.byCampaign).toBeDefined();
    expect((await SendTrackService.getByUnifiedId(5)).length).toBe(1);
  });
  // BUG: page <= 0 (e.g. ?page=0 from the UI) yields a negative OFFSET, which Postgres rejects.
  // SendTrackService.ts:196 (also :261, :387) — no clamping of page.
  it('getLog never sends a negative OFFSET', async () => {
    m.query.mockResolvedValue({ rows: [{ total: '0' }] });
    await SendTrackService.getLog({ page: 0 });
    const p = m.query.mock.calls[0][1] ?? [];
    expect(Number(p[p.length - 1])).toBeGreaterThanOrEqual(0);
  });
});
