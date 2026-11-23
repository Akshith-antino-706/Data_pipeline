import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: Record<string, unknown>[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery: vi.fn(), default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import { syncBroadcast, syncPending } from '../src/services/WhatsAppDeliverySync.js';
import DailyReportService from '../src/services/DailyReportService.js';

const fetchMock = vi.fn<(url: string) => Promise<Response>>();
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const find = (re: RegExp) => m.query.mock.calls.find(([s]) => re.test(s));

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const counters = (d: Record<string, unknown>) => json({ status: 'success', data: d });
const emptyList = () => json({ data: [] });

describe('WhatsAppDeliverySync.syncBroadcast', () => {
  it('maps counters, encodes the id and marks a fully resolved broadcast finished', async () => {
    fetchMock.mockResolvedValueOnce(counters({ total: '10', sent: '0', failed: '2', delivered: '8', open: '5', clicked: '' }))
      .mockResolvedValueOnce(emptyList());
    const r = await syncBroadcast('a b');
    expect(fetchMock.mock.calls[0]![0]).toContain('broadcast_id=a%20b');
    expect(fetchMock.mock.calls[1]![0]).toContain('type=failed');
    expect(r).toMatchObject({ ok: true, reportStatus: 'finished', counters: { total: 10, opened: 5, clicked: null } });
    const upd = find(/UPDATE chathead_broadcasts/)!;
    expect(upd[1]![0]).toBe('a b');
    expect(upd[1]![11]).toBe('finished');
    expect(upd[1]![12]).toBe(false); // no previous snapshot → "changed"
  });

  it('total 0/null → pending; in-flight → in_progress', async () => {
    fetchMock.mockResolvedValueOnce(counters({ total: null })).mockResolvedValueOnce(emptyList());
    expect((await syncBroadcast(1)).reportStatus).toBe('pending');
    fetchMock.mockResolvedValueOnce(counters({ total: 10, sent: 5, delivered: 5 })).mockResolvedValueOnce(emptyList());
    expect((await syncBroadcast(1)).reportStatus).toBe('in_progress');
  });

  it('unchanged counters stable for >= 60 minutes → finished; < 60 → in_progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const prev = (changedAt: string) => ({ rows: [{ total_count: '10', sent_count: '5', failed_count: null, delivered_count: '5',
      opened_count: null, clicked_count: null, replied_count: null, soft_bounce: null, hard_bounce: null, complaints: null,
      counters_changed_at: changedAt }] });
    m.query.mockResolvedValueOnce(prev('2026-01-01T11:00:00Z'));
    fetchMock.mockResolvedValueOnce(counters({ total: 10, sent: 5, delivered: 5 })).mockResolvedValueOnce(emptyList());
    const done = await syncBroadcast(7);
    expect(done.reportStatus).toBe('finished');
    expect(find(/UPDATE chathead_broadcasts/)![1]![12]).toBe(true);

    m.query.mockClear();
    m.query.mockResolvedValueOnce(prev('2026-01-01T11:30:00Z'));
    fetchMock.mockResolvedValueOnce(counters({ total: 10, sent: 5, delivered: 5 })).mockResolvedValueOnce(emptyList());
    expect((await syncBroadcast(7)).reportStatus).toBe('in_progress');
  });

  it('per-recipient: wamid → record id (never downgrade), reason → failed (500 chars), short numbers skipped', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 'error' })).mockResolvedValueOnce(json({ data: [
      { number: '+971 50 123 4567', reason: 'wamid.ABC' },
      { number: '971501234568', reason: 'x'.repeat(600) },
      { number: 'r', reason: 'junk' },
      { number: '971501234569', reason: null },
    ] }));
    const r = await syncBroadcast('b1');
    expect(r).toMatchObject({ ok: false, counters: null, perRecipient: 3 });
    const w = find(/SET wamid=\$3/)!;
    expect(w[0]).toContain("status <> 'failed'");
    expect(w[1]).toEqual(['b1', '971501234567', 'wamid.ABC']);
    const f = find(/SET status='failed'/)!;
    expect((f[1]![2] as string).length).toBe(500);
    expect(m.query.mock.calls.filter(([s]) => /whatsapp_send_log/.test(s))).toHaveLength(2);
  });

  it('never throws on network errors', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(syncBroadcast('x')).resolves.toMatchObject({ ok: false, perRecipient: 0 });
  });

  it('syncPending passes age/limit params and counts results', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ chathead_broadcast_id: 'a' }, { chathead_broadcast_id: 'b' }] });
    fetchMock.mockImplementation(async (url) => (url.includes('reports/get')
      ? (url.endsWith('broadcast_id=a') ? counters({ total: 1, sent: 0, delivered: 1 }) : json({ status: 'error' }))
      : emptyList()));
    const s = await syncPending({ maxAgeHours: 24, limit: 5 });
    expect(m.query.mock.calls[0]![1]).toEqual(['24', 5]);
    expect(m.query.mock.calls[0]![0]).toContain("report_status <> 'finished'");
    expect(s).toEqual({ candidates: 2, synced: 1, finished: 1 });
  });
});

describe('DailyReportService', () => {
  it('_dateFilter: inclusive date columns vs exclusive next-day timestamps', () => {
    expect(DailyReportService._dateFilter('ga4_events')).toBe('WHERE event_date >= $1::date AND event_date <= $2::date');
    expect(DailyReportService._dateFilter('chats')).toContain("< ($2::date + interval '1 day')");
  });

  it('getRecordCounts parses numbers per table and passes dates as params', async () => {
    m.query.mockImplementation(async (sql) => ({ rows: [/total_sales/.test(sql)
      ? { total_rows: '4', total_bills: '2', total_sales: '10.5', first_bill: 'A', last_bill: '' }
      : { total_rows: '3' }] }));
    const s = await DailyReportService.getRecordCounts('2026-01-01', '2026-01-02');
    expect(s.rayna_tours).toEqual({ totalRows: 4, totalBills: 2, totalSales: 10.5, firstBill: 'A', lastBill: null });
    expect(s.users).toEqual({ totalRows: 3, totalBills: null, totalSales: null, firstBill: null, lastBill: null });
    m.query.mock.calls.forEach(([, p]) => expect(p).toEqual(['2026-01-01', '2026-01-02']));
    expect(m.query).toHaveBeenCalledTimes(Object.keys(DailyReportService.TABLES).length);
  });

  it.each([[0, 0], [7, 7], [5000, 50]])('getPreview with %i rows limits to %i', async (total, limit) => {
    m.query.mockResolvedValueOnce({ rows: [{ cnt: String(total) }] }).mockResolvedValueOnce({ rows: [] });
    const r = await DailyReportService.getPreview('chats', 'a', 'b');
    expect(m.query.mock.calls[1]![0]).toMatch(new RegExp(`ORDER BY created_at DESC LIMIT ${limit}$`));
    expect(r.totalRows).toBe(total);
  });

  it('unknown tables are rejected without querying', async () => {
    await expect(DailyReportService.getPreview('pg_shadow', 'a', 'b')).rejects.toThrow('Unknown table');
    await expect(DailyReportService.generateCSV('x; DROP TABLE y', 'a', 'b')).rejects.toThrow('Unknown table');
    expect(m.query).not.toHaveBeenCalled();
  });

  // Regression (fixed): TABLES lookup has no own-property check, so inherited names like
  // 'constructor' pass the "Unknown table" guard and reach SQL as a table name
  // (DailyReportService.ts:181-188 and 229-230).
  it('rejects inherited object keys as table names', async () => {
    m.query.mockResolvedValue({ rows: [{ cnt: '0' }] });
    await expect(DailyReportService.getPreview('constructor', 'a', 'b')).rejects.toThrow('Unknown table');
    expect(m.query).not.toHaveBeenCalled();
  });

  it('escapeCSV quotes commas/quotes/newlines and formats dates', () => {
    expect(DailyReportService.escapeCSV(null)).toBe('');
    expect(DailyReportService.escapeCSV(undefined)).toBe('');
    expect(DailyReportService.escapeCSV('a,b')).toBe('"a,b"');
    expect(DailyReportService.escapeCSV('say "hi"')).toBe('"say ""hi"""');
    expect(DailyReportService.escapeCSV('l1\r\nl2')).toBe('"l1\r\nl2"');
    expect(DailyReportService.escapeCSV(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02 03:04:05');
    expect(DailyReportService.escapeCSV(0)).toBe('0');
  });

  it('generateCSV prefixes a BOM and writes columns in config order', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: 1, wa_name: 'A,B', extra: 'ignored' }] });
    const csv = await DailyReportService.generateCSV('chats', 'a', 'b');
    const [header, line] = csv.split('\n');
    expect(header).toBe('﻿' + DailyReportService.TABLES.chats!.columns.join(','));
    expect(line).toBe('1,,,"A,B",,,,,,');
  });

  it('getSyncStatus maps rows and returns {} on error', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ table_name: 't', sync_status: 'success', last_synced_at: null, rows_synced: 'x', sync_duration_ms: '12', error_message: null }] });
    expect(await DailyReportService.getSyncStatus()).toEqual({ t: { syncStatus: 'success', lastSyncedAt: null, rowsSynced: 0, durationMs: 12, error: null } });
    m.query.mockRejectedValueOnce(new Error('down'));
    expect(await DailyReportService.getSyncStatus()).toEqual({});
  });
});
