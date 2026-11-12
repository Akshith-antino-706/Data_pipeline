'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getJourney, getJourneyAnalytics, getJourneyCampaignAnalytics, getJourneyGtmNodeStats } from '@/lib/api';
import {
  ArrowLeft, Zap, Send, GitBranch, Clock, Target, ChevronDown, ChevronUp,
  Mail, MessageCircle, Smartphone, Bell, Globe, MessageSquare, RefreshCw, MousePointerClick,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, Chip, ErrorState, EmptyState, PageHeader, Skeleton, StatusChip } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from '../campaigns.module.css';

type NumLike = number | string | null | undefined;
interface JourneyNodeData { channel?: string; templateName?: string; templateId?: string | number; waitDays?: number; label?: string }
interface JourneyNode { id: string; type: string; data?: JourneyNodeData }
interface JourneyDetail {
  name?: string; segment_name?: string; status: string; total_entries: string;
  nodes?: JourneyNode[]; node_statuses?: Record<string, string>;
}
interface NodeStatRow { node_id: string; event_type: string; count: string }
interface FunnelRow { current_node_id: string; status: string; count: string }
interface JourneyAnalytics { nodeStats?: NodeStatRow[]; funnelData?: FunnelRow[] }
interface CampaignRow {
  channel?: string; journey_node_id?: string;
  sent_count: string; target_count: string; bounce_count: string; fail_count: string;
}
interface CampaignAnalytics {
  campaigns?: CampaignRow[];
  gtm_clicks?: Record<string, number>; opens?: Record<string, number>;
  delivered_by_node?: Record<string, number>; bounced_by_node?: Record<string, number>;
  target_count: string;
  totals?: { total_sent?: number; total_read?: number; total_clicked?: number };
}
interface GtmEvent { event_name: string; event_count: number; unique_users: number; total_value: number }
interface GtmNodeStats { sent?: number; events?: GtmEvent[] }
interface GtmNodeStatsResponse { data?: Record<string, GtmNodeStats>; allEventTypes?: string[] }
interface NodeStatusChip { label: string; tone: ChipTone }
type Tint = 'ok' | 'bad' | 'warn' | 'info';
interface StatTileProps { label: string; value: NumLike; tint?: Tint; sub?: string | null; small?: boolean }
interface MetricProps { label: string; value: NumLike }
interface GtmEventGridProps { events: GtmEvent[] }

// ── Constants ──────────────────────────────────────────────────
const NODE_TYPE_LABEL: Record<string, string> = {
  trigger: 'Entry Trigger', action: 'Send Message',
  condition: 'Branch', wait: 'Wait / Delay', goal: 'Conversion Goal',
};
const NODE_TYPE_ICON: Record<string, LucideIcon> = { trigger: Zap, action: Send, condition: GitBranch, wait: Clock, goal: Target };
const CHANNEL_ICON: Record<string, LucideIcon>   = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell, rcs: MessageSquare, web: Globe };
const STATUS_TONE: Record<string, ChipTone>      = { active: 'ok', draft: 'mute', paused: 'warn', completed: 'info' };

const fmt    = (n: NumLike) => { const v = Number(n); return (Number.isFinite(v) ? v : 0).toLocaleString(); };
const fmtAed = (n: number) => (Number.isFinite(n) && n > 0) ? `AED ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null;

const PENDING: NodeStatusChip   = { label: 'pending',    tone: 'mute' };
const RUNNING: NodeStatusChip   = { label: 'running',    tone: 'ok' };
const COMPLETED: NodeStatusChip = { label: 'completed',  tone: 'ok' };
const SENDING: NodeStatusChip   = { label: 'sending',    tone: 'info' };
const WAITING: NodeStatusChip   = { label: 'waiting',    tone: 'warn' };
const MONITOR: NodeStatusChip   = { label: 'monitoring', tone: 'gold' };

// ── Node status: every node type gets a chip ──────────────────
// backendStatus: 'pending'|'running'|'sending'|'waiting'|'paused'|'completed'
// sending  = jobs in BullMQ queue (action node, workers sending emails)
// waiting  = entries at wait node but next_fire_at is in the future
// running  = cron actively advancing entries (trigger / condition / goal)
function getNodeStatus(nodeType: string, journeyStatus: string, sent: number, inQueue: number, funnelActive: number, funnelCompleted: number, backendStatus: string | undefined): NodeStatusChip {
  const hasAnyData = sent > 0 || inQueue > 0 || funnelActive > 0 || funnelCompleted > 0;

  // Paused always wins — journey paused, entries frozen here
  if (backendStatus === 'paused') return { label: 'paused', tone: 'warn' };

  if (nodeType === 'trigger') {
    if (backendStatus === 'completed') return COMPLETED;
    if (backendStatus === 'running')   return RUNNING;
    if (journeyStatus === 'active')    return RUNNING;
    if (journeyStatus === 'completed') return { label: 'completed', tone: 'info' };
    return PENDING;
  }

  if (nodeType === 'wait') {
    if (backendStatus === 'waiting')   return WAITING;
    if (funnelActive > 0)              return WAITING;
    if (backendStatus === 'completed') return COMPLETED;
    if (funnelCompleted > 0)           return COMPLETED;
    if (backendStatus === 'running')   return RUNNING;
    return PENDING;
  }

  if (nodeType === 'action') {
    if (backendStatus === 'sending')   return SENDING;
    if (inQueue > 0)                   return SENDING;
    if (sent > 0)                      return COMPLETED;
    if (backendStatus === 'completed') return COMPLETED;
    if (backendStatus === 'running')   return SENDING;
    return PENDING;
  }

  if (nodeType === 'goal') {
    if (backendStatus === 'monitoring') return MONITOR;
    if (backendStatus === 'completed')  return COMPLETED;
    if (hasAnyData)                     return MONITOR;
    return PENDING;
  }

  // condition
  if (backendStatus === 'running')   return RUNNING;
  if (hasAnyData)                    return RUNNING;
  if (backendStatus === 'completed') return COMPLETED;
  return PENDING;
}

function StatTile({ label, value, tint, sub, small = false }: StatTileProps) {
  return (
    <div className={small ? styles.kpiSm : styles.kpi}>
      <span className={styles.eyebrow}>{label}</span>
      <span className={[styles.kpiValue, tint ? styles[tint] : ''].filter(Boolean).join(' ')}>{fmt(value)}</span>
      {sub != null && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

function Metric({ label, value }: MetricProps) {
  return <span className={styles.metric}><b>{fmt(value)}</b>{label}</span>;
}

const pct = (num: number, den: number) => (den > 0 && Number.isFinite(num) ? `${((num / den) * 100).toFixed(1)}%` : null);

// ── GTM event card grid ───────────────────────────────────────
function GtmEventGrid({ events }: GtmEventGridProps) {
  if (!events || events.length === 0) return null;
  return (
    <div className={styles.gtmGrid}>
      {events.map(ev => {
        const hasData = ev.event_count > 0;
        const revenue = fmtAed(ev.total_value);
        return (
          <div key={ev.event_name} className={[styles.gtmCard, hasData ? '' : styles.gtmIdle].filter(Boolean).join(' ')}>
            <span className={styles.gtmName}>{ev.event_name}</span>
            <span className={styles.kpiValue}>{fmt(ev.event_count)}</span>
            <span className={styles.kpiSub}>{fmt(ev.unique_users)} unique users</span>
            {revenue && <span className={`${styles.kpiSub} ${styles.ok}`}>{revenue}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function CampaignDetail() {
  const router = useRouter();
  const { id } = useParams();

  const [journey, setJourney]           = useState<JourneyDetail | null>(null);
  const [analytics, setAnalytics]       = useState<JourneyAnalytics | null>(null);
  const [campaignData, setCampaignData] = useState<CampaignAnalytics | null>(null);
  const [gtmByNode, setGtmByNode]       = useState<Record<string, GtmNodeStats>>({});
  const [allEventTypes, setAllEventTypes] = useState<string[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [expanded, setExpanded]         = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing]     = useState(false);
  const [nodeDetailsLoaded, setNodeDetailsLoaded]   = useState(false);
  const [nodeDetailsLoading, setNodeDetailsLoading] = useState(false);

  // Initial load — only the two APIs needed for the visible page
  const load = async () => {
    try {
      const [jRes, cRes] = await Promise.allSettled([
        getJourney(id as string),
        getJourneyCampaignAnalytics(id as string),
      ]);
      if (jRes.status === 'fulfilled') setJourney((jRes.value as { data?: JourneyDetail }).data || jRes.value as JourneyDetail);
      if (cRes.status === 'fulfilled') setCampaignData((cRes.value as { data?: CampaignAnalytics }).data || cRes.value as CampaignAnalytics);
    } catch (err) {
      setError((err as Error).message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // Lazy-load node detail APIs (analytics + GTM) — called on first expand
  const loadNodeDetails = async () => {
    if (nodeDetailsLoaded || nodeDetailsLoading) return;
    setNodeDetailsLoading(true);
    try {
      const [aRes, gRes] = await Promise.allSettled([
        getJourneyAnalytics(id as string),
        getJourneyGtmNodeStats(id as string),
      ]);
      if (aRes.status === 'fulfilled') setAnalytics((aRes.value as { data?: JourneyAnalytics }).data || aRes.value as JourneyAnalytics);
      if (gRes.status === 'fulfilled') {
        const g = gRes.value as GtmNodeStatsResponse;
        setGtmByNode(g.data || {});
        setAllEventTypes(g.allEventTypes || []);
      }
      setNodeDetailsLoaded(true);
    } finally {
      setNodeDetailsLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const refresh = async () => {
    setRefreshing(true);
    setNodeDetailsLoaded(false);
    await load();
    if (Object.values(expanded).some(Boolean)) await loadNodeDetails();
    setRefreshing(false);
  };

  const toggleExpand = (nodeId: string) => {
    const willExpand = !expanded[nodeId];
    setExpanded(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
    if (willExpand) loadNodeDetails();
  };


  const crumbs = [{ label: 'Campaigns', href: '/campaigns' }];

  if (loading) return (
    <div className={styles.page}>
      <PageHeader title={<Skeleton width={220} height={22} />} breadcrumbs={crumbs} />
      <div className={styles.kpiGrid}>
        {['Target', 'Sent', 'Opened', 'Clicked'].map(label => (
          <div key={label} className={styles.kpi}>
            <span className={styles.eyebrow}>{label}</span>
            <Skeleton width={70} height={28} />
          </div>
        ))}
      </div>
      <Card title="Journey Nodes">
        <div className={styles.nodes}>
          {[...Array<undefined>(4)].map((_, i) => (
            <div key={i} className={styles.node}>
              <div className={styles.nodeHead}>
                <Skeleton width={26} height={26} radius={13} />
                <div className={styles.nodeMain}>
                  <Skeleton width={140} height={14} />
                  <div className={styles.nodeSub}><Skeleton width={80} height={10} /></div>
                </div>
                <Skeleton width={60} height={20} radius={20} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
  if (error)   return <div className={styles.page}><ErrorState description={error} /></div>;
  if (!journey) return <div className={styles.page}><EmptyState title="Journey not found" /></div>;

  const nodes = journey.nodes || [];

  // Per-node event analytics map
  const nodeAnalyticsMap: Record<string, Record<string, number>> = {};
  for (const row of (analytics?.nodeStats || [])) {
    if (!nodeAnalyticsMap[row.node_id]) nodeAnalyticsMap[row.node_id] = {};
    nodeAnalyticsMap[row.node_id][row.event_type] = parseInt(row.count) || 0;
  }

  // Funnel map: nodeId → { active, completed, ... }
  const funnelMap: Record<string, Record<string, number>> = {};
  for (const row of (analytics?.funnelData || [])) {
    if (!funnelMap[row.current_node_id]) funnelMap[row.current_node_id] = {};
    funnelMap[row.current_node_id][row.status] = parseInt(row.count) || 0;
  }

  // Campaign map by node — same logic as journey detail screen
  const nodeCampaignMap: Record<string, CampaignRow> = {};
  const _campaigns = campaignData?.campaigns || [];
  const _actionNodes = nodes.filter(n => n.type === 'action');
  const _campsByChannel: Record<string, CampaignRow[]> = {};
  _campaigns.forEach(c => {
    const ch = (c.channel || '').toLowerCase();
    if (!_campsByChannel[ch]) _campsByChannel[ch] = [];
    _campsByChannel[ch].push(c);
  });
  _actionNodes.forEach(n => {
    const ch = (n.data?.channel || '').toLowerCase();
    const matched = _campaigns.find(c => c.journey_node_id === n.id)
      || (_campsByChannel[ch] && _campsByChannel[ch].shift());
    if (matched) nodeCampaignMap[n.id] = matched;
  });

  const gtmClicks       = campaignData?.gtm_clicks       || {};
  const opens           = campaignData?.opens             || {};
  const deliveredByNode = campaignData?.delivered_by_node || {};
  const bouncedByNode   = campaignData?.bounced_by_node   || {};
  const globalTarget    = parseInt(campaignData?.target_count as string) || parseInt(journey.total_entries) || 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title={journey.name}
        breadcrumbs={[...crumbs, { label: journey.name || 'Campaign' }]}
        description={journey.segment_name ? `Segment: ${journey.segment_name}` : undefined}
        meta={<StatusChip tone={STATUS_TONE[journey.status] ?? 'mute'}>{journey.status}</StatusChip>}
        actions={<>
          <Button size="sm" onClick={() => router.back()}><ArrowLeft size={14} aria-hidden="true" /> Back</Button>
          <Button size="sm" icon aria-label="Refresh" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? styles.spin : undefined} aria-hidden="true" />
          </Button>
        </>}
      />

      {campaignData && (
        <div className={styles.kpiGrid}>
          <StatTile label="Target"  value={globalTarget} />
          <StatTile label="Sent"    value={campaignData.totals?.total_sent} />
          <StatTile label="Opened"  value={campaignData.totals?.total_read} />
          <StatTile label="Clicked" value={campaignData.totals?.total_clicked} />
        </div>
      )}

      <Card title={`Journey Nodes (${nodes.length})`}>
        {nodes.length === 0 ? (
          <EmptyState title="No nodes configured" />
        ) : (
          <div className={styles.nodes}>
            {nodes.map((node, idx) => {
              const Icon    = NODE_TYPE_ICON[node.type] || Target;
              const label   = NODE_TYPE_LABEL[node.type] || node.type;
              const channel = (node.data?.channel || '').toLowerCase();
              const ChIcon  = CHANNEL_ICON[channel];
              const templateName = node.data?.templateName
                || (node.data?.templateId ? `Template #${node.data.templateId}` : null);

              const ns       = nodeAnalyticsMap[node.id] || {};
              const camp     = nodeCampaignMap[node.id];
              const funnel   = funnelMap[node.id] || {};
              const nodeGtm  = gtmByNode[node.id] || {};
              // If this node has no gtm data yet, synthesise zero rows for all known event types
              const nodeGtmEvents = nodeGtm.events && nodeGtm.events.length > 0
                ? nodeGtm.events
                : allEventTypes.map(name => ({ event_name: name, event_count: 0, unique_users: 0, total_value: 0 }));

              // Sent: email_send_log (via gtm-node-stats) is source of truth
              const toNum = (v: unknown): number | undefined => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : undefined; };
              const sent      = nodeGtm.sent ?? toNum(ns.action_sent) ?? toNum(camp?.sent_count) ?? 0;
              const target    = parseInt(camp?.target_count as string) || globalTarget;
              const opened    = opens[node.id]           || parseInt(ns.action_read as unknown as string)    || 0;
              const clicked   = gtmClicks[node.id]       || parseInt(ns.action_clicked as unknown as string) || 0;
              const delivered = deliveredByNode[node.id] ?? 0;
              const bounced   = bouncedByNode[node.id]   ?? toNum(camp?.bounce_count) ?? 0;
              const failed    = parseInt(camp?.fail_count as string) || parseInt(ns.action_failed as unknown as string) || 0;
              const inQueue = funnel.active || 0;

              const funnelCompleted = (funnel.completed || 0) + (funnel.exited || 0);
              const backendNodeStatus = journey.node_statuses?.[node.id];
              const nodeStatus = getNodeStatus(node.type, journey.status, sent, inQueue, inQueue, funnelCompleted, backendNodeStatus);

              const isExpanded   = !!expanded[node.id];
              const isActionNode = node.type === 'action';
              const gtmTotal = nodeGtmEvents.reduce((s, e) => s + e.event_count, 0);

              return (
                <div key={node.id} className={[styles.node, isActionNode ? styles.nodeClickable : ''].filter(Boolean).join(' ')}>
                  <div
                    className={styles.nodeHead}
                    onClick={() => isActionNode && toggleExpand(node.id)}
                    role={isActionNode ? 'button' : undefined}
                    tabIndex={isActionNode ? 0 : undefined}
                    aria-expanded={isActionNode ? isExpanded : undefined}
                    onKeyDown={e => { if (isActionNode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleExpand(node.id); } }}
                  >
                    <span className={styles.step}>{idx + 1}</span>
                    <Icon size={15} className={styles.nodeIcon} aria-hidden="true" />
                    <div className={styles.nodeMain}>
                      <div className={styles.nodeTitle}>{label}</div>
                      <div className={styles.nodeSub}>
                        {node.type === 'action' && (
                          <>
                            {ChIcon && <ChIcon size={12} aria-hidden="true" />}
                            <span className={styles.channel}>{channel || '—'}</span>
                            {templateName && <><span aria-hidden="true">·</span><span>{templateName}</span></>}
                          </>
                        )}
                        {node.type === 'wait' && <span>Wait {node.data?.waitDays || 1} day{(node.data?.waitDays || 1) !== 1 ? 's' : ''}</span>}
                        {node.type === 'condition' && <span>{node.data?.label || 'Branch condition'}</span>}
                        {node.type === 'trigger'   && <span>{node.data?.label || 'Journey entry'}</span>}
                        {node.type === 'goal'      && <span>{node.data?.label || 'Conversion goal'}</span>}
                      </div>
                    </div>

                    <StatusChip tone={nodeStatus.tone}>{nodeStatus.label}</StatusChip>

                    {isActionNode && !isExpanded && (
                      <div className={styles.nodeChips}>
                        <Metric label="sent"    value={sent} />
                        <Metric label="opened"  value={opened} />
                        <Metric label="clicked" value={clicked} />
                        {gtmTotal > 0 && <Metric label="gtm events" value={gtmTotal} />}
                      </div>
                    )}

                    {isActionNode && (
                      <span className={styles.chev}>{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
                    )}
                    <span className={styles.nodeId}>{node.id}</span>
                  </div>

                  {isExpanded && (
                    <div className={styles.nodeBody}>
                      {nodeDetailsLoading && (
                        <div className={styles.tiles4}>
                          {[...Array<undefined>(4)].map((_, i) => (
                            <div key={i} className={styles.kpiSm}><Skeleton width={40} height={8} /><Skeleton width={60} height={20} /></div>
                          ))}
                        </div>
                      )}

                      <div className={styles.tiles4}>
                        <StatTile small label="Target"  value={target} />
                        <StatTile small label="Sent"    value={sent} />
                        <StatTile small label="Opened"  value={opened}  sub={pct(opened, sent)} />
                        <StatTile small label="Clicked" value={clicked} sub={pct(clicked, sent)} />
                      </div>
                      <div className={styles.tiles3}>
                        <StatTile small label="Delivered" value={delivered} tint={delivered > 0 ? 'ok' : undefined} sub={pct(delivered, sent)} />
                        <StatTile small label="Failed"    value={failed}    tint={failed > 0 ? 'bad' : undefined} />
                        <StatTile small label="Bounced"   value={bounced}   tint={bounced > 0 ? 'warn' : undefined} />
                      </div>

                      {sent > 0 && (
                        <div className={styles.funnel}>
                          <div className={styles.funnelHead}><strong>Engagement funnel</strong><span>{fmt(sent)} sent</span></div>
                          {[
                            { label: 'Opened',  value: opened,  alt: false },
                            { label: 'Clicked', value: clicked, alt: true },
                          ].map(bar => (
                            <div key={bar.label}>
                              <div className={styles.funnelHead}>
                                <span>{bar.label}</span>
                                <span>{fmt(bar.value)} ({pct(bar.value, sent) ?? '0%'})</span>
                              </div>
                              <div className={styles.track}>
                                <div
                                  className={[styles.bar, bar.alt ? styles.barAlt : ''].filter(Boolean).join(' ')}
                                  style={{ width: `${Math.min(Number.isFinite(bar.value / sent) ? (bar.value / sent) * 100 : 0, 100)}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {nodeGtmEvents.length > 0 && (
                        <div className={styles.gtm}>
                          <div className={styles.gtmHead}>
                            <MousePointerClick size={14} aria-hidden="true" />
                            <span className={styles.eyebrow}>GTM events</span>
                            <Chip tone="mute">{nodeGtmEvents.filter(e => e.event_count > 0).length} of {nodeGtmEvents.length} active</Chip>
                          </div>
                          <GtmEventGrid events={nodeGtmEvents} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
