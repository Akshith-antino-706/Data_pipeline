import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  mysqlQuery: vi.fn<(sql: string, params?: unknown[], pool?: string) => Promise<unknown[]>>(),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery: m.mysqlQuery, default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import UnsubscribeSyncService from '../src/services/UnsubscribeSyncService.js';
import WhatsAppUnsubscribeSyncService from '../src/services/WhatsAppUnsubscribeSyncService.js';

const sqlCalls = () => m.query.mock.calls.map(([s]) => s);
const findCall = (re: RegExp) => m.query.mock.calls.find(([s]) => re.test(s));

beforeEach(() => {
  m.query.mockReset();
  m.mysqlQuery.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('UnsubscribeSyncService.sync', () => {
  it('pages MySQL by LIMIT/OFFSET 5000 and stops on a short page', async () => {
    const full = Array.from({ length: 5000 }, (_, i) => ({ email: `u${i}@x.com`, unsubscribe: 1 }));
    m.mysqlQuery.mockResolvedValueOnce(full).mockResolvedValueOnce([{ email: 'a@x.com', unsubscribe: 0 }]);
    const r = await UnsubscribeSyncService.sync();
    expect(m.mysqlQuery).toHaveBeenCalledTimes(2);
    expect(m.mysqlQuery.mock.calls[0]![1]).toEqual([5000, 0]);
    expect(m.mysqlQuery.mock.calls[1]![1]).toEqual([5000, 5000]);
    expect(m.mysqlQuery.mock.calls[0]![2]).toBe('primary');
    expect(r.totalRows).toBe(5001);
  });

  it('stops immediately on an empty first page and still records success', async () => {
    m.mysqlQuery.mockResolvedValueOnce([]);
    const r = await UnsubscribeSyncService.sync();
    expect(r).toMatchObject({ totalRows: 0, setYes: 0, setNo: 0 });
    const meta = findCall(/sync_metadata/);
    expect(meta![0]).toContain("'success'");
    expect(meta![1]![1]).toBe(0);
  });

  it('normalises emails, drops blanks, and splits 1 → Yes / 0 → No (ignoring other values)', async () => {
    m.mysqlQuery.mockResolvedValueOnce([
      { email: '  A@X.COM ', unsubscribe: 1 },
      { email: null, unsubscribe: 1 },
      { email: '', unsubscribe: 0 },
      { email: 'B@x.com', unsubscribe: 0 },
      { email: 'c@x.com', unsubscribe: 2 },
    ]);
    m.query.mockImplementation(async (sql) => {
      if (/SET email_unsubscribe = 'Yes'/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SET email_unsubscribe = 'No'/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const r = await UnsubscribeSyncService.sync();
    expect(findCall(/SET email_unsubscribe = 'Yes'/)![1]).toEqual([['a@x.com']]);
    expect(findCall(/SET email_unsubscribe = 'No'/)![1]).toEqual([['b@x.com']]);
    expect(r.setYes).toBe(1);
    expect(r.setNo).toBe(1);
    expect(findCall(/sync_metadata/)![1]![1]).toBe(2);
  });

  it('writes to unsubscribe_log only when something flipped to Yes', async () => {
    m.mysqlQuery.mockResolvedValueOnce([{ email: 'a@x.com', unsubscribe: 1 }]);
    await UnsubscribeSyncService.sync();
    expect(findCall(/INSERT INTO unsubscribe_log/)).toBeUndefined();

    m.mysqlQuery.mockResolvedValueOnce([{ email: 'a@x.com', unsubscribe: 1 }]);
    m.query.mockImplementation(async (sql) => ({ rows: [], rowCount: /SET email_unsubscribe = 'Yes'/.test(sql) ? 3 : 0 }));
    await UnsubscribeSyncService.sync();
    const log = findCall(/INSERT INTO unsubscribe_log/);
    expect(log![0]).toContain("'mysql_sync'");
    expect(log![1]).toEqual([['a@x.com']]);
  });

  it('resubscribe never overrides our own opt-outs or restrictions', async () => {
    m.mysqlQuery.mockResolvedValueOnce([{ email: 'b@x.com', unsubscribe: 0 }]);
    await UnsubscribeSyncService.sync();
    const sql = findCall(/SET email_unsubscribe = 'No'/)![0];
    for (const c of ['unsubscribe_page', 'email_link', 'complaint', 'bounce', 'registration_optout']) {
      expect(sql).toContain(`'${c}'`);
    }
    expect(sql).toContain('unsubscribe_reason');
    expect(sql).toContain("IS DISTINCT FROM 'No'");
  });

  it('only flips rows not already Yes (idempotent SQL)', async () => {
    m.mysqlQuery.mockResolvedValueOnce([{ email: 'a@x.com', unsubscribe: 1 }]);
    await UnsubscribeSyncService.sync();
    expect(findCall(/SET email_unsubscribe = 'Yes'/)![0]).toContain("email_unsubscribe <> 'Yes'");
  });

  it('on MySQL failure writes an error row and rethrows', async () => {
    m.mysqlQuery.mockRejectedValueOnce(new Error('mysql down'));
    await expect(UnsubscribeSyncService.sync()).rejects.toThrow('mysql down');
    const meta = findCall(/sync_metadata/);
    expect(meta![0]).toContain("'error'");
    expect(meta![1]![2]).toBe('mysql down');
  });

  it('a sync_metadata write failure does not fail a successful run', async () => {
    m.mysqlQuery.mockResolvedValueOnce([]);
    m.query.mockRejectedValue(new Error('pg down'));
    await expect(UnsubscribeSyncService.sync()).resolves.toMatchObject({ totalRows: 0 });
  });

  // BUG: OFFSET paging with no ORDER BY is non-deterministic in MySQL; rows can be
  // skipped or seen twice between pages (UnsubscribeSyncService.ts:41).
  it.fails('pages MySQL with a stable ORDER BY', async () => {
    m.mysqlQuery.mockResolvedValueOnce([]);
    await UnsubscribeSyncService.sync();
    expect(m.mysqlQuery.mock.calls[0]![0]).toMatch(/ORDER BY/i);
  });

  // BUG: the unsubscribe_log insert logs EVERY matching 'Yes' contact in the batch,
  // including ones that were already 'Yes' before this run, so each run duplicates
  // log rows (UnsubscribeSyncService.ts:63-69).
  it.fails('logs only the contacts that were flipped in this run', async () => {
    m.mysqlQuery.mockResolvedValueOnce([{ email: 'a@x.com', unsubscribe: 1 }]);
    m.query.mockImplementation(async (sql) => ({ rows: [], rowCount: /SET email_unsubscribe = 'Yes'/.test(sql) ? 1 : 0 }));
    await UnsubscribeSyncService.sync();
    const log = findCall(/INSERT INTO unsubscribe_log/)![0];
    expect(log).toMatch(/RETURNING|NOT EXISTS\s*\(\s*SELECT 1 FROM unsubscribe_log/i);
  });
});

describe('WhatsAppUnsubscribeSyncService.sync', () => {
  const routeWatermark = (wm: string | null) => {
    m.query.mockImplementation(async (sql) => {
      if (/SELECT last_synced_at FROM sync_metadata/.test(sql)) return { rows: wm ? [{ last_synced_at: wm }] : [] };
      if (/UPDATE unified_contacts/.test(sql)) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    });
  };

  it('first run seeds sync_metadata and reads from the epoch on the chats pool', async () => {
    routeWatermark(null);
    m.mysqlQuery.mockResolvedValueOnce([]);
    const r = await WhatsAppUnsubscribeSyncService.sync({ triggeredBy: 'manual' });
    expect(findCall(/ON CONFLICT DO NOTHING/)![1]).toEqual(['wa_unsubscribe_sync']);
    const [sql, params, pool] = m.mysqlQuery.mock.calls[0]!;
    expect(sql).toContain("type = 'message'");
    expect((params![0] as Date).toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(pool).toBe('chats');
    expect(r).toMatchObject({ status: 'success', flipped: 0, triggeredBy: 'manual', watermarkFrom: '1970-01-01T00:00:00.000Z' });
  });

  it('normalises phones to digits, dedupes and drops empties', async () => {
    routeWatermark('2025-01-01T00:00:00Z');
    m.mysqlQuery.mockResolvedValueOnce([
      { destination: '+971 50-123', created_at: new Date() },
      { destination: '97150123', created_at: new Date() },
      { destination: null, created_at: new Date() },
      { destination: 'abc', created_at: new Date() },
    ]);
    const r = await WhatsAppUnsubscribeSyncService.sync();
    const upd = findCall(/SET wa_unsubscribe = 'Yes'/)!;
    expect(upd[1]).toEqual([['97150123']]);
    expect(upd[0]).toContain("wa_unsubscribe IS NULL OR wa_unsubscribe <> 'Yes'");
    expect(r.flipped).toBe(2);
    const meta = findCall(/INSERT INTO sync_metadata \(table_name, last_synced_at/)!;
    expect(meta[1]![2]).toBe(2);
    expect(meta[1]![3]).toBe('success');
  });

  it('chunks updates by 5000 phones', async () => {
    routeWatermark('2025-01-01T00:00:00Z');
    m.mysqlQuery.mockResolvedValueOnce(Array.from({ length: 5001 }, (_, i) => ({ destination: String(1000000 + i), created_at: new Date() })));
    const r = await WhatsAppUnsubscribeSyncService.sync();
    const upd = m.query.mock.calls.filter(([s]) => /SET wa_unsubscribe/.test(s));
    expect(upd).toHaveLength(2);
    expect((upd[0]![1]![0] as string[]).length).toBe(5000);
    expect((upd[1]![1]![0] as string[]).length).toBe(1);
    expect(r.flipped).toBe(4);
  });

  it('on MySQL failure returns an error summary and keeps the old watermark', async () => {
    routeWatermark('2025-01-01T00:00:00Z');
    m.mysqlQuery.mockRejectedValueOnce(new Error('boom'));
    const r = await WhatsAppUnsubscribeSyncService.sync();
    expect(r).toMatchObject({ status: 'error', error: 'boom' });
    const meta = findCall(/INSERT INTO sync_metadata \(table_name, last_synced_at/)!;
    expect(meta[1]![3]).toBe('error');
    expect((meta[1]![1] as Date).toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  // BUG: the catch block awaits readWatermark() while building the writeMetadata
  // arguments, outside the .catch(); when Postgres is down the method throws even
  // though it is meant to return an error summary (WhatsAppUnsubscribeSyncService.ts:134).
  it.fails('returns an error summary instead of throwing when Postgres is down', async () => {
    m.query.mockRejectedValue(new Error('pg down'));
    await expect(WhatsAppUnsubscribeSyncService.sync()).resolves.toMatchObject({ status: 'error' });
  });

  it('does not touch Postgres sql text beyond expected tables', async () => {
    routeWatermark('2025-01-01T00:00:00Z');
    m.mysqlQuery.mockResolvedValueOnce([]);
    await WhatsAppUnsubscribeSyncService.sync();
    expect(sqlCalls().every(s => /sync_metadata|unified_contacts/.test(s))).toBe(true);
  });
});
