'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, MessageCircle, Smartphone, Bell, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, MousePointerClick, XCircle, Clock, Send, AlertCircle, Eye, Filter, X } from 'lucide-react';
import { getSendLog, getJourneys } from '@/lib/api';

const CHANNELS = [
  { key: 'all',       label: 'All' },
  { key: 'email',     label: 'Email',     icon: Mail },
  { key: 'sms',       label: 'SMS',       icon: Smartphone },
  { key: 'whatsapp',  label: 'WhatsApp',  icon: MessageCircle },
  { key: 'push',      label: 'Push',      icon: Bell },
];

const SUB_FILTERS = [
  { key: 'all',           label: 'All' },
  { key: 'active',        label: 'Active' },
  { key: 'unsubscribed',  label: 'Unsubscribed' },
];

const STATUS_FILTERS = [
  { key: '',         label: 'All Status' },
  { key: 'sent',     label: 'Sent' },
  { key: 'opened',   label: 'Opened' },
  { key: 'clicked',  label: 'Clicked' },
  { key: 'failed',   label: 'Failed' },
  { key: 'queued',   label: 'Queued' },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const STATUS_META = {
  sent:     { label: 'Sent',      color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  icon: Send },
  queued:   { label: 'Queued',    color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: Clock },
  opened:   { label: 'Opened',    color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  icon: Eye },
  clicked:  { label: 'Clicked',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: MousePointerClick },
  failed:   { label: 'Failed',    color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: XCircle },
  delivered:{ label: 'Delivered', color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',  icon: CheckCircle2 },
};

const fmt = (n) => n == null ? '—' : Number(n).toLocaleString();

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: AlertCircle };
  const Icon = m.icon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
      <Icon size={10} /> {m.label}
    </span>
  );
}

const COLS = '2fr 2.5fr 2fr 100px 140px 130px 130px';

function SkeletonRow({ i }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 0, padding: '14px 16px', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
      {[80, 150, 120, 60, 70, 90, 100].map((w, j) => (
        <div key={j}>
          <div style={{ height: 12, width: w, borderRadius: 6, background: 'var(--bg-secondary)', animation: `shimmer 1.4s ease-in-out ${i * 0.06 + j * 0.03}s infinite` }} />
          {j === 0 && <div style={{ height: 10, width: 50, borderRadius: 4, background: 'var(--bg-secondary)', marginTop: 6, animation: `shimmer 1.4s ease-in-out ${i * 0.06 + 0.15}s infinite` }} />}
        </div>
      ))}
    </div>
  );
}

export default function LogPage() {
  const [channel, setChannel]           = useState('email');
  const [subFilter, setSubFilter]       = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');
  const [searchInput, setSearchInput]   = useState('');
  const [journeyId, setJourneyId]       = useState('');
  const [nodeId, setNodeId]             = useState('');
  const [page, setPage]                 = useState(1);
  const [limit, setLimit]               = useState(20);
  const [data, setData]                 = useState({ rows: [], total: 0 });
  const [loading, setLoading]           = useState(true);

  // Journey + Node dropdowns
  const [journeys, setJourneys]         = useState([]);  // [{ id, name, nodes }]
  const [journeyNodes, setJourneyNodes] = useState([]);  // nodes of selected journey

  useEffect(() => {
    getJourneys({ limit: 200 })
      .then(res => setJourneys(res?.data?.data || res?.data || []))
      .catch(() => {});
  }, []);

  // When journey changes, populate node list from that journey's nodes array
  useEffect(() => {
    if (!journeyId) { setJourneyNodes([]); setNodeId(''); return; }
    const jny = journeys.find(j => String(j.journey_id || j.id) === String(journeyId));
    const nodes = Array.isArray(jny?.nodes) ? jny.nodes.filter(n => n.type === 'action') : [];
    setJourneyNodes(nodes);
    setNodeId('');
  }, [journeyId, journeys]);

  const activeFilterCount = [statusFilter, search, journeyId, nodeId, subFilter !== 'all' ? subFilter : ''].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (channel !== 'all' && channel !== 'email') {
        setData({ rows: [], total: 0 });
        setLoading(false);
        return;
      }
      const params = {
        page,
        limit,
        ...(search        ? { email: search }                     : {}),
        ...(statusFilter  ? { status: statusFilter }              : {}),
        ...(journeyId     ? { journeyId }                         : {}),
        ...(nodeId        ? { nodeId }                            : {}),
        ...(subFilter !== 'all' ? { subscriptionStatus: subFilter } : {}),
      };
      const res = await getSendLog(params);
      setData(res?.data ?? { rows: [], total: 0 });
    } catch {
      setData({ rows: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, journeyId, nodeId, subFilter, channel]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [channel, subFilter, statusFilter, search, journeyId, nodeId, limit]);

  const totalPages = Math.max(1, Math.ceil(data.total / limit));

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  function clearAllFilters() {
    setSearch(''); setSearchInput('');
    setStatusFilter('');
    setJourneyId('');
    setNodeId('');
    setSubFilter('all');
  }

  return (
    <div style={{ padding: 24, maxWidth: 1440, margin: '0 auto' }}>
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.9; }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Send Log</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: 14 }}>
            {loading ? 'Loading…' : `${fmt(data.total)} records`}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Channel tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {CHANNELS.map(ch => {
              const Icon = ch.icon;
              const active = channel === ch.key;
              return (
                <button key={ch.key} onClick={() => setChannel(ch.key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: active ? 'var(--text-primary)' : 'var(--bg-secondary)', color: active ? 'var(--bg-primary)' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                  {Icon && <Icon size={13} />}{ch.label}
                </button>
              );
            })}
          </div>
          <button onClick={load} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Row 1: subscription + status + clear */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Subscription */}
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 10, padding: 3, gap: 2, border: '1px solid var(--border-color)' }}>
            {SUB_FILTERS.map(f => (
              <button key={f.key} onClick={() => setSubFilter(f.key)}
                style={{ padding: '4px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: subFilter === f.key ? 'var(--bg-primary)' : 'transparent', color: subFilter === f.key ? 'var(--text-primary)' : 'var(--text-secondary)', boxShadow: subFilter === f.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.15s' }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Status pills */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map(f => {
              const active = statusFilter === f.key;
              const meta = f.key ? STATUS_META[f.key] : null;
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${active && meta ? meta.color : 'var(--border-color)'}`, background: active && meta ? meta.bg : active ? 'var(--bg-primary)' : 'transparent', color: active && meta ? meta.color : active ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button onClick={clearAllFilters}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--red, #ef4444)', marginLeft: 'auto' }}>
              <X size={11} /> Clear ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Row 2: email search + journey/node dropdowns */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Email search */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by email…"
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: 200, outline: 'none', height: 32 }}
            />
            <button type="submit"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--brand-primary)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', height: 32, whiteSpace: 'nowrap' }}>
              <Filter size={12} /> Search
            </button>
            {search && (
              <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }}
                style={{ padding: '0 8px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--red, #ef4444)', fontSize: 13, fontWeight: 700, cursor: 'pointer', height: 32 }}>
                ✕
              </button>
            )}
          </form>

          {/* Divider */}
          <div style={{ width: 1, height: 24, background: 'var(--border-color)', flexShrink: 0 }} />

          {/* Journey labeled select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Journey</span>
            <div style={{ position: 'relative' }}>
              <select
                value={journeyId}
                onChange={e => setJourneyId(e.target.value)}
                style={{
                  padding: '0 32px 0 10px', height: 32, borderRadius: 8,
                  border: `1.5px solid ${journeyId ? 'var(--brand-primary)' : 'var(--border-color)'}`,
                  background: journeyId ? 'color-mix(in srgb, var(--brand-primary) 8%, var(--bg-secondary))' : 'var(--bg-secondary)',
                  color: journeyId ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontSize: 13, fontWeight: journeyId ? 600 : 400,
                  outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
                  maxWidth: 200,
                }}
              >
                <option value="">All Journeys</option>
                {journeys.map(j => (
                  <option key={j.journey_id || j.id} value={j.journey_id || j.id}>
                    #{j.journey_id || j.id} · {j.name}
                  </option>
                ))}
              </select>
              <svg style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {journeyId && (
                <button onClick={() => setJourneyId('')}
                  style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1, padding: 0 }}>
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Node labeled select — only when journey selected */}
          {journeyId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Node</span>
              <div style={{ position: 'relative' }}>
                <select
                  value={nodeId}
                  onChange={e => setNodeId(e.target.value)}
                  style={{
                    padding: '0 32px 0 10px', height: 32, borderRadius: 8,
                    border: `1.5px solid ${nodeId ? 'var(--brand-primary)' : 'var(--border-color)'}`,
                    background: nodeId ? 'color-mix(in srgb, var(--brand-primary) 8%, var(--bg-secondary))' : 'var(--bg-secondary)',
                    color: nodeId ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 13, fontWeight: nodeId ? 600 : 400,
                    outline: 'none', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
                    maxWidth: 200,
                  }}
                >
                  <option value="">All Nodes</option>
                  {journeyNodes.length === 0 && <option disabled>No action nodes</option>}
                  {journeyNodes.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.data?.label || n.id}
                    </option>
                  ))}
                </select>
                <svg style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)' }} width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {nodeId && (
                  <button onClick={() => setNodeId('')}
                    style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1, padding: 0 }}>
                    ×
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Active email chip */}
          {search && (
            <span style={chipStyle}>
              {search} <button onClick={() => { setSearch(''); setSearchInput(''); }} style={chipX}>×</button>
            </span>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '10px 16px' }}>
          {['Contact', 'Email', 'Subject / Template', 'Status', 'Journey / Node', 'Sent At', 'Opened / Clicked'].map(h => (
            <div key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</div>
          ))}
        </div>

        {/* Skeleton */}
        {loading ? (
          Array.from({ length: limit > 10 ? 10 : limit }).map((_, i) => <SkeletonRow key={i} i={i} />)
        ) : data.rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
            No send logs found
          </div>
        ) : (
          data.rows.map((row, i) => {
            const isUnsubscribed = row.email_unsubscribed === 'Yes';
            return (
              <div key={row.id}
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 0, padding: '11px 16px', borderBottom: i < data.rows.length - 1 ? '1px solid var(--border-color)' : 'none', alignItems: 'center', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {/* Contact */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.uc_name || row.contact_name || '—'}
                  </div>
                  {isUnsubscribed && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '1px 6px', borderRadius: 4, marginTop: 2, display: 'inline-block' }}>
                      Unsubscribed
                    </span>
                  )}
                </div>

                {/* Email */}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.email || '—'}
                </div>

                {/* Subject / Template */}
                <div>
                  {row.subject && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.subject}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.template_label || '—'}
                  </div>
                </div>

                {/* Status */}
                <div><StatusPill status={row.status} /></div>

                {/* Journey / Node */}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {row.journey_id ? (
                    <a href={`/journeys?id=${row.journey_id}`}
                      style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 600, fontSize: 12 }}
                      onClick={e => e.stopPropagation()}>
                      #{row.journey_id}
                    </a>
                  ) : row.source ? (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{row.source}</span>
                  ) : '—'}
                  {row.node_id && (
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 4, display: 'inline-block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.node_id}
                    </span>
                  )}
                </div>

                {/* Sent At */}
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtDate(row.sent_at || row.created_at)}</div>

                {/* Opened / Clicked */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {row.opened_at ? (
                    <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Eye size={10} /> {fmtDate(row.opened_at)}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Not opened</span>
                  )}
                  {row.clicked_at && (
                    <span style={{ fontSize: 11, color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <MousePointerClick size={10} /> {fmtDate(row.clicked_at)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Pagination ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
        {/* Per-page selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rows per page:</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {PAGE_SIZE_OPTIONS.map(n => (
              <button key={n} onClick={() => setLimit(n)}
                style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${limit === n ? 'var(--brand-primary)' : 'var(--border-color)'}`, background: limit === n ? 'color-mix(in srgb, var(--brand-primary) 12%, transparent)' : 'transparent', color: limit === n ? 'var(--brand-primary)' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                {n}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)', marginLeft: 4 }}>
            {data.total > 0 && `${fmt(Math.min((page - 1) * limit + 1, data.total))}–${fmt(Math.min(page * limit, data.total))} of ${fmt(data.total)}`}
          </span>
        </div>

        {/* Page nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setPage(1)} disabled={page === 1}
            style={pageBtn(page === 1)}>«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={pageBtn(page === 1)}><ChevronLeft size={14} /> Prev</button>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '4px 10px' }}>
            {page} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={pageBtn(page === totalPages)}>Next <ChevronRight size={14} /></button>
          <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
            style={pageBtn(page === totalPages)}>»</button>
        </div>
      </div>
    </div>
  );
}

const chipStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' };
const chipX = { background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 13, padding: 0, lineHeight: 1, display: 'flex', alignItems: 'center' };

function pageBtn(disabled) {
  return { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 };
}
