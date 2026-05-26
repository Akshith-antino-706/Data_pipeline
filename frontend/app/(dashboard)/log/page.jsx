'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, MessageCircle, Smartphone, Bell, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, MousePointerClick, XCircle, Clock, Send, AlertCircle, Eye } from 'lucide-react';
import { getSendLog } from '@/lib/api';

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

const STATUS_META = {
  sent:     { label: 'Sent',     color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  icon: Send },
  queued:   { label: 'Queued',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: Clock },
  opened:   { label: 'Opened',   color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  icon: Eye },
  clicked:  { label: 'Clicked',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: MousePointerClick },
  failed:   { label: 'Failed',   color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: XCircle },
  delivered:{ label: 'Delivered',color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',  icon: CheckCircle2 },
};

const fmt = (n) => n == null ? '—' : Number(n).toLocaleString();

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
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

const LIMIT = 50;

export default function LogPage() {
  const [channel, setChannel]         = useState('email');
  const [subFilter, setSubFilter]     = useState('all');
  const [search, setSearch]           = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage]               = useState(1);
  const [data, setData]               = useState({ rows: [], total: 0 });
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // channel filter: email_send_log only has email — other channels return empty
      const params = {
        page,
        limit: LIMIT,
        ...(search        ? { email: search }                     : {}),
        ...(subFilter !== 'all' ? { subscriptionStatus: subFilter } : {}),
      };
      // For non-email channels, skip the API call — no data
      if (channel !== 'all' && channel !== 'email') {
        setData({ rows: [], total: 0 });
        setLoading(false);
        return;
      }
      const res = await getSendLog(params);
      setData(res?.data ?? { rows: [], total: 0 });
    } catch {
      setData({ rows: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, search, subFilter, channel]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [channel, subFilter, search]);

  const totalPages = Math.max(1, Math.ceil(data.total / LIMIT));

  function handleSearch(e) {
    e.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
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

          {/* Refresh */}
          <button onClick={load} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Filters row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Subscription status */}
        <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 10, padding: 3, gap: 2, border: '1px solid var(--border-color)' }}>
          {SUB_FILTERS.map(f => (
            <button key={f.key} onClick={() => setSubFilter(f.key)}
              style={{ padding: '4px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: subFilter === f.key ? 'var(--bg-primary)' : 'transparent', color: subFilter === f.key ? 'var(--text-primary)' : 'var(--text-secondary)', boxShadow: subFilter === f.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', transition: 'all 0.15s' }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Email search */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by email…"
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, width: 220, outline: 'none' }}
          />
          <button type="submit" style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Search
          </button>
          {search && (
            <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }}
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ✕ Clear
            </button>
          )}
        </form>
      </div>

      {/* ── Table ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2.5fr 2fr 100px 120px 130px 130px', gap: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '10px 16px' }}>
          {['Contact', 'Email', 'Subject / Template', 'Status', 'Journey', 'Sent At', 'Opened / Clicked'].map(h => (
            <div key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</div>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />
            <div style={{ marginTop: 8, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</div>
          </div>
        ) : data.rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
            No send logs found
          </div>
        ) : (
          data.rows.map((row, i) => {
            const isUnsubscribed = row.email_unsubscribed === 'Yes';
            return (
              <div key={row.id}
                style={{ display: 'grid', gridTemplateColumns: '2fr 2.5fr 2fr 100px 120px 130px 130px', gap: 0, padding: '11px 16px', borderBottom: i < data.rows.length - 1 ? '1px solid var(--border-color)' : 'none', alignItems: 'center', transition: 'background 0.1s' }}
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

                {/* Journey */}
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {row.journey_id ? (
                    <a href={`/journeys?id=${row.journey_id}`}
                      style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 600 }}
                      onClick={e => e.stopPropagation()}>
                      #{row.journey_id}
                    </a>
                  ) : row.source ? (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{row.source}</span>
                  ) : '—'}
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
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not opened</span>
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
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Page {page} of {totalPages} · {fmt(data.total)} total
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
              <ChevronLeft size={14} /> Prev
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
