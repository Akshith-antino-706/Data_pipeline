import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import crypto from 'node:crypto';

// No real database: every query goes to this mock.
const { mockQuery, mockConnect } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockConnect: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ default: { query: mockQuery, connect: mockConnect }, query: mockQuery }));

import unsubscribeRouter, { signUnsubToken } from '../src/routes/unsubscribe.js';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use('/api/unsubscribe', unsubscribeRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/unsubscribe`;
});
afterAll(() => { server.close(); });

interface ContactRow { id: string; email: string | null; email_unsubscribe: string | null }
function contactLookupReturns(row: ContactRow | undefined): void {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes('FROM unified_contacts WHERE id')) return Promise.resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}
const get = (qs: string): Promise<Response> => fetch(`${base}?${qs}`);
const q = (t: string): string => `t=${encodeURIComponent(t)}`;

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  contactLookupReturns({ id: 'u-1', email: 'a@example.com', email_unsubscribe: 'No' });
});

describe('verifyUnsubToken (via GET /unsubscribe?t=)', () => {
  it('accepts a valid signed token and looks up that uid', async () => {
    const r = await get(q(signUnsubToken('u-1')));
    expect(r.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM unified_contacts'), ['u-1']);
  });

  it('accepts numeric uids', async () => {
    const r = await get(q(signUnsubToken(42)));
    expect(r.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['42']);
  });

  it('rejects a token whose payload was swapped for another uid', async () => {
    const sig = signUnsubToken('u-1').split('.')[1];
    const forged = `${Buffer.from('u-2').toString('base64url')}.${sig}`;
    const r = await get(q(forged));
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a token with a tampered signature of the same length', async () => {
    const [p, s] = signUnsubToken('u-1').split('.');
    const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const r = await get(q(`${p}.${flipped}`));
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects (400, not 500) a signature of a different length', async () => {
    const [p, s] = signUnsubToken('u-1').split('.');
    for (const sig of [s.slice(0, 5), `${s}xx`, 'x'.repeat(500)]) {
      const r = await get(q(`${p}.${sig}`));
      expect(r.status, sig).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an empty signature', async () => {
    const [p] = signUnsubToken('u-1').split('.');
    expect((await get(q(`${p}.`))).status).toBe(400);
  });

  it('rejects tokens with missing parts', async () => {
    for (const t of ['', '.', 'nodot', `.${signUnsubToken('u-1').split('.')[1]}`]) {
      const r = await get(q(t));
      expect(r.status, JSON.stringify(t)).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a token signed with another secret', async () => {
    const payload = Buffer.from('u-1').toString('base64url');
    const sig = crypto.createHmac('sha256', 'wrong-secret').update('u-1').digest('base64url');
    expect((await get(q(`${payload}.${sig}`))).status).toBe(400);
  });

  it('rejects a repeated t= param (array) without crashing', async () => {
    const t = encodeURIComponent(signUnsubToken('u-1'));
    const r = await get(`t=${t}&t=${t}`);
    expect(r.status).toBeLessThan(500);
  });

  it('returns 400 when the uid is valid but the contact does not exist', async () => {
    contactLookupReturns(undefined);
    expect((await get(q(signUnsubToken('ghost')))).status).toBe(400);
  });
});

describe('GET /unsubscribe ?log= validation', () => {
  it('returns 400 with no params and never queries', async () => {
    expect((await fetch(base)).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ignores non-numeric / injection log ids', async () => {
    for (const log of ['1 OR 1=1', "1'; DROP TABLE unified_contacts;--", '-1', '1.5', 'abc']) {
      const r = await get(`log=${encodeURIComponent(log)}`);
      expect(r.status, log).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves a numeric log id via a parameterised query', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM email_send_log')) return Promise.resolve({ rows: [{ unified_id: 'u-1', email: 'a@example.com', journey_id: 1, node_id: 'n1' }] });
      return Promise.resolve({ rows: [{ id: 'u-1', email: 'a@example.com', email_unsubscribe: null }] });
    });
    const r = await get('log=123');
    expect(r.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([123]);
  });

  it('escapes HTML in the stored email', async () => {
    contactLookupReturns({ id: 'u-1', email: '<script>alert(1)</script>@x.com', email_unsubscribe: 'No' });
    const html = await (await get(q(signUnsubToken('u-1')))).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows "already unsubscribed" for opted-out contacts', async () => {
    contactLookupReturns({ id: 'u-1', email: 'a@example.com', email_unsubscribe: 'YES' });
    expect(await (await get(q(signUnsubToken('u-1')))).text()).toContain('already unsubscribed');
  });

  it('returns 500 page (not a crash) when the DB errors', async () => {
    mockQuery.mockRejectedValue(new Error('boom'));
    expect((await get(q(signUnsubToken('u-1')))).status).toBe(500);
  });
});

describe('POST /unsubscribe/confirm', () => {
  it('400s an invalid token and performs no UPDATE', async () => {
    const r = await fetch(`${base}/confirm?t=bad.token`, { method: 'POST' });
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('opts out a subscribed contact via parameterised UPDATE', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [{ id: 'u-1', email: 'a@example.com', email_unsubscribe: 'No' }] });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const r = await fetch(`${base}/confirm?${q(signUnsubToken('u-1'))}`, { method: 'POST' });
    expect(r.status).toBe(200);
    const update = mockQuery.mock.calls.find(c => String(c[0]).includes('UPDATE unified_contacts'));
    expect(update?.[1]).toEqual(['u-1']);
  });

  it('does not UPDATE an already-unsubscribed contact', async () => {
    contactLookupReturns({ id: 'u-1', email: 'a@example.com', email_unsubscribe: 'yes' });
    await fetch(`${base}/confirm?${q(signUnsubToken('u-1'))}`, { method: 'POST' });
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('UPDATE'))).toBe(false);
  });
});

describe('POST /unsubscribe/change-email validation', () => {
  const post = (body: string, t = signUnsubToken('u-1')): Promise<Response> =>
    fetch(`${base}/change-email?${q(t)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });

  it('400s an invalid token before reading the body', async () => {
    expect((await post('email=new%40example.com', 'x.y')).status).toBe(400);
  });

  it('400s empty body / malformed emails and never opens a transaction', async () => {
    for (const body of ['', 'email=', 'email=notanemail', 'email=a%40b', 'email=a%20b%40c.com', "email=x'%20OR%201%3D1--%40a.com%20"]) {
      const r = await post(body);
      expect(r.status, body).toBe(400);
    }
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('treats the same email (different case/whitespace) as no change', async () => {
    const r = await post('email=%20A%40Example.com%20');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('No change needed');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('409s when the new email belongs to another contact', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('id <> $2')) return Promise.resolve({ rows: [{ id: 'u-9' }] });
      return Promise.resolve({ rows: [{ id: 'u-1', email: 'a@example.com', email_unsubscribe: 'No' }] });
    });
    expect((await post('email=b%40example.com')).status).toBe(409);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('commits the change in a transaction', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const release = vi.fn();
    mockConnect.mockResolvedValue({ query: clientQuery, release });
    const r = await post('email=New%40Example.com');
    expect(r.status).toBe(200);
    expect(clientQuery.mock.calls.map(c => String(c[0]).trim().split(/\s/)[0])).toEqual(['BEGIN', 'UPDATE', 'INSERT', 'COMMIT']);
    expect(clientQuery.mock.calls[1][1]).toEqual(['new@example.com', 'u-1']);
    expect(release).toHaveBeenCalled();
  });

  it('rolls back and releases on a transaction error', async () => {
    const clientQuery = vi.fn((sql: string) => sql.startsWith('INSERT') ? Promise.reject(new Error('fail')) : Promise.resolve({ rows: [], rowCount: 1 }));
    const release = vi.fn();
    mockConnect.mockResolvedValue({ query: clientQuery, release });
    expect((await post('email=new%40example.com')).status).toBe(500);
    expect(clientQuery.mock.calls.map(c => c[0])).toContain('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });
});
