'use client';

/**
 * Performance overview (top of /journeys/analytics), written for marketing users:
 * a period picker, an "At a glance" row of five KPI tiles (each with a plain-English
 * help line and the change vs the previous period), and two charts side by side —
 * open/click rate by week and the sent → booked funnel.
 * All numbers come from GET /api/v3/overview/insights. A section the API marks
 * `available:false` (or omits) shows "Not available right now" — never placeholder numbers.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { getOverviewInsights } from '@/lib/api';
import type { OverviewInsights, OverviewSection, OverviewTotals } from '@/lib/api';
import { Button, ErrorState, Skeleton } from '@/components/ui';
import styles from './InsightsOverview.module.css';

type Available<T> = { available: true } & T;
type Preset = 7 | 30 | 90 | 'custom';
type Week = { week: string; sent: number; opened: number; clicked: number; openRate: number; clickRate: number };
type FunnelData = { sent: number; opened: number; clicked: number; converted: number };

function isAvail<T>(s: OverviewSection<T> | undefined | null): s is Available<T> {
  return !!s && typeof s === 'object' && s.available === true;
}

const n0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtN = (v: unknown) => n0(v).toLocaleString('en-US');
const fmtPct = (v: unknown) => `${(Math.round(n0(v) * 10) / 10).toLocaleString('en-US')}%`;
const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
/** Share as text; tiny non-zero shares read "<0.1%" instead of a misleading "0%". */
const fmtShare = (num: number, den: number) => (num > 0 && den > 0 && num / den < 0.001 ? '<0.1%' : fmtPct(rate(num, den)));

/** Series colours: one hue per meaning, from the design tokens. */
const OPEN_COLOR = 'var(--gold-ink)';
const CLICK_COLOR = 'var(--info)';
const tick = { fontSize: 11, fill: 'var(--ink3)' };

/** Today's date in Dubai (UTC+4, no DST) — matches the backend's range parsing. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** "13 Oct" (or "13 Oct 2025" when withYear). Never echoes a raw ISO string. */
function shortDate(iso: string | undefined, withYear = false): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(iso ?? '')?.[0];
  const t = day ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}),
  });
}
const weekLabel = (iso: string) => { const d = shortDate(iso); return d ? `w/c ${d}` : ''; };
const periodWords = (days: number) => (days === 1 ? 'the previous day' : `the previous ${fmtN(days)} days`);

function NotAvailable({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <div className={styles.unavailable}>
      <span>Not available right now</span>
      <button type="button" className={styles.retry} onClick={onRetry} disabled={busy}>Try again</button>
    </div>
  );
}

/** Change vs the previous period, as a coloured arrow plus plain words. */
function Change({ cur, prev, prevOk, days, lowerIsBetter = false }: {
  cur: number; prev: number; prevOk: boolean; days: number; lowerIsBetter?: boolean;
}) {
  if (!prevOk) return <span className={styles.changeMute}>No data for the previous period</span>;
  const period = periodWords(days);
  if (prev === 0) {
    if (cur === 0) return <span className={styles.changeMute}>Same as before</span>;
    return (
      <span className={lowerIsBetter ? styles.changeBad : styles.changeGood}>
        <span aria-hidden="true">↑ </span>Up from 0 in {period}
      </span>
    );
  }
  const d = Math.round(((cur - prev) / prev) * 1000) / 10;
  if (d === 0) return <span className={styles.changeMute}>Same as before</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={good ? styles.changeGood : styles.changeBad}>
      <span aria-hidden="true">{d > 0 ? '↑ ' : '↓ '}</span>
      {Math.abs(d).toLocaleString('en-US')}% vs {period.replace(/^the /, '')}
    </span>
  );
}

interface KpiDef {
  key: keyof OverviewTotals; label: string; help: string; channel: string;
  lowerIsBetter?: boolean; rateOf?: keyof OverviewTotals; rateFallback?: keyof OverviewTotals;
}
const KPIS: KpiDef[] = [
  { key: 'sent', label: 'Messages sent', help: 'Emails, WhatsApp and SMS your journeys sent', channel: 'All channels' },
  { key: 'delivered', label: 'Delivered', help: 'Messages that reached the inbox or phone', channel: 'All channels', rateOf: 'sent' },
  { key: 'opened', label: 'Opened', help: 'Emails opened and WhatsApp messages read', channel: 'Email + WhatsApp', rateOf: 'delivered', rateFallback: 'sent' },
  { key: 'clicked', label: 'Clicked', help: 'Emails where someone clicked a link', channel: 'Email only', rateOf: 'opened' },
  { key: 'unsubscribed', label: 'Unsubscribed', help: 'People who asked to stop getting messages', channel: 'All channels', lowerIsBetter: true },
];

const LABELS: Record<keyof OverviewTotals, string> = {
  sent: 'sent', delivered: 'delivered', opened: 'opened', clicked: 'clicked', unsubscribed: 'unsubscribed',
};

export default function InsightsOverview() {
  const [preset, setPreset] = useState<Preset>(7);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<OverviewInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = (() => {
    if (preset === 'custom') {
      if (!customFrom || !customTo || customFrom > customTo) return null;
      return { from: customFrom, to: customTo };
    }
    const to = dubaiToday();
    return { from: addDays(to, -(preset - 1)), to };
  })();
  const rFrom = range?.from;
  const rTo = range?.to;

  const load = useCallback(async () => {
    if (!rFrom || !rTo) return;
    setLoading(true);
    try {
      const res = await getOverviewInsights(rFrom, rTo);
      setData(res ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load performance data');
      setData(null);
    } finally { setLoading(false); }
  }, [rFrom, rTo]);

  useEffect(() => { load(); }, [load]);
  const retry = () => { void load(); };

  const totals = data?.totals;
  const previous = data?.previous;
  const prevOk = isAvail(previous);
  const shownRange = data?.range;
  const requestedDays = range ? Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  const days = n0(shownRange?.days) || requestedDays;

  const presetBtn = (value: Preset, label: string, onClick: () => void) => (
    <button key={label} type="button" className={preset === value ? styles.segOn : styles.segBtn}
      aria-pressed={preset === value} onClick={onClick}>
      {label}
    </button>
  );

  const rangeText = (() => {
    if (!range) return null;
    const from = shownRange?.from ?? range.from;
    const to = shownRange?.to ?? range.to;
    const main = `${shortDate(from)} – ${shortDate(to, true)}`;
    return prevOk ? `${main} · Compared with ${shortDate(previous.from)} – ${shortDate(previous.to, true)}` : main;
  })();

  return (
    <div className={styles.overview}>
      <div className={styles.periodRow}>
        <div className={styles.seg} role="group" aria-label="Period">
          {presetBtn(7, 'Last 7 days', () => setPreset(7))}
          {presetBtn(30, '30 days', () => setPreset(30))}
          {presetBtn(90, '90 days', () => setPreset(90))}
          {presetBtn('custom', 'Custom', () => {
            if (!customFrom && rFrom) setCustomFrom(rFrom);
            if (!customTo && rTo) setCustomTo(rTo);
            setPreset('custom');
          })}
        </div>
        {preset === 'custom' && (
          <div className={styles.customDates}>
            <label className={styles.dateLabel}>From
              <input type="date" className="ui-input" aria-label="Period from" value={customFrom} max={customTo || undefined}
                onChange={e => setCustomFrom(e.target.value)} />
            </label>
            <label className={styles.dateLabel}>To
              <input type="date" className="ui-input" aria-label="Period to" value={customTo} min={customFrom || undefined}
                onChange={e => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}
        <span className={styles.periodMeta}>
          {range
            ? rangeText
            : <span className={styles.warnText}>Pick a valid from and to date (from must be on or before to).</span>}
        </span>
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={retry} disabled={!range || loading}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {error ? (
        <ErrorState title="Couldn't load performance data"
          description="Showing nothing rather than numbers that may be wrong."
          details={error}
          action={<Button size="sm" onClick={retry}>Try again</Button>} />
      ) : loading && !data ? (
        <div className={styles.body} data-testid="insights-loading">
          <div className={styles.kpiGrid}>
            {KPIS.map(k => (
              <div key={k.key} className={styles.tile}>
                <Skeleton height={12} width="55%" /><Skeleton height={26} width="70%" /><Skeleton height={10} width="90%" />
              </div>
            ))}
          </div>
          <div className={styles.charts}>
            <div className={styles.panel}><Skeleton height={14} width="40%" /><Skeleton height={170} /></div>
            <div className={styles.panel}><Skeleton height={14} width="40%" /><Skeleton height={170} /></div>
          </div>
        </div>
      ) : (
        <div className={loading ? `${styles.body} ${styles.refreshing}` : styles.body} aria-busy={loading}>
          <section aria-label="At a glance">
            <h2 className={styles.sectionTitle}>At a glance</h2>
            {isAvail(totals) ? (
              <div className={styles.kpiGrid}>
                {KPIS.map(k => {
                  const cur = n0(totals[k.key]);
                  const prev = prevOk ? n0(previous[k.key]) : 0;
                  let base: keyof OverviewTotals | undefined = k.rateOf;
                  if (base && k.rateFallback && n0(totals[base]) === 0) base = k.rateFallback;
                  const baseVal = base ? n0(totals[base]) : 0;
                  return (
                    <div key={k.key} className={styles.tile} data-testid={`kpi-${k.key}`}>
                      <div className={styles.tileHead}>
                        <span className={styles.tileLabel}>{k.label}</span>
                        <span className={styles.channel}>{k.channel}</span>
                      </div>
                      <div className={styles.valueRow}>
                        <span className={styles.value}>{fmtN(cur)}</span>
                        {base && baseVal > 0 && <span className={styles.valueSub}>{fmtPct(rate(cur, baseVal))} of {LABELS[base]}</span>}
                      </div>
                      <p className={styles.help}>{k.help}</p>
                      <Change cur={cur} prev={prev} prevOk={prevOk} days={days} lowerIsBetter={k.lowerIsBetter} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.panel}><NotAvailable onRetry={retry} busy={loading} /></div>
            )}
          </section>

          <div className={styles.charts}>
            <section className={styles.panel} aria-label="Opens and clicks by week">
              <div className={styles.panelHead}>
                <h3 className={styles.panelTitle}>Opens and clicks by week</h3>
                <span className={styles.channel}>Email only</span>
              </div>
              {isAvail(data?.weeklyTrend)
                ? <TrendChart weeks={data.weeklyTrend.weeks ?? []} />
                : <NotAvailable onRetry={retry} busy={loading} />}
            </section>
            <section className={styles.panel} aria-label="From sent to booked">
              <div className={styles.panelHead}>
                <h3 className={styles.panelTitle}>From sent to booked</h3>
                <span className={styles.channel}>Email only</span>
              </div>
              {isAvail(data?.funnel) ? <Funnel f={data.funnel} /> : <NotAvailable onRetry={retry} busy={loading} />}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Funnel ───────────────────────────────────────────────────────────────── */

const DROP_WORDS: Record<string, string> = {
  Opened: "didn't open",
  Clicked: "opened but didn't click",
  Booked: "clicked but didn't book",
};

function Funnel({ f }: { f: FunnelData }) {
  const steps = [
    { label: 'Sent', v: n0(f.sent) },
    { label: 'Opened', v: n0(f.opened) },
    { label: 'Clicked', v: n0(f.clicked) },
    { label: 'Booked', v: n0(f.converted) },
  ];
  const sent = steps[0].v;
  if (steps.every(s => s.v === 0)) return <p className={styles.empty}>No data for this period</p>;

  // Biggest step-to-step loss, as a plain sentence.
  let drop: { at: string; from: string; pct: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const before = steps[i - 1].v;
    if (before <= 0) continue;
    const lost = Math.round((1 - steps[i].v / before) * 100);
    if (lost > 0 && (!drop || lost > drop.pct)) drop = { at: steps[i].label, from: steps[i - 1].label, pct: lost };
  }

  const describe = steps.map((s, i) => (i === 0 || sent === 0 ? `${s.label} ${fmtN(s.v)}` : `${s.label} ${fmtN(s.v)} (${fmtPct(rate(s.v, sent))} of sent)`)).join(', ');

  return (
    <div className={styles.funnelWrap}>
      <p className={styles.caption}>
        Where people drop off
        {drop && <> · <strong className={styles.captionStrong}>Biggest drop: {drop.from} → {drop.at}</strong> ({fmtN(drop.pct)}% {DROP_WORDS[drop.at]})</>}
      </p>
      <ol className={styles.funnel} aria-label={`Funnel from sent to booked: ${describe}`}>
        {steps.map((s, i) => {
          const w = sent > 0 ? Math.min(100, Math.max(s.v > 0 ? 2 : 0, (s.v / sent) * 100)) : 0;
          const ofPrev = i > 0 && steps[i - 1].v > 0 ? `${fmtPct(rate(s.v, steps[i - 1].v))} of ${steps[i - 1].label.toLowerCase()}` : undefined;
          return (
            <li key={s.label} className={styles.funnelRow} title={ofPrev}>
              <span className={styles.funnelLabel}>{s.label}</span>
              <span className={styles.funnelTrack} aria-hidden="true">
                <span className={styles.funnelBar} style={{ width: `${w}%` }} />
              </span>
              <span className={styles.funnelValue}>
                <span className={styles.num}>{fmtN(s.v)}</span>
                {i > 0 && sent > 0 && <span className={styles.funnelPct}>{fmtShare(s.v, sent)} of sent</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={styles.footnote}>Booked counts people who left a journey with a booking in this period.</p>
    </div>
  );
}

/* ── Weekly trend ─────────────────────────────────────────────────────────── */

interface TrendRow { label: string; openRate: number; clickRate: number; sent: number; opened: number; clicked: number }

function isTrendRow(v: unknown): v is TrendRow {
  return !!v && typeof v === 'object' && 'label' in v && 'openRate' in v;
}

function WeekTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !isTrendRow(row)) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{row.label}</div>
      <div>{fmtN(row.sent)} emails sent</div>
      <div><span className={styles.swatch} style={{ background: OPEN_COLOR }} aria-hidden="true" />Opened {fmtN(row.opened)} · {fmtPct(row.openRate)}</div>
      <div><span className={styles.swatch} style={{ background: CLICK_COLOR }} aria-hidden="true" />Clicked {fmtN(row.clicked)} · {fmtPct(row.clickRate)}</div>
    </div>
  );
}

function TrendChart({ weeks }: { weeks: Week[] }) {
  const rows: TrendRow[] = weeks.map(w => ({
    label: weekLabel(w.week), openRate: n0(w.openRate), clickRate: n0(w.clickRate),
    sent: n0(w.sent), opened: n0(w.opened), clicked: n0(w.clicked),
  }));
  if (rows.length === 0 || rows.every(r => r.sent === 0)) return <p className={styles.empty}>No data for this period</p>;

  const sent = rows.reduce((a, r) => a + r.sent, 0);
  const avgOpen = rate(rows.reduce((a, r) => a + r.opened, 0), sent);
  const avgClick = rate(rows.reduce((a, r) => a + r.clicked, 0), sent);
  const last = rows[rows.length - 1];
  const aria = `Open rate and click rate by week, ${fmtN(rows.length)} ${rows.length === 1 ? 'week' : 'weeks'}. `
    + `Overall open rate ${fmtPct(avgOpen)} and click rate ${fmtPct(avgClick)} of ${fmtN(sent)} emails sent. `
    + `Latest week (${last.label}): open rate ${fmtPct(last.openRate)}, click rate ${fmtPct(last.clickRate)}.`;

  return (
    <div className={styles.chart}>
      <ul className={styles.legend}>
        <li><span className={styles.swatchLine} style={{ background: OPEN_COLOR }} aria-hidden="true" />Open rate <strong className={styles.num}>{fmtPct(avgOpen)}</strong></li>
        <li><span className={styles.swatchLine} style={{ background: CLICK_COLOR }} aria-hidden="true" />Click rate <strong className={styles.num}>{fmtPct(avgClick)}</strong></li>
        <li className={styles.legendNote}>overall, of emails sent</li>
      </ul>
      <div className={styles.plot} role="img" aria-label={aria}>
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={rows} margin={{ top: 6, right: 0, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={16} />
            {/* Click rate is far smaller than open rate, so it gets its own right-hand scale. */}
            <YAxis yAxisId="open" tickFormatter={(v: number) => `${v}%`} tick={tick} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
            <YAxis yAxisId="click" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={{ ...tick, fill: CLICK_COLOR }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<WeekTooltip />} cursor={{ stroke: 'var(--ink3)', strokeDasharray: '3 3' }} />
            <Line yAxisId="open" type="monotone" dataKey="openRate" name="Open rate" stroke={OPEN_COLOR} strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: OPEN_COLOR }} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
            <Line yAxisId="click" type="monotone" dataKey="clickRate" name="Click rate" stroke={CLICK_COLOR} strokeWidth={2} strokeDasharray="5 3"
              dot={{ r: 3, strokeWidth: 0, fill: CLICK_COLOR }} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
