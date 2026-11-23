import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { Request, Response, RequestHandler } from 'express';
import type { AuthUser } from '../src/types/express.js';
import { apiAuthGate, requireRole } from '../src/middleware/auth.js';
import AuthService from '../src/services/AuthService.js';

const SECRET = process.env.JWT_SECRET;

// Minimal Express req/res doubles — no HTTP server, no database.
interface RunOptions {
  method?: string;
  path?: string;
  auth?: string;
  user?: Partial<AuthUser>;
}

function run(mw: RequestHandler, { method = 'GET', path = '/', auth, user }: RunOptions = {}) {
  const req = { method, path, headers: auth ? { authorization: auth } : {}, user };
  const res = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  mw(req as unknown as Request, res as unknown as Response, next);
  return { req, res, next };
}
const token = (payload: Record<string, unknown>, opts: SignOptions = {}) => jwt.sign({ type: 'access', role: 'admin', ...payload }, SECRET!, { expiresIn: '5m', ...opts });

describe('apiAuthGate (S-B1)', () => {
  it('blocks a protected route without a token', () => {
    const { res, next } = run(apiAuthGate, { path: '/v3/unified-contacts' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('lets public routes through without a token', () => {
    for (const [method, path] of [
      ['POST', '/auth/login'], ['GET', '/health'], ['GET', '/track/open/abc'],
      ['POST', '/v3/gtm/events'], ['POST', '/webhooks/ses'], ['GET', '/unsubscribe'],
    ]) {
      const { next } = run(apiAuthGate, { method, path });
      expect(next, `${method} ${path}`).toHaveBeenCalled();
    }
  });

  it('does not treat a public prefix as a wildcard', () => {
    const { res } = run(apiAuthGate, { method: 'POST', path: '/v3/gtm/events/delete-all' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid access token and sets req.user', () => {
    const { req, next } = run(apiAuthGate, { path: '/v3/journeys', auth: `Bearer ${token({ userId: 7 })}` });
    expect(next).toHaveBeenCalled();
    expect(req.user!.userId).toBe(7);
  });

  it('rejects a token signed with another secret', () => {
    const bad = jwt.sign({ type: 'access' }, 'some-other-secret');
    const { res } = run(apiAuthGate, { path: '/v3/journeys', auth: `Bearer ${bad}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('AuthService.verifyToken hardening (S-B16)', () => {
  it('rejects unsigned alg:none tokens', () => {
    const none = jwt.sign({ type: 'access' }, '', { algorithm: 'none' });
    expect(() => AuthService.verifyToken(none)).toThrow();
  });

  it('rejects a non-access token type', () => {
    expect(() => AuthService.verifyToken(token({ type: 'refresh' }))).toThrow();
  });
});

describe('requireRole', () => {
  it('403s a logged-in user without the role', () => {
    const { res, next } = run(requireRole('admin'), { user: { role: 'viewer' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
  it('allows the role', () => {
    const { next } = run(requireRole('admin'), { user: { role: 'admin' } });
    expect(next).toHaveBeenCalled();
  });
});
