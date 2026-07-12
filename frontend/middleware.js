import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/landing', '/rayna-logo.webp', '/favicon.ico', '/icon.svg', '/apple-icon.png'];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    PUBLIC_PATHS.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie (set by AuthContext on login)
  const hasAuth = request.cookies.get('rayna-auth');

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
