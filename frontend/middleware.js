import { NextResponse } from 'next/server';
import { LEADS_ACCESS_COOKIE, readLeadsAccessCookie } from './lib/leadsAccess';

const PUBLIC_PATHS = ['/', '/login', '/landing', '/leads', '/leads-access', '/rayna-logo.webp', '/favicon.ico', '/icon.svg', '/apple-icon.png'];

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  // Auth cookie, set by AuthContext on login
  const hasAuth = request.cookies.get('rayna-auth');

  // Users signed in through /login don't need the leads access token.
  if (hasAuth && pathname === '/leads-access') {
    const next = request.nextUrl.searchParams.get('next');
    return NextResponse.redirect(new URL(next?.startsWith('/leads') ? next : '/leads', request.url));
  }

  // Public (not signed-in) visitors need the access token to open the leads page.
  if (!hasAuth && (pathname === '/leads' || pathname.startsWith('/leads/'))) {
    const expectedToken = process.env.LEADS_ACCESS_TOKEN || 'RAYNA-DATA-321';
    const access = await readLeadsAccessCookie(request.cookies.get(LEADS_ACCESS_COOKIE)?.value, expectedToken);
    if (!access) {
      const accessUrl = new URL('/leads-access', request.url);
      accessUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(accessUrl);
    }
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    PUBLIC_PATHS.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))
  ) {
    return NextResponse.next();
  }

  // Authenticated users hitting landing page → redirect to dashboard
  if (hasAuth && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (!hasAuth) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|rayna-logo.webp).*)'],
};
