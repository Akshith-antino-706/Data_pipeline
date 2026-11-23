/**
 * Signed unsubscribe tokens.
 *
 * The token identifies the contact in an unsubscribe link without exposing an enumerable id —
 * `?uid=123` would let anyone opt out any contact by counting upwards. The payload is the
 * contact id, the signature is HMAC-SHA256 over that id with JWT_SECRET.
 *
 * Lives in utils (not the route) so both the route and placeholderResolver can use it without
 * the resolver importing an Express router.
 */
import crypto from 'node:crypto';

const SECRET = process.env.JWT_SECRET || 'rayna-unsub-secret';

/** Build `<base64url(uid)>.<signature>` for an unsubscribe link. */
export function signUnsubToken(uid: string | number): string {
  const payload = Buffer.from(String(uid)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(String(uid)).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verify a token and return the contact id, or null when absent/tampered. */
export function verifyUnsubToken(token: string | null | undefined): string | null {
  if (!token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  let uid: string;
  try { uid = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  const expected = crypto.createHmac('sha256', SECRET).update(uid).digest('base64url');
  // timingSafeEqual throws when the lengths differ, which turned a tampered token into a 500.
  const got = Buffer.from(sig || '');
  const want = Buffer.from(expected);
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? uid : null;
}

export default { signUnsubToken, verifyUnsubToken };
