import { describe, it, expect, vi, beforeEach } from 'vitest';

type Result = { rows: unknown[]; rowCount?: number };
type Handler = (sql: string, params?: unknown[]) => Result | undefined;
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  clientQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(),
  release: vi.fn(),
  recompute: vi.fn<(ids: unknown[] | null) => Promise<void>>(async () => undefined),
}));

vi.mock('../src/config/database.js', () => ({
  default: { query: m.query, connect: async () => ({ query: m.clientQuery, release: m.release }) },
  query: m.query,
  transaction: vi.fn(),
}));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery: vi.fn(), default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));
vi.mock('../src/services/DailyBillingSync.js', () => ({ default: { recomputeSegmentation: m.recompute } }));

import RegistrationContactSync from '../src/services/RegistrationContactSync.js';

let lockOk = true;
let needMobile = 0;
let extra: Handler = () => undefined;

const base: Handler = (sql) => {
  if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ ok: lockOk }] };
  if (/COUNT\(\*\)::int AS n FROM _rc WHERE uid IS NULL AND mob10/.test(sql)) return { rows: [{ n: needMobile }] };
  if (/COUNT\(\*\)::int AS n FROM _rc`?$/m.test(sql) || /SELECT COUNT\(\*\)::int AS n FROM _rc$/.test(sql.trim())) return { rows: [{ n: 7 }] };
  return undefined;
};

const calls = () => m.clientQuery.mock.calls.map(([s]) => s);
const find = (re: RegExp) => m.clientQuery.mock.calls.find(([s]) => re.test(s));

beforeEach(() => {
  lockOk = true;
  needMobile = 0;
  extra = () => undefined;
  m.clientQuery.mockReset();
  m.clientQuery.mockImplementation(async (sql, params) => extra(sql, params) ?? base(sql, params) ?? { rows: [], rowCount: 0 });
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [], rowCount: 0 });
  m.release.mockClear();
  m.recompute.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('RegistrationContactSync.run — transaction & locking', () => {
  it('skips (rollback + release) when another server holds the advisory lock', async () => {
    lockOk = false;
    const r = await RegistrationContactSync.run();
    expect(r).toEqual({ skipped: true, reason: 'another server is running it' });
    expect(calls()).toContain('ROLLBACK');
    expect(calls()).not.toContain('COMMIT');
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(m.recompute).not.toHaveBeenCalled();
    expect(find(/pg_try_advisory_xact_lock/)![1]).toEqual(['registration_contacts_sync']);
    expect(RegistrationContactSync.isRunning()).toBe(false);
  });

  it('refuses a concurrent run in the same process', async () => {
    let releaseLock: () => void = () => undefined;
    const gate = new Promise<void>(res => { releaseLock = res; });
    m.clientQuery.mockImplementationOnce(async () => { await gate; return { rows: [], rowCount: 0 }; });
    const first = RegistrationContactSync.run();
    expect(RegistrationContactSync.isRunning()).toBe(true);
    await expect(RegistrationContactSync.run()).resolves.toEqual({ skipped: true, reason: 'already running' });
    releaseLock();
    await first;
    expect(RegistrationContactSync.isRunning()).toBe(false);
  });

  it('commits, records success and recomputes segments for touched ids', async () => {
    extra = (sql) => {
      if (/SELECT id FROM _rc_new/.test(sql)) return { rows: [{ id: 10 }, { id: 11 }] };
      if (/INSERT INTO unified_contacts/.test(sql)) return { rows: [], rowCount: 2 };
      if (/RETURNING uc.id/.test(sql)) return { rows: [
        { id: 11, email: 'a@x', old_type: 'B2C', contact_type: 'B2B', opted_out: false },
        { id: 12, email: 'b@x', old_type: null, contact_type: 'B2C', opted_out: true },
        { id: 13, email: 'c@x', old_type: 'B2B', contact_type: 'B2B', opted_out: false },
      ] };
      return undefined;
    };
    const r = await RegistrationContactSync.run();
    expect(calls()).toContain('COMMIT');
    expect(m.recompute).toHaveBeenCalledWith([10, 11, 12, 13]);
    expect(r).toMatchObject({
      mode: 'recent', dryRun: false, created: 2, updated: 3, touched: 4,
      typeChanges: { 'B2C → B2B': 1, 'none → B2C': 1 },
      emailOptOuts: { existingContacts: 1 },
    });
    const optLog = find(/UNNEST\(\$1::bigint\[\]\)/)!;
    expect(optLog[1]).toEqual([[12], ['b@x']]);
    const meta = m.query.mock.calls.find(([s]) => /sync_metadata/.test(s))!;
    expect(meta[1]).toEqual(['registration_contacts_sync', 5, 'success', null, expect.any(Number)]);
  });

  it('dry run rolls back and writes nothing outside the transaction', async () => {
    extra = (sql) => (/SELECT id FROM _rc_new/.test(sql) ? { rows: [{ id: 1 }] } : undefined);
    const r = await RegistrationContactSync.run({ dryRun: true });
    expect(calls()).not.toContain('COMMIT');
    expect(calls().filter(s => s === 'ROLLBACK')).toHaveLength(1);
    expect(m.recompute).not.toHaveBeenCalled();
    expect(m.query).not.toHaveBeenCalled();
    expect(r).toMatchObject({ dryRun: true, touched: 1 });
  });

  it('on failure rolls back, records the error, rethrows and clears the running flag', async () => {
    extra = (sql) => { if (/CREATE TEMP TABLE _rc ON COMMIT/.test(sql)) throw new Error('bad sql'); return undefined; };
    await expect(RegistrationContactSync.run()).rejects.toThrow('bad sql');
    expect(calls()).toContain('ROLLBACK');
    expect(m.release).toHaveBeenCalled();
    const meta = m.query.mock.calls.find(([s]) => /sync_metadata/.test(s))!;
    expect(meta[1]![2]).toBe('error');
    expect(meta[1]![3]).toBe('bad sql');
    expect(RegistrationContactSync.isRunning()).toBe(false);
  });

  it('a failing sync_metadata write is swallowed', async () => {
    m.query.mockRejectedValue(new Error('meta down'));
    await expect(RegistrationContactSync.run()).resolves.toMatchObject({ mode: 'recent' });
  });

  it('skips recompute when nothing was touched', async () => {
    await RegistrationContactSync.run();
    expect(m.recompute).not.toHaveBeenCalled();
  });
});

describe('RegistrationContactSync._sync — SQL decisions', () => {
  it('recent mode limits to unlinked or recently synced rows; full mode reads everything', async () => {
    await RegistrationContactSync.run();
    const recent = find(/CREATE TEMP TABLE _rc ON COMMIT/)![0];
    expect(recent).toContain("WHERE unified_id IS NULL OR synced_at >= NOW() - INTERVAL '2 days'");
    for (const t of ['affiliate_data', 'agent_data', 'guestuser_data']) expect(recent).toContain(`FROM ${t}`);

    m.clientQuery.mockClear();
    const r = await RegistrationContactSync.run({ full: true });
    expect(find(/CREATE TEMP TABLE _rc ON COMMIT/)![0]).not.toContain('synced_at >=');
    expect(r).toMatchObject({ mode: 'full' });
  });

  it('opt-out rules: affiliate unverified email, guest doSendPromotionMail = 1, agents never', async () => {
    await RegistrationContactSync.run();
    const sql = find(/CREATE TEMP TABLE _rc ON COMMIT/)![0];
    expect(sql).toContain(`TRIM("isVerifyEmail") = '0' AS opt_out`);
    expect(sql).toContain(`TRIM("doSendPromotionMail") = '1' AS opt_out`);
    expect(sql).toContain('FALSE AS opt_out');
  });

  it('skips mobile matching when no unmatched registration has a mobile', async () => {
    const r = await RegistrationContactSync.run();
    expect(calls().some(s => /SELECT DISTINCT ON \(m10\)/.test(s))).toBe(false);
    expect(r).toMatchObject({ matchedByMobile: 0, processed: 7 });
  });

  it('matches by mobile only when the registration or the contact has no email', async () => {
    needMobile = 3;
    extra = (sql) => (/SELECT DISTINCT ON \(m10\)/.test(sql) ? { rows: [], rowCount: 2 } : undefined);
    const r = await RegistrationContactSync.run();
    expect(find(/SELECT DISTINCT ON \(m10\)/)![0]).toContain('(r.email IS NULL OR NOT m.has_email)');
    expect(r).toMatchObject({ matchedByMobile: 2 });
  });

  it('writes unified_id back to each registration table only when it changed', async () => {
    extra = (sql) => (/UPDATE \w+_data t SET unified_id/.test(sql) ? { rows: [], rowCount: 4 } : undefined);
    const r = await RegistrationContactSync.run();
    const wb = calls().filter(s => /SET unified_id = r.uid/.test(s));
    expect(wb).toHaveLength(3);
    wb.forEach(s => expect(s).toContain('IS DISTINCT FROM r.uid'));
    expect(r).toMatchObject({ registrationsLinked: 12 });
  });

  it('never re-subscribes: opt-out only switches to Yes, otherwise keeps the old value', async () => {
    await RegistrationContactSync.run();
    expect(find(/RETURNING uc.id/)![0]).toContain("CASE WHEN t.opt_out THEN 'Yes' ELSE uc.email_unsubscribe END");
  });

  it('does not insert switched opt-out log rows when none switched', async () => {
    await RegistrationContactSync.run();
    expect(find(/UNNEST\(\$1::bigint\[\]\)/)).toBeUndefined();
  });
});
