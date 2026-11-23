/**
 * Small, dependency-free request validation helpers shared by route handlers.
 */

/** Parse a strictly numeric positive integer id ("12" ok; "12abc", "abc", "0", "-1" → null). */
export function parseId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Clamp a limit/page-style query value. NaN, missing, or below `min` → `def`;
 * anything above `max` → `max`.
 */
export function clampInt(value: unknown, def: number, max: number, min = 1): number {
  const n = typeof value === 'number' ? Math.trunc(value) : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < min) return def;
  return Math.min(n, max);
}

/** Escape a string for safe interpolation into HTML text or attribute content. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Quote a CSV field, doubling embedded quotes. */
export function csvField(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Returns the body as a plain object (Express 5 leaves req.body undefined with no body). */
export function bodyOf<T extends object>(body: T | undefined | null): Partial<T> {
  return body && typeof body === 'object' ? body : {};
}

/** Validate a YYYY-MM-DD calendar date string. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Upper bound for page-number query params (keeps OFFSET arithmetic sane). */
export const MAX_PAGE = 100000;
