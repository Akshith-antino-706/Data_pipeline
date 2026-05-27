'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { getJourney, getJourneyAnalytics, getJourneyCampaignAnalytics, getJourneyGtmNodeStats } from '@/lib/api';
import {
  ArrowLeft, Zap, Send, GitBranch, Clock, Target, ChevronDown, ChevronUp,
  Mail, MessageCircle, Smartphone, Bell, Globe, MessageSquare, RefreshCw, MousePointerClick,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────
const NODE_TYPE_LABEL = {
  trigger: 'Entry Trigger', action: 'Send Message',
  condition: 'Branch', wait: 'Wait / Delay', goal: 'Conversion Goal',
};
const NODE_TYPE_COLOR = {
  trigger: 'var(--red)', action: 'var(--green)',
  condition: 'var(--yellow)', wait: 'var(--yellow)', goal: 'var(--purple)',
};
const NODE_TYPE_ICON = { trigger: Zap, action: Send, condition: GitBranch, wait: Clock, goal: Target };
const CHANNEL_ICON   = { email: Mail, whatsapp: MessageCircle, sms: Smartphone, push: Bell, rcs: MessageSquare, web: Globe };
const CHANNEL_COLOR  = { email: 'var(--red)', whatsapp: '#25d366', sms: 'var(--orange)', push: 'var(--purple)' };
const STATUS_BADGE   = { active: 'badge-green', draft: 'badge-gray', paused: 'badge-orange', completed: 'badge-purple' };

const fmt    = (n) => Number(n || 0).toLocaleString();
const fmtAed = (n) => n > 0 ? `AED ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null;

const fadeInUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };
const stagger  = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };

// ── Node status: every node type gets a chip ──────────────────
// backendStatus: 'pending'|'running'|'sending'|'waiting'|'paused'|'completed'
// sending  = jobs in BullMQ queue (action node, workers sending emails)
// waiting  = entries at wait node but next_fire_at is in the future
// running  = cron actively advancing entries (trigger / condition / goal)
function getNodeStatus(nodeType, journeyStatus, sent, inQueue, funnelActive, funnelCompleted, backendStatus) {
  const hasAnyData = sent > 0 || inQueue > 0 || funnelActive > 0 || funnelCompleted > 0;

  // Paused always wins — journey paused, entries frozen here
  if (backendStatus === 'paused') return { label: 'paused', color: '#fb923c', bg: 'rgba(251,146,60,0.15)' };

  if (nodeType === 'trigger') {
    if (backendStatus === 'completed') return { label: 'completed', color: 'var(--green)',      bg: 'rgba(34,197,94,0.1)'  };
    if (backendStatus === 'running')   return { label: 'running',   color: 'var(--green)',      bg: 'rgba(34,197,94,0.1)'  };
    if (journeyStatus === 'active')    return { label: 'running',   color: 'var(--green)',      bg: 'rgba(34,197,94,0.1)'  };
    if (journeyStatus === 'completed') return { label: 'completed', color: 'var(--purple)',     bg: 'rgba(139,92,246,0.1)' };
    return                                    { label: 'pending',   color: 'var(--text-muted)', bg: 'var(--bg-tertiary)'   };
  }

  if (nodeType === 'wait') {
    // Backend 'waiting' = entries here, time not yet elapsed
    if (backendStatus === 'waiting')   return { label: 'waiting',   color: '#f59e0b',           bg: 'rgba(245,158,11,0.1)' };
    if (funnelActive > 0)              return { label: 'waiting',   color: '#f59e0b',           bg: 'rgba(245,158,11,0.1)' };
    if (backendStatus === 'completed') return { label: 'completed', color: 'var(--green)',       bg: 'rgba(34,197,94,0.1)'  };
    if (funnelCompleted > 0)           return { label: 'completed', color: 'var(--green)',       bg: 'rgba(34,197,94,0.1)'  };
    if (backendStatus === 'running')   return { label: 'running',   color: 'var(--green)',       bg: 'rgba(34,197,94,0.1)'  };
    return                                    { label: 'pending',   color: 'var(--text-muted)',  bg: 'var(--bg-tertiary)'   };
  }

  if (nodeType === 'action') {
    // Backend 'sending' = jobs are in BullMQ, workers actively sending
    if (backendStatus === 'sending')   return { label: 'sending',   color: '#3b82f6',           bg: 'rgba(59,130,246,0.1)' };
    if (sent > 0 && inQueue > 0)       return { label: 'sending',   color: '#3b82f6',           bg: 'rgba(59,130,246,0.1)' };
    if (inQueue > 0)                   return { label: 'sending',   color: '#3b82f6',           bg: 'rgba(59,130,246,0.1)' };
    if (sent > 0)                      return { label: 'completed', color: 'var(--green)',       bg: 'rgba(34,197,94,0.1)'  };
    if (backendStatus === 'completed') return { label: 'completed', color: 'var(--green)',       bg: 'rgba(34,197,94,0.1)'  };
    if (backendStatus === 'running')   return { label: 'sending',   color: '#3b82f6',           bg: 'rgba(59,130,246,0.1)' };
    return                                    { label: 'pending',   color: 'var(--text-muted)',  bg: 'var(--bg-tertiary)'   };
  }

  // goal
  if (nodeType === 'goal') {
    if (backendStatus === 'monitoring') return { label: 'monitoring', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
    if (backendStatus === 'completed')  return { label: 'completed',  color: 'var(--green)', bg: 'rgba(34,197,94,0.1)' };
    if (hasAnyData)                     return { label: 'monitoring', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' };
    return                                     { label: 'pending',    color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' };
  }

  // condition
  if (backendStatus === 'running')   return { label: 'running',   color: 'var(--green)',      bg: 'rgba(34,197,94,0.1)'  };
  if (hasAnyData)                    return { label: 'running',   color: 'var(--green)',      bg: 'rgba(34,197,94,0.1)'  };
  if (backendStatus === 'completed') return { label: 'completed', color: 'var(--green)',      bg: 'rgba(34,197,94,0.1)'  };
  return                                    { label: 'pending',   color: 'var(--text-muted)', bg: 'var(--bg-tertiary)'   };
}

function StatTile({ label, value, color = 'var(--text-primary)', sub }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-color)',
      borderRadius: 10, padding: '12px 10px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{fmt(value)}</div>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
      {sub != null && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Chip({ label, value, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 20,
      background: 'var(--bg-card)', border: '1px solid var(--border-color)', fontSize: 11,
    }}>
      <span style={{ fontWeight: 700, color: color || 'var(--text-primary)' }}>{fmt(value)}</span>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    </span>
  );
}

// ── GTM event card grid (like the screenshot) ─────────────────
function GtmEventGrid({ events }) {
  if (!events || events.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: 8 }}>
      {events.map(ev => {
        const hasData = ev.event_count > 0;
        const revenue = fmtAed(ev.total_value);
        return (
          <div key={ev.event_name} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 10, padding: '12px 14px', textAlign: 'center',
            opacity: hasData ? 1 : 0.45,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {ev.event_name}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: hasData ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1 }}>
              {fmt(ev.event_count)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {fmt(ev.unique_users)} unique users
            </div>
            {revenue && (
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', marginTop: 3 }}>
                {revenue}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CampaignDetail() {
  const router = useRouter();
  const { id } = useParams();

  const [journey, setJourney]           = useState(null);
  const [analytics, setAnalytics]       = useState(null);
  const [campaignData, setCampaignData] = useState(null);
  const [gtmByNode, setGtmByNode]       = useState({});
  const [allEventTypes, setAllEventTypes] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [expanded, setExpanded]         = useState({});
  const [refreshing, setRefreshing]     = useState(false);
  const [nodeDetailsLoaded, setNodeDetailsLoaded]   = useState(false);
  const [nodeDetailsLoading, setNodeDetailsLoading] = useState(false);

  // Initial load — only the two APIs needed for the visible page
  const load = async () => {
    try {
      const [jRes, cRes] = await Promise.allSettled([
        getJourney(id),
        getJourneyCampaignAnalytics(id),
      ]);
      if (jRes.status === 'fulfilled') setJourney(jRes.value.data || jRes.value);
      if (cRes.status === 'fulfilled') setCampaignData(cRes.value.data || cRes.value);
    } catch (err) {
      setError(err.message || 'Failed to load');
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
        getJourneyAnalytics(id),
        getJourneyGtmNodeStats(id),
      ]);
      if (aRes.status === 'fulfilled') setAnalytics(aRes.value.data || aRes.value);
      if (gRes.status === 'fulfilled') {
        const g = gRes.value;
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

  const toggleExpand = (nodeId) => {
    const willExpand = !expanded[nodeId];
    setExpanded(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
    if (willExpand) loadNodeDetails();
  };

  if (loading) return (
    <div>
      {/* Header skeleton */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <div>
            <div className="skeleton" style={{ width: 220, height: 20, borderRadius: 6, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 140, height: 12, borderRadius: 4 }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 64, height: 24, borderRadius: 20 }} />
        </div>
      </div>

      {/* Top stat tiles — labels visible, values shimmer */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'TARGET', color: 'var(--green)' },
          { label: 'SENT',   color: 'var(--green)' },
          { label: 'OPENED', color: '#3b82f6' },
          { label: 'CLICKED',color: 'var(--purple)' },
        ].map(({ label }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '16px 10px', textAlign: 'center' }}>
            <div className="skeleton" style={{ width: 70, height: 28, borderRadius: 6, margin: '0 auto 10px' }} />
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.6px', color: 'var(--text-muted)' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Node cards — section title visible, card content shimmers */}
      <div className="card">
        <div className="card-header">
          <h3>Journey Nodes</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="skeleton" style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }} />
                <div className="skeleton" style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: 140, height: 14, borderRadius: 4, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: 80, height: 10, borderRadius: 4 }} />
                </div>
                <div className="skeleton" style={{ width: 60, height: 20, borderRadius: 20 }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  {[...Array(3)].map((_, j) => (
                    <div key={j} className="skeleton" style={{ width: 56, height: 20, borderRadius: 20 }} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  if (error)   return <div className="empty" style={{ padding: 32 }}>{error}</div>;
  if (!journey) return <div className="empty" style={{ padding: 32 }}>Journey not found</div>;

  const nodes = journey.nodes || [];

  // Per-node event analytics map
  const nodeAnalyticsMap = {};
  for (const row of (analytics?.nodeStats || [])) {
    if (!nodeAnalyticsMap[row.node_id]) nodeAnalyticsMap[row.node_id] = {};
    nodeAnalyticsMap[row.node_id][row.event_type] = parseInt(row.count) || 0;
  }

  // Funnel map: nodeId → { active, completed, ... }
  const funnelMap = {};
  for (const row of (analytics?.funnelData || [])) {
    if (!funnelMap[row.current_node_id]) funnelMap[row.current_node_id] = {};
    funnelMap[row.current_node_id][row.status] = parseInt(row.count) || 0;
  }

  // Campaign map by node — same logic as journey detail screen
  const nodeCampaignMap = {};
  const _campaigns = campaignData?.campaigns || [];
  const _actionNodes = nodes.filter(n => n.type === 'action');
  const _campsByChannel = {};
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
  const globalTarget    = parseInt(campaignData?.target_count) || parseInt(journey.total_entries) || 0;

  return (
    <motion.div initial="hidden" animate="visible" variants={stagger}>

      {/* ── Header ── */}
      <motion.div variants={fadeInUp} className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.back()}>
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 style={{ margin: 0 }}>{journey.name}</h2>
            {journey.segment_name && (
              <div className="text-xs text-secondary" style={{ marginTop: 2 }}>
                Segment: {journey.segment_name}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={13} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
          <span className={`badge ${STATUS_BADGE[journey.status] || 'badge-gray'}`}>{journey.status}</span>
        </div>
      </motion.div>

      {/* ── Journey-level totals ── */}
      {campaignData && (
        <motion.div variants={fadeInUp} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
          <StatTile label="TARGET"  value={globalTarget}                      color="var(--green)" />
          <StatTile label="SENT"    value={campaignData.totals?.total_sent}    color="var(--green)" />
          <StatTile label="OPENED"  value={campaignData.totals?.total_read}    color="#3b82f6" />
          <StatTile label="CLICKED" value={campaignData.totals?.total_clicked} color="var(--purple)" />
        </motion.div>
      )}

      {/* ── Nodes ── */}
      <motion.div variants={fadeInUp} className="card">
        <div className="card-header">
          <h3>Journey Nodes ({nodes.length})</h3>
        </div>

        {nodes.length === 0 ? (
          <div className="empty">No nodes configured</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
            {nodes.map((node, idx) => {
              const Icon    = NODE_TYPE_ICON[node.type] || Target;
              const color   = NODE_TYPE_COLOR[node.type] || 'var(--text-secondary)';
              const label   = NODE_TYPE_LABEL[node.type] || node.type;
              const channel = (node.data?.channel || '').toLowerCase();
              const ChIcon  = CHANNEL_ICON[channel];
              const chColor = CHANNEL_COLOR[channel] || 'var(--text-muted)';
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
              const sent      = nodeGtm.sent ?? parseInt(ns.action_sent) ?? parseInt(camp?.sent_count) ?? 0;
              const target    = parseInt(camp?.target_count) || globalTarget;
              const opened    = opens[node.id]           || parseInt(ns.action_read)    || 0;
              const clicked   = gtmClicks[node.id]       || parseInt(ns.action_clicked) || 0;
              const delivered = deliveredByNode[node.id] ?? 0;
              const bounced   = bouncedByNode[node.id]   ?? parseInt(camp?.bounce_count) ?? 0;
              const failed    = parseInt(camp?.fail_count) || parseInt(ns.action_failed) || 0;
              const inQueue = funnel.active || 0;

              const funnelCompleted = (funnel.completed || 0) + (funnel.exited || 0);
              const backendNodeStatus = journey.node_statuses?.[node.id]; // 'pending'|'running'|'sending'|'waiting'|'paused'|'completed'
              const nodeStatus = getNodeStatus(node.type, journey.status, sent, inQueue, inQueue, funnelCompleted, backendNodeStatus);

              const isExpanded   = !!expanded[node.id];
              const isActionNode = node.type === 'action';

              return (
                <motion.div key={node.id} variants={fadeInUp}>
                  <div
                    onClick={() => isActionNode && toggleExpand(node.id)}
                    style={{
                      borderRadius: 10, border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      cursor: isActionNode ? 'pointer' : 'default',
                      overflow: 'hidden',
                    }}
                  >
                    {/* ── Node header row ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
                      {/* Step bubble */}
                      <div style={{
                        minWidth: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: color, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                      }}>{idx + 1}</div>

                      <Icon size={15} style={{ color, flexShrink: 0 }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {node.type === 'action' && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              {ChIcon && <ChIcon size={11} style={{ color: chColor }} />}
                              <span style={{ color: chColor, fontWeight: 500 }}>{channel || '—'}</span>
                              {templateName && <><span style={{ color: 'var(--border-color)' }}> · </span><span>{templateName}</span></>}
                            </span>
                          )}
                          {node.type === 'wait' && <span>Wait {node.data?.waitDays || 1} day{(node.data?.waitDays || 1) !== 1 ? 's' : ''}</span>}
                          {node.type === 'condition' && <span>{node.data?.label || 'Branch condition'}</span>}
                          {node.type === 'trigger'   && <span>{node.data?.label || 'Journey entry'}</span>}
                          {node.type === 'goal'      && <span>{node.data?.label || 'Conversion goal'}</span>}
                        </div>
                      </div>

                      {/* Status chip — every node type */}
                      {nodeStatus && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 9px',
                          borderRadius: 20, flexShrink: 0, letterSpacing: '0.3px',
                          color: nodeStatus.color, background: nodeStatus.bg,
                          border: `1px solid ${nodeStatus.color}44`,
                        }}>{nodeStatus.label}</span>
                      )}

                      {/* Collapsed chips */}
                      {isActionNode && !isExpanded && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <Chip label="sent"    value={sent}    color="var(--green)" />
                          <Chip label="opened"  value={opened}  color="#3b82f6" />
                          <Chip label="clicked" value={clicked} color="var(--purple)" />
                          {nodeGtmEvents.some(e => e.event_count > 0) && (
                            <Chip label="gtm events" value={nodeGtmEvents.reduce((s, e) => s + e.event_count, 0)} color="var(--orange)" />
                          )}
                        </div>
                      )}

                      {isActionNode && (
                        <div style={{ color: 'var(--text-muted)', marginLeft: 4, flexShrink: 0 }}>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </div>
                      )}

                      <div style={{
                        fontSize: 10, color: 'var(--text-muted)', flexShrink: 0,
                        background: 'var(--bg-tertiary)', borderRadius: 4, padding: '2px 6px',
                      }}>{node.id}</div>
                    </div>

                    {/* ── Expanded stats ── */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key="exp"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1, transition: { duration: 0.25 } }}
                          exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div style={{ padding: '0 14px 16px 14px', borderTop: '1px solid var(--border-color)' }}>

                            {/* Loading shimmer while node detail APIs are in-flight */}
                            {nodeDetailsLoading && (
                              <>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 14 }}>
                                  {[...Array(4)].map((_, i) => (
                                    <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                                      <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 4, margin: '0 auto 6px' }} />
                                      <div className="skeleton" style={{ width: 40, height: 8, borderRadius: 4, margin: '0 auto' }} />
                                    </div>
                                  ))}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                                  {[...Array(3)].map((_, i) => (
                                    <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                                      <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 4, margin: '0 auto 6px' }} />
                                      <div className="skeleton" style={{ width: 40, height: 8, borderRadius: 4, margin: '0 auto' }} />
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}

                            {/* Row 1 — primary */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 14 }}>
                              <StatTile label="TARGET"  value={target}  color="var(--green)" />
                              <StatTile label="SENT"    value={sent}    color="var(--green)" />
                              <StatTile label="OPENED"  value={opened}  color="#3b82f6"
                                sub={sent > 0 ? `${((opened / sent) * 100).toFixed(1)}%` : null} />
                              <StatTile label="CLICKED" value={clicked} color="var(--purple)"
                                sub={sent > 0 ? `${((clicked / sent) * 100).toFixed(1)}%` : null} />
                            </div>

                            {/* Row 2 — secondary */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                              <StatTile label="DELIVERED" value={delivered} color={delivered > 0 ? '#22c55e' : 'var(--text-muted)'}
                                sub={sent > 0 ? `${((delivered / sent) * 100).toFixed(1)}%` : null} />
                              <StatTile label="FAILED"    value={failed}    color={failed > 0 ? 'var(--red)' : 'var(--text-muted)'} />
                              <StatTile label="BOUNCED"   value={bounced}   color={bounced > 0 ? 'var(--orange)' : 'var(--text-muted)'} />
                            </div>

                            {/* Funnel bars */}
                            {sent > 0 && (
                              <div style={{ marginTop: 14 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                                  <span style={{ fontWeight: 600 }}>Engagement funnel</span>
                                  <span>{fmt(sent)} sent</span>
                                </div>
                                {[
                                  { label: 'Opened',  value: opened,  color: '#3b82f6' },
                                  { label: 'Clicked', value: clicked, color: 'var(--purple)' },
                                ].map(bar => (
                                  <div key={bar.label} style={{ marginBottom: 6 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>
                                      <span>{bar.label}</span>
                                      <span>{fmt(bar.value)} ({sent > 0 ? ((bar.value / sent) * 100).toFixed(1) : 0}%)</span>
                                    </div>
                                    <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-card)', overflow: 'hidden' }}>
                                      <div style={{
                                        height: '100%', borderRadius: 4,
                                        width: `${Math.min((bar.value / sent) * 100, 100)}%`,
                                        background: bar.color, transition: 'width 0.6s ease',
                                      }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* GTM event grid — always shown for action nodes */}
                            {nodeGtmEvents.length > 0 && (
                              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                  <MousePointerClick size={13} style={{ color: 'var(--orange)' }} />
                                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                                    GTM EVENTS
                                  </span>
                                  <span style={{
                                    marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)',
                                    background: 'var(--bg-tertiary)', borderRadius: 4, padding: '1px 6px',
                                  }}>
                                    {nodeGtmEvents.filter(e => e.event_count > 0).length} of {nodeGtmEvents.length} active
                                  </span>
                                </div>
                                <GtmEventGrid events={nodeGtmEvents} />
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
