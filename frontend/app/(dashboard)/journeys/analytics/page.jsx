'use client';

/**
 * Journey Analytics — dedicated tab.
 *
 * Reads the precomputed journey_node_stats rollup (via /journeys/analytics/*). This is
 * intentionally NOT live: the backend cron refreshes the rollup every 30 min, so this
 * page loads a small flat table in milliseconds regardless of how big a journey is
 * (J332 with 1.3M entries reads as fast as a tiny one). Nothing here scans email_send_log.
 *
 * Metrics: raw → Human (bot-filtered: engagement ≥ window after send) → Landed (clicked
 * AND produced a real website GTM event — the hardest human signal).
 */

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import {
  BarChart3, RefreshCw, ChevronRight, ChevronDown, Download, Loader2, Bot, Info,
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

const STATUS_COLORS = {
  active: '#22c55e', completed: '#3b82f6', paused: '#f59e0b', draft: '#94a3b8',
};

// Column definitions — shared by journey rows and node rows.
const COLS = [
  { key: 'entries',   label: 'Entries',   tip: 'Unique contacts that entered this journey / reached this node' },
  { key: 'sent',      label: 'Sent',      tip: 'Emails sent (excludes failed/queued)' },
  { key: 'delivered', label: 'Delivered', tip: 'SES delivery confirmations' },
  { key: 'opened',    label: 'Opened',    tip: 'Unique openers (raw — includes email-security scanners)' },
  { key: 'openRate',  label: 'Open %',    derived: true },
  { key: 'clicked',   label: 'Clicked',   tip: 'Unique clickers (raw — includes scanners)' },
  { key: 'ctr',       label: 'CTR %',     derived: true },
  { key: 'landed',    label: 'Landed',    tip: 'Clicked AND produced a real website GTM event — the strongest human signal' },
  { key: 'bounced',   label: 'Bounced',   tip: 'SES bounces' },
  { key: 'gtm_events',label: 'GTM',       tip: 'Website GTM events attributed to this journey/node' },
  { key: 'booked',    label: 'Booked',    tip: 'Entries that exited with a booking' },
];

function EngagementCell({ raw, human, botLabel }) {
  const bot = Math.max(0, (raw || 0) - (human || 0));
  const botPct = pct(bot, raw);
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div style={{ fontWeight: 600 }}>{fmt(raw)}</div>
      {raw > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span title="Human (bot-filtered)">👤 {fmt(human)}</span>
          {bot > 0 && (
            <span title={`${botLabel} likely from scanners`} style={{ color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Bot size={11} />{botPct}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCell({ row, col }) {
  if (col.key === 'opened')  return <EngagementCell raw={row.opened}  human={row.human_opened}  botLabel="opens" />;
  if (col.key === 'clicked') return <EngagementCell raw={row.clicked} human={row.human_clicked} botLabel="clicks" />;
  if (col.key === 'openRate') return <span>{pct(row.opened, row.delivered || row.sent)}%</span>;
  if (col.key === 'ctr')      return <span>{pct(row.clicked, row.opened)}%</span>;
  if (col.key === 'landed')   return <span style={{ color: row.landed > 0 ? '#22c55e' : 'inherit', fontWeight: row.landed > 0 ? 600 : 400 }}>{fmt(row.landed)}</span>;
  return <span>{fmt(row[col.key])}</span>;
}

export default function JourneyAnalyticsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState('entries');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState({}); // journeyId -> { loading, nodes, error }
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

  const toggle = async (jid) => {
    setExpanded(prev => {
      if (prev[jid]) { const n = { ...prev }; delete n[jid]; return n; }
      return { ...prev, [jid]: { loading: true } };
    });
    if (expanded[jid]) return;
    try {
      const res = await getJourneyAnalyticsNodes(jid);
      const nodes = (res.data || []).filter(r => r.node_id !== '__ALL__');
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
      if (expanded[jid]) {
        const res = await getJourneyAnalyticsNodes(jid);
        setExpanded(prev => ({ ...prev, [jid]: { loading: false, nodes: (res.data || []).filter(r => r.node_id !== '__ALL__') } }));
      }
    } catch { /* surfaced on next load */ } finally { setRefreshingId(null); }
  };

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av, bv;
      if (sortKey === 'openRate') { av = pct(a.opened, a.delivered || a.sent); bv = pct(b.opened, b.delivered || b.sent); }
      else if (sortKey === 'ctr') { av = pct(a.clicked, a.opened); bv = pct(b.clicked, b.opened); }
      else if (sortKey === 'name') { av = a.journey_name || ''; bv = b.journey_name || ''; return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }
      else { av = Number(a[sortKey]) || 0; bv = Number(b[sortKey]) || 0; }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const setSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const exportCsv = () => {
    const headers = ['Journey', 'Status', 'Entries', 'Sent', 'Delivered', 'Opened', 'Human Opened', 'Open%', 'Clicked', 'Human Clicked', 'CTR%', 'Landed', 'Bounced', 'GTM', 'Booked'];
    const lines = [headers.join(',')];
    for (const r of sorted) {
      lines.push([
        `"${(r.journey_name || '').replace(/"/g, '""')}"`, r.journey_status,
        r.entries, r.sent, r.delivered, r.opened, r.human_opened, pct(r.opened, r.delivered || r.sent),
        r.clicked, r.human_clicked, pct(r.clicked, r.opened), r.landed, r.bounced, r.gtm_events, r.booked,
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `journey-analytics-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const th = (label, key, tip) => (
    <th
      onClick={key ? () => setSort(key) : undefined}
      title={tip}
      style={{ padding: '10px 12px', textAlign: key && key !== 'name' ? 'right' : 'left', cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted, #64748b)', fontWeight: 600, userSelect: 'none' }}
    >
      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={22} />
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Journey Analytics</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--card-bg, #fff)', fontSize: 13 }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="paused">Paused</option>
            <option value="draft">Draft</option>
          </select>
          <button onClick={exportCsv} className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--card-bg, #fff)', fontSize: 13, cursor: 'pointer' }}>
            <Download size={14} /> CSV
          </button>
          <button onClick={load} className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)', background: 'var(--card-bg, #fff)', fontSize: 13, cursor: 'pointer' }}>
            <RefreshCw size={14} /> Reload
          </button>
        </div>
      </div>

      {/* Freshness + legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18, fontSize: 12, color: 'var(--text-muted, #64748b)', flexWrap: 'wrap' }}>
        <span title="The rollup is recomputed every 30 minutes by a background job">
          <Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Snapshot updated {timeAgo(meta?.last_run_at)}{meta?.journeys_run ? ` · ${meta.journeys_run} journeys` : ''}
        </span>
        <span>👤 Human = engagement ≥ {rows[0]?.bot_window_sec ?? 15}s after send · <Bot size={11} style={{ verticalAlign: -1 }} /> = likely scanner · <span style={{ color: '#22c55e' }}>Landed</span> = reached the website</span>
      </div>

      {error && <div style={{ padding: 14, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div>
          {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8, marginBottom: 8 }} />)}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border, #e2e8f0)', borderRadius: 12, background: 'var(--card-bg, #fff)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1000 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border, #e2e8f0)' }}>
                <th style={{ width: 30 }} />
                {th('Journey', 'name')}
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted, #64748b)', fontWeight: 600 }}>Status</th>
                {COLS.map(c => th(c.label, c.key, c.tip))}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={COLS.length + 4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                  No journeys in the rollup yet — the background job populates it every 30 min (or hit refresh on a journey).
                </td></tr>
              )}
              {sorted.map(r => {
                const exp = expanded[r.journey_id];
                return (
                  <Fragment key={r.journey_id}>
                    <tr onClick={() => toggle(r.journey_id)}
                      style={{ borderBottom: '1px solid var(--border, #f1f5f9)', cursor: 'pointer' }}>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={r.journey_name}>
                        {r.journey_name} <span style={{ color: 'var(--text-muted, #cbd5e1)', fontWeight: 400 }}>#{r.journey_id}</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: (STATUS_COLORS[r.journey_status] || '#94a3b8') + '22', color: STATUS_COLORS[r.journey_status] || '#64748b', fontWeight: 600 }}>
                          {r.journey_status}
                        </span>
                      </td>
                      {COLS.map(c => (
                        <td key={c.key} style={{ padding: '10px 12px', textAlign: 'right' }}><MetricCell row={r} col={c} /></td>
                      ))}
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <button onClick={(e) => refreshOne(r.journey_id, e)} title="Recompute this journey now"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted, #94a3b8)' }}>
                          {refreshingId === r.journey_id ? <Loader2 size={14} className="spin" /> : <RefreshCw size={13} />}
                        </button>
                      </td>
                    </tr>
                    {exp && (
                      <tr>
                        <td colSpan={COLS.length + 4} style={{ padding: 0, background: 'var(--bg-subtle, #f8fafc)' }}>
                          {exp.loading ? (
                            <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted, #64748b)' }}>
                              <Loader2 size={14} className="spin" /> Loading nodes…
                            </div>
                          ) : exp.error ? (
                            <div style={{ padding: 14, color: '#b91c1c' }}>{exp.error}</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                              <tbody>
                                {(exp.nodes || []).map(n => (
                                  <tr key={n.node_id} style={{ borderBottom: '1px solid var(--border, #eef2f6)' }}>
                                    <td style={{ width: 30 }} />
                                    <td style={{ padding: '8px 12px', paddingLeft: 30, color: 'var(--text-muted, #475569)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={n.node_label}>
                                      ↳ {n.node_label} <span style={{ color: '#cbd5e1' }}>({n.node_type})</span>
                                    </td>
                                    <td />
                                    {COLS.map(c => (
                                      <td key={c.key} style={{ padding: '8px 12px', textAlign: 'right' }}><MetricCell row={n} col={c} /></td>
                                    ))}
                                    <td />
                                  </tr>
                                ))}
                                {(!exp.nodes || exp.nodes.length === 0) && (
                                  <tr><td colSpan={COLS.length + 4} style={{ padding: 12, color: 'var(--text-muted, #94a3b8)' }}>No node-level rows.</td></tr>
                                )}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
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
        tbody tr:hover { background: var(--bg-subtle, #f8fafc); }
      `}</style>
    </div>
  );
}
