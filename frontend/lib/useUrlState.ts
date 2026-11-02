'use client';

import { useCallback, useState } from 'react';

/**
 * Keep a page's tab / filter / sort in the URL query (?key=value) so a refresh or a
 * shared link opens the page the way it was left.
 *
 * Writes use history.replaceState: no navigation, no new history entry, no refetch of
 * the route. The default value is never written, so untouched pages keep a clean URL.
 *
 * The first render reads the URL directly. Dashboard pages render only in the browser
 * (after the login check), so there is no server render to mismatch and no flash of the
 * default tab. Not for server-rendered public pages (/leads keeps its own ?tab= logic).
 */

/** One query param from the current URL (null on the server). */
export function readUrlParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** Set (or, for null / '', remove) query params on the current URL in place. */
export function writeUrlParams(params: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== now) window.history.replaceState(null, '', next);
}

/** `raw` when it is one of `allowed`, else `fallback`. Numbers match by their text. */
function pick<T extends string | number>(raw: string | null, fallback: T, allowed: readonly T[] | null): T {
  if (raw == null || raw === '') return fallback;
  if (!allowed) return (typeof fallback === 'number' ? fallback : raw) as T;
  return allowed.find(a => String(a) === raw) ?? fallback;
}

/**
 * useState backed by one URL query param.
 *   allowed  the valid values (anything else in the URL falls back to `fallback`);
 *            null accepts any text — for values only the server knows (e.g. channels).
 */
export function useUrlState<T extends string | number>(
  key: string,
  fallback: T,
  allowed: readonly T[] | null,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => pick(readUrlParam(key), fallback, allowed));

  const set = useCallback((v: T) => {
    setValue(v);
    writeUrlParams({ [key]: v === fallback ? null : String(v) });
  }, [key, fallback]);

  return [value, set];
}
