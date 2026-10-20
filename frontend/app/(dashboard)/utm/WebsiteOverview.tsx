'use client';

/**
 * Website overview (top of /utm, "Website & links"), written for marketing users:
 * a period picker, an "At a glance" row of four KPI tiles (each with a plain-English
 * help line), visits per day, what people did and the most visited pages.
 * All numbers come from GET /api/v3/overview/website. A section the API marks
 * `available:false` (or omits) shows "Not available right now" — never placeholder numbers.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { getOverviewWebsite } from '@/lib/api';
import type { OverviewSection, OverviewWebsite } from '@/lib/api';
import { Button, Chip, ErrorState, Skeleton } from '@/components/ui';
import styles from './website.module.css';

type Available<T> = { available: true } & T;
type Days = 7 | 30 | 90;

export const PERIODS: readonly { days: Days; label: string }[] = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const UNAVAILABLE = 'Not available right now';
const LIST_LIMIT = 8;
const SLOW_MS = 8000;
const RETRY_DELAY_MS = 1500;
const AREA_COLOR = 'var(--gold)';
const AREA_STROKE = 'var(--gold-ink)';
const tick = { fontSize: 11, fill: 'var(--ink3)' };

function isAvail<T>(s: OverviewSection<T> | undefined | null): s is Available<T> {
  return !!s && typeof s === 'object' && s.available === true;
}

/** Today's date in Dubai (UTC+4, no DST), YYYY-MM-DD — matches the backend's range parsing. */
export function periodTo(now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD for `days - 1` days before today in Dubai (so the range includes today). */
export function periodFrom(days: number, now: Date = new Date()): string {
  const to = periodTo(now);
  return new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** Formats a count with thousands separators; missing or non-finite values render as an em dash, never NaN. */
export function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

const n0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** "13 Oct" (or "13 Oct 2026" when withYear). Never echoes a raw ISO string. */
export function shortDate(iso: string | null | undefined, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(iso ?? '')?.[0];
  const t = day ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
    ...(opts.year ? { year: 'numeric' } : {}), ...(opts.weekday ? { weekday: 'short' } : {}),
  });
}

/** Path + query of a URL; anything that isn't a URL is shown as-is. */
export function pagePath(url: string): string {
  try { const u = new URL(url); return (u.pathname + u.search) || '/'; } catch { return url; }
}

const EVENT_NAMES: Record<string, string> = {
  page_view: 'Viewed a page',
  view_item: 'Viewed a product',
  view_item_list: 'Viewed a product list',
  select_item: 'Chose a product',
  add_to_cart: 'Added to cart',
  remove_from_cart: 'Removed from cart',
  view_cart: 'Viewed the cart',
  add_to_wishlist: 'Added to wishlist',
  begin_checkout: 'Started checkout',
  add_payment_info: 'Added payment details',
  add_shipping_info: 'Added booking details',
  purchase: 'Booked',
  search: 'Searched',
  view_search_results: 'Viewed search results',
  login: 'Logged in',
  sign_up: 'Signed up',
  generate_lead: 'Sent an enquiry',
  form_submit: 'Submitted a form',
  scroll: 'Scrolled a page',
  click: 'Clicked a link',
  session_start: 'Started a visit',
  first_visit: 'First visit',
  user_engagement: 'Spent time on a page',
  'gtm.js': 'Page loaded',
  'gtm.dom': 'Page ready',
  'gtm.load': 'Page fully loaded',
  'gtm.click': 'Clicked something',
  'gtm.linkClick': 'Clicked a link',
  'gtm.formSubmit': 'Submitted a form',
  'gtm.scrollDepth': 'Scrolled a page',
};

/** Plain-English name for a tracking event: known names are mapped, others are humanised. */
export function eventLabel(name: string | null | undefined): string {
  const raw = String(name ?? '').trim();
  if (!raw) return 'Unnamed event';
  const known = EVENT_NAMES[raw] ?? EVENT_NAMES[raw.toLowerCase()];
  if (known) return known;
  const words = raw
    .replace(/^gtm\./i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : raw;
}

function Tile({ label, help, value, extra, testId }: {
  label: string; help: string; value: string | null; extra?: ReactNode; testId: string;
}) {
  return (
    <div className={styles.tile} data-testid={testId}>
      <span className={styles.tileLabel}>{label}</span>
      <div className={styles.valueRow}>
        <span className={styles.value}>{value ?? '—'}</span>
        {value != null && extra}
      </div>
      <p className={styles.help}>{value == null ? UNAVAILABLE : help}</p>
    </div>
  );
}

/** Horizontal bars with counts; shows the first 8 with a "Show all" toggle. */
function BarList({ label, rows, unit }: {
  label: string; unit: string;
  rows: { key: string; text: string; title: string; count: number }[];
}) {
  const [all, setAll] = useState(false);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const shown = all ? rows : rows.slice(0, LIST_LIMIT);
  return (
    <>
      <ol className={styles.bars} aria-label={label}>
        {shown.map(r => (
          <li key={r.key} className={styles.barRow} title={`${r.title} · ${fmtNum(r.count)} ${unit}`}>
            <span className={styles.barTrack} aria-hidden="true">
              <span className={styles.barFill} style={{ width: `${max > 0 ? Math.max(r.count > 0 ? 2 : 0, (r.count / max) * 100) : 0}%` }} />
            </span>
            <span className={styles.barText}>{r.text}</span>
            <span className={styles.barNum}>{fmtNum(r.count)}</span>
          </li>
        ))}
      </ol>
      {rows.length > LIST_LIMIT && (
        <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${fmtNum(rows.length)}`}
        </button>
      )}
    </>
  );
}

interface DayRow { date: string; label: string; full: string; events: number }

function isDayRow(v: unknown): v is DayRow {
  return !!v && typeof v === 'object' && 'full' in v && 'events' in v;
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !isDayRow(row)) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{row.full}</div>
      <div>{fmtNum(row.events)} {row.events === 1 ? 'visit' : 'visits'}</div>
    </div>
  );
}

function VisitsChart({ days }: { days: { date: string; events: number }[] }) {
  const rows: DayRow[] = days
    .map(d => ({ date: d.date, label: shortDate(d.date), full: shortDate(d.date, { weekday: true, year: true }), events: n0(d.events) }))
    .filter(r => r.label);
  const total = rows.reduce((s, r) => s + r.events, 0);
  if (rows.length === 0 || total === 0) return <p className={styles.empty}>No website visits in this period</p>;
  const busiest = rows.reduce((b, r) => (r.events > b.events ? r : b), rows[0]);
  const aria = `Website visits per day, ${fmtNum(total)} in total over ${fmtNum(rows.length)} ${rows.length === 1 ? 'day' : 'days'}. `
    + `Busiest day ${busiest.full} with ${fmtNum(busiest.events)}.`;
  return (
    <div className={styles.plot} role="img" aria-label={aria}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id="websiteVisitsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AREA_COLOR} stopOpacity={0.45} />
              <stop offset="100%" stopColor={AREA_COLOR} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={20} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={48} allowDecimals={false}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
          <Tooltip content={<DayTooltip />} cursor={{ stroke: 'var(--ink3)', strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="events" name="Visits" stroke={AREA_STROKE} strokeWidth={2} fill="url(#websiteVisitsFill)"
            dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2, fill: AREA_STROKE }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function isPayload(v: unknown): v is OverviewWebsite {
  return !!v && typeof v === 'object'
    && ['eventsPerDay', 'topEvents', 'topPages', 'lastHour', 'utmLinks'].some(k => k in v);
}

export default function WebsiteOverview() {
  const [days, setDays] = useState<Days>(7);
  const [data, setData] = useState<OverviewWebsite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  // Each load gets an id so a slow response for an old period can't overwrite a newer one.
  const reqId = useRef(0);
  const load = useCallback(async (d: Days) => {
    const id = ++reqId.current;
    const from = periodFrom(d);
    const to = periodTo();
    setLoading(true);
    setError(null);              // show the loading state, not the previous error, while retrying
    setSlow(false);
    const slowTimer = setTimeout(() => { if (id === reqId.current) setSlow(true); }, SLOW_MS);
    try {
      let res: unknown;
      try {
        res = await getOverviewWebsite(from, to);
      } catch (e) {
        // A dropped connection (e.g. the server restarting) gets one quiet retry before an error is shown.
        if (!(e instanceof TypeError)) throw e;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        if (id !== reqId.current) return;
        res = await getOverviewWebsite(from, to);
      }
      if (id !== reqId.current) return;
      if (!isPayload(res)) {
        setData(null);
        setError('The server returned an unexpected response.');
        return;
      }
      setData(res);
    } catch (e) {
      if (id !== reqId.current) return;
      setData(null);
      setError(e instanceof Error && e.message ? e.message : 'Failed to load website activity');
    } finally {
      clearTimeout(slowTimer);
      if (id === reqId.current) { setLoading(false); setSlow(false); }
    }
  }, []);

  useEffect(() => { void load(days); }, [days, load]);
  const retry = () => { void load(days); };

  const range = data?.range;
  const fromText = shortDate(range?.from ?? periodFrom(days));
  const toText = shortDate(range?.to ?? periodTo(), { year: true });
  const rangeText = fromText && toText ? `${fromText} – ${toText}` : '';

  const eventsPerDay = data?.eventsPerDay;
  const topEvents = data?.topEvents;
  const topPages = data?.topPages;
  const lastHour = data?.lastHour;
  const utmLinks = data?.utmLinks;
  const dayList = isAvail(eventsPerDay) && Array.isArray(eventsPerDay.days) ? eventsPerDay.days : null;
  const totalVisits = dayList ? dayList.reduce((s, d) => s + n0(d.events), 0) : null;
  const hourCount = isAvail(lastHour) ? n0(lastHour.count) : null;
  const totals = isAvail(utmLinks) && utmLinks.totals ? utmLinks.totals : null;
  // Only show what has data: unavailable or empty sections are left out.
  const showNow = hourCount != null;
  const showVisits = totalVisits != null && totalVisits > 0;
  const showLinks = !!totals && n0(totals.links) > 0;
  const showChart = !!dayList && (totalVisits ?? 0) > 0;
  const eventRows = isAvail(topEvents) && Array.isArray(topEvents.events)
    ? topEvents.events.map((e, i) => ({
        key: `${e.name}-${i}`, text: eventLabel(e.name),
        title: `${eventLabel(e.name)} (${e.name})${Number.isFinite(Number(e.uniqueUsers)) ? ` · ${fmtNum(e.uniqueUsers)} people` : ''}`,
        count: n0(e.count),
      }))
    : [];
  const pageRows = isAvail(topPages) && Array.isArray(topPages.pages)
    ? topPages.pages.map((p, i) => ({ key: `${p.url}-${i}`, text: pagePath(p.url), title: p.url, count: n0(p.count) }))
    : [];

  return (
    <section className={styles.overview} aria-label="Website activity">
      <div className={styles.periodRow}>
        <div className={styles.seg} role="group" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.days} type="button" className={days === p.days ? styles.segOn : styles.segBtn}
              aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        {rangeText && <span className={styles.periodMeta}>{rangeText}</span>}
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={retry} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className={styles.body} data-testid="website-loading" aria-busy="true">
          {slow && <p className={styles.slowNote} role="status">Still working on it… there is a lot of data for this period, this can take up to a minute.</p>}
          <div className={styles.kpiGrid}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={styles.tile}>
                <Skeleton height={12} width="55%" /><Skeleton height={24} width="60%" /><Skeleton height={10} width="90%" />
              </div>
            ))}
          </div>
          <div className={styles.charts}>
            {[0, 1, 2].map(i => (
              <div key={i} className={styles.panel} data-testid="website-skeleton-panel"><Skeleton height={14} width="40%" /><Skeleton height={170} /></div>
            ))}
          </div>
        </div>
      ) : error || !data ? (
        <ErrorState title="Couldn't load website activity"
          description="The link tools below still work."
          details={error ?? undefined}
          action={<Button size="sm" onClick={retry}>Try again</Button>} />
      ) : (
        <div className={styles.body}>
          {/* Sections with no data are left out entirely instead of showing empty boxes. */}
          {(showNow || showVisits || showLinks) && (
            <section aria-label="At a glance">
              <h2 className={styles.glanceTitle}>At a glance</h2>
              <div className={styles.kpiGrid}>
                {showNow && hourCount != null && (
                  <Tile testId="kpi-now" label="Visits right now" help="Website activity in the last hour"
                    value={fmtNum(hourCount)}
                    extra={hourCount > 0
                      ? <Chip tone="ok" dot>Tracking is live</Chip>
                      : <Chip tone="mute">No visits this hour</Chip>} />
                )}
                {showVisits && totalVisits != null && (
                  <Tile testId="kpi-visits" label="Website visits" help="Everything people did on the site in this period"
                    value={fmtNum(totalVisits)} />
                )}
                {showLinks && totals && (
                  <>
                    <Tile testId="kpi-links" label="Tracked links" help="Personal links sent in campaigns"
                      value={fmtNum(totals.links)}
                      extra={<span className={styles.valueSub}>{fmtNum(totals.clickedLinks)} clicked</span>} />
                    <Tile testId="kpi-clicks" label="Link clicks" help="Times those links were opened"
                      value={fmtNum(totals.clicks)}
                      extra={<span className={styles.valueSub}>{fmtNum(totals.uniqueUsers)} people</span>} />
                  </>
                )}
              </div>
            </section>
          )}

          {(showChart || eventRows.length > 0 || pageRows.length > 0) && (
            <div className={styles.charts}>
              {showChart && dayList && (
                <section className={`${styles.panel} ${styles.chartPanel}`} aria-label="Visits per day">
                  <div className={styles.panelHead}>
                    <h3 className={styles.panelTitle}>Visits per day</h3>
                    {totalVisits != null && <span className={styles.panelMeta}>{fmtNum(totalVisits)} in total</span>}
                  </div>
                  <VisitsChart days={dayList} />
                </section>
              )}

              {eventRows.length > 0 && (
                <section className={styles.panel} aria-label="What people did">
                  <div className={styles.panelHead}>
                    <h3 className={styles.panelTitle}>What people did</h3>
                    <span className={styles.panelMeta}>Times</span>
                  </div>
                  <BarList label="What people did" unit="times" rows={eventRows} />
                </section>
              )}

              {pageRows.length > 0 && (
                <section className={styles.panel} aria-label="Most visited pages">
                  <div className={styles.panelHead}>
                    <h3 className={styles.panelTitle}>Most visited pages</h3>
                    <span className={styles.panelMeta}>Visits</span>
                  </div>
                  <BarList label="Most visited pages" unit="visits" rows={pageRows} />
                </section>
              )}
            </div>
          )}

          {!showNow && !showVisits && !showLinks && !showChart && eventRows.length === 0 && pageRows.length === 0 && (
            <p className={styles.empty}>No website activity in {rangeText ? rangeText : 'this period'}.</p>
          )}
        </div>
      )}
    </section>
  );
}
