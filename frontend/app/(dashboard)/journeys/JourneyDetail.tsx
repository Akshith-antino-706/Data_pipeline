'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, BarChart3, Activity, ChevronDown, ChevronRight, Clock, Copy, Edit3, Eye, GitBranch,
  MoreHorizontal, Pause, Play, RefreshCw, Settings, Sparkles, Trash2, Users, X,
} from 'lucide-react';
import { Button, Card, Chip, StatusChip, EmptyState, ErrorState, Select, Skeleton, Table } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import type {
  JourneyDetail, JourneyNode, QueueCounts, TimelineItem, JourneyEntry, ContentTemplate,
} from '@/types/f1Journeys';
import { CONDITION_LABELS, GOAL_LABELS } from './nodeNames';
import styles from './JourneyDetail.module.css';
import type { FunnelDatum, StepDatum } from './JourneyCharts';

// Recharts is loaded lazily so it stays out of the initial bundle.
const JourneyFunnelChart = dynamic(() => import('./JourneyCharts').then(m => m.JourneyFunnelChart), { ssr: false, loading: () => <Skeleton height={180} /> });
const JourneyStepChart = dynamic(() => import('./JourneyCharts').then(m => m.JourneyStepChart), { ssr: false, loading: () => <Skeleton height={160} /> });

/** One colour per meaning, shared by every chart on the page. */
const SERIES = { people: 'var(--gold)', messages: 'var(--info)', outcome: 'var(--ok)' };

// ── Number helpers ─────────────────────────────────────────────
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};
/** A count when the API sent one, otherwise null (rendered as "—"). */
const countOf = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};
const fmtNum = (v: unknown) => num(v).toLocaleString('en-US');
const fmtCount = (v: number | null): string => (v === null ? '—' : v.toLocaleString('en-US'));
const pctOf = (part: number | null, whole: number | null): number | null =>
  part === null || whole === null || whole <= 0 ? null : Math.round((part / whole) * 100);

// ── Human dates (Dubai time) ───────────────────────────────────
const TZ = 'Asia/Dubai';
const toDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** Days since epoch of the Dubai calendar day the instant falls on. */
const dubaiDay = (d: Date): number => {
  const [y, m, day] = d.toLocaleDateString('en-CA', { timeZone: TZ }).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86400000);
};
const clean = (s: string) => s.replace(/\u202f/g, ' ');
const dubaiTime = (d: Date) => clean(d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }));
const dubaiCalendar = (d: Date): string => {
  const wd = d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
  const dm = d.toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' });
  const year = d.toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' });
  const thisYear = new Date().toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' });
  return `${wd}, ${dm}${year === thisYear ? '' : ` ${year}`}`;
};
const relativeDay = (d: Date): string | null => {
  const diff = dubaiDay(d) - dubaiDay(new Date());
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null;
};
/** "Tue, 14 Oct" (adds the year when it isn't this year). */
export const humanDay = (v: string | null | undefined): string | null => {
  const d = toDate(v);
  return d ? dubaiCalendar(d) : null;
};
/** "Tomorrow 10:00 AM", "Today 3:15 PM", "Tue, 14 Oct, 10:00 AM" — Dubai time. */
export const humanDateTime = (v: string | null | undefined): string | null => {
  const d = toDate(v);
  if (!d) return null;
  const rel = relativeDay(d);
  return rel ? `${rel} ${dubaiTime(d)}` : `${dubaiCalendar(d)}, ${dubaiTime(d)}`;
};

// ── Status words ───────────────────────────────────────────────
const STATUS_TONE: Record<string, { tone: ChipTone; label: string }> = {
  active: { tone: 'ok', label: 'Running' },
  paused: { tone: 'warn', label: 'Paused' },
  draft: { tone: 'mute', label: 'Draft' },
  completed: { tone: 'info', label: 'Completed' },
};
export const journeyStatusChip = (status: string | undefined) =>
  STATUS_TONE[status || ''] || { tone: 'mute' as ChipTone, label: status || 'Unknown' };

const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'Push', rcs: 'RCS', web: 'Web', inapp: 'In-app',
};
const channelLabel = (c: string) => CHANNEL_LABEL[c.toLowerCase()] || c;
/** Channel as it reads mid-sentence: "Send email", "Send WhatsApp". */
const channelWord = (c: string | undefined) => (!c ? 'a message' : c.toLowerCase() === 'email' ? 'email' : channelLabel(c));
const joinWords = (words: string[]): string =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** Plain name for the backend's per-step lifecycle status. */
const STEP_STATUS: Record<string, { tone: ChipTone; label: string }> = {
  completed: { tone: 'ok', label: 'Done' },
  done: { tone: 'ok', label: 'Done' },
  active: { tone: 'info', label: 'Sending now' },
  running: { tone: 'info', label: 'Sending now' },
  sending: { tone: 'info', label: 'Sending now' },
  processing: { tone: 'info', label: 'Sending now' },
  monitoring: { tone: 'info', label: 'Watching' },
  waiting: { tone: 'warn', label: 'Waiting' },
  paused: { tone: 'warn', label: 'Paused' },
  pending: { tone: 'mute', label: 'Not started' },
  failed: { tone: 'bad', label: 'Problem' },
};
const stepStatus = (s: string) => STEP_STATUS[s.toLowerCase()] || { tone: 'mute' as ChipTone, label: s.replace(/_/g, ' ') };

/** Plain name for a person's status in the journey. */
const PERSON_STATUS: Record<string, { tone: ChipTone; label: string }> = {
  active: { tone: 'ok', label: 'In progress' },
  completed: { tone: 'info', label: 'Finished' },
  converted: { tone: 'gold', label: 'Booked' },
  exited: { tone: 'mute', label: 'Left' },
  failed: { tone: 'bad', label: 'Failed' },
};
const EXIT_REASON: Record<string, string> = {
  unsubscribed: 'unsubscribed', booked: 'booked', converted: 'booked', completed: 'finished', goal_reached: 'reached the goal',
};
const personStatus = (e: JourneyEntry) => {
  const base = PERSON_STATUS[e.status] || { tone: 'mute' as ChipTone, label: e.status ? e.status.replace(/_/g, ' ') : '—' };
  const reason = e.exit_reason ? (EXIT_REASON[e.exit_reason.toLowerCase()] || e.exit_reason.replace(/_/g, ' ')) : null;
  return { tone: base.tone, label: reason ? `${base.label} · ${reason}` : base.label };
};
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Everyone' },
  { value: 'active', label: 'In progress' },
  { value: 'completed', label: 'Finished' },
  { value: 'converted', label: 'Booked' },
  { value: 'exited', label: 'Left' },
];
const PAGE_SIZE = 50;

// ── Step sentences ─────────────────────────────────────────────
const waitText = (node: JourneyNode): string | null => {
  const v = num(node.data?.waitDays);
  if (!v) return null;
  const unit = node.data?.waitUnit || 'days';
  return `${v} ${v === 1 ? unit.replace(/s$/, '') : unit}`;
};
const sendHourText = (node: JourneyNode): string | null => {
  const h = node.data?.sendHour;
  if (h === null || h === undefined || h === '') return null;
  const n = Number(h);
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return `${n % 12 === 0 ? 12 : n % 12}:00 ${n < 12 ? 'AM' : 'PM'}`;
};

/** Short name used in tables and panel titles. */
const stepName = (node: JourneyNode): string =>
  node.data?.label || (node.type === 'wait' ? 'Wait' : node.data?.channel ? `${channelLabel(node.data.channel)} message` : 'Step');

/** The step as one plain sentence: "Send email 'Welcome'", "Wait 2 days". */
const stepSentence = (node: JourneyNode, tpl: ContentTemplate | null): string => {
  const d = node.data || {};
  switch (node.type) {
    case 'action': {
      const what = tpl?.name || tpl?.wa_template_name || d.label;
      const at = sendHourText(node);
      return `Send ${channelWord(d.channel)}${what ? ` '${what}'` : ''}${at ? ` at ${at}` : ''}`;
    }
    case 'wait': {
      const w = waitText(node);
      return w ? `Wait ${w}` : 'Wait';
    }
    case 'condition':
      return `Check: ${(d.condition && CONDITION_LABELS[d.condition]) || d.label || 'a condition'}`;
    case 'goal':
      return `Goal: ${(d.goalType && GOAL_LABELS[d.goalType]) || d.label || 'reach the goal'}`;
    case 'split':
      return 'Split people into groups';
    case 'exit':
      return 'Leave the journey';
    default:
      return d.label || 'Step';
  }
};

/** Days from the start each step happens on (fixed journeys that count waits in days only). */
const dayOffsets = (steps: JourneyNode[], alwaysOn: boolean): Record<string, number> => {
  const out: Record<string, number> = {};
  if (alwaysOn) return out;
  let day = 0;
  for (const s of steps) {
    if (s.type === 'wait') {
      const unit = (s.data?.waitUnit || 'days').toLowerCase();
      if (unit !== 'days' && unit !== 'day') return {};
      day += num(s.data?.waitDays);
    } else {
      out[s.id] = day + 1;
    }
  }
  return out;
};

// ── Loading skeleton ───────────────────────────────────────────
const KPI_LABELS = ['People joined', 'Still in progress', 'Finished', 'Unsubscribed', 'Booked', 'Messages that failed'];

export function JourneyDetailSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading journey">
      {children}
      <div className={styles.headSkel}>
        <Skeleton width={120} height={14} />
        <Skeleton width="min(320px, 80%)" height={26} />
        <Skeleton width="min(460px, 90%)" height={16} />
      </div>
      <Card title="How is it doing?">
        <div className={styles.kpis}>
          {KPI_LABELS.map(l => (
            <div key={l} className={styles.kpi}>
              <span className={styles.kpiLabel}>{l}</span>
              <Skeleton width={70} height={28} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="What happens, step by step">
        <div className={styles.skelList}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={56} radius={12} />)}
        </div>
      </Card>
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────
export type DetailTab = 'flow' | 'entries' | 'analytics' | 'activity' | 'settings';

export interface JourneyDetailOverviewProps {
  journeyId: number;
  detail: JourneyDetail;
  channels: string[];
  /** Messages that failed, or null when the delivery report hasn't loaded. */
  failedTotal: number | null;
  sentByNode: Record<string, number>;
  openedByNode: Record<string, number>;
  clickedByNode: Record<string, number>;
  /** True once the delivery report (sent / opened / clicked per step) has loaded. */
  deliveryLoaded: boolean;
  queueStats: Record<string, QueueCounts> | null;
  timeline: TimelineItem[] | null;
  entries: JourneyEntry[];
  entriesTotal: number;
  entriesLoading: boolean;
  entriesError: boolean;
  entriesPage: number;
  entriesStatus: string;
  starting: boolean;
  suggestLoading: boolean;
  previewLoading: boolean;
  /** Replaces the title/description while the rename form is open. */
  editSlot?: ReactNode;
  /** Whether the Advanced area (flow builder, analytics, activity, settings…) is open. */
  advancedOpen: boolean;
  /** The old tabbed tools, rendered inside the Advanced area when it is open. */
  advancedSlot?: ReactNode;
  getNodeTemplate: (node: JourneyNode) => ContentTemplate | null;
  onBack: () => void;
  onEdit: () => void;
  onStart: () => void;
  onPauseResume: () => void;
  onAISuggest: () => void;
  onCopyId: () => void;
  onDelete: () => void;
  onEditSteps: () => void;
  onOpenTab: (tab: DetailTab) => void;
  onToggleAdvanced: () => void;
  onPreviewNode: (node: JourneyNode) => void;
  onRetryBlocked: (nodeId: string) => void;
  onLoadEntries: () => void;
  /** Loads the delivery report (sent / opened / clicked / failed) — a read call the Analytics tab already makes. */
  onLoadDelivery: () => void;
  onEntriesQuery: (page: number, status: string) => void;
}

export function JourneyDetailOverview(p: JourneyDetailOverviewProps) {
  const { detail } = p;
  const nodes = useMemo(() => (Array.isArray(detail.nodes) ? detail.nodes : []), [detail.nodes]);
  const stats = detail.entryStats;
  const status = journeyStatusChip(detail.status);
  const isAlwaysOn = detail.journey_type === 'gtm' || detail.journey_type === 'continuous';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [moreOpen]);

  const { entriesLoading, onLoadEntries } = p;
  const entries = useMemo(() => (Array.isArray(p.entries) ? p.entries : []), [p.entries]);
  const askedEntries = useRef(false);
  useEffect(() => {
    if (askedEntries.current || entries.length > 0 || entriesLoading) return;
    askedEntries.current = true;
    onLoadEntries();
  }, [entries.length, entriesLoading, onLoadEntries]);

  const { onLoadDelivery } = p;
  const askedDelivery = useRef(false);
  useEffect(() => {
    if (askedDelivery.current) return;
    askedDelivery.current = true;
    onLoadDelivery();
  }, [onLoadDelivery]);

  const steps = useMemo(() => nodes.filter(n => n.type !== 'trigger'), [nodes]);
  const selected = steps.find(n => n.id === selectedId) || null;
  const timelineMap = useMemo(() => {
    const m: Record<string, TimelineItem> = {};
    (Array.isArray(p.timeline) ? p.timeline : []).forEach(t => { if (t && t.nodeId) m[t.nodeId] = t; });
    return m;
  }, [p.timeline]);
  const days = useMemo(() => dayOffsets(steps, isAlwaysOn), [steps, isAlwaysOn]);
  const hasWaits = steps.some(s => s.type === 'wait');
  const hasRun = detail.status !== 'draft';
  const stepNumber = useMemo(() => Object.fromEntries(steps.map((s, i) => [s.id, i + 1])), [steps]);

  // ── Totals ──
  // snapshot_count: -1 while the audience builds, -2 if that build failed.
  const snap = num(detail.snapshot_count);
  const joinedCount = snap > 0 ? snap : countOf(stats?.total_entries);
  const unsubCount = countOf(stats?.unsubscribed_from_journey ?? stats?.unsubscribed_during_journey ?? stats?.exited_unsubscribed);
  const active = countOf(stats?.active);
  const finished = countOf(stats?.completed);
  const booked = countOf(stats?.exited_booked);
  const ofJoined = (v: number | null) => {
    const pc = pctOf(v, joinedCount);
    return pc === null ? undefined : `${pc}% of joined`;
  };
  const kpis: { label: string; value: string; pct?: string; help: string; bad?: boolean }[] = [
    snap === -1
      ? { label: 'People joined', value: 'Building…', help: 'We are still gathering the audience for this journey.' }
      : snap === -2
        ? { label: 'People joined', value: 'Couldn’t build', help: 'Gathering the audience failed. Check the segment, then try again.', bad: true }
        : { label: 'People joined', value: fmtCount(joinedCount), help: 'Everyone who has entered this journey.' },
    { label: 'Still in progress', value: fmtCount(active), pct: ofJoined(active), help: 'Still moving through the steps.' },
    { label: 'Finished', value: fmtCount(finished), pct: ofJoined(finished), help: 'Went through every step.' },
    { label: 'Unsubscribed', value: fmtCount(unsubCount), pct: ofJoined(unsubCount), help: 'Asked to stop getting messages.' },
    { label: 'Booked', value: fmtCount(booked), pct: ofJoined(booked), help: 'Made a booking and left the journey.' },
    { label: 'Messages that failed', value: fmtCount(p.failedTotal), help: 'Messages that could not be delivered.', bad: (p.failedTotal ?? 0) > 0 },
  ];

  // ── Funnel: where people drop off ──
  // Message stages use the busiest message step (the most people any one step reached),
  // so they count people, not messages. Unknown stages are skipped, never shown as 0.
  const actionIds = steps.filter(s => s.type === 'action').map(s => s.id);
  const busiest = (m: Record<string, number>): number => Math.max(0, ...actionIds.map(id => num(m[id])));
  const sentKnown = actionIds.length > 0 && (p.deliveryLoaded || busiest(p.sentByNode) > 0);
  const engagementKnown = actionIds.length > 0 && p.deliveryLoaded;
  const bookedStage = booked ?? countOf(detail.total_conversions);
  const funnelStages: { name: string; value: number | null; color: string }[] = [
    { name: 'People joined', value: snap < 0 ? null : joinedCount, color: SERIES.people },
    { name: 'Got a message', value: sentKnown ? busiest(p.sentByNode) : null, color: SERIES.messages },
    { name: 'Opened', value: engagementKnown ? busiest(p.openedByNode) : null, color: SERIES.messages },
    { name: 'Clicked', value: engagementKnown ? busiest(p.clickedByNode) : null, color: SERIES.messages },
    { name: 'Booked', value: bookedStage, color: SERIES.outcome },
  ];
  const funnelBase = snap < 0 ? null : joinedCount;
  const funnel: FunnelDatum[] = funnelStages
    .filter((s): s is { name: string; value: number; color: string } => s.value !== null)
    .map(s => ({ name: s.name, value: s.value, pct: pctOf(s.value, funnelBase), color: s.color }));
  const funnelHasData = funnel.some(f => f.value > 0);
  const funnelLabel = `Where people drop off: ${funnel.map(f => `${f.name} ${fmtCount(f.value)}${f.pct !== null ? ` (${f.pct}%)` : ''}`).join(', ')}`;

  // ── People at each step ──
  const stepChart: StepDatum[] = steps.map((s, i) => {
    const ns = detail.node_stats?.[s.id];
    const short = s.type === 'action'
      ? `${s.data?.channel ? channelLabel(s.data.channel) : 'Message'}: ${p.getNodeTemplate(s)?.name || s.data?.label || 'message'}`
      : stepSentence(s, null);
    const name = `${i + 1} · ${short}`;
    return { name: name.length > 34 ? `${name.slice(0, 33)}…` : name, now: num(ns?.active), done: ns ? num(ns.completed) : null };
  });
  const stepChartHasData = steps.some(s => detail.node_stats?.[s.id]);
  const stepChartLabel = `People at each step: ${stepChart.map(d => `${d.name}: ${fmtNum(d.now)} now${d.done !== null ? `, ${fmtNum(d.done)} done` : ''}`).join('; ')}`;
  const selectedIndex = selected ? steps.findIndex(s => s.id === selected.id) : -1;

  // ── Plain-language summary ──
  const channelNames = p.channels.map(c => channelWord(c));
  const joinedText = snap === -1 ? 'audience still being gathered'
    : snap === -2 ? 'audience could not be gathered'
      : joinedCount !== null ? `${fmtCount(joinedCount)} joined` : null;
  const audience = detail.segment_name
    ? `Sends ${channelNames.length ? `${joinWords(channelNames)} ` : ''}to people in '${detail.segment_name}'${joinedText ? ` (${joinedText})` : ''}`
    : 'No audience picked yet';
  const scheduled = detail.status === 'draft' ? humanDateTime(detail.scheduled_start_at) : null;
  const created = humanDay(detail.created_at);
  const summaryRest = [audience, scheduled ? `Starts ${scheduled}` : created ? `Created ${created}` : null]
    .filter(Boolean).join(' · ');

  const explain = detail.status === 'active'
    ? isAlwaysOn
      ? 'This journey is running. New people who match the segment join automatically.'
      : 'This journey is running. Everyone in the segment joined when it started and moves through the steps on schedule.'
    : detail.status === 'paused'
      ? 'Paused — nobody receives messages until you resume it.'
      : detail.status === 'draft'
        ? scheduled
          ? `Draft — it starts by itself: ${scheduled} (Dubai time). Nobody gets messages before then.`
          : 'Draft — nobody receives messages until you start it.'
        : detail.status === 'completed'
          ? 'Finished — everyone has been through the steps. No more messages will be sent.'
          : null;
  const howJoin = isAlwaysOn
    ? 'Automatically, whenever someone in the segment qualifies'
    : 'Once — everyone in the segment when the journey starts';

  const nodeStats = (id: string) => detail.node_stats?.[id];
  const blockedFor = (id: string) =>
    num((Array.isArray(detail.nodeAnalytics) ? detail.nodeAnalytics : []).find(r => r.node_id === id && r.event_type === 'action_blocked')?.event_count);

  const queueChannels = p.channels.filter(c => p.queueStats?.[c]);
  const pages = Math.max(1, Math.ceil(p.entriesTotal / PAGE_SIZE));

  const revealAdvanced = () => {
    setTimeout(() => {
      const el = advancedRef.current;
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };
  const openTool = (fn: () => void) => () => { fn(); revealAdvanced(); };

  const moreItem = (label: string, icon: ReactNode, fn: () => void, danger = false) => (
    <button type="button" role="menuitem" className={danger ? `${styles.menuItem} ${styles.danger}` : styles.menuItem}
      onClick={() => { setMoreOpen(false); fn(); }}>
      {icon}{label}
    </button>
  );

  const techRows: [string, string][] = [
    ['Journey ID', String(detail.journey_id ?? p.journeyId)],
    ['Status code', detail.status || '—'],
    ['Journey type', detail.journey_type || '—'],
    ['Trigger event', detail.trigger_event || '—'],
    ['Audience size (snapshot_count)', detail.snapshot_count === null || detail.snapshot_count === undefined ? '—' : String(detail.snapshot_count)],
    ['Goal type', detail.goal_type || '—'],
    ['Created', humanDateTime(detail.created_at) || '—'],
    ['Last updated', humanDateTime(detail.updated_at) || '—'],
    ['Steps (incl. entry)', String(nodes.length)],
  ];

  return (
    <div className={styles.page}>
      {/* ── Summary ────────────────────────────────────────── */}
      <header className={styles.header}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <button type="button" className={styles.back} onClick={p.onBack}><ArrowLeft size={14} /> All journeys</button>
        </nav>
        <div className={styles.headRow}>
          <div className={styles.headMain}>
            {p.editSlot ?? (
              <>
                <h1 className={styles.title}>{detail.name || `Journey ${p.journeyId}`}</h1>
                {detail.description && <p className={styles.desc}>{detail.description}</p>}
              </>
            )}
          </div>
          <div className={styles.actions}>
            {detail.status === 'draft' && (
              <Button variant="primary" onClick={p.onStart} disabled={p.starting}>
                <Play size={14} /> {p.starting ? 'Starting…' : 'Start journey'}
              </Button>
            )}
            {detail.status === 'active' && <Button onClick={p.onPauseResume}><Pause size={14} /> Pause</Button>}
            {detail.status === 'paused' && <Button variant="primary" onClick={p.onPauseResume}><Play size={14} /> Resume</Button>}
            <Button onClick={p.onEdit}><Edit3 size={14} /> Edit</Button>
            <div className={styles.moreWrap} ref={moreRef}>
              <Button aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)}>
                <MoreHorizontal size={16} /> More
              </Button>
              {moreOpen && (
                <div role="menu" aria-label="More actions" className={styles.menu}>
                  {moreItem('Edit steps', <GitBranch size={14} />, openTool(p.onEditSteps))}
                  {moreItem(p.suggestLoading ? 'AI flow assist (analyzing…)' : 'AI flow assist', <Sparkles size={14} />, openTool(p.onAISuggest))}
                  {moreItem('Full people list', <Users size={14} />, openTool(() => p.onOpenTab('entries')))}
                  {moreItem('Analytics', <BarChart3 size={14} />, openTool(() => p.onOpenTab('analytics')))}
                  {moreItem('Activity', <Activity size={14} />, openTool(() => p.onOpenTab('activity')))}
                  {moreItem('Settings', <Settings size={14} />, openTool(() => p.onOpenTab('settings')))}
                  {moreItem('Copy journey ID', <Copy size={14} />, p.onCopyId)}
                  {moreItem('Delete journey', <Trash2 size={14} />, p.onDelete, true)}
                </div>
              )}
            </div>
          </div>
        </div>

        <section className={styles.summaryBox} aria-label="Journey summary">
          <p className={styles.summary}>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <span className={styles.srOnly}> · </span>
            <span>{summaryRest}</span>
          </p>
          {explain && <p className={styles.explain}>{explain}</p>}
          <dl className={styles.facts}>
            <div><dt>How people join</dt><dd>{howJoin}</dd></div>
            <div><dt>Sends by</dt><dd>{p.channels.length ? p.channels.map(channelLabel).join(' + ') : 'No messages yet'}</dd></div>
            {detail.stage_name && <div><dt>Stage</dt><dd>{detail.stage_name}</dd></div>}
          </dl>
          {detail.test_mode && (
            <p className={styles.testMode}><Chip tone="warn">Test mode</Chip> Messages only go to the test address, not to real customers.</p>
          )}
        </section>
      </header>

      {/* ── How is it doing? ───────────────────────────────── */}
      <Card title="How is it doing?">
        <div className={styles.kpis} role="list" aria-label="Journey totals">
          {kpis.map(k => (
            <div key={k.label} className={styles.kpi} role="listitem">
              <span className={styles.kpiLabel}>{k.label}</span>
              <span className={k.bad ? `${styles.kpiValue} ${styles.bad}` : styles.kpiValue}>{k.value}</span>
              {k.pct && <span className={styles.kpiPct}>{k.pct}</span>}
              <span className={styles.help}>{k.help}</span>
            </div>
          ))}
        </div>
        <div className={styles.chartBlock}>
          <h3 className={styles.chartTitle}>Where people drop off</h3>
          <p className={styles.help}>How many people reached each stage, and what share of everyone who joined that is.</p>
          {funnelHasData ? (
            <div role="img" aria-label={funnelLabel} className={styles.chart}>
              <JourneyFunnelChart data={funnel} />
            </div>
          ) : (
            <p className={styles.noData}>No data yet</p>
          )}
        </div>
      </Card>

      {/* ── What happens, step by step ─────────────────────── */}
      <div className={selected ? `${styles.split} ${styles.splitOn}` : styles.split}>
        <Card
          title="What happens, step by step"
          actions={<Button size="sm" variant="ghost" onClick={openTool(p.onEditSteps)}><GitBranch size={14} /> Edit steps</Button>}
        >
          {steps.length === 0 ? (
            <EmptyState title="No steps yet" description="This journey doesn't send anything yet. Add steps to decide what people receive." action={<Button size="sm" onClick={openTool(p.onEditSteps)}>Add steps</Button>} />
          ) : (
            <>
              <p className={styles.flowStart}><Users size={14} /> People join: {howJoin.charAt(0).toLowerCase() + howJoin.slice(1)}.</p>
              <ol className={styles.flow} aria-label="Journey steps">
                {steps.map((n, i) => {
                  const st = detail.node_statuses?.[n.id];
                  const ns = nodeStats(n.id);
                  const sent = p.sentByNode[n.id];
                  const opened = p.openedByNode[n.id];
                  const openPct = n.type === 'action' && sent > 0 && opened !== undefined ? pctOf(opened, sent) : null;
                  const on = selected?.id === n.id;
                  const isWait = n.type === 'wait';
                  const sentence = stepSentence(n, n.type === 'action' ? p.getNodeTemplate(n) : null);
                  const metrics: string[] = [];
                  if (n.type === 'action' && sent !== undefined && hasRun) metrics.push(`sent ${fmtNum(sent)}`);
                  if (openPct !== null) metrics.push(`opened ${openPct}%`);
                  const day = days[n.id];
                  return (
                    <li key={n.id} className={isWait ? styles.waitItem : styles.stepItem}>
                      <button
                        type="button"
                        className={[isWait ? styles.wait : styles.step, on ? styles.stepOn : ''].filter(Boolean).join(' ')}
                        aria-pressed={on}
                        aria-label={`Step ${i + 1}: ${sentence}`}
                        onClick={() => setSelectedId(on ? null : n.id)}
                      >
                        <span className={isWait ? styles.waitIcon : styles.stepNum} aria-hidden="true">
                          {isWait ? <Clock size={14} /> : i + 1}
                        </span>
                        <span className={styles.stepBody}>
                          <span className={styles.stepTop}>
                            {day !== undefined && hasWaits && <span className={styles.day}>Day {day}</span>}
                            <span className={styles.sentence}>
                              <span className={styles.srOnly}>{i + 1} · </span>{sentence}
                              {metrics.length > 0 && <span className={styles.metric}> ({metrics.join(' · ')})</span>}
                            </span>
                            {st && <Chip tone={stepStatus(st).tone}>{stepStatus(st).label}</Chip>}
                          </span>
                          {!isWait && n.data?.label && sentence.indexOf(n.data.label) === -1 && (
                            <span className={styles.help}>{n.data.label}</span>
                          )}
                          {ns && (
                            <span className={styles.stepStats}>
                              <span><b>{fmtNum(ns.active)}</b> on this step now</span>
                              <span><b>{fmtNum(ns.completed)}</b> done</span>
                            </span>
                          )}
                        </span>
                        <ChevronRight size={16} className={styles.chev} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className={styles.help}>Click a step to see its message, timing and how it is doing.</p>
              <div className={styles.chartBlock}>
                <h3 className={styles.chartTitle}>People at each step</h3>
                <p className={styles.help}>How many people are on each step right now. Click a bar to open that step.</p>
                {stepChartHasData ? (
                  <div role="img" aria-label={stepChartLabel} className={styles.chart}>
                    <JourneyStepChart
                      data={stepChart}
                      selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
                      onSelect={i => { const s = steps[i]; if (s) setSelectedId(s.id); }}
                    />
                  </div>
                ) : (
                  <p className={styles.noData}>No data yet</p>
                )}
              </div>
            </>
          )}
        </Card>

        {selected && (
          <Card
            title={`Step ${stepNumber[selected.id]} · ${stepName(selected)}`}
            className={styles.panel}
            aria-label="Step details"
            actions={<Button size="sm" variant="ghost" aria-label="Close step details" onClick={() => setSelectedId(null)}><X size={14} /></Button>}
          >
            <StepPanel
              node={selected}
              sentence={stepSentence(selected, selected.type === 'action' ? p.getNodeTemplate(selected) : null)}
              tl={timelineMap[selected.id]}
              status={detail.node_statuses?.[selected.id]}
              ranking={detail.node_ranking_sources?.[selected.id]}
              tpl={p.getNodeTemplate(selected)}
              blocked={blockedFor(selected.id)}
              here={nodeStats(selected.id)?.active ?? null}
              done={nodeStats(selected.id)?.completed ?? null}
              sent={p.sentByNode[selected.id]}
              opened={p.openedByNode[selected.id]}
              previewLoading={p.previewLoading}
              onPreview={() => p.onPreviewNode(selected)}
              onRetry={() => p.onRetryBlocked(selected.id)}
            />
          </Card>
        )}
      </div>

      {/* ── Who is in this journey ─────────────────────────── */}
      <Card
        title={`Who is in this journey${p.entriesTotal > 0 ? ` (${fmtNum(p.entriesTotal)} people)` : ''}`}
        actions={
          <label className={styles.filter}>
            <span>Show</span>
            <Select
              aria-label="Filter people by status"
              value={p.entriesStatus}
              onChange={e => p.onEntriesQuery(1, e.target.value)}
            >
              {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </Select>
          </label>
        }
      >
        {p.entriesLoading && entries.length === 0 ? (
          <div className={styles.skelList} aria-label="Loading people">{[0, 1, 2].map(i => <Skeleton key={i} height={18} />)}</div>
        ) : p.entriesError ? (
          <ErrorState
            title="We couldn't load the people in this journey"
            description="Please try again in a moment."
            action={<Button size="sm" onClick={() => p.onEntriesQuery(p.entriesPage || 1, p.entriesStatus)}><RefreshCw size={14} /> Try again</Button>}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title={p.entriesStatus ? 'Nobody matches this filter' : 'Nobody has joined yet'}
            description={p.entriesStatus ? 'Try showing everyone.' : 'People appear here once they join the journey.'}
          />
        ) : (
          <>
            <Table label="People in this journey">
              <thead><tr><th>Contact</th><th>Current step</th><th>Status</th><th>Joined on</th><th>Next message</th></tr></thead>
              <tbody>
                {entries.map(e => {
                  const node = nodes.find(n => n.id === e.current_node_id);
                  const ps = personStatus(e);
                  const stepNo = node ? stepNumber[node.id] : undefined;
                  return (
                    <tr key={e.entry_id}>
                      <td><div className={styles.contact}><span>{e.name || e.email || 'Unnamed contact'}</span>{e.name && e.email && <span className={styles.help}>{e.email}</span>}</div></td>
                      <td>{node ? (node.type === 'trigger' ? 'Just joined' : `${stepNo ? `Step ${stepNo} · ` : ''}${stepName(node)}`) : '—'}</td>
                      <td><Chip tone={ps.tone}>{ps.label}</Chip></td>
                      <td className={styles.num}>{humanDay(e.entered_at) || '—'}</td>
                      <td className={styles.num}>{e.status === 'active' ? (humanDateTime(e.next_fire_at) || '—') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {p.entriesTotal > PAGE_SIZE && (
              <nav className={styles.pager} aria-label="People pages">
                <Button size="sm" variant="ghost" disabled={p.entriesLoading || p.entriesPage <= 1} onClick={() => p.onEntriesQuery(p.entriesPage - 1, p.entriesStatus)}>Previous</Button>
                <span className={styles.help}>Page {p.entriesPage} of {pages}</span>
                <Button size="sm" variant="ghost" disabled={p.entriesLoading || p.entriesPage >= pages} onClick={() => p.onEntriesQuery(p.entriesPage + 1, p.entriesStatus)}>Next</Button>
              </nav>
            )}
          </>
        )}
      </Card>

      {/* ── Advanced ───────────────────────────────────────── */}
      <section className={styles.advanced} ref={advancedRef} aria-label="Advanced">
        <button
          type="button"
          className={styles.advToggle}
          aria-expanded={p.advancedOpen}
          aria-controls="journey-advanced"
          onClick={p.onToggleAdvanced}
        >
          {p.advancedOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className={styles.advTitle}>Advanced</span>
          <span className={styles.help}>Flow builder, analytics, activity, settings, delivery queue and technical details</span>
        </button>
        {p.advancedOpen && (
          <div id="journey-advanced" className={styles.advBody}>
            <Card title="Delivery queue" actions={<span className={styles.help}>Live counts per channel, shared by all journeys</span>}>
              {p.queueStats === null ? (
                <p className={styles.help}>Queue counts are not available right now.</p>
              ) : queueChannels.length === 0 ? (
                <p className={styles.help}>No queue for this journey&apos;s channels.</p>
              ) : (
                <div className={styles.queue}>
                  {queueChannels.map(c => {
                    const q = p.queueStats?.[c] || {};
                    return (
                      <div key={c} className={styles.queueRow}>
                        <strong>{channelLabel(c)}</strong>
                        <span><b>{fmtNum(q.waiting)}</b> waiting</span>
                        <span><b>{fmtNum(q.delayed)}</b> scheduled</span>
                        <span><b>{fmtNum(q.active)}</b> sending</span>
                        <span className={num(q.failed) > 0 ? styles.bad : undefined}><b>{fmtNum(q.failed)}</b> failed</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <details className={styles.tech}>
              <summary>Technical details</summary>
              <dl className={styles.dl}>
                {techRows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
              </dl>
            </details>
            {p.advancedSlot}
          </div>
        )}
      </section>
    </div>
  );
}

interface StepPanelProps {
  node: JourneyNode;
  sentence: string;
  tl?: TimelineItem;
  status?: string;
  ranking?: string;
  tpl: ContentTemplate | null;
  blocked: number;
  here: number | null;
  done: number | null;
  sent?: number;
  opened?: number;
  previewLoading: boolean;
  onPreview: () => void;
  onRetry: () => void;
}

function StepPanel({ node, sentence, tl, status, ranking, tpl, blocked, here, done, sent, opened, previewLoading, onPreview, onRetry }: StepPanelProps) {
  const rows: [string, string][] = [];
  rows.push(['What it does', sentence]);
  if (node.data?.channel) rows.push(['Sent by', channelLabel(node.data.channel)]);
  if (node.data?.restChannel && node.type === 'action' && node.data.channel?.toLowerCase() === 'whatsapp') {
    rows.push(['If WhatsApp isn’t possible', `Sends ${channelWord(node.data.restChannel)} instead`]);
  }
  if (node.type === 'wait' && waitText(node)) rows.push(['Waits for', waitText(node) as string]);
  const hour = sendHourText(node);
  if (hour) rows.push(['Sends at', `${hour} (Dubai time)`]);
  if (node.data?.condition && node.type === 'condition') rows.push(['Checks', CONDITION_LABELS[node.data.condition] || node.data.condition]);
  if (status) rows.push(['Status', stepStatus(status).label]);
  if (here !== null) rows.push(['On this step now', fmtNum(here)]);
  if (done !== null) rows.push(['Done with this step', fmtNum(done)]);
  if (node.type === 'action' && sent !== undefined) rows.push(['Messages sent', fmtNum(sent)]);
  const openPct = node.type === 'action' && sent !== undefined && sent > 0 && opened !== undefined ? pctOf(opened, sent) : null;
  if (openPct !== null) rows.push(['Opened', `${fmtNum(opened)} (${openPct}%)`]);
  const fired = humanDateTime(tl?.triggeredAt);
  const next = humanDateTime(tl?.nextFireAt || tl?.predictedAt);
  rows.push(['Last ran', fired || 'Not yet']);
  rows.push(['Next message', next || '—']);

  const tech: [string, string][] = [['Step ID', node.id], ['Step type', node.type]];
  if (status) tech.push(['Status code', status]);
  if (ranking) tech.push(['Content ranking', ranking]);
  if (tpl) tech.push(['Template ID', String(tpl.id)]);

  return (
    <div className={styles.panelBody}>
      {node.type === 'action' && (
        <div className={styles.tplBox}>
          <span className={styles.kpiLabel}>Message</span>
          {tpl ? (
            <>
              <strong>{tpl.name || tpl.wa_template_name || 'Untitled message'}</strong>
              {tpl.subject && <span className={styles.help}>Subject: {tpl.subject}</span>}
              <Button size="sm" onClick={onPreview} disabled={previewLoading}><Eye size={14} /> Preview</Button>
            </>
          ) : (
            <span className={styles.bad}>No template set for this step</span>
          )}
        </div>
      )}
      <dl className={styles.dl}>
        {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
      {blocked > 0 && (
        <div className={styles.warnBox} role="status">
          <span><b>{fmtNum(blocked)}</b> people were skipped because no template was set when they reached this step.</span>
          <Button size="sm" onClick={onRetry}><RefreshCw size={14} /> Retry skipped</Button>
        </div>
      )}
      <details className={styles.tech}>
        <summary>Technical details</summary>
        <dl className={styles.dl}>
          {tech.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </details>
    </div>
  );
}
