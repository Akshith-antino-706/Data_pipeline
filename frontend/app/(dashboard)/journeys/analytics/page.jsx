'use client';

/**
 * Journey Analytics — dedicated tab.
 *
 * Journey-level rows come from the precomputed journey_node_stats rollup (cumulative,
 * refreshed every 30 min) → instant, no email_send_log scan. Expanding a journey loads its
 * per-node rows ON DEMAND:
 *   - no date selected → cumulative rollup nodes (with Human / Landed / bot metrics)
 *   - a date selected  → node-breakdown scoped to that Dubai date, showing only the nodes
 *     that actually fired that day (date-scoped delivered/opened/clicked).
 *
 * Metrics: raw → Human (engagement ≥ window after send) → Landed (clicked AND produced a
 * real website GTM event — the hardest human signal).
 */

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import {
  BarChart3, RefreshCw, ChevronRight, ChevronDown, Download, Loader2, Info, Search, X, Calendar,
} from 'lucide-react';
import {
  getJourneyAnalyticsTable, getJourneyAnalyticsNodes, refreshJourneyAnalytics,
} from '@/lib/api';

const fmt = (n) => (Number(n) || 0).toLocaleString('en-US');
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS_COLORS = { active: '#22c55e', completed: '#3b82f6', paused: '#f59e0b', draft: '#94a3b8' };

// `sortField` drives header sorting; null value ⇒ render '—'.
const COLS = [
  { key: 'entries',    label: 'Entries',   tip: 'Unique contacts that entered this journey / reached this node' },
  { key: 'sent',       label: 'Sent',      tip: 'Emails sent (excludes failed/queued)' },
  { key: 'delivered',  label: 'Delivered', tip: 'SES delivery confirmations' },
  { key: 'failed',     label: 'Failed',    tip: 'Recipients whose send failed' },
  { key: 'opened',     label: 'Opened',    tip: 'Unique openers (raw includes email-security scanners); sub-line = human count + bot %' },
  { key: 'openRate',   label: 'Open %',    tip: 'Opened ÷ Delivered' },
  { key: 'clicked',    label: 'Clicked',   tip: 'Unique clickers (raw includes scanners); sub-line = human count + bot %' },
  { key: 'ctr',        label: 'CTOR %',    tip: 'Click-to-Open Rate = Clicked ÷ Opened (of people who opened, how many clicked)' },
  { key: 'landed',     label: 'Landed',    tip: 'Clicked AND produced a real website GTM event — the strongest human signal' },
  { key: 'bounced',      label: 'Bounced',   tip: 'SES bounces' },
  { key: 'unsubscribed', label: 'Unsub',     tip: 'Unsubscribes attributed to this node (from unsubscribe_log) — which email drove the opt-out' },
  { key: 'gtm_events',   label: 'GTM',       tip: 'Website GTM events attributed to this journey/node' },
  { key: 'booked',       label: 'Booked',    tip: 'Entries that exited with a booking (journey-level; per-node not attributable)' },
];

// Raw number + muted "human · bot%" sub-line (sub-line only when human data is present).
function EngagementCell({ raw, human }) {
  const hasHuman = human !== null && human !== undefined;
  const bot = Math.max(0, (raw || 0) - (human || 0));
  return (
    <div style={{ textAlign: 'right', lineHeight: 1.4 }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(raw)}</div>
      {hasHuman && raw > 0 && (
        <>
          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>👤 {fmt(human)}</div>
          {bot > 0 && <div style={{ fontSize: 10.5, color: '#f59e0b', whiteSpace: 'nowrap' }}>🤖 {pct(bot, raw)}%</div>}
        </>
      )}
    </div>
  );
}

function MetricCell({ row, col }) {
  const v = row[col.key];
  if (col.key === 'opened')   return <EngagementCell raw={row.opened}  human={row.human_opened} />;
  if (col.key === 'clicked')  return <EngagementCell raw={row.clicked} human={row.human_clicked} />;
  if (col.key === 'openRate') return <span style={{ color: 'var(--text-secondary)' }}>{pct(row.opened, row.delivered || row.sent)}%</span>;
  if (col.key === 'ctr')      return <span style={{ color: 'var(--text-secondary)' }}>{pct(row.clicked, row.opened)}%</span>;
  if (col.key === 'landed')   return v == null ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
    : <span style={{ color: row.landed > 0 ? '#22c55e' : 'var(--text-tertiary)', fontWeight: row.landed > 0 ? 700 : 400 }}>{fmt(row.landed)}</span>;
  if (col.key === 'failed')   return v == null ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
    : <span style={{ color: v > 0 ? '#ef4444' : 'var(--text-tertiary)', fontWeight: v > 0 ? 600 : 400 }}>{fmt(v)}</span>;
  return <span>{v == null ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : fmt(v)}</span>;
}

export default function JourneyAnalyticsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');   // all | fixed | continuous
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');       // '' = cumulative; YYYY-MM-DD = date-scoped expand
  const [sortKey, setSortKey] = useState('entries');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState({});
  const [refreshingId, setRefreshingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getJourneyAnalyticsTable(statusFilter);
      setRows(res.data?.journeys || []);
      setMeta(res.data?.meta || null);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load analytics');
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  // Changing the date changes what "expand" shows → collapse everything so it reloads fresh.
  useEffect(() => { setExpanded({}); }, [dateFilter]);

  const loadNodes = async (jid) => {
    // One endpoint: cumulative rollup nodes, or (with a date) date-scoped nodes with ALL
    // columns filled for that day. Both come back in the same shape.
    const res = await getJourneyAnalyticsNodes(jid, dateFilter || undefined);
    return (res.data || []).filter(r => r.node_id !== '__ALL__');
  };

  const toggle = async (jid) => {
    if (expanded[jid]) { setExpanded(prev => { const n = { ...prev }; delete n[jid]; return n; }); return; }
    setExpanded(prev => ({ ...prev, [jid]: { loading: true } }));
    try {
      const nodes = await loadNodes(jid);
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, nodes } }));
    } catch (e) {
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, error: e.message } }));
    }
  };

  const refreshOne = async (jid, e) => {
    e.stopPropagation();
    setRefreshingId(jid);
    try {
      await refreshJourneyAnalytics(jid);
      await load();
      if (expanded[jid]) { const nodes = await loadNodes(jid); setExpanded(prev => ({ ...prev, [jid]: { loading: false, nodes } })); }
    } catch { /* surfaced on next load */ } finally { setRefreshingId(null); }
  };

  const isContinuous = (r) => r.journey_type === 'gtm';

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = rows.filter(r => {
      if (q && !(`${r.journey_name || ''} #${r.journey_id}`.toLowerCase().includes(q))) return false;
      if (typeFilter === 'fixed' && isContinuous(r)) return false;
      if (typeFilter === 'continuous' && !isContinuous(r)) return false;
      return true;
    });
    arr = [...arr].sort((a, b) => {
      let av, bv;
      if (sortKey === 'openRate') { av = pct(a.opened, a.delivered || a.sent); bv = pct(b.opened, b.delivered || b.sent); }
      else if (sortKey === 'ctr') { av = pct(a.clicked, a.opened); bv = pct(b.clicked, b.opened); }
      else if (sortKey === 'name') { av = a.journey_name || ''; bv = b.journey_name || ''; return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }
      else { av = Number(a[sortKey]) || 0; bv = Number(b[sortKey]) || 0; }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [rows, search, typeFilter, sortKey, sortDir]);

  const setSort = (key) => {
    if (!key) return;
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const exportCsv = () => {
    const headers = ['Journey', 'Status', 'Type', 'Entries', 'Sent', 'Delivered', 'Failed', 'Opened', 'Human Opened', 'Open%', 'Clicked', 'Human Clicked', 'CTOR%', 'Landed', 'Bounced', 'Unsub', 'GTM', 'Booked'];
    const lines = [headers.join(',')];
    for (const r of visible) {
      lines.push([
        `"${(r.journey_name || '').replace(/"/g, '""')}"`, r.journey_status, isContinuous(r) ? 'continuous' : 'fixed',
        r.entries, r.sent, r.delivered, r.failed, r.opened, r.human_opened, pct(r.opened, r.delivered || r.sent),
        r.clicked, r.human_clicked, pct(r.clicked, r.opened), r.landed, r.bounced, r.unsubscribed, r.gtm_events, r.booked,
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `journey-analytics-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const ctrl = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13,
    flex: '0 0 auto', height: 36, boxSizing: 'border-box',
  };
  const btn = { ...ctrl, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };

  const HeadCell = ({ label, sortField, align = 'right', tip }) => (
    <th onClick={() => setSort(sortField)} title={tip}
      style={{
        position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)',
        padding: '10px 12px', textAlign: align, cursor: sortField ? 'pointer' : 'default',
        whiteSpace: 'nowrap', fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase',
        color: 'var(--text-tertiary)', fontWeight: 700, userSelect: 'none', borderBottom: '1px solid var(--border)',
      }}>
      {label}{sortKey === sortField ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  // One <td> per column for a row — shared by journey rows and node rows so columns align.
  const dataCells = (row) => COLS.map(c => (
    <td key={c.key} style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' }}>
      <MetricCell row={row} col={c} />
    </td>
  ));

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <BarChart3 size={22} color="#8b5cf6" />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Journey Analytics</h1>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
        <span title="Cumulative rollup, recomputed every 30 min by a background job">
          <Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Snapshot updated {timeAgo(meta?.last_run_at)}{meta?.journeys_run ? ` · ${meta.journeys_run} journeys` : ''}
        </span>
        <span>👤 Human = engagement ≥ {rows[0]?.bot_window_sec ?? 15}s after send · 🤖 = likely scanner · <span style={{ color: '#22c55e' }}>Landed</span> = reached the website</span>
      </div>

      {/* Filter toolbar — single line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'nowrap', overflowX: 'auto' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search journey or #id…"
            style={{ ...ctrl, paddingLeft: 30, width: 220 }} />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={14} /></button>}
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...ctrl, width: 150 }} title="Journey status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="paused">Paused</option>
          <option value="draft">Draft</option>
        </select>

        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...ctrl, width: 150 }} title="Journey type">
          <option value="all">All types</option>
          <option value="fixed">Fixed / scheduled</option>
          <option value="continuous">Continuous (GTM)</option>
        </select>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '0 0 auto' }}
          title="Pick a date to scope each journey's expanded nodes to what fired that day">
          <Calendar size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            style={{ ...ctrl, paddingLeft: 30, width: 170 }} />
          {dateFilter && <button onClick={() => setDateFilter('')} style={{ position: 'absolute', right: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={14} /></button>}
        </div>

        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flex: '0 0 auto' }}>{visible.length} of {rows.length}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flex: '0 0 auto' }}>
          <button onClick={exportCsv} style={btn}><Download size={14} /> CSV</button>
          <button onClick={load} style={btn}><RefreshCw size={14} /> Reload</button>
        </div>
      </div>

      {dateFilter && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
          <Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Date mode: expanding a journey shows only nodes that sent on {dateFilter}, with every metric scoped to that day's send cohort. (Booked is journey-level, not node-attributable, so it shows —.)
        </div>
      )}

      {error && <div style={{ padding: 14, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div>{[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8, marginBottom: 8 }} />)}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)', width: 32, borderBottom: '1px solid var(--border)' }} />
                <HeadCell label="Journey" sortField="name" align="left" />
                <HeadCell label="Status" sortField={null} align="left" />
                {COLS.map(c => <HeadCell key={c.key} label={c.label} sortField={c.key} tip={c.tip} />)}
                <th style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)', width: 40, borderBottom: '1px solid var(--border)' }} />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={COLS.length + 4} style={{ padding: 28, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  {rows.length === 0
                    ? 'No journeys in the rollup yet — the background job populates it every 30 min (or hit refresh on a journey).'
                    : 'No journeys match the current filters.'}
                </td></tr>
              )}
              {visible.map(r => {
                const exp = expanded[r.journey_id];
                return (
                  <Fragment key={r.journey_id}>
                    {/* Journey row */}
                    <tr onClick={() => toggle(r.journey_id)} className="jrow"
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.journey_name}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.journey_name}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> #{r.journey_id}</span>
                        {isContinuous(r) && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(20,184,166,0.15)', color: '#14b8a6' }}>CONT</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: (STATUS_COLORS[r.journey_status] || '#94a3b8') + '22', color: STATUS_COLORS[r.journey_status] || 'var(--text-secondary)', fontWeight: 600, textTransform: 'capitalize' }}>
                          {r.journey_status}
                        </span>
                      </td>
                      {dataCells(r)}
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <button onClick={(e) => refreshOne(r.journey_id, e)} title="Recompute this journey now"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                          {refreshingId === r.journey_id ? <Loader2 size={14} className="spin" /> : <RefreshCw size={13} />}
                        </button>
                      </td>
                    </tr>

                    {/* Node rows — same columns as the parent so everything aligns */}
                    {exp && exp.loading && (
                      <tr><td colSpan={COLS.length + 4} style={{ padding: 12, background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                        <Loader2 size={13} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} /> Loading nodes…
                      </td></tr>
                    )}
                    {exp && exp.error && (
                      <tr><td colSpan={COLS.length + 4} style={{ padding: 12, background: 'var(--bg-secondary)', color: '#ef4444' }}>{exp.error}</td></tr>
                    )}
                    {exp && exp.nodes && exp.nodes.length === 0 && (
                      <tr><td colSpan={COLS.length + 4} style={{ padding: 12, background: 'var(--bg-secondary)', color: 'var(--text-tertiary)' }}>
                        {dateFilter ? `No node fired on ${dateFilter}.` : 'No node-level rows.'}
                      </td></tr>
                    )}
                    {exp && exp.nodes && exp.nodes.map(n => (
                      <tr key={n.node_id} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                        <td />
                        <td style={{ padding: '8px 12px 8px 26px', color: 'var(--text-secondary)', maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={n.node_label}>
                          ↳ {n.node_label} <span style={{ color: 'var(--text-tertiary)' }}>({n.node_type})</span>
                        </td>
                        <td />
                        {dataCells(n)}
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .jrow:hover { background: var(--bg-secondary); }
      `}</style>
    </div>
  );
}
