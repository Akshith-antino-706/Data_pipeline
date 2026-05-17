'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getJourneys, getJourney, generateJourneyFromStrategy, enrollJourney,
  processJourney, getStrategies, aiFlowSuggest, getJourneyAnalytics,
  getJourneyCampaignAnalytics, createJourney, updateJourney, deleteJourney,
  getTemplates, getSegmentationTree, getSegmentCustomers,
  getCustomSegments, getCustomSegmentCustomers, startJourney, pauseJourney,
  previewTemplate as fetchTemplatePreview, getJourneyEntries,
  getJourneyQueueCounts, retryBlockedEntries
} from '@/lib/api';
import {
  GitBranch, Play, ArrowLeft, Users, Zap, Clock, Target, MessageSquare,
  ChevronRight, RefreshCw, AlertCircle, Plus, Search, BarChart3,
  Activity, Settings, Eye, Trash2, Edit3, Copy, CheckCircle2, XCircle,
  Send, Mail, Smartphone, Bell, Globe, MessageCircle,
  TrendingUp, Pause, MoreVertical, Layers, ArrowRight,
  ChevronDown, Sparkles, LayoutGrid, List, AlertTriangle
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import hotToast from 'react-hot-toast';

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

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
  const [, setProcessing] = useState(false);
  const [, setEnrolling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name } for list/card delete
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards');
  const [expandedNode, setExpandedNode] = useState(null);
  const [showActions, setShowActions] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [flowEditMode, setFlowEditMode] = useState(false);
  const [addNodeAfter, setAddNodeAfter] = useState(null); // insert position
  const [nodeForm, setNodeForm] = useState({ type: 'action', channel: 'email', label: '', message: '', waitDays: 1, goalType: 'booking', condition: 'booked', track: 'all', emailTemplateId: null, whatsappTemplateId: null, smsTemplateId: null, restChannel: 'email', restTemplateId: null });
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [nodeModalAfterIdx, setNodeModalAfterIdx] = useState(null);
  const [editNodeId, setEditNodeId] = useState(null);
  const [allTemplates, setAllTemplates] = useState({ email: [], whatsapp: [], sms: [] });
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [trackFilter] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState(null); // { name, subject, body_html, channel }
  // Journey entries (real flow data)
  const [journeyEntries, setJourneyEntries] = useState([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [entriesPage, setEntriesPage] = useState(1);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesStatusFilter, setEntriesStatusFilter] = useState('');
  const [queueStats, setQueueStats] = useState(null); // BullMQ live counts
  const [now, setNow] = useState(Date.now()); // ticks every second for wait-node countdown

  // Tracks the real live node (most entries are currently on) — set on journey open/start/process
  const [liveNodeId, setLiveNodeId] = useState(null);

  const selectedRef = useRef(selected); // always-fresh selected journey id for async callbacks
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Auto-poll journey detail every 30s when active — picks up node_statuses + journey completion
  useEffect(() => {
    if (detail?.status !== 'active') return;
    const t = setInterval(async () => {
      const id = selectedRef.current;
      if (!id) return;
      try {
        const d = await getJourney(id);
        setDetail(d.data);
      } catch { /* silent */ }
    }, 30_000);
    return () => clearInterval(t);
  }, [detail?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick every second so wait-node countdown timers stay live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Create journey form state ─────────────────────────────────
  const [createForm, setCreateForm] = useState({ name: '', description: '', segmentId: '', exitOnConversion: true, scheduledStartAt: '' });
  const [createNodes, setCreateNodes] = useState([]);
  const [showCreateNodeForm, setShowCreateNodeForm] = useState(false);
  const BLANK_CREATE_NODE = { label: 'Send Email', type: 'action', channel: 'email', waitDays: 1, condition: 'booked', goalType: 'booking', emailTemplateId: null, whatsappTemplateId: null, smsTemplateId: null, restChannel: 'email', restTemplateId: null, sendHour: null };
  const [createNodeForm, setCreateNodeForm] = useState({ ...BLANK_CREATE_NODE });
  const [allSegments, setAllSegments] = useState([]);
  const [segmentsLoaded, setSegmentsLoaded] = useState(false);
  const [segmentsLoading, setSegmentsLoading] = useState(false);

  // ── Dubai live clock (for scheduled-start input) ─────────────
  const [dubaiClock, setDubaiClock] = useState('');
  useEffect(() => {
    const tick = () => {
      const s = new Date().toLocaleString('en-GB', {
        timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        day: '2-digit', month: 'short', year: 'numeric',
      });
      setDubaiClock(s);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Returns current Dubai time as "YYYY-MM-DDTHH:mm" for datetime-local min
  const dubaiNowForInput = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t) => parts.find(p => p.type === t)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  };

  // ── Scheduled-start countdown ────────────────────────────────
  const [schedCountdown, setSchedCountdown] = useState(null); // null | { days, hours, mins, secs }
  const schedCountdownRef = useRef(null);

  useEffect(() => {
    clearInterval(schedCountdownRef.current);
    const iso = detail?.scheduled_start_at;
    if (!iso || detail?.status !== 'draft') { setSchedCountdown(null); return; }
    const target = new Date(iso);

    const fireAutoStart = () => {
      const id = selectedRef.current;
      if (!id) return;
      setStarting(true);
      startJourney(id)
        .then(async (res) => {
          hotToast.success(`Journey started! ${res.data?.enrolled || 0} users activated`);
          const d = await getJourney(id);
          setDetail(d.data);
          loadData();
        })
        .catch(err => hotToast.error(err.message || 'Auto-start failed'))
        .finally(() => setStarting(false));
    };

    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        clearInterval(schedCountdownRef.current);
        setSchedCountdown(null);
        fireAutoStart();
        return;
      }
      const total = Math.floor(diff / 1000);
      setSchedCountdown({
        days:  Math.floor(total / 86400),
        hours: Math.floor((total % 86400) / 3600),
        mins:  Math.floor((total % 3600) / 60),
        secs:  total % 60,
      });
    };
    tick();
    schedCountdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(schedCountdownRef.current);
  }, [detail?.scheduled_start_at, detail?.status]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Restore selected journey from URL on page load / refresh
  useEffect(() => {
    const idFromUrl = searchParams.get('id');
    if (idFromUrl && !selected) openJourney(parseInt(idFromUrl));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEntries = useCallback(async (journeyId, page = 1, status = '') => {
    setEntriesLoading(true);
    try {
      const params = { page, limit: 50 };
      if (status) params.status = status;
      const res = await getJourneyEntries(journeyId, params);
      setJourneyEntries(res.data || []);
      setEntriesTotal(res.total || 0);
      setEntriesPage(page);
    } catch { setJourneyEntries([]); }
    setEntriesLoading(false);
  }, []);

  // ── Journey Actions ───────────────────────────────────────────
  // Fetch active entries and find which node most entries are currently on
  const refreshLiveNode = useCallback(async (id, journeyNodes) => {
    try {
      const res = await getJourneyEntries(id, { status: 'active', limit: 200 });
      const entries = res.data || [];
      if (entries.length === 0) { setLiveNodeId(null); return; }
      // Tally current_node_id occurrences
      const tally = {};
      entries.forEach(e => { if (e.current_node_id) tally[e.current_node_id] = (tally[e.current_node_id] || 0) + 1; });
      // Pick node with highest count; break ties by node order in journey
      const nodeOrder = (journeyNodes || []).reduce((m, n, i) => { m[n.id] = i; return m; }, {});
      const winner = Object.entries(tally).sort((a, b) => b[1] - a[1] || (nodeOrder[a[0]] ?? 999) - (nodeOrder[b[0]] ?? 999))[0];
      setLiveNodeId(winner ? winner[0] : null);
    } catch { setLiveNodeId(null); }
  }, []);

  const openJourney = async (id) => {
    setSelected(id);
    router.replace(`${pathname}?id=${id}`, { scroll: false });
    setDetail(null);
    setAnalytics(null);
    setCampaignData(null);
    setSuggestions(null);
    setActiveTab('flow');
    setDetailLoading(true);
    setExpandedNode(null);
    setLiveNodeId(null);
    try {
      const [d, a, cd, qc] = await Promise.all([
        getJourney(id),
        getJourneyAnalytics(id).catch(() => ({ data: null })),
        getJourneyCampaignAnalytics(id).catch(() => ({ data: null })),
        getJourneyQueueCounts().catch(() => ({ data: null })),
      ]);
      setDetail(d.data);
      setAnalytics(a.data);
      setCampaignData(cd.data);
      setQueueStats(qc.data);
      loadTemplates(); // Load templates for preview buttons
      // Restore live node indicator if journey is active
      if (d.data?.status === 'active') refreshLiveNode(id, d.data?.nodes || []);
    } catch (err) { showToast('Failed to load journey', 'error'); }
    setDetailLoading(false);
  };

  const BLANK_NODE_FORM = { type: 'action', channel: 'email', label: '', message: '', waitDays: 1, goalType: 'booking', condition: 'booked', track: 'all', emailTemplateId: null, whatsappTemplateId: null, smsTemplateId: null, restChannel: 'email', restTemplateId: null, sendHour: null };

  const loadTemplates = async () => {
    if (templatesLoaded) return;
    try {
      const res = await getTemplates({ limit: 200 });
      const all = res.data || [];
      setAllTemplates({
        email:     all.filter(t => t.channel === 'email'),
        whatsapp:  all.filter(t => t.channel === 'whatsapp'),
        sms:       all.filter(t => t.channel === 'sms'),
      });
      setTemplatesLoaded(true);
    } catch { /* ignore */ }
  };

  // Find template for a given action node
  const getNodeTemplate = (node) => {
    if (!node?.data) return null;
    const ch = (node.data.channel || '').toLowerCase();
    const tplId = ch === 'email' ? node.data.emailTemplateId : ch === 'whatsapp' ? node.data.whatsappTemplateId : ch === 'sms' ? node.data.smsTemplateId : null;
    if (!tplId) return null;
    const list = allTemplates[ch] || [];
    return list.find(t => String(t.id) === String(tplId)) || null;
  };

  const openNodeModal = (afterIdx = null) => {
    setNodeModalAfterIdx(afterIdx);
    setEditNodeId(null);
    setNodeForm({ ...BLANK_NODE_FORM });
    setShowNodeModal(true);
    loadTemplates();
  };

  const openNodeEditModal = (node) => {
    const d = node.data || {};
    const ch = (d.channel || 'email').toLowerCase();
    setEditNodeId(node.id);
    setNodeForm({
      type: node.type || 'action',
      channel: ch,
      label: d.label || '',
      message: d.message || '',
      waitDays: d.waitDays || 1,
      goalType: d.goalType || 'booking',
      condition: d.condition || 'booked',
      track: d.track || 'all',
      sendHour: d.sendHour ?? null,
      emailTemplateId: ch === 'email' ? (d.templateId || d.emailTemplateId || null) : (d.emailTemplateId || null),
      whatsappTemplateId: ch === 'whatsapp' ? (d.templateId || d.whatsappTemplateId || null) : (d.whatsappTemplateId || null),
      smsTemplateId: ch === 'sms' ? (d.templateId || d.smsTemplateId || null) : (d.smsTemplateId || null),
      restChannel: d.restChannel || 'email',
      restTemplateId: d.restTemplateId || null,
    });
    setShowNodeModal(true);
    loadTemplates();
  };

  const handleSaveNodeEdit = () => {
    if (!editNodeId) return;
    const nodes = detail.nodes || [];
    const resolvedTemplateId =
      nodeForm.channel === 'email'    ? (nodeForm.emailTemplateId    || null) :
      nodeForm.channel === 'whatsapp' ? (nodeForm.whatsappTemplateId || null) :
      nodeForm.channel === 'sms'      ? (nodeForm.smsTemplateId      || null) : null;
    if (nodeForm.type === 'action' && !resolvedTemplateId) {
      return showToast('Template is required for action nodes', 'error');
    }
    const updated = nodes.map(n => {
      if (n.id !== editNodeId) return n;
      return {
        ...n, type: nodeForm.type,
        data: {
          label: nodeForm.label || n.data?.label || `${nodeForm.type} step`,
          track: nodeForm.track || 'all',
          ...(nodeForm.type === 'action' && {
            channel: nodeForm.channel,
            message: nodeForm.message,
            templateId: resolvedTemplateId,
            sendHour: nodeForm.sendHour ?? null,
            ...(nodeForm.channel === 'whatsapp' && { restChannel: nodeForm.restChannel || 'email', restTemplateId: nodeForm.restTemplateId || null }),
          }),
          ...(nodeForm.type === 'wait'      && { waitDays: nodeForm.waitDays }),
          ...(nodeForm.type === 'condition' && { condition: nodeForm.condition }),
          ...(nodeForm.type === 'goal'      && { goalType: nodeForm.goalType }),
        },
      };
    });
    saveNodeChanges(updated);
    setShowNodeModal(false);
    setEditNodeId(null);
    setNodeForm({ ...BLANK_NODE_FORM });
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

  const loadSegments = async () => {
    if (segmentsLoaded || segmentsLoading) return;
    setSegmentsLoading(true);
    try {
      const [res, customRes] = await Promise.all([
        getSegmentationTree(),
        getCustomSegments().catch(() => ({ data: [] }))
      ]);
      const STATUS_LABELS = { ON_TRIP: 'On Trip', FUTURE_TRAVEL: 'Future Travel', ACTIVE_ENQUIRY: 'Active Enquiry', PAST_BOOKING: 'Past Booking', PAST_ENQUIRY: 'Past Enquiry', PROSPECT: 'Prospect' };
      const breakdown = res?.breakdown || [];
      const statusCounts = res?.statusCounts || [];
      const flat = [];
      // Use statusCounts for top-level groups (guaranteed to exist)
      for (const s of statusCounts) {
        const st = s.booking_status;
        if (st) flat.push({ value: st, label: `${STATUS_LABELS[st] || st} (${Number(s.count || 0).toLocaleString()})`, group: 'standard' });
      }
      // Then breakdown rows with tier + geo
      for (const b of breakdown) {
        if (!b.booking_status) continue;
        const parts = [STATUS_LABELS[b.booking_status] || b.booking_status];
        if (b.product_tier) parts.push(b.product_tier === 'LUXURY' ? 'Luxury' : 'Standard');
        if (b.geography) parts.push(b.geography === 'LOCAL' ? 'Local' : 'International');
        if (parts.length > 1) {
          flat.push({ value: `${b.booking_status}|${b.product_tier || ''}|${b.geography || ''}`, label: `${parts.join(' · ')} (${Number(b.count || 0).toLocaleString()})`, group: 'standard' });
        }
      }
      // Add custom segments
      const customSegs = customRes?.data || [];
      for (const cs of customSegs) {
        flat.push({ value: `custom:${cs.id}`, label: `${cs.name} (${Number(cs.cached_count || 0).toLocaleString()})`, group: 'custom' });
      }
      setAllSegments(flat);
      setSegmentsLoaded(true);
    } catch (err) { console.error('Failed to load segments', err); }
    setSegmentsLoading(false);
  };

  // Load segments + pre-fill date with current Dubai time whenever the create modal opens
  useEffect(() => {
    if (showCreate) {
      loadSegments();
      setCreateForm(f => ({ ...f, scheduledStartAt: dubaiNowForInput() }));
    }
  }, [showCreate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!createForm.name.trim()) return showToast('Journey name is required', 'error');
    if (!createForm.segmentId) return showToast('Segment is required', 'error');
    setShowCreate(false);
    try {
      const trigger = {
        id: 'node_0', type: 'trigger',
        data: { triggerType: 'segment_entry', label: 'Entry Point', segmentId: createForm.segmentId || null },
        position: { x: 300, y: 50 }
      };
      const extraNodes = createNodes.map((n, i) => ({
        id: `node_${i + 1}`, type: n.type,
        data: {
          label: n.label, channel: n.channel || undefined,
          waitDays: n.waitDays || undefined, condition: n.condition || undefined,
          goalType: n.goalType || undefined,
          sendHour: n.sendHour ?? undefined,
          emailTemplateId: n.emailTemplateId || undefined,
          whatsappTemplateId: n.whatsappTemplateId || undefined,
          smsTemplateId: n.smsTemplateId || undefined,
          restChannel: n.restChannel || undefined,
          restTemplateId: n.restTemplateId || undefined,
        },
        position: { x: 300, y: 50 + (i + 1) * 120 }
      }));
      const res = await createJourney({
        name: createForm.name,
        description: createForm.description,
        segmentId: createForm.segmentId || null,
        exitOnConversion: createForm.exitOnConversion,
        // Treat the input value as Dubai time (UTC+4) → convert to UTC ISO for the backend
        scheduledStartAt: createForm.scheduledStartAt
          ? new Date(createForm.scheduledStartAt + ':00+04:00').toISOString()
          : null,
        nodes: [trigger, ...extraNodes],
        edges: [trigger, ...extraNodes].slice(1).map((n, i) => ({
          id: `e_${[trigger, ...extraNodes][i].id}_${n.id}`,
          source: [trigger, ...extraNodes][i].id,
          target: n.id,
        }))
      });
      const snapCount = res.data?.snapshot_count || 0;
      showToast(`Journey "${res.data?.name}" created — ${snapCount} users snapshotted`, 'success');
      setCreateForm({ name: '', description: '', segmentId: '', exitOnConversion: true, scheduledStartAt: '' });
      setCreateNodes([]);
      setShowCreateNodeForm(false);
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

  const refreshQueueStats = async () => {
    try {
      const qc = await getJourneyQueueCounts();
      setQueueStats(qc.data);
    } catch { /* ignore */ }
  };

  const handleProcess = async () => {
    setConfirmAction(null);
    setProcessing(true);
    try {
      const res = await processJourney(selected);
      showToast(`Processed: ${res.data?.processed || 0} entries advanced`, 'success');
      const [d] = await Promise.all([getJourney(selected), refreshQueueStats()]);
      setDetail(d.data);
      if (d.data?.status === 'active') refreshLiveNode(selected, d.data?.nodes || []);
    } catch (err) { showToast(err.message, 'error'); }
    setProcessing(false);
  };

  const handleStart = async () => {
    setConfirmAction(null);
    setStarting(true);
    try {
      const res = await startJourney(selected);
      hotToast.success(`Journey started! ${res.data?.enrolled || 0} users activated`);
      const [d] = await Promise.all([getJourney(selected), refreshQueueStats(), loadData()]);
      setDetail(d.data);
    } catch (err) { hotToast.error(err.message || 'Failed to start journey'); }
    setStarting(false);
  };

  const handlePause = async () => {
    try {
      const res = await pauseJourney(selected);
      hotToast.success(`Journey ${res.data?.status === 'paused' ? 'paused' : 'resumed'}`);
      const d = await getJourney(selected);
      setDetail(d.data);
      await loadData();
    } catch (err) { hotToast.error(err.message || 'Failed to update journey'); }
  };

  const handleDelete = async (id) => {
    setConfirmAction(null);
    try {
      await deleteJourney(id);
      showToast('Journey deleted', 'success');
      setSelected(null);
      setDetail(null);
      router.replace(pathname, { scroll: false });
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
    // Resolve template ID for the active channel
    const resolvedTemplateId =
      nodeForm.channel === 'email'     ? (nodeForm.emailTemplateId     || null) :
      nodeForm.channel === 'whatsapp'  ? (nodeForm.whatsappTemplateId  || null) :
      nodeForm.channel === 'sms'       ? (nodeForm.smsTemplateId       || null) : null;

    // Validation
    if (nodeForm.type === 'action' && !resolvedTemplateId) {
      return showToast(`Email template is required for action nodes`, 'error');
    }
    const newNode = {
      id: newId,
      type: nodeForm.type,
      data: {
        label: nodeForm.label || `New ${nodeForm.type} step`,
        track: nodeForm.track || (trackFilter !== 'all' ? trackFilter : 'all'),
        ...(nodeForm.type === 'action' && {
          channel: nodeForm.channel,
          message: nodeForm.message,
          templateId: resolvedTemplateId,
          sendHour: nodeForm.sendHour ?? null,
          ...(nodeForm.channel === 'whatsapp' && {
            restChannel: nodeForm.restChannel || 'email',
            restTemplateId: nodeForm.restTemplateId || null,
          }),
        }),
        ...(nodeForm.type === 'wait'      && { waitDays:  nodeForm.waitDays }),
        ...(nodeForm.type === 'condition' && { condition: nodeForm.condition }),
        ...(nodeForm.type === 'goal'      && { goalType:  nodeForm.goalType }),
      },
      position: { x: 300, y: (afterIndex + 1) * 160 },
    };
    const updated = [...nodes.slice(0, afterIndex + 1), newNode, ...nodes.slice(afterIndex + 1)];
    saveNodeChanges(updated);
    setAddNodeAfter(null);
    setShowNodeModal(false);
    setNodeForm({ ...BLANK_NODE_FORM });
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
    // Per-node triggered/exited counts
    const nodeEntryCountsMap = {};
    (detail.nodeEntryCounts || []).forEach(nc => {
      nodeEntryCountsMap[nc.node_id] = { triggered: parseInt(nc.triggered) || 0, exited: parseInt(nc.exited) || 0 };
    });

    const isJourneyStarted = ['active', 'paused', 'completed'].includes(detail.status);

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
          total: parseInt(matched.target_count) || parseInt(campaignData?.target_count) || parseInt(detail.total_entries) || 0,
          target: parseInt(matched.target_count) || parseInt(campaignData?.target_count) || parseInt(detail.total_entries) || 0,
          sent: parseInt(matched.sent_count) || 0,
          delivered: parseInt(matched.delivered_count) || 0,
          read: parseInt(matched.read_count) || 0,
          clicked: parseInt(matched.click_count) || 0,
          bounced: parseInt(matched.bounce_count) || 0,
          failed: parseInt(matched.fail_count) || 0,
          startedAt: matched.started_at || null,
          completedAt: matched.completed_at || null,
          template_body: matched.template_body || null,
          campaign_name: matched.name,
          delivery_rate: matched.delivery_rate,
          open_rate: matched.open_rate,
          click_rate: matched.click_rate,
        };
      }
    });

    // Build per-node fire-time map for wait countdown timers
    const nodeFireTimesMap = {};
    (analytics?.nodeFireTimes || []).forEach(ft => {
      nodeFireTimesMap[ft.current_node_id] = {
        earliestFireAt: ft.earliest_fire_at ? new Date(ft.earliest_fire_at).getTime() : null,
        latestFireAt:   ft.latest_fire_at   ? new Date(ft.latest_fire_at).getTime()   : null,
        activeCount:    parseInt(ft.active_count) || 0,
      };
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
      { name: 'Snapshotted', value: parseInt(stats.total_entries) || 0, color: 'var(--yellow)' },
      { name: 'Active', value: parseInt(stats.active) || 0, color: 'var(--green)' },
      { name: 'Completed', value: parseInt(stats.completed) || 0, color: 'var(--brand-primary)' },
      { name: 'Booked', value: parseInt(stats.exited_booked) || 0, color: 'var(--purple)' },
      { name: 'Unsubscribed', value: parseInt(stats.exited_unsubscribed) || 0, color: 'var(--red)' },
    ].filter(d => d.value > 0);

    return (
      <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
        <style>{`
          @keyframes simPulse {
            0%, 100% { box-shadow: 0 0 0 3px rgba(0,0,0,0.12), 0 6px 20px rgba(0,0,0,0.15); }
            50%       { box-shadow: 0 0 0 6px rgba(0,0,0,0.06), 0 8px 28px rgba(0,0,0,0.25); }
          }
          @keyframes simDot {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.3; }
          }
        `}</style>
        {/* ── Back + Header ─────────────────────────────────────── */}
        <motion.div variants={fadeInUp}>
        <button className="btn btn-ghost mb-4" onClick={() => { setSelected(null); setDetail(null); setEditMode(false); router.replace(pathname, { scroll: false }); }}>
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
            {detail.status === 'draft' && (
              <button className="btn btn-primary" onClick={() => setConfirmAction('start')} disabled={starting}>
                <Play size={14} /> {starting ? 'Starting...' : 'Start Journey'}
              </button>
            )}
            {detail.status === 'active' && (
              <button className="btn btn-secondary" onClick={handlePause}>
                <Pause size={14} /> Pause
              </button>
            )}
            {detail.status === 'paused' && (
              <button className="btn btn-primary" onClick={handlePause}>
                <Play size={14} /> Resume
              </button>
            )}
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
        {(() => {
          const ct = campaignData?.totals || {};
          const kpis = [
            { label: 'Snapshotted', value: fmt(detail.snapshot_count || stats.total_entries), color: 'kpi-blue', icon: Users },
            { label: 'Active', value: fmt(stats.active), color: 'kpi-green', icon: Activity },
            { label: 'Sent', value: fmt(ct.total_sent || 0), color: 'kpi-orange', icon: Send },
            { label: 'Delivered', value: fmt(ct.total_delivered || 0), color: 'kpi-green', icon: CheckCircle2 },
            { label: 'Booked (Exit)', value: fmt(stats.exited_booked), color: 'kpi-purple', icon: Target },
            { label: 'Unsub (Exit)', value: fmt(stats.exited_unsubscribed), color: 'kpi-red', icon: XCircle },
            { label: 'Completed', value: fmt(stats.completed), color: 'kpi-blue', icon: CheckCircle2 },
            { label: 'Failed', value: fmt(ct.total_failed || 0), color: 'kpi-red', icon: XCircle },
          ];
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
              {kpis.map((kpi, i) => (
                <div key={i} className="card" style={{ padding: '16px 14px' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600, marginBottom: 3 }}>{kpi.label}</div>
                      <div className={`kpi-value ${kpi.color}`} style={{ fontSize: 22 }}>{kpi.value}</div>
                    </div>
                    <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-secondary)' }}>
                      <kpi.icon size={16} color="var(--text-secondary)" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Scheduled Start Countdown ────────────────────────── */}
        {schedCountdown && detail?.scheduled_start_at && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            padding: '14px 20px', marginBottom: 20, borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(255,153,51,0.08) 0%, rgba(234,179,8,0.08) 100%)',
            border: '1px solid rgba(255,153,51,0.35)',
          }}>
            <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
              <Clock size={16} color="var(--orange)" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}>Auto-starts in</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                ({new Date(detail.scheduled_start_at).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })} Dubai)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {[
                { v: schedCountdown.days,  l: 'D' },
                { v: schedCountdown.hours, l: 'H' },
                { v: schedCountdown.mins,  l: 'M' },
                { v: schedCountdown.secs,  l: 'S' },
              ].map(({ v, l }) => (
                <div key={l} style={{ textAlign: 'center', minWidth: 44 }}>
                  <div style={{
                    fontSize: 22, fontWeight: 800, color: 'var(--orange)',
                    background: 'var(--orange-dim)', borderRadius: 8,
                    padding: '4px 8px', lineHeight: 1, border: '1px solid rgba(255,153,51,0.3)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {String(v).padStart(2, '0')}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', marginTop: 3, letterSpacing: '0.5px' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tabs ──────────────────────────────────────────────── */}
        <div className="tabs mb-5">
          {[
            { id: 'flow', label: 'Journey Flow', icon: GitBranch },
            { id: 'entries', label: 'Entries', icon: Users },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'settings', label: 'Settings', icon: Settings },
          ].map(tab => (
            <button
              key={tab.id}
              className={`tab flex items-center gap-1.5 ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(tab.id); if (tab.id === 'entries' && journeyEntries.length === 0) loadEntries(selected, 1, ''); }}
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
                  {!isJourneyStarted && (
                    <>
                      <button
                        onClick={() => openNodeModal(detail?.nodes?.length ? detail.nodes.length - 1 : 0)}
                        className="btn btn-sm btn-secondary"
                        style={{ fontSize: 11, padding: '4px 12px' }}
                      >
                        <Plus size={11} /> Add Node
                      </button>
                      <button
                        onClick={() => setFlowEditMode(!flowEditMode)}
                        className={`btn btn-sm ${flowEditMode ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ fontSize: 11, padding: '4px 12px' }}
                      >
                        {flowEditMode ? 'Done Editing' : 'Edit Flow'}
                      </button>
                    </>
                  )}
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
                    {/* Column headers */}
                    <div style={{ gridColumn: 'span 2', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,153,51,0.08)', border: '1px solid rgba(255,153,51,0.3)', fontWeight: 600, fontSize: 12, color: '#FF9933', textAlign: 'center' }}>
                        🇮🇳 Indian Track — WhatsApp + Email + SMS
                      </div>
                      <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', fontWeight: 600, fontSize: 12, color: '#3B82F6', textAlign: 'center' }}>
                        🌍 Rest of World — Email + SMS
                      </div>
                    </div>

                    {nodes.map((node, i) => {
                      const Icon = NODE_ICONS[node.type] || Target;
                      const channelConf = node.data?.channel ? CHANNEL_CONFIG[node.data.channel.toLowerCase()] : null;
                      const nodeStats = nodeAnalyticsMap[node.id] || {};
                      const hasSent = nodeStats.action_sent > 0;
                      const nStats = detail?.node_stats?.[node.id];
                      // Draft → all nodes grey. Any started status → all nodes coloured & clickable.
                      const isNodeActive = isJourneyStarted;

                      // Node lifecycle status — sourced from backend node_statuses (persists across refresh)
                      const backendStatus = detail?.node_statuses?.[node.id]; // 'pending'|'running'|'completed'
                      const nodeLifecycle = isJourneyStarted && detail?.status !== 'draft'
                        ? (backendStatus || 'pending').toUpperCase()
                        : null;

                      // Highlight: use backend node_statuses
                      const isCurrentSimNode = (backendStatus === 'running');
                      const color = isNodeActive
                        ? (NODE_COLORS[node.type] || 'var(--text-tertiary)')
                        : '#9ca3af';

                      // ── Track-aware grid placement ──
                      // Trigger spans both columns (single shared entry).
                      // Indian-only → col 1; Rest-only → col 2.
                      // Untagged (track='all') action/wait/condition/goal: DUPLICATE into BOTH columns
                      //   so users visually see parallel tracks (same message fires for both audiences).
                      // WhatsApp rule: Indian column always WhatsApp; Rest column auto-pairs to Email
                      //   (or node.data.restChannel if configured) so Rest users don't skip the step.
                      const nodeTrack = node.data?.track || 'all';
                      const isTriggerSpan = node.type === 'trigger';
                      const isWhatsApp = (node.data?.channel || '').toLowerCase() === 'whatsapp';
                      const isDualShared = !isTriggerSpan && nodeTrack === 'all';
                      const restChannel = (node.data?.restChannel || 'email').toLowerCase();

                      // Build the list of (column, label) mirror renders this node needs
                      const renders = isTriggerSpan
                        ? [{ gc: '1 / span 2', badge: null, centered: true, key: node.id }]
                        : isWhatsApp
                          // WhatsApp: Indian column shows WhatsApp, Rest column shows auto-pair (Email/SMS)
                          ? [
                              { gc: '1', badge: '🇮🇳 IN · WhatsApp', accent: '#25D366', key: node.id },
                              { gc: '2', badge: `🌍 ROW · auto ${restChannel}`, accent: '#3B82F6', key: node.id + '_row', channelOverride: restChannel, restPair: true },
                            ]
                          : isDualShared
                            ? [
                                { gc: '1', badge: '🇮🇳 IN',  accent: '#FF9933', key: node.id + '_in'  },
                                { gc: '2', badge: '🌍 ROW', accent: '#3B82F6', key: node.id + '_row' },
                              ]
                            : [{ gc: nodeTrack === 'indian' ? '1' : '2', badge: nodeTrack === 'indian' ? '🇮🇳 IN' : '🌍 ROW', accent: nodeTrack === 'indian' ? '#FF9933' : '#3B82F6', key: node.id }];

                      return renders.map(({ gc, badge, accent, centered, key, channelOverride, restPair }) => {
                        const isExpanded = expandedNode === key;
                        return (
                        <div key={key} style={{ gridColumn: gc, width: '100%', maxWidth: centered ? 520 : '100%', justifySelf: centered ? 'center' : 'stretch', position: 'relative' }}>
                          {/* Track label on each non-trigger node */}
                          {badge && (
                            <div style={{ position: 'absolute', top: -6, left: 10, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '1px 6px', borderRadius: 3, background: accent, color: 'white', zIndex: 1 }}>
                              {badge}
                            </div>
                          )}
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
                                    {/* Track picker — which column this node belongs to */}
                                    <div className="flex gap-1.5 mb-2">
                                      {[
                                        { v: 'all',    label: 'Shared', c: 'var(--text-muted)' },
                                        { v: 'indian', label: '🇮🇳 Indian',  c: '#FF9933' },
                                        { v: 'rest',   label: '🌍 Rest',    c: '#3B82F6' },
                                      ].map(t => (
                                        <button key={t.v} onClick={() => setNodeForm(f => ({...f, track: t.v}))}
                                          style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                                            border: (nodeForm.track || 'all') === t.v ? `2px solid ${t.c}` : '1px solid var(--border-color)',
                                            background: (nodeForm.track || 'all') === t.v ? t.c + '15' : 'var(--bg-secondary)', color: t.c }}>
                                          {t.label}
                                        </button>
                                      ))}
                                    </div>
                                    {nodeForm.type === 'action' && (
                                      <>
                                        <div className="flex gap-1.5 mb-2">
                                          {['email', 'whatsapp', 'sms', 'push']
                                            .filter(ch => ch !== 'whatsapp' || (nodeForm.track || 'all') !== 'rest')
                                            .map(ch => (
                                              <button key={ch} onClick={() => setNodeForm(f => ({...f, channel: ch}))}
                                                style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                                                  border: nodeForm.channel === ch ? '2px solid var(--red)' : '1px solid var(--border-color)',
                                                  background: nodeForm.channel === ch ? 'var(--red)' + '15' : 'var(--bg-secondary)', textTransform: 'capitalize' }}>
                                                {ch}
                                              </button>
                                            ))}
                                        </div>
                                        {/* When channel is WhatsApp, let user pick the Rest auto-pair channel (Email or SMS). */}
                                        {nodeForm.channel === 'whatsapp' && (
                                          <div style={{ padding: '6px 8px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, marginBottom: 8 }}>
                                            <div style={{ fontSize: 10, color: '#3B82F6', fontWeight: 600, marginBottom: 4 }}>
                                              🌍 Rest-of-World auto-pair:
                                            </div>
                                            <div className="flex gap-1.5">
                                              {['email', 'sms'].map(ch => (
                                                <button key={ch} onClick={() => setNodeForm(f => ({...f, restChannel: ch}))}
                                                  style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                                                    border: (nodeForm.restChannel || 'email') === ch ? '2px solid #3B82F6' : '1px solid var(--border-color)',
                                                    background: (nodeForm.restChannel || 'email') === ch ? 'rgba(59,130,246,0.15)' : 'var(--bg-secondary)', textTransform: 'capitalize' }}>
                                                  {ch}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </>
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
                                  <button onClick={() => openNodeModal(i - 1)}
                                    className="flex items-center justify-center"
                                    style={{ width: 22, height: 22, borderRadius: '50%', border: '2px dashed var(--red)', background: 'var(--bg-card)', color: 'var(--red)',
                                      cursor: 'pointer', fontSize: 14, fontWeight: 700, margin: '2px 0' }}>
                                    +
                                  </button>
                                )
                              ) : isJourneyStarted ? (
                                <div style={{ width: 2, height: 28, background: `linear-gradient(to bottom, ${NODE_COLORS[nodes[i-1]?.type] || '#e7e5e4'}40, ${color}40)` }} />
                              ) : (
                                <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', height: 28 }}>
                                  <div style={{ width: 2, height: '100%', background: `linear-gradient(to bottom, ${NODE_COLORS[nodes[i-1]?.type] || '#e7e5e4'}40, ${color}40)` }} />
                                  <button
                                    onClick={e => { e.stopPropagation(); openNodeModal(i - 1); }}
                                    title="Add node here"
                                    style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: `1.5px dashed ${color}`, background: 'var(--bg-card)', color, cursor: 'pointer', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, opacity: 0.7, transition: 'opacity 0.15s', zIndex: 1 }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                    onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
                                  >+</button>
                                </div>
                              )}
                              <div style={{ width: 2, height: 4, background: color + '40' }} />
                            </div>
                          )}

                          {/* Node Card */}
                          <div
                            onClick={() => setExpandedNode(isExpanded ? null : key)}
                            style={{
                              background: isCurrentSimNode ? color + '08' : 'var(--bg-card)',
                              borderTop: `1px solid ${isCurrentSimNode || isExpanded ? color + '60' : 'var(--border-color)'}`,
                              borderRight: `1px solid ${isCurrentSimNode || isExpanded ? color + '60' : 'var(--border-color)'}`,
                              borderBottom: `1px solid ${isCurrentSimNode || isExpanded ? color + '60' : 'var(--border-color)'}`,
                              borderLeft: `4px solid ${color}`,
                              borderRadius: 12,
                              padding: '14px 16px',
                              cursor: 'pointer',
                              transition: 'all 0.3s ease',
                              boxShadow: isCurrentSimNode
                                ? `0 0 0 3px ${color}40, 0 6px 20px ${color}30`
                                : isExpanded ? `0 4px 16px ${color}15` : 'var(--shadow)',
                              animation: isCurrentSimNode ? 'simPulse 1.5s ease-in-out infinite' : 'none',
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
                                  {nodeLifecycle && (() => {
                                    const lcConfig = {
                                      PENDING:   { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af', dot: null },
                                      RUNNING:   { bg: color + '20',             color,            dot: true  },
                                      COMPLETED: { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e', dot: null  },
                                    }[nodeLifecycle];
                                    return (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 800, background: lcConfig.bg, color: lcConfig.color, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                                        {lcConfig.dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: lcConfig.color, display: 'inline-block', animation: 'simDot 1s ease-in-out infinite' }} />}
                                        {nodeLifecycle === 'COMPLETED' && '✓ '}{nodeLifecycle}
                                      </span>
                                    );
                                  })()}
                                  {(() => {
                                    // Rest-pair duplicate for WhatsApp nodes: override the channel chip so
                                    // the Rest column visually shows Email/SMS instead of WhatsApp.
                                    const effChannel = channelOverride || node.data?.channel;
                                    const effConf = effChannel ? CHANNEL_CONFIG[effChannel.toLowerCase()] : null;
                                    const EffIcon = effConf?.icon;
                                    return effConf ? (
                                      <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                        padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                                        background: effConf.color + '12', color: effConf.color
                                      }}>
                                        <EffIcon size={10} /> {effConf.label}
                                        {restPair && <span style={{ opacity: 0.7, marginLeft: 2 }}>(auto-pair)</span>}
                                      </span>
                                    ) : null;
                                  })()}
                                  {node.data?.timing && (
                                    <span className="flex items-center gap-0.5" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      <Clock size={10} /> {node.data.timing}
                                    </span>
                                  )}
                                </div>
                                {node.data?.label && (
                                  <div className="font-medium" style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 4 }}>{node.data.label}</div>
                                )}
                                {/* Show mapped template name on action nodes */}
                                {node.type === 'action' && (() => {
                                  const tpl = getNodeTemplate(node);
                                  return tpl ? (
                                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Mail size={9} /> {tpl.name}{tpl.subject ? ` — ${tpl.subject}` : ''}
                                    </div>
                                  ) : null;
                                })()}
                              </div>

                              {/* Node stats preview — user counts + sent */}
                              {(hasSent || nStats) && (
                                <div className="flex items-center gap-3 shrink-0">
                                  {nStats && (
                                    <div className="flex gap-2" style={{ fontSize: 10 }}>
                                      {nStats.active > 0 && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', borderRadius: 8, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontWeight: 700 }}>
                                          {fmt(nStats.active)} active
                                        </span>
                                      )}
                                      {nStats.exited_booked > 0 && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontWeight: 700 }}>
                                          {fmt(nStats.exited_booked)} booked
                                        </span>
                                      )}
                                      {nStats.exited_unsubscribed > 0 && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 700 }}>
                                          {fmt(nStats.exited_unsubscribed)} unsub
                                        </span>
                                      )}
                                      {nStats.completed > 0 && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', borderRadius: 8, background: 'rgba(156,163,175,0.1)', color: '#9ca3af', fontWeight: 700 }}>
                                          {fmt(nStats.completed)} done
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {hasSent && (
                                    <div className="text-right shrink-0">
                                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(nodeStats.action_sent)}</div>
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>sent</div>
                                    </div>
                                  )}
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
                                  <button onClick={() => openNodeEditModal(node)} title="Edit node"
                                    className="flex items-center justify-center"
                                    style={{ width: 24, height: 24, border: '1px solid var(--brand-primary)', borderRadius: 6, background: 'rgba(59,130,246,0.08)', color: 'var(--brand-primary)', cursor: 'pointer' }}>
                                    <Edit3 size={11} />
                                  </button>
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
                                {node.data?.waitDays && (() => {
                                  const waitDays    = node.data.waitDays;
                                  const ft          = nodeFireTimesMap[node.id];
                                  const fireAt      = ft?.earliestFireAt   || null;
                                  const enqueuedAt  = ft?.earliestEnqueued || null;
                                  const activeCount = ft?.activeCount       || 0;

                                  // Remaining time — ticks every second via `now`
                                  const remainingMs  = fireAt ? Math.max(0, fireAt - now) : null;
                                  const remainingSec = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;
                                  const isDue        = remainingMs === 0;

                                  // Progress using real worker enqueue→fire span
                                  const totalMs   = (fireAt && enqueuedAt) ? Math.max(1, fireAt - enqueuedAt) : null;
                                  const elapsedMs = enqueuedAt ? Math.max(0, now - enqueuedAt) : null;
                                  const pct       = (totalMs && elapsedMs !== null)
                                    ? Math.min(100, Math.max(0, Math.round(elapsedMs / totalMs * 100)))
                                    : null;

                                  // Digital clock segments — zero-padded
                                  const pad = (n) => String(n).padStart(2, '0');
                                  const buildClock = (sec) => {
                                    if (sec <= 0) return null;
                                    const d  = Math.floor(sec / 86400);
                                    const h  = Math.floor((sec % 86400) / 3600);
                                    const m  = Math.floor((sec % 3600) / 60);
                                    const s  = sec % 60;
                                    if (d > 0)  return { parts: [{ v: pad(d), u: 'd' }, { v: pad(h), u: 'h' }, { v: pad(m), u: 'm' }], color: 'var(--text-secondary)' };
                                    if (h > 0)  return { parts: [{ v: pad(h), u: 'h' }, { v: pad(m), u: 'm' }, { v: pad(s), u: 's' }], color: '#f59e0b' };
                                    if (m > 0)  return { parts: [{ v: pad(m), u: 'm' }, { v: pad(s), u: 's' }], color: '#eab308' };
                                    return       { parts: [{ v: pad(s), u: 's' }], color: '#22c55e' };
                                  };
                                  const clock = isDue ? null : buildClock(remainingSec);

                                  return (
                                    <div style={{ marginTop: 4 }}>
                                      <div className="flex items-center gap-2" style={{ padding: '4px 0 10px' }}>
                                        <Clock size={14} color={color} />
                                        <span className="text-secondary text-sm">
                                          Wait <strong>{waitDays} day{waitDays !== 1 ? 's' : ''}</strong> before proceeding
                                        </span>
                                      </div>

                                      {remainingSec !== null ? (
                                        <div style={{ borderRadius: 12, border: `1px solid ${isDue ? 'rgba(34,197,94,0.35)' : 'rgba(234,179,8,0.3)'}`, background: isDue ? 'rgba(34,197,94,0.07)' : 'rgba(234,179,8,0.05)', overflow: 'hidden' }}>

                                          {/* Header */}
                                          <div className="flex items-center justify-between" style={{ padding: '10px 14px 6px' }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                                              {isDue ? '✓ Ready to advance' : 'Time remaining'}
                                            </span>
                                            {activeCount > 0 && (
                                              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                {activeCount} entries waiting
                                              </span>
                                            )}
                                          </div>

                                          {/* Digital countdown clock */}
                                          <div className="flex items-end justify-center gap-1" style={{ padding: isDue ? '6px 14px 10px' : '4px 14px 10px' }}>
                                            {isDue ? (
                                              <span style={{ fontSize: 30, fontWeight: 900, color: '#22c55e', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                                                ✓ Due Now
                                              </span>
                                            ) : clock?.parts.map((p, i) => (
                                              <div key={i} className="flex items-end gap-1">
                                                {i > 0 && <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(120,113,108,0.4)', marginBottom: 6, lineHeight: 1 }}>:</span>}
                                                <div style={{ textAlign: 'center' }}>
                                                  <div style={{
                                                    fontSize: 36, fontWeight: 900, color: clock.color,
                                                    fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em',
                                                    lineHeight: 1, minWidth: 52, textAlign: 'center',
                                                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                                                    transition: 'color 0.3s ease',
                                                  }}>
                                                    {p.v}
                                                  </div>
                                                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
                                                    {p.u === 'd' ? 'days' : p.u === 'h' ? 'hours' : p.u === 'm' ? 'mins' : 'secs'}
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>

                                          {/* Progress bar */}
                                          <div style={{ position: 'relative', height: 5, background: 'rgba(120,113,108,0.12)', margin: '0 0 0 0' }}>
                                            <div style={{
                                              position: 'absolute', left: 0, top: 0, height: '100%',
                                              width: `${pct ?? (isDue ? 100 : 0)}%`,
                                              background: isDue ? '#22c55e' : 'linear-gradient(90deg,#ca8a04,#eab308)',
                                              transition: 'width 1s linear',
                                            }} />
                                          </div>

                                          {/* Footer row */}
                                          <div className="flex gap-4 flex-wrap" style={{ padding: '7px 14px 10px' }}>
                                            {enqueuedAt && (
                                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                                Entered: <strong style={{ color: 'var(--text-secondary)' }}>{new Date(enqueuedAt).toLocaleTimeString()}</strong>
                                              </span>
                                            )}
                                            {fireAt && (
                                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                                Fires at: <strong style={{ color: 'var(--text-secondary)' }}>{new Date(fireAt).toLocaleTimeString()}</strong>
                                              </span>
                                            )}
                                            {pct !== null && (
                                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                                <strong style={{ color: clock?.color || '#22c55e' }}>{pct}%</strong> elapsed
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(120,113,108,0.06)', border: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-tertiary)' }}>
                                          Waiting for entries — refreshes every 10s
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
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

                                {/* Triggered / Exited counts */}
                                {(() => {
                                  const nc = nodeEntryCountsMap[node.id];
                                  if (!nc || (nc.triggered === 0 && nc.exited === 0)) return null;
                                  return (
                                    <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                                        <Users size={13} color="#3B82F6" />
                                        <span style={{ fontSize: 15, fontWeight: 700, color: '#3B82F6' }}>{fmt(nc.triggered)}</span>
                                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>TRIGGERED</span>
                                      </div>
                                      {nc.exited > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                                          <XCircle size={13} color="var(--red)" />
                                          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--red)' }}>{fmt(nc.exited)}</span>
                                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>EXITED</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* Campaign Metrics Card — per node */}
                                {node.type === 'action' && (() => {
                                  const camp = nodeCampaignMap?.[node.id];
                                  const target    = camp?.target    || parseInt(detail?.total_entries) || 0;
                                  const sent      = camp?.sent      || parseInt(nodeStats?.action_sent)      || 0;
                                  const delivered = camp?.delivered  || parseInt(nodeStats?.action_delivered) || 0;
                                  const read      = camp?.read       || parseInt(nodeStats?.action_read)      || 0;
                                  const clicked   = camp?.clicked    || parseInt(nodeStats?.action_clicked)   || 0;
                                  const bounced   = camp?.bounced    || parseInt(nodeStats?.action_bounced)   || 0;
                                  const failed    = camp?.failed     || parseInt(nodeStats?.action_failed)    || 0;
                                  const blocked   = parseInt(nodeStats?.action_blocked) || 0;
                                  // BullMQ live queue depth for this channel
                                  const ch = (node.data?.channel || '').toLowerCase();
                                  const liveQ = queueStats?.[ch === 'whatsapp' ? 'whatsapp' : ch] || null;
                                  const qWaiting = (liveQ?.waiting || 0) + (liveQ?.active || 0) + (liveQ?.delayed || 0);
                                  // Node config check
                                  const nodeChannel = node.data?.channel || '';
                                  const nodeTemplateId = node.data?.templateId || node.data?.emailTemplateId || node.data?.whatsappTemplateId || node.data?.smsTemplateId;
                                  const missingConfig = !nodeChannel || !nodeTemplateId;
                                  return (
                                    <div className="mt-3">
                                      {/* Node config strip — shows channel + templateId, red if missing */}
                                      <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: missingConfig ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)', border: `1px solid ${missingConfig ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.15)'}`, fontSize: 11, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ color: 'var(--text-tertiary)' }}>Channel: <strong style={{ color: nodeChannel ? 'var(--text-primary)' : 'var(--red)' }}>{nodeChannel || '⚠ not set'}</strong></span>
                                        <span style={{ color: 'var(--text-tertiary)' }}>Template ID: <strong style={{ color: nodeTemplateId ? 'var(--text-primary)' : 'var(--red)' }}>{nodeTemplateId || '⚠ not set'}</strong></span>
                                        {missingConfig && (
                                          <button onClick={e => { e.stopPropagation(); openNodeEditModal(node); }}
                                            style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--red)', background: 'rgba(239,68,68,0.08)', color: 'var(--red)' }}>
                                            Fix Node →
                                          </button>
                                        )}
                                      </div>

                                      {/* BullMQ live queue strip */}
                                      {liveQ && (
                                        <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)', fontSize: 11, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                                          <span style={{ color: '#3b82f6', fontWeight: 700 }}>📬 BullMQ Queue</span>
                                          {[
                                            { label: 'waiting', val: liveQ.waiting || 0, c: '#f59e0b' },
                                            { label: 'active', val: liveQ.active || 0, c: '#3b82f6' },
                                            { label: 'delayed', val: liveQ.delayed || 0, c: '#8b5cf6' },
                                            { label: 'failed', val: liveQ.failed || 0, c: '#ef4444' },
                                            { label: 'completed', val: liveQ.completed || 0, c: '#22c55e' },
                                          ].map(({ label, val, c }) => (
                                            <span key={label} style={{ color: 'var(--text-tertiary)' }}>
                                              {label}: <strong style={{ color: val > 0 ? c : 'var(--text-muted)' }}>{fmt(val)}</strong>
                                            </span>
                                          ))}
                                          <button onClick={async e => { e.stopPropagation(); await refreshQueueStats(); }}
                                            style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(59,130,246,0.3)', background: 'transparent', color: '#3b82f6' }}>
                                            ↻ Refresh
                                          </button>
                                        </div>
                                      )}

                                      {/* Top row — Target, Sent, In Queue, Delivered */}
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                                        {[
                                          { label: 'TARGET', value: target, color: 'var(--green)' },
                                          { label: 'IN QUEUE', value: qWaiting || 0, color: qWaiting > 0 ? '#f59e0b' : 'var(--text-muted)' },
                                          { label: 'SENT', value: sent, color: sent > 0 ? 'var(--green)' : 'var(--text-muted)' },
                                          { label: 'DELIVERED', value: delivered, color: delivered > 0 ? 'var(--green)' : 'var(--text-muted)' },
                                        ].map(m => (
                                          <div key={m.label} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 8px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                                            <div style={{ fontSize: 20, fontWeight: 700, color: m.color }}>{fmt(m.value)}</div>
                                            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: 2 }}>{m.label}</div>
                                          </div>
                                        ))}
                                      </div>

                                      {/* Blocked warning + Retry button */}
                                      {blocked > 0 && (
                                        <div style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.3)', fontSize: 12, color: '#f97316' }}>
                                          <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <span>⚠ <strong>{fmt(blocked)}</strong> entries blocked — {missingConfig ? 'fix node config above then click Retry' : 'no template/channel was set when they ran'}</span>
                                            <button
                                              onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const r = await retryBlockedEntries(selected, node.id);
                                                  hotToast.success(`Retried ${r.data?.retried || 0} blocked entries — processing now…`);
                                                  // Immediately process so emails go out without waiting for cron
                                                  await processJourney(selected).catch(() => {});
                                                  const [d, cd] = await Promise.all([
                                                    getJourney(selected),
                                                    getJourneyCampaignAnalytics(selected).catch(() => ({ data: null })),
                                                  ]);
                                                  setDetail(d.data);
                                                  setCampaignData(cd.data);
                                                  await refreshQueueStats();
                                                } catch (err) { hotToast.error(err.message || 'Retry failed'); }
                                              }}
                                              style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid #f97316', background: 'rgba(249,115,22,0.1)', color: '#f97316', whiteSpace: 'nowrap' }}>
                                              Retry Blocked
                                            </button>
                                          </div>
                                        </div>
                                      )}

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
                                      {/* Action buttons — Preview */}
                                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                                        {(() => {
                                          const tpl = getNodeTemplate(node);
                                          return tpl ? (
                                            <button
                                              type="button"
                                              onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const res = await fetchTemplatePreview(tpl.id);
                                                  setPreviewTemplate({ ...tpl, body_html: res.data?.html || null });
                                                } catch {
                                                  setPreviewTemplate(tpl);
                                                }
                                              }}
                                              style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                                fontSize: 11, fontWeight: 600, padding: '6px 12px',
                                                borderRadius: 6, border: '1px solid var(--brand-primary)',
                                                background: 'rgba(59,130,246,0.06)', color: 'var(--brand-primary)',
                                                cursor: 'pointer',
                                              }}
                                            >
                                              <Eye size={12} /> Preview Template
                                            </button>
                                          ) : null;
                                        })()}
                                      </div>
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
                      ); }
                      );
                    })}
                    {/* Add node at end */}
                    {!isJourneyStarted && (
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
                            {/* Track picker */}
                            <div className="flex gap-1.5 mb-2">
                              {[
                                { v: 'all',    label: 'Shared',     c: 'var(--text-muted)' },
                                { v: 'indian', label: '🇮🇳 Indian',  c: '#FF9933' },
                                { v: 'rest',   label: '🌍 Rest',    c: '#3B82F6' },
                              ].map(t => (
                                <button key={t.v} onClick={() => setNodeForm(f => ({...f, track: t.v}))}
                                  style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                                    border: (nodeForm.track || 'all') === t.v ? `2px solid ${t.c}` : '1px solid var(--border-color)',
                                    background: (nodeForm.track || 'all') === t.v ? t.c + '15' : 'var(--bg-secondary)', color: t.c }}>
                                  {t.label}
                                </button>
                              ))}
                            </div>
                            {nodeForm.type === 'action' && (
                              <div className="flex gap-1.5 mb-2">
                                {['email', 'whatsapp', 'sms', 'push']
                                  .filter(ch => ch !== 'whatsapp' || (nodeForm.track || 'all') !== 'rest')
                                  .map(ch => (
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
                          <button onClick={() => openNodeModal(nodes.length - 1)}
                            className="flex items-center justify-center"
                            title="Add node at end"
                            style={{ width: 32, height: 32, borderRadius: '50%', border: '2px dashed var(--brand-primary)', background: 'var(--bg-card)', color: 'var(--brand-primary)', cursor: 'pointer', fontSize: 18, fontWeight: 700, transition: 'all 0.15s' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-primary)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--brand-primary)'; }}>
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

        {/* ── TAB: Entries ──────────────────────────────────────── */}
        {activeTab === 'entries' && (
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h3>Journey Entries</h3>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{fmt(entriesTotal)} total</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select className="form-input" style={{ width: 140, fontSize: 11, padding: '5px 8px' }}
                  value={entriesStatusFilter}
                  onChange={e => { setEntriesStatusFilter(e.target.value); loadEntries(selected, 1, e.target.value); }}>
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="converted">Converted</option>
                  <option value="exited">Exited</option>
                </select>
                <button className="btn btn-sm btn-secondary" onClick={() => loadEntries(selected, entriesPage, entriesStatusFilter)} disabled={entriesLoading}>
                  <RefreshCw size={12} className={entriesLoading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>
            {entriesLoading && journeyEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading entries...</div>
            ) : journeyEntries.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-tertiary)' }}>
                <Users size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                <div style={{ fontSize: 13 }}>No entries yet. Click "Load Entries" or start the journey to enroll customers.</div>
                <button className="btn btn-sm btn-primary mt-3" onClick={() => loadEntries(selected, 1, '')}>
                  <RefreshCw size={12} /> Load Entries
                </button>
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Email</th>
                        <th>Current Node</th>
                        <th>Status</th>
                        <th>Booking</th>
                        <th>Next Fire</th>
                        <th>Entered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journeyEntries.map(e => {
                        const node = (detail.nodes || []).find(n => n.id === e.current_node_id);
                        const statusColors = { active: 'badge-green', completed: 'badge-purple', converted: 'badge-blue', exited: 'badge-gray' };
                        return (
                          <tr key={e.entry_id}>
                            <td style={{ fontWeight: 600, fontSize: 12 }}>{e.name || '—'}</td>
                            <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{e.email || '—'}</td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: NODE_COLORS[node?.type] || '#78716c' }} />
                                {node?.data?.label || node?.type || e.current_node_id || '—'}
                              </span>
                            </td>
                            <td><span className={`badge ${statusColors[e.status] || 'badge-gray'}`} style={{ fontSize: 10 }}>{e.status}{e.exit_reason ? ` (${e.exit_reason})` : ''}</span></td>
                            <td style={{ fontSize: 11 }}>{e.booking_status || '—'}</td>
                            <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{e.next_fire_at ? new Date(e.next_fire_at).toLocaleString('en-US', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{timeAgo(e.entered_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {entriesTotal > 50 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
                    <button className="btn btn-sm btn-ghost" disabled={entriesPage <= 1} onClick={() => loadEntries(selected, entriesPage - 1, entriesStatusFilter)}>Prev</button>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '4px 8px' }}>Page {entriesPage} of {Math.ceil(entriesTotal / 50)}</span>
                    <button className="btn btn-sm btn-ghost" disabled={entriesPage >= Math.ceil(entriesTotal / 50)} onClick={() => loadEntries(selected, entriesPage + 1, entriesStatusFilter)}>Next</button>
                  </div>
                )}
              </>
            )}
          </div>
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

        {/* ── Create / Add Node Modal ──────────────────────────── */}
        {showNodeModal && (
          <div className="modal-overlay" onClick={() => setShowNodeModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}
              style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>

              {/* Header */}
              <div className="modal-header" style={{ paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: NODE_COLORS[nodeForm.type] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {(() => { const Icon = NODE_ICONS[nodeForm.type]; return <Icon size={18} color={NODE_COLORS[nodeForm.type]} />; })()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{editNodeId ? 'Edit Node' : 'Create Node'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                      {editNodeId
                        ? `Editing: ${nodeForm.label || nodeForm.type}`
                        : `Inserting after position ${(nodeModalAfterIdx ?? 0) + 1}`}
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Node Type */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Node Type</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['trigger', 'action', 'wait', 'condition', 'goal'].map(t => {
                      const Icon = NODE_ICONS[t];
                      const color = NODE_COLORS[t];
                      const active = nodeForm.type === t;
                      return (
                        <button key={t} onClick={() => setNodeForm(f => ({ ...f, type: t }))}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', border: active ? `1.5px solid ${color}` : '1.5px solid var(--border)', background: active ? color + '14' : 'transparent', color: active ? color : 'var(--text-secondary)' }}>
                          <Icon size={12} /> {NODE_LABELS[t]}
                          {active && <CheckCircle2 size={11} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Name / Label */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                    Name
                  </label>
                  <input className="form-input" placeholder={`e.g. ${nodeForm.type === 'wait' ? 'Wait 3 days' : nodeForm.type === 'action' ? 'Send welcome email' : 'Node label'}`}
                    value={nodeForm.label}
                    onChange={e => setNodeForm(f => ({ ...f, label: e.target.value }))} />
                </div>

                {/* Track */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
                    Audience Track
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[{ v: 'all', label: 'Shared', c: 'var(--text-secondary)' }, { v: 'indian', label: '🇮🇳 Indian', c: '#FF9933' }, { v: 'rest', label: '🌍 Rest of World', c: '#3B82F6' }].map(t => (
                      <button key={t.v} onClick={() => setNodeForm(f => ({ ...f, track: t.v }))}
                        style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: nodeForm.track === t.v ? `1.5px solid ${t.c}` : '1.5px solid var(--border)', background: nodeForm.track === t.v ? t.c + '14' : 'transparent', color: nodeForm.track === t.v ? t.c : 'var(--text-secondary)' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── ACTION fields ── */}
                {nodeForm.type === 'action' && (
                  <>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Channel</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          { v: 'email',     label: 'Email',     color: 'var(--red)',    Icon: Mail },
                          { v: 'whatsapp',  label: 'WhatsApp',  color: '#25d366',       Icon: MessageCircle },
                          { v: 'sms',       label: 'SMS',       color: 'var(--orange)', Icon: Smartphone },
                        ].map(ch => (
                          <button key={ch.v} onClick={() => setNodeForm(f => ({ ...f, channel: ch.v }))}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: nodeForm.channel === ch.v ? `1.5px solid ${ch.color}` : '1.5px solid var(--border)', background: nodeForm.channel === ch.v ? ch.color + '14' : 'transparent', color: nodeForm.channel === ch.v ? ch.color : 'var(--text-secondary)' }}>
                            <ch.Icon size={12} /> {ch.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Email template */}
                    {(nodeForm.channel === 'email' || (nodeForm.channel === 'whatsapp' && nodeForm.restChannel === 'email')) && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                          {nodeForm.channel === 'whatsapp' ? '🌍 Rest-of-World Email Template' : 'Email Template'}{nodeForm.channel === 'email' && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
                        </label>
                        <select className="form-input"
                          style={{ borderColor: nodeForm.channel === 'email' && !nodeForm.emailTemplateId ? 'var(--red)' : undefined }}
                          value={nodeForm.channel === 'whatsapp' ? (nodeForm.restTemplateId || '') : (nodeForm.emailTemplateId || '')}
                          onChange={e => {
                            const val = e.target.value ? parseInt(e.target.value) : null;
                            setNodeForm(f => nodeForm.channel === 'whatsapp' ? { ...f, restTemplateId: val } : { ...f, emailTemplateId: val });
                          }}>
                          <option value="">— Select email template —</option>
                          {allTemplates.email.map(t => (
                            <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ''}</option>
                          ))}
                        </select>
                        {allTemplates.email.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>No email templates found</div>}
                      </div>
                    )}

                    {/* WhatsApp template */}
                    {nodeForm.channel === 'whatsapp' && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                          WhatsApp Template
                        </label>
                        <select className="form-input"
                          value={nodeForm.whatsappTemplateId || ''}
                          onChange={e => setNodeForm(f => ({ ...f, whatsappTemplateId: e.target.value ? parseInt(e.target.value) : null }))}>
                          <option value="">— Select WhatsApp template —</option>
                          {allTemplates.whatsapp.map(t => (
                            <option key={t.id} value={t.id}>{t.name}{t.wa_template_name ? ` (${t.wa_template_name})` : ''}</option>
                          ))}
                        </select>
                        {allTemplates.whatsapp.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>No WhatsApp templates found</div>}

                        {/* Rest-of-world auto-pair */}
                        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#3B82F6', marginBottom: 8 }}>🌍 Rest-of-World auto-pair channel</div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            {['email', 'sms'].map(ch => (
                              <button key={ch} onClick={() => setNodeForm(f => ({ ...f, restChannel: ch }))}
                                style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: nodeForm.restChannel === ch ? '1.5px solid #3B82F6' : '1.5px solid var(--border)', background: nodeForm.restChannel === ch ? 'rgba(59,130,246,0.12)' : 'transparent', color: nodeForm.restChannel === ch ? '#3B82F6' : 'var(--text-secondary)', textTransform: 'capitalize' }}>
                                {ch}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SMS template */}
                    {(nodeForm.channel === 'sms' || (nodeForm.channel === 'whatsapp' && nodeForm.restChannel === 'sms')) && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                          {nodeForm.channel === 'whatsapp' ? '🌍 Rest-of-World SMS Template' : 'SMS Template'}
                        </label>
                        <select className="form-input"
                          value={nodeForm.channel === 'whatsapp' ? (nodeForm.restTemplateId || '') : (nodeForm.smsTemplateId || '')}
                          onChange={e => {
                            const val = e.target.value ? parseInt(e.target.value) : null;
                            setNodeForm(f => nodeForm.channel === 'whatsapp' ? { ...f, restTemplateId: val } : { ...f, smsTemplateId: val });
                          }}>
                          <option value="">— Select SMS template —</option>
                          {allTemplates.sms.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        {allTemplates.sms.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>No SMS templates found</div>}
                      </div>
                    )}
                  {/* ── Send Hour (Dubai time) ── */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>
                      Send Hour (Dubai Time)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <select className="form-input" style={{ width: 180 }}
                        value={nodeForm.sendHour ?? ''}
                        onChange={e => setNodeForm(f => ({ ...f, sendHour: e.target.value === '' ? null : parseInt(e.target.value) }))}>
                        <option value="">Any time (immediate)</option>
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>UTC+4</span>
                    </div>
                  </div>
                  </>
                )}

                {/* ── WAIT fields ── */}
                {nodeForm.type === 'wait' && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Days to Wait</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="number" min={1} max={365} className="form-input"
                        style={{ width: 100 }}
                        value={nodeForm.waitDays}
                        onChange={e => {
                          const days = Math.max(1, parseInt(e.target.value) || 1);
                          setNodeForm(f => ({ ...f, waitDays: days, label: `Wait ${days} ${days === 1 ? 'Day' : 'Days'}` }));
                        }} />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {nodeForm.waitDays === 1 ? 'day' : 'days'} before advancing to the next node
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {[1, 2, 3, 5, 7, 14].map(d => (
                        <button key={d} onClick={() => setNodeForm(f => ({ ...f, waitDays: d, label: `Wait ${d} ${d === 1 ? 'Day' : 'Days'}` }))}
                          style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: nodeForm.waitDays === d ? '1.5px solid var(--yellow)' : '1.5px solid var(--border)', background: nodeForm.waitDays === d ? 'var(--yellow)14' : 'transparent', color: nodeForm.waitDays === d ? 'var(--yellow)' : 'var(--text-secondary)', fontWeight: 600 }}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── CONDITION fields ── */}
                {nodeForm.type === 'condition' && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Condition Type</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        { v: 'booked',        label: 'Has Booked' },
                        { v: 'opened_email',  label: 'Opened Email' },
                        { v: 'clicked_link',  label: 'Clicked Link' },
                      ].map(c => (
                        <button key={c.v} onClick={() => setNodeForm(f => ({ ...f, condition: c.v }))}
                          style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: nodeForm.condition === c.v ? '1.5px solid var(--yellow)' : '1.5px solid var(--border)', background: nodeForm.condition === c.v ? 'var(--yellow)14' : 'transparent', color: nodeForm.condition === c.v ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── GOAL fields ── */}
                {nodeForm.type === 'goal' && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Goal Type</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[{ v: 'booking', label: 'Booking' }, { v: 'enquiry', label: 'Enquiry' }, { v: 'registration', label: 'Registration' }].map(g => (
                        <button key={g.v} onClick={() => setNodeForm(f => ({ ...f, goalType: g.v }))}
                          style={{ padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: nodeForm.goalType === g.v ? '1.5px solid var(--purple)' : '1.5px solid var(--border)', background: nodeForm.goalType === g.v ? 'var(--purple)14' : 'transparent', color: nodeForm.goalType === g.v ? 'var(--purple)' : 'var(--text-secondary)' }}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => { setShowNodeModal(false); setEditNodeId(null); }}>Cancel</button>
                {editNodeId ? (
                  <button className="btn btn-primary" onClick={handleSaveNodeEdit}>
                    <CheckCircle2 size={14} /> Save Changes
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => handleAddNode(nodeModalAfterIdx ?? (detail?.nodes?.length ? detail.nodes.length - 1 : 0))}>
                    <Plus size={14} /> Add Node
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmation Dialog ──────────────────────────────── */}
        {confirmAction && (
          <div className="confirm-overlay" onClick={() => setConfirmAction(null)}>
            <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
              <AlertCircle size={32} color={confirmAction === 'delete' ? 'var(--red)' : confirmAction === 'start' ? 'var(--green)' : 'var(--orange)'} style={{ marginBottom: 12 }} />
              <h3>
                {confirmAction === 'start' ? 'Start This Journey?' :
                 confirmAction === 'enroll' ? 'Enroll Segment Customers?' :
                 confirmAction === 'process' ? 'Process Journey?' :
                 'Delete Journey?'}
              </h3>
              <p>
                {confirmAction === 'start'
                  ? 'This will enroll all segment customers, activate the journey, and begin automatic processing every 15 minutes. You can pause it anytime.'
                  : confirmAction === 'enroll'
                  ? 'This will enroll all customers from the associated segment into this journey. This action cannot be undone.'
                  : confirmAction === 'process'
                  ? 'This will advance all active entries to their next step in the journey flow.'
                  : 'This will permanently delete this journey and all associated entries and events. This cannot be undone.'}
              </p>
              <div className="confirm-actions">
                <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
                <button
                  className={`btn ${confirmAction === 'delete' ? 'btn-danger' : 'btn-primary'}`}
                  onClick={confirmAction === 'start' ? handleStart : confirmAction === 'enroll' ? handleEnroll : confirmAction === 'process' ? handleProcess : () => handleDelete(selected)}
                >
                  {confirmAction === 'delete' ? 'Delete Forever' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

        {/* ── Template Preview Modal (inside detail view) ───── */}
        <AnimatePresence>
          {previewTemplate && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setPreviewTemplate(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                style={{ background: 'var(--card)', borderRadius: 16, width: 680, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>Template Preview</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {previewTemplate.name}
                      {previewTemplate.subject && <span> — {previewTemplate.subject}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      background: (CHANNEL_CONFIG[(previewTemplate.channel || '').toLowerCase()]?.color || 'var(--text-tertiary)') + '14',
                      color: CHANNEL_CONFIG[(previewTemplate.channel || '').toLowerCase()]?.color || 'var(--text-tertiary)' }}>
                      {previewTemplate.channel || 'Unknown'}
                    </span>
                    <button onClick={() => setPreviewTemplate(null)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>×</button>
                  </div>
                </div>
                {/* Body */}
                <div style={{ padding: '20px 24px', overflow: 'auto', flex: 1 }}>
                  {previewTemplate.body_html ? (
                    <div style={{ background: '#fff', borderRadius: 8, padding: 16, border: '1px solid var(--border-color)' }}>
                      <iframe
                        srcDoc={previewTemplate.body_html}
                        style={{ width: '100%', minHeight: 400, border: 'none', borderRadius: 4 }}
                        title="Template Preview"
                      />
                    </div>
                  ) : previewTemplate.body || previewTemplate.message ? (
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '16px 20px', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                      {previewTemplate.body || previewTemplate.message}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                      No preview content available
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

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

                {/* Scheduled-start mini badge on card */}
                {j.status === 'draft' && j.scheduled_start_at && new Date(j.scheduled_start_at) > new Date() && (
                  <div className="flex items-center gap-1.5 mt-2.5 mb-0.5" style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: 'var(--orange-dim)', color: 'var(--orange)',
                    border: '1px solid rgba(255,153,51,0.3)',
                  }}>
                    <Clock size={11} />
                    Starts {new Date(j.scheduled_start_at).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })} Dubai
                  </div>
                )}

                {/* Footer: date + delete */}
                <div className="flex justify-between items-center" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
                  <span className="text-secondary" style={{ fontSize: 11 }}>{j.created_at ? new Date(j.created_at).toLocaleDateString() : ''}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: j.journey_id, name: j.name }); }}
                    title="Delete journey"
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-dim)'; e.currentTarget.style.color = 'var(--red)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <Trash2 size={14} />
                  </button>
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
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: j.journey_id, name: j.name }); }}
                            title="Delete journey"
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-dim)'; e.currentTarget.style.color = 'var(--red)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                          >
                            <Trash2 size={14} />
                          </button>
                          <ChevronRight size={14} color="var(--text-muted)" />
                        </div>
                      </td>
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
        <div className="modal-overlay" onClick={() => { setShowCreate(false); setCreateNodes([]); setShowCreateNodeForm(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ maxWidth: 540, maxHeight: '90vh', overflowY: 'auto' }}>

            {/* Header */}
            <div className="modal-header" style={{ paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <GitBranch size={18} color="var(--red)" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Create New Journey</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>Build an automated customer journey flow</div>
                </div>
              </div>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>

              {/* Name */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Journey Name *</label>
                <input className="form-input" type="text"
                  placeholder="e.g., Welcome Series — New Customers"
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} />
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Description</label>
                <textarea className="form-input"
                  placeholder="Describe the purpose and target audience of this journey..."
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  style={{ minHeight: 70, resize: 'vertical' }} />
              </div>

              {/* Segment */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Segment <span style={{ color: 'var(--red)' }}>*</span></label>
                  {segmentsLoading && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-tertiary)' }}>
                      <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
                    </span>
                  )}
                </div>
                <select className="form-input"
                  value={createForm.segmentId}
                  disabled={segmentsLoading}
                  style={{ borderColor: !createForm.segmentId ? 'var(--red)' : undefined }}
                  onChange={e => setCreateForm(f => ({ ...f, segmentId: e.target.value }))}>
                  <option value="">{segmentsLoading ? 'Loading segments…' : '— Select a segment —'}</option>
                  {allSegments.filter(s => s.group === 'standard').length > 0 && (
                    <optgroup label="Standard Segments">
                      {allSegments.filter(s => s.group === 'standard').map((s, i) => (
                        <option key={`std-${i}`} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {allSegments.filter(s => s.group === 'custom').length > 0 && (
                    <optgroup label="Custom Segments">
                      {allSegments.filter(s => s.group === 'custom').map((s, i) => (
                        <option key={`cust-${i}`} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Exit on Conversion Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: createForm.exitOnConversion ? 'rgba(34,197,94,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${createForm.exitOnConversion ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)'}` }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {createForm.exitOnConversion ? 'Exit on Booking' : 'Awareness Mode'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {createForm.exitOnConversion
                      ? 'Users who book will exit the journey automatically'
                      : 'All users receive every message — no exit on booking'}
                  </div>
                </div>
                <button
                  onClick={() => setCreateForm(f => ({ ...f, exitOnConversion: !f.exitOnConversion }))}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: createForm.exitOnConversion ? 'var(--green)' : 'var(--text-tertiary)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0
                  }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3,
                    left: createForm.exitOnConversion ? 23 : 3,
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                  }} />
                </button>
              </div>

              {/* Scheduled Start Date — Dubai time */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Start Date &amp; Time
                  </label>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--orange)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)', display: 'inline-block', animation: 'simDot 1s ease-in-out infinite' }} />
                    Dubai now: {dubaiClock}
                  </span>
                </div>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={createForm.scheduledStartAt}
                  min={dubaiNowForInput()}
                  onChange={e => setCreateForm(f => ({ ...f, scheduledStartAt: e.target.value }))}
                  style={{ fontSize: 13 }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 5, lineHeight: 1.5 }}>
                  {createForm.scheduledStartAt
                    ? '✓ Journey will auto-start at this Dubai time'
                    : 'Leave empty to start immediately when you click "Start Journey"'}
                </div>
              </div>

              {/* Nodes */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Journey Nodes</label>
                  {createNodes.length > 0 && !showCreateNodeForm && (
                    <button onClick={() => { setShowCreateNodeForm(true); loadTemplates(); setCreateNodeForm({ ...BLANK_CREATE_NODE }); }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--brand-primary)', background: 'transparent', color: 'var(--brand-primary)' }}>
                      <Plus size={11} /> Add Node
                    </button>
                  )}
                </div>

                {/* Entry trigger — always shown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: NODE_COLORS.trigger + '10', border: `1px solid ${NODE_COLORS.trigger}25` }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: NODE_COLORS.trigger + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Zap size={13} color={NODE_COLORS.trigger} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Entry Trigger</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {createForm.segmentId ? `Segment: ${allSegments.find(s => s.value === createForm.segmentId)?.label?.split(' (')[0] || createForm.segmentId}` : 'Segment entry — added automatically'}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: NODE_COLORS.trigger, background: NODE_COLORS.trigger + '15', padding: '2px 8px', borderRadius: 20 }}>Trigger</span>
                  </div>

                  {/* User-added nodes */}
                  {createNodes.map((n, idx) => {
                    const color = NODE_COLORS[n.type];
                    const Icon = NODE_ICONS[n.type];
                    const detail = n.type === 'action'
                      ? (n.channel ? n.channel.charAt(0).toUpperCase() + n.channel.slice(1) : 'Action')
                      : n.type === 'wait'
                      ? `Wait ${n.waitDays || 1} day${(n.waitDays || 1) !== 1 ? 's' : ''}`
                      : n.type === 'condition'
                      ? (n.condition === 'booked' ? 'Has Booked?' : n.condition === 'opened_email' ? 'Opened Email?' : n.condition === 'clicked_link' ? 'Clicked Link?' : n.condition || 'Condition')
                      : n.type === 'goal'
                      ? `Goal: ${n.goalType ? n.goalType.charAt(0).toUpperCase() + n.goalType.slice(1) : 'Booking'}`
                      : '';
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: color + '08', border: `1px solid ${color}20` }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border)', flexShrink: 0, marginLeft: 8 }} />
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon size={13} color={color} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{detail}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, color, background: color + '15', padding: '2px 8px', borderRadius: 20, flexShrink: 0 }}>{NODE_LABELS[n.type]}</span>
                        <button onClick={() => setCreateNodes(ns => ns.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, lineHeight: 1, padding: '0 0 0 2px', flexShrink: 0 }}>×</button>
                      </div>
                    );
                  })}
                </div>

                {/* Add node button → only shown when list is empty and form is closed */}
                {!showCreateNodeForm && createNodes.length === 0 ? (
                  <button onClick={() => { setShowCreateNodeForm(true); loadTemplates(); setCreateNodeForm({ ...BLANK_CREATE_NODE }); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px dashed var(--brand-primary)', background: 'transparent', color: 'var(--brand-primary)' }}>
                    <Plus size={12} /> Add Node
                  </button>
                ) : (
                  <div style={{ border: '1.5px solid var(--brand-primary)', borderRadius: 12, padding: 16, background: 'var(--brand-primary)08', marginTop: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={13} /> Custom Node
                    </div>

                    {/* Name */}
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Node Name *</label>
                      <input className="form-input" style={{ fontSize: 12, padding: '6px 10px' }}
                        placeholder="e.g. Send welcome email"
                        value={createNodeForm.label}
                        onChange={e => setCreateNodeForm(f => ({ ...f, label: e.target.value }))} />
                    </div>

                    {/* Node Type */}
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 7, textTransform: 'uppercase' }}>Node Type</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {['action', 'wait', 'condition', 'goal'].map(t => {
                          const Icon = NODE_ICONS[t]; const color = NODE_COLORS[t]; const active = createNodeForm.type === t;
                          const TYPE_DEFAULTS = {
                            action:    { channel: 'email',   waitDays: 1,  condition: 'booked',  goalType: 'booking',  label: 'Send Email' },
                            wait:      { channel: 'email',   waitDays: 1,  condition: 'booked',  goalType: 'booking',  label: 'Wait 1 Day' },
                            condition: { channel: 'email',   waitDays: 1,  condition: 'booked',  goalType: 'booking',  label: 'Has Booked?' },
                            goal:      { channel: 'email',   waitDays: 1,  condition: 'booked',  goalType: 'booking',  label: 'Booking Goal' },
                          };
                          return (
                            <button key={t} onClick={() => setCreateNodeForm(f => ({ ...f, type: t, ...TYPE_DEFAULTS[t] }))}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: active ? `1.5px solid ${color}` : '1.5px solid var(--border)', background: active ? color + '14' : 'transparent', color: active ? color : 'var(--text-secondary)' }}>
                              <Icon size={11} /> {NODE_LABELS[t]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ACTION */}
                    {createNodeForm.type === 'action' && (
                      <>
                        <div style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 7, textTransform: 'uppercase' }}>Channel</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {[{ v: 'email', label: 'Email', color: 'var(--red)', Icon: Mail }, { v: 'whatsapp', label: 'WhatsApp', color: '#25d366', Icon: MessageCircle }, { v: 'sms', label: 'SMS', color: 'var(--orange)', Icon: Smartphone }].map(ch => (
                              <button key={ch.v} onClick={() => setCreateNodeForm(f => ({ ...f, channel: ch.v }))}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: createNodeForm.channel === ch.v ? `1.5px solid ${ch.color}` : '1.5px solid var(--border)', background: createNodeForm.channel === ch.v ? ch.color + '14' : 'transparent', color: createNodeForm.channel === ch.v ? ch.color : 'var(--text-secondary)' }}>
                                <ch.Icon size={11} /> {ch.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {createNodeForm.channel === 'email' && (
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Mail Template</label>
                            <select className="form-input" style={{ fontSize: 12 }}
                              value={createNodeForm.emailTemplateId || ''}
                              onChange={e => setCreateNodeForm(f => ({ ...f, emailTemplateId: e.target.value ? parseInt(e.target.value) : null }))}>
                              <option value="">— Select email template —</option>
                              {allTemplates.email.map(t => <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ''}</option>)}
                            </select>
                          </div>
                        )}
                        {createNodeForm.channel === 'whatsapp' && (
                          <>
                            <div style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>WhatsApp Template</label>
                              <select className="form-input" style={{ fontSize: 12 }}
                                value={createNodeForm.whatsappTemplateId || ''}
                                onChange={e => setCreateNodeForm(f => ({ ...f, whatsappTemplateId: e.target.value ? parseInt(e.target.value) : null }))}>
                                <option value="">— Select WhatsApp template —</option>
                                {allTemplates.whatsapp.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                            <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#3B82F6', marginBottom: 6 }}>Rest-of-World fallback</div>
                              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                {['email', 'sms'].map(ch => (
                                  <button key={ch} onClick={() => setCreateNodeForm(f => ({ ...f, restChannel: ch }))}
                                    style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: createNodeForm.restChannel === ch ? '1.5px solid #3B82F6' : '1.5px solid var(--border)', background: createNodeForm.restChannel === ch ? 'rgba(59,130,246,0.12)' : 'transparent', color: createNodeForm.restChannel === ch ? '#3B82F6' : 'var(--text-secondary)', textTransform: 'capitalize' }}>{ch}</button>
                                ))}
                              </div>
                              <select className="form-input" style={{ fontSize: 12 }}
                                value={createNodeForm.restTemplateId || ''}
                                onChange={e => setCreateNodeForm(f => ({ ...f, restTemplateId: e.target.value ? parseInt(e.target.value) : null }))}>
                                <option value="">— Select {createNodeForm.restChannel} template —</option>
                                {(createNodeForm.restChannel === 'email' ? allTemplates.email : allTemplates.sms).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                          </>
                        )}
                        {createNodeForm.channel === 'sms' && (
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>SMS Template</label>
                            <select className="form-input" style={{ fontSize: 12 }}
                              value={createNodeForm.smsTemplateId || ''}
                              onChange={e => setCreateNodeForm(f => ({ ...f, smsTemplateId: e.target.value ? parseInt(e.target.value) : null }))}>
                              <option value="">— Select SMS template —</option>
                              {allTemplates.sms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        )}
                      {/* Send Hour picker */}
                      <div style={{ marginTop: 8 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Send Hour (Dubai Time)</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <select className="form-input" style={{ width: 160, fontSize: 12, padding: '6px 10px' }}
                            value={createNodeForm.sendHour ?? ''}
                            onChange={e => setCreateNodeForm(f => ({ ...f, sendHour: e.target.value === '' ? null : parseInt(e.target.value) }))}>
                            <option value="">Any time</option>
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>
                                {h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`}
                              </option>
                            ))}
                          </select>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>UTC+4</span>
                        </div>
                      </div>
                      </>
                    )}

                    {/* WAIT */}
                    {createNodeForm.type === 'wait' && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 5, textTransform: 'uppercase' }}>Days to Wait</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input type="number" min={1} className="form-input" style={{ width: 80, fontSize: 12, padding: '6px 10px' }}
                            value={createNodeForm.waitDays}
                            onChange={e => {
                              const days = Math.max(1, parseInt(e.target.value) || 1);
                              setCreateNodeForm(f => ({ ...f, waitDays: days, label: `Wait ${days} ${days === 1 ? 'Day' : 'Days'}` }));
                            }} />
                          <div style={{ display: 'flex', gap: 5 }}>
                            {[1, 2, 3, 7].map(d => (
                              <button key={d} onClick={() => setCreateNodeForm(f => ({ ...f, waitDays: d, label: `Wait ${d} ${d === 1 ? 'Day' : 'Days'}` }))}
                                style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontWeight: 600, border: createNodeForm.waitDays === d ? '1.5px solid var(--yellow)' : '1.5px solid var(--border)', background: createNodeForm.waitDays === d ? 'var(--yellow)14' : 'transparent', color: createNodeForm.waitDays === d ? 'var(--yellow)' : 'var(--text-secondary)' }}>{d}d</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CONDITION */}
                    {createNodeForm.type === 'condition' && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 7, textTransform: 'uppercase' }}>Condition</label>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {[{ v: 'booked', l: 'Has Booked' }, { v: 'opened_email', l: 'Opened Email' }, { v: 'clicked_link', l: 'Clicked Link' }].map(c => (
                            <button key={c.v} onClick={() => setCreateNodeForm(f => ({ ...f, condition: c.v }))}
                              style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: createNodeForm.condition === c.v ? '1.5px solid var(--yellow)' : '1.5px solid var(--border)', background: createNodeForm.condition === c.v ? 'var(--yellow)14' : 'transparent', color: createNodeForm.condition === c.v ? 'var(--yellow)' : 'var(--text-secondary)' }}>{c.l}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* GOAL */}
                    {createNodeForm.type === 'goal' && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', display: 'block', marginBottom: 7, textTransform: 'uppercase' }}>Goal Type</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {[{ v: 'booking', l: 'Booking' }, { v: 'enquiry', l: 'Enquiry' }, { v: 'registration', l: 'Registration' }].map(g => (
                            <button key={g.v} onClick={() => setCreateNodeForm(f => ({ ...f, goalType: g.v }))}
                              style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: createNodeForm.goalType === g.v ? '1.5px solid var(--purple)' : '1.5px solid var(--border)', background: createNodeForm.goalType === g.v ? 'var(--purple)14' : 'transparent', color: createNodeForm.goalType === g.v ? 'var(--purple)' : 'var(--text-secondary)' }}>{g.l}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Validation message for missing template */}
                    {createNodeForm.type === 'action' && (
                      (createNodeForm.channel === 'email' && !createNodeForm.emailTemplateId) ||
                      (createNodeForm.channel === 'whatsapp' && !createNodeForm.whatsappTemplateId) ||
                      (createNodeForm.channel === 'sms' && !createNodeForm.smsTemplateId)
                    ) && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 6, padding: '4px 8px', background: 'rgba(239,68,68,0.06)', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)' }}>
                        ⚠ {createNodeForm.channel.charAt(0).toUpperCase() + createNodeForm.channel.slice(1)} template is required before adding this node
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button className="btn btn-sm btn-primary"
                        disabled={
                          !createNodeForm.label.trim() ||
                          (createNodeForm.type === 'action' && createNodeForm.channel === 'email' && !createNodeForm.emailTemplateId) ||
                          (createNodeForm.type === 'action' && createNodeForm.channel === 'whatsapp' && !createNodeForm.whatsappTemplateId) ||
                          (createNodeForm.type === 'action' && createNodeForm.channel === 'sms' && !createNodeForm.smsTemplateId)
                        }
                        onClick={() => {
                          setCreateNodes(ns => [...ns, { ...createNodeForm }]);
                          setCreateNodeForm({ ...BLANK_CREATE_NODE });
                          setShowCreateNodeForm(false);
                        }}>
                        <Plus size={11} /> Add Node
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setShowCreateNodeForm(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer justify-end mt-4">
              <button className="btn btn-ghost" onClick={() => { setShowCreate(false); setCreateNodes([]); setShowCreateNodeForm(false); }}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!createForm.name.trim()}>
                <Plus size={14} /> Create Journey
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

      {/* ── Delete Confirmation Modal ─────────────────────────── */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setDeleteConfirm(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--card)', borderRadius: 16, padding: 28, width: 400, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--red-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} color="var(--red)" />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Delete Journey</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>This action cannot be undone</div>
                </div>
              </div>
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', marginBottom: 20, fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Journey: </span>
                <span style={{ fontWeight: 600 }}>{deleteConfirm.name}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
                This will permanently delete this journey and all associated entries and events.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setDeleteConfirm(null)}
                  style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  Cancel
                </button>
                <button onClick={async () => {
                  const id = deleteConfirm.id;
                  setDeleteConfirm(null);
                  try {
                    await deleteJourney(id);
                    hotToast.success('Journey deleted successfully');
                    await loadData();
                  } catch (err) { hotToast.error(err.message || 'Failed to delete journey'); }
                }}
                  style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--red)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
