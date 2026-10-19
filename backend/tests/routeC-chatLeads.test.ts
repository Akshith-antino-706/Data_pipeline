// chatLeads.ts routes. MySQL (mysqlQuery), Postgres (db) and ChatHead fetch are mocked.
import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

interface QResult { rows: unknown[] }
const { mockQuery, mysqlQuery, outbound, client, connect } = vi.hoisted(() => {
  const client = {
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
    release: vi.fn<() => void>(),
  };
  return {
    mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<QResult>>(),
    mysqlQuery: vi.fn<(sql: string, params?: unknown[], pool?: string) => Promise<unknown[]>>(),
    outbound: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
    client,
    connect: vi.fn(() => Promise.resolve(client)),
  };
});
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery, connect }, query: mockQuery }));
vi.mock('../src/config/mysql.js', () => ({ mysqlQuery }));

import chatLeadsRouter from '../src/routes/chatLeads.js';

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
  app.use(express.json());
  app.use('/', chatLeadsRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mysqlQuery.mockReset();
  mysqlQuery.mockResolvedValue([]);
  client.query.mockReset();
  client.query.mockResolvedValue({ rows: [] });
  outbound.mockReset();
  outbound.mockRejectedValue(new Error('external fetch blocked in tests'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

interface Body { success?: boolean; error?: string; [k: string]: unknown }
async function call<T = Body>(path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers = { 'content-type': 'application/json' }; }
  const r = await fetch(`${base}${path}`, init);
  return { status: r.status, body: await r.json() as T };
}

describe('date-range validated endpoints', () => {
  for (const ep of ['/summary', '/trend', '/mail-summary', '/mail-trend']) {
    it(`${ep}: missing dates → 400`, async () => {
      expect((await call(ep)).status).toBe(400);
      expect((await call(`${ep}?from=2026-01-01`)).status).toBe(400);
      expect(mysqlQuery).not.toHaveBeenCalled();
    });
    it(`${ep}: invalid / injected dates → 400`, async () => {
      expect((await call(`${ep}?from=nope&to=2026-01-01`)).status).toBe(400);
      expect((await call(`${ep}?from=${encodeURIComponent("2026-01-01' OR 1=1")}&to=2026-01-02`)).status).toBe(400);
      expect(mysqlQuery).not.toHaveBeenCalled();
    });
    it(`${ep}: from > to → 400`, async () => {
      expect((await call(`${ep}?from=2026-02-01&to=2026-01-01`)).status).toBe(400);
    });
    it(`${ep}: MySQL error → 500`, async () => {
      mysqlQuery.mockRejectedValue(new Error('mysql'));
      expect((await call(`${ep}?from=2026-01-01&to=2026-01-31`)).status).toBe(500);
    });
  }

  it('/summary aggregates totals and new/old users with bound params', async () => {
    mysqlQuery
      .mockResolvedValueOnce([{ receiver: '971', department: null, chats: 5, leads: 3 }])
      .mockResolvedValueOnce([{ chats: 5, leads: 3 }])
      .mockResolvedValueOnce([{ new_users: '2', old_users: '1' }]);
    const r = await call('/summary?from=2026-01-01&to=2026-01-31');
    expect(r.body).toMatchObject({ success: true, totalChats: 5, totalLeads: 3, newUsers: 2, oldUsers: 1 });
    expect(mysqlQuery.mock.calls[0][1]).toEqual(['2026-01-01', '2026-01-31']);
    expect(mysqlQuery.mock.calls[0][2]).toBe('chats');
  });

  it('/trend: unknown granularity falls back to day and is never interpolated', async () => {
    const r = await call<{ granularity: string }>(`/trend?from=2026-01-01&to=2026-01-31&granularity=${encodeURIComponent('day); DROP TABLE chats;--')}`);
    expect(r.body.granularity).toBe('day');
    expect(mysqlQuery.mock.calls[0][0]).not.toContain('DROP');
  });

  it('/mail-trend: month granularity + Date period formatting', async () => {
    mysqlQuery.mockResolvedValueOnce([{ period: new Date(2026, 0, 1), emails: 1, leads: 1 }]);
    const r = await call<{ points: { period: string }[] }>('/mail-trend?from=2026-01-01&to=2026-03-01&granularity=month');
    expect(r.body.points[0].period).toBe('2026-01-01');
    expect(mysqlQuery.mock.calls[0][0]).toContain('%Y-%m-01');
    expect(mysqlQuery.mock.calls[0][2]).toBe('primary');
  });
});

describe('department periods', () => {
  it('defaults to 7 weeks; one param block per period', async () => {
    const r = await call<{ unit: string; periods: unknown[] }>('/department-periods');
    expect(r.body.unit).toBe('week');
    expect(r.body.periods).toHaveLength(7);
    expect(mysqlQuery.mock.calls[0][1]).toHaveLength(7 * 11 + 2);
  });
  it('caps count per unit and maps row values', async () => {
    mysqlQuery.mockResolvedValueOnce([{ receiver: 'r', department: 'D', p0_chats: '3', p0_leads: 2, p0_new: 1, p0_old: 1 }]);
    const r = await call<{ periods: unknown[]; rows: { values: unknown[] }[] }>('/mail-department-periods?unit=day&count=999');
    expect(r.body.periods).toHaveLength(31);
    expect(r.body.rows[0].values[0]).toEqual({ chats: 3, leads: 2, newUsers: 1, oldUsers: 1 });
  });
  it('explicit month range', async () => {
    const r = await call<{ periods: { label: string }[] }>('/department-periods?unit=month&from=2025-11&to=2026-01');
    expect(r.body.periods.map(p => p.label)).toEqual(['Nov 2025', 'Dec 2025', 'Jan 2026']);
  });
  // BUG (src/routes/chatLeads.ts:207-227, 230-250): an invalid/reversed from/to range yields
  // zero periods and queryDepartmentPeriods dereferences periods[0] → TypeError → 500.
  // /registrations/periods already returns 400 for this case; these should too.
  it.fails('/department-periods with a reversed range → 400', async () => {
    const r = await call('/department-periods?unit=month&from=2026-05&to=2026-01');
    expect(r.status).toBe(400);
  });
  it.fails('/mail-department-periods with garbage week range → 400', async () => {
    const r = await call('/mail-department-periods?from=x&to=y');
    expect(r.status).toBe(400);
  });
});

describe('registrations', () => {
  it('summary/periods require a valid source', async () => {
    expect((await call('/registrations/summary?from=2026-01-01&to=2026-01-02')).status).toBe(400);
    expect((await call('/registrations/summary?source=users&from=2026-01-01&to=2026-01-02')).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  // BUG (src/routes/chatLeads.ts:271-277 and :353-355): the source whitelist is a plain object
  // lookup, so "__proto__" / "constructor" pass validation (Object.prototype members are truthy)
  // and get interpolated into SQL as table names ("[object Object]", "function Object()...").
  it.fails('rejects prototype keys as a registration source', async () => {
    expect((await call('/registrations/periods?source=__proto__')).status).toBe(400);
    expect((await call('/registrations?source=constructor')).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it('summary returns total for the selected source', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ guestuser: 4, agent: 1, affiliate: 2 }] }).mockResolvedValueOnce({ rows: [] });
    const r = await call('/registrations/summary?source=AGENT&from=2026-01-01&to=2026-01-31');
    expect(r.body).toMatchObject({ source: 'agent', total: 1 });
    expect(mockQuery.mock.calls[1][0]).toContain('agent_data');
  });
  it('periods: invalid range → 400; valid range builds bound params', async () => {
    expect((await call('/registrations/periods?source=agent&unit=month&from=2026-05&to=2026-01')).status).toBe(400);
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'a', p0: 1, p1: 2 }, { name: 'b', p0: 5, p1: 0 }] });
    const r = await call<{ rows: { name: string; total: number }[]; totals: number[] }>('/registrations/periods?source=affiliate&unit=month&from=2026-01&to=2026-02');
    expect(r.body.rows.map(x => x.name)).toEqual(['a', 'b']);
    expect(r.body.totals).toEqual([6, 2]);
    expect(mockQuery.mock.calls[0][1]).toHaveLength(6);
  });
  it('list: bad source / unknown filter field → 400', async () => {
    expect((await call('/registrations?source=bogus')).status).toBe(400);
    mockQuery.mockResolvedValueOnce({ rows: [{ table_name: 'agent_data', column_name: 'email' }] });
    expect((await call(`/registrations?field=${encodeURIComponent('email" OR 1=1 --')}&value=x`)).status).toBe(400);
  });
  it('list: search/field/value are bound, limit capped at 100, bad dates ignored', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ table_name: 'agent_data', column_name: 'id' }, { table_name: 'agent_data', column_name: 'email' }] })
      .mockResolvedValueOnce({ rows: [{ source: 'agent', record_id: '1', registration_date: null, data: {} }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ c0: true }] });
    const evil = "'; DROP TABLE agent_data;--";
    const r = await call<{ limit: number; total: number; columns: string[] }>(`/registrations?source=agent&limit=5000&search=${encodeURIComponent(evil)}&field=email&value=a&from=bad`);
    expect(r.body).toMatchObject({ limit: 100, total: 1, columns: ['email'] });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('bad');
    expect(params).toEqual([`%${evil}%`, 'email', '%a%', 100, 0]);
  });
});

describe('/first-msg', () => {
  it('requires from + to', async () => {
    expect((await call('/first-msg?from=971')).status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
  });
  it('combines ChatHead text with chat timestamps', async () => {
    outbound.mockResolvedValue(Response.json({ status: 'success', msg: 'Hi' }));
    mysqlQuery.mockResolvedValue([{ first_msg_at: new Date(2026, 0, 2, 3, 4, 5), last_msg_at: null, msgs: '4' }]);
    const r = await call('/first-msg?from=971&to=' + encodeURIComponent('&x=1'));
    expect(r.body).toMatchObject({ first_msg: 'Hi', first_msg_at: '2026-01-02 03:04:05', total_msgs: 4, found: true });
    expect(outbound.mock.calls[0][0]).toContain('to=%26x%3D1');
  });
  it('ChatHead + MySQL failures still → 200 found:false', async () => {
    mysqlQuery.mockRejectedValue(new Error('mysql'));
    const r = await call('/first-msg?from=1&to=2');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ found: false, first_msg: null, total_msgs: 0 });
  });
});

describe('/department-users', () => {
  it('requires receiver/from/to', async () => {
    expect((await call('/department-users?receiver=1&from=2026-01-01')).status).toBe(400);
  });
  it('pages with has_more and only_new params', async () => {
    mysqlQuery.mockResolvedValue([
      { wa_id: 'a', wa_name: 'A', first_at: null, is_new: 1 },
      { wa_id: 'b', wa_name: null, first_at: null, is_new: 0 },
    ]);
    outbound.mockResolvedValue(Response.json({ status: 'error' }));
    const r = await call<{ has_more: boolean; users: { is_new: boolean }[] }>('/department-users?receiver=r&from=2026-01-01&to=2026-01-02&limit=1&only_new=1');
    expect(r.body.has_more).toBe(true);
    expect(r.body.users).toHaveLength(1);
    expect(r.body.users[0].is_new).toBe(true);
    expect(mysqlQuery.mock.calls[0][1]).toHaveLength(9);
    expect(mysqlQuery.mock.calls[0][1]?.slice(-2)).toEqual([2, 0]);
  });
  // BUG (src/routes/chatLeads.ts:499): parseInt('-5') || 50 keeps -5, so the SQL gets
  // LIMIT -4. Expected the limit to be clamped to at least 1.
  it.fails('clamps a negative limit', async () => {
    await call('/department-users?receiver=r&from=2026-01-01&to=2026-01-02&limit=-5');
    expect(Number(mysqlQuery.mock.calls[0][1]?.at(-2))).toBeGreaterThanOrEqual(1);
  });
});

describe('departments & groups', () => {
  it('departments marks grouped receivers', async () => {
    mysqlQuery.mockResolvedValue([{ receiver: 1, name: 'Sales' }, { receiver: 2, name: '' }]);
    mockQuery.mockResolvedValue({ rows: [{ receiver: '1', group_id: 9, group_name: 'G' }] });
    const r = await call<{ departments: { assigned: boolean; name: string | null }[] }>('/departments');
    expect(r.body.departments.map(d => d.assigned)).toEqual([true, false]);
    expect(r.body.departments[1].name).toBeNull();
  });
  it('groups list nests members', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: 'G' }] }).mockResolvedValueOnce({ rows: [{ group_id: 1, receiver: 'r', department_name: null }] });
    const r = await call<{ groups: { departments: unknown[] }[] }>('/groups');
    expect(r.body.groups[0].departments).toEqual([{ receiver: 'r', name: null }]);
  });
  it('POST /groups: empty body / no departments → 400 and client released', async () => {
    expect((await call('/groups', 'POST')).status).toBe(400);
    expect((await call('/groups', 'POST', { name: '  ', departments: [{ receiver: 1 }] })).status).toBe(400);
    expect((await call('/groups', 'POST', { name: 'G', departments: 'x' })).status).toBe(400);
    expect(client.release).toHaveBeenCalledTimes(3);
    expect(client.query).not.toHaveBeenCalled();
  });
  it('POST /groups: already-taken department → 409, no transaction', async () => {
    client.query.mockResolvedValueOnce({ rows: [{ receiver: '1', group_name: 'Other' }] });
    const r = await call('/groups', 'POST', { name: 'G', departments: [{ receiver: 1 }] });
    expect(r.status).toBe(409);
    expect(client.query.mock.calls.some(c => c[0] === 'BEGIN')).toBe(false);
  });
  it('POST /groups: creates inside a transaction with bound params', async () => {
    client.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.startsWith('INSERT INTO department_groups') ? { rows: [{ id: 3, name: "G'; DROP" }] } : { rows: [] }));
    const r = await call('/groups', 'POST', { name: "G'; DROP", departments: [{ receiver: 1, name: 'S' }, { receiver: 2 }] });
    expect(r.status).toBe(200);
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls[1]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(client.query.mock.calls[3][1]).toEqual([3, '1', 'S']);
    expect(client.query.mock.calls[4][1]).toEqual([3, '2', null]);
  });
  it('POST /groups: unique violation → 409 with ROLLBACK', async () => {
    client.query.mockImplementation((sql: string) =>
      sql.startsWith('INSERT') ? Promise.reject(Object.assign(new Error('dup'), { code: '23505' })) : Promise.resolve({ rows: [] }));
    const r = await call('/groups', 'POST', { name: 'G', departments: [{ receiver: 1 }] });
    expect(r.status).toBe(409);
    expect(client.query.mock.calls.some(c => c[0] === 'ROLLBACK')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
  it('PUT /groups/:id: invalid id → 400; other errors → 500 + ROLLBACK', async () => {
    expect((await call('/groups/abc', 'PUT', { name: 'G' })).status).toBe(400);
    client.query.mockImplementation((sql: string) => sql.startsWith('UPDATE') ? Promise.reject(new Error('boom')) : Promise.resolve({ rows: [] }));
    expect((await call('/groups/4', 'PUT', { name: 'G', departments: [] })).status).toBe(500);
    expect(client.query.mock.calls.some(c => c[0] === 'ROLLBACK')).toBe(true);
  });
  it('PUT /groups/:id replaces members', async () => {
    const r = await call('/groups/4', 'PUT', { name: 'G', departments: [{ receiver: 7 }] });
    expect(r.status).toBe(200);
    expect(client.query.mock.calls.find(c => String(c[0]).startsWith('DELETE'))?.[1]).toEqual([4]);
  });
  it('DELETE /groups/:id', async () => {
    expect((await call('/groups/0', 'DELETE')).status).toBe(400);
    expect((await call('/groups/5', 'DELETE')).status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([5]);
    mockQuery.mockRejectedValue(new Error('x'));
    expect((await call('/groups/5', 'DELETE')).status).toBe(500);
  });
});
