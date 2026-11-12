import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { apiAuthGate, requireAuth, requireRole } from '../src/middleware/auth.js';

const SECRET = process.env.JWT_SECRET!;
type Mw = (req: Request, res: Response, next: NextFunction) => unknown;

function run(mw: Mw, { method = 'GET', path = '/', auth, user }: { method?: string; path?: string; auth?: string; user?: { role: string } } = {}) {
  const req = { method, path, headers: auth === undefined ? {} : { authorization: auth }, user };
  const res = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  mw(req as unknown as Request, res as unknown as Response, next);
  return { req, res, next };
}
const access = (extra: Record<string, unknown> = {}) => jwt.sign({ type: 'access', userId: 1, role: 'admin', ...extra }, SECRET, { expiresIn: '5m' });

describe('requireAuth edge cases', () => {
  it.each([
    ['empty header', ''],
    ['scheme only', 'Bearer'],
    ['scheme + space, no token', 'Bearer '],
    ['lowercase scheme', `bearer ${access()}`],
    ['Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['garbage token', 'Bearer not.a.jwt'],
    ['token with injection chars', "Bearer ' OR 1=1 --"],
  ])('401s on %s', (_l, auth) => {
    const { res, next } = run(requireAuth, { path: '/x', auth });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('401s an expired token', () => {
    const t = jwt.sign({ type: 'access', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET);
    expect(run(requireAuth, { auth: `Bearer ${t}` }).res.statusCode).toBe(401);
  });

  it('401s an HS512 token even with the right secret (algorithm pinned)', () => {
    const t = jwt.sign({ type: 'access' }, SECRET, { algorithm: 'HS512' });
    expect(run(requireAuth, { auth: `Bearer ${t}` }).res.statusCode).toBe(401);
  });

  it('accepts a token without a type claim (legacy) — documents current behaviour', () => {
    const t = jwt.sign({ userId: 3 }, SECRET, { expiresIn: '5m' });
    expect(run(requireAuth, { auth: `Bearer ${t}` }).next).toHaveBeenCalled();
  });
});

describe('apiAuthGate edge cases', () => {
  it('lets OPTIONS preflight through on any path', () => {
    expect(run(apiAuthGate, { method: 'OPTIONS', path: '/v3/journeys' }).next).toHaveBeenCalled();
  });

  it('treats HEAD like GET for public routes', () => {
    expect(run(apiAuthGate, { method: 'HEAD', path: '/health' }).next).toHaveBeenCalled();
  });

  it('enforces method on method-specific public routes', () => {
    expect(run(apiAuthGate, { method: 'GET', path: '/auth/login' }).res.statusCode).toBe(401);
    expect(run(apiAuthGate, { method: 'DELETE', path: '/v3/gtm/events' }).res.statusCode).toBe(401);
    expect(run(apiAuthGate, { method: 'POST', path: '/v3/chat-leads/summary' }).res.statusCode).toBe(401);
  });

  it('anchors public route regexes', () => {
    for (const path of ['/healthz', '/x/health', '/unsubscribed-list', '/auth/login/extra', '/v3/utm/track/a/b', '/v3/gupshup/webhook/rcs']) {
      const method = path.startsWith('/auth') || path.includes('gupshup') ? 'POST' : 'GET';
      expect(run(apiAuthGate, { method, path }).res.statusCode, path).toBe(401);
    }
  });

  it('allows any method on /unsubscribe and /webhooks', () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      expect(run(apiAuthGate, { method, path: '/unsubscribe/confirm' }).next).toHaveBeenCalled();
      expect(run(apiAuthGate, { method, path: '/webhooks/anything' }).next).toHaveBeenCalled();
    }
  });

  it('allows chat-leads group edits by id but not nested paths', () => {
    expect(run(apiAuthGate, { method: 'PUT', path: '/v3/chat-leads/groups/12' }).next).toHaveBeenCalled();
    expect(run(apiAuthGate, { method: 'PUT', path: '/v3/chat-leads/groups/12/members' }).res.statusCode).toBe(401);
  });

  it('protected route + valid token passes', () => {
    expect(run(apiAuthGate, { method: 'DELETE', path: '/v3/journeys/1', auth: `Bearer ${access()}` }).next).toHaveBeenCalled();
  });
});

describe('requireRole edge cases', () => {
  it('401s when no user is attached', () => {
    expect(run(requireRole('admin')).res.statusCode).toBe(401);
  });
  it('accepts any of several roles', () => {
    expect(run(requireRole('admin', 'editor'), { user: { role: 'editor' } }).next).toHaveBeenCalled();
  });
  it('is case-sensitive and denies with no roles configured', () => {
    expect(run(requireRole('admin'), { user: { role: 'Admin' } }).res.statusCode).toBe(403);
    expect(run(requireRole(), { user: { role: 'admin' } }).res.statusCode).toBe(403);
  });
});
