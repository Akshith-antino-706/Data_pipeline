'use client';

import { useState, useEffect, Fragment } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  getChatLeadsSummary, getChatLeadsTrend, getMailLeadsSummary, getMailLeadsTrend,
  getChatLeadsDepartmentPeriods, getMailLeadsDepartmentPeriods, getChatLeadsDepartmentUsers,
  getDepartmentGroups, deleteDepartmentGroup, getRegistrationLeads, getRegistrationSummary, getRegistrationPeriods,
} from '@/lib/api';
import {
  MessageSquare, Mail, Calendar, BarChart3, Loader2, Users, Building2, UserPlus, UserCheck,
  Plus, Pencil, Trash2, Layers,
} from 'lucide-react';
import GroupDepartmentModal from './GroupDepartmentModal';
import { useAuth } from '@/context/AuthContext';

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
    description: 'Chat volume and department performance',
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
    description: 'Email enquiries and department trends',
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

const CHANNEL_TABS = {
  ...CHANNELS,
  registration: { label: 'Registrations', description: 'Guest users, agents, and affiliates', icon: Users, color: 'var(--brand-primary)' },
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

function SkeletonBlock({ width = '100%', height = 14, radius = 7, style = {} }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

function AnalyticsSkeleton() {
  return (
    <div aria-label="Loading lead analytics" aria-busy="true">
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 20 }}>
          {[0, 1, 2, 3].map(item => <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 11 }}><SkeletonBlock width={42} height={42} radius={10} /><div style={{ flex: 1 }}><SkeletonBlock width="55%" height={10} style={{ marginBottom: 7 }} /><SkeletonBlock width="78%" height={22} /></div></div>)}
        </div>
      </div>
      <div className="card" style={{ padding: 20, marginBottom: 24 }}>
        <SkeletonBlock width={210} height={17} style={{ marginBottom: 20 }} />
        <div style={{ height: 245, display: 'flex', alignItems: 'flex-end', gap: '3%', padding: '0 3%', borderBottom: '1px solid var(--border-color)' }}>
          {[38, 62, 48, 78, 55, 88, 68, 74, 52, 82].map((height, index) => <SkeletonBlock key={index} width="7%" height={`${height}%`} radius={6} />)}
        </div>
      </div>
    </div>
  );
}

function DepartmentSkeleton() {
  return <div className="card" aria-label="Loading department data" aria-busy="true" style={{ padding: 20, marginBottom: 24 }}><SkeletonBlock width={190} height={17} style={{ marginBottom: 16 }} />{[0, 1, 2, 3, 4].map(row => <div key={row} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr repeat(4, .7fr)', gap: 14, padding: '12px 4px', borderTop: '1px solid var(--border-color)' }}>{[0, 1, 2, 3, 4, 5].map(cell => <SkeletonBlock key={cell} width={cell < 2 ? '80%' : '65%'} height={12} />)}</div>)}</div>;
}

const REGISTRATION_SOURCES = {
  guestuser: { label: 'Guest Users', icon: Users },
  agent: { label: 'Agents', icon: Building2 },
  affiliate: { label: 'Affiliates', icon: UserCheck },
};
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

// "GuestUserId" → "Guest User Id", "AgentID" → "Agent ID"
function humanizeColumn(name) {
  const spaced = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Empty values are stored as '' or the text 'NULL'; timestamps as 'YYYY-MM-DD HH:MM:SS[.ffffff]'.
function formatCell(value) {
  if (value === null || value === undefined || value === '' || value === 'NULL') return '—';
  const s = String(value);
  const ts = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (ts) return ts[2] === '00:00' && /^\d{4}-\d{2}-\d{2} 00:00(:00(\.0+)?)?$/.test(s) ? ts[1] : `${ts[1]} ${ts[2]}`;
  return s;
}

// Single-select pill group (used instead of dropdowns on the registrations tab).
function PillGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-color)', cursor: 'pointer',
            background: value === o.value ? 'var(--brand-primary)' : 'transparent',
            color: value === o.value ? '#fff' : 'var(--text-secondary)' }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RegistrationTableSkeleton() {
  return <div aria-label="Loading registration records" aria-busy="true">{[0, 1, 2, 3, 4, 5].map(row => <div key={row} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, padding: '12px 4px', borderTop: '1px solid var(--border-color)' }}>{[0, 1, 2, 3, 4, 5].map(cell => <SkeletonBlock key={cell} width="75%" height={12} />)}</div>)}</div>;
}

// Registrations tab. `query` ({ from, to, granularity }) comes from the page's shared
// date filter, so this tab filters exactly like WhatsApp Chats / Email Tickets.
function RegistrationPanel({ query }) {
  const [source, setSource] = useState('guestuser');

  // KPI + trend (follows the shared date filter)
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(null);

  // Day on Day / Week on Week / Month on Month breakdown (own period filter)
  const [periodUnit, setPeriodUnit] = useState('week');
  const [periodCount, setPeriodCount] = useState(DEFAULT_PERIOD_COUNT.week);
  const [periodData, setPeriodData] = useState(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [periodError, setPeriodError] = useState(null);

  // Records table (follows the shared date filter + its own search / paging)
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState({ records: [], total: 0, columns: [] });
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState(null);

  useEffect(() => {
    try { const saved = window.localStorage.getItem('leads-registration-source'); if (REGISTRATION_SOURCES[saved]) setSource(saved); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let active = true;
    setSummaryLoading(true);
    setSummaryError(null);
    getRegistrationSummary(source, query.from, query.to, query.granularity)
      .then(data => { if (active) setSummary(data); })
      .catch(err => { if (active) setSummaryError(err.message || 'Failed to load registrations'); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [source, query]);

  useEffect(() => {
    let active = true;
    setPeriodLoading(true);
    setPeriodError(null);
    getRegistrationPeriods(source, periodUnit, periodCount)
      .then(data => { if (active) setPeriodData(data); })
      .catch(err => { if (active) setPeriodError(err.message || 'Failed to load period breakdown'); })
      .finally(() => { if (active) setPeriodLoading(false); });
    return () => { active = false; };
  }, [source, periodUnit, periodCount]);

  // Back to page 1 whenever what the table shows changes.
  useEffect(() => { setPage(1); }, [source, query, search, limit]);

  useEffect(() => {
    let active = true;
    setRecordsLoading(true);
    setRecordsError(null);
    getRegistrationLeads({ source, from: query.from, to: query.to, search, limit, page })
      .then(data => { if (active) setRecords(data); })
      .catch(err => { if (active) setRecordsError(err.message || 'Failed to load registrations'); })
      .finally(() => { if (active) setRecordsLoading(false); });
    return () => { active = false; };
  }, [source, query, search, limit, page]);

  const handleSource = (s) => {
    setSource(s);
    try { window.localStorage.setItem('leads-registration-source', s); } catch { /* ignore */ }
  };
  const handlePeriodUnit = (unit) => { setPeriodUnit(unit); setPeriodCount(DEFAULT_PERIOD_COUNT[unit]); };

  const label = REGISTRATION_SOURCES[source].label;
  const counts = summary?.counts || {};
  const chartData = (summary?.points || []).map(p => ({ period: p.period, registrations: p.registrations }));
  const columns = records.columns || [];
  const totalPages = Math.max(Math.ceil((records.total || 0) / limit), 1);
  const cardStyle = { padding: 20, marginBottom: 24 };

  return (
    <>
      {/* Registration type — single select */}
      <motion.div variants={fadeInUp} role="radiogroup" aria-label="Registration type" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(REGISTRATION_SOURCES).map(([key, s]) => {
          const selected = source === key;
          return (
            <button key={key} role="radio" aria-checked={selected} onClick={() => handleSource(key)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${selected ? 'var(--brand-primary)' : 'var(--border-color)'}`,
                background: selected ? 'color-mix(in srgb, var(--brand-primary) 10%, var(--bg-card))' : 'var(--bg-card)',
                color: selected ? 'var(--brand-primary)' : 'var(--text-secondary)' }}>
              <s.icon size={17} />
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{s.label}</span>
              <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                background: selected ? 'var(--brand-primary)' : 'var(--bg-secondary)', color: selected ? '#fff' : 'var(--text-secondary)' }}>
                {summary ? formatNum(counts[key]) : '…'}
              </span>
            </button>
          );
        })}
      </motion.div>

      {summaryError && <motion.div variants={fadeInUp} className="card" style={{ ...cardStyle, padding: 16, borderLeft: '4px solid var(--red)' }}><span style={{ color: 'var(--red)', fontSize: 14 }}>{summaryError}</span></motion.div>}
      {summaryLoading && !summary && <AnalyticsSkeleton />}

      {summary && (
        <>
          {/* KPI strip */}
          <motion.div variants={fadeInUp} className="card" style={cardStyle}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              {[
                { icon: REGISTRATION_SOURCES[source].icon, label: `${label} registered`, value: formatNum(summary.total), bg: 'rgba(14,165,233,0.1)', color: 'var(--brand-primary)' },
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
              {summaryLoading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)', alignSelf: 'center' }} />}
            </div>
          </motion.div>

          {/* Trend chart */}
          <motion.div variants={fadeInUp} className="card" style={cardStyle}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{label} registrations · {summary.granularity}-wise</h3>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>By registration date</span>
            </div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="registrations" name="Registrations" fill="var(--brand-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No registrations in the selected range.</div>
            )}
          </motion.div>
        </>
      )}

      {/* Day on Day / Week on Week / Month on Month */}
      <motion.div variants={fadeInUp} className="card" style={{ ...cardStyle, overflow: 'hidden' }}>
        <div className="card-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8 }}>
          <Building2 size={18} style={{ color: 'var(--text-secondary)' }} />
          <h3 style={{ margin: 0, fontSize: 16 }}>{label} by {(periodData?.dimension || (source === 'affiliate' ? 'Affiliate type' : 'Website')).toLowerCase()}</h3>
          {periodLoading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />}
        </div>
        <div style={{ padding: 16, marginBottom: 16, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Last</span>
            <PillGroup value={periodCount} onChange={setPeriodCount}
              options={PERIOD_COUNT_OPTIONS[periodUnit].map(n => ({ value: n, label: `${n} ${periodUnit === 'day' ? 'days' : periodUnit === 'week' ? 'weeks' : 'months'}` }))} />
          </div>
        </div>
        {periodError ? <div style={{ color: 'var(--red)', fontSize: 13 }}>{periodError}</div>
          : !periodData && periodLoading ? <DepartmentSkeleton />
          : periodData && (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)', maxHeight: 480 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', position: 'sticky', top: 0, left: 0, zIndex: 2 }}>{periodData.dimension}</th>
                  {periodData.periods.map((p, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <div>{p.label}</div>
                      <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-tertiary)' }}>{p.sublabel}{p.partial ? ' · PARTIAL' : ''}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodData.rows.map((row, i) => (
                  <tr key={row.name} style={{ borderBottom: '1px solid var(--border-color)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                    <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--text-primary)', position: 'sticky', left: 0, background: 'inherit' }}>{row.name}</td>
                    {row.values.map((v, j) => <td key={j} style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: v ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{formatNum(v)}</td>)}
                  </tr>
                ))}
                {periodData.rows.length === 0 ? (
                  <tr><td colSpan={1 + periodData.periods.length} style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No registrations in these periods.</td></tr>
                ) : (
                  <tr style={{ borderTop: '2px solid var(--border-color)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg-card)' }}>Total</td>
                    {periodData.totals.map((v, j) => <td key={j} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatNum(v)}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Records — the selected table's own columns; columns with no data in the range are hidden */}
      <motion.div variants={fadeInUp} className="card" style={cardStyle}>
        <div className="card-header" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{label} records</h3>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatNum(records.total)} records · page {page} of {totalPages}</span>
          {recordsLoading && records.records.length > 0 && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, flex: '1 1 280px' }}>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && setSearch(searchInput.trim())}
              placeholder={`Search ${label.toLowerCase()} — name, email, phone, ID…`}
              style={{ flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
            <button className="btn btn-primary" onClick={() => setSearch(searchInput.trim())}>Search</button>
            {search && <button className="btn btn-ghost" onClick={() => { setSearchInput(''); setSearch(''); }}>Clear</button>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Rows</span>
            <PillGroup value={limit} onChange={setLimit} options={ROWS_PER_PAGE_OPTIONS.map(n => ({ value: n, label: String(n) }))} />
          </div>
        </div>
        {recordsError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{recordsError}</div>}
        {recordsLoading && records.records.length === 0 ? <RegistrationTableSkeleton /> : records.records.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No {label.toLowerCase()} registered in this range{search ? ' matching the search' : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)', maxHeight: 600, opacity: recordsLoading ? 0.6 : 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col} title={col} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>{humanizeColumn(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.records.map((record, i) => (
                  <tr key={`${record.source}-${record.recordId}`} style={{ borderBottom: '1px solid var(--border-color)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                    {columns.map(col => {
                      const text = formatCell(record.data[col]);
                      return <td key={col} style={{ padding: '7px 12px', whiteSpace: 'nowrap', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', color: text === '—' ? 'var(--text-tertiary)' : 'var(--text-primary)' }} title={text}>{text}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18 }}>
          <button className="btn btn-ghost" disabled={page <= 1 || recordsLoading} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
          <button className="btn btn-ghost" disabled={page >= totalPages || recordsLoading} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      </motion.div>
    </>
  );
}

export default function Leads() {
  const [channel, setChannel] = useState('whatsapp');
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(null);

  // ── Top filter — drives the KPI strip + trend chart ──
  const [fromDate, setFromDate] = useState(getDaysAgo(7));
  const [toDate, setToDate] = useState(getToday());
  const [granularity, setGranularity] = useState('day');
  // Applied filter for the Registrations tab (set by load(), like the other tabs' fetches)
  const [regQuery, setRegQuery] = useState(() => ({ from: getDaysAgo(7), to: getToday(), granularity: 'day' }));
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
  const [deptUsersHasMore, setDeptUsersHasMore] = useState(false);
  const [deptUsersLoadingMore, setDeptUsersLoadingMore] = useState(false);

  // ── Department Groups ──
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [deptGroupFilter, setDeptGroupFilter] = useState(''); // '' = all; else group id → show only that group's depts

  const cfg = CHANNELS[channel];
  const { isAuthenticated } = useAuth();  // group management is hidden for the public (logged-out) view

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
    setDeptUsers([]); setDeptUsersError(null); setDeptUsersHasMore(false); setDeptUsersLoading(true);
    try {
      const { from, to } = deptSpan();
      const res = await getChatLeadsDepartmentUsers(receiver, from, to, { onlyNew: true, limit: 50 });
      setDeptUsers(res.users || []);
      setDeptUsersHasMore(!!res.has_more);
    } catch (e) {
      setDeptUsersError(e.message || 'Failed to load users');
    } finally {
      setDeptUsersLoading(false);
    }
  };

  // "Show more" in the expanded row: fetch the next page and append it.
  const loadMoreDeptUsers = async () => {
    if (!expandedReceiver || deptUsersLoadingMore) return;
    setDeptUsersLoadingMore(true);
    try {
      const { from, to } = deptSpan();
      const res = await getChatLeadsDepartmentUsers(expandedReceiver, from, to, { onlyNew: true, limit: 50, offset: deptUsers.length });
      setDeptUsers(prev => [...prev, ...(res.users || [])]);
      setDeptUsersHasMore(!!res.has_more);
    } catch (e) {
      setDeptUsersError(e.message || 'Failed to load more users');
    } finally {
      setDeptUsersLoadingMore(false);
    }
  };

  // Restore the last selected tab and expire this open page when its 30-minute
  // access session ends, even if the visitor never refreshes or navigates.
  useEffect(() => {
    const queryTab = new URLSearchParams(window.location.search).get('tab');
    const savedTab = window.localStorage.getItem('leads-active-tab');
    const initialChannel = CHANNEL_TABS[queryTab] ? queryTab : CHANNEL_TABS[savedTab] ? savedTab : 'whatsapp';
    setChannel(initialChannel);
    // (Registrations: regQuery already starts at the default range — RegistrationPanel loads itself.)
    if (initialChannel !== 'registration') {
      load(initialChannel);
      loadDept(initialChannel);
    }
    loadGroups();
    let expiryTimer;
    let countdownTimer;
    // The token session (countdown + reload on expiry) only applies to public visitors;
    // users signed in through /login skip the token (see middleware.js).
    const signedIn = document.cookie.split('; ').some(c => c.startsWith('rayna-auth='));
    (signedIn ? Promise.resolve(null) : fetch('/leads-access/verify'))
      .then(response => response?.ok ? response.json() : null)
      .then(access => {
        if (!access?.expiresAt) return;
        const updateCountdown = () => setSessionSecondsLeft(Math.max(Math.ceil((access.expiresAt - Date.now()) / 1000), 0));
        updateCountdown();
        countdownTimer = window.setInterval(updateCountdown, 1000);
        expiryTimer = window.setTimeout(() => window.location.assign(window.location.href), Math.max(access.expiresAt - Date.now() + 250, 250));
      })
      .catch(() => {});
    return () => {
      if (expiryTimer) window.clearTimeout(expiryTimer);
      if (countdownTimer) window.clearInterval(countdownTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (ch = channel, from = fromDate, to = toDate, gran = granularity) => {
    if (ch === 'registration') {
      // RegistrationPanel fetches its own data whenever this applied filter changes.
      setRegQuery({ from, to, granularity: gran });
      return;
    }
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
    window.localStorage.setItem('leads-active-tab', ch);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', ch);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    if (ch === 'registration') { load(ch, fromDate, toDate, granularity); return; }
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
    if (summary || channel === 'registration') load(channel, fromDate, toDate, gran);
  };

  const chartData = (trend?.points || []).map(p => ({ period: p.period, leads: p.leads, newUsers: p.newUsers ?? 0, oldUsers: p.oldUsers ?? 0 }));
  const sessionCountdown = sessionSecondsLeft == null
    ? '--:--'
    : `${String(Math.floor(sessionSecondsLeft / 60)).padStart(2, '0')}:${String(sessionSecondsLeft % 60).padStart(2, '0')}`;

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
      <motion.div variants={fadeInUp} className="card" style={{ marginBottom: 18, padding: '22px 24px', background: 'linear-gradient(135deg, var(--bg-card) 0%, color-mix(in srgb, var(--brand-primary) 6%, var(--bg-card)) 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ height: 52, minWidth: 112, padding: '5px 10px', borderRadius: 12, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid var(--border-color)' }}>
            <img src="/rayna-logo.webp" alt="Rayna Tours" style={{ width: 96, height: 40, objectFit: 'contain', display: 'block' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 25, fontWeight: 700, margin: 0 }}>Leads workspace</h1>
            <p style={{ color: 'var(--text-secondary)', margin: '5px 0 0', fontSize: 13.5 }}>Explore conversations, email enquiries, and registrations in one place.</p>
          </div>
          {/* Token-session timer — public visitors only (signed-in users have no timer) */}
          {sessionSecondsLeft != null && <span title="You will be asked for the access token again when this timer ends" style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: sessionSecondsLeft === 0 ? 'rgba(220,38,38,0.12)' : 'rgba(34,197,94,0.12)', color: sessionSecondsLeft === 0 ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            Secure session · {sessionCountdown}
          </span>}
        </div>
      </motion.div>

      {/* Channel Switcher */}
      <motion.div variants={fadeInUp} role="tablist" aria-label="Lead data source" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
        {Object.entries(CHANNEL_TABS).map(([key, c]) => (
          <button key={key} role="tab" aria-selected={channel === key} onClick={() => handleChannel(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 12, textAlign: 'left',
              border: `1px solid ${channel === key ? c.color : 'var(--border-color)'}`,
              background: channel === key ? `color-mix(in srgb, ${c.color} 10%, var(--bg-card))` : 'var(--bg-card)',
              color: channel === key ? c.color : 'var(--text-secondary)',
              cursor: 'pointer', boxShadow: channel === key ? '0 5px 16px rgba(15,23,42,0.07)' : 'none',
            }}>
            <span style={{ width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 9, background: channel === key ? `color-mix(in srgb, ${c.color} 16%, transparent)` : 'var(--bg-secondary)' }}><c.icon size={17} /></span>
            <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{c.label}</span><span style={{ display: 'block', marginTop: 2, fontSize: 10.5, fontWeight: 400, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.description}</span></span>
          </button>
        ))}
      </motion.div>

      {/* Filters — shared by all tabs */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
        {renderFilterBlock({
          from: fromDate, to: toDate, setFrom: setFromDate, setTo: setToDate,
          onLoad: () => load(), isLoading: channel !== 'registration' && loading,
          pickedMonth, onMonthPick: handleMonthPick, onPreset: handlePreset,
          showTrendToggle: true,
        })}
      </motion.div>

      {channel === 'registration' ? <RegistrationPanel query={regQuery} /> : <>

      {/* Error */}
      {error && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 16, marginBottom: 24, borderLeft: '4px solid var(--red)' }}>
          <span style={{ color: 'var(--red)', fontSize: 14 }}>{error}</span>
        </motion.div>
      )}

      {loading && !summary && <AnalyticsSkeleton />}

      {summary && (
        <>
          {/* KPI Strip */}
          <motion.div variants={fadeInUp} className="card" style={{ padding: 20, marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              {[
                { icon: cfg.icon, label: cfg.volumeLabel, value: formatNum(summary[cfg.volumeKey]), bg: 'rgba(14,165,233,0.1)', color: cfg.color },
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
              <h3 style={{ margin: 0, fontSize: 16 }}>{cfg.label} trend · {granularity}-wise</h3>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{summary.newUsers != null ? 'Total, new, and returning leads' : 'Total unique leads'}</span>
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
                  {summary.newUsers != null && <Bar dataKey="newUsers" name="New Users" fill="#22c55e" radius={[6, 6, 0, 0]} />}
                  {summary.newUsers != null && <Bar dataKey="oldUsers" name="Returning Users" fill="#8b5cf6" radius={[6, 6, 0, 0]} />}
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

      {/* Department Groups — group multiple departments under one name (one dept → one group).
          Management is hidden for the public (logged-out) view. */}
      {isAuthenticated && (
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
      )}

      {/* Department Breakdown — independent filter, independent data */}
      {deptError && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 16, marginBottom: 24, borderLeft: '4px solid var(--red)' }}>
          <span style={{ color: 'var(--red)', fontSize: 14 }}>{deptError}</span>
        </motion.div>
      )}

      {deptLoading && deptPeriods.length === 0 && <DepartmentSkeleton />}

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
                                  New users for {row.department || row.receiver} — showing {deptUsers.length}{deptUsersHasMore ? '+' : ''}
                                </div>
                                <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                    <thead>
                                      <tr>
                                        {['#', 'Number', 'First Message', 'First Message At'].map(h => (
                                          <th key={h} style={{ textAlign: 'left', padding: '7px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-tertiary)', background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {deptUsers.map((u, k) => (
                                        <tr key={`${u.wa_id}-${k}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                          <td style={{ padding: '7px 12px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', width: 1 }}>{k + 1}</td>
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
                                {deptUsersHasMore && (
                                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); loadMoreDeptUsers(); }}
                                      disabled={deptUsersLoadingMore}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', fontSize: 12.5, fontWeight: 600,
                                        color: '#0ea5e9', background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.35)', borderRadius: 8,
                                        cursor: deptUsersLoadingMore ? 'default' : 'pointer', opacity: deptUsersLoadingMore ? 0.6 : 1 }}>
                                      {deptUsersLoadingMore
                                        ? (<><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</>)
                                        : 'Show more'}
                                    </button>
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
      </>}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}
