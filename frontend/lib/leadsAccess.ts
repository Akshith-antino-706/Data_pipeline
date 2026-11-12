export const LEADS_ACCESS_COOKIE = 'rayna-leads-access';

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
