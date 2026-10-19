import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/States';
import styles from './leads.module.css';

export type CompareMode = 'previous' | 'year';

export const COMPARE_LABEL: Record<CompareMode, string> = {
  previous: 'vs previous period',
  year: 'vs same period last year',
};

export function formatNum(n?: number | null): string {
  return (typeof n === 'number' && Number.isFinite(n) ? n : 0).toLocaleString();
}

export function getToday(): string { return new Date().toISOString().split('T')[0]; }
export function getYesterday(): string { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
export function getDaysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

const DAY_MS = 86_400_000;
const parseYmd = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const toYmd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The comparison window for [from, to]: the same number of days right before it,
 * or the same dates one year earlier. Null when the dates are not valid.
 */
export function comparisonRange(from: string, to: string, mode: CompareMode): { from: string; to: string } | null {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (a == null || b == null || b < a) return null;
  if (mode === 'year') {
    const shift = (ms: number) => { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() - 1); return toYmd(d.getTime()); };
    return { from: shift(a), to: shift(b) };
  }
  const len = Math.round((b - a) / DAY_MS) + 1;
  const prevTo = a - DAY_MS;
  return { from: toYmd(prevTo - (len - 1) * DAY_MS), to: toYmd(prevTo) };
}

/** Percent change, or null when there is nothing honest to compare against. */
export function pctChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (typeof cur !== 'number' || typeof prev !== 'number' || !Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export function DeltaText({ pct, suffix }: { pct: number | null; suffix?: string }) {
  if (pct == null) return null;
  const cls = pct > 0 ? styles.up : pct < 0 ? styles.down : styles.flat;
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
  return <span className={`${styles.kpiTrend} ${cls}`}>{arrow} {Math.abs(pct)}%{suffix ? ` ${suffix}` : ''}</span>;
}

export interface KpiProps { label: string; value: ReactNode; trend?: ReactNode; help?: ReactNode; textValue?: boolean }

export function Kpi({ label, value, trend, help, textValue }: KpiProps) {
  return (
    <section className={`ui-card ${styles.kpi}`} aria-label={label}>
      <span className={styles.note}>{label}</span>
      <span className={textValue ? styles.kpiValueText : styles.kpiValue}>{value}</span>
      {trend}
      {help && <span className={styles.help}>{help}</span>}
    </section>
  );
}

export interface SegOption<V extends string | number> { value: V; label: string }

export function Seg<V extends string | number>({ options, value, onChange, label }: { options: SegOption<V>[]; value: V; onChange: (v: V) => void; label: string }) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} type="button" className={styles.segBtn} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pills<V extends string | number>({ options, value, onChange, label }: { options: SegOption<V>[]; value: V; onChange: (v: V) => void; label: string }) {
  return (
    <div className={styles.inline} role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} type="button" className={styles.pill} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div aria-label="Loading lead analytics" aria-busy="true" className={styles.page}>
      <div className={styles.kpiGrid}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`ui-card ${styles.kpi}`}><Skeleton width="50%" height={12} /><Skeleton width="70%" height={28} /></div>
        ))}
      </div>
      <div className={`ui-card ${styles.cardPad}`}>
        <Skeleton width={210} height={16} />
        <div className={styles.chartSkel}>
          {[38, 62, 48, 78, 55, 88, 68, 74, 52, 82].map((h, i) => <Skeleton key={i} width="7%" height={`${h}%`} radius={4} />)}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ label, cols = 6 }: { label: string; cols?: number }) {
  return (
    <div className={`ui-card ${styles.cardPad}`} aria-label={label} aria-busy="true">
      <Skeleton width={190} height={16} />
      {[0, 1, 2, 3, 4].map(r => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 14, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} width="70%" height={12} />)}
        </div>
      ))}
    </div>
  );
}

export const TOOLTIP_STYLE = {
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--ink)',
};
