import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Result = { rows: unknown[]; rowCount: number | null };
const m = vi.hoisted(() => ({
  dbQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  release: vi.fn(),
  connect: vi.fn(),
  mysqlQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<[unknown[], unknown]>>(),
  mysqlEnd: vi.fn<() => Promise<void>>(),
  createConnection: vi.fn(),
  recompute: vi.fn<(ids: unknown[] | null) => Promise<void>>(),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.dbQuery, connect: m.connect },
  query: m.dbQuery,
  transaction: vi.fn(),
}));
vi.mock('mysql2/promise', () => ({ default: { createConnection: m.createConnection } }));
vi.mock('../src/services/DailyBillingSync.js', () => ({ default: { recomputeSegmentation: m.recompute } }));

import { runPhpAdminSync } from '../src/services/PhpAdminWeeklySync.js';
import RegistrationContactSync from '../src/services/RegistrationContactSync.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  m.dbQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  m.clientQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  m.release.mockReset();
  m.connect.mockReset().mockResolvedValue({ query: m.clientQuery, release: m.release });
  m.mysqlQuery.mockReset().mockResolvedValue([[], []]);
  m.mysqlEnd.mockReset().mockResolvedValue(undefined);
  m.createConnection.mockReset().mockResolvedValue({ query: m.mysqlQuery, end: m.mysqlEnd });
  m.recompute.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────── PhpAdminWeeklySync ───────────────────────────
const WM = new Date('2026-10-01T00:00:00Z');
const phpRow = (over: Record<string, unknown> = {}) => ({
  id: 1, contact_type: 'b2c', name: 'Ann', email: ' Ann@X.com ', mobile: ' +971 50 123 4567 ',
  city: 'Dubai', country_name: 'UAE', n_bookings: '2', h_bounce: '0', created_at: new Date(), ...over,
});
const metaWrites = () => m.dbQuery.mock.calls.filter(([s]) => s.includes('INSERT INTO sync_metadata (table_name, last_synced_at'));

describe('runPhpAdminSync', () => {
  it('first run: inserts the watermark row and scans from epoch', async () => {
    const out = await runPhpAdminSync();
    expect(out.watermarkFrom).toBe('1970-01-01T00:00:00.000Z');
    expect(m.dbQuery.mock.calls.some(([s]) => s.includes('ON CONFLICT DO NOTHING'))).toBe(true);
    expect(out).toMatchObject({ status: 'success', mysqlRowsFetched: 0, newlyInserted: 0, triggeredBy: 'cron' });
    expect(metaWrites()).toHaveLength(1);
    expect(m.mysqlEnd).toHaveBeenCalledOnce();
  });

  it('dedupes by normalised email, skips existing contacts and maps fields', async () => {
    m.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT last_synced_at')) return { rows: [{ last_synced_at: WM }], rowCount: 1 };
      if (sql.includes('SELECT DISTINCT LOWER')) return { rows: [{ e: 'old@x.com' }], rowCount: 1 };
      if (sql.includes('INSERT INTO unified_contacts')) return { rows: [], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    });
    m.mysqlQuery.mockResolvedValue([[
      phpRow(),
      phpRow({ id: 2, email: 'ann@x.com' }),
      phpRow({ id: 3, email: 'old@x.com' }),
      phpRow({ id: 4, email: 'raj@x.com', mobile: '919812345678', country_name: 'India', n_bookings: '0', h_bounce: '3', name: '', contact_type: null }),
    ], []]);
    const out = await runPhpAdminSync({ triggeredBy: 'admin' });
    expect(out).toMatchObject({ mysqlRowsFetched: 4, alreadyInUnified: 1, newlyInserted: 2, status: 'success', triggeredBy: 'admin' });
    expect(out.watermarkFrom).toBe(WM.toISOString());
    expect(m.mysqlQuery.mock.calls[0]![1]![0]).toEqual(WM);

    const ins = m.dbQuery.mock.calls.find(([s]) => s.includes('INSERT INTO unified_contacts'))!;
    const p = ins[1]!;
    expect(p).toHaveLength(28);
    expect(p.slice(0, 14)).toEqual([
      'ann@x.com', '+971 50 123 4567', 'Ann', 'UAE', 'Dubai', 'B2C', 'PAST_BOOKING', 'LOCAL', false,
      'PAST_BOOKING / LOCAL', 'No', ' Ann@X.com ', ' +971 50 123 4567 ', 'United Arab Emirates',
    ]);
    expect(p.slice(14)).toEqual([
      'raj@x.com', '919812345678', null, 'India', 'Dubai', null, 'PROSPECT', 'INTERNATIONAL', true,
      'PROSPECT / INTERNATIONAL / INDIAN', 'Yes', 'raj@x.com', '919812345678', 'India',
    ]);
    expect(p.map(String)).not.toContain('NaN');
    expect(metaWrites()[0]![1]![2]).toBe(2);
  });

  it('handles missing country / mobile: null geography, no INDIAN, null mobile_country', async () => {
    m.dbQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT last_synced_at') ? { rows: [{ last_synced_at: WM }], rowCount: 1 } : { rows: [], rowCount: 1 });
    m.mysqlQuery.mockResolvedValue([[phpRow({ country_name: null, mobile: null, n_bookings: 'x', h_bounce: null })], []]);
    await runPhpAdminSync();
    const p = m.dbQuery.mock.calls.find(([s]) => s.includes('INSERT INTO unified_contacts'))![1]!;
    expect(p.slice(0, 14)).toEqual([
      'ann@x.com', null, 'Ann', null, 'Dubai', 'B2C', 'PROSPECT', null, false,
      'PROSPECT', 'No', ' Ann@X.com ', null, null,
    ]);
  });

  it('on MySQL failure: returns status error, keeps the old watermark, does not throw', async () => {
    m.dbQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT last_synced_at') ? { rows: [{ last_synced_at: WM }], rowCount: 1 } : { rows: [], rowCount: 0 });
    m.createConnection.mockRejectedValue(new Error('ETIMEDOUT'));
    const out = await runPhpAdminSync();
    expect(out).toMatchObject({ status: 'error', error: 'ETIMEDOUT', watermarkTo: null });
    const w = metaWrites()[0]![1]!;
    expect(w[1]).toEqual(WM);
    expect(w[3]).toBe('error');
    expect(m.mysqlEnd).not.toHaveBeenCalled();
  });

  it('closes the MySQL connection when the insert fails', async () => {
    m.dbQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT last_synced_at')) return { rows: [{ last_synced_at: WM }], rowCount: 1 };
      if (sql.includes('INSERT INTO unified_contacts')) throw new Error('insert failed');
      return { rows: [], rowCount: 0 };
    });
    m.mysqlQuery.mockResolvedValue([[phpRow()], []]);
    const out = await runPhpAdminSync();
    expect(out.status).toBe('error');
    expect(m.mysqlEnd).toHaveBeenCalledOnce();
  });

  // BUG: PhpAdminWeeklySync.ts:289 — the catch block evaluates `await readWatermark()` as an
  // argument BEFORE `.catch(() => {})` is attached, so when Postgres itself is down the
  // function rejects, despite its "Never throws" contract (PhpAdminWeeklySync.ts:131).
  it.fails('never throws even when Postgres is unreachable', async () => {
    m.dbQuery.mockRejectedValue(new Error('pg down'));
    await expect(runPhpAdminSync()).resolves.toMatchObject({ status: 'error' });
  });
});

// ─────────────────────────── RegistrationContactSync ───────────────────────────
type TypeChange = { id: number; email: string | null; old_type: string | null; contact_type: string; opted_out: boolean };
function scenario(o: { lock?: boolean; processed?: number; needMobile?: number; createdByType?: { type: string; n: number }[];
  typeChanges?: TypeChange[]; newIds?: number[]; created?: number; failOn?: RegExp } = {}) {
  m.clientQuery.mockImplementation(async (sql: string) => {
    if (o.failOn && o.failOn.test(sql)) throw new Error('sql failed');
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ ok: o.lock ?? true }], rowCount: 1 };
    if (sql.includes('FROM _rc WHERE uid IS NULL AND mob10')) return { rows: [{ n: o.needMobile ?? 0 }], rowCount: 1 };
    if (sql.includes('COUNT(*)::int AS n FROM _rc')) return { rows: [{ n: o.processed ?? 0 }], rowCount: 1 };
    if (sql.includes('SELECT contact_type AS type')) return { rows: o.createdByType ?? [], rowCount: 0 };
    if (sql.includes('WITH next AS')) return { rows: o.typeChanges ?? [], rowCount: 0 };
    if (sql.includes('SELECT id FROM _rc_new')) return { rows: (o.newIds ?? []).map(id => ({ id })), rowCount: 0 };
    if (sql.includes('INSERT INTO unified_contacts')) return { rows: [], rowCount: o.created ?? 0 };
    return { rows: [], rowCount: 1 };
  });
}
const clientSqls = () => m.clientQuery.mock.calls.map(([s]) => s);

describe('RegistrationContactSync.run', () => {
  it('empty registrations: commits, no recompute, writes success status', async () => {
    scenario();
    const out = await RegistrationContactSync.run();
    expect(out).toMatchObject({ mode: 'recent', dryRun: false, processed: 0, created: 0, updated: 0, touched: 0 });
    expect(clientSqls()).toContain('COMMIT');
    expect(m.recompute).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledOnce();
    const status = m.dbQuery.mock.calls.find(([s]) => s.includes('sync_metadata'))!;
    expect(status[1]).toEqual(['registration_contacts_sync', 0, 'success', null, expect.any(Number)]);
    expect(JSON.stringify(out)).not.toMatch(/NaN|undefined/);
  });

  it('typical run: counts, type changes, opt-outs, recompute on touched ids', async () => {
    scenario({
      processed: 5, needMobile: 2, created: 2, newIds: [100, 101],
      createdByType: [{ type: 'Affiliate', n: 1 }, { type: 'B2C', n: 1 }],
      typeChanges: [
        { id: 7, email: 'a@x.com', old_type: 'B2C', contact_type: 'B2B', opted_out: false },
        { id: 8, email: 'b@x.com', old_type: null, contact_type: 'B2C', opted_out: true },
        { id: 100, email: 'c@x.com', old_type: 'B2C', contact_type: 'B2C', opted_out: false },
      ],
    });
    const out = await RegistrationContactSync.run();
    expect(out).toMatchObject({
      processed: 5, created: 2, updated: 3, createdByType: { Affiliate: 1, B2C: 1 },
      typeChanges: { 'B2C → B2B': 1, 'none → B2C': 1 },
      emailOptOuts: { existingContacts: 1 }, touched: 4,
    });
    expect(m.recompute).toHaveBeenCalledWith([100, 101, 7, 8]);
    const optOut = m.clientQuery.mock.calls.find(([s]) => s.includes('UNNEST($1::bigint[])'))!;
    expect(optOut[1]).toEqual([[8], ['b@x.com']]);
    expect(m.dbQuery.mock.calls.find(([s]) => s.includes('sync_metadata'))![1]![1]).toBe(5);
  });

  it('skips the mobile match when no registration needs it', async () => {
    scenario({ needMobile: 0 });
    const out = await RegistrationContactSync.run();
    expect(out).toMatchObject({ matchedByMobile: 0 });
    expect(clientSqls().some(s => s.includes('DISTINCT ON (m10)'))).toBe(false);
  });

  it('recent mode filters by 2 days; full mode reads every row', async () => {
    scenario();
    await RegistrationContactSync.run();
    expect(clientSqls().find(s => s.includes('CREATE TEMP TABLE _rc ON COMMIT'))).toContain("INTERVAL '2 days'");
    m.clientQuery.mockClear();
    scenario();
    const out = await RegistrationContactSync.run({ full: true });
    expect(out).toMatchObject({ mode: 'full' });
    expect(clientSqls().find(s => s.includes('CREATE TEMP TABLE _rc ON COMMIT'))).not.toContain('INTERVAL');
  });

  it('dry run rolls back and writes nothing outside the transaction', async () => {
    scenario({ newIds: [1], created: 1 });
    const out = await RegistrationContactSync.run({ dryRun: true });
    expect(out).toMatchObject({ dryRun: true });
    expect(clientSqls()).toContain('ROLLBACK');
    expect(clientSqls()).not.toContain('COMMIT');
    expect(m.recompute).not.toHaveBeenCalled();
    expect(m.dbQuery).not.toHaveBeenCalled();
  });

  it('skips when another server holds the advisory lock', async () => {
    scenario({ lock: false });
    await expect(RegistrationContactSync.run()).resolves.toEqual({ skipped: true, reason: 'another server is running it' });
    expect(clientSqls()).toContain('ROLLBACK');
    expect(m.release).toHaveBeenCalledOnce();
    expect(RegistrationContactSync.isRunning()).toBe(false);
  });

  it('skips a concurrent call in the same process', async () => {
    scenario();
    const first = RegistrationContactSync.run();
    expect(RegistrationContactSync.isRunning()).toBe(true);
    await expect(RegistrationContactSync.run()).resolves.toEqual({ skipped: true, reason: 'already running' });
    await first;
    expect(RegistrationContactSync.isRunning()).toBe(false);
  });

  it('on SQL error: rolls back, records the error, rethrows and resets the running flag', async () => {
    scenario({ failOn: /WITH next AS/ });
    await expect(RegistrationContactSync.run()).rejects.toThrow('sql failed');
    expect(clientSqls()).toContain('ROLLBACK');
    expect(m.release).toHaveBeenCalledOnce();
    expect(m.dbQuery.mock.calls[0]![1]![2]).toBe('error');
    expect(RegistrationContactSync.isRunning()).toBe(false);
  });

  it('a failing sync_metadata write does not fail the run', async () => {
    scenario();
    m.dbQuery.mockRejectedValue(new Error('meta down'));
    await expect(RegistrationContactSync.run()).resolves.toMatchObject({ processed: 0 });
  });

  it('dry-run errors do not write status', async () => {
    scenario({ failOn: /CREATE TEMP TABLE _rc ON/ });
    await expect(RegistrationContactSync.run({ dryRun: true })).rejects.toThrow();
    expect(m.dbQuery).not.toHaveBeenCalled();
  });
});
