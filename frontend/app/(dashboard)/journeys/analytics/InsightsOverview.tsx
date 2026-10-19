'use client';

/**
 * Performance overview (top of /journeys/analytics): period picker, KPI cards with
 * "vs previous period", weekly open/click trend, email funnel and per-journey rows.
 * All numbers come from GET /api/v3/overview/insights. A section the API marks
 * `available:false` (or omits) shows "Not available right now" — never placeholder numbers.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { getOverviewInsights } from '@/lib/api';
import type { OverviewInsights, OverviewSection, OverviewTotals } from '@/lib/api';
import { Button, Card, Chip, ErrorState, Skeleton } from '@/components/ui';
import styles from './analytics.module.css';

type Available<T> = { available: true } & T;
type Preset = 7 | 30 | 90 | 'custom';

function isAvail<T>(s: OverviewSection<T> | undefined | null): s is Available<T> {
  return !!s && typeof s === 'object' && s.available === true;
}

const n0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtN = (v: unknown) => n0(v).toLocaleString('en-US');
const fmtPct = (v: unknown) => `${(Math.round(n0(v) * 10) / 10).toLocaleString('en-US')}%`;
const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

/** Today's date in Dubai (UTC+4, no DST) — matches the backend's range parsing. */
function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function shortDate(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function NotAvailable() {
  return <p className={styles.unavailable}>Not available right now</p>;
}

/** "vs previous period" change; null when the previous value can't support a ratio. */
function Change({ cur, prev, prevOk, lowerIsBetter = false }: { cur: number; prev: number; prevOk: boolean; lowerIsBetter?: boolean }) {
  if (!prevOk) return <span className={styles.changeMute}>Previous period not available</span>;
  if (prev === 0) return <span className={styles.changeMute}>{cur === 0 ? 'No change vs previous period' : 'None in previous period'}</span>;
  const d = Math.round(((cur - prev) / prev) * 1000) / 10;
  if (d === 0) return <span className={styles.changeMute}>No change vs previous period</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={good ? styles.changeUp : styles.changeDown}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('en-US')}% vs previous period
    </span>
  );
}

interface KpiDef { key: keyof OverviewTotals; label: string; channel: string; lowerIsBetter?: boolean; rateOf?: keyof OverviewTotals }
const KPIS: KpiDef[] = [
  { key: 'sent', label: 'Sent', channel: 'All channels' },
  { key: 'delivered', label: 'Delivered', channel: 'All channels', rateOf: 'sent' },
  { key: 'opened', label: 'Opened', channel: 'Email + WhatsApp', rateOf: 'delivered' },
  { key: 'clicked', label: 'Clicked', channel: 'Email', rateOf: 'opened' },
  { key: 'unsubscribed', label: 'Unsubscribed', channel: 'All channels', lowerIsBetter: true },
];

export default function InsightsOverview() {
  const [preset, setPreset] = useState<Preset>(30);
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

  const totals = data?.totals;
  const previous = data?.previous;
  const prevOk = isAvail(previous);
  const shownRange = data?.range;

  return (
    <div className={styles.overview}>
      <Card className={styles.periodCard}>
        <div className={styles.periodRow}>
          <div className={styles.seg} role="group" aria-label="Period">
            {([7, 30, 90] as const).map(d => (
              <button key={d} type="button" className={preset === d ? styles.segOn : styles.segBtn}
                aria-pressed={preset === d} onClick={() => setPreset(d)}>
                Last {d} days
              </button>
            ))}
            <button type="button" className={preset === 'custom' ? styles.segOn : styles.segBtn}
              aria-pressed={preset === 'custom'}
              onClick={() => {
                if (!customFrom && rFrom) setCustomFrom(rFrom);
                if (!customTo && rTo) setCustomTo(rTo);
                setPreset('custom');
              }}>
              Custom
            </button>
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
          <span className={styles.spacer} />
          <Button size="sm" variant="ghost" onClick={load} disabled={!range || loading}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
        <div className={styles.periodMeta}>
          {!range
            ? <span className={styles.warnText}>Pick a valid from and to date (from must be on or before to).</span>
            : shownRange
              ? <>
                  <span>{shortDate(shownRange.from)} – {shortDate(shownRange.to)} · {fmtN(shownRange.days)} days</span>
                  {prevOk && <span> · Compared with {shortDate(previous.from)} – {shortDate(previous.to)}</span>}
                </>
              : <span>{shortDate(range.from)} – {shortDate(range.to)}</span>}
        </div>
      </Card>

      {error ? (
        <ErrorState title="Couldn't load performance data"
          description="Showing nothing rather than numbers that may be wrong."
          details={error}
          action={<Button size="sm" onClick={load}>Try again</Button>} />
      ) : loading && !data ? (
        <div className={styles.kpiGrid} data-testid="insights-loading">
          {KPIS.map(k => <Card key={k.key} className={styles.kpi}><Skeleton height={14} width="50%" /><Skeleton height={28} width="70%" /></Card>)}
        </div>
      ) : (
        <>
          <section aria-label="Totals">
            {isAvail(totals) ? (
              <div className={styles.kpiGrid}>
                {KPIS.map(k => {
                  const cur = n0(totals[k.key]);
                  const prev = prevOk ? n0(previous[k.key]) : 0;
                  return (
                    <Card key={k.key} className={styles.kpi}>
                      <div className={styles.kpiHead}>
                        <span className={styles.eyebrow}>{k.label}</span>
                        <Chip tone={k.channel === 'Email' ? 'info' : 'mute'}>{k.channel}</Chip>
                      </div>
                      <div className={styles.kpiValue}>{fmtN(cur)}</div>
                      {k.rateOf && <div className={styles.kpiSub}>{fmtPct(rate(cur, n0(totals[k.rateOf])))} of {k.rateOf}</div>}
                      <Change cur={cur} prev={prev} prevOk={prevOk} lowerIsBetter={k.lowerIsBetter} />
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card title="Totals"><NotAvailable /></Card>
            )}
          </section>

          <div className={styles.twoCol}>
            <Card title={<>From sent to booked <Chip tone="info">Email</Chip></>}>
              {isAvail(data?.funnel) ? <Funnel f={data.funnel} /> : <NotAvailable />}
            </Card>
            <Card title={<>Open and click rate by week <Chip tone="info">Email</Chip></>}>
              {isAvail(data?.weeklyTrend) ? (
                data.weeklyTrend.weeks.length === 0
                  ? <p className={styles.unavailable}>Nothing was sent in this period.</p>
                  : <TrendChart weeks={data.weeklyTrend.weeks} />
              ) : <NotAvailable />}
            </Card>
          </div>

          <Card title={<>By journey <Chip tone="info">Email</Chip></>}>
            {isAvail(data?.journeys) ? (
              data.journeys.rows.length === 0
                ? <p className={styles.unavailable}>No journey emails were sent in this period.</p>
                : (
                  <div className={styles.tableWrap}>
                    <table className={styles.perfTable} aria-label="Per-journey performance">
                      <thead>
                        <tr>
                          <th className={styles.left}>Name</th><th className={styles.left}>Status</th>
                          <th>Sent</th><th>Opened</th><th>Open rate</th><th>Clicked</th><th>Click rate</th><th>Unsubscribed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.journeys.rows.map(r => (
                          <tr key={r.id}>
                            <td className={styles.left}>{r.name} <span className={styles.muted}>#{r.id}</span></td>
                            <td className={styles.left}>{r.status ? <Chip tone={r.status === 'active' ? 'ok' : 'mute'}>{r.status}</Chip> : <span className={styles.muted}>—</span>}</td>
                            <td>{fmtN(r.sent)}</td><td>{fmtN(r.opened)}</td><td>{fmtPct(r.openRate)}</td>
                            <td>{fmtN(r.clicked)}</td><td>{fmtPct(r.clickRate)}</td><td>{fmtN(r.unsubscribed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
            ) : <NotAvailable />}
          </Card>
        </>
      )}
    </div>
  );
}

function Funnel({ f }: { f: Available<{ sent: number; opened: number; clicked: number; converted: number }> }) {
  const steps = [
    { label: 'Sent', v: n0(f.sent) },
    { label: 'Opened', v: n0(f.opened) },
    { label: 'Clicked', v: n0(f.clicked) },
    { label: 'Booked', v: n0(f.converted) },
  ];
  const max = steps[0].v;
  return (
    <div>
      <p className={styles.help}>Bars to scale of Sent · rates are of the step before · Booked counts journey exits with a booking.</p>
      <ol className={styles.funnel}>
        {steps.map((s, i) => {
          const w = max > 0 ? Math.max(s.v > 0 ? 2 : 0, (s.v / max) * 100) : 0;
          return (
            <li key={s.label} className={styles.funnelStep}>
              <div className={styles.funnelHead}>
                <span className={styles.funnelLabel}>{s.label}</span>
                <span className={styles.num}>{fmtN(s.v)}</span>
              </div>
              <div className={styles.funnelTrack}><div className={styles.funnelBar} style={{ width: `${w}%` }} /></div>
              {i > 0 && <span className={styles.help}>{fmtPct(rate(s.v, steps[i - 1].v))} of {steps[i - 1].label.toLowerCase()}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TrendChart({ weeks }: { weeks: { week: string; openRate: number; clickRate: number; sent: number }[] }) {
  const rows = weeks.map(w => ({ week: shortDate(w.week), openRate: n0(w.openRate), clickRate: n0(w.clickRate), sent: n0(w.sent) }));
  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 12, fill: 'var(--ink3)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 12, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => fmtPct(v)} labelFormatter={(l) => `Week of ${String(l)}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="openRate" name="Open rate" stroke="var(--gold)" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="clickRate" name="Click rate" stroke="var(--info)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
      <p className={styles.help}>Weeks start Monday (Dubai time). Rates are of emails sent that week.</p>
    </div>
  );
}
