import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

type Result = { rows: unknown[]; rowCount?: number };
const m = vi.hoisted(() => ({
  query: vi.fn<(sql: string, params?: unknown[]) => Promise<Result>>(async () => ({ rows: [] })),
}));
vi.mock('../src/config/database.js', () => ({ default: { query: m.query }, query: m.query, transaction: vi.fn() }));
vi.mock('../src/config/mysql.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/config/cache.js', () => ({ cached: vi.fn(), invalidate: vi.fn() }));

import AuthService from '../src/services/AuthService.js';

const SECRET = process.env.JWT_SECRET as string;
const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
const HASH = bcrypt.hashSync('Correct-Horse-1', 4);
const userRow = { id: 7, email: 'ops@example.com', password_hash: HASH, name: 'Ops', role: 'admin' };

interface Claims { userId: number | null; email: string | null; role: string; type: string; service?: string; iat: number; exp: number }
const decode = (t: string): Claims => jwt.verify(t, SECRET) as Claims;

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue({ rows: [] });
});

describe('AuthService.login', () => {
  it('rejects missing email/password with 400 and never queries', async () => {
    await expect(AuthService.login('', 'x')).rejects.toMatchObject({ status: 400 });
    await expect(AuthService.login('a@b.c', '')).rejects.toMatchObject({ status: 400 });
    expect(m.query).not.toHaveBeenCalled();
  });

  it('normalises the email (lower + trim) and only selects active users', async () => {
    await expect(AuthService.login('  OPS@Example.COM ', 'x')).rejects.toMatchObject({ status: 401 });
    const [sql, params] = m.query.mock.calls[0]!;
    expect(sql).toContain('is_active = true');
    expect(params).toEqual(['ops@example.com']);
  });

  it('wrong password gives the same 401 message as unknown user', async () => {
    m.query.mockResolvedValueOnce({ rows: [userRow] });
    const err = await AuthService.login('ops@example.com', 'wrong').catch((e: Error & { status?: number }) => e);
    expect(err).toMatchObject({ status: 401, message: 'Invalid email or password' });
    expect(m.query).toHaveBeenCalledTimes(1);
  });

  it('valid login returns an access token with role + type claims and a hashed refresh token', async () => {
    m.query.mockResolvedValueOnce({ rows: [userRow] });
    const out = await AuthService.login('ops@example.com', 'Correct-Horse-1');
    const c = decode(out.token);
    expect(c).toMatchObject({ userId: 7, email: 'ops@example.com', role: 'admin', type: 'access' });
    expect(c.exp - c.iat).toBe(86400);
    expect(out.user).toEqual({ id: 7, email: 'ops@example.com', name: 'Ops', role: 'admin' });
    expect(out.refreshToken).toMatch(/^[0-9a-f]{80}$/);
    const [sql, params] = m.query.mock.calls[1]!;
    expect(sql).toContain('INSERT INTO auth_refresh_tokens');
    expect(params![0]).toBe(7);
    expect(params![1]).toBe(sha(out.refreshToken));
    expect(params![1]).not.toBe(out.refreshToken);
    const days = ((params![2] as Date).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('the stored bcrypt hash verifies only the right password', async () => {
    expect(await bcrypt.compare('Correct-Horse-1', HASH)).toBe(true);
    expect(await bcrypt.compare('correct-horse-1', HASH)).toBe(false);
  });
});

describe('AuthService.refresh', () => {
  const rec = { id: 3, user_id: 7, expires_at: new Date(Date.now() + 86400000), revoked: false, email: 'ops@example.com', name: 'Ops', role: 'viewer', is_active: true };

  it('requires a token (400)', async () => {
    await expect(AuthService.refresh('')).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['unknown', null],
    ['revoked', { ...rec, revoked: true }],
    ['inactive user', { ...rec, is_active: false }],
    ['expired', { ...rec, expires_at: new Date(Date.now() - 1000) }],
  ])('rejects %s refresh token with 401 and does not rotate', async (_l, row) => {
    m.query.mockResolvedValueOnce({ rows: row ? [row] : [] });
    await expect(AuthService.refresh('raw-token')).rejects.toMatchObject({ status: 401 });
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(m.query.mock.calls[0]![1]).toEqual([sha('raw-token')]);
  });

  it('rotates: revokes the used token, issues a new one, keeps the role claim', async () => {
    m.query.mockResolvedValueOnce({ rows: [rec] });
    const out = await AuthService.refresh('raw-token');
    expect(m.query.mock.calls[1]).toEqual(['UPDATE auth_refresh_tokens SET revoked = true WHERE id = $1', [3]]);
    expect(m.query.mock.calls[2]![0]).toContain('INSERT INTO auth_refresh_tokens');
    expect(out.refreshToken).not.toBe('raw-token');
    expect(decode(out.token)).toMatchObject({ userId: 7, role: 'viewer', type: 'access' });
  });
});

describe('AuthService.verifyToken / signServiceToken / logout', () => {
  it('verifies a token it issued', () => {
    const t = AuthService._signAccessToken({ id: 1, email: 'a@b.c', role: 'admin' });
    expect(AuthService.verifyToken(t)).toMatchObject({ userId: 1, role: 'admin', type: 'access' });
  });

  it('rejects wrong secret, expired, wrong type, alg none and garbage with 401', () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      jwt.sign({ userId: 1, role: 'admin', type: 'access' }, 'other-secret'),
      jwt.sign({ userId: 1, role: 'admin', type: 'access', exp: now - 10 }, SECRET),
      jwt.sign({ userId: 1, role: 'admin', type: 'refresh' }, SECRET),
      jwt.sign({ userId: 1, role: 'admin', type: 'access' }, SECRET, { algorithm: 'HS512' }),
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"role":"admin"}').toString('base64url')}.`,
      'not-a-jwt',
    ];
    for (const t of bad) {
      let caught: unknown = null;
      try { AuthService.verifyToken(t); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ status: 401, message: 'Invalid or expired token' });
    }
  });

  it('service token carries role=system, the service name and a 30 minute expiry', () => {
    const c = decode(AuthService.signServiceToken('scheduler'));
    expect(c).toMatchObject({ userId: null, role: 'system', service: 'scheduler', type: 'access' });
    expect(c.exp - c.iat).toBe(1800);
  });

  it('logout revokes by hash, is a no-op without a token and never throws', async () => {
    await AuthService.logout(undefined);
    expect(m.query).not.toHaveBeenCalled();
    m.query.mockRejectedValueOnce(new Error('db down'));
    await expect(AuthService.logout('tok')).resolves.toBeUndefined();
    expect(m.query.mock.calls[0]![1]).toEqual([sha('tok')]);
  });

  it('getUserById returns null when missing', async () => {
    expect(await AuthService.getUserById(99)).toBeNull();
    expect(m.query.mock.calls[0]![1]).toEqual([99]);
  });
});
