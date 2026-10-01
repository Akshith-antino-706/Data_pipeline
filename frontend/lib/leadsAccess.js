export const LEADS_ACCESS_COOKIE = 'rayna-leads-access';

async function signature(token, expiresAt) {
  const bytes = new TextEncoder().encode(`rayna-leads:${token}:${expiresAt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createLeadsAccessCookie(token, expiresAt) {
  return `${expiresAt}.${await signature(token, expiresAt)}`;
}

export async function readLeadsAccessCookie(value, token) {
  const [expiresText, suppliedSignature] = String(value || '').split('.');
  const expiresAt = Number(expiresText);
  if (!expiresAt || expiresAt <= Date.now() || !suppliedSignature) return null;
  const expectedSignature = await signature(token, expiresAt);
  return suppliedSignature === expectedSignature ? { expiresAt } : null;
}
