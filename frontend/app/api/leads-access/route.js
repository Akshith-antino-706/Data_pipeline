import { NextResponse } from 'next/server';
import { LEADS_ACCESS_COOKIE, createLeadsAccessCookie, readLeadsAccessCookie } from '@/lib/leadsAccess';

const ACCESS_DURATION_MS = 30 * 60 * 1000;

export async function GET(request) {
  const expectedToken = process.env.LEADS_ACCESS_TOKEN || 'RAYNA-DATA-321';
  const access = await readLeadsAccessCookie(request.cookies.get(LEADS_ACCESS_COOKIE)?.value, expectedToken);
  if (!access) return NextResponse.json({ valid: false }, { status: 401 });
  return NextResponse.json({ valid: true, expiresAt: access.expiresAt });
}

export async function POST(request) {
  let submittedToken = '';
  try {
    const body = await request.json();
    submittedToken = String(body?.token || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const expectedToken = process.env.LEADS_ACCESS_TOKEN || 'RAYNA-DATA-321';
  if (!submittedToken || submittedToken !== expectedToken) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 401 });
  }

  const expiresAt = Date.now() + ACCESS_DURATION_MS;
  const response = NextResponse.json({ success: true, expiresAt });
  response.cookies.set({
    name: LEADS_ACCESS_COOKIE,
    value: await createLeadsAccessCookie(expectedToken, expiresAt),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACCESS_DURATION_MS / 1000,
  });
  return response;
}
