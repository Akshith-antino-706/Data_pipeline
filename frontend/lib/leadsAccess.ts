export const LEADS_ACCESS_COOKIE = 'rayna-leads-access';

/**
 * Pages a visitor can open with the access token instead of a login (read-only, no sidebar).
 * One token and one cookie cover all of them. Keep in sync with the backend's PUBLIC_API_ROUTES.
 */
export const TOKEN_ACCESS_PAGES = ['/leads', '/journeys/analytics'];

export function isTokenAccessPage(pathname: string): boolean {
  return TOKEN_ACCESS_PAGES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

/** Where to go after the token check: the page that was asked for if it is token-protected, else Leads. */
export function tokenAccessDestination(requested: string | null | undefined): string {
  const target = String(requested || '');
  return isTokenAccessPage(target.split('?')[0]) ? target : '/leads';
}

async function signature(token: string, expiresAt: number): Promise<string> {
  const bytes = new TextEncoder().encode(`rayna-leads:${token}:${expiresAt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Constant-time compare (middleware runs on the Edge runtime, so no node:crypto).
export function safeEqual(a: unknown, b: unknown): boolean {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function createLeadsAccessCookie(token: string, expiresAt: number): Promise<string> {
  return `${expiresAt}.${await signature(token, expiresAt)}`;
}

export async function readLeadsAccessCookie(value: string | undefined | null, token: string): Promise<{ expiresAt: number } | null> {
  const [expiresText, suppliedSignature] = String(value || '').split('.');
  const expiresAt = Number(expiresText);
  if (!expiresAt || expiresAt <= Date.now() || !suppliedSignature) return null;
  const expectedSignature = await signature(token, expiresAt);
  return safeEqual(suppliedSignature, expectedSignature) ? { expiresAt } : null;
}
