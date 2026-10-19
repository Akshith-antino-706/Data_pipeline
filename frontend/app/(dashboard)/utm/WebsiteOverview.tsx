'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { getOverviewWebsite, type OverviewWebsite } from '@/lib/api';
import { Card, Chip, EmptyState, ErrorState, Select, Skeleton, Table, Button } from '@/components/ui';
import styles from './website.module.css';

export const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

const UNAVAILABLE = 'Not available right now';

/** YYYY-MM-DD for `days - 1` days before today (so the range includes today). */
export function periodFrom(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - (days - 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Formats a count; non-finite values render as an en dash, never NaN. */
export function fmtNum(v: number | null | undefined): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '–';
}

function fmtDay(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtWhen(d: string | null): string {
  if (!d) return 'Never';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '–' : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function pagePath(url: string): string {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

function Unavailable() {
  return <p className={styles.unavailable}>{UNAVAILABLE}</p>;
}

function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className={`ui-card ${styles.kpi}`}>
      <span className={styles.eyebrow}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export default function WebsiteOverview() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<OverviewWebsite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOverviewWebsite(periodFrom(d));
      setData(res && typeof res === 'object' && 'eventsPerDay' in res ? res : null);
      if (!res || typeof res !== 'object' || !('eventsPerDay' in res)) setError('The server returned an unexpected response.');
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(days); }, [days, load]);

  const picker = (
    <Select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} className={styles.picker}>
      {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
    </Select>
  );

  if (loading && !data) {
    return (
      <section className={styles.wrap} aria-busy="true" aria-label="Website activity">
        <div className={styles.toolbar}>{picker}</div>
        <div className={styles.kpis}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} radius={12} />)}</div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className={styles.wrap} aria-label="Website activity">
        <div className={styles.toolbar}>{picker}</div>
        <ErrorState
          title="Couldn't load website activity"
          description="The link builder and saved links below still work."
          details={error ?? undefined}
          action={<Button variant="secondary" size="sm" onClick={() => void load(days)}>Try again</Button>}
        />
      </section>
    );
  }

  const { eventsPerDay, topEvents, topPages, lastHour, utmLinks } = data;
  const totalEvents = eventsPerDay.available ? eventsPerDay.days.reduce((s, d) => s + (Number(d.events) || 0), 0) : null;

  return (
    <section className={styles.wrap} aria-label="Website activity" aria-busy={loading}>
      <div className={styles.toolbar}>
        {picker}
        {data.range && <span className={styles.hint}>{fmtDay(data.range.from)} – {fmtDay(data.range.to)}</span>}
      </div>

      <div className={styles.kpis}>
        <Kpi label="Events in the last hour" value={lastHour.available ? fmtNum(lastHour.count) : UNAVAILABLE}
          hint={lastHour.available ? (lastHour.count > 0 ? <Chip tone="ok">Tracking is live</Chip> : <Chip tone="warn">No events this hour</Chip>) : undefined} />
        <Kpi label="Total events" value={totalEvents != null ? fmtNum(totalEvents) : UNAVAILABLE} hint={totalEvents != null ? 'In the selected period' : undefined} />
        <Kpi label="Tracked links" value={utmLinks.available ? fmtNum(utmLinks.totals.links) : UNAVAILABLE}
          hint={utmLinks.available ? `${fmtNum(utmLinks.totals.clickedLinks)} clicked` : undefined} />
        <Kpi label="Clicks" value={utmLinks.available ? fmtNum(utmLinks.totals.clicks) : UNAVAILABLE}
          hint={utmLinks.available ? `${fmtNum(utmLinks.totals.uniqueUsers)} people` : undefined} />
      </div>

      <Card title="Website events per day">
        {!eventsPerDay.available ? <Unavailable /> : eventsPerDay.days.length === 0 ? (
          <EmptyState title="No website events in this period" />
        ) : (
          <div className={styles.chart} role="img" aria-label={`Website events per day, ${fmtNum(totalEvents)} in total`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eventsPerDay.days} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: 'var(--ink3)' }} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ink3)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip labelFormatter={(l) => fmtDay(String(l))} formatter={(v) => [fmtNum(Number(v)), 'Events']}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="events" fill="var(--gold)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className={styles.two}>
        <Card title="Top events">
          {!topEvents.available ? <Unavailable /> : topEvents.events.length === 0 ? (
            <EmptyState title="No events yet" />
          ) : (
            <Table label="Top events">
              <thead><tr><th>Event</th><th className={styles.num}>Count</th><th className={styles.num}>People</th></tr></thead>
              <tbody>
                {topEvents.events.map((e) => (
                  <tr key={e.name}><td className={styles.mono}>{e.name}</td><td className={styles.num}>{fmtNum(e.count)}</td><td className={styles.num}>{fmtNum(e.uniqueUsers)}</td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Top pages">
          {!topPages.available ? <Unavailable /> : topPages.pages.length === 0 ? (
            <EmptyState title="No page views yet" />
          ) : (
            <Table label="Top pages">
              <thead><tr><th>Page</th><th className={styles.num}>Visits</th></tr></thead>
              <tbody>
                {topPages.pages.map((p) => (
                  <tr key={p.url}><td className={styles.url} title={p.url}>{pagePath(p.url)}</td><td className={styles.num}>{fmtNum(p.count)}</td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="Tracked links by campaign">
        {!utmLinks.available ? <Unavailable /> : utmLinks.campaigns.length === 0 ? (
          <EmptyState title="No tracked links yet" description="Personal links appear here once a campaign generates them." />
        ) : (
          <Table label="Tracked links by campaign">
            <thead><tr><th>Campaign</th><th>Channel</th><th className={styles.num}>Links</th><th className={styles.num}>Clicked</th><th className={styles.num}>Clicks</th><th>Last click</th></tr></thead>
            <tbody>
              {utmLinks.campaigns.map((c) => (
                <tr key={c.campaignId}>
                  <td><div className={styles.strong}>{c.name || `Campaign #${c.campaignId}`}</div>{c.segment && <div className={styles.hint}>{c.segment}</div>}</td>
                  <td>{c.channel ? <Chip tone="mute">{c.channel}</Chip> : '–'}</td>
                  <td className={styles.num}>{fmtNum(c.links)}</td>
                  <td className={styles.num}>{fmtNum(c.clickedLinks)}</td>
                  <td className={styles.num}>{fmtNum(c.clicks)}</td>
                  <td>{fmtWhen(c.lastClick)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
