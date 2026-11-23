import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Request, Response as ExResponse, NextFunction } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';

// AuthService is fully mocked: no DB, no real secrets, no bcrypt/jwt work.
const m = vi.hoisted(() => ({
  login: vi.fn(), refresh: vi.fn(), logout: vi.fn(), getUserById: vi.fn(), verifyToken: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn() }));
vi.mock('../src/services/AuthService.js', () => ({ default: m }));

import authRouter from '../src/routes/auth.js';

type HttpErr = Error & { status?: number };
let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use((err: HttpErr, _req: Request, res: ExResponse, _next: NextFunction) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;
});
afterAll(() => { server.close(); });
beforeEach(() => { for (const f of Object.values(m)) f.mockReset(); });

const httpErr = (msg: string, status: number): HttpErr => Object.assign(new Error(msg), { status });
const post = (path: string, body?: unknown, raw?: string): Promise<Response> => fetch(`${base}${path}`, {
  method: 'POST',
  headers: body === undefined && raw === undefined ? {} : { 'content-type': 'application/json' },
  body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
});

describe('POST /login', () => {
  it('returns token + user on success', async () => {
    m.login.mockResolvedValue({ token: 't', refreshToken: 'r', user: { id: 1 } });
    const r = await post('/login', { email: 'a@x.com', password: 'pw' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, data: { token: 't', refreshToken: 'r', user: { id: 1 } } });
    expect(m.login).toHaveBeenCalledWith('a@x.com', 'pw');
  });
  it('forwards a 400 from the service when fields are missing (empty body)', async () => {
    m.login.mockRejectedValue(httpErr('Email and password are required', 400));
    for (const b of [{}, { email: 'a@x.com' }, { password: 'x' }]) {
      const r = await post('/login', b);
      expect(r.status).toBe(400);
    }
    expect(m.login).toHaveBeenCalledWith(undefined, undefined);
  });
  // FIXED (was BUG) auth.ts:14 — with no request body (Express 5 leaves req.body undefined) the
  // destructure `const { email, password } = req.body` throws a TypeError → 500 instead of 400.
  it('handles no body at all with a 400, not a 500', async () => {
    m.login.mockRejectedValue(httpErr('Email and password are required', 400));
    const r = await post('/login');
    expect(r.status).toBe(400);
  });
  it('rejects malformed JSON with 400 and never calls the service', async () => {
    const r = await post('/login', undefined, '{"email":');
    expect(r.status).toBe(400);
    expect(m.login).not.toHaveBeenCalled();
  });
  it('passes injection strings through verbatim (service parameterises)', async () => {
    m.login.mockRejectedValue(httpErr('Invalid email or password', 401));
    const inj = "' OR 1=1 --";
    const r = await post('/login', { email: inj, password: inj });
    expect(r.status).toBe(401);
    expect(m.login).toHaveBeenCalledWith(inj, inj);
  });
  it('does not validate types at the route: a numeric email reaches the service', async () => {
    m.login.mockResolvedValue({});
    await post('/login', { email: 123, password: ['x'] });
    expect(m.login).toHaveBeenCalledWith(123, ['x']);
  });
  it('500s on an unexpected service error', async () => {
    m.login.mockRejectedValue(new Error('boom'));
    expect((await post('/login', { email: 'a', password: 'b' })).status).toBe(500);
  });
});

describe('POST /refresh', () => {
  it('returns a new pair', async () => {
    m.refresh.mockResolvedValue({ token: 't2', refreshToken: 'r2', user: { id: 1 } });
    const r = await post('/refresh', { refreshToken: 'r1' });
    expect(r.status).toBe(200);
    expect((await r.json() as { data: { token: string } }).data.token).toBe('t2');
    expect(m.refresh).toHaveBeenCalledWith('r1');
  });
  it('passes undefined when the body is empty or missing', async () => {
    m.refresh.mockRejectedValue(httpErr('Refresh token required', 400));
    expect((await post('/refresh', {})).status).toBe(400);
    expect((await post('/refresh')).status).toBe(400);
    expect(m.refresh).toHaveBeenNthCalledWith(1, undefined);
    expect(m.refresh).toHaveBeenNthCalledWith(2, undefined);
  });
  it('forwards 401 for an invalid token', async () => {
    m.refresh.mockRejectedValue(httpErr('Invalid or expired refresh token', 401));
    expect((await post('/refresh', { refreshToken: 'nope' })).status).toBe(401);
  });
});

describe('POST /logout', () => {
  it('revokes the token and returns success', async () => {
    m.logout.mockResolvedValue(undefined);
    const r = await post('/logout', { refreshToken: 'r1' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true });
    expect(m.logout).toHaveBeenCalledWith('r1');
  });
  it('accepts no body', async () => {
    m.logout.mockResolvedValue(undefined);
    expect((await post('/logout')).status).toBe(200);
    expect(m.logout).toHaveBeenCalledWith(undefined);
  });
  it('a throwing service results in a 500 (Express 5 forwards the rejection)', async () => {
    m.logout.mockRejectedValue(new Error('db down'));
    expect((await post('/logout', { refreshToken: 'x' })).status).toBe(500);
  });
});

describe('GET /me', () => {
  it('401s without a bearer header', async () => {
    for (const h of [undefined, 'Basic abc', 'Bearer']) {
      const r = await fetch(`${base}/me`, { headers: h ? { authorization: h } : {} });
      expect(r.status, String(h)).toBe(401);
    }
    expect(m.getUserById).not.toHaveBeenCalled();
  });
  it('401s when the token does not verify', async () => {
    m.verifyToken.mockImplementation(() => { throw new Error('bad'); });
    const r = await fetch(`${base}/me`, { headers: { authorization: 'Bearer bad' } });
    expect(r.status).toBe(401);
  });
  it('returns the user for a valid token', async () => {
    m.verifyToken.mockReturnValue({ userId: 7, email: 'a@x.com', role: 'admin' });
    m.getUserById.mockResolvedValue({ id: 7, email: 'a@x.com', role: 'admin' });
    const r = await fetch(`${base}/me`, { headers: { authorization: 'Bearer good' } });
    expect(r.status).toBe(200);
    expect(m.getUserById).toHaveBeenCalledWith(7);
  });
  it('401s when the user no longer exists', async () => {
    m.verifyToken.mockReturnValue({ userId: 7 });
    m.getUserById.mockResolvedValue(null);
    expect((await fetch(`${base}/me`, { headers: { authorization: 'Bearer good' } })).status).toBe(401);
  });
  it('500s when the lookup throws', async () => {
    m.verifyToken.mockReturnValue({ userId: 7 });
    m.getUserById.mockRejectedValue(new Error('x'));
    expect((await fetch(`${base}/me`, { headers: { authorization: 'Bearer good' } })).status).toBe(500);
  });
});
