import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, config } from '@/middleware';
import { LEADS_ACCESS_COOKIE, createLeadsAccessCookie } from '@/lib/leadsAccess';

const ORIGIN = 'http://app.test';
const DEFAULT_TOKEN = 'RAYNA-DATA-321';

function req(path: string, cookies: Record<string, string> = {}): NextRequest {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return new NextRequest(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
}
const location = (res: Response): string | null => res.headers.get('location');
const isNext = (res: Response): boolean => res.headers.get('x-middleware-next') === '1';

let savedToken: string | undefined;
beforeEach(() => { savedToken = process.env.LEADS_ACCESS_TOKEN; delete process.env.LEADS_ACCESS_TOKEN; });
afterEach(() => { if (savedToken === undefined) delete process.env.LEADS_ACCESS_TOKEN; else process.env.LEADS_ACCESS_TOKEN = savedToken; });

describe('middleware: auth gate', () => {
  it('lets public paths, assets, /_next and /api through without auth', async () => {
    for (const p of ['/', '/login', '/landing', '/landing/x', '/favicon.ico', '/_next/static/a.js', '/api/anything', '/leads-access']) {
      expect(isNext(await middleware(req(p))), p).toBe(true);
    }
  });

  it('redirects unauthenticated dashboard routes to /login', async () => {
    for (const p of ['/dashboard', '/contacts/12', '/loginx', '/landingpage']) {
      const res = await middleware(req(p));
      expect(location(res), p).toBe(`${ORIGIN}/login`);
    }
  });

  it('any non-empty rayna-auth cookie counts as signed in (presence only)', async () => {
    expect(isNext(await middleware(req('/dashboard', { 'rayna-auth': '1' })))).toBe(true);
    expect(isNext(await middleware(req('/dashboard', { 'rayna-auth': 'tampered' })))).toBe(true);
  });

  it.fails('BUG middleware.ts:34-41 - signed-in user on "/" is never redirected to /dashboard (public-path early return wins)', async () => {
    const res = await middleware(req('/', { 'rayna-auth': '1' }));
    expect(location(res)).toBe(`${ORIGIN}/dashboard`);
  });
});

describe('middleware: leads access', () => {
  it('signed-in user on /leads-access is sent to a safe next or /leads', async () => {
    const auth = { 'rayna-auth': '1' };
    expect(location(await middleware(req('/leads-access?next=/leads/x', auth)))).toBe(`${ORIGIN}/leads/x`);
    expect(location(await middleware(req('/leads-access', auth)))).toBe(`${ORIGIN}/leads`);
    expect(location(await middleware(req('/leads-access?next=https://evil.com', auth)))).toBe(`${ORIGIN}/leads`);
    expect(location(await middleware(req('/leads-access?next=/dashboard', auth)))).toBe(`${ORIGIN}/leads`);
  });

  it('open-redirect check: next=/leads.evil.com style values stay on the same origin', async () => {
    const res = await middleware(req('/leads-access?next=/leads@evil.com', { 'rayna-auth': '1' }));
    expect(new URL(location(res) ?? '').origin).toBe(ORIGIN);
  });

  it('public /leads without cookie redirects to /leads-access with next preserved', async () => {
    const res = await middleware(req('/leads/abc?x=1'));
    const url = new URL(location(res) ?? '');
    expect(url.pathname).toBe('/leads-access');
    expect(url.searchParams.get('next')).toBe('/leads/abc?x=1');
  });

  it('accepts a valid cookie, rejects tampered / expired / wrong-token cookies', async () => {
    const exp = Date.now() + 60_000;
    const good = await createLeadsAccessCookie(DEFAULT_TOKEN, exp);
    expect(isNext(await middleware(req('/leads', { [LEADS_ACCESS_COOKIE]: good })))).toBe(true);

    const bad = [
      good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'),
      await createLeadsAccessCookie(DEFAULT_TOKEN, Date.now() - 1000),
      await createLeadsAccessCookie('other', exp),
      'garbage', '',
    ];
    for (const v of bad) {
      const res = await middleware(req('/leads', { [LEADS_ACCESS_COOKIE]: v }));
      expect(new URL(location(res) ?? '').pathname).toBe('/leads-access');
    }
  });

  it('honours LEADS_ACCESS_TOKEN from env', async () => {
    process.env.LEADS_ACCESS_TOKEN = 'custom';
    const exp = Date.now() + 60_000;
    expect(isNext(await middleware(req('/leads', { [LEADS_ACCESS_COOKIE]: await createLeadsAccessCookie('custom', exp) })))).toBe(true);
    const res = await middleware(req('/leads', { [LEADS_ACCESS_COOKIE]: await createLeadsAccessCookie(DEFAULT_TOKEN, exp) }));
    expect(location(res)).toContain('/leads-access');
  });

  it('/leadsx is not treated as a leads path (goes to login)', async () => {
    expect(location(await middleware(req('/leadsx')))).toBe(`${ORIGIN}/login`);
  });
});

describe('middleware config', () => {
  it('matcher excludes static assets', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/dashboard')).toBe(true);
    expect(re.test('/_next/static/x.js')).toBe(false);
    expect(re.test('/favicon.ico')).toBe(false);
  });
});
