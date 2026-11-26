'use client';

/**
 * Pieces shared by the journeys tables — Performance (JourneysTable) and the Journey Archive
 * (archive/ArchiveTable): row shape, number/date formatting and the small cells and controls.
 */

import { useEffect, useRef } from 'react';
import type { ChipTone } from '@/components/ui';
import styles from './analytics.module.css';

export interface AnalyticsRow {
  [key: string]: string | number | boolean | null | undefined;
  journey_id: string | number;
  journey_name?: string;
  journey_status: string;
  journey_type?: string;
  node_id?: string;
  node_label?: string;
  node_type?: string;
  template_id?: string | number | null;
  wa_template_id?: string | number | null;
  step_channel?: string | null;
  bot_window_sec?: number;
  entries?: number; sent: number; delivered: number | null; failed?: number;
  opened: number; human_opened?: number | null;
  clicked: number; human_clicked?: number | null;
  landed: number | null; bounced?: number | null; unsubscribed?: number; gtm_events?: number | null; booked?: number | null;
}

export const TZ = 'Asia/Dubai';

// ── Formatting (plain words, thousands separators, never NaN) ─────────────
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export const fmt = (v: unknown): string => (has(v) ? num(v).toLocaleString('en-US') : '—');
/** Percentage with one decimal, or null when there is nothing to divide by. */
export const rateOf = (part: unknown, whole: unknown): number | null => {
  const w = num(whole);
  return w > 0 ? Math.round((num(part) / w) * 1000) / 10 : null;
};
export const fmtRate = (r: number | null): string => (r === null ? '—' : `${r.toLocaleString('en-US')}%`);
export const openRate = (r: AnalyticsRow) => rateOf(r.opened, num(r.delivered) || num(r.sent));
export const clickRate = (r: AnalyticsRow) => rateOf(r.clicked, r.opened);

export function timeAgo(ts: string | null | undefined): string {
  if (!ts) return 'not yet';
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return 'not yet';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86400) return plural(Math.floor(s / 3600), 'hour');
  return plural(Math.floor(s / 86400), 'day');
}
/** "Tue, 20 Oct 2026, 3:05 PM" in Dubai time, for tooltips. */
export function dubaiDateTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(/\u202f/g, ' ');
}
/** "20 Oct 2026" in Dubai time. */
export function dubaiDate(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}
/** A YYYY-MM-DD calendar day as "Thu, 1 Oct" (year added when it isn't this year). */
export function humanDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return 'that day';
  const d = new Date(t);
  const thisYear = new Date().toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' });
  const wd = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' });
  const label = `${wd}, ${d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })}`;
  const year = d.toLocaleDateString('en-GB', { timeZone: 'UTC', year: 'numeric' });
  return year === thisYear ? label : `${label} ${year}`;
}
export function dubaiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

const STATUS_LABEL: Record<string, { label: string; tone: ChipTone }> = {
  active: { label: 'Active', tone: 'ok' },
  paused: { label: 'Paused', tone: 'warn' },
  completed: { label: 'Finished', tone: 'info' },
  draft: { label: 'Draft', tone: 'mute' },
};
export function statusOf(s: string | null | undefined): { label: string; tone: ChipTone } {
  const key = String(s ?? '').toLowerCase();
  if (STATUS_LABEL[key]) return STATUS_LABEL[key];
  return { label: key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown', tone: 'mute' };
}
export const isAlwaysOn = (r: AnalyticsRow) => r.journey_type === 'gtm';

/** Raw count plus a muted "real people" line when the rollup has it. */
export function Engaged({ raw, human }: { raw: unknown; human: number | null | undefined }) {
  return (
    <span className={styles.engaged}>
      <span>{fmt(raw)}</span>
      {has(human) && num(raw) > 0 && <span className={styles.subNum} title="Opened or clicked by real people (not email security scanners)">{fmt(human)} real people</span>}
    </span>
  );
}

/** Small bar under a rate so the eye can compare rows quickly. */
export function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className={styles.rateCell}>
      <span>{fmtRate(rate)}</span>
      {rate !== null && (
        <span className={styles.rateTrack} aria-hidden="true">
          <span className={styles.rateFill} style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
        </span>
      )}
    </span>
  );
}

interface SortHeadProps<S extends string> { label: string; field: S; sort: S; dir: 'asc' | 'desc'; onSort: (f: S) => void; left?: boolean; tip?: string }
export function SortHead<S extends string>({ label, field, sort, dir, onSort, left, tip }: SortHeadProps<S>) {
  const on = sort === field;
  return (
    <th className={left ? styles.left : undefined} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={tip}>
      <button type="button" className={styles.sortBtn} onClick={() => onSort(field)}>
        {label}{on ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

export function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}
