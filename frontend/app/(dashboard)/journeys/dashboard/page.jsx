'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  GitBranch, Users, Send, Clock, Mail, Eye, TrendingUp, MousePointerClick,
  AlertTriangle, RefreshCw, Sparkles, XCircle, UserMinus, Activity, Calendar,
  ChevronRight, ChevronDown, Layers, Inbox, X, Loader2, GitFork, Flag, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts';
import { getJourneyOpsDashboard, getJourneyNodeBreakdown, getJourneysActiveOnDate, previewJourneyNodeEmail } from '@/lib/api';

const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);

const PALETTE = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444', '#6366f1', '#a855f7', '#0ea5e9'];

const fadeIn = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

function dayLabel(dateStr) {
  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 4 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}
function fmtHour(h) {
  if (h === null || h === undefined) return null;
  if (typeof h === 'number') return `${String(h).padStart(2, '0')}:00`;
  return String(h);
}
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export default function JourneyDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Journeys accordion. Date mode (default today): only journeys+nodes active on
  // that date, fetched filtered from the backend. All-time mode ('' date): the full
  // journey list with lazily-loaded per-node breakdowns.
  const [journeyDate, setJourneyDate] = useState(dubaiToday()); // default = today
  const [expanded, setExpanded] = useState(() => new Set());
  const [nodeDetails, setNodeDetails] = useState({}); // all-time: journeyId → { loading, nodes, error }
  const [byDate, setByDate] = useState({ loading: true, journeys: [], error: null, isToday: true });
  const [templateModal, setTemplateModal] = useState(null);

  // Date mode → fetch the filtered journeys (+ relevant nodes inline) for the date
  useEffect(() => {
    if (!journeyDate) return; // all-time mode uses the dashboard journey list
    let cancelled = false;
    setByDate(prev => ({ ...prev, loading: true }));
    getJourneysActiveOnDate(journeyDate)
      .then(res => { if (!cancelled) setByDate({ loading: false, journeys: res.data?.journeys || [], isToday: res.data?.isToday, error: null }); })
      .catch(e => { if (!cancelled) setByDate({ loading: false, journeys: [], error: e.message }); });
    return () => { cancelled = true; };
  }, [journeyDate]);

  const fetchBreakdown = async (journeyId) => {
    setNodeDetails(prev => ({ ...prev, [journeyId]: { ...(prev[journeyId] || {}), loading: true } }));
    try {
      const res = await getJourneyNodeBreakdown(journeyId);
      setNodeDetails(prev => ({ ...prev, [journeyId]: { loading: false, nodes: res.data?.nodes || [] } }));
    } catch (e) {
      setNodeDetails(prev => ({ ...prev, [journeyId]: { loading: false, error: e.message } }));
    }
  };

  const toggleJourney = (journeyId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(journeyId)) { next.delete(journeyId); return next; }
      next.add(journeyId);
      // All-time mode lazily loads the full node list; date mode has nodes inline
      if (!journeyDate && !nodeDetails[journeyId]) fetchBreakdown(journeyId);
      return next;
    });
  };

  const openTemplate = async (journeyId, node, journeyName) => {
    setTemplateModal({ journeyName, label: node.label, loading: true });
    try {
      const res = await previewJourneyNodeEmail(journeyId, node.nodeId);
      setTemplateModal({ journeyName, label: node.label, loading: false, html: res.data?.html, subject: res.data?.subject });
    } catch (e) {
      setTemplateModal({ journeyName, label: node.label, loading: false, error: e.message });
    }
  };

  const load = async (isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await getJourneyOpsDashboard();
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load dashboard');
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div style={{ padding: 28 }}>
        <div className="skeleton" style={{ width: 280, height: 30, borderRadius: 8, marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton" style={{ height: 86, borderRadius: 12 }} />)}
        </div>
        <div className="skeleton" style={{ width: '100%', height: 300, borderRadius: 12 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 28 }}>
        <div className="card" style={{ padding: 28, textAlign: 'center', color: '#ef4444' }}>
          <AlertTriangle size={28} style={{ marginBottom: 8 }} /><div>{error}</div>
          <button className="btn btn-sm" onClick={() => load()} style={{ marginTop: 14 }}><RefreshCw size={14} /> Retry</button>
        </div>
      </div>
    );
  }

  const { kpis, forecast, forecastChart, forecastJourneyNames, runningNow, engagement, journeys, health } = data;
  const colorFor = (name) => PALETTE[forecastJourneyNames.indexOf(name) % PALETTE.length] || '#8b5cf6';

  const KPIS = [
    { label: 'Active Journeys', value: kpis.activeJourneys, icon: GitBranch, color: '#8b5cf6' },
    { label: 'Active Enrollments', value: kpis.activeEntries?.toLocaleString(), icon: Users, color: '#3b82f6' },
    { label: 'Sends Today', value: kpis.sendsToday?.toLocaleString(), icon: Send, color: '#22c55e' },
    { label: 'Sends Tomorrow', value: kpis.sendsTomorrow?.toLocaleString(), icon: Calendar, color: '#14b8a6' },
    { label: 'Queued Now', value: kpis.queuedNow?.toLocaleString(), icon: Clock, color: '#f59e0b' },
    { label: 'Open Rate (7d)', value: `${kpis.openRate7d}%`, icon: Eye, color: '#ec4899' },
    { label: 'Conversions (7d)', value: kpis.conversions7d?.toLocaleString(), icon: TrendingUp, color: '#6366f1' },
  ];

  const hasFallback = health.aiFallback?.length > 0;
  const hasStuck = health.stuckEntries?.length > 0;

  return (
    <motion.div initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.05 } } }} style={{ padding: 28, maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <motion.div variants={fadeIn} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={24} color="#8b5cf6" /> Journey Operations
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
            What's running, what's sending today &amp; tomorrow, and journey health · updated {fmtDateTime(data.generatedAt)}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={refreshing}
          style={{ marginLeft: 'auto', gap: 6 }}>
          <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
        </button>
      </motion.div>

      {/* Health alerts (top, only if present) */}
      {(hasFallback || hasStuck) && (
        <motion.div variants={fadeIn} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {hasStuck && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13 }}>
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>{health.stuckEntries.reduce((s, x) => s + x.count, 0)} entries are overdue</strong> (next_fire_at &gt; 1h in the past) across {health.stuckEntries.length} journey(s) — the worker may not be processing. {health.stuckEntries.slice(0, 3).map(s => `${s.name} (${s.count})`).join(', ')}
              </div>
            </div>
          )}
          {hasFallback && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: 13 }}>
              <Sparkles size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>{health.aiFallback.length} of today's daily templates used fallback (non-AI) content</strong> — Claude rendering failed for Day {health.aiFallback.map(f => f.dayNumber || f.templateId).join(', ')}. Recipients today get degraded content.
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* KPI strip */}
      <motion.div variants={fadeIn} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 12, marginBottom: 24 }}>
        {KPIS.map(k => (
          <div key={k.label} className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <k.icon size={14} color={k.color} /> {k.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', marginTop: 8 }}>{k.value ?? 0}</div>
          </div>
        ))}
      </motion.div>

      {/* ── Send Forecast ── */}
      <motion.div variants={fadeIn} className="card" style={{ padding: 22, marginBottom: 20 }}>
        <SectionTitle icon={Calendar} color="#22c55e" title="Send Forecast — next 7 days"
          subtitle="Scheduled emails per day, resolved to the exact journey · node · template that will fire" />
        {forecastChart.length === 0 ? (
          <Empty text="No journey sends scheduled in the next 7 days" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={forecastChart} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelFormatter={dayLabel} />
                {forecastJourneyNames.map(name => (
                  <Bar key={name} dataKey={name} stackId="a" fill={colorFor(name)} radius={[3, 3, 0, 0]} maxBarSize={48} />
                ))}
              </BarChart>
            </ResponsiveContainer>

            {/* Day-by-day breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
              {forecast.map(day => (
                <div key={day.date}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{dayLabel(day.date)}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{day.date} · {day.total.toLocaleString()} sends</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {day.items.map(it => (
                      <div key={`${it.journeyId}-${it.nodeId}`}
                        onClick={() => router.push(`/journeys?id=${it.journeyId}`)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorFor(it.journeyName), flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {it.journeyName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {it.dayNumber && <span style={{ fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>DAY {it.dayNumber}</span>}
                            <span>{it.label}</span>
                            <span>· {it.nodeId}</span>
                            {fmtHour(it.sendHour) && <span>· {fmtHour(it.sendHour)} GST</span>}
                            {it.approximate && <span style={{ color: '#f59e0b' }} title="Path passes a condition node — exact email depends on the branch">· branch est.</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', flexShrink: 0 }}>{it.count.toLocaleString()}</span>
                        <ChevronRight size={15} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </motion.div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20, marginBottom: 20 }}>
        {/* ── Running now ── */}
        <motion.div variants={fadeIn} className="card" style={{ padding: 22 }}>
          <SectionTitle icon={Layers} color="#3b82f6" title="Running now" subtitle="Where every active enrollment currently sits" />
          {runningNow.length === 0 ? <Empty text="No active enrollments" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {runningNow.map(j => {
                const total = j.nodes.reduce((s, n) => s + n.count, 0);
                return (
                  <div key={j.journeyId}>
                    <div onClick={() => router.push(`/journeys?id=${j.journeyId}`)} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.journeyName}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{total.toLocaleString()} active</span>
                    </div>
                    {/* proportion bar */}
                    <div style={{ display: 'flex', height: 8, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                      {j.nodes.map((n, i) => (
                        <div key={n.nodeId} title={`${n.label}: ${n.count}`} style={{ width: `${(n.count / total) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {j.nodes.map((n, i) => (
                        <span key={n.nodeId} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text-secondary)' }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} />
                          {n.label} <strong style={{ color: 'var(--text-primary)' }}>{n.count}</strong>
                          {n.type === 'wait' && <Clock size={9} />}
                          {n.type === 'action' && <Mail size={9} />}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* ── Engagement timeseries ── */}
        <motion.div variants={fadeIn} className="card" style={{ padding: 22 }}>
          <SectionTitle icon={TrendingUp} color="#ec4899" title="Engagement (30 days)" subtitle="Delivered · Opened · Clicked across all journey sends" />
          {engagement.length === 0 ? <Empty text="No journey sends in the last 30 days" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={engagement} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="delivered" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="opened" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="clicked" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </motion.div>
      </div>

      {/* ── Per-journey accordion ── */}
      <motion.div variants={fadeIn} className="card" style={{ padding: 22, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SectionTitle icon={GitBranch} color="#8b5cf6" title="Journeys"
              subtitle={journeyDate
                ? `Only journeys with a node fired, running or scheduled on ${dayLabel(journeyDate)}`
                : 'Expand a journey to see per-node delivery, opens, clicks & templates'} />
          </div>
          {/* Date filter — defaults to today; scopes the whole list to that day */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={15} color="var(--text-tertiary)" />
            <input type="date" value={journeyDate} onChange={e => setJourneyDate(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 12.5 }} />
            <button className="btn btn-sm btn-secondary" onClick={() => setJourneyDate(dubaiToday())} style={{ gap: 5 }} title="Jump to today">Today</button>
            {journeyDate && (
              <button className="btn btn-sm btn-secondary" onClick={() => setJourneyDate('')} style={{ gap: 5 }}>
                <X size={13} /> All time
              </button>
            )}
          </div>
        </div>

        {journeyDate ? (
          // ── Date mode: filtered journeys with relevant nodes inline ──
          byDate.loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 12, padding: '16px 0' }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading journeys for {dayLabel(journeyDate)}…
            </div>
          ) : byDate.error ? (
            <div style={{ color: '#ef4444', fontSize: 12, padding: '8px 0' }}>{byDate.error}</div>
          ) : byDate.journeys.length === 0 ? (
            <Empty text={`No journey has a node fired, running or scheduled on ${dayLabel(journeyDate)}`} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {byDate.journeys.map(j => {
                const isOpen = expanded.has(j.journeyId);
                return (
                  <div key={j.journeyId} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                    <div onClick={() => toggleJourney(j.journeyId)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
                      <ChevronDown size={16} color="var(--text-tertiary)" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .18s', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                          {j.nodes.length} node{j.nodes.length > 1 ? 's' : ''} on {dayLabel(journeyDate)} · {j.sentOnDate.toLocaleString()} sent · {j.scheduledOnDate.toLocaleString()} scheduled
                        </div>
                      </div>
                      <StatusPill status={j.status} />
                      <button onClick={(e) => { e.stopPropagation(); router.push(`/journeys?id=${j.journeyId}`); }}
                        title="Open journey" className="btn btn-sm btn-secondary" style={{ padding: '5px 8px', flexShrink: 0 }}>
                        <ChevronRight size={13} />
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', background: 'var(--card)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {j.nodes.map(n => (
                          <NodeRow key={n.nodeId} node={n} dateActive
                            onViewTemplate={() => openTemplate(j.journeyId, n, j.name)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          // ── All-time mode: full journey list with lazy node breakdowns ──
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {journeys.map(j => {
              const isOpen = expanded.has(j.journeyId);
              const det = nodeDetails[j.journeyId];
              return (
                <div key={j.journeyId} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                  <div onClick={() => toggleJourney(j.journeyId)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
                    <ChevronDown size={16} color="var(--text-tertiary)" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .18s', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {j.activeEntries.toLocaleString()} active · next fire {j.nextFire ? fmtDateTime(j.nextFire) : '—'}
                      </div>
                    </div>
                    <StatusPill status={j.status} />
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                      <span title="Sends today">📨 {j.sendsToday.toLocaleString()}</span>
                      <span title="Open rate (7d)">👁 {j.openRate}%</span>
                      <span title="Conversions">🎯 {j.conversions.toLocaleString()}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); router.push(`/journeys?id=${j.journeyId}`); }}
                      title="Open journey" className="btn btn-sm btn-secondary" style={{ padding: '5px 8px', flexShrink: 0 }}>
                      <ChevronRight size={13} />
                    </button>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', background: 'var(--card)' }}>
                      {!det || det.loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 12, padding: '12px 0' }}>
                          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading nodes…
                        </div>
                      ) : det.error ? (
                        <div style={{ color: '#ef4444', fontSize: 12, padding: '8px 0' }}>{det.error}</div>
                      ) : det.nodes.length === 0 ? (
                        <Empty text="This journey has no nodes" />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {det.nodes.map(n => (
                            <NodeRow key={n.nodeId} node={n} dateActive={false}
                              onViewTemplate={() => openTemplate(j.journeyId, n, j.name)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* ── Health add-ons grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 20 }}>
        {/* Queue health */}
        <motion.div variants={fadeIn} className="card" style={{ padding: 22 }}>
          <SectionTitle icon={Inbox} color="#f59e0b" title="Queue health" subtitle="BullMQ depth per channel" />
          {!health.queue ? <Empty text="Queue stats unavailable" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {['email', 'whatsapp', 'sms'].map(ch => {
                const q = health.queue[ch];
                return (
                  <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', width: 80, textTransform: 'capitalize' }}>{ch}</span>
                    {q ? (
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-secondary)' }}>
                        <span>waiting <strong style={{ color: 'var(--text-primary)' }}>{q.waiting ?? 0}</strong></span>
                        <span>active <strong style={{ color: 'var(--text-primary)' }}>{q.active ?? 0}</strong></span>
                        <span>delayed <strong style={{ color: 'var(--text-primary)' }}>{q.delayed ?? 0}</strong></span>
                        <span style={{ color: (q.failed ?? 0) > 0 ? '#ef4444' : undefined }}>failed <strong style={{ color: (q.failed ?? 0) > 0 ? '#ef4444' : 'var(--text-primary)' }}>{q.failed ?? 0}</strong></span>
                      </div>
                    ) : <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>unavailable</span>}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Recent failures */}
        <motion.div variants={fadeIn} className="card" style={{ padding: 22 }}>
          <SectionTitle icon={XCircle} color="#ef4444" title="Recent send failures (24h)" subtitle="Failed journey emails" />
          {(!health.failures || health.failures.length === 0) ? <Empty text="No failures in the last 24h 🎉" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
              {health.failures.map((f, i) => (
                <div key={i} style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{f.email}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{f.journeyName} · {f.nodeId} · {fmtDateTime(f.at)}</div>
                  {f.error && <div style={{ fontSize: 10.5, color: '#ef4444', marginTop: 2 }}>{f.error}</div>}
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Unsubscribes by node */}
        <motion.div variants={fadeIn} className="card" style={{ padding: 22 }}>
          <SectionTitle icon={UserMinus} color="#a855f7" title="Unsubscribes by node" subtitle="Which emails drive opt-outs" />
          {(!health.unsubscribesByNode || health.unsubscribesByNode.length === 0) ? <Empty text="No journey unsubscribes recorded" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {health.unsubscribesByNode.map((u, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-secondary)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.journeyName}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{u.nodeId || '—'}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#a855f7' }}>{u.count}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Template preview modal (action nodes) ── */}
      {templateModal && (
        <div onClick={() => setTemplateModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--card)', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <Mail size={17} color="#8b5cf6" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{templateModal.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {templateModal.journeyName}{templateModal.subject ? ` · ${templateModal.subject}` : ''}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setTemplateModal(null)}><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
              {templateModal.loading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#888', fontSize: 13 }}>
                  <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /><div style={{ marginTop: 8 }}>Rendering the exact email that gets sent… (may take ~15-25s on a cache miss)</div>
                </div>
              ) : templateModal.error ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>{templateModal.error}</div>
              ) : (
                <iframe srcDoc={templateModal.html || ''} title={templateModal.label}
                  style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }} />
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

const NODE_ICON = { action: Mail, wait: Clock, condition: GitFork, goal: Flag, trigger: Zap };

function NodeRow({ node, dateActive, onViewTemplate }) {
  const Icon = NODE_ICON[node.type] || Layers;
  const color = { action: '#3b82f6', wait: '#f59e0b', condition: '#a855f7', goal: '#22c55e', trigger: '#8b5cf6' }[node.type] || '#9ca3af';
  const isAction = node.type === 'action';
  // Normalize across the two payload shapes (date mode vs all-time breakdown)
  const running = node.running ?? node.active ?? 0;
  const scheduled = node.scheduled ?? node.scheduledOnDate ?? 0;
  const fired = node.fired ?? (node.total || 0) > 0;
  const badges = dateActive ? [
    fired && { label: 'Fired', color: '#3b82f6' },
    running > 0 && { label: `Running ${running.toLocaleString()}`, color: '#22c55e' },
    scheduled > 0 && { label: `Scheduled ${scheduled.toLocaleString()}`, color: '#f59e0b' },
  ].filter(Boolean) : [];
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 7, background: `${color}1f`, color, flexShrink: 0 }}>
          <Icon size={14} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {node.dayNumber && <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5, background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>DAY {node.dayNumber}</span>}
            {node.label}
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 400 }}>· {node.nodeId} · {node.type}</span>
            {badges.map(b => (
              <span key={b.label} style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: `${b.color}1f`, color: b.color, letterSpacing: 0.3 }}>{b.label}</span>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>
            {!dateActive && running > 0 && <span style={{ color: '#22c55e' }}>● {running.toLocaleString()} here now</span>}
            {node.type === 'wait' && <span>{!dateActive && running > 0 ? ' · ' : ''}waits {node.waitDays}d</span>}
          </div>
        </div>
        {isAction && node.hasTemplate && (
          <button onClick={onViewTemplate} className="btn btn-sm" style={{ gap: 5, flexShrink: 0, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.25)' }}>
            <Eye size={13} /> View template
          </button>
        )}
      </div>
      {/* Engagement metrics — only meaningful for action (email) nodes */}
      {isAction && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <Metric icon={Send} label="Delivered" value={node.delivered} color="#3b82f6" />
          <Metric icon={Eye} label="Opened" value={node.opened} sub={node.openRate != null ? `${node.openRate}%` : null} color="#8b5cf6" />
          <Metric icon={MousePointerClick} label="Clicked" value={node.clicked} sub={node.clickRate != null ? `${node.clickRate}%` : null} color="#22c55e" />
          {node.failed > 0 && <Metric icon={XCircle} label="Failed" value={node.failed} color="#ef4444" />}
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, color }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}>
      <Icon size={12} color={color} />
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <strong style={{ color: 'var(--text-primary)' }}>{(value || 0).toLocaleString()}</strong>
      {sub && <span style={{ color, fontWeight: 700 }}>{sub}</span>}
    </span>
  );
}

function SectionTitle({ icon: Icon, color, title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={17} color={color} /> {title}
      </div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>{text}</div>;
}

function StatusPill({ status }) {
  const map = {
    active: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
    paused: { bg: 'rgba(251,146,60,0.15)', color: '#fb923c' },
    completed: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
    draft: { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
  }[status] || { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' };
  return <span style={{ fontSize: 9.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: map.bg, color: map.color, letterSpacing: 0.5, textTransform: 'uppercase' }}>{status}</span>;
}
