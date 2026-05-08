import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/landing', '/rayna-logo.webp', '/favicon.ico'];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public routes and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie (set by AuthContext on login)
  const hasAuth = request.cookies.get('rayna-auth');

  if (!hasAuth) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|rayna-logo.webp).*)'],
};
