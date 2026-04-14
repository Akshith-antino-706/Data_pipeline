import { useState, useEffect, useCallback, useMemo } from 'react';
import { useBusinessType } from '../App';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getJourneys, getJourney, generateJourneyFromStrategy, enrollJourney,
  processJourney, getStrategies, aiFlowSuggest, getJourneyAnalytics,
  getJourneyCampaignAnalytics, createJourney, updateJourney, deleteJourney
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
  trigger: 'var(--red)', action: 'var(--green)', condition: 'var(--yellow)',
  wait: 'var(--yellow)', goal: 'var(--purple)'
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
  email: { color: 'var(--red)', icon: Mail, label: 'Email' },
  sms: { color: 'var(--orange)', icon: Smartphone, label: 'SMS' },
  push: { color: 'var(--purple)', icon: Bell, label: 'Push' },
  rcs: { color: 'var(--yellow)', icon: MessageSquare, label: 'RCS' },
  web: { color: 'var(--brand-primary)', icon: Globe, label: 'Web' }
};
const STATUS_CONFIG = {
  active: { color: 'var(--green)', bg: 'var(--green-dim)', label: 'Active' },
  draft: { color: 'var(--orange)', bg: 'var(--orange-dim)', label: 'Draft' },
  paused: { color: 'var(--text-tertiary)', bg: 'rgba(120,113,108,0.1)', label: 'Paused' },
  completed: { color: 'var(--purple)', bg: 'var(--purple-dim)', label: 'Completed' }
};
const PIE_COLORS = ['var(--green)', 'var(--red)', 'var(--orange)', 'var(--purple)', 'var(--brand-primary)', 'var(--yellow)'];

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

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
  const { businessType } = useBusinessType();
  // ── State ─────────────────────────────────────────────────────
  const [journeys, setJourneys] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [campaignData, setCampaignData] = useState(null);
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
  const [flowEditMode, setFlowEditMode] = useState(false);
  const [editingNode, setEditingNode] = useState(null); // node being edited
  const [addNodeAfter, setAddNodeAfter] = useState(null); // insert position
  const [nodeForm, setNodeForm] = useState({ type: 'action', channel: 'email', label: '', message: '', waitDays: 1, goalType: 'booking' });

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
    setCampaignData(null);
    setSuggestions(null);
    setActiveTab('flow');
    setDetailLoading(true);
    setExpandedNode(null);
    try {
      const [d, a, cd] = await Promise.all([
        getJourney(id),
        getJourneyAnalytics(id).catch(() => ({ data: null })),
        getJourneyCampaignAnalytics(id).catch(() => ({ data: null }))
      ]);
      setDetail(d.data);
      setAnalytics(a.data);
      setCampaignData(cd.data);
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

  // ── Node-level editing ───────────────────────────────────────
  const saveNodeChanges = async (updatedNodes) => {
    try {
      // Rebuild edges from node order
      const edges = updatedNodes.slice(1).map((n, i) => ({
        id: `e_${updatedNodes[i].id}_${n.id}`,
        source: updatedNodes[i].id,
        target: n.id,
      }));
      await updateJourney(selected, { nodes: updatedNodes, edges });
      const d = await getJourney(selected);
      setDetail(d.data);
      showToast('Flow updated', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleAddNode = (afterIndex) => {
    const nodes = detail.nodes || [];
    const newId = `node_${Date.now()}`;
    const newNode = {
      id: newId,
      type: nodeForm.type,
      data: {
        label: nodeForm.label || `New ${nodeForm.type} step`,
        ...(nodeForm.type === 'action' && { channel: nodeForm.channel, message: nodeForm.message }),
        ...(nodeForm.type === 'wait' && { waitDays: nodeForm.waitDays }),
        ...(nodeForm.type === 'condition' && { label: nodeForm.label }),
        ...(nodeForm.type === 'goal' && { goalType: nodeForm.goalType }),
      }
    };
    const updated = [...nodes.slice(0, afterIndex + 1), newNode, ...nodes.slice(afterIndex + 1)];
    saveNodeChanges(updated);
    setAddNodeAfter(null);
    setNodeForm({ type: 'action', channel: 'email', label: '', message: '', waitDays: 1, goalType: 'booking' });
  };

  const handleEditNode = (nodeId) => {
    const nodes = detail.nodes || [];
    const idx = nodes.findIndex(n => n.id === nodeId);
    if (idx < 0) return;
    const updated = [...nodes];
    updated[idx] = {
      ...updated[idx],
      type: nodeForm.type,
      data: {
        ...updated[idx].data,
        label: nodeForm.label || updated[idx].data?.label,
        ...(nodeForm.type === 'action' && { channel: nodeForm.channel, message: nodeForm.message }),
        ...(nodeForm.type === 'wait' && { waitDays: nodeForm.waitDays }),
        ...(nodeForm.type === 'goal' && { goalType: nodeForm.goalType }),
      }
    };
    saveNodeChanges(updated);
    setEditingNode(null);
  };

  const handleDeleteNode = (nodeId) => {
    const nodes = detail.nodes || [];
    const updated = nodes.filter(n => n.id !== nodeId);
    saveNodeChanges(updated);
  };

  const handleMoveNode = (nodeId, direction) => {
    const nodes = [...(detail.nodes || [])];
    const idx = nodes.findIndex(n => n.id === nodeId);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= nodes.length) return;
    [nodes[idx], nodes[newIdx]] = [nodes[newIdx], nodes[idx]];
    saveNodeChanges(nodes);
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
    // B2B/B2C filter
    filtered = filtered.filter(j => {
      const name = (j.name || '').toUpperCase();
      const seg = (j.segment_name || '').toUpperCase();
      if (businessType === 'B2B') return name.includes('B2B') || seg.startsWith('B2B');
      return !name.includes('B2B') && !seg.startsWith('B2B');
    });
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
  }, [journeys, statusFilter, searchQuery, businessType]);

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
    <div className="pt-10">
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 300, height: 16 }} />
        </div>
      </div>
      <div className="card-grid card-grid-4 mb-6">
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

    // Build campaign metrics per action node
    const nodeCampaignMap = {};
    const campaigns = campaignData?.campaigns || [];
    const actionNodes = nodes.filter(n => n.type === 'action');
    // Match campaigns to action nodes by channel + order
    const campaignsByChannel = {};
    campaigns.forEach(c => {
      const ch = c.channel?.toLowerCase();
      if (!campaignsByChannel[ch]) campaignsByChannel[ch] = [];
      campaignsByChannel[ch].push(c);
    });
    actionNodes.forEach(n => {
      const ch = (n.data?.channel || '').toLowerCase();
      // Try node_id match first, then channel match
      const matched = campaigns.find(c => c.journey_node_id === n.id)
        || (campaignsByChannel[ch] && campaignsByChannel[ch].shift());
      if (matched) {
        nodeCampaignMap[n.id] = {
          target: parseInt(campaignData?.target_count) || parseInt(detail.total_entries) || 0,
          sent: parseInt(matched.sent_count) || 0,
          delivered: parseInt(matched.delivered_count) || 0,
          read: parseInt(matched.read_count) || 0,
          clicked: parseInt(matched.click_count) || 0,
          bounced: parseInt(matched.bounce_count) || 0,
          failed: parseInt(matched.fail_count) || 0,
          template_body: matched.template_body || null,
          campaign_name: matched.name,
          delivery_rate: matched.delivery_rate,
          open_rate: matched.open_rate,
          click_rate: matched.click_rate,
        };
      }
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
      { name: 'Entered', value: parseInt(stats.total_entries) || 0, color: 'var(--yellow)' },
      { name: 'Active', value: parseInt(stats.active) || 0, color: 'var(--green)' },
      { name: 'Completed', value: parseInt(stats.completed) || 0, color: 'var(--brand-primary)' },
      { name: 'Converted', value: parseInt(stats.converted) || 0, color: 'var(--purple)' },
      { name: 'Exited', value: parseInt(stats.exited) || 0, color: 'var(--red)' },
    ].filter(d => d.value > 0);

    return (
      <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
        {/* ── Back + Header ─────────────────────────────────────── */}
        <motion.div variants={fadeInUp}>
        <button className="btn btn-ghost mb-4" onClick={() => { setSelected(null); setDetail(null); setEditMode(false); }}>
          <ArrowLeft size={14} /> All Journeys
        </button>

        <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
          <div style={{ flex: 1, minWidth: 0 }}>
            {editMode ? (
              <div className="flex gap-2 items-center mb-2">
                <input
                  value={editForm.name || ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  style={{ fontSize: 22, fontWeight: 700, padding: '4px 12px', maxWidth: 400 }}
                />
                <button className="btn btn-sm btn-primary" onClick={handleUpdateJourney}>Save</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditMode(false)}>Cancel</button>
              </div>
            ) : (
              <h2 className="flex items-center gap-2.5" style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
                {detail.name}
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditMode(true); setEditForm({ name: detail.name, description: detail.description, status: detail.status }); }}>
                  <Edit3 size={14} />
                </button>
              </h2>
            )}
            <div className="flex gap-2 flex-wrap items-center">
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
                <span className="badge" style={{ background: (detail.stage_color || 'var(--red)') + '20', color: detail.stage_color || 'var(--red)' }}>
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
              <p className="text-secondary" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.7, maxWidth: 600 }}>{detail.description}</p>
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
          <div className="flex gap-2 flex-wrap">
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
                    background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)',
                    minWidth: 180, zIndex: 51, overflow: 'hidden'
                  }}>
                    <button onClick={() => { setShowActions(false); navigator.clipboard?.writeText(String(selected)); showToast('Journey ID copied', 'info'); }}
                      className="flex items-center gap-2" style={{ padding: '10px 14px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                      <Copy size={14} /> Copy ID
                    </button>
                    <button onClick={() => { setShowActions(false); setConfirmAction('delete'); }}
                      className="flex items-center gap-2" style={{ padding: '10px 14px', width: '100%', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--red)' }}>
                      <Trash2 size={14} /> Delete Journey
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        </motion.div>

        {/* ── KPIs ──────────────────────────────────────────────── */}
        <motion.div variants={fadeInUp}>
        <div className="card-grid card-grid-4 mb-6">
          {[
            { label: 'Total Entries', value: fmt(stats.total_entries), color: 'kpi-blue', icon: Users },
            { label: 'Active Now', value: fmt(stats.active), color: 'kpi-green', icon: Activity },
            { label: 'Converted', value: fmt(stats.converted), color: 'kpi-purple', icon: CheckCircle2 },
            { label: 'Conversion Rate', value: pct(detail.conversion_rate), color: 'kpi-orange', icon: TrendingUp },
          ].map((kpi, i) => (
            <div key={i} className="card" style={{ padding: '20px 16px' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 500, marginBottom: 4 }}>{kpi.label}</div>
                  <div className={`kpi-value ${kpi.color}`} style={{ fontSize: 26 }}>{kpi.value}</div>
                </div>
                <div className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-secondary)' }}>
                  <kpi.icon size={20} color="var(--text-secondary)" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────── */}
        <div className="tabs mb-5">
          {[
            { id: 'flow', label: 'Journey Flow', icon: GitBranch },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map(tab => (
            <button
              key={tab.id}
              className={`tab flex items-center gap-1.5 ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
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
              <div className="card mb-4" style={{ borderLeft: '4px solid var(--purple)' }}>
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} color="var(--purple)" />
                    <span className="font-semibold text-sm">AI Flow Analysis</span>
                  </div>
                  <span style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700,
                    background: suggestions.overall_score >= 80 ? 'var(--green-dim)' : suggestions.overall_score >= 60 ? 'var(--orange-dim)' : 'rgba(220,38,38,0.1)',
                    color: suggestions.overall_score >= 80 ? 'var(--green)' : suggestions.overall_score >= 60 ? 'var(--orange)' : 'var(--red)'
                  }}>
                    Score: {suggestions.overall_score}/100
                  </span>
                </div>
                {(suggestions.suggestions || []).length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {suggestions.suggestions.map((s, i) => (
                      <div key={i} className="flex gap-3" style={{
                        padding: '10px 14px',
                        background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)'
                      }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
                          borderRadius: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          alignSelf: 'flex-start', marginTop: 2,
                          background: s.impact === 'high' ? 'rgba(220,38,38,0.1)' : s.impact === 'medium' ? 'var(--orange-dim)' : 'var(--green-dim)',
                          color: s.impact === 'high' ? 'var(--red)' : s.impact === 'medium' ? 'var(--orange)' : 'var(--green)'
                        }}>
                          {s.impact}
                        </span>
                        <div>
                          <div className="font-semibold text-sm">{s.title}</div>
                          <div className="text-secondary" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{s.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-secondary" style={{ padding: 12, textAlign: 'center', fontSize: 13 }}>
                    <CheckCircle2 size={16} style={{ marginRight: 6, verticalAlign: -3 }} />
                    Flow looks optimized — no suggestions at this time.
                  </div>
                )}
              </div>
            )}

            {/* Visual Flow Canvas */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="flex justify-between items-center" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
                <div className="flex items-center gap-2">
                  <Layers size={16} color="var(--text-secondary)" />
                  <span className="font-semibold text-secondary" style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Journey Flow
                  </span>
                  <span className="badge badge-gray">{nodes.length} nodes</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex gap-3" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {Object.entries(NODE_COLORS).map(([type, color]) => (
                      <span key={type} className="flex items-center gap-1">
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                        {type}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setFlowEditMode(!flowEditMode)}
                    className={`btn btn-sm ${flowEditMode ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: 11, padding: '4px 12px' }}
                  >
                    {flowEditMode ? 'Done Editing' : 'Edit Flow'}
                  </button>
                </div>
              </div>

              <div style={{ padding: '24px 32px', background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-card) 100%)', minHeight: 200 }}>
                {nodes.length === 0 ? (
                  <div className="empty" style={{ padding: '40px 20px' }}>
                    <GitBranch size={40} color="var(--text-muted)" style={{ opacity: 0.3 }} />
                    <h4 style={{ marginTop: 12 }}>No nodes in this journey</h4>
                    <p className="text-secondary text-sm">Generate from a strategy to populate the flow.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {nodes.map((node, i) => {
                      const Icon = NODE_ICONS[node.type] || Target;
                      const color = NODE_COLORS[node.type] || 'var(--text-tertiary)';
                      const channelConf = node.data?.channel ? CHANNEL_CONFIG[node.data.channel.toLowerCase()] : null;
                      const ChannelIcon = channelConf?.icon || null;
                      const nodeStats = nodeAnalyticsMap[node.id] || {};
                      const isExpanded = expandedNode === node.id;
                      const hasSent = nodeStats.action_sent > 0;

                      return (
                        <div key={node.id} style={{ width: '100%', maxWidth: 520 }}>
                          {/* Connector Arrow + Insert Button */}
                          {i > 0 && (
                            <div className="flex flex-col items-center" style={{ position: 'relative' }}>
                              <div style={{ width: 2, height: 12, background: `linear-gradient(to bottom, ${NODE_COLORS[nodes[i-1]?.type] || '#e7e5e4'}40, ${color}40)` }} />
                              {flowEditMode ? (
                                addNodeAfter === i - 1 ? (
                                  <div style={{ background: 'var(--bg-card)', border: '2px dashed var(--red)', borderRadius: 10, padding: 12, margin: '4px 0', width: '100%', maxWidth: 480 }}>
                                    <div className="flex gap-2 mb-2 flex-wrap">
                                      {['action', 'wait', 'condition', 'goal'].map(t => (
                                        <button key={t} onClick={() => setNodeForm(f => ({...f, type: t}))}
                                          style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                            border: nodeForm.type === t ? `2px solid ${NODE_COLORS[t]}` : '1px solid var(--border-color)',
                                            background: nodeForm.type === t ? NODE_COLORS[t] + '15' : 'var(--bg-secondary)', color: NODE_COLORS[t] || 'var(--text-primary)' }}>
                                          {t}
                                        </button>
                                      ))}
                                    </div>
                                    {nodeForm.type === 'action' && (
                                      <div className="flex gap-1.5 mb-2">
                                        {['email', 'whatsapp', 'sms', 'push'].map(ch => (
                                          <button key={ch} onClick={() => setNodeForm(f => ({...f, channel: ch}))}
                                            style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                                              border: nodeForm.channel === ch ? '2px solid var(--red)' : '1px solid var(--border-color)',
                                              background: nodeForm.channel === ch ? 'var(--red)' + '15' : 'var(--bg-secondary)', textTransform: 'capitalize' }}>
                                            {ch}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    <input value={nodeForm.label} onChange={e => setNodeForm(f => ({...f, label: e.target.value}))}
                                      placeholder={nodeForm.type === 'wait' ? 'e.g. Wait 3 days' : 'Step description...'}
                                      style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12, marginBottom: 8 }} />
                                    {nodeForm.type === 'wait' && (
                                      <input type="number" value={nodeForm.waitDays} onChange={e => setNodeForm(f => ({...f, waitDays: parseInt(e.target.value) || 1}))}
                                        placeholder="Days to wait" style={{ width: 100, padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12, marginBottom: 8 }} />
                                    )}
                                    <div className="flex gap-1.5">
                                      <button onClick={() => handleAddNode(i - 1)} className="btn btn-sm btn-primary" style={{ fontSize: 11 }}>Add</button>
                                      <button onClick={() => setAddNodeAfter(null)} className="btn btn-sm btn-ghost" style={{ fontSize: 11 }}>Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button onClick={() => { setAddNodeAfter(i - 1); setNodeForm({ type: 'action', channel: 'email', label: '', message: '', waitDays: 1, goalType: 'booking' }); }}
                                    className="flex items-center justify-center"
                                    style={{ width: 22, height: 22, borderRadius: '50%', border: '2px dashed var(--red)', background: 'var(--bg-card)', color: 'var(--red)',
                                      cursor: 'pointer', fontSize: 14, fontWeight: 700, margin: '2px 0' }}>
                                    +
                                  </button>
                                )
                              ) : (
                                <ArrowDown size={14} color={color + '80'} />
                              )}
                              <div style={{ width: 2, height: 4, background: color + '40' }} />
                            </div>
                          )}

                          {/* Node Card */}
                          <div
                            onClick={() => setExpandedNode(isExpanded ? null : node.id)}
                            style={{
                              background: 'var(--bg-card)',
                              border: `1px solid ${isExpanded ? color + '50' : 'var(--border-color)'}`,
                              borderLeft: `4px solid ${color}`,
                              borderRadius: 12,
                              padding: '14px 16px',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              boxShadow: isExpanded ? `0 4px 16px ${color}15` : 'var(--shadow)',
                            }}
                          >
                            <div className="flex items-center gap-3">
                              {/* Node icon */}
                              <div className="flex items-center justify-center shrink-0" style={{
                                width: 40, height: 40, borderRadius: 10,
                                background: color + '12', color
                              }}>
                                <Icon size={20} />
                              </div>

                              {/* Node content */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="flex items-center gap-2 flex-wrap">
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
                                    <span className="flex items-center gap-0.5" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      <Clock size={10} /> {node.data.timing}
                                    </span>
                                  )}
                                </div>
                                {node.data?.label && (
                                  <div className="font-medium" style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 4 }}>{node.data.label}</div>
                                )}
                              </div>

                              {/* Node stats preview */}
                              {hasSent && (
                                <div className="text-right shrink-0">
                                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(nodeStats.action_sent)}</div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>sent</div>
                                </div>
                              )}

                              {/* Flow edit controls */}
                              {flowEditMode && (
                                <div className="flex gap-0.5" style={{ marginRight: 4 }} onClick={e => e.stopPropagation()}>
                                  {i > 0 && (
                                    <button onClick={() => handleMoveNode(node.id, 'up')} title="Move up"
                                      className="flex items-center justify-center"
                                      style={{ width: 24, height: 24, border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 12 }}>↑</button>
                                  )}
                                  {i < nodes.length - 1 && (
                                    <button onClick={() => handleMoveNode(node.id, 'down')} title="Move down"
                                      className="flex items-center justify-center"
                                      style={{ width: 24, height: 24, border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: 12 }}>↓</button>
                                  )}
                                  <button onClick={() => handleDeleteNode(node.id)} title="Delete node"
                                    className="flex items-center justify-center"
                                    style={{ width: 24, height: 24, border: '1px solid var(--red)', borderRadius: 6, background: 'var(--red-dim)', color: 'var(--red)', cursor: 'pointer', fontSize: 12 }}>×</button>
                                </div>
                              )}
                              <ChevronDown size={14} color="var(--text-muted)" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-color)' }}>
                                {node.data?.message && (
                                  <div style={{
                                    background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 14px',
                                    fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, marginBottom: 12,
                                    borderLeft: `3px solid ${channelConf?.color || color}20`
                                  }}>
                                    {node.data.message}
                                  </div>
                                )}
                                {node.data?.waitDays && (
                                  <div className="flex items-center gap-2" style={{ padding: '8px 0' }}>
                                    <Clock size={14} color={color} />
                                    <span className="text-secondary text-sm">
                                      Wait <strong>{node.data.waitDays} day{node.data.waitDays !== 1 ? 's' : ''}</strong> before proceeding
                                    </span>
                                  </div>
                                )}
                                {node.data?.triggerType && (
                                  <div className="flex items-center gap-2" style={{ padding: '8px 0' }}>
                                    <Zap size={14} color={color} />
                                    <span className="text-secondary text-sm">
                                      Trigger: <strong>{node.data.triggerType}</strong>
                                      {node.data?.segmentLabel && <span> — {node.data.segmentLabel}</span>}
                                    </span>
                                  </div>
                                )}
                                {node.data?.goalType && (
                                  <div className="flex items-center gap-2" style={{ padding: '8px 0' }}>
                                    <Target size={14} color={color} />
                                    <span className="text-secondary text-sm">
                                      Conversion goal: <strong>{node.data.goalType}</strong>
                                    </span>
                                  </div>
                                )}

                                {/* Campaign Metrics Card — per node */}
                                {node.type === 'action' && (() => {
                                  const camp = nodeCampaignMap?.[node.id];
                                  const target = camp?.target || parseInt(detail?.total_entries) || 0;
                                  const sent = camp?.sent || parseInt(nodeStats?.action_sent) || 0;
                                  const delivered = camp?.delivered || parseInt(nodeStats?.action_delivered) || 0;
                                  const read = camp?.read || parseInt(nodeStats?.action_read) || 0;
                                  const clicked = camp?.clicked || parseInt(nodeStats?.action_clicked) || 0;
                                  const bounced = camp?.bounced || parseInt(nodeStats?.action_bounced) || 0;
                                  const failed = camp?.failed || parseInt(nodeStats?.action_failed) || 0;
                                  return (
                                    <div className="mt-3">
                                      {/* Top row — Target, Sent, Delivered */}
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                                        {[
                                          { label: 'TARGET', value: target, color: 'var(--green)' },
                                          { label: 'SENT', value: sent, color: 'var(--green)' },
                                          { label: 'DELIVERED', value: delivered, color: 'var(--green)' },
                                        ].map(m => (
                                          <div key={m.label} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 8px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                                            <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{fmt(m.value)}</div>
                                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: 2 }}>{m.label}</div>
                                          </div>
                                        ))}
                                      </div>
                                      {/* Bottom row — Read, Clicked, Bounced, Failed */}
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                                        {[
                                          { label: 'Read', value: read, color: 'var(--text-primary)' },
                                          { label: 'Clicked', value: clicked, color: 'var(--text-primary)' },
                                          { label: 'Bounced', value: bounced, color: 'var(--orange)' },
                                          { label: 'Failed', value: failed, color: 'var(--red)' },
                                        ].map(m => (
                                          <div key={m.label} style={{ textAlign: 'center', padding: '6px 0' }}>
                                            <div style={{ fontSize: 18, fontWeight: 700, color: m.color }}>{fmt(m.value)}</div>
                                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.label}</div>
                                          </div>
                                        ))}
                                      </div>
                                      {/* Template preview if available */}
                                      {(camp?.template_body || node.data?.message) && (() => {
                                        const raw = camp?.template_body || node.data?.message || '';
                                        // Strip HTML tags for clean preview
                                        const clean = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                                        return (
                                          <div className="mt-2.5">
                                            <div className="flex justify-between items-center mb-1">
                                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Template Preview</span>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const matched = (campaignData?.campaigns || []).find(c => c.journey_node_id === node.id)
                                                    || (campaignData?.campaigns || []).find(c => (c.channel || '').toLowerCase() === (node.data?.channel || '').toLowerCase());
                                                  const tplId = matched?.template_id || '';
                                                  window.location.href = `/content${tplId ? `?templateId=${tplId}` : ''}`;
                                                }}
                                                style={{ fontSize: 10, color: 'var(--red)', background: 'none', border: '1px solid var(--red)', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontWeight: 600 }}
                                              >
                                                Edit Template
                                              </button>
                                            </div>
                                            <div className="text-secondary" style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.6, border: '1px solid var(--border-color)' }}>
                                              {clean.slice(0, 200)}{clean.length > 200 ? '...' : ''}
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  );
                                })()}
                                {/* Non-action node stats */}
                                {node.type !== 'action' && Object.keys(nodeStats).length > 0 && (
                                  <div className="flex gap-4 mt-2 flex-wrap">
                                    {Object.entries(nodeStats).map(([event, count]) => (
                                      <div key={event} style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(count)}</div>
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
                    {/* Add node at end when in edit mode */}
                    {flowEditMode && (
                      <div className="flex flex-col items-center mt-2">
                        <div style={{ width: 2, height: 12, background: 'var(--border-color)' }} />
                        {addNodeAfter === nodes.length - 1 ? (
                          <div style={{ background: 'var(--bg-card)', border: '2px dashed var(--red)', borderRadius: 10, padding: 12, width: '100%', maxWidth: 480 }}>
                            <div className="flex gap-2 mb-2 flex-wrap">
                              {['action', 'wait', 'condition', 'goal'].map(t => (
                                <button key={t} onClick={() => setNodeForm(f => ({...f, type: t}))}
                                  style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                    border: nodeForm.type === t ? `2px solid ${NODE_COLORS[t]}` : '1px solid var(--border-color)',
                                    background: nodeForm.type === t ? NODE_COLORS[t] + '15' : 'var(--bg-secondary)', color: NODE_COLORS[t] || 'var(--text-primary)' }}>
                                  {t}
                                </button>
                              ))}
                            </div>
                            {nodeForm.type === 'action' && (
                              <div className="flex gap-1.5 mb-2">
                                {['email', 'whatsapp', 'sms', 'push'].map(ch => (
                                  <button key={ch} onClick={() => setNodeForm(f => ({...f, channel: ch}))}
                                    style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                                      border: nodeForm.channel === ch ? '2px solid var(--red)' : '1px solid var(--border-color)',
                                      background: nodeForm.channel === ch ? 'var(--red)' + '15' : 'var(--bg-secondary)', textTransform: 'capitalize' }}>
                                    {ch}
                                  </button>
                                ))}
                              </div>
                            )}
                            <input value={nodeForm.label} onChange={e => setNodeForm(f => ({...f, label: e.target.value}))}
                              placeholder="Step description..." style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12, marginBottom: 8 }} />
                            {nodeForm.type === 'wait' && (
                              <input type="number" value={nodeForm.waitDays} onChange={e => setNodeForm(f => ({...f, waitDays: parseInt(e.target.value) || 1}))}
                                placeholder="Days" style={{ width: 100, padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12, marginBottom: 8 }} />
                            )}
                            <div className="flex gap-1.5">
                              <button onClick={() => handleAddNode(nodes.length - 1)} className="btn btn-sm btn-primary" style={{ fontSize: 11 }}>Add</button>
                              <button onClick={() => setAddNodeAfter(null)} className="btn btn-sm btn-ghost" style={{ fontSize: 11 }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setAddNodeAfter(nodes.length - 1); setNodeForm({ type: 'action', channel: 'email', label: '', message: '', waitDays: 1, goalType: 'booking' }); }}
                            className="flex items-center justify-center"
                            style={{ width: 28, height: 28, borderRadius: '50%', border: '2px dashed var(--red)', background: 'var(--bg-card)', color: 'var(--red)',
                              cursor: 'pointer', fontSize: 16, fontWeight: 700 }}>
                            +
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── TAB: Analytics ────────────────────────────────────── */}
        {activeTab === 'analytics' && (
          <div className="flex flex-col gap-4">
            {/* Entry Funnel */}
            <div className="card-grid card-grid-2">
              <div className="card">
                <div className="card-header"><h3>Entry Funnel</h3></div>
                {entryFunnelData.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {entryFunnelData.map((d, i) => {
                      const maxVal = Math.max(...entryFunnelData.map(x => x.value), 1);
                      return (
                        <div key={i}>
                          <div className="flex justify-between mb-1" style={{ fontSize: 12 }}>
                            <span className="font-semibold" style={{ color: d.color }}>{d.name}</span>
                            <span className="font-semibold">{fmt(d.value)}</span>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${(d.value / maxVal) * 100}%`, background: d.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-secondary" style={{ textAlign: 'center', padding: 40, fontSize: 13 }}>No entry data yet. Enroll customers to see funnel data.</div>
                )}
              </div>

              <div className="card">
                <div className="card-header"><h3>Channel Distribution</h3></div>
                {channelDistribution.length > 0 ? (
                  <div className="flex items-center gap-5">
                    <ResponsiveContainer width="50%" height={160}>
                      <PieChart>
                        <Pie data={channelDistribution} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" paddingAngle={3}>
                          {channelDistribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(val) => [`${val} nodes`, '']} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-col gap-2" style={{ flex: 1 }}>
                      {channelDistribution.map((d, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="shrink-0" style={{ width: 10, height: 10, borderRadius: 2, background: d.color }} />
                          <span className="text-sm" style={{ flex: 1 }}>{d.name}</span>
                          <span className="text-sm font-semibold">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-secondary" style={{ textAlign: 'center', padding: 40, fontSize: 13 }}>No channels configured yet.</div>
                )}
              </div>
            </div>

            {/* Node Performance */}
            {nodeChartData.length > 0 && (
              <div className="card">
                <div className="card-header"><h3>Node Performance</h3></div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={nodeChartData} barCategoryGap="20%">
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
                    <Tooltip />
                    <Bar dataKey="sent" fill="var(--yellow)" radius={[4,4,0,0]} name="Sent" />
                    <Bar dataKey="delivered" fill="var(--green)" radius={[4,4,0,0]} name="Delivered" />
                    <Bar dataKey="opened" fill="var(--brand-primary)" radius={[4,4,0,0]} name="Opened" />
                    <Bar dataKey="clicked" fill="var(--purple)" radius={[4,4,0,0]} name="Clicked" />
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
                              <span className="flex items-center gap-1.5">
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: NODE_COLORS[node?.type] || '#78716c' }} />
                                {node?.data?.label || node?.type || row.current_node_id}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${row.status === 'active' ? 'badge-green' : row.status === 'converted' ? 'badge-purple' : 'badge-gray'}`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="font-semibold">{fmt(row.count)}</td>
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
                <h4 className="mt-3 mb-1.5">No Analytics Data Yet</h4>
                <p className="text-secondary text-sm" style={{ maxWidth: 400, margin: '0 auto' }}>
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
              <div className="flex flex-col">
                {(detail.nodeAnalytics || []).slice(0, 50).map((event, i) => {
                  const node = nodes.find(n => n.id === event.node_id);
                  const nodeColor = NODE_COLORS[node?.type] || '#78716c';
                  const channelConf = event.channel ? CHANNEL_CONFIG[event.channel.toLowerCase()] : null;
                  return (
                    <div key={i} className="flex gap-4" style={{
                      padding: '14px 0',
                      borderBottom: i < (detail.nodeAnalytics.length - 1) ? '1px solid var(--bg-hover)' : 'none'
                    }}>
                      <div className="flex items-center justify-center shrink-0" style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: nodeColor + '12', color: nodeColor
                      }}>
                        {(() => { const I = NODE_ICONS[node?.type] || Activity; return <I size={16} />; })()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{event.event_type?.replace(/_/g, ' ')}</span>
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
                        <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
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
                <h4 className="mt-3 mb-1.5">No Activity Yet</h4>
                <p className="text-secondary text-sm" style={{ maxWidth: 400, margin: '0 auto' }}>
                  Process the journey to see customer activity events here.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Settings ─────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-4">
            <div className="card">
              <div className="card-header"><h3>Journey Configuration</h3></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Journey ID</div>
                  <div className="font-medium" style={{ fontSize: 14, fontFamily: 'monospace' }}>#{detail.journey_id}</div>
                </div>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Status</div>
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
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Segment</div>
                  <div className="font-medium" style={{ fontSize: 14 }}>{detail.segment_name || 'Not assigned'}</div>
                </div>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Goal Type</div>
                  <div className="font-medium" style={{ fontSize: 14 }}>{detail.goal_type || 'Not set'}</div>
                </div>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Created</div>
                  <div style={{ fontSize: 14 }}>{detail.created_at ? new Date(detail.created_at).toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Last Updated</div>
                  <div style={{ fontSize: 14 }}>{detail.updated_at ? new Date(detail.updated_at).toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Total Nodes</div>
                  <div className="font-medium" style={{ fontSize: 14 }}>{nodes.length}</div>
                </div>
                <div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500, marginBottom: 4 }}>Channels</div>
                  <div className="flex gap-1.5 flex-wrap">
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
                    }) : <span className="text-secondary text-sm">None</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><h3>Journey Metrics</h3></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(detail.total_entries)}</div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Total Entries</div>
                </div>
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>{fmt(detail.total_conversions)}</div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Total Conversions</div>
                </div>
                <div style={{ textAlign: 'center', padding: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{pct(detail.conversion_rate)}</div>
                  <div className="text-secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>Conversion Rate</div>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="card" style={{ borderColor: 'rgba(220,38,38,0.2)' }}>
              <div className="card-header"><h3 style={{ color: 'var(--red)' }}>Danger Zone</h3></div>
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium" style={{ fontSize: 14 }}>Delete this journey</div>
                  <div className="text-secondary" style={{ fontSize: 12 }}>Once deleted, this journey and all its data cannot be recovered.</div>
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
              <AlertCircle size={32} color={confirmAction === 'delete' ? 'var(--red)' : 'var(--orange)'} style={{ marginBottom: 12 }} />
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
        </motion.div>
      </motion.div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // JOURNEY LIST VIEW
  // ══════════════════════════════════════════════════════════════
  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* ── Page Header ───────────────────────────────────────── */}
      <motion.div variants={fadeInUp}>
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
      </motion.div>

      {/* ── Summary KPIs ──────────────────────────────────────── */}
      <motion.div variants={fadeInUp}>
      <div className="card-grid card-grid-4 mb-6">
        {[
          { label: 'Total Journeys', value: summaryStats.total, color: 'kpi-blue', icon: GitBranch },
          { label: 'Active Journeys', value: summaryStats.active, color: 'kpi-green', icon: Play },
          { label: 'Total Entries', value: fmt(summaryStats.totalEntries), color: 'kpi-purple', icon: Users },
          { label: 'Avg. Conversion', value: pct(summaryStats.avgConversion), color: 'kpi-orange', icon: TrendingUp },
        ].map((kpi, i) => (
          <div key={i} className="card" style={{ padding: '20px 16px' }}>
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 500, marginBottom: 4 }}>{kpi.label}</div>
                <div className={`kpi-value ${kpi.color}`} style={{ fontSize: 26 }}>{kpi.value}</div>
              </div>
              <div className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-secondary)' }}>
                <kpi.icon size={20} color="var(--text-secondary)" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters & Search ──────────────────────────────────── */}
      <div className="flex gap-3 mb-5 items-center flex-wrap">
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
        <div className="flex gap-1" style={{ background: 'var(--bg-hover)', padding: 3, borderRadius: 8, border: '1px solid var(--border-color)' }}>
          {['all', 'active', 'draft', 'paused', 'completed'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
                background: statusFilter === status ? 'var(--red)' : 'transparent',
                color: statusFilter === status ? 'var(--bg-card)' : 'var(--text-secondary)',
              }}
            >
              {status === 'all' ? 'All' : STATUS_CONFIG[status]?.label || status}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5" style={{ background: 'var(--bg-hover)', padding: 3, borderRadius: 8, border: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setViewMode('cards')}
            className="flex items-center"
            style={{
              padding: 5, borderRadius: 5, border: 'none', cursor: 'pointer',
              background: viewMode === 'cards' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'cards' ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: viewMode === 'cards' ? 'var(--shadow)' : 'none'
            }}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className="flex items-center"
            style={{
              padding: 5, borderRadius: 5, border: 'none', cursor: 'pointer',
              background: viewMode === 'list' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: viewMode === 'list' ? 'var(--shadow)' : 'none'
            }}
          >
            <List size={14} />
          </button>
        </div>
        {searchQuery && (
          <span className="text-secondary" style={{ fontSize: 12 }}>
            {filteredJourneys.length} result{filteredJourneys.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Journey List / Cards ──────────────────────────────── */}
      {filteredJourneys.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          {journeys.length === 0 ? (
            <>
              <GitBranch size={48} color="var(--text-secondary)" style={{ opacity: 0.3 }} />
              <h3 className="mt-4 mb-2">No Journeys Yet</h3>
              <p className="text-secondary" style={{ maxWidth: 440, margin: '0 auto 20px', lineHeight: 1.6 }}>
                Create automated customer journeys to engage users across WhatsApp, Email, SMS, Push, and more.
                Auto-generate from your 28 omnichannel strategies to get started instantly.
              </p>
              <div className="flex gap-2 justify-center">
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
              <Search size={40} color="var(--text-secondary)" style={{ opacity: 0.3 }} />
              <h4 className="mt-3 mb-1.5">No journeys match your filters</h4>
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
                <div className="flex justify-between items-start mb-3">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex items-center justify-center shrink-0" style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: statusConf.bg
                      }}>
                        <GitBranch size={16} color={statusConf.color} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="font-semibold" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                        {j.segment_name && <div className="text-secondary" style={{ fontSize: 11 }}>{j.segment_name}</div>}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: statusConf.bg, color: statusConf.color
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusConf.color }} />
                    {statusConf.label}
                  </span>
                </div>

                {/* Channel pills */}
                {channels.length > 0 && (
                  <div className="flex gap-1 flex-wrap mb-3">
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
                <div className="flex gap-4 text-secondary mb-2.5" style={{ fontSize: 12 }}>
                  <span className="flex items-center gap-1">
                    <Layers size={12} /> {j.node_count || 0} nodes
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={12} /> {fmt(j.total_entries)} entries
                  </span>
                </div>

                {/* Conversion progress bar */}
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-secondary" style={{ fontSize: 11 }}>Conversion</span>
                    <span className="font-semibold" style={{ fontSize: 11, color: convRate >= 10 ? 'var(--green)' : convRate > 0 ? 'var(--orange)' : 'var(--text-muted)' }}>
                      {pct(convRate)}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{
                      width: `${Math.min(convRate, 100)}%`,
                      background: convRate >= 10 ? 'var(--green)' : convRate > 0 ? 'var(--orange)' : 'var(--border-color)'
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
                        <div className="flex items-center gap-2">
                          <GitBranch size={14} color={statusConf.color} />
                          <span className="font-semibold">{j.name}</span>
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
                      <td className="text-secondary text-sm">{j.segment_name || '—'}</td>
                      <td>
                        <div className="flex gap-0.5">
                          {channels.slice(0, 3).map(ch => {
                            const conf = CHANNEL_CONFIG[ch] || {};
                            const Icon = conf.icon || MessageSquare;
                            return (
                              <span key={ch} title={conf.label || ch} className="inline-flex items-center justify-center" style={{
                                width: 24, height: 24, borderRadius: 6,
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
                      <td className="font-medium">{fmt(j.total_entries)}</td>
                      <td>
                        <span className="font-semibold" style={{ color: (j.conversion_rate || 0) >= 10 ? 'var(--green)' : 'var(--text-secondary)' }}>
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
            <h3 className="flex items-center gap-2">
              <Zap size={20} color="var(--red)" /> Generate Journey from Strategy
            </h3>
            <p className="text-secondary mb-5" style={{ fontSize: 13, lineHeight: 1.6 }}>
              Select a strategy to auto-generate a complete journey flow with entry triggers, channel-specific actions, wait steps, branching conditions, and conversion goals.
            </p>
            <div className="flex flex-col gap-2" style={{ maxHeight: 420, overflow: 'auto' }}>
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
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                      borderRadius: 10, transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  >
                    <div className="font-semibold mb-1" style={{ fontSize: 14 }}>{s.name}</div>
                    <div className="flex gap-2 items-center flex-wrap">
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
                      <div className="text-secondary" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                        {s.description.length > 120 ? s.description.slice(0, 120) + '...' : s.description}
                      </div>
                    )}
                  </div>
                );
              })}
              {strategies.length === 0 && (
                <div className="text-secondary" style={{ textAlign: 'center', padding: 40 }}>
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
            <h3 className="flex items-center gap-2">
              <Plus size={20} color="var(--red)" /> Create New Journey
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
      </motion.div>
    </motion.div>
  );
}
