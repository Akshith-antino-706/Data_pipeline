import type { ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type RenderableText, type TooltipContentProps,
} from 'recharts';
import { Skeleton } from '@/components/ui/States';
import styles from './leads.module.css';

export type CompareMode = 'previous' | 'year';

export const COMPARE_LABEL: Record<CompareMode, string> = {
  previous: 'vs previous period',
  year: 'vs same period last year',
};

export function formatNum(n?: number | null): string {
  return (typeof n === 'number' && Number.isFinite(n) ? n : 0).toLocaleString('en-US');
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

// ── Dates (Asia/Dubai) ──────────────────────────────────────────────────────
// The API sends calendar dates ("2026-10-15", buckets start on Monday / the 1st).
// They are shown as-is (they already are Dubai dates); full timestamps with a zone
// are converted to the Dubai calendar day. Anything unparseable renders as "—".

export const DUBAI_TZ = 'Asia/Dubai';
export type Granularity = 'day' | 'week' | 'month';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NO_DATE = '—';

/** A calendar day: month 1-12, weekday 0 = Sunday. */
export interface CalDate { y: number; m: number; d: number; wd: number }

function calendar(y: number, m: number, d: number): CalDate | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d, wd: dt.getUTCDay() };
}

const dubaiParts = new Intl.DateTimeFormat('en-US', { timeZone: DUBAI_TZ, year: 'numeric', month: 'numeric', day: 'numeric' });

/** The Dubai calendar day of an instant, or null for an invalid Date. */
export function dubaiCalendar(date: Date): CalDate | null {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dubaiParts.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value);
  return calendar(get('year'), get('month'), get('day'));
}

/**
 * Safe parser: "YYYY-MM-DD", "YYYY-MM" (1st of the month), "YYYY-MM-DD HH:MM[:SS]" (date part),
 * or an ISO timestamp with Z/offset (converted to Dubai). Everything else → null, never "Invalid Date".
 */
export function parseLeadDate(value: unknown): CalDate | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const local = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(s);
  if (local) return calendar(Number(local[1]), Number(local[2]), local[3] ? Number(local[3]) : 1);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? dubaiCalendar(new Date(t)) : null;
  }
  return null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const toKey = (c: CalDate) => `${c.y}-${pad2(c.m)}-${pad2(c.d)}`;
const addDays = (c: CalDate, n: number): CalDate => {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
};
const dayNumber = (c: CalDate) => Date.UTC(c.y, c.m - 1, c.d) / DAY_MS;

/** Today's date in Dubai as YYYY-MM-DD. */
export function dubaiToday(now: Date = new Date()): string {
  const c = dubaiCalendar(now);
  return c ? toKey(c) : getToday();
}

export const toGranularity = (g: string): Granularity => (g === 'week' || g === 'month' ? g : 'day');

/** The bucket a date falls in, as the API keys it: the day, the Monday of its week, or the 1st of its month. */
export function bucketKey(value: string, granularity: string): string | null {
  const c = parseLeadDate(value);
  if (!c) return null;
  const g = toGranularity(granularity);
  if (g === 'week') return toKey(addDays(c, -((c.wd + 6) % 7)));
  if (g === 'month') return `${c.y}-${pad2(c.m)}-01`;
  return toKey(c);
}

/** Days from `from` to `to`, both included; null when either is invalid or the range is reversed. */
export function daysInRange(from: string, to: string): number | null {
  const a = parseLeadDate(from);
  const b = parseLeadDate(to);
  if (!a || !b) return null;
  const n = dayNumber(b) - dayNumber(a) + 1;
  return n >= 1 ? n : null;
}

/** "Thu, 15 Oct" (add `year` for "Thu, 15 Oct 2026"). */
export function formatDay(value: unknown, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const c = parseLeadDate(value);
  if (!c) return NO_DATE;
  const { year = false, weekday = true } = opts;
  return `${weekday ? `${WEEKDAYS[c.wd]}, ` : ''}${c.d} ${MONTHS[c.m - 1]}${year ? ` ${c.y}` : ''}`;
}

/** "13 – 20 Oct 2026", "28 Sep – 4 Oct 2026", "28 Dec 2025 – 3 Jan 2026" or "15 Oct 2026". */
export function formatRange(from: unknown, to: unknown): string {
  const a = parseLeadDate(from);
  const b = parseLeadDate(to);
  if (!a && !b) return NO_DATE;
  if (!a || !b) return formatDay(a ? from : to, { year: true, weekday: false });
  const full = (c: CalDate) => `${c.d} ${MONTHS[c.m - 1]} ${c.y}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return full(a);
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${full(b)}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${full(b)}`;
  return `${full(a)} – ${full(b)}`;
}

/**
 * A chart period for humans.
 *  - tick: daily "15 Oct", weekly "w/c 13 Oct", monthly "Oct 2026"
 *  - kpi:  daily "Thu, 15 Oct", otherwise as tick
 *  - full: daily "Thu, 15 Oct 2026", weekly "w/c 13 Oct 2026", monthly "Oct 2026"
 */
export function formatPeriod(period: unknown, granularity: string, style: 'tick' | 'kpi' | 'full' = 'tick'): string {
  const c = parseLeadDate(period);
  if (!c) return NO_DATE;
  const g = toGranularity(granularity);
  if (g === 'month') return `${MONTHS[c.m - 1]} ${c.y}`;
  const dm = `${c.d} ${MONTHS[c.m - 1]}${style === 'full' ? ` ${c.y}` : ''}`;
  if (g === 'week') return `w/c ${dm}`;
  return style === 'tick' ? dm : `${WEEKDAYS[c.wd]}, ${dm}`;
}

const SO_FAR: Record<Granularity, string> = { day: 'Today', week: 'This week', month: 'This month' };
/** Chart label of the bucket that is still filling up: "Today (so far)". */
export const soFarLabel = (granularity: string): string => `${SO_FAR[toGranularity(granularity)]} (so far)`;

/** The bucket that contains today (Dubai) when the range includes today, else null. */
export function partialBucket(from: string, to: string, granularity: string, today: string = dubaiToday()): string | null {
  const a = parseLeadDate(from);
  const b = parseLeadDate(to);
  const t = parseLeadDate(today);
  if (!a || !b || !t || dayNumber(t) < dayNumber(a) || dayNumber(t) > dayNumber(b)) return null;
  return bucketKey(today, granularity);
}

export interface PeriodValue { period: string; value: number }
export interface RangeKpis {
  /** Days in the range (both ends included), null for an invalid range. */
  days: number | null;
  /** total ÷ days, null when either is unknown. */
  perDay: number | null;
  /** The bucket with the highest value, null when there is no activity. */
  busiest: PeriodValue | null;
  /** Today's bucket when the range includes today (partial), else the range's last bucket. */
  latest: (PeriodValue & { partial: boolean }) | null;
}

/** The 4 headline KPIs, computed only from the loaded summary range/total and the chart points. */
export function rangeKpis(args: {
  from: string; to: string; granularity: string; total: number | null | undefined; points: PeriodValue[]; today?: string;
}): RangeKpis {
  const { from, to, granularity, total, points, today = dubaiToday() } = args;
  const days = daysInRange(from, to);
  const perDay = days != null && typeof total === 'number' && Number.isFinite(total) ? total / days : null;
  const busiest = points.reduce<PeriodValue | null>((best, p) => (
    Number.isFinite(p.value) && p.value > 0 && (!best || p.value > best.value) ? p : best
  ), null);
  let latest: RangeKpis['latest'] = null;
  if (days != null) {
    const partial = partialBucket(from, to, granularity, today);
    const key = partial ?? bucketKey(to, granularity);
    if (key) {
      const hit = points.find(p => bucketKey(p.period, granularity) === key);
      latest = { period: key, value: hit && Number.isFinite(hit.value) ? hit.value : 0, partial: partial != null };
    }
  }
  return { days, perDay, busiest, latest };
}

/** "150", "12.5", or "—" when unknown. */
export function formatPerDay(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return NO_DATE;
  return n >= 100 ? formatNum(Math.round(n)) : n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

const LATEST_LABEL: Record<Granularity, [string, string]> = {
  day: ['Today so far', 'Latest day'],
  week: ['This week so far', 'Latest week'],
  month: ['This month so far', 'Latest month'],
};
export const latestKpiLabel = (granularity: string, partial: boolean): string => LATEST_LABEL[toGranularity(granularity)][partial ? 0 : 1];

// ── UI pieces ───────────────────────────────────────────────────────────────

export function DeltaText({ pct, suffix }: { pct: number | null; suffix?: string }) {
  if (pct == null) return null;
  const cls = pct > 0 ? styles.up : pct < 0 ? styles.down : styles.flat;
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
  return <span className={`${styles.kpiTrend} ${cls}`}>{arrow} {Math.abs(pct)}%{suffix ? ` ${suffix}` : ''}</span>;
}

export interface KpiProps {
  label: string;
  value: ReactNode;
  trend?: ReactNode;
  help?: ReactNode;
  textValue?: boolean;
  /** Borderless variant for a stat strip inside another card. */
  flat?: boolean;
}

export function Kpi({ label, value, trend, help, textValue, flat }: KpiProps) {
  return (
    <section className={flat ? styles.stat : `ui-card ${styles.kpi}`} aria-label={label}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={textValue ? styles.kpiValueText : styles.kpiValue}>{value}</span>
      {trend}
      {help && <span className={styles.kpiHelp}>{help}</span>}
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
    <div aria-label="Loading lead analytics" aria-busy="true" className={styles.stack}>
      <div className={styles.kpiGrid}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`ui-card ${styles.kpi}`}><Skeleton width="50%" height={11} /><Skeleton width="60%" height={24} /><Skeleton width="80%" height={11} /></div>
        ))}
      </div>
      <div className={`ui-card ${styles.cardPad}`}>
        <Skeleton width={210} height={16} />
        <div className={styles.chartSkel}>
          {[38, 62, 48, 78, 55, 88, 68, 74, 52, 82].map((h, i) => <Skeleton key={i} width="6%" height={`${h}%`} radius={4} />)}
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

// ── Trend chart ─────────────────────────────────────────────────────────────

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  stackId?: string;
  /** Round the top corners (the only / top-most bar of a stack). */
  rounded?: boolean;
  /** Print the value above each bar. */
  labelled?: boolean;
}
export type ChartRow = { period: string } & Record<string, string | number>;

/** Bars print their values only while they still have room. */
const MAX_LABELLED_BARS = 16;
const BAR_OPACITY = 0.82;
const PARTIAL_OPACITY = 0.32;

const compactTick = (v: number | string): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Math.abs(n) >= 10_000 ? `${formatNum(Math.round(n / 1000))}k` : formatNum(n);
};
const labelText = (v: RenderableText): RenderableText => (typeof v === 'number' ? (v > 0 ? formatNum(v) : '') : v);

function TrendTooltip({ active, payload, label, granularity, partialKey }: {
  active: boolean; payload: TooltipContentProps<number, string>['payload']; label?: string | number; granularity: string; partialKey: string | null;
}) {
  if (!active || !payload?.length) return null;
  const period = String(label ?? '');
  const isPartial = partialKey != null && bucketKey(period, granularity) === partialKey;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>
        {formatPeriod(period, granularity, 'full')}
        {isPartial && <span className={styles.tooltipNote}> · so far</span>}
      </div>
      {payload.map(item => (
        <div key={String(item.dataKey ?? item.name)} className={styles.tooltipRow}>
          <span className={styles.swatch} style={{ background: item.color }} aria-hidden="true" />
          <span>{item.name}</span>
          <b className={styles.num}>{typeof item.value === 'number' ? formatNum(item.value) : NO_DATE}</b>
        </div>
      ))}
    </div>
  );
}

/** Bar chart for the per-period trend: subtle axes, value labels, today's partial bucket drawn lighter. */
export function TrendBarChart({ data, series, granularity, partialKey, height = 260 }: {
  data: ChartRow[]; series: ChartSeries[]; granularity: string; partialKey: string | null; height?: number;
}) {
  const isPartial = (period: string) => partialKey != null && bucketKey(period, granularity) === partialKey;
  const tick = (period: string) => (isPartial(period) ? soFarLabel(granularity) : formatPeriod(period, granularity, 'tick'));
  const showLabels = data.length <= MAX_LABELLED_BARS;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%" barGap={3}>
        <CartesianGrid stroke="var(--line)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="period" tickFormatter={tick} tick={{ fill: 'var(--ink3)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--line)' }} tickLine={false} interval="preserveStartEnd" minTickGap={12} tickMargin={8} />
        <YAxis allowDecimals={false} width={44} tickCount={4} tickFormatter={compactTick}
          tick={{ fill: 'var(--ink3)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: 'var(--sunken)', fillOpacity: 0.7 }}
          content={props => <TrendTooltip active={props.active} payload={props.payload} label={props.label} granularity={granularity} partialKey={partialKey} />} />
        {series.map(s => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={s.stackId} maxBarSize={36}
            radius={s.rounded ? [4, 4, 0, 0] : 0}>
            {data.map(row => {
              const partial = isPartial(row.period);
              return (
                <Cell key={row.period} fillOpacity={partial ? PARTIAL_OPACITY : BAR_OPACITY}
                  stroke={partial ? s.color : undefined} strokeDasharray={partial ? '3 2' : undefined} strokeWidth={partial ? 1 : 0} />
              );
            })}
            {showLabels && s.labelled && (
              <LabelList dataKey={s.key} position="top" offset={6} formatter={labelText}
                style={{ fill: 'var(--ink2)', fontSize: 11, fontWeight: 600 }} />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
