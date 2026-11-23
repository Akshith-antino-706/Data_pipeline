/**
 * Remember where someone was when they were sent to /login, so signing in takes
 * them straight back there instead of to the dashboard.
 *
 *   loginUrlFor('/journeys/279?tab=flow')  →  '/login?next=%2Fjourneys%2F279%3Ftab%3Dflow'
 *   safeNext('/journeys/279')              →  '/journeys/279'
 *   safeNext('https://evil.com')           →  '/dashboard'   (only same-site paths are honoured)
 */

export const DEFAULT_AFTER_LOGIN = '/dashboard';

/** Pages that make no sense to return to after signing in. */
const NOT_A_DESTINATION = ['/login', '/', '/landing'];

/** A same-site path we are willing to send a freshly signed-in user to, else the dashboard. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_LOGIN;
  // Must be an absolute path on this site: starts with one slash, not two (//host), no scheme.
  if (!raw.startsWith('/') || raw.startsWith('//') || /^\/[\\]/.test(raw)) return DEFAULT_AFTER_LOGIN;
  const path = raw.split('?')[0];
  if (NOT_A_DESTINATION.includes(path)) return DEFAULT_AFTER_LOGIN;
  return raw;
}

/** The /login URL that carries `pathWithSearch` as the place to come back to. */
export function loginUrlFor(pathWithSearch: string): string {
  const next = safeNext(pathWithSearch);
  return next === DEFAULT_AFTER_LOGIN ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}

/** loginUrlFor() for the page currently open in the browser. */
export function loginUrlForCurrentPage(): string {
  if (typeof window === 'undefined') return '/login';
  return loginUrlFor(`${window.location.pathname}${window.location.search}`);
}
