import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: Record<string, unknown>[]; rowCount: number | null };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  regRun: vi.fn<(o: { full?: boolean }) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/services/RegistrationContactSync.js', () => ({ default: { run: m.regRun } }));

import UnifiedContactBuilder from '../src/services/UnifiedContactBuilder.js';
import UnifiedContactSync from '../src/services/UnifiedContactSync.js';
import DailyReportService from '../src/services/DailyReportService.js';

const sqls = () => m.query.mock.calls.map(([s]) => s);

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  m.regRun.mockReset().mockResolvedValue({ created: 1 });
});
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────── UnifiedContactBuilder ───────────────────────────
describe('UnifiedContactBuilder', () => {
  it('extractContacts truncates first, then email pass, then phone pass', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 10 })
      .mockResolvedValueOnce({ rows: [], rowCount: 4 });
    await expect(UnifiedContactBuilder.extractContacts()).resolves.toEqual({ emailBased: 10, phoneBased: 4, total: 14 });
    expect(sqls()[0]).toContain('TRUNCATE unified_contacts');
    expect(sqls()[1]).toContain("'TBA'");
    expect(sqls()[1]).toContain("'RAYNA TOURISM BLOCKING'");
  });

  it('linkRaynaTables reports per-table counts; null rowCount → 0', async () => {
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('::int AS c FROM')) return { rows: [{ c: 9 }], rowCount: 1 };
      if (sql.includes('LOWER(TRIM(rt.guest_email))')) return { rows: [], rowCount: 5 };
      if (sql.includes('RIGHT(REGEXP_REPLACE(rt.guest_contact')) return { rows: [], rowCount: null };
      return { rows: [], rowCount: 0 };
    });
    const out = await UnifiedContactBuilder.linkRaynaTables();
    expect(Object.keys(out)).toEqual(['rayna_tours', 'rayna_packages', 'rayna_hotels', 'rayna_visas', 'rayna_flights', 'rayna_others']);
    expect(out.rayna_tours).toEqual({ byEmail: 5, byPhone: 0, linked: 5, total: 9 });
  });

  it('computeSegmentation returns the status summary (empty table → [])', async () => {
    await expect(UnifiedContactBuilder.computeSegmentation()).resolves.toEqual([]);
    m.query.mockImplementation(async (sql: string) =>
      sql.includes('GROUP BY booking_status') ? { rows: [{ booking_status: 'PROSPECT', count: 3 }], rowCount: 1 } : { rows: [], rowCount: 0 });
    await expect(UnifiedContactBuilder.computeSegmentation()).resolves.toEqual([{ booking_status: 'PROSPECT', count: 3 }]);
  });

  it('rebuild clears registration links then re-runs the registration sync in full mode', async () => {
    m.query.mockImplementation(async (sql: string) =>
      sql.includes('::int AS c FROM') ? { rows: [{ c: 0 }], rowCount: 1 } : { rows: [], rowCount: 0 });
    const out = await UnifiedContactBuilder.rebuild();
    for (const t of ['affiliate_data', 'agent_data', 'guestuser_data']) {
      expect(sqls()).toContain(`UPDATE ${t} SET unified_id = NULL WHERE unified_id IS NOT NULL`);
    }
    expect(m.regRun).toHaveBeenCalledWith({ full: true });
    expect(out.registrations).toEqual({ created: 1 });
  });

  it('rebuild survives a registration re-link failure', async () => {
    m.query.mockImplementation(async (sql: string) =>
      sql.includes('::int AS c FROM') ? { rows: [{ c: 0 }], rowCount: 1 } : { rows: [], rowCount: 0 });
    m.regRun.mockRejectedValue(new Error('lock'));
    const out = await UnifiedContactBuilder.rebuild();
    expect(out.registrations).toBeNull();
    expect(out.extracted.total).toBe(0);
  });

  it('rebuild propagates a failure in the core extract step', async () => {
    m.query.mockRejectedValueOnce(new Error('truncate denied'));
    await expect(UnifiedContactBuilder.rebuild()).rejects.toThrow('truncate denied');
    expect(m.regRun).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── UnifiedContactSync ───────────────────────────
describe('UnifiedContactSync', () => {
  it('syncNewContacts returns rowCount', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 12 });
    await expect(UnifiedContactSync.syncNewContacts()).resolves.toBe(12);
  });

  it('syncChats returns inserted + updated', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 2 }).mockResolvedValueOnce({ rows: [], rowCount: 5 });
    await expect(UnifiedContactSync.syncChats()).resolves.toEqual({ newChats: 2, updated: 5 });
  });

  it('syncRaynaBookings scopes every query to the API cutoff', async () => {
    m.query.mockResolvedValue({ rows: [], rowCount: 3 });
    await expect(UnifiedContactSync.syncRaynaBookings()).resolves.toBe(6);
    expect(m.query).toHaveBeenCalledTimes(3);
    for (const s of sqls()) expect(s).toContain(`'${UnifiedContactSync.API_CUTOFF}'`);
  });

  it('syncUnsubscribed writes the log only when something changed', async () => {
    await expect(UnifiedContactSync.syncUnsubscribed()).resolves.toBe(0);
    expect(m.query).toHaveBeenCalledTimes(1);
    m.query.mockReset().mockResolvedValue({ rows: [], rowCount: 2 });
    await UnifiedContactSync.syncUnsubscribed();
    expect(sqls()[1]).toContain('INSERT INTO unsubscribe_log');
  });

  it('syncRaynaContactsToUsers: nothing unmatched → zeros', async () => {
    m.query.mockResolvedValueOnce({ rows: [], rowCount: 4 });
    await expect(UnifiedContactSync.syncRaynaContactsToUsers())
      .resolves.toEqual({ typesSet: 4, usersCreated: 0, matched: 0, emailsLinked: 0, phonesLinked: 0 });
  });

  it('syncRaynaContactsToUsers: matches by email, else phone, else creates a user (defaults B2C)', async () => {
    const contacts = [
      { unified_id: 1, name: 'A', email: 'a@x.com', email_key: 'a@x.com', phone: null, phone_key: null, company_name: null, city: null, country: null, contact_type: null },
      { unified_id: 2, name: null, email: null, email_key: null, phone: ' 0501234567 ', phone_key: '0501234567', company_name: null, city: null, country: null, contact_type: null },
      { unified_id: 3, name: '', email: '  ', email_key: 'nomatch', phone: '', phone_key: null, company_name: '', city: null, country: null, contact_type: null },
    ];
    m.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT unified_id, name')) return { rows: contacts, rowCount: 3 };
      if (sql.includes('FROM user_emails WHERE')) return { rows: params?.[0] === 'a@x.com' ? [{ user_id: 50 }] : [], rowCount: 0 };
      if (sql.includes('FROM user_phones')) return { rows: [{ user_id: 60 }], rowCount: 1 };
      if (sql.includes('INSERT INTO users')) return { rows: [{ id: 70 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const out = await UnifiedContactSync.syncRaynaContactsToUsers();
    expect(out).toEqual({ typesSet: 1, usersCreated: 1, matched: 2, emailsLinked: 1, phonesLinked: 1 });
    const ins = m.query.mock.calls.find(([s]) => s.includes('INSERT INTO users'))!;
    expect(ins[1]).toEqual([null, '  ', null, null, null, 'B2C', null]);
    const phone = m.query.mock.calls.find(([s]) => s.includes('INSERT INTO user_phones'))!;
    expect(phone[1]).toEqual([60, '0501234567']);
    const links = m.query.mock.calls.filter(([s]) => s.includes('SET user_id = $1')).map(([, p]) => p);
    expect(links).toEqual([[50, 1], [60, 2], [70, 3]]);
  });

  it('computeOccasions returns entered / exited / active', async () => {
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO user_occasions')) return { rows: [], rowCount: 3 };
      if (sql.includes("status = 'exited',")) return { rows: [], rowCount: 1 };
      if (sql.includes('FILTER')) return { rows: [{ active: 7, exited: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(UnifiedContactSync.computeOccasions()).resolves.toEqual({ entered: 3, exited: 1, active: 7 });
  });

  it('run calls every step in order and returns their results', async () => {
    const steps = ['refreshChatContacts', 'syncNewContacts', 'syncChats', 'syncRaynaBookings', 'syncNewRaynaContacts',
      'syncCRMBookings', 'syncUnsubscribed', 'syncGA4GTM', 'syncNewGTMContacts', 'relinkRawTables',
      'syncRaynaContactsToUsers', 'computeSegments', 'computeOccasions', 'classifyUserContactTypes'] as const;
    const order: string[] = [];
    for (const s of steps) {
      vi.spyOn(UnifiedContactSync, s).mockImplementation(async () => { order.push(s); return 0 as never; });
    }
    const out = await UnifiedContactSync.run();
    expect(order).toEqual([...steps]);
    expect(out.duration).toMatch(/^\d+\.\d$/);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('run stops at the first failing step', async () => {
    vi.spyOn(UnifiedContactSync, 'refreshChatContacts').mockRejectedValue(new Error('chat fail'));
    const next = vi.spyOn(UnifiedContactSync, 'syncNewContacts');
    await expect(UnifiedContactSync.run()).rejects.toThrow('chat fail');
    expect(next).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── DailyReportService ───────────────────────────
describe('DailyReportService', () => {
  it('_dateFilter: inclusive end for date columns, next-day bound for timestamps', () => {
    expect(DailyReportService._dateFilter('ga4_events')).toContain('event_date <= $2::date');
    expect(DailyReportService._dateFilter('rayna_tours')).toContain("bill_date < ($2::date + interval '1 day')");
  });

  it('getRecordCounts parses numbers per table and passes the range as params', async () => {
    m.query.mockImplementation(async (sql: string) =>
      sql.includes('total_sales')
        ? { rows: [{ total_rows: '10', total_bills: '4', total_sales: '1234.50', first_bill: 'B1', last_bill: 'B9' }], rowCount: 1 }
        : { rows: [{ total_rows: '3' }], rowCount: 1 });
    const out = await DailyReportService.getRecordCounts('2026-10-01', '2026-10-02');
    expect(Object.keys(out)).toEqual(Object.keys(DailyReportService.TABLES));
    expect(out.rayna_tours).toEqual({ totalRows: 10, totalBills: 4, totalSales: 1234.5, firstBill: 'B1', lastBill: 'B9' });
    expect(out.users).toEqual({ totalRows: 3, totalBills: null, totalSales: null, firstBill: null, lastBill: null });
    for (const [, p] of m.query.mock.calls) expect(p).toEqual(['2026-10-01', '2026-10-02']);
    expect(JSON.stringify(out)).not.toMatch(/NaN|undefined/);
  });

  it('getRecordCounts: empty range gives zeros, not NaN', async () => {
    m.query.mockResolvedValue({ rows: [{ total_rows: '0', total_bills: '0', total_sales: '0', first_bill: null, last_bill: null }], rowCount: 1 });
    const out = await DailyReportService.getRecordCounts('2026-10-01', '2026-10-01');
    expect(out.rayna_tours!.totalRows).toBe(0);
    expect(out.rayna_tours!.totalSales).toBe(0);
    expect(out.rayna_tours!.totalBills).toBe(0);
  });

  it('getRecordCounts propagates query errors', async () => {
    m.query.mockRejectedValue(new Error('timeout'));
    await expect(DailyReportService.getRecordCounts('2026-10-01', '2026-10-02')).rejects.toThrow('timeout');
  });

  it('getPreview shows the newest rows, at most 50', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ cnt: '7' }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ billno: 'B1' }], rowCount: 1 });
    const out = await DailyReportService.getPreview('rayna_tours', '2026-10-01', '2026-10-02');
    expect(sqls()[1]).toMatch(/LIMIT 7$/);
    expect(out).toMatchObject({ totalRows: 7, previewRows: 1 });
    m.query.mockReset().mockResolvedValueOnce({ rows: [{ cnt: '5000' }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await DailyReportService.getPreview('rayna_tours', 'a', 'b');
    expect(sqls()[1]).toMatch(/LIMIT 50$/);
  });

  it('getPreview with no data uses LIMIT 0', async () => {
    m.query.mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const out = await DailyReportService.getPreview('users', 'a', 'b');
    expect(sqls()[1]).toMatch(/LIMIT 0$/);
    expect(out).toMatchObject({ totalRows: 0, previewRows: 0, rows: [] });
  });

  it('getPreview / generateCSV reject unknown tables without querying (no SQL injection via table name)', async () => {
    await expect(DailyReportService.getPreview('users; DROP TABLE x', 'a', 'b')).rejects.toThrow('Unknown table');
    await expect(DailyReportService.generateCSV('pg_shadow', 'a', 'b')).rejects.toThrow('Unknown table');
    expect(m.query).not.toHaveBeenCalled();
  });

  it('getSyncStatus maps rows and falls back to 0 for bad numbers', async () => {
    const d = new Date('2026-10-18T00:00:00Z');
    m.query.mockResolvedValueOnce({ rows: [
      { table_name: 'a', sync_status: 'success', last_synced_at: d, rows_synced: '12', sync_duration_ms: '300', error_message: null },
      { table_name: 'b', sync_status: 'error', last_synced_at: null, rows_synced: null, sync_duration_ms: 'x', error_message: 'boom' },
    ], rowCount: 2 });
    await expect(DailyReportService.getSyncStatus()).resolves.toEqual({
      a: { syncStatus: 'success', lastSyncedAt: d, rowsSynced: 12, durationMs: 300, error: null },
      b: { syncStatus: 'error', lastSyncedAt: null, rowsSynced: 0, durationMs: 0, error: 'boom' },
    });
  });

  it('getSyncStatus returns {} on error', async () => {
    m.query.mockRejectedValue(new Error('no table'));
    await expect(DailyReportService.getSyncStatus()).resolves.toEqual({});
  });

  it('generateCSV: BOM, header, escaped values, dates formatted, nulls blank', async () => {
    m.query.mockResolvedValueOnce({ rows: [
      { id: 1, name: 'Smith, "Jo"', primary_email: null, mobile: undefined, company_name: 'a\nb', updated_at: new Date('2026-10-18T05:06:07.123Z') },
    ], rowCount: 1 });
    const csv = await DailyReportService.generateCSV('users', 'a', 'b');
    expect(csv.startsWith('﻿id,name,primary_email')).toBe(true);
    const line = csv.split('\n').slice(1).join('\n');
    expect(line).toContain('1,"Smith, ""Jo""",,,"a\nb"');
    expect(line).toContain('2026-10-18 05:06:07');
    expect(csv).not.toMatch(/NaN|undefined/);
  });

  it('generateCSV with no rows is just BOM + header + newline', async () => {
    const csv = await DailyReportService.generateCSV('chats', 'a', 'b');
    expect(csv).toBe('﻿' + DailyReportService.TABLES.chats!.columns.join(',') + '\n');
  });

  it('escapeCSV edge cases', () => {
    expect(DailyReportService.escapeCSV(0)).toBe('0');
    expect(DailyReportService.escapeCSV(false)).toBe('false');
    expect(DailyReportService.escapeCSV('a\rb')).toBe('"a\rb"');
    expect(DailyReportService.escapeCSV('')).toBe('');
  });
});
