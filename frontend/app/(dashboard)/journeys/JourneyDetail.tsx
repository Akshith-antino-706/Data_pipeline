'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft, BarChart3, Activity, Copy, Edit3, Eye, GitBranch, MoreHorizontal, Pause, Play,
  RefreshCw, Settings, Sparkles, Trash2, Users,
} from 'lucide-react';
import { Button, Card, Chip, StatusChip, EmptyState, Skeleton, Table } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import type {
  JourneyDetail, JourneyNode, QueueCounts, TimelineItem, JourneyEntry, ContentTemplate,
} from '@/types/f1Journeys';
import styles from './JourneyDetail.module.css';

// ── Helpers ────────────────────────────────────────────────────
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const fmtNum = (v: unknown) => num(v).toLocaleString();
const fmtDate = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

const STATUS_TONE: Record<string, { tone: ChipTone; label: string }> = {
  active: { tone: 'ok', label: 'Running' },
  paused: { tone: 'warn', label: 'Paused' },
  draft: { tone: 'mute', label: 'Draft' },
  completed: { tone: 'info', label: 'Completed' },
};
export const journeyStatusChip = (status: string | undefined) =>
  STATUS_TONE[status || ''] || { tone: 'mute' as ChipTone, label: status || 'Unknown' };

const NODE_KIND: Record<string, string> = {
  trigger: 'Entry', action: 'Message', wait: 'Wait', condition: 'Check', goal: 'Goal', split: 'Split', exit: 'Exit',
};
const CHANNEL_LABEL: Record<string, string> = {
  email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'Push', rcs: 'RCS', web: 'Web', inapp: 'In-app',
};
const channelLabel = (c: string) => CHANNEL_LABEL[c.toLowerCase()] || c;

const NODE_STATUS_TONE: Record<string, ChipTone> = {
  completed: 'ok', done: 'ok', active: 'info', running: 'info', processing: 'info', waiting: 'warn', pending: 'mute', failed: 'bad',
};

const waitText = (node: JourneyNode): string | null => {
  const v = num(node.data?.waitDays);
  if (!v) return null;
  const unit = node.data?.waitUnit || 'days';
  return `${v} ${v === 1 ? unit.replace(/s$/, '') : unit}`;
};

const nodeTitle = (node: JourneyNode): string =>
  node.data?.label || (node.data?.channel ? channelLabel(node.data.channel) : '') || NODE_KIND[node.type] || node.type;

// ── Loading skeleton ───────────────────────────────────────────
export function JourneyDetailSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading journey">
      {children}
      <div className={styles.headSkel}>
        <Skeleton width={120} height={14} />
        <Skeleton width="min(320px, 80%)" height={26} />
        <Skeleton width="min(260px, 70%)" height={14} />
      </div>
      <div className={styles.kpis}>
        {['Joined', 'In progress', 'Finished', 'Unsubscribed'].map(l => (
          <Card key={l} className={styles.kpi}>
            <span className={styles.eyebrow}>{l}</span>
            <Skeleton width={70} height={24} />
          </Card>
        ))}
      </div>
      <Card title="Steps">
        <div className={styles.steps}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={64} radius={12} />)}
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
  failedTotal: number;
  sentByNode: Record<string, number>;
  queueStats: Record<string, QueueCounts> | null;
  timeline: TimelineItem[] | null;
  entries: JourneyEntry[];
  entriesTotal: number;
  entriesLoading: boolean;
  starting: boolean;
  suggestLoading: boolean;
  previewLoading: boolean;
  /** Replaces the title/description while the rename form is open. */
  editSlot?: ReactNode;
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
  onPreviewNode: (node: JourneyNode) => void;
  onRetryBlocked: (nodeId: string) => void;
  onLoadEntries: () => void;
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

  const steps = useMemo(() => nodes.filter(n => n.type !== 'trigger'), [nodes]);
  const selected = steps.find(n => n.id === selectedId) || steps[0] || null;
  const timelineMap = useMemo(() => {
    const m: Record<string, TimelineItem> = {};
    (Array.isArray(p.timeline) ? p.timeline : []).forEach(t => { if (t && t.nodeId) m[t.nodeId] = t; });
    return m;
  }, [p.timeline]);

  // snapshot_count: -1 while the audience builds, -2 if that build failed.
  const snap = num(detail.snapshot_count);
  const joined = snap === -1 ? 'Building…' : snap === -2 ? 'Build failed' : fmtNum(snap || stats?.total_entries);
  const unsub = stats?.unsubscribed_from_journey ?? stats?.unsubscribed_during_journey ?? stats?.exited_unsubscribed;
  const kpis: { label: string; value: string; hint?: string }[] = [
    { label: 'Joined', value: joined },
    { label: 'In progress', value: fmtNum(stats?.active) },
    { label: 'Finished', value: fmtNum(stats?.completed) },
    { label: 'Booked', value: fmtNum(stats?.exited_booked), hint: 'Left the journey after booking' },
    { label: 'Unsubscribed', value: fmtNum(unsub) },
    { label: 'Failed sends', value: fmtNum(p.failedTotal) },
  ];

  const nodeStats = (id: string) => detail.node_stats?.[id];
  const blockedFor = (id: string) =>
    num((Array.isArray(detail.nodeAnalytics) ? detail.nodeAnalytics : []).find(r => r.node_id === id && r.event_type === 'action_blocked')?.event_count);

  const queueChannels = p.channels.filter(c => p.queueStats?.[c]);

  const metaParts: string[] = [];
  if (detail.created_at && fmtDate(detail.created_at)) metaParts.push(`Created ${fmtDate(detail.created_at)}`);
  if (detail.updated_at && fmtDate(detail.updated_at)) metaParts.push(`Updated ${fmtDate(detail.updated_at)}`);

  const moreItem = (label: string, icon: ReactNode, fn: () => void, danger = false) => (
    <button type="button" role="menuitem" className={danger ? `${styles.menuItem} ${styles.danger}` : styles.menuItem}
      onClick={() => { setMoreOpen(false); fn(); }}>
      {icon}{label}
    </button>
  );

  return (
    <div className={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
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
            <div className={styles.metaRow}>
              <StatusChip tone={status.tone}>{status.label}</StatusChip>
              <Chip tone="mute">{isAlwaysOn ? 'Always-on' : 'One-time'}</Chip>
              {detail.test_mode && <Chip tone="warn">Test mode</Chip>}
              {p.channels.length > 0 && <Chip tone="info">{p.channels.map(channelLabel).join(' + ')}</Chip>}
              {detail.segment_name && <span className={styles.metaText}>Segment: {detail.segment_name}</span>}
              {detail.stage_name && <Chip tone="gold">{detail.stage_name}</Chip>}
              {metaParts.length > 0 && <span className={styles.metaText}>{metaParts.join(' · ')}</span>}
            </div>
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
                  {moreItem('Edit steps (flow builder)', <GitBranch size={14} />, p.onEditSteps)}
                  {moreItem(p.suggestLoading ? 'AI flow assist (analyzing…)' : 'AI flow assist', <Sparkles size={14} />, p.onAISuggest)}
                  {moreItem('All contacts', <Users size={14} />, () => p.onOpenTab('entries'))}
                  {moreItem('Analytics', <BarChart3 size={14} />, () => p.onOpenTab('analytics'))}
                  {moreItem('Activity', <Activity size={14} />, () => p.onOpenTab('activity'))}
                  {moreItem('Settings', <Settings size={14} />, () => p.onOpenTab('settings'))}
                  {moreItem('Copy journey ID', <Copy size={14} />, p.onCopyId)}
                  {moreItem('Delete journey', <Trash2 size={14} />, p.onDelete, true)}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── KPIs ───────────────────────────────────────────── */}
      <section className={styles.kpis} aria-label="Journey totals">
        {kpis.map(k => (
          <Card key={k.label} className={styles.kpi}>
            <span className={styles.kpiValue}>{k.value}</span>
            <span className={styles.eyebrow} title={k.hint}>{k.label}</span>
          </Card>
        ))}
      </section>

      {/* ── Steps + panel ──────────────────────────────────── */}
      <div className={styles.split}>
        <Card title={`Steps (${steps.length})`} actions={<Button size="sm" variant="ghost" onClick={p.onEditSteps}><GitBranch size={14} /> Edit steps</Button>}>
          {steps.length === 0 ? (
            <EmptyState title="No steps yet" description="Add steps in the flow builder." action={<Button size="sm" onClick={p.onEditSteps}>Open flow builder</Button>} />
          ) : (
            <ol className={styles.steps} aria-label="Journey steps">
              {steps.map((n, i) => {
                const st = detail.node_statuses?.[n.id];
                const ns = nodeStats(n.id);
                const sent = p.sentByNode[n.id];
                const on = selected?.id === n.id;
                const sub = n.type === 'wait' ? waitText(n) : n.data?.channel ? channelLabel(n.data.channel) : null;
                return (
                  <li key={n.id}>
                    {i > 0 && <span className={styles.conn} aria-hidden="true" />}
                    <button type="button" className={on ? `${styles.step} ${styles.stepOn}` : styles.step}
                      aria-pressed={on} onClick={() => setSelectedId(n.id)}>
                      <span className={styles.stepNum}>{i + 1}</span>
                      <span className={styles.stepBody}>
                        <span className={styles.stepTop}>
                          <span className={styles.eyebrow}>{NODE_KIND[n.type] || n.type}</span>
                          <strong className={styles.stepTitle}>{nodeTitle(n)}</strong>
                          {st && <Chip tone={NODE_STATUS_TONE[st] || 'mute'}>{st}</Chip>}
                        </span>
                        {sub && <span className={styles.help}>{sub}</span>}
                        <span className={styles.stepStats}>
                          {ns && <span><b>{fmtNum(ns.active)}</b> here now</span>}
                          {ns && ns.completed > 0 && <span><b>{fmtNum(ns.completed)}</b> finished</span>}
                          {n.type === 'action' && sent !== undefined && <span><b>{fmtNum(sent)}</b> sent</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        {selected && (
          <Card title={nodeTitle(selected)} className={styles.panel} aria-label="Step details">
            <StepPanel
              node={selected}
              tl={timelineMap[selected.id]}
              status={detail.node_statuses?.[selected.id]}
              ranking={detail.node_ranking_sources?.[selected.id]}
              tpl={p.getNodeTemplate(selected)}
              blocked={blockedFor(selected.id)}
              previewLoading={p.previewLoading}
              onPreview={() => p.onPreviewNode(selected)}
              onRetry={() => p.onRetryBlocked(selected.id)}
            />
          </Card>
        )}
      </div>

      {/* ── Delivery queue ─────────────────────────────────── */}
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

      {/* ── Contacts ───────────────────────────────────────── */}
      <Card title={`Contacts (${fmtNum(p.entriesTotal)})`} actions={<Button size="sm" variant="ghost" onClick={() => p.onOpenTab('entries')}>View all</Button>}>
        {p.entriesLoading && entries.length === 0 ? (
          <div className={styles.steps}>{[0, 1, 2].map(i => <Skeleton key={i} height={18} />)}</div>
        ) : entries.length === 0 ? (
          <EmptyState title="No contacts yet" description="People appear here once they join the journey." />
        ) : (
          <Table label="Journey contacts">
            <thead><tr><th>Contact</th><th>Status</th><th>Current step</th><th>Joined</th><th>Next send</th></tr></thead>
            <tbody>
              {entries.slice(0, 10).map(e => {
                const node = nodes.find(n => n.id === e.current_node_id);
                return (
                  <tr key={e.entry_id}>
                    <td><div className={styles.contact}><span>{e.name || e.email || `#${e.entry_id}`}</span>{e.name && e.email && <span className={styles.help}>{e.email}</span>}</div></td>
                    <td><Chip tone={e.status === 'active' ? 'ok' : e.status === 'completed' ? 'info' : e.status === 'failed' ? 'bad' : 'mute'}>{e.exit_reason ? `${e.status} · ${e.exit_reason}` : e.status}</Chip></td>
                    <td>{node ? nodeTitle(node) : '—'}</td>
                    <td className={styles.num}>{fmtDate(e.entered_at) || '—'}</td>
                    <td className={styles.num}>{fmtDate(e.next_fire_at) || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

interface StepPanelProps {
  node: JourneyNode;
  tl?: TimelineItem;
  status?: string;
  ranking?: string;
  tpl: ContentTemplate | null;
  blocked: number;
  previewLoading: boolean;
  onPreview: () => void;
  onRetry: () => void;
}

function StepPanel({ node, tl, status, ranking, tpl, blocked, previewLoading, onPreview, onRetry }: StepPanelProps) {
  const rows: [string, string][] = [];
  rows.push(['Type', NODE_KIND[node.type] || node.type]);
  if (node.data?.channel) rows.push(['Channel', channelLabel(node.data.channel)]);
  if (node.data?.restChannel && node.type === 'action' && node.data.channel?.toLowerCase() === 'whatsapp') rows.push(['Fallback channel', channelLabel(node.data.restChannel)]);
  if (node.type === 'wait' && waitText(node)) rows.push(['Wait', waitText(node) as string]);
  if (node.data?.sendHour !== null && node.data?.sendHour !== undefined && node.data.sendHour !== '') rows.push(['Send hour', `${String(node.data.sendHour).padStart(2, '0')}:00 Dubai`]);
  if (node.data?.condition && node.type !== 'action') rows.push(['Condition', node.data.condition]);
  if (status) rows.push(['Status', status]);
  if (ranking) rows.push(['Content ranking', ranking]);
  const fired = fmtDate(tl?.triggeredAt);
  const next = fmtDate(tl?.nextFireAt || tl?.predictedAt);
  if (fired) rows.push(['Last ran', fired]);
  if (next) rows.push(['Next run', next]);

  return (
    <div className={styles.panelBody}>
      {node.type === 'action' && (
        <div className={styles.tplBox}>
          <span className={styles.eyebrow}>Template</span>
          {tpl ? (
            <>
              <strong>{tpl.name || tpl.wa_template_name || `Template ${tpl.id}`}</strong>
              {tpl.subject && <span className={styles.help}>{tpl.subject}</span>}
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
          <span><b>{fmtNum(blocked)}</b> contacts skipped — the template wasn&apos;t set when they ran.</span>
          <Button size="sm" onClick={onRetry}><RefreshCw size={14} /> Retry skipped</Button>
        </div>
      )}
    </div>
  );
}
