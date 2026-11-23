/** Global search (top bar, ⌘K) — result shapes. Built only from real API rows. */

export type SearchGroupKey = 'pages' | 'journeys' | 'templates' | 'segments' | 'contacts';

export interface SearchPage { href: string; label: string }

export interface SearchResult {
  /** Unique across all groups — `${group}:${id}`. */
  key: string;
  group: SearchGroupKey;
  href: string;
  title: string;
  /** Secondary line: email · phone, channel · status, … */
  meta?: string;
  /** Short tag on the right: status, type or channel. */
  tag?: string;
}

export type SearchGroupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: SearchResult[]; total?: number }
  | { status: 'error' };

/** Rows as the list endpoints return them (only the fields the search shows). */
export interface SearchJourneyRow { journey_id: number | string; name?: string | null; status?: string | null; segment_name?: string | null; journey_type?: string | null }
export interface SearchTemplateRow { id: number | string; name?: string | null; channel?: string | null; status?: string | null; subject?: string | null }
export interface SearchSegmentRow { id: number | string; name?: string | null; status?: string | null; cached_count?: number | string | null }
export interface SearchContactRow { id: number | string; name?: string | null; email?: string | null; mobile?: string | null; contact_type?: string | null }

export interface SearchListResponse<T> { data?: T[]; total?: number | string }
