'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  GitBranch, Users, Send, Clock, Mail, Eye, TrendingUp, Target,
  AlertTriangle, RefreshCw, Sparkles, Calendar,
  ChevronRight, ChevronDown, Layers, X, Loader2, Search,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Card, ErrorState, Input, PageHeader, Skeleton, StatusChip } from '@/components/ui';
import { SegmentPager } from '@/components/ui/SegmentPager';
import type { ChipTone } from '@/components/ui';
import styles from './monitor.module.css';
import { getJourneyOpsDashboard, getJourneyNodeBreakdown, getJourneysActiveOnDate, previewJourneyNodeEmail } from '@/lib/api';

const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

const LIST_PAGE = 10;
const PALETTE = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-2)', 'var(--chart-4)', 'var(--chart-5)', '#2E8C8C', '#B5617E', '#5A6F9C', '#8C7A3E', '#4F7D4F'];
const n0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtN = (v: unknown) => n0(v).toLocaleString();

type JourneyStatus = 'active' | 'paused' | 'completed' | 'draft';
type NodeType = 'action' | 'wait' | 'condition' | 'goal' | 'trigger';
type JourneyId = string | number;
interface JNode {
  nodeId: string; label: string; type: NodeType; count: number;
  running?: number; active?: number; scheduled?: number; scheduledOnDate?: number;
  fired?: boolean; total?: number; waitDays?: number; dayNumber?: number | null;
  delivered?: number; opened?: number; clicked?: number; failed: number;
  openRate?: number | null; clickRate?: number | null; hasTemplate?: boolean;
}
interface ForecastItem { journeyId: JourneyId; nodeId: string; journeyName: string; dayNumber?: number | null; label: string; sendHour?: number | string | null; approximate?: boolean; count: number }
interface ForecastDay { date: string; total: number; items: ForecastItem[] }
interface RunningJourney { journeyId: JourneyId; journeyName: string; nodes: JNode[] }
interface OpsJourney {
  journeyId: JourneyId; name: string; status: JourneyStatus; nodes: JNode[];
  sentOnDate: number; scheduledOnDate: number; activeEntries: number; nextFire?: string | null;
  sendsToday: number; openRate: number; conversions: number;
}
interface OpsKpis { activeJourneys?: number; activeEntries?: number; sendsToday?: number; sendsTomorrow?: number; queuedNow?: number; openRate7d?: number; conversions7d?: number }
interface OpsHealth { aiFallback?: { dayNumber?: number; templateId?: number | string }[]; stuckEntries?: { name: string; count: number }[] }
interface OpsDashboard {
  generatedAt?: string; kpis?: OpsKpis; forecast?: ForecastDay[]; forecastChart?: Record<string, string | number>[];
  forecastJourneyNames?: string[]; runningNow?: RunningJourney[]; engagement?: Record<string, string | number>[];
  journeys?: OpsJourney[]; health?: OpsHealth;
}
interface NodeDetail { loading: boolean; nodes?: JNode[]; error?: string }
interface ByDateState { loading: boolean; journeys: OpsJourney[]; error: string | null; isToday?: boolean }
interface ByDateRes { data?: { journeys?: OpsJourney[]; isToday?: boolean } }
interface TemplateModalState { journeyName: string; label: string; loading: boolean; html?: string; subject?: string; error?: string }


function dayLabel(dateStr: string) {
  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 4 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}
function fmtHour(h: number | string | null | undefined) {
  if (h === null || h === undefined) return null;
  if (typeof h === 'number') return `${String(h).padStart(2, '0')}:00`;
  return String(h);
}
function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export default function JourneyDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<OpsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Journeys accordion. Date mode (default today): only journeys+nodes active on
  // that date, fetched filtered from the backend. All-time mode ('' date): the full
  // journey list with lazily-loaded per-node breakdowns.
  const [journeyDate, setJourneyDate] = useState(''); // default = all time (no date scope)
  const [statusFilter, setStatusFilter] = useState('all'); // journey status filter
  const [journeyQuery, setJourneyQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  useEffect(() => { setListPage(1); }, [statusFilter, journeyQuery]);
  const [expanded, setExpanded] = useState(() => new Set<JourneyId>());
  const [nodeDetails, setNodeDetails] = useState<Record<string, NodeDetail>>({}); // all-time: journeyId → { loading, nodes, error }
  const [byDate, setByDate] = useState<ByDateState>({ loading: true, journeys: [], error: null, isToday: true });
  const [templateModal, setTemplateModal] = useState<TemplateModalState | null>(null);

  // Date mode → fetch the filtered journeys (+ relevant nodes inline) for the date
  useEffect(() => {
    if (!journeyDate) return; // all-time mode uses the dashboard journey list
    let cancelled = false;
    setByDate(prev => ({ ...prev, loading: true }));
    getJourneysActiveOnDate(journeyDate)
      .then(res => { if (!cancelled) setByDate({ loading: false, journeys: (res as ByDateRes).data?.journeys || [], isToday: (res as ByDateRes).data?.isToday, error: null }); })
      .catch((e: Error) => { if (!cancelled) setByDate({ loading: false, journeys: [], error: e.message }); });
    return () => { cancelled = true; };
  }, [journeyDate]);

  const fetchBreakdown = async (journeyId: JourneyId) => {
    setNodeDetails(prev => ({ ...prev, [journeyId]: { ...(prev[journeyId] || {}), loading: true } }));
    try {
      const res = await getJourneyNodeBreakdown(journeyId) as { data?: { nodes?: JNode[] } };
      setNodeDetails(prev => ({ ...prev, [journeyId]: { loading: false, nodes: res.data?.nodes || [] } }));
    } catch (e) {
      setNodeDetails(prev => ({ ...prev, [journeyId]: { loading: false, error: (e as Error).message } }));
    }
  };

  const toggleJourney = (journeyId: JourneyId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(journeyId)) { next.delete(journeyId); return next; }
      next.add(journeyId);
      // All-time mode lazily loads the full node list; date mode has nodes inline
      if (!journeyDate && !nodeDetails[journeyId]) fetchBreakdown(journeyId);
      return next;
    });
  };

  const openTemplate = async (journeyId: JourneyId, node: JNode, journeyName: string) => {
    setTemplateModal({ journeyName, label: node.label, loading: true });
    try {
      const res = await previewJourneyNodeEmail(journeyId, node.nodeId) as { data?: { html?: string; subject?: string } };
      setTemplateModal({ journeyName, label: node.label, loading: false, html: res.data?.html, subject: res.data?.subject });
    } catch (e) {
      setTemplateModal({ journeyName, label: node.label, loading: false, error: (e as Error).message });
    }
  };

  const load = async (isRefresh?: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await getJourneyOpsDashboard(isRefresh ? { fresh: true } : {}) as { data: OpsDashboard };
      setData(res.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load dashboard');
    } finally { setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  // NOTE: we intentionally DON'T block the whole page on `loading`. The header and the
  // (independently-fetched) date accordion render immediately; each dashboard section shows
  // its own inline skeleton until `data` arrives — so content appears progressively instead
  // of the user staring at a blank page until every query finishes.
  if (error && !data) {
    return (
      <div className={styles.page}>
        <PageHeader title="Journey monitor" breadcrumbs={[{ label: 'Journeys', href: '/journeys' }, { label: 'Journey monitor' }]} />
        <ErrorState
          title="Couldn't load the journey monitor"
          description={error}
          action={<Button size="sm" onClick={() => load()}><RefreshCw size={14} aria-hidden="true" /> Retry</Button>}
        />
      </div>
    );
  }

  const loaded = !!data;
  const {
    kpis = {}, forecast = [], forecastChart = [], forecastJourneyNames = [],
    runningNow = [], engagement = [], journeys = [], health = {},
  } = data || {} as OpsDashboard;
  const colorFor = (name: string) => PALETTE[Math.max(0, forecastJourneyNames.indexOf(name)) % PALETTE.length];
  const SectionSkeleton = ({ h = 240 }: { h?: number }) => <Skeleton height={h} radius={10} />;

  const KPIS: { label: string; value: string; icon: LucideIcon }[] = [
    { label: 'Active Journeys', value: fmtN(kpis.activeJourneys), icon: GitBranch },
    { label: 'Active Enrollments', value: fmtN(kpis.activeEntries), icon: Users },
    { label: 'Sends Today', value: fmtN(kpis.sendsToday), icon: Send },
    { label: 'Sends Tomorrow', value: fmtN(kpis.sendsTomorrow), icon: Calendar },
    { label: 'Queued Now', value: fmtN(kpis.queuedNow), icon: Clock },
    { label: 'Open Rate (7d)', value: `${n0(kpis.openRate7d)}%`, icon: Eye },
    { label: 'Conversions (7d)', value: fmtN(kpis.conversions7d), icon: TrendingUp },
  ];

  const hasFallback = (health.aiFallback?.length ?? 0) > 0;
  const hasStuck = (health.stuckEntries?.length ?? 0) > 0;

  // Journey status filter — chips are built from whatever statuses are actually present
  // in the current list (all-time = ops-dashboard journeys; date mode = byDate journeys).
  const journeyList = journeyDate ? byDate.journeys : journeys;
  const statusCounts = journeyList.reduce<Record<string, number>>((m, j) => { m[j.status] = (m[j.status] || 0) + 1; return m; }, {});
  const statusChips = ['all', ...Object.keys(statusCounts).sort()];
  const statusMatch = (j: OpsJourney) => statusFilter === 'all' || j.status === statusFilter;
  const q = journeyQuery.trim().toLowerCase().replace(/^#/, '');
  const queryMatch = (j: OpsJourney) => !q || String(j.journeyId) === q || (j.name || '').toLowerCase().includes(q);
  const visibleJourneys = journeyList.filter(j => statusMatch(j) && queryMatch(j));
  // All-time mode lists every journey: page it in the browser (the payload is already here) so
  // the DOM stays small; the date mode shows only that day's journeys and is left as is.
  const listPages = Math.max(1, Math.ceil(visibleJourneys.length / LIST_PAGE));
  const pagedJourneys = visibleJourneys.slice((listPage - 1) * LIST_PAGE, listPage * LIST_PAGE);
  const openJourney = (id: JourneyId) => router.push(`/journeys/${id}`);
  const tickStyle = { fontSize: 11, fill: 'var(--ink3)' };
  const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--ink)' };

  const journeyHead = (j: OpsJourney, isOpen: boolean, sub: ReactNode, extra?: ReactNode) => (
    <div
      className={styles.jhead}
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={() => toggleJourney(j.journeyId)}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleJourney(j.journeyId); } }}
    >
      <ChevronDown size={16} className={[styles.caret, isOpen ? '' : styles.caretClosed].filter(Boolean).join(' ')} aria-hidden="true" />
      <div className={styles.jmain}>
        <div className={styles.jname}>{j.name}</div>
        <div className={styles.jsub}>{sub}</div>
      </div>
      <StatusPill status={j.status} />
      {extra}
      <Button size="sm" icon title="Open journey" aria-label={`Open journey ${j.name}`}
        onClick={e => { e.stopPropagation(); openJourney(j.journeyId); }}>
        <ChevronRight size={14} aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="Journey monitor"
        breadcrumbs={[{ label: 'Journeys', href: '/journeys' }, { label: 'Journey monitor' }]}
        description={<>What&apos;s running, what&apos;s sending today &amp; tomorrow, and journey health <span className={styles.updated}>{loaded ? `· updated ${fmtDateTime(data?.generatedAt)}` : '· loading…'}</span></>}
        actions={
          <Button size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? styles.spin : undefined} aria-hidden="true" /> Refresh
          </Button>
        }
      />

      {/* Health alerts (top, only if present) */}
      {(hasFallback || hasStuck) && (
        <div className={styles.alerts}>
          {hasStuck && health.stuckEntries && (
            <div className={`${styles.alert} ${styles.alertBad}`} role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>{fmtN(health.stuckEntries.reduce((s, x) => s + n0(x.count), 0))} entries are overdue</strong> (next_fire_at &gt; 1h in the past) across {health.stuckEntries.length} journey(s) — the worker may not be processing. {health.stuckEntries.slice(0, 3).map(s => `${s.name} (${n0(s.count)})`).join(', ')}
              </div>
            </div>
          )}
          {hasFallback && health.aiFallback && (
            <div className={`${styles.alert} ${styles.alertWarn}`} role="status">
              <Sparkles size={18} aria-hidden="true" />
              <div>
                <strong>{health.aiFallback.length} of today&apos;s daily templates used fallback (non-AI) content</strong> — Claude rendering failed for Day {health.aiFallback.map(f => f.dayNumber || f.templateId).join(', ')}. Recipients today get degraded content.
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPI strip */}
      <div className={styles.kpiGrid}>
        {!loaded
          ? [...Array<undefined>(7)].map((_, i) => <Skeleton key={i} height={86} radius={12} />)
          : KPIS.map(k => (
            <div key={k.label} className={styles.kpi}>
              <span className={styles.eyebrow}><k.icon size={14} aria-hidden="true" /> {k.label}</span>
              <span className={styles.kpiValue}>{k.value}</span>
            </div>
          ))}
      </div>

      {/* ── Send Forecast ── */}
      <Card>
        <SectionTitle icon={Calendar} title="Send Forecast — next 7 days"
          subtitle="Scheduled emails per day, resolved to the exact journey · node · template that will fire" />
        {!loaded ? (
          <SectionSkeleton h={240} />
        ) : forecastChart.length === 0 ? (
          <Empty text="No journey sends scheduled in the next 7 days" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={forecastChart} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={tickStyle} axisLine={false} tickLine={false} />
                <YAxis tick={tickStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={dayLabel as (label: ReactNode) => string} />
                {forecastJourneyNames.map(name => (
                  <Bar key={name} dataKey={name} stackId="a" fill={colorFor(name)} radius={[3, 3, 0, 0]} maxBarSize={48} />
                ))}
              </BarChart>
            </ResponsiveContainer>

            {/* Day-by-day breakdown */}
            <div className={styles.days}>
              {forecast.map(day => (
                <div key={day.date}>
                  <div className={styles.dayHead}>
                    <span className={styles.dayName}>{dayLabel(day.date)}</span>
                    <span className={styles.dayMeta}>{day.date} · {fmtN(day.total)} sends</span>
                  </div>
                  <div className={styles.items}>
                    {day.items.map(it => (
                      <div key={`${it.journeyId}-${it.nodeId}`} className={styles.item} role="link" tabIndex={0}
                        onClick={() => openJourney(it.journeyId)}
                        onKeyDown={e => { if (e.key === 'Enter') openJourney(it.journeyId); }}>
                        <span className={styles.dot} style={{ background: colorFor(it.journeyName) }} aria-hidden="true" />
                        <div className={styles.itemMain}>
                          <div className={styles.itemName}>{it.journeyName}</div>
                          <div className={styles.itemSub}>
                            {it.dayNumber ? <span className={styles.dayTag}>DAY {it.dayNumber}</span> : null}
                            <span>{it.label}</span>
                            <span>· {it.nodeId}</span>
                            {fmtHour(it.sendHour) && <span>· {fmtHour(it.sendHour)} GST</span>}
                            {it.approximate && <span className={styles.estimate} title="Path passes a condition node — exact email depends on the branch">· branch est.</span>}
                          </div>
                        </div>
                        <span className={styles.itemCount}>{fmtN(it.count)}</span>
                        <ChevronRight size={15} className={styles.chev} aria-hidden="true" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <div className={styles.twoCol}>
        {/* ── Running now ── */}
        <Card>
          <SectionTitle icon={Layers} title="Running now" subtitle="Where every active enrollment currently sits" />
          {!loaded ? <SectionSkeleton h={180} /> : runningNow.length === 0 ? <Empty text="No active enrollments" /> : (
            <div className={styles.running}>
              {runningNow.map(j => {
                const total = j.nodes.reduce((s, n) => s + n0(n.count), 0);
                return (
                  <div key={j.journeyId}>
                    <button type="button" className={styles.runHead} onClick={() => openJourney(j.journeyId)}>
                      <span className={styles.runName}>{j.journeyName}</span>
                      <span className={styles.runCount}>{fmtN(total)} active</span>
                    </button>
                    <div className={styles.stack}>
                      {j.nodes.map((n, i) => (
                        <div key={n.nodeId} title={`${n.label}: ${n0(n.count)}`}
                          style={{ width: `${total > 0 ? (n0(n.count) / total) * 100 : 0}%`, background: PALETTE[i % PALETTE.length] }} />
                      ))}
                    </div>
                    <div className={styles.legend}>
                      {j.nodes.map((n, i) => (
                        <span key={n.nodeId} className={styles.legendItem}>
                          <span className={styles.swatch} style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden="true" />
                          {n.label} <strong>{n0(n.count)}</strong>
                          {n.type === 'wait' && <Clock size={10} aria-label="wait" />}
                          {n.type === 'action' && <Mail size={10} aria-label="email" />}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Engagement timeseries ── */}
        <Card>
          <SectionTitle icon={TrendingUp} title="Engagement (30 days)" subtitle="Delivered · Opened · Clicked across all journey sends" />
          {!loaded ? <SectionSkeleton h={240} /> : engagement.length === 0 ? <Empty text="No journey sends in the last 30 days" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={engagement} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} tick={tickStyle} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={tickStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="delivered" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="opened" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="clicked" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ── Per-journey accordion ── */}
      <Card>
        <div className={styles.accHead}>
          <div className={styles.accTitle}>
            <SectionTitle icon={GitBranch} title="Journeys"
              subtitle={journeyDate
                ? `Only journeys with a node fired, running or scheduled on ${dayLabel(journeyDate)}`
                : 'Expand a journey to see per-node delivery, opens, clicks & templates'} />
          </div>
          <div className={styles.dateCtl}>
            <Calendar size={15} aria-hidden="true" />
            <Input type="date" aria-label="Scope to date" value={journeyDate} onChange={e => setJourneyDate(e.target.value)} />
            <Button size="sm" onClick={() => setJourneyDate(dubaiToday())} title="Scope to today">Today</Button>
            <Button size="sm" onClick={() => setJourneyDate('')} disabled={!journeyDate} title="Show all journeys, all nodes (no date scope)">
              <X size={13} aria-hidden="true" /> All time
            </Button>
          </div>
        </div>

        {/* Search + status filter chips — built from whatever statuses are present */}
        <div className={styles.listTools}>
          <div className={styles.listSearch}>
            <Search size={13} aria-hidden="true" />
            <input className={styles.listSearchInput} value={journeyQuery} onChange={e => setJourneyQuery(e.target.value)} placeholder="Search journey name or #id" aria-label="Search journeys" />
            {journeyQuery && <button type="button" className={styles.listSearchClear} aria-label="Clear journey search" onClick={() => setJourneyQuery('')}><X size={12} /></button>}
          </div>
        </div>
        <div className={styles.filters} role="group" aria-label="Filter by status">
          {statusChips.map(s => {
            const on = statusFilter === s;
            const count = s === 'all' ? journeyList.length : statusCounts[s];
            return (
              <button key={s} type="button" aria-pressed={on} className={on ? styles.filterOn : styles.filter} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'All' : s} <span className={styles.filterCount}>{count ?? 0}</span>
              </button>
            );
          })}
        </div>

        {journeyDate ? (
          // ── Date mode: filtered journeys with relevant nodes inline ──
          byDate.loading ? (
            <div className={styles.inlineMsg}><Loader2 size={14} className={styles.spin} aria-hidden="true" /> Loading journeys for {dayLabel(journeyDate)}…</div>
          ) : byDate.error ? (
            <div className={styles.inlineErr} role="alert">{byDate.error}</div>
          ) : visibleJourneys.length === 0 ? (
            <Empty text={`No ${statusFilter === 'all' ? '' : statusFilter + ' '}journey has a node fired, running or scheduled on ${dayLabel(journeyDate)}`} />
          ) : (
            <div className={styles.list}>
              {visibleJourneys.map(j => {
                const isOpen = expanded.has(j.journeyId);
                const nodes = j.nodes || [];
                return (
                  <div key={j.journeyId} className={styles.jrow}>
                    {journeyHead(j, isOpen, <>{nodes.length} node{nodes.length > 1 ? 's' : ''} on {dayLabel(journeyDate)} · {fmtN(j.sentOnDate)} sent · {fmtN(j.scheduledOnDate)} scheduled</>)}
                    {isOpen && (
                      <div className={styles.jbody}>
                        <NodeTable nodes={nodes} dateActive onViewTemplate={(n) => openTemplate(j.journeyId, n, j.name)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : !loaded ? (
          <SectionSkeleton h={120} />
        ) : visibleJourneys.length === 0 ? (
          <Empty text={q ? `No journey matches “${journeyQuery.trim()}”` : `No ${statusFilter === 'all' ? '' : statusFilter + ' '}journeys`} />
        ) : (
          // ── All-time mode: full journey list; per-node breakdown is fetched LAZILY on expand ──
          <div className={styles.list}>
            {pagedJourneys.map(j => {
              const isOpen = expanded.has(j.journeyId);
              const det = nodeDetails[j.journeyId];
              return (
                <div key={j.journeyId} className={styles.jrow}>
                  {journeyHead(
                    j, isOpen,
                    <>{fmtN(j.activeEntries)} active · next fire {j.nextFire ? fmtDateTime(j.nextFire) : '—'}</>,
                    <div className={styles.jstats}>
                      <span className={styles.jstat} title="Sends today"><Send size={12} aria-label="Sends today" /> {fmtN(j.sendsToday)}</span>
                      <span className={styles.jstat} title="Open rate (7d)"><Eye size={12} aria-label="Open rate" /> {n0(j.openRate)}%</span>
                      <span className={styles.jstat} title="Conversions"><Target size={12} aria-label="Conversions" /> {fmtN(j.conversions)}</span>
                    </div>,
                  )}
                  {isOpen && (
                    <div className={styles.jbody}>
                      {!det || det.loading ? (
                        <div className={styles.inlineMsg}><Loader2 size={14} className={styles.spin} aria-hidden="true" /> Loading nodes…</div>
                      ) : det.error ? (
                        <div className={styles.inlineErr} role="alert">{det.error}</div>
                      ) : !det.nodes || det.nodes.length === 0 ? (
                        <Empty text="This journey has no nodes" />
                      ) : (
                        <NodeTable nodes={det.nodes} dateActive={false} onViewTemplate={(n) => openTemplate(j.journeyId, n, j.name)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {listPages > 1 && (
              <div className={styles.listPager}>
                <span className={styles.muted}>{(listPage - 1) * LIST_PAGE + 1}–{Math.min(listPage * LIST_PAGE, visibleJourneys.length)} of {visibleJourneys.length}</span>
                <SegmentPager page={listPage} totalPages={listPages} onPage={p => setListPage(p)} />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Template preview modal (action nodes) ── */}
      {templateModal && (
        <div className={styles.overlay} onClick={() => setTemplateModal(null)}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label={templateModal.label} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <Mail size={17} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={styles.modalTitle}>{templateModal.label}</div>
                <div className={styles.modalSub}>
                  {templateModal.journeyName}{templateModal.subject ? ` · ${templateModal.subject}` : ''}
                </div>
              </div>
              <Button variant="ghost" size="sm" icon aria-label="Close" onClick={() => setTemplateModal(null)}><X size={18} /></Button>
            </div>
            <div className={styles.modalBody}>
              {templateModal.loading ? (
                <div className={styles.modalMsg}>
                  <Loader2 size={20} className={styles.spin} aria-hidden="true" />
                  <div>Rendering the exact email that gets sent… (may take ~15-25s on a cache miss)</div>
                </div>
              ) : templateModal.error ? (
                <div className={styles.modalErr}>{templateModal.error}</div>
              ) : (
                <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={templateModal.html || ''} title={templateModal.label} className={styles.frame} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tabular per-node breakdown shown when a journey is expanded (both date + all-time modes).
interface NodeTableProps { nodes: JNode[]; dateActive?: boolean; onViewTemplate: (n: JNode) => void }
function NodeTable({ nodes, onViewTemplate }: NodeTableProps) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.ntable}>
        <thead>
          <tr>
            <th>Node</th>
            <th>Type</th>
            <th className={styles.r}>Delivered</th>
            <th className={styles.r}>Opened</th>
            <th className={styles.r}>Clicked</th>
            <th className={styles.r}>Failed</th>
            <th>State</th>
            <th aria-label="Template preview" />
          </tr>
        </thead>
        <tbody>
          {nodes.map(n => {
            const isAction = n.type === 'action';
            const running = n0(n.running ?? n.active);
            const scheduled = n0(n.scheduled ?? n.scheduledOnDate);
            const fired = n.fired ?? (n0(n.total) > 0);
            const stateBits: string[] = [];
            if (fired) stateBits.push('Fired');
            if (running > 0) stateBits.push(`▶ ${fmtN(running)}`);
            if (scheduled > 0) stateBits.push(`⏱ ${fmtN(scheduled)}`);
            if (n.type === 'wait') stateBits.push(`waits ${n.waitDays ?? 1}d`);
            return (
              <tr key={n.nodeId}>
                <td style={{ maxWidth: 320 }}>
                  {n.dayNumber ? <span className={styles.dayTag}>DAY {n.dayNumber}</span> : null}
                  <span className={styles.nodeName}>{n.label}</span>
                  <span className={styles.nodeId}> · {n.nodeId}</span>
                </td>
                <td className={styles.ntype}>{n.type}</td>
                <td className={styles.r}>{isAction ? fmtN(n.delivered) : '—'}</td>
                <td className={styles.r}>{isAction ? <>{fmtN(n.opened)}{n.openRate != null && <span className={styles.rate}>{n0(n.openRate)}%</span>}</> : '—'}</td>
                <td className={styles.r}>{isAction ? <>{fmtN(n.clicked)}{n.clickRate != null && <span className={styles.rate}>{n0(n.clickRate)}%</span>}</> : '—'}</td>
                <td className={styles.r}>{isAction && n0(n.failed) > 0 ? <span className={styles.failed}>{fmtN(n.failed)}</span> : '—'}</td>
                <td className={styles.state}>{stateBits.join(' · ') || '—'}</td>
                <td className={styles.r}>
                  {isAction && n.hasTemplate && (
                    <Button size="sm" onClick={() => onViewTemplate(n)}><Eye size={12} aria-hidden="true" /> Template</Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SectionTitleProps { icon: LucideIcon; title: string; subtitle?: string }
function SectionTitle({ icon: Icon, title, subtitle }: SectionTitleProps) {
  return (
    <div className={styles.sectionHead}>
      <h2 className={styles.sectionTitle}><Icon size={17} aria-hidden="true" /> {title}</h2>
      {subtitle && <p className={styles.sectionSub}>{subtitle}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}

const STATUS_TONE: Record<JourneyStatus, ChipTone> = { active: 'ok', paused: 'warn', completed: 'info', draft: 'mute' };
function StatusPill({ status }: { status: JourneyStatus }) {
  return <StatusChip tone={STATUS_TONE[status] ?? 'mute'}>{status}</StatusChip>;
}
