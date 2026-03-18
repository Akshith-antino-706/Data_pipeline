import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getJourneys, getJourney, generateJourneyFromStrategy, enrollJourney,
  processJourney, getStrategies, aiFlowSuggest, getJourneyAnalytics,
  createJourney, updateJourney, deleteJourney
} from '../api';
import {
  GitBranch, Play, ArrowLeft, Users, Zap, Clock, Target, MessageSquare,
  ChevronRight, RefreshCw, AlertCircle, Plus, Search, Filter, BarChart3,
  Activity, Settings, Eye, Trash2, Edit3, Copy, CheckCircle2, XCircle,
  ArrowDown, Send, Mail, Smartphone, Bell, Globe, MessageCircle,
  TrendingUp, Pause, MoreVertical, Calendar, Hash, Layers, ArrowRight,
  ChevronDown, Info, Sparkles, LayoutGrid, List
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';

// ── Constants ──────────────────────────────────────────────────
const NODE_COLORS = {
  trigger: '#dc2626', action: '#00b894', condition: '#fbbf24',
  wait: '#eab308', goal: '#8b5cf6'
};
const NODE_ICONS = {
  trigger: Zap, action: Send, condition: GitBranch, wait: Clock, goal: Target
};
const NODE_LABELS = {
  trigger: 'Entry Trigger', action: 'Send Message', condition: 'Branch',
  wait: 'Wait / Delay', goal: 'Conversion Goal'
};
const CHANNEL_CONFIG = {
  whatsapp: { color: '#25d366', icon: MessageCircle, label: 'WhatsApp' },
  email: { color: '#dc2626', icon: Mail, label: 'Email' },
  sms: { color: '#f59e0b', icon: Smartphone, label: 'SMS' },
  push: { color: '#8b5cf6', icon: Bell, label: 'Push' },
  rcs: { color: '#eab308', icon: MessageSquare, label: 'RCS' },
  web: { color: '#06b6d4', icon: Globe, label: 'Web' }
};
const STATUS_CONFIG = {
  active: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', label: 'Active' },
  draft: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Draft' },
  paused: { color: '#78716c', bg: 'rgba(120,113,108,0.1)', label: 'Paused' },
  completed: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', label: 'Completed' }
};
const PIE_COLORS = ['#22c55e', '#dc2626', '#f59e0b', '#8b5cf6', '#06b6d4', '#eab308'];

// ── Utility ────────────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString();
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const timeAgo = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
};

// ── Extract unique channels from journey nodes ─────────────────
const getJourneyChannels = (nodes) => {
  if (!nodes || !Array.isArray(nodes)) return [];
  const channels = new Set();
  nodes.forEach(n => {
    if (n.data?.channel) channels.add(n.data.channel.toLowerCase());
  });
  return [...channels];
};

// ══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════
export default function Journeys() {
  // ── State ─────────────────────────────────────────────────────
  const [journeys, setJourneys] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('flow');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards');
  const [expandedNode, setExpandedNode] = useState(null);
  const [showActions, setShowActions] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});

  // ── Create journey form state ─────────────────────────────────
  const [createForm, setCreateForm] = useState({
    name: '', description: '', goalType: 'booking'
  });

  // ── Toast helper ──────────────────────────────────────────────
  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Data Loading ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [j, s] = await Promise.all([
        getJourneys().catch(() => ({ data: [] })),
        getStrategies().catch(() => ({ data: [] }))
      ]);
      setJourneys(j.data || []);
      setStrategies(s.data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Journey Actions ───────────────────────────────────────────
  const openJourney = async (id) => {
    setSelected(id);
    setDetail(null);
    setAnalytics(null);
    setSuggestions(null);
    setActiveTab('flow');
    setDetailLoading(true);
    setExpandedNode(null);
    try {
      const [d, a] = await Promise.all([
        getJourney(id),
        getJourneyAnalytics(id).catch(() => ({ data: null }))
      ]);
      setDetail(d.data);
      setAnalytics(a.data);
    } catch (err) { showToast('Failed to load journey', 'error'); }
    setDetailLoading(false);
  };

  const handleGenerate = async (strategyId) => {
    setShowGenerate(false);
    setGenerating(true);
    try {
      const res = await generateJourneyFromStrategy(strategyId);
      showToast(`Journey generated: ${res.data?.name}`, 'success');
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
    setGenerating(false);
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return showToast('Journey name is required', 'error');
    setShowCreate(false);
    try {
      const res = await createJourney({
        name: createForm.name,
        description: createForm.description,
        goalType: createForm.goalType,
        nodes: [{
          id: 'node_0', type: 'trigger',
          data: { triggerType: 'segment_entry', label: 'Entry Point' },
          position: { x: 300, y: 50 }
        }],
        edges: []
      });
      showToast(`Journey "${res.data?.name}" created`, 'success');
      setCreateForm({ name: '', description: '', goalType: 'booking' });
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleEnroll = async () => {
    setConfirmAction(null);
    setEnrolling(true);
    try {
      const res = await enrollJourney(selected);
      showToast(`Enrolled ${res.data?.enrolled || 0} customers`, 'success');
      const d = await getJourney(selected);
      setDetail(d.data);
    } catch (err) { showToast(err.message, 'error'); }
    setEnrolling(false);
  };

  const handleProcess = async () => {
    setConfirmAction(null);
    setProcessing(true);
    try {
      const res = await processJourney(selected);
      showToast(`Processed: ${res.data?.processed || 0} entries advanced`, 'success');
      const d = await getJourney(selected);
      setDetail(d.data);
    } catch (err) { showToast(err.message, 'error'); }
    setProcessing(false);
  };

  const handleDelete = async (id) => {
    setConfirmAction(null);
    try {
      await deleteJourney(id);
      showToast('Journey deleted', 'success');
      setSelected(null);
      setDetail(null);
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleUpdateJourney = async () => {
    try {
      await updateJourney(selected, editForm);
      showToast('Journey updated', 'success');
      setEditMode(false);
      const d = await getJourney(selected);
      setDetail(d.data);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleAISuggest = async () => {
    setSuggestLoading(true);
    try {
      const res = await aiFlowSuggest(selected);
      setSuggestions(res.data);
    } catch (err) { showToast('AI analysis failed', 'error'); }
    setSuggestLoading(false);
  };

  // ── Filtered Journeys ─────────────────────────────────────────
  const filteredJourneys = useMemo(() => {
    let filtered = journeys;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(j => j.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(j =>
        j.name?.toLowerCase().includes(q) ||
        j.segment_name?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [journeys, statusFilter, searchQuery]);

  // ── Summary Stats ─────────────────────────────────────────────
  const summaryStats = useMemo(() => {
    const total = journeys.length;
    const active = journeys.filter(j => j.status === 'active').length;
    const totalEntries = journeys.reduce((sum, j) => sum + (j.total_entries || 0), 0);
    const avgConversion = journeys.length > 0
      ? (journeys.reduce((sum, j) => sum + (parseFloat(j.conversion_rate) || 0), 0) / journeys.length)
      : 0;
    return { total, active, totalEntries, avgConversion };
  }, [journeys]);

  // ══════════════════════════════════════════════════════════════
  // LOADING STATE
  // ══════════════════════════════════════════════════════════════
  if (loading) return (
    <div style={{ padding: '40px 0' }}>
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 300, height: 16 }} />
        </div>
      </div>
      <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
        {[1,2,3,4].map(i => <div key={i} className="card skeleton" style={{ height: 90 }} />)}
      </div>
      {[1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 80, marginBottom: 8 }} />)}
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  // JOURNEY DETAIL VIEW
  // ══════════════════════════════════════════════════════════════
  if (selected) {
    if (detailLoading || !detail) return <div className="spinner">Loading journey details...</div>;

    const nodes = detail.nodes || [];
    const edges = detail.edges || [];
    const stats = detail.entryStats || {};
    const nodeAnalyticsMap = {};
    (detail.nodeAnalytics || []).forEach(na => {
      if (!nodeAnalyticsMap[na.node_id]) nodeAnalyticsMap[na.node_id] = {};
      nodeAnalyticsMap[na.node_id][na.event_type] = parseInt(na.event_count);
    });

    const channels = getJourneyChannels(nodes);
    const statusConf = STATUS_CONFIG[detail.status] || STATUS_CONFIG.draft;

    // Build node analytics for charts
    const nodeChartData = nodes
      .filter(n => n.type === 'action')
      .map(n => ({
        name: n.data?.channel || n.data?.label || n.id,
        sent: nodeAnalyticsMap[n.id]?.action_sent || 0,
        delivered: nodeAnalyticsMap[n.id]?.delivered || 0,
        opened: nodeAnalyticsMap[n.id]?.opened || 0,
        clicked: nodeAnalyticsMap[n.id]?.clicked || 0,
      }));

    const channelDistribution = channels.map(ch => ({
      name: CHANNEL_CONFIG[ch]?.label || ch,
      value: nodes.filter(n => n.data?.channel?.toLowerCase() === ch).length,
      color: CHANNEL_CONFIG[ch]?.color || '#78716c'
    }));

    const funnelData = analytics?.funnelData || [];
    const entryFunnelData = [
      { name: 'Entered', value: parseInt(stats.total_entries) || 0, color: '#eab308' },
      { name: 'Active', value: parseInt(stats.active) || 0, color: '#22c55e' },
      { name: 'Completed', value: parseInt(stats.completed) || 0, color: '#06b6d4' },
      { name: 'Converted', value: parseInt(stats.converted) || 0, color: '#8b5cf6' },
      { name: 'Exited', value: parseInt(stats.exited) || 0, color: '#dc2626' },
    ].filter(d => d.value > 0);

    return (
      <div>
        {/* ── Back + Header ─────────────────────────────────────── */}
        <button className="btn btn-ghost" onClick={() => { setSelected(null); setDetail(null); setEditMode(false); }} style={{ marginBottom: 16 }}>
          <ArrowLeft size={14} /> All Journeys
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editMode ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  value={editForm.name || ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  style={{ fontSize: 22, fontWeight: 700, padding: '4px 12px', maxWidth: 400 }}
                />
                <button className="btn btn-sm btn-primary" onClick={handleUpdateJourney}>Save</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
              </div>
            ) : (
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                {detail.name}
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditMode(true); setEditForm({ name: detail.name, description: detail.description, status: detail.status }); }}>
                  <Edit3 size={14} />
                </button>
              </h2>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: statusConf.bg, color: statusConf.color
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusConf.color }} />
                {statusConf.label}
              </span>
              {detail.segment_name && <span className="badge badge-purple">{detail.segment_name}</span>}
              {detail.stage_name && (
                <span className="badge" style={{ background: (detail.stage_color || '#dc2626') + '20', color: detail.stage_color || '#dc2626' }}>
                  {detail.stage_name}
                </span>
              )}
              {channels.map(ch => {
                const conf = CHANNEL_CONFIG[ch] || {};
                const Icon = conf.icon || MessageSquare;
                return (
                  <span key={ch} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: (conf.color || '#78716c') + '15', color: conf.color || '#78716c'
                  }}>
                    <Icon size={12} /> {conf.label || ch}
                  </span>
                );
              })}
            </div>
            {detail.description && !editMode && (
              <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 10, lineHeight: 1.7, maxWidth: 600 }}>{detail.description}</p>
            )}
            {editMode && (
              <textarea
                value={editForm.description || ''}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Journey description..."
                style={{ marginTop: 8, maxWidth: 500, minHeight: 60 }}
              />
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleAISuggest} disabled={suggestLoading}>
              <Sparkles size={14} /> {suggestLoading ? 'Analyzing...' : 'AI Optimize'}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirmAction('enroll')} disabled={enrolling}>
              <Users size={14} /> {enrolling ? 'Enrolling...' : 'Enroll'}
            </button>
            <button className="btn btn-primary" onClick={() => setConfirmAction('process')} disabled={processing}>
              <Play size={14} /> {processing ? 'Processing...' : 'Process'}
            </button>
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowActions(a => !a)}>
                <MoreVertical size={16} />
              </button>
              {showActions && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setShowActions(false)} />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)',
                    minWidth: 180, zIndex: 51, overflow: 'hidden'
                  }}>
                    <button onClick={() => { setShowActions(false); navigator.clipboard?.writeText(String(selected)); showToast('Journey ID copied', 'info'); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                      <Copy size={14} /> Copy ID
                    </button>
                    <button onClick={() => { setShowActions(false); setConfirmAction('delete'); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#dc2626' }}>
                      <Trash2 size={14} /> Delete Journey
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── KPIs ──────────────────────────────────────────────── */}
        <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
          {[
            { label: 'Total Entries', value: fmt(stats.total_entries), color: 'kpi-blue', icon: Users },
            { label: 'Active Now', value: fmt(stats.active), color: 'kpi-green', icon: Activity },
            { label: 'Converted', value: fmt(stats.converted), color: 'kpi-purple', icon: CheckCircle2 },
            { label: 'Conversion Rate', value: pct(detail.conversion_rate), color: 'kpi-orange', icon: TrendingUp },
          ].map((kpi, i) => (
            <div key={i} className="card" style={{ padding: '20px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 500, marginBottom: 4 }}>{kpi.label}</div>
                  <div className={`kpi-value ${kpi.color}`} style={{ fontSize: 26 }}>{kpi.value}</div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
                  <kpi.icon size={20} color="var(--text-dim)" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────── */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          {[
            { id: 'flow', label: 'Journey Flow', icon: GitBranch },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map(tab => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB: Flow ─────────────────────────────────────────── */}
        {activeTab === 'flow' && (
          <>
            {/* AI Suggestions Banner */}
            {suggestions && (
              <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #8b5cf6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={16} color="#8b5cf6" />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>AI Flow Analysis</span>
                  </div>
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700,
                    background: suggestions.overall_score >= 80 ? 'rgba(34,197,94,0.1)' : suggestions.overall_score >= 60 ? 'rgba(245,158,11,0.1)' : 'rgba(220,38,38,0.1)',
                    color: suggestions.overall_score >= 80 ? '#22c55e' : suggestions.overall_score >= 60 ? '#f59e0b' : '#dc2626'
                  }}>
                    Score: {suggestions.overall_score}/100
                  </span>
                </div>
                {(suggestions.suggestions || []).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {suggestions.suggestions.map((s, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 12, padding: '10px 14px',
                        background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)'
                      }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
                          borderRadius: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          alignSelf: 'flex-start', marginTop: 2,
                          background: s.impact === 'high' ? 'rgba(220,38,38,0.1)' : s.impact === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                          color: s.impact === 'high' ? '#dc2626' : s.impact === 'medium' ? '#f59e0b' : '#22c55e'
                        }}>
                          {s.impact}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.5 }}>{s.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                    <CheckCircle2 size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                    Flow looks optimized — no suggestions at this time.
                  </div>
                )}
              </div>
            )}

            {/* Visual Flow Canvas */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Layers size={16} color="var(--text-dim)" />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Journey Flow
                  </span>
                  <span className="badge badge-gray">{nodes.length} nodes</span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                  {Object.entries(NODE_COLORS).map(([type, color]) => (
                    <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                      {type}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ padding: '24px 32px', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-card) 100%)', minHeight: 200 }}>
                {nodes.length === 0 ? (
                  <div className="empty" style={{ padding: '40px 20px' }}>
                    <GitBranch size={40} color="var(--text-muted)" style={{ opacity: 0.3 }} />
                    <h4 style={{ marginTop: 12 }}>No nodes in this journey</h4>
                    <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Generate from a strategy to populate the flow.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                    {nodes.map((node, i) => {
                      const Icon = NODE_ICONS[node.type] || Target;
                      const color = NODE_COLORS[node.type] || '#a8a29e';
                      const channelConf = node.data?.channel ? CHANNEL_CONFIG[node.data.channel.toLowerCase()] : null;
                      const ChannelIcon = channelConf?.icon || null;
                      const nodeStats = nodeAnalyticsMap[node.id] || {};
                      const isExpanded = expandedNode === node.id;
                      const hasSent = nodeStats.action_sent > 0;

                      return (
                        <div key={node.id} style={{ width: '100%', maxWidth: 520 }}>
                          {/* Connector Arrow */}
                          {i > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0' }}>
                              <div style={{ width: 2, height: 16, background: `linear-gradient(to bottom, ${NODE_COLORS[nodes[i-1]?.type] || '#e7e5e4'}40, ${color}40)` }} />
                              <ArrowDown size={14} color={color + '80'} />
                              <div style={{ width: 2, height: 4, background: color + '40' }} />
                            </div>
                          )}

                          {/* Node Card */}
                          <div
                            onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                            style={{
                              background: 'var(--bg-card)',
                              border: `1px solid ${isExpanded ? color + '50' : 'var(--border)'}`,
                              borderLeft: `4px solid ${color}`,
                              borderRadius: 12,
                              padding: '14px 16px',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              boxShadow: isExpanded ? `0 4px 16px ${color}15` : 'var(--shadow)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              {/* Node icon */}
                              <div style={{
                                width: 40, height: 40, borderRadius: 10,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: color + '12', color, flexShrink: 0
                              }}>
                                <Icon size={20} />
                              </div>

                              {/* Node content */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color, lineHeight: 1 }}>
                                    {NODE_LABELS[node.type] || node.type}
                                  </span>
                                  {channelConf && (
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 3,
                                      padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                                      background: channelConf.color + '12', color: channelConf.color
                                    }}>
                                      <ChannelIcon size={10} /> {channelConf.label}
                                    </span>
                                  )}
                                  {node.data?.timing && (
                                    <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                      <Clock size={10} /> {node.data.timing}
                                    </span>
                                  )}
                                </div>
                                {node.data?.label && (
                                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginTop: 4 }}>{node.data.label}</div>
                                )}
                              </div>

                              {/* Node stats preview */}
                              {hasSent && (
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmt(nodeStats.action_sent)}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>sent</div>
                                </div>
                              )}

                              <ChevronDown size={14} color="var(--text-muted)" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                                {node.data?.message && (
                                  <div style={{
                                    background: 'var(--bg)', borderRadius: 8, padding: '12px 14px',
                                    fontSize: 13, color: 'var(--text)', lineHeight: 1.7, marginBottom: 12,
                                    borderLeft: `3px solid ${channelConf?.color || color}20`
                                  }}>
                                    {node.data.message}
                                  </div>
                                )}
                                {node.data?.waitDays && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                                    <Clock size={14} color={color} />
                                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                                      Wait <strong>{node.data.waitDays} day{node.data.waitDays !== 1 ? 's' : ''}</strong> before proceeding
                                    </span>
                                  </div>
                                )}
                                {node.data?.triggerType && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                                    <Zap size={14} color={color} />
                                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                                      Trigger: <strong>{node.data.triggerType}</strong>
                                      {node.data?.segmentLabel && <span> — {node.data.segmentLabel}</span>}
                                    </span>
                                  </div>
                                )}
                                {node.data?.goalType && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                                    <Target size={14} color={color} />
                                    <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                                      Conversion goal: <strong>{node.data.goalType}</strong>
                                    </span>
                                  </div>
                                )}

                                {/* Per-node analytics */}
                                {Object.keys(nodeStats).length > 0 && (
                                  <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                                    {Object.entries(nodeStats).map(([event, count]) => (
                                      <div key={event} style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmt(count)}</div>
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{event.replace(/_/g, ' ')}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Connected edges */}
                                {edges.filter(e => e.source === node.id).length > 0 && (
                                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                                    <ArrowRight size={10} style={{ verticalAlign: -1, marginRight: 4 }} />
                                    Connects to: {edges.filter(e => e.source === node.id).map(e => {
                                      const target = nodes.find(n => n.id === e.target);
                                      return target?.data?.label || target?.type || e.target;
                                    }).join(', ')}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── TAB: Analytics ────────────────────────────────────── */}
        {activeTab === 'analytics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Entry Funnel */}
            <div className="card-grid card-grid-2">
              <div className="card">
                <div className="card-header"><h3>Entry Funnel</h3></div>
                {entryFunnelData.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {entryFunnelData.map((d, i) => {
                      const maxVal = Math.max(...entryFunnelData.map(x => x.value), 1);
                      return (
                        <div key={i}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                            <span style={{ color: d.color, fontWeight: 600 }}>{d.name}</span>
                            <span style={{ fontWeight: 600 }}>{fmt(d.value)}</span>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${(d.value / maxVal) * 100}%`, background: d.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 13 }}>No entry data yet. Enroll customers to see funnel data.</div>
                )}
              </div>

              <div className="card">
                <div className="card-header"><h3>Channel Distribution</h3></div>
                {channelDistribution.length > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <ResponsiveContainer width="50%" height={160}>
                      <PieChart>
                        <Pie data={channelDistribution} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" paddingAngle={3}>
                          {channelDistribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(val) => [`${val} nodes`, '']} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                      {channelDistribution.map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, flex: 1 }}>{d.name}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 13 }}>No channels configured yet.</div>
                )}
              </div>
            </div>

            {/* Node Performance */}
            {nodeChartData.length > 0 && (
              <div className="card">
                <div className="card-header"><h3>Node Performance</h3></div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={nodeChartData} barCategoryGap="20%">
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#78716c' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#78716c' }} />
                    <Tooltip />
                    <Bar dataKey="sent" fill="#eab308" radius={[4,4,0,0]} name="Sent" />
                    <Bar dataKey="delivered" fill="#22c55e" radius={[4,4,0,0]} name="Delivered" />
                    <Bar dataKey="opened" fill="#06b6d4" radius={[4,4,0,0]} name="Opened" />
                    <Bar dataKey="clicked" fill="#8b5cf6" radius={[4,4,0,0]} name="Clicked" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Node Distribution Table */}
            {funnelData.length > 0 && (
              <div className="card">
                <div className="card-header"><h3>Customer Distribution by Node</h3></div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>Status</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelData.map((row, i) => {
                        const node = nodes.find(n => n.id === row.current_node_id);
                        return (
                          <tr key={i}>
                            <td>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: NODE_COLORS[node?.type] || '#78716c' }} />
                                {node?.data?.label || node?.type || row.current_node_id}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${row.status === 'active' ? 'badge-green' : row.status === 'converted' ? 'badge-purple' : 'badge-gray'}`}>
                                {row.status}
                              </span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{fmt(row.count)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {nodeChartData.length === 0 && funnelData.length === 0 && entryFunnelData.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
                <BarChart3 size={40} color="var(--text-muted)" style={{ opacity: 0.3 }} />
                <h4 style={{ marginTop: 12, marginBottom: 6 }}>No Analytics Data Yet</h4>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, maxWidth: 400, margin: '0 auto' }}>
                  Enroll customers and process the journey to generate analytics data.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Activity ─────────────────────────────────────── */}
        {activeTab === 'activity' && (
          <div className="card">
            <div className="card-header"><h3>Journey Activity Timeline</h3></div>
            {(detail.nodeAnalytics || []).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {(detail.nodeAnalytics || []).slice(0, 50).map((event, i) => {
                  const node = nodes.find(n => n.id === event.node_id);
                  const nodeColor = NODE_COLORS[node?.type] || '#78716c';
                  const channelConf = event.channel ? CHANNEL_CONFIG[event.channel.toLowerCase()] : null;
                  return (
                    <div key={i} style={{
                      display: 'flex', gap: 16, padding: '14px 0',
                      borderBottom: i < (detail.nodeAnalytics.length - 1) ? '1px solid var(--bg-hover)' : 'none'
                    }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: nodeColor + '12', color: nodeColor
                      }}>
                        {(() => { const I = NODE_ICONS[node?.type] || Activity; return <I size={16} />; })()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{event.event_type?.replace(/_/g, ' ')}</span>
                          {channelConf && (
                            <span style={{
                              padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                              background: channelConf.color + '12', color: channelConf.color
                            }}>
                              {channelConf.label}
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {node?.data?.label || event.node_id}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                          {fmt(event.event_count)} events logged
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <Activity size={40} color="var(--text-muted)" style={{ opacity: 0.3 }} />
                <h4 style={{ marginTop: 12, marginBottom: 6 }}>No Activity Yet</h4>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, maxWidth: 400, margin: '0 auto' }}>
                  Process the journey to see customer activity events here.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Settings ─────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><h3>Journey Configuration</h3></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Journey ID</div>
                  <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'monospace' }}>#{detail.journey_id}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Status</div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    background: statusConf.bg, color: statusConf.color
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusConf.color }} />
                    {statusConf.label}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Segment</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{detail.segment_name || 'Not assigned'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Goal Type</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{detail.goal_type || 'Not set'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Created</div>
                  <div style={{ fontSize: 14 }}>{detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Last Updated</div>
                  <div style={{ fontSize: 14 }}>{detail.updated_at ? new Date(detail.updated_at).toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Total Nodes</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{nodes.length}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Channels</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {channels.length > 0 ? channels.map(ch => {
                      const conf = CHANNEL_CONFIG[ch] || {};
                      return (
                        <span key={ch} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: (conf.color || '#78716c') + '12', color: conf.color || '#78716c'
                        }}>
                          {conf.label || ch}
                        </span>
                      );
                    }) : <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>None</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Journey Metrics</h3></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{fmt(detail.total_entries)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Total Entries</div>
                </div>
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#8b5cf6' }}>{fmt(detail.total_conversions)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Total Conversions</div>
                </div>
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{pct(detail.conversion_rate)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Conversion Rate</div>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="card" style={{ borderColor: 'rgba(220,38,38,0.2)' }}>
              <div className="card-header"><h3 style={{ color: '#dc2626' }}>Danger Zone</h3></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>Delete this journey</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Once deleted, this journey and all its data cannot be recovered.</div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => setConfirmAction('delete')}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation Dialog ──────────────────────────────── */}
        {confirmAction && (
          <div className="confirm-overlay" onClick={() => setConfirmAction(null)}>
            <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
              <AlertCircle size={32} color={confirmAction === 'delete' ? '#dc2626' : 'var(--orange)'} style={{ marginBottom: 12 }} />
              <h3>
                {confirmAction === 'enroll' ? 'Enroll Segment Customers?' :
                 confirmAction === 'process' ? 'Process Journey?' :
                 'Delete Journey?'}
              </h3>
              <p>
                {confirmAction === 'enroll'
                  ? 'This will enroll all customers from the associated segment into this journey. This action cannot be undone.'
                  : confirmAction === 'process'
                  ? 'This will advance all active entries to their next step in the journey flow.'
                  : 'This will permanently delete this journey and all associated entries and events. This cannot be undone.'}
              </p>
              <div className="confirm-actions">
                <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                <button
                  className={`btn ${confirmAction === 'delete' ? 'btn-danger' : 'btn-primary'}`}
                  onClick={confirmAction === 'enroll' ? handleEnroll : confirmAction === 'process' ? handleProcess : () => handleDelete(selected)}
                >
                  {confirmAction === 'delete' ? 'Delete Forever' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // JOURNEY LIST VIEW
  // ══════════════════════════════════════════════════════════════
  return (
    <div>
      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h2>Journey Builder</h2>
          <div className="page-header-sub">Design, automate, and optimize customer journey flows across channels</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={14} /></button>
          <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Journey
          </button>
          <button className="btn btn-primary" onClick={() => setShowGenerate(true)} disabled={generating}>
            <Zap size={14} /> {generating ? 'Generating...' : 'Generate from Strategy'}
          </button>
        </div>
      </div>

      {/* ── Summary KPIs ──────────────────────────────────────── */}
      <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Journeys', value: summaryStats.total, color: 'kpi-blue', icon: GitBranch },
          { label: 'Active Journeys', value: summaryStats.active, color: 'kpi-green', icon: Play },
          { label: 'Total Entries', value: fmt(summaryStats.totalEntries), color: 'kpi-purple', icon: Users },
          { label: 'Avg. Conversion', value: pct(summaryStats.avgConversion), color: 'kpi-orange', icon: TrendingUp },
        ].map((kpi, i) => (
          <div key={i} className="card" style={{ padding: '20px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 500, marginBottom: 4 }}>{kpi.label}</div>
                <div className={`kpi-value ${kpi.color}`} style={{ fontSize: 26 }}>{kpi.value}</div>
              </div>
              <div style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
                <kpi.icon size={20} color="var(--text-dim)" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters & Search ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search journeys..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 36, width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-hover)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
          {['all', 'active', 'draft', 'paused', 'completed'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
                background: statusFilter === status ? 'var(--accent)' : 'transparent',
                color: statusFilter === status ? '#fff' : 'var(--text-dim)',
              }}
            >
              {status === 'all' ? 'All' : STATUS_CONFIG[status]?.label || status}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-hover)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
          <button
            onClick={() => setViewMode('cards')}
            style={{
              padding: 5, borderRadius: 5, border: 'none', cursor: 'pointer',
              background: viewMode === 'cards' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'cards' ? 'var(--text)' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', boxShadow: viewMode === 'cards' ? 'var(--shadow)' : 'none'
            }}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              padding: 5, borderRadius: 5, border: 'none', cursor: 'pointer',
              background: viewMode === 'list' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'list' ? 'var(--text)' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', boxShadow: viewMode === 'list' ? 'var(--shadow)' : 'none'
            }}
          >
            <List size={14} />
          </button>
        </div>
        {searchQuery && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {filteredJourneys.length} result{filteredJourneys.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Journey List / Cards ──────────────────────────────── */}
      {filteredJourneys.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          {journeys.length === 0 ? (
            <>
              <GitBranch size={48} color="var(--text-dim)" style={{ opacity: 0.3 }} />
              <h3 style={{ marginTop: 16, marginBottom: 8 }}>No Journeys Yet</h3>
              <p style={{ color: 'var(--text-dim)', maxWidth: 440, margin: '0 auto 20px', lineHeight: 1.6 }}>
                Create automated customer journeys to engage users across WhatsApp, Email, SMS, Push, and more.
                Auto-generate from your 28 omnichannel strategies to get started instantly.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>
                  <Plus size={14} /> Create Blank
                </button>
                <button className="btn btn-primary" onClick={() => setShowGenerate(true)}>
                  <Zap size={14} /> Generate from Strategy
                </button>
              </div>
            </>
          ) : (
            <>
              <Search size={40} color="var(--text-dim)" style={{ opacity: 0.3 }} />
              <h4 style={{ marginTop: 12, marginBottom: 6 }}>No journeys match your filters</h4>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>Clear filters</button>
            </>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        /* ── Card View ──────────────────────────────────────── */
        <div className="card-grid card-grid-2">
          {filteredJourneys.map(j => {
            const statusConf = STATUS_CONFIG[j.status] || STATUS_CONFIG.draft;
            const channels = getJourneyChannels(j.nodes);
            const convRate = parseFloat(j.conversion_rate) || 0;

            return (
              <div
                key={j.journey_id}
                className="card"
                role="button"
                tabIndex={0}
                onClick={() => openJourney(j.journey_id)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && openJourney(j.journey_id)}
                style={{ cursor: 'pointer', padding: '20px' }}
              >
                {/* Top row: name + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: statusConf.bg, flexShrink: 0
                      }}>
                        <GitBranch size={16} color={statusConf.color} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                        {j.segment_name && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{j.segment_name}</div>}
                      </div>
                    </div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: statusConf.bg, color: statusConf.color, flexShrink: 0
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusConf.color }} />
                    {statusConf.label}
                  </span>
                </div>

                {/* Channel pills */}
                {channels.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                    {channels.map(ch => {
                      const conf = CHANNEL_CONFIG[ch] || {};
                      const Icon = conf.icon || MessageSquare;
                      return (
                        <span key={ch} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                          background: (conf.color || '#78716c') + '10', color: conf.color || '#78716c'
                        }}>
                          <Icon size={10} /> {conf.label || ch}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Layers size={12} /> {j.node_count || 0} nodes
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={12} /> {fmt(j.total_entries)} entries
                  </span>
                </div>

                {/* Conversion progress bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Conversion</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: convRate >= 10 ? '#22c55e' : convRate > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                      {pct(convRate)}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{
                      width: `${Math.min(convRate, 100)}%`,
                      background: convRate >= 10 ? '#22c55e' : convRate > 0 ? '#f59e0b' : 'var(--border)'
                    }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── List View ──────────────────────────────────────── */
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Journey</th>
                  <th>Status</th>
                  <th>Segment</th>
                  <th>Channels</th>
                  <th>Nodes</th>
                  <th>Entries</th>
                  <th>Conversion</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredJourneys.map(j => {
                  const statusConf = STATUS_CONFIG[j.status] || STATUS_CONFIG.draft;
                  const channels = getJourneyChannels(j.nodes);

                  return (
                    <tr
                      key={j.journey_id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => openJourney(j.journey_id)}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <GitBranch size={14} color={statusConf.color} />
                          <span style={{ fontWeight: 600 }}>{j.name}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                          background: statusConf.bg, color: statusConf.color
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusConf.color }} />
                          {statusConf.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontSize: 13 }}>{j.segment_name || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3 }}>
                          {channels.slice(0, 3).map(ch => {
                            const conf = CHANNEL_CONFIG[ch] || {};
                            const Icon = conf.icon || MessageSquare;
                            return (
                              <span key={ch} title={conf.label || ch} style={{
                                width: 24, height: 24, borderRadius: 6,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                background: (conf.color || '#78716c') + '10', color: conf.color || '#78716c'
                              }}>
                                <Icon size={12} />
                              </span>
                            );
                          })}
                          {channels.length > 3 && <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>+{channels.length - 3}</span>}
                          {channels.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>}
                        </div>
                      </td>
                      <td>{j.node_count || 0}</td>
                      <td style={{ fontWeight: 500 }}>{fmt(j.total_entries)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: (j.conversion_rate || 0) >= 10 ? '#22c55e' : 'var(--text-dim)' }}>
                          {pct(j.conversion_rate)}
                        </span>
                      </td>
                      <td><ChevronRight size={14} color="var(--text-muted)" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Generate from Strategy Modal ───────────────────────── */}
      {showGenerate && (
        <div className="modal-overlay" onClick={() => setShowGenerate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={20} color="var(--accent)" /> Generate Journey from Strategy
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
              Select a strategy to auto-generate a complete journey flow with entry triggers, channel-specific actions, wait steps, branching conditions, and conversion goals.
            </p>
            <div style={{ maxHeight: 420, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {strategies.map(s => {
                const channelList = typeof s.channels === 'string'
                  ? s.channels.replace(/[{}]/g, '').split(',').filter(Boolean)
                  : (s.channels || []);

                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleGenerate(s.id)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleGenerate(s.id)}
                    style={{
                      padding: '14px 16px', cursor: 'pointer',
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 10, transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)'; }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{s.name}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge badge-purple" style={{ fontSize: 10 }}>{s.segment_label}</span>
                      {channelList.slice(0, 4).map(ch => {
                        const conf = CHANNEL_CONFIG[ch.trim().toLowerCase()] || {};
                        return (
                          <span key={ch} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            padding: '2px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                            background: (conf.color || '#78716c') + '10', color: conf.color || '#78716c'
                          }}>
                            {conf.label || ch.trim()}
                          </span>
                        );
                      })}
                      {channelList.length > 4 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{channelList.length - 4}</span>}
                    </div>
                    {s.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                        {s.description.length > 120 ? s.description.slice(0, 120) + '...' : s.description}
                      </div>
                    )}
                  </div>
                );
              })}
              {strategies.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                  <Zap size={24} style={{ opacity: 0.3, marginBottom: 8 }} /><br />
                  No strategies available. Create strategies first.
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowGenerate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Journey Modal ───────────────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={20} color="var(--accent)" /> Create New Journey
            </h3>
            <div className="form-group">
              <label>Journey Name *</label>
              <input
                type="text"
                placeholder="e.g., Welcome Series — New Customers"
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                placeholder="Describe the purpose and target audience of this journey..."
                value={createForm.description}
                onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                style={{ minHeight: 80 }}
              />
            </div>
            <div className="form-group">
              <label>Conversion Goal</label>
              <select
                value={createForm.goalType}
                onChange={e => setCreateForm(f => ({ ...f, goalType: e.target.value }))}
              >
                <option value="booking">Booking</option>
                <option value="enquiry">Enquiry</option>
                <option value="registration">Registration</option>
                <option value="purchase">Purchase</option>
                <option value="engagement">Engagement</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Plus size={14} /> Create Journey
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
