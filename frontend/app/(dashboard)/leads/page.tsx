'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import {
  getChatLeadsSummary, getChatLeadsTrend, getMailLeadsSummary, getMailLeadsTrend,
  getChatLeadsDepartmentPeriods, getMailLeadsDepartmentPeriods, getChatLeadsDepartmentUsers,
  getDepartmentGroups, deleteDepartmentGroup,
} from '@/lib/api';
import { MessageSquare, Mail, Users, Loader2, Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';
import { Chip, StatusChip } from '@/components/ui/Chip';
import { Tabs } from '@/components/ui/Tabs';
import { Table } from '@/components/ui/Table';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import GroupDepartmentModal from './GroupDepartmentModal';
import RegistrationPanel, { type RegPanelQuery } from './RegistrationPanel';
import {
  AnalyticsSkeleton, COMPARE_LABEL, DeltaText, Kpi, Seg, TableSkeleton, TrendBarChart,
  comparisonRange, formatNum, formatPerDay, formatPeriod, formatRange, getDaysAgo, getToday, getYesterday,
  latestKpiLabel, partialBucket, pctChange, rangeKpis, soFarLabel, type ChartSeries, type CompareMode,
} from './leadsShared';
import { useAuth } from '@/context/AuthContext';
import type {
  LeadsChannelConfig, LeadsSummary, LeadsTrend, PeriodColumn, DeptRow, DeptPeriodsResponse, DeptUser, DeptUsersResponse, DeptGroup,
} from '@/types/f6leads';
import styles from './leads.module.css';

type ChannelKey = 'whatsapp' | 'mail';
type TabKey = ChannelKey | 'registration';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Month-year options (e.g. "Jan 2026") from 1 year ahead down to 2 years back.
const MONTH_YEAR_OPTIONS = (() => {
  const cy = new Date().getFullYear();
  const opts: { value: string; label: string }[] = [];
  for (let y = cy + 1; y >= cy - 2; y--) {
    for (let m = 12; m >= 1; m--) opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
  }
  return opts;
})();

const CHANNELS: Record<ChannelKey, LeadsChannelConfig> = {
  whatsapp: {
    label: 'WhatsApp chats',
    description: 'Chat volume and department performance',
    icon: MessageSquare,
    color: 'var(--ok)',
    volumeLabel: 'Total chats',
    volumeKey: 'totalChats',
    volumeField: 'chats',
    volumeColumnLabel: 'Chats',
    getSummary: getChatLeadsSummary,
    getTrend: getChatLeadsTrend,
    getDeptPeriods: getChatLeadsDepartmentPeriods,
  },
  mail: {
    label: 'Email enquiries',
    description: 'Email enquiries and department trends',
    icon: Mail,
    color: 'var(--info)',
    volumeLabel: 'Total emails',
    volumeKey: 'totalEmails',
    volumeField: 'emails',
    volumeColumnLabel: 'Emails',
    getSummary: getMailLeadsSummary,
    getTrend: getMailLeadsTrend,
    getDeptPeriods: getMailLeadsDepartmentPeriods,
  },
};

const TAB_KEYS: TabKey[] = ['whatsapp', 'mail', 'registration'];
const isTabKey = (v: string | null): v is TabKey => v != null && (TAB_KEYS as string[]).includes(v);
const isChannel = (v: TabKey): v is ChannelKey => v !== 'registration';

const DEFAULT_PERIOD_COUNT: Record<string, number> = { day: 7, week: 7, month: 3 };
const PERIOD_COUNT_OPTIONS: Record<string, number[]> = { day: [5, 7, 14, 30], week: [4, 7, 8, 12, 16], month: [3, 6, 12] };
const UNIT_OPTIONS = [{ value: 'day', label: 'Day on Day' }, { value: 'week', label: 'Week on Week' }, { value: 'month', label: 'Month on Month' }];
const GRANULARITY_OPTIONS = [{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthBounds = (val: string): [string, string] => {
  const [y, m] = val.split('-').map(Number);
  return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
};

/** Index of the latest COMPLETE period (skips a trailing partial one), for the "vs previous" column. */
function latestFullIndex(periods: PeriodColumn[]): number {
  const last = periods.length - 1;
  return periods[last]?.partial ? last - 1 : last;
}

export default function Leads() {
  const [channel, setChannel] = useState<TabKey>('whatsapp');
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState<number | null>(null);

  // ── Period filter — drives KPIs, trend chart and the Registrations tab ──
  const [fromDate, setFromDate] = useState(getDaysAgo(7));
  const [toDate, setToDate] = useState(getToday());
  const [granularity, setGranularity] = useState('day');
  const [compare, setCompare] = useState<CompareMode>('previous');
  const [regQuery, setRegQuery] = useState<RegPanelQuery>(() => ({ from: getDaysAgo(7), to: getToday(), granularity: 'day', compare: 'previous' }));
  const [summary, setSummary] = useState<LeadsSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<LeadsSummary | null>(null);
  const [trend, setTrend] = useState<LeadsTrend | null>(null);
  const [trendGran, setTrendGran] = useState('day');  // granularity the loaded trend was fetched with
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Department table — its own period filter ──
  const [periodUnit, setPeriodUnit] = useState('week');
  const [periodCount, setPeriodCount] = useState(DEFAULT_PERIOD_COUNT.week);
  const [deptPeriods, setDeptPeriods] = useState<PeriodColumn[]>([]);
  const [deptRows, setDeptRows] = useState<DeptRow[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [expandedReceiver, setExpandedReceiver] = useState<string | null>(null);
  const [deptUsers, setDeptUsers] = useState<DeptUser[]>([]);
  const [deptUsersLoading, setDeptUsersLoading] = useState(false);
  const [deptUsersError, setDeptUsersError] = useState<string | null>(null);
  const [deptUsersHasMore, setDeptUsersHasMore] = useState(false);
  const [deptUsersLoadingMore, setDeptUsersLoadingMore] = useState(false);

  // ── Department groups ──
  const [groups, setGroups] = useState<DeptGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<DeptGroup | null>(null);
  const [deptGroupFilter, setDeptGroupFilter] = useState('');
  const [pendingDelete, setPendingDelete] = useState<DeptGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const { isAuthenticated } = useAuth();  // group management is hidden for the public (logged-out) view
  const cfg = isChannel(channel) ? CHANNELS[channel] : null;

  const groupOfReceiver = new Map<string, DeptGroup>();
  for (const g of groups) for (const d of g.departments || []) groupOfReceiver.set(String(d.receiver), g);
  const selectedGroup = deptGroupFilter ? groups.find(g => String(g.id) === String(deptGroupFilter)) : undefined;
  const groupReceivers = deptGroupFilter ? new Set((selectedGroup?.departments || []).map(d => String(d.receiver))) : null;
  const visibleDeptRows = groupReceivers ? deptRows.filter(r => groupReceivers.has(String(r.receiver))) : deptRows;

  const loadGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await getDepartmentGroups() as { groups?: DeptGroup[] } | null;
      setGroups(res?.groups || []);
    } catch { /* non-blocking */ } finally {
      setGroupsLoading(false);
    }
  };

  const confirmDeleteGroup = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setGroupError(null);
    try {
      await deleteDepartmentGroup(pendingDelete.id);
      setPendingDelete(null);
      loadGroups();
    } catch (e) {
      setGroupError((e as Error).message || 'Failed to delete group');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  // Approx date span the department table covers (drives the expand lookup).
  const deptSpan = () => {
    const days = periodUnit === 'day' ? periodCount : periodUnit === 'week' ? periodCount * 7 : periodCount * 31;
    return { from: getDaysAgo(days), to: getToday() };
  };

  const toggleExpand = async (receiver: string) => {
    if (expandedReceiver === receiver) { setExpandedReceiver(null); return; }
    setExpandedReceiver(receiver);
    if (channel !== 'whatsapp') return;  // first-message lookup is WhatsApp-only
    setDeptUsers([]); setDeptUsersError(null); setDeptUsersHasMore(false); setDeptUsersLoading(true);
    try {
      const { from, to } = deptSpan();
      const res = await getChatLeadsDepartmentUsers(receiver, from, to, { onlyNew: true, limit: 50 }) as DeptUsersResponse | null;
      setDeptUsers(res?.users || []);
      setDeptUsersHasMore(!!res?.has_more);
    } catch (e) {
      setDeptUsersError((e as Error).message || 'Failed to load users');
    } finally {
      setDeptUsersLoading(false);
    }
  };

  const loadMoreDeptUsers = async () => {
    if (!expandedReceiver || deptUsersLoadingMore) return;
    setDeptUsersLoadingMore(true);
    try {
      const { from, to } = deptSpan();
      const res = await getChatLeadsDepartmentUsers(expandedReceiver, from, to, { onlyNew: true, limit: 50, offset: deptUsers.length }) as DeptUsersResponse | null;
      setDeptUsers(prev => [...prev, ...(res?.users || [])]);
      setDeptUsersHasMore(!!res?.has_more);
    } catch (e) {
      setDeptUsersError((e as Error).message || 'Failed to load more users');
    } finally {
      setDeptUsersLoadingMore(false);
    }
  };

  const load = async (ch: TabKey = channel, from = fromDate, to = toDate, gran = granularity, cmp: CompareMode = compare) => {
    if (!isChannel(ch)) {
      setRegQuery({ from, to, granularity: gran, compare: cmp });
      return;
    }
    setLoading(true);
    setError(null);
    setPrevSummary(null);
    const c = CHANNELS[ch];
    // Comparison window is requested first so the current window is the latest call; failures there are non-blocking.
    const prev = comparisonRange(from, to, cmp);
    if (prev) {
      c.getSummary(prev.from, prev.to)
        .then(res => setPrevSummary(res as LeadsSummary | null))
        .catch(() => { /* comparison is optional */ });
    }
    try {
      const [summaryRes, trendRes] = await Promise.all([c.getSummary(from, to), c.getTrend(from, to, gran)]);
      setSummary(summaryRes as LeadsSummary | null);
      setTrend(trendRes as LeadsTrend | null);
      setTrendGran(gran);
    } catch (err) {
      setError((err as Error).message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  const loadDept = async (ch: TabKey = channel, unit = periodUnit, count = periodCount) => {
    if (!isChannel(ch)) return;
    setDeptLoading(true);
    setDeptError(null);
    try {
      const res = await CHANNELS[ch].getDeptPeriods(unit, count) as DeptPeriodsResponse | null;
      setDeptPeriods(res?.periods || []);
      setDeptRows(res?.rows || []);
    } catch (err) {
      setDeptError((err as Error).message || 'Failed to load departments');
    } finally {
      setDeptLoading(false);
    }
  };

  // Latest loaders for the mount effect below (kept in a ref so that effect runs exactly once).
  const loadersRef = useRef({ load, loadDept, loadGroups });
  useEffect(() => { loadersRef.current = { load, loadDept, loadGroups }; });

  // Restore the last tab and expire this open page when its 30-minute access session ends.
  useEffect(() => {
    const queryTab = new URLSearchParams(window.location.search).get('tab');
    let savedTab: string | null = null;
    try { savedTab = window.localStorage.getItem('leads-active-tab'); } catch { /* storage blocked */ }
    const initial: TabKey = isTabKey(queryTab) ? queryTab : isTabKey(savedTab) ? savedTab : 'whatsapp';
    setChannel(initial);
    const loaders = loadersRef.current;
    if (isChannel(initial)) {
      loaders.load(initial);
      loaders.loadDept(initial);
    }
    loaders.loadGroups();
    let expiryTimer: number | undefined;
    let countdownTimer: number | undefined;
    // Token session (countdown + reload on expiry) only applies to public visitors.
    const signedIn = document.cookie.split('; ').some(c => c.startsWith('rayna-auth='));
    (signedIn ? Promise.resolve(null) : fetch('/leads-access/verify'))
      .then(response => response?.ok ? response.json() as Promise<{ expiresAt?: number }> : null)
      .then(access => {
        const expiresAt = access?.expiresAt;
        if (!expiresAt) return;
        const updateCountdown = () => setSessionSecondsLeft(Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0));
        updateCountdown();
        countdownTimer = window.setInterval(updateCountdown, 1000);
        expiryTimer = window.setTimeout(() => window.location.assign(window.location.href), Math.max(expiresAt - Date.now() + 250, 250));
      })
      .catch(() => {});
    return () => {
      if (expiryTimer) window.clearTimeout(expiryTimer);
      if (countdownTimer) window.clearInterval(countdownTimer);
    };
  }, []);

  const handleChannel = (ch: TabKey) => {
    setChannel(ch);
    try { window.localStorage.setItem('leads-active-tab', ch); } catch { /* storage blocked */ }
    const url = new URL(window.location.href);
    url.searchParams.set('tab', ch);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    if (!isChannel(ch)) { load(ch); return; }
    setSummary(null); setPrevSummary(null); setTrend(null); setError(null);
    setDeptPeriods([]); setDeptRows([]); setDeptError(null); setExpandedReceiver(null);
    load(ch);
    loadDept(ch);
  };

  const handlePreset = (from: string, to: string) => {
    setFromDate(from);
    setToDate(to);
    load(channel, from, to);
  };
  const handleMonthPick = (val: string) => { if (val) handlePreset(...monthBounds(val)); };
  const pickedMonth = (fromDate && toDate && fromDate.slice(0, 7) === toDate.slice(0, 7)
    && fromDate.slice(8) === '01' && toDate === ymd(new Date(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)), 0)))
    ? fromDate.slice(0, 7) : '';

  const handleGranularity = (gran: string) => {
    setGranularity(gran);
    if (summary || channel === 'registration') load(channel, fromDate, toDate, gran);
  };
  const handleCompare = (cmp: CompareMode) => {
    setCompare(cmp);
    if (summary || channel === 'registration') load(channel, fromDate, toDate, granularity, cmp);
  };

  const handlePeriodUnit = (unit: string) => {
    setPeriodUnit(unit);
    const count = DEFAULT_PERIOD_COUNT[unit];
    setPeriodCount(count);
    loadDept(channel, unit, count);
  };
  const handlePeriodCount = (count: number) => { setPeriodCount(count); loadDept(channel, periodUnit, count); };
  const periodIsFiltered = periodCount !== DEFAULT_PERIOD_COUNT[periodUnit];

  const openGroups = () => document.getElementById('department-groups')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

  const sessionCountdown = sessionSecondsLeft == null
    ? '--:--'
    : `${String(Math.floor(sessionSecondsLeft / 60)).padStart(2, '0')}:${String(sessionSecondsLeft % 60).padStart(2, '0')}`;

  const presets = [
    { label: 'Today', from: getToday(), to: getToday() },
    { label: 'Yesterday', from: getYesterday(), to: getYesterday() },
    { label: 'Last 7 days', from: getDaysAgo(7), to: getToday() },
    { label: 'Last 30 days', from: getDaysAgo(30), to: getToday() },
    { label: 'This month', from: new Date().toISOString().slice(0, 8) + '01', to: getToday() },
  ];

  // ── Derived, all from loaded API data ──
  const hasNewSplit = summary?.newUsers != null;
  const chartData = (trend?.points || []).map(p => ({ period: p.period, leads: p.leads ?? 0, newUsers: p.newUsers ?? 0, oldUsers: p.oldUsers ?? 0 }));
  const chartSeries: ChartSeries[] = [
    { key: 'leads', name: 'Leads', color: 'var(--gold)', rounded: true, labelled: true },
    ...(hasNewSplit ? [
      { key: 'newUsers', name: 'New', color: 'var(--info)', stackId: 'split' },
      { key: 'oldUsers', name: 'Returning', color: 'var(--warn)', stackId: 'split', rounded: true },
    ] : []),
  ];
  // The 4 headline KPIs: summary range + volume, and the chart's per-period leads.
  const kpis = summary ? rangeKpis({
    from: summary.from, to: summary.to, granularity: trendGran, total: cfg ? summary[cfg.volumeKey] : null,
    points: chartData.map(p => ({ period: p.period, value: p.leads })),
  }) : null;
  const partialKey = summary ? partialBucket(summary.from, summary.to, trendGran) : null;
  const rangeText = summary ? formatRange(summary.from, summary.to) : '';
  const totalLeads = summary?.totalLeads ?? 0;
  const shareOfLeads = (n?: number | null) => (typeof n === 'number' && totalLeads > 0 ? `${Math.round((n / totalLeads) * 100)}% of leads` : null);
  const cmpLabel = COMPARE_LABEL[compare];

  const rowTotal = (r: DeptRow) => (r.values || []).reduce((s, v) => s + (v?.chats ?? 0), 0);
  const deptGrandTotal = visibleDeptRows.reduce((s, r) => s + rowTotal(r), 0);
  const busiest = visibleDeptRows.reduce<DeptRow | null>((best, r) => (!best || rowTotal(r) > rowTotal(best) ? r : best), null);
  const fullIdx = latestFullIndex(deptPeriods);
  const hasChangeCol = fullIdx >= 1;
  const volumeWord = cfg?.volumeColumnLabel.toLowerCase() ?? 'chats';

  return (
    <div className={styles.page}>
      {!isAuthenticated && (
        <div className={styles.brand}>
          <img src="/rayna-logo.webp" alt="Rayna Tours" className={styles.brandLogo} />
        </div>
      )}

      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Leads' }]}
        title="Leads"
        description="Who contacted us and through which team: WhatsApp chats, email enquiries and new registrations."
        meta={sessionSecondsLeft != null ? (
          <span title="You will be asked for the access token again when this timer ends">
            <StatusChip tone={sessionSecondsLeft === 0 ? 'bad' : 'ok'}>
              <span className={styles.num}>Secure session · {sessionCountdown}</span>
            </StatusChip>
          </span>
        ) : undefined}
        actions={isAuthenticated && cfg ? (
          <Button onClick={openGroups}>Manage department groups</Button>
        ) : undefined}
      />

      {/* Period — shared by every tab */}
      <Card className={styles.periodCard} aria-label="Period">
        <div className={styles.periodMain}>
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Period</span>
            <div className={styles.seg} role="group" aria-label="Quick period">
              {presets.map(p => (
                <button key={p.label} type="button" className={styles.segBtn} aria-pressed={fromDate === p.from && toDate === p.to} onClick={() => handlePreset(p.from, p.to)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.rangeGroup}>
            <span className={styles.fieldGroup}>
              <label htmlFor="leads-from" className={styles.fieldLabel}>From</label>
              <Input id="leads-from" type="date" className={styles.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </span>
            <span className={styles.fieldGroup}>
              <label htmlFor="leads-to" className={styles.fieldLabel}>To</label>
              <Input id="leads-to" type="date" className={styles.dateInput} value={toDate} onChange={e => setToDate(e.target.value)} />
            </span>
            <Button variant="primary" size="sm" className={styles.applyBtn} onClick={() => load()} disabled={!!cfg && loading}>
              {cfg && loading ? <><Loader2 size={14} className={styles.spin} aria-hidden="true" />Loading...</> : 'Apply'}
            </Button>
          </div>
          <span className={styles.fieldGroup}>
            <label htmlFor="leads-month" className={styles.fieldLabel}>Month</label>
            <Select id="leads-month" className={styles.monthSelect} value={pickedMonth} onChange={e => handleMonthPick(e.target.value)}>
              <option value="">Select month…</option>
              {MONTH_YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </span>
        </div>
        <div className={styles.periodFoot}>
          <p className={styles.periodHelp}>
            Applies to the KPIs, the chart and the Registrations tab. The department table has its own period below.
          </p>
          <span className={styles.fieldGroup}>
            <label htmlFor="leads-compare" className={styles.fieldLabel}>Compare with</label>
            <Select id="leads-compare" className={styles.compareSelect} value={compare} onChange={e => handleCompare(e.target.value === 'year' ? 'year' : 'previous')}>
              <option value="previous">Previous period</option>
              <option value="year">Same period last year</option>
            </Select>
          </span>
          <span className={styles.fieldGroup}>
            <span className={styles.fieldLabel} aria-hidden="true">Chart by</span>
            <Seg label="Chart granularity" options={GRANULARITY_OPTIONS} value={granularity} onChange={handleGranularity} />
          </span>
        </div>
      </Card>

      <Tabs<TabKey>
        label="Lead source"
        value={channel}
        onChange={handleChannel}
        items={[
          { key: 'whatsapp', label: <span className={styles.tabLabel}><MessageSquare size={15} aria-hidden="true" />WhatsApp chats{channel === 'whatsapp' && summary ? <Chip>{formatNum(summary.totalChats)}</Chip> : null}</span> },
          { key: 'mail', label: <span className={styles.tabLabel}><Mail size={15} aria-hidden="true" />Email enquiries{channel === 'mail' && summary ? <Chip>{formatNum(summary.totalEmails)}</Chip> : null}</span> },
          { key: 'registration', label: <span className={styles.tabLabel}><Users size={15} aria-hidden="true" />Registrations</span> },
        ]}
      />

      {!cfg ? <RegistrationPanel query={regQuery} /> : <>
        {error && (
          <Card className={styles.stateCard}>
            <ErrorState
              title={`Couldn't load ${cfg.label.toLowerCase()}`}
              description={error}
              action={<Button size="sm" variant="primary" onClick={() => load()}>Try again</Button>}
            />
          </Card>
        )}

        {loading && !summary && <AnalyticsSkeleton />}

        {summary && kpis && (
          <>
            <div className={styles.kpiGrid}>
              <Kpi label={cfg.volumeLabel} value={formatNum(summary[cfg.volumeKey])}
                trend={<DeltaText pct={pctChange(summary[cfg.volumeKey], prevSummary?.[cfg.volumeKey])} suffix={cmpLabel} />}
                help={rangeText} />
              <Kpi label="Average per day" value={formatPerDay(kpis.perDay)}
                help={kpis.days != null ? `${volumeWord} a day · over ${formatNum(kpis.days)} day${kpis.days === 1 ? '' : 's'}` : 'Needs a valid date range'} />
              <Kpi label={`Busiest ${trendGran}`} textValue
                value={kpis.busiest ? formatPeriod(kpis.busiest.period, trendGran, 'kpi') : '—'}
                trend={kpis.busiest ? <span className={styles.kpiTrend}>{formatNum(kpis.busiest.value)} leads</span> : undefined}
                help={kpis.busiest ? 'From the chart below' : 'No leads in this range'} />
              <Kpi label={latestKpiLabel(trendGran, !!kpis.latest?.partial)}
                value={kpis.latest ? formatNum(kpis.latest.value) : '—'}
                help={kpis.latest ? `leads · ${formatPeriod(kpis.latest.period, trendGran, 'kpi')}` : 'Needs a valid date range'} />
            </div>

            <Card className={styles.cardPad}>
              <div className={styles.cardHead}>
                <div className={styles.cardHeadText}>
                  <h2 className={styles.cardTitle}>{cfg.label}: leads per {trendGran}</h2>
                  <span className={styles.help}>
                    {hasNewSplit ? 'New = first time we hear from this number · Returning = contacted us before' : 'Total unique leads'}
                  </span>
                </div>
                <div className={styles.legend}>
                  <span className={styles.legendItem} aria-hidden="true"><span className={styles.swatch} style={{ background: 'var(--gold)' }} />Leads</span>
                  {hasNewSplit && <span className={styles.legendItem} aria-hidden="true"><span className={styles.swatch} style={{ background: 'var(--info)' }} />New</span>}
                  {hasNewSplit && <span className={styles.legendItem} aria-hidden="true"><span className={styles.swatch} style={{ background: 'var(--warn)' }} />Returning</span>}
                  {partialKey && (
                    <span className={styles.legendItem} title="The current period is still in progress, so its bar is not complete yet">
                      <span className={`${styles.swatch} ${styles.swatchPartial}`} aria-hidden="true" />{soFarLabel(trendGran)}
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.statStrip}>
                <Kpi flat label="Leads" value={formatNum(summary.totalLeads)}
                  trend={<DeltaText pct={pctChange(summary.totalLeads, prevSummary?.totalLeads)} suffix={cmpLabel} />}
                  help="Unique contacts in the period" />
                {hasNewSplit && (
                  <>
                    <Kpi flat label="New contacts" value={formatNum(summary.newUsers)}
                      trend={<span className={styles.kpiTrend}>{shareOfLeads(summary.newUsers)}</span>}
                      help="First time we hear from this number" />
                    <Kpi flat label="Returning" value={formatNum(summary.oldUsers)}
                      trend={<span className={styles.kpiTrend}>{shareOfLeads(summary.oldUsers)}</span>}
                      help="Contacted us before" />
                  </>
                )}
              </div>

              {chartData.length > 0 ? (
                <TrendBarChart data={chartData} series={chartSeries} granularity={trendGran} partialKey={partialKey} />
              ) : (
                <div className={styles.chartEmpty}>No data for the selected range.</div>
              )}
              <span className={styles.chartFoot}>Y axis: number of leads. Hover a bar for exact counts.</span>
            </Card>
          </>
        )}

        {/* Department groups — signed-in users only */}
        {isAuthenticated && (
          <Card
            id="department-groups"
            className={styles.cardPad}
            title={<span className={styles.inline}>Department groups <Chip>{groups.length}</Chip></span>}
            actions={<Button variant="primary" size="sm" onClick={() => { setEditGroup(null); setGroupModalOpen(true); }}><Plus size={15} aria-hidden="true" />Add Group</Button>}
          >
            {groupError && <ErrorState title="Couldn't delete the group" description={groupError} />}
            {groupsLoading ? (
              <div className={styles.emptyLine}><Loader2 size={16} className={styles.spin} aria-label="Loading groups" /></div>
            ) : groups.length === 0 ? (
              <p className={styles.note}>No groups yet. Click <strong>Add Group</strong> to bundle departments under one name.</p>
            ) : (
              <div className={styles.groupList}>
                {groups.map(g => (
                  <div key={g.id} className={styles.groupItem}>
                    <div className={styles.groupHead}>
                      <span className={styles.groupName}>{g.name}</span>
                      <span className={styles.help}>· {g.departments.length} dept{g.departments.length === 1 ? '' : 's'}</span>
                      <span className={styles.groupActions}>
                        <Button variant="ghost" size="sm" icon title="Edit" aria-label={`Edit ${g.name}`} onClick={() => { setEditGroup(g); setGroupModalOpen(true); }}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="sm" icon title="Delete" aria-label={`Delete ${g.name}`} onClick={() => { setGroupError(null); setPendingDelete(g); }}><Trash2 size={15} /></Button>
                      </span>
                    </div>
                    <div className={styles.chipWrap}>
                      {g.departments.map(d => <Chip key={d.receiver}>{d.name || d.receiver}</Chip>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* By department — independent period filter */}
        {deptError && (
          <Card className={styles.stateCard}>
            <ErrorState title="Couldn't load departments" description={deptError}
              action={<Button size="sm" variant="primary" onClick={() => loadDept()}>Try again</Button>} />
          </Card>
        )}

        {deptLoading && deptPeriods.length === 0 && <TableSkeleton label="Loading department data" />}

        {deptPeriods.length > 0 && (
          <Card className={styles.cardPad}>
            <div className={styles.cardHead}>
              <div className={styles.inline}>
                <h2 className={styles.cardTitle}>By department</h2>
                <Chip>{visibleDeptRows.length} receivers</Chip>
                {deptLoading && <Loader2 size={16} className={styles.spin} aria-label="Refreshing" />}
              </div>
              <div className={styles.inline}>
                <label htmlFor="leads-group" className={styles.help}>Group</label>
                <Select id="leads-group" value={deptGroupFilter} onChange={e => setDeptGroupFilter(e.target.value)}>
                  <option value="">All departments</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.departments.length})</option>)}
                </Select>
                {selectedGroup && (
                  <Chip tone="gold">
                    {selectedGroup.name}
                    <button type="button" onClick={() => setDeptGroupFilter('')} title="Clear group filter" aria-label="Clear group filter"
                      style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}>
                      <X size={13} />
                    </button>
                  </Chip>
                )}
              </div>
            </div>

            <div className={styles.periodRow}>
              <Seg label="Department period" options={UNIT_OPTIONS} value={periodUnit} onChange={handlePeriodUnit} />
              <span className={styles.inline}>
                <label htmlFor="leads-period-count" className={styles.help}>{periodUnit === 'day' ? 'Days' : periodUnit === 'week' ? 'Weeks' : 'Months'}</label>
                <Select id="leads-period-count" value={periodCount} onChange={e => handlePeriodCount(Number(e.target.value))}>
                  {PERIOD_COUNT_OPTIONS[periodUnit].map(n => <option key={n} value={n}>Last {n}</option>)}
                </Select>
              </span>
              {periodIsFiltered && <StatusChip tone="warn">Filtered</StatusChip>}
              {periodIsFiltered && (
                <Button variant="ghost" size="sm" onClick={() => handlePeriodCount(DEFAULT_PERIOD_COUNT[periodUnit])}>
                  <RotateCcw size={14} aria-hidden="true" />Reset
                </Button>
              )}
            </div>

            {busiest && rowTotal(busiest) > 0 && (
              <div className={styles.callout}>
                <Kpi flat label="Busiest department" textValue value={busiest.department || busiest.receiver}
                  trend={<span className={styles.kpiTrend}>{formatNum(rowTotal(busiest))} {volumeWord}{deptGrandTotal > 0 ? ` · ${Math.round((rowTotal(busiest) / deptGrandTotal) * 100)}%` : ''}</span>}
                  help="Over the periods in this table" />
              </div>
            )}

            <span className={styles.help}>
              Each period: <b>{volumeWord}</b> · <span className={styles.cellNew}>new</span> / <span className={styles.cellOld}>returning</span>.
              New = first-ever contact in that period · Returning = contacted before.
            </span>

            <div className={styles.tableBox}>
              <Table label="Leads by department" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Department</th>
                    <th>Group</th>
                    {deptPeriods.map((p, i) => (
                      <th key={i} className={styles.r}>{p.label}<span className={styles.th2}>{p.sublabel}{p.partial ? ' · PARTIAL' : ''}</span></th>
                    ))}
                    <th className={styles.r}>Total</th>
                    {hasChangeCol && (
                      <th className={styles.r} title="Latest complete period compared with the one before it">
                        vs previous period<span className={styles.th2}>{deptPeriods[fullIdx]?.label} vs {deptPeriods[fullIdx - 1]?.label}</span>
                      </th>
                    )}
                    <th><span className="sr-only" style={{ position: 'absolute', left: -9999 }}>Expand</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDeptRows.map((row, i) => {
                    const isOpen = expandedReceiver === row.receiver;
                    const colSpan = 4 + deptPeriods.length + (hasChangeCol ? 1 : 0);
                    const group = groupOfReceiver.get(String(row.receiver));
                    const pct = hasChangeCol ? pctChange(row.values[fullIdx]?.chats, row.values[fullIdx - 1]?.chats) : null;
                    return (
                      <Fragment key={`${row.receiver}-${i}`}>
                        <tr onClick={() => toggleExpand(row.receiver)} className={`${styles.rowClickable} ${isOpen ? styles.rowOpen : ''}`}>
                          <td className={styles.stickyCol}>
                            <span className={row.department ? undefined : styles.muted} style={{ fontWeight: row.department ? 600 : 400 }}>{row.department || 'No department match'}</span>
                            <div className={styles.mono} title={row.receiver}>{row.receiver}</div>
                          </td>
                          <td className={styles.note}>{group?.name ?? '—'}</td>
                          {row.values.map((v, j) => (
                            <td key={j} className={`${styles.r} ${styles.num}`} style={{ whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 600 }} title={volumeWord}>{formatNum(v?.chats)}</span>
                              <span className={styles.sep}> · </span>
                              <span className={styles.cellNew} title="new (first contact in this period)">{formatNum(v?.newUsers)}</span>
                              <span className={styles.sep}>/</span>
                              <span className={styles.cellOld} title="returning">{formatNum(v?.oldUsers)}</span>
                            </td>
                          ))}
                          <td className={`${styles.r} ${styles.num}`}><b>{formatNum(rowTotal(row))}</b></td>
                          {hasChangeCol && (
                            <td className={`${styles.r} ${styles.num}`}>{pct == null ? <span className={styles.flat}>—</span> : <DeltaText pct={pct} />}</td>
                          )}
                          <td>
                            <Button variant="ghost" size="sm" aria-expanded={isOpen}
                              onClick={e => { e.stopPropagation(); toggleExpand(row.receiver); }}>
                              {isOpen ? 'Hide' : 'Show new'}
                            </Button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className={styles.drill}>
                            <td colSpan={colSpan}>
                              {channel !== 'whatsapp' ? (
                                <span className={styles.note}>The new-contact list (with first message) is available for WhatsApp only.</span>
                              ) : deptUsersLoading ? (
                                <span className={styles.inline}><Loader2 size={14} className={styles.spin} aria-hidden="true" /> Loading users…</span>
                              ) : deptUsersError ? (
                                <span className="ui-err" role="alert">{deptUsersError}</span>
                              ) : deptUsers.length === 0 ? (
                                <span className={styles.note}>No new users found for this department in the current window.</span>
                              ) : (
                                <div className={styles.drillInner}>
                                  <span className={styles.note}>
                                    <b>New contacts for {row.department || row.receiver}</b> · showing {deptUsers.length}{deptUsersHasMore ? '+' : ''}
                                  </span>
                                  <Table label={`New contacts for ${row.department || row.receiver}`}>
                                    <thead>
                                      <tr><th>#</th><th>Number</th><th>First message</th><th>First message at</th></tr>
                                    </thead>
                                    <tbody>
                                      {deptUsers.map((u, k) => (
                                        <tr key={`${u.wa_id}-${k}`}>
                                          <td className={`${styles.num} ${styles.flat}`} style={{ width: 1 }}>{k + 1}</td>
                                          <td style={{ whiteSpace: 'nowrap' }}>
                                            <span className={styles.mono} style={{ color: 'var(--ink)' }}>{u.wa_id}</span>
                                            {u.wa_name ? <span className={styles.help}> · {u.wa_name}</span> : null}
                                          </td>
                                          <td>{u.first_msg || <span className={styles.muted}>(not available)</span>}</td>
                                          <td className={`${styles.num} ${styles.note}`} style={{ whiteSpace: 'nowrap' }}>{u.first_msg_at || '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </Table>
                                  {deptUsersHasMore && (
                                    <div className={styles.pager}>
                                      <Button size="sm" disabled={deptUsersLoadingMore} onClick={e => { e.stopPropagation(); loadMoreDeptUsers(); }}>
                                        {deptUsersLoadingMore ? <><Loader2 size={13} className={styles.spin} aria-hidden="true" />Loading…</> : 'Show more'}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {visibleDeptRows.length === 0 && (
                    <tr>
                      <td colSpan={4 + deptPeriods.length + (hasChangeCol ? 1 : 0)} className={styles.emptyLine}>
                        {deptGroupFilter ? 'No departments from this group have activity in the current window.' : 'No data.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </div>
          </Card>
        )}

        {!summary && deptPeriods.length === 0 && !loading && !deptLoading && !error && !deptError && (
          <EmptyState
            icon={<cfg.icon size={20} />}
            title="Select a date range to get started"
            description={`Pick a period above, then click "Apply" to see ${cfg.label.toLowerCase()} by department.`}
          />
        )}

        <GroupDepartmentModal
          open={groupModalOpen}
          editGroup={editGroup}
          onClose={() => { setGroupModalOpen(false); setEditGroup(null); }}
          onSaved={loadGroups}
        />
        <ConfirmDialog
          open={pendingDelete != null}
          danger
          busy={deleting}
          title={`Delete group "${pendingDelete?.name ?? ''}"?`}
          description="Its departments will be freed for other groups. Lead data is not affected."
          confirmLabel="Delete group"
          onConfirm={confirmDeleteGroup}
          onCancel={() => setPendingDelete(null)}
        />
      </>}
    </div>
  );
}
