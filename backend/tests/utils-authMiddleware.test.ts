import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from '../src/types/express.js';

const { verifyToken } = vi.hoisted(() => ({ verifyToken: vi.fn() }));
vi.mock('../src/services/AuthService.js', () => ({ default: { verifyToken } }));

import { requireAuth, apiAuthGate, requireRole } from '../src/middleware/auth.js';

interface FakeRes { statusCode: number; body: unknown; status(c: number): FakeRes; json(b: unknown): FakeRes }
function call(mw: (req: Request, res: Response, next: NextFunction) => unknown, req: Partial<Request> & { headers?: Record<string, string> }) {
  const res: FakeRes = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const next = vi.fn();
  const fullReq = { method: 'GET', path: '/', headers: {}, ...req };
  mw(fullReq as unknown as Request, res as unknown as Response, next as NextFunction);
  return { req: fullReq as unknown as Request, res, next };
}

beforeEach(() => { verifyToken.mockReset(); });

describe('requireAuth', () => {
  it.each([undefined, '', 'Bearer', 'bearer abc', 'Basic abc', 'Token abc'])('rejects header %j with 401', (h) => {
    const { res, next } = call(requireAuth, { headers: h === undefined ? {} : { authorization: h } });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('passes the token after "Bearer " and sets req.user', () => {
    const user: AuthUser = { userId: 1, email: 'a@b.c', role: 'admin' } as AuthUser;
    verifyToken.mockReturnValueOnce(user);
    const { req, next } = call(requireAuth, { headers: { authorization: 'Bearer tok.en' } });
    expect(verifyToken).toHaveBeenCalledWith('tok.en');
    expect(req.user).toBe(user);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('"Bearer " with empty token still goes to verify, which fails -> 401', () => {
    verifyToken.mockImplementationOnce(() => { throw new Error('bad'); });
    const { res, next } = call(requireAuth, { headers: { authorization: 'Bearer ' } });
    expect(verifyToken).toHaveBeenCalledWith('');
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('apiAuthGate', () => {
  it('OPTIONS always passes', () => {
    expect(call(apiAuthGate, { method: 'OPTIONS', path: '/v3/anything' }).next).toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['HEAD', '/health'], ['POST', '/auth/refresh'], ['DELETE', '/unsubscribe'], ['PUT', '/unsubscribe/abc'],
    ['GET', '/v3/utm/track/xyz'], ['POST', '/v3/gupshup/webhook/sms'], ['GET', '/v3/chat-leads/registrations/periods'],
    ['DELETE', '/v3/chat-leads/groups/5'],
  ])('public %s %s', (method, path) => {
    const { next } = call(apiAuthGate, { method, path });
    expect(next).toHaveBeenCalled();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['GET', '/auth/login'], ['POST', '/health'], ['GET', '/unsubscribed'], ['GET', '/v3/utm/track/a/b'],
    ['POST', '/v3/gupshup/webhook/email'], ['GET', '/v3/chat-leads/groups/5'], ['GET', '/health/'], ['POST', '/track/x'],
  ])('protected %s %s -> 401 without token', (method, path) => {
    const { res, next } = call(apiAuthGate, { method, path });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('401 without user, 403 wrong role, next() on match', () => {
    const mw = requireRole('admin', 'editor');
    expect(call(mw, {}).res.statusCode).toBe(401);
    const forbidden = call(mw, { user: { role: 'viewer' } as AuthUser });
    expect(forbidden.res.statusCode).toBe(403);
    expect(forbidden.res.body).toEqual({ success: false, error: 'Insufficient permissions' });
    expect(call(mw, { user: { role: 'editor' } as AuthUser }).next).toHaveBeenCalled();
  });
  it('role match is case-sensitive; no roles = nobody', () => {
    expect(call(requireRole('admin'), { user: { role: 'ADMIN' } as AuthUser }).res.statusCode).toBe(403);
    expect(call(requireRole(), { user: { role: 'admin' } as AuthUser }).res.statusCode).toBe(403);
  });
});
