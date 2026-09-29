'use client';

import { useState, useEffect, Fragment } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  getChatLeadsSummary, getChatLeadsTrend, getMailLeadsSummary, getMailLeadsTrend,
  getChatLeadsDepartmentPeriods, getMailLeadsDepartmentPeriods, getChatLeadsDepartmentUsers,
  getDepartmentGroups, deleteDepartmentGroup,
} from '@/lib/api';
import {
  MessageSquare, Mail, Calendar, BarChart3, Loader2, Users, Building2, UserPlus, UserCheck,
  Plus, Pencil, Trash2, Layers,
} from 'lucide-react';
import GroupDepartmentModal from './GroupDepartmentModal';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Month-year options (e.g. "Jan 2026") from 1 year ahead down to 2 years back.
const MONTH_YEAR_OPTIONS = (() => {
  const cy = new Date().getFullYear();
  const opts = [];
  for (let y = cy + 1; y >= cy - 2; y--) {
    for (let m = 12; m >= 1; m--) opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
  }
  return opts;
})();

const CHANNELS = {
  whatsapp: {
    label: 'WhatsApp Chats',
    icon: MessageSquare,
    color: '#25D366',
    volumeLabel: 'Total Chats',
    volumeKey: 'totalChats',
    volumeField: 'chats',
    volumeColumnLabel: 'Chats',
    getSummary: getChatLeadsSummary,
    getTrend: getChatLeadsTrend,
    getDeptPeriods: getChatLeadsDepartmentPeriods,
  },
  mail: {
    label: 'Email Tickets',
    icon: Mail,
    color: 'var(--yellow)',
    volumeLabel: 'Total Emails',
    volumeKey: 'totalEmails',
    volumeField: 'emails',
    volumeColumnLabel: 'Emails',
    getSummary: getMailLeadsSummary,
    getTrend: getMailLeadsTrend,
    getDeptPeriods: getMailLeadsDepartmentPeriods,
  },
};

const DEFAULT_PERIOD_COUNT = { day: 7, week: 7, month: 3 };
const DAY_COUNT_OPTIONS = [5, 7, 14, 30];
const WEEK_COUNT_OPTIONS = [4, 7, 8, 12, 16];
const MONTH_COUNT_OPTIONS = [3, 6, 12];
const PERIOD_COUNT_OPTIONS = { day: DAY_COUNT_OPTIONS, week: WEEK_COUNT_OPTIONS, month: MONTH_COUNT_OPTIONS };
// native <input type="..."> for each unit's range picker
const RANGE_INPUT_TYPE = { day: 'date', week: 'week', month: 'month' };

function formatNum(n) { return (n || 0).toLocaleString(); }
function getToday() { return new Date().toISOString().split('T')[0]; }
function getYesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
function getDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

export default function Leads() {
  const [channel, setChannel] = useState('whatsapp');

  // ── Top filter — drives the KPI strip + trend chart ──
  const [fromDate, setFromDate] = useState(getDaysAgo(7));
  const [toDate, setToDate] = useState(getToday());
  const [granularity, setGranularity] = useState('day');
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Department filter — fully independent, drives only the "Leads by Department" table ──
  const [periodUnit, setPeriodUnit] = useState('week'); // 'day' | 'week' | 'month'
  const [periodCount, setPeriodCount] = useState(DEFAULT_PERIOD_COUNT.week);
  const [rangeFrom, setRangeFrom] = useState(''); // explicit range overrides periodCount when both are set
  const [rangeTo, setRangeTo] = useState('');
  const [deptPeriods, setDeptPeriods] = useState([]);
  const [deptRows, setDeptRows] = useState([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptError, setDeptError] = useState(null);
  // Expandable dept row → users (number, first msg, first-msg time) for that receiver.
  const [expandedReceiver, setExpandedReceiver] = useState(null);
  const [deptUsers, setDeptUsers] = useState([]);
  const [deptUsersLoading, setDeptUsersLoading] = useState(false);
  const [deptUsersError, setDeptUsersError] = useState(null);

  // ── Department Groups ──
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [deptGroupFilter, setDeptGroupFilter] = useState(''); // '' = all; else group id → show only that group's depts

  const cfg = CHANNELS[channel];

  // Rows shown in Leads-by-Department, filtered to the selected group's departments (if any).
  const groupReceivers = deptGroupFilter
    ? new Set((groups.find(g => String(g.id) === String(deptGroupFilter))?.departments || []).map(d => String(d.receiver)))
    : null;
  const visibleDeptRows = groupReceivers ? deptRows.filter(r => groupReceivers.has(String(r.receiver))) : deptRows;

  const loadGroups = async () => {
    setGroupsLoading(true);
    try {
      const res = await getDepartmentGroups();
      setGroups(res.groups || []);
    } catch { /* non-blocking */ } finally {
      setGroupsLoading(false);
    }
  };

  const handleDeleteGroup = async (g) => {
    if (!confirm(`Delete group "${g.name}"? Its departments will be freed for other groups.`)) return;
    try { await deleteDepartmentGroup(g.id); loadGroups(); }
    catch (e) { alert(e.message || 'Failed to delete group'); }
  };

  // Approx date span the department table currently covers (drives the expand lookup).
  const deptSpan = () => {
    const days = periodUnit === 'day' ? periodCount : periodUnit === 'week' ? periodCount * 7 : periodCount * 31;
    return { from: getDaysAgo(days), to: getToday() };
  };

  // Toggle a department row: collapse if already open, else fetch its users (WhatsApp only).
  const toggleExpand = async (receiver) => {
    if (expandedReceiver === receiver) { setExpandedReceiver(null); return; }
    setExpandedReceiver(receiver);
    if (channel !== 'whatsapp') return;  // expand (first-msg lookup) is WhatsApp-only
    setDeptUsers([]); setDeptUsersError(null); setDeptUsersLoading(true);
    try {
      const { from, to } = deptSpan();
      const res = await getChatLeadsDepartmentUsers(receiver, from, to, { onlyNew: true, limit: 50 });
      setDeptUsers(res.users || []);
    } catch (e) {
      setDeptUsersError(e.message || 'Failed to load users');
    } finally {
      setDeptUsersLoading(false);
    }
  };

  // Auto-load both sections with their default range on first mount.
  useEffect(() => {
    load();
    loadDept();
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (ch = channel, from = fromDate, to = toDate, gran = granularity) => {
    setLoading(true);
    setError(null);
    try {
      const c = CHANNELS[ch];
      const [summaryRes, trendRes] = await Promise.all([
        c.getSummary(from, to),
        c.getTrend(from, to, gran),
      ]);
      setSummary(summaryRes);
      setTrend(trendRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDept = async (ch = channel, unit = periodUnit, count = periodCount) => {
    setDeptLoading(true);
    setDeptError(null);
    try {
      const res = await CHANNELS[ch].getDeptPeriods(unit, count);
      setDeptPeriods(res.periods || []);
      setDeptRows(res.rows || []);
    } catch (err) {
      setDeptError(err.message);
    } finally {
      setDeptLoading(false);
    }
  };

  const handleChannel = (ch) => {
    setChannel(ch);
    setSummary(null);
    setTrend(null);
    setError(null);
    setDeptPeriods([]);
    setDeptRows([]);
    setDeptError(null);
    load(ch, fromDate, toDate, granularity);
    loadDept(ch, periodUnit, periodCount);
  };

  const handlePreset = (from, to) => {
    setFromDate(from);
    setToDate(to);
    load(channel, from, to, granularity);
  };

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const monthBounds = (val) => {
    const [y, m] = val.split('-').map(Number);
    return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
  };
  const handleMonthPick = (val) => { if (val) handlePreset(...monthBounds(val)); };

  // current "YYYY-MM" if a range exactly spans one calendar month (highlights the dropdown)
  const pickedMonth = (fromDate && toDate && fromDate.slice(0, 7) === toDate.slice(0, 7)
    && fromDate.slice(8) === '01' && toDate === ymd(new Date(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)), 0)))
    ? fromDate.slice(0, 7) : '';

  const handlePeriodUnit = (unit) => {
    setPeriodUnit(unit);
    const count = DEFAULT_PERIOD_COUNT[unit];
    setPeriodCount(count);
    loadDept(channel, unit, count);
  };
  const handlePeriodCount = (count) => {
    setPeriodCount(count);
    loadDept(channel, periodUnit, count);
  };
  const handlePeriodReset = () => handlePeriodCount(DEFAULT_PERIOD_COUNT[periodUnit]);
  const periodIsFiltered = periodCount !== DEFAULT_PERIOD_COUNT[periodUnit];

  const handleGranularity = (gran) => {
    setGranularity(gran);
    if (summary) load(channel, fromDate, toDate, gran);
  };

  const chartData = (trend?.points || []).map(p => ({ period: p.period, leads: p.leads, newUsers: p.newUsers ?? 0, oldUsers: p.oldUsers ?? 0 }));

  const QUICK_PRESETS = () => [
    { label: 'Today', from: getToday(), to: getToday() },
    { label: 'Yesterday', from: getYesterday(), to: getYesterday() },
    { label: 'Last 7 days', from: getDaysAgo(7), to: getToday() },
    { label: 'Last 30 days', from: getDaysAgo(30), to: getToday() },
    { label: 'This month', from: new Date().toISOString().slice(0, 8) + '01', to: getToday() },
  ];

  // Generic filter block — each call site passes its OWN state/handlers, so the
  // two filter sections on this page (top KPI/trend vs. the Department table)
  // never share selection state.
  const renderFilterBlock = ({ from, to, setFrom, setTo, onLoad, isLoading, pickedMonth: pm, onMonthPick, onPreset, showTrendToggle }) => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={18} style={{ color: 'var(--text-secondary)' }} />
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
        </div>
        <button className="btn btn-primary" onClick={onLoad} disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <BarChart3 size={16} />}
          {isLoading ? 'Loading...' : 'Load'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Month</label>
        <select value={pm} onChange={(e) => onMonthPick(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }}>
          <option value="">Select month…</option>
          {MONTH_YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, lineHeight: '28px' }}>Quick:</span>
        {QUICK_PRESETS().map(p => (
          <button key={p.label} className="btn btn-ghost btn-sm"
            onClick={() => onPreset(p.from, p.to)}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-color)',
              background: (from === p.from && to === p.to) ? 'var(--brand-primary)' : 'transparent',
              color: (from === p.from && to === p.to) ? '#fff' : 'var(--text-secondary)' }}>
            {p.label}
          </button>
        ))}
      </div>

      {showTrendToggle && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>Trend view:</span>
          {['day', 'week', 'month'].map(g => (
            <button key={g} className="btn btn-ghost btn-sm"
              onClick={() => handleGranularity(g)}
              style={{ fontSize: 12, padding: '4px 14px', borderRadius: 6, border: '1px solid var(--border-color)',
                textTransform: 'capitalize',
                background: granularity === g ? 'var(--brand-primary)' : 'transparent',
                color: granularity === g ? '#fff' : 'var(--text-secondary)' }}>
              {g}-wise
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* Header */}
      <motion.div variants={fadeInUp} style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Leads</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0', fontSize: 14 }}>
          WhatsApp chat leads and email ticket leads by department, live from the source database.
        </p>
      </motion.div>

      {/* Channel Switcher */}
      <motion.div variants={fadeInUp} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {Object.entries(CHANNELS).map(([key, c]) => (
          <button key={key} onClick={() => handleChannel(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10,
              border: `1px solid ${channel === key ? c.color : 'var(--border-color)'}`,
              background: channel === key ? c.color + '20' : 'var(--bg-card)',
              color: channel === key ? c.color : 'var(--text-secondary)',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>
            <c.icon size={16} />
            {c.label}
          </button>
        ))}
      </motion.div>

      {/* Filters */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
        {renderFilterBlock({
          from: fromDate, to: toDate, setFrom: setFromDate, setTo: setToDate,
          onLoad: () => load(), isLoading: loading,
          pickedMonth, onMonthPick: handleMonthPick, onPreset: handlePreset,
          showTrendToggle: true,
        })}
      </motion.div>

      {/* Error */}
      {error && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 16, marginBottom: 24, borderLeft: '4px solid var(--red)' }}>
          <span style={{ color: 'var(--red)', fontSize: 14 }}>{error}</span>
        </motion.div>
      )}

      {summary && (
        <>
          {/* KPI Strip */}
          <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              {[
                { icon: Users, label: 'Total Leads', value: formatNum(summary.totalLeads), bg: 'rgba(14,165,233,0.1)', color: 'var(--brand-primary)' },
                // New vs returning users (WhatsApp only — mail summary omits these).
                ...(summary.newUsers != null ? [
                  { icon: UserPlus, label: 'New Users', value: formatNum(summary.newUsers), bg: 'rgba(34,197,94,0.12)', color: 'var(--green, #22c55e)' },
                  { icon: UserCheck, label: 'Returning Users', value: formatNum(summary.oldUsers), bg: 'rgba(139,92,246,0.12)', color: 'var(--purple, #8b5cf6)' },
                ] : []),
                { icon: Calendar, label: 'Date Range', value: `${summary.from}  to  ${summary.to}`, bg: 'rgba(249,115,22,0.1)', color: 'var(--orange)' },
              ].map(kpi => (
                <div key={kpi.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: kpi.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <kpi.icon size={20} style={{ color: kpi.color }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>{kpi.label}</div>
                    <div style={{ fontSize: kpi.label === 'Date Range' ? 14 : 22, fontWeight: 700, color: 'var(--text-primary)' }}>{kpi.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Trend Chart */}
          <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Leads Trend — Total / New / Returning ({granularity}-wise)</h3>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }}
                  />
                  <Bar dataKey="leads" name="Total Leads" fill="var(--brand-primary)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="newUsers" name="New Users" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="oldUsers" name="Returning Users" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                No data for the selected range.
              </div>
            )}
          </motion.div>
        </>
      )}

      {/* Department Groups — group multiple departments under one name (one dept → one group) */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div className="card-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Layers size={18} style={{ color: 'var(--text-secondary)' }} />
          <h3 style={{ margin: 0, fontSize: 16 }}>Department Groups</h3>
          <span className="badge-blue" style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{groups.length}</span>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => { setEditGroup(null); setGroupModalOpen(true); }}>
            <Plus size={16} /> Add Group
          </button>
        </div>

        {groupsLoading ? (
          <div style={{ padding: 16, textAlign: 'center' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} /></div>
        ) : groups.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
            No groups yet. Click <strong>Add Group</strong> to bundle departments under one name.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {groups.map((g) => (
              <div key={g.id} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>· {g.departments.length} dept{g.departments.length === 1 ? '' : 's'}</span>
                  <button className="btn btn-ghost btn-icon btn-sm" title="Edit" style={{ marginLeft: 'auto' }}
                    onClick={() => { setEditGroup(g); setGroupModalOpen(true); }}><Pencil size={15} /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => handleDeleteGroup(g)}><Trash2 size={15} style={{ color: 'var(--red)' }} /></button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.departments.map((d) => (
                    <span key={d.receiver} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      {d.name || d.receiver}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Department Breakdown — independent filter, independent data */}
      {deptError && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 16, marginBottom: 24, borderLeft: '4px solid var(--red)' }}>
          <span style={{ color: 'var(--red)', fontSize: 14 }}>{deptError}</span>
        </motion.div>
      )}

      {deptPeriods.length > 0 && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 20, overflow: 'hidden', marginBottom: 24 }}>
          <div className="card-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 size={18} style={{ color: 'var(--text-secondary)' }} />
            <h3 style={{ margin: 0, fontSize: 16 }}>Leads by Department</h3>
            <span className="badge-blue" style={{ padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
              {visibleDeptRows.length} receivers
            </span>
          </div>

          {/* Week-on-Week / Month-on-Month filter bar */}
          <div style={{ padding: 16, marginBottom: 16, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', borderRadius: 8, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                {[{ key: 'day', label: 'Day on Day' }, { key: 'week', label: 'Week on Week' }, { key: 'month', label: 'Month on Month' }].map(o => (
                  <button key={o.key} onClick={() => handlePeriodUnit(o.key)}
                    style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: periodUnit === o.key ? 'var(--bg-card)' : 'transparent',
                      color: periodUnit === o.key ? 'var(--brand-primary)' : 'var(--text-secondary)',
                      boxShadow: periodUnit === o.key ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.08))' : 'none' }}>
                    {o.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {periodUnit === 'day' ? 'Days' : periodUnit === 'week' ? 'Weeks' : 'Months'}
                </label>
                <select value={periodCount} onChange={(e) => handlePeriodCount(Number(e.target.value))}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }}>
                  {(periodUnit === 'day' ? DAY_COUNT_OPTIONS : periodUnit === 'week' ? WEEK_COUNT_OPTIONS : MONTH_COUNT_OPTIONS).map(n => (
                    <option key={n} value={n}>Last {n}</option>
                  ))}
                </select>
              </div>

              {/* Group filter — show only the selected group's departments */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Group</label>
                <select value={deptGroupFilter} onChange={(e) => setDeptGroupFilter(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }}>
                  <option value="">All departments</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.departments.length})</option>
                  ))}
                </select>
              </div>

              {deptGroupFilter && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'rgba(14,165,233,0.12)', color: 'var(--brand-primary)', fontSize: 12, fontWeight: 600 }}>
                  {groups.find(g => String(g.id) === String(deptGroupFilter))?.name}
                  <button onClick={() => setDeptGroupFilter('')} style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }} title="Clear group filter">×</button>
                </span>
              )}

              {periodIsFiltered && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'rgba(249,115,22,0.12)', color: 'var(--orange)', fontSize: 12, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)', display: 'inline-block' }} />
                  Filtered
                </span>
              )}
              {periodIsFiltered && (
                <button className="btn btn-ghost btn-sm" onClick={handlePeriodReset}
                  style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  ↺ Reset
                </button>
              )}
              {deptLoading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />}
            </div>
          </div>

          {/* Legend for the per-period cell format */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
            <span><strong style={{ color: 'var(--text-primary)' }}>chats</strong> · <strong style={{ color: 'var(--green, #22c55e)' }}>new</strong> / <strong style={{ color: 'var(--purple, #8b5cf6)' }}>returning</strong> per period</span>
            <span>new = first-ever contact in that period · returning = contacted before</span>
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)', maxHeight: 560 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Receiver', 'Department'].map(col => (
                    <th key={col} style={{
                      padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11,
                      textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
                      background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)',
                      color: 'var(--text-secondary)', position: 'sticky', top: 0, left: col === 'Receiver' ? 0 : 140, zIndex: 2,
                    }}>{col}</th>
                  ))}
                  {deptPeriods.map((p, i) => (
                    <th key={i} style={{
                      padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: 11,
                      whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)',
                      color: 'var(--text-secondary)', position: 'sticky', top: 0, zIndex: 1,
                    }}>
                      <div>{p.label}</div>
                      <div style={{ fontSize: 10, fontWeight: 400, textTransform: 'none', color: 'var(--text-tertiary)' }}>
                        {p.sublabel}{p.partial ? ' · PARTIAL' : ''}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleDeptRows.map((row, i) => {
                  const isOpen = expandedReceiver === row.receiver;
                  const colSpan = 2 + row.values.length;
                  return (
                    <Fragment key={`${row.receiver}-${i}`}>
                      <tr onClick={() => toggleExpand(row.receiver)}
                        style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
                          background: isOpen ? 'rgba(14,165,233,0.08)' : (i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)') }}>
                        <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'inherit' }}
                          title={row.receiver}>
                          <span style={{ display: 'inline-block', width: 12, color: 'var(--text-tertiary)' }}>{isOpen ? '▾' : '▸'}</span> {row.receiver}
                        </td>
                        <td style={{ padding: '7px 12px', color: row.department ? 'var(--text-primary)' : 'var(--text-tertiary)', fontStyle: row.department ? 'normal' : 'italic', whiteSpace: 'nowrap', position: 'sticky', left: 140, background: 'inherit' }}>
                          {row.department || 'No department match'}
                        </td>
                        {row.values.map((v, j) => (
                          <td key={j} style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 600 }} title="chats">{formatNum(v.chats)}</span>
                            <span style={{ color: 'var(--text-tertiary)' }}> · </span>
                            <span style={{ color: 'var(--green, #22c55e)', fontWeight: 600 }} title="new users (first contact in this period)">{formatNum(v.newUsers)}</span>
                            <span style={{ color: 'var(--text-tertiary)' }}>/</span>
                            <span style={{ color: 'var(--purple, #8b5cf6)', fontWeight: 600 }} title="returning users">{formatNum(v.oldUsers)}</span>
                          </td>
                        ))}
                      </tr>
                      {isOpen && (
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <td colSpan={colSpan} style={{ padding: '12px 16px' }}>
                            {channel !== 'whatsapp' ? (
                              <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>User drill-down (first message) is available for WhatsApp only.</div>
                            ) : deptUsersLoading ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading users…
                              </div>
                            ) : deptUsersError ? (
                              <div style={{ color: 'var(--red)', fontSize: 13 }}>{deptUsersError}</div>
                            ) : deptUsers.length === 0 ? (
                              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>No new users found for this department in the current window.</div>
                            ) : (
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                                  New users for {row.department || row.receiver} — showing {deptUsers.length}
                                </div>
                                <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                    <thead>
                                      <tr>
                                        {['Number', 'First Message', 'First Message At'].map(h => (
                                          <th key={h} style={{ textAlign: 'left', padding: '7px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-tertiary)', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {deptUsers.map((u, k) => (
                                        <tr key={`${u.wa_id}-${k}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                          <td style={{ padding: '7px 12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                            {u.wa_id}{u.wa_name ? <span style={{ color: 'var(--text-tertiary)' }}> · {u.wa_name}</span> : null}
                                          </td>
                                          <td style={{ padding: '7px 12px', color: 'var(--text-primary)' }}>
                                            {u.first_msg || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>(not available)</span>}
                                          </td>
                                          <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{u.first_msg_at || '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
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
                    <td colSpan={2 + deptPeriods.length} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      {deptGroupFilter ? 'No departments from this group have activity in the current window.' : 'No data.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {!summary && deptPeriods.length === 0 && !loading && !deptLoading && !error && !deptError && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 48, textAlign: 'center' }}>
          <cfg.icon size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 16 }} />
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Select a date range to get started</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>
            Choose a range above (or a quick preset), then click "Load" to see {cfg.label.toLowerCase()} volume by department.
          </p>
        </motion.div>
      )}

      <GroupDepartmentModal
        open={groupModalOpen}
        editGroup={editGroup}
        onClose={() => { setGroupModalOpen(false); setEditGroup(null); }}
        onSaved={loadGroups}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}
