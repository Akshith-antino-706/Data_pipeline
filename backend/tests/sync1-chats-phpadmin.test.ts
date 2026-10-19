import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  mysqlQuery: vi.fn<(sql: string, params?: unknown[], pool?: string) => Promise<unknown[]>>(),
  connQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<[unknown[]]>>(),
  connEnd: vi.fn<() => Promise<void>>(async () => undefined),
  createConnection: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery: m.mysqlQuery, default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createConnection: m.createConnection } }));

import ChatsSyncService from '../src/services/ChatsSyncService.js';
import { runPhpAdminSync } from '../src/services/PhpAdminWeeklySync.js';

const find = (re: RegExp) => m.query.mock.calls.find(([s]) => re.test(s));

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  m.mysqlQuery.mockReset();
  m.connQuery.mockReset();
  m.connEnd.mockClear();
  m.createConnection.mockReset();
  m.createConnection.mockResolvedValue({ query: m.connQuery, end: m.connEnd });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const chat = (id: number, over: Record<string, unknown> = {}) => ({
  id, wa_id: `9715${id}`, wa_name: 'N', email: null, country: 'AE', receiver: null, boat: null, status: null,
  priority: null, tags: null, fv: null, last_in: new Date('2026-01-01'), last_out: 'not-a-date',
  last_msg: new Date('invalid'), last_short: null, seen: 0, spam: 0, last_packed: null,
  created_at: new Date('2026-01-01'), updated_at: null, ...over,
});

describe('ChatsSyncService.sync', () => {
  const routeWm = (wm: string | null, counts: Record<string, number> = {}) => {
    m.query.mockImplementation(async (sql) => {
      if (/MAX\(created_at\)/.test(sql)) return { rows: [{ wm }] };
      for (const [k, v] of Object.entries(counts)) if (sql.includes(k)) return { rows: [], rowCount: v };
      return { rows: [], rowCount: 0 };
    });
  };

  it('empty RDS table: pulls everything by id keyset and loops until an empty page', async () => {
    routeWm(null);
    m.mysqlQuery.mockResolvedValueOnce([chat(5), chat(9)]).mockResolvedValueOnce([]);
    const r = await ChatsSyncService.sync();
    expect(m.mysqlQuery.mock.calls[0]![0]).not.toContain('created_at >');
    expect(m.mysqlQuery.mock.calls[0]![1]).toEqual([0, 2000]);
    expect(m.mysqlQuery.mock.calls[1]![1]).toEqual([9, 2000]);
    expect(m.mysqlQuery.mock.calls[0]![2]).toBe('chats');
    expect(r.inserted).toBe(2);
  });

  it('with a watermark filters by created_at > watermark string', async () => {
    routeWm('2026-01-01 00:00:00');
    m.mysqlQuery.mockResolvedValueOnce([]);
    await ChatsSyncService.sync();
    expect(m.mysqlQuery.mock.calls[0]![0]).toContain('created_at > ? AND id > ?');
    expect(m.mysqlQuery.mock.calls[0]![1]).toEqual(['2026-01-01 00:00:00', 0, 2000]);
  });

  it('builds 23 params per row with invalid dates → null and last_msg_at mirroring last_msg', async () => {
    routeWm(null);
    m.mysqlQuery.mockResolvedValueOnce([chat(1, { last_msg: new Date('2026-02-02') })]).mockResolvedValueOnce([]);
    await ChatsSyncService.sync();
    const [sql, params] = find(/INSERT INTO chats/)!;
    expect(params).toHaveLength(23);
    expect(sql).toContain('$23)');
    expect(params![10]).toEqual(new Date('2026-01-01')); // last_in
    expect(params![11]).toBeNull();                      // last_out string → null
    expect(params![21]).toEqual(params![12]);            // last_msg_at = last_msg
    expect(params![22]).toBeNull();                      // unified_id
  });

  it('invalid Date objects become null', async () => {
    routeWm(null);
    m.mysqlQuery.mockResolvedValueOnce([chat(1)]).mockResolvedValueOnce([]);
    await ChatsSyncService.sync();
    expect(find(/INSERT INTO chats/)![1]![12]).toBeNull();
  });

  it('only runs the post-promote backfill when contacts were promoted', async () => {
    routeWm('x');
    m.mysqlQuery.mockResolvedValue([]);
    await ChatsSyncService.sync();
    expect(m.query.mock.calls.filter(([s]) => /ORDER BY normalize_phone\(mobile\), id DESC/.test(s))).toHaveLength(0);

    m.query.mockClear();
    routeWm('x', { "'chats', 'PROSPECT', 'B2C'": 1, 'id DESC': 4 });
    const r = await ChatsSyncService.sync();
    expect(r.promoted).toBe(2);
    expect(r.unifiedMatched).toBe(8);
  });

  it('records metadata (inserted + matched) in finally, and rethrows on error', async () => {
    routeWm(null);
    m.mysqlQuery.mockRejectedValueOnce(new Error('mysql gone'));
    await expect(ChatsSyncService.sync()).rejects.toThrow('mysql gone');
    const meta = find(/sync_metadata/)!;
    expect(meta[1]!.slice(0, 3)).toEqual([0, 'error', 'mysql gone']);
  });

  it('a metadata write failure does not hide a successful result', async () => {
    m.query.mockImplementation(async (sql) => {
      if (/MAX\(created_at\)/.test(sql)) return { rows: [{ wm: 'x' }] };
      if (/sync_metadata/.test(sql)) throw new Error('meta');
      return { rows: [], rowCount: 0 };
    });
    m.mysqlQuery.mockResolvedValue([]);
    await expect(ChatsSyncService.sync()).resolves.toMatchObject({ inserted: 0 });
  });
});

const php = (o: Record<string, unknown>) => ({
  id: 1, contact_type: 'b2c', name: 'N', email: 'a@x.com', mobile: '+971 50 1', city: null,
  country_name: 'UAE', n_bookings: '0', h_bounce: '0', created_at: null, ...o,
});

describe('runPhpAdminSync', () => {
  const route = (existing: string[] = [], wm: string | null = '2026-01-01T00:00:00Z') => {
    m.query.mockImplementation(async (sql) => {
      if (/SELECT last_synced_at/.test(sql)) return { rows: wm ? [{ last_synced_at: wm }] : [] };
      if (/SELECT DISTINCT LOWER\(TRIM\(email\)\)/.test(sql)) return { rows: existing.map(e => ({ e })) };
      if (/INSERT INTO unified_contacts/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  };

  it('no new rows: advances watermark to the run start and closes the connection', async () => {
    route();
    m.connQuery.mockResolvedValueOnce([[]]);
    const s = await runPhpAdminSync({ triggeredBy: 'manual' });
    expect(s).toMatchObject({ status: 'success', mysqlRowsFetched: 0, newlyInserted: 0, triggeredBy: 'manual' });
    expect(s.watermarkTo).toBe(s.startedAt);
    expect(m.connQuery.mock.calls[0]![1]![0]).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(m.connEnd).toHaveBeenCalled();
  });

  it('first run seeds sync_metadata and scans from the epoch', async () => {
    route([], null);
    m.connQuery.mockResolvedValueOnce([[]]);
    const s = await runPhpAdminSync();
    expect(s.watermarkFrom).toBe('1970-01-01T00:00:00.000Z');
    expect(find(/ON CONFLICT DO NOTHING/)).toBeDefined();
  });

  it('dedupes by normalised email and skips emails already in unified_contacts', async () => {
    route(['b@x.com']);
    m.connQuery.mockResolvedValueOnce([[php({ email: ' A@X.com ' }), php({ email: 'a@x.com', name: 'dup' }), php({ email: 'B@x.com' })]]);
    const s = await runPhpAdminSync();
    expect(find(/SELECT DISTINCT LOWER/)![1]).toEqual([['a@x.com', 'b@x.com']]);
    const ins = find(/INSERT INTO unified_contacts/)!;
    expect(ins[1]).toHaveLength(14);
    expect(ins[1]![0]).toBe('a@x.com');
    expect(ins[1]![2]).toBe('N');          // first row wins
    expect(ins[1]![11]).toBe(' A@X.com '); // actual_email = raw
    expect(ins[0]).toContain('ON CONFLICT DO NOTHING');
    expect(s).toMatchObject({ alreadyInUnified: 1, newlyInserted: 1 });
  });

  it('derives booking status, geography, Indian flag, segments, bounce opt-out and mobile country', async () => {
    route();
    m.connQuery.mockResolvedValueOnce([[
      php({ email: 'i@x.com', country_name: 'India', n_bookings: '3', h_bounce: '1', mobile: ' 91 98 ', contact_type: 'B2B' }),
      php({ email: 'u@x.com', country_name: ' united arab emirates ', mobile: '+971501', contact_type: 'weird' }),
      php({ email: 'n@x.com', country_name: null, mobile: null, contact_type: null }),
    ]]);
    await runPhpAdminSync();
    const p = find(/INSERT INTO unified_contacts/)![1]!;
    const row = (i: number) => p.slice(i * 14, i * 14 + 14);
    expect(row(0)).toEqual(['i@x.com', '91 98', 'N', 'India', null, 'B2B', 'PAST_BOOKING', 'INTERNATIONAL', true,
      'PAST_BOOKING / INTERNATIONAL / INDIAN', 'Yes', 'i@x.com', ' 91 98 ', 'India']);
    expect(row(1).slice(5, 11)).toEqual(['weird', 'PROSPECT', 'LOCAL', false, 'PROSPECT / LOCAL', 'No']);
    expect(row(1)[13]).toBe('United Arab Emirates');
    expect(row(2).slice(5, 10)).toEqual([null, 'PROSPECT', null, false, 'PROSPECT']);
    expect(row(2)[13]).toBeNull();
  });

  it('inserts in chunks of 500', async () => {
    route();
    m.connQuery.mockResolvedValueOnce([Array.from({ length: 501 }, (_, i) => php({ email: `e${i}@x.com` }))]);
    const s = await runPhpAdminSync();
    expect(m.query.mock.calls.filter(([q]) => /INSERT INTO unified_contacts/.test(q))).toHaveLength(2);
    expect(s.newlyInserted).toBe(2);
  });

  it('MySQL failure: returns error summary, keeps old watermark, closes connection', async () => {
    route();
    m.connQuery.mockRejectedValueOnce(new Error('mysql timeout'));
    const s = await runPhpAdminSync();
    expect(s).toMatchObject({ status: 'error', error: 'mysql timeout' });
    const meta = m.query.mock.calls.filter(([q]) => /INSERT INTO sync_metadata \(table_name, last_synced_at/.test(q)).at(-1)!;
    expect(meta[1]![1]).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(meta[1]![3]).toBe('error');
    expect(m.connEnd).toHaveBeenCalled();
  });

  // BUG: documented as "Never throws", but the catch block awaits readWatermark()
  // outside the .catch(); with Postgres down the call rejects (PhpAdminWeeklySync.ts:289).
  it.fails('never throws even when Postgres is down', async () => {
    m.query.mockRejectedValue(new Error('pg down'));
    await expect(runPhpAdminSync()).resolves.toMatchObject({ status: 'error' });
  });
});
