'use client';

/**
 * Journey Archive — completed journeys that were exported to S3 (read-only).
 *
 * Everything here comes from the archive files in S3 via /api/v3/journey-archive — never the
 * live DB. The list shows each journey's final rollup (the '__ALL__' journey_node_stats row);
 * expanding a journey loads its flow (nodes/edges in flow order) with per-node stats, plus
 * signed download links for every archived table (gzipped CSV, link valid 15 min).
 */

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import {
  Archive, RefreshCw, ChevronRight, ChevronDown, Download, Loader2, Info, Search, X, ArrowRight, Eye, AlertTriangle,
} from 'lucide-react';
import { getArchivedJourneys, getArchivedJourney, getArchivedTableDownload, getArchivedNodeEmail } from '@/lib/api';

const fmt = (n) => (n == null ? '—' : (Number(n) || 0).toLocaleString('en-US'));
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
const fmtBytes = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const archiveBytes = (j) => Object.values(j.manifest?.tables || {}).reduce((s, t) => s + (Number(t.gz_bytes) || 0), 0);

// Same wording as the journey builder: 0.0833 days → "2 hours", 1 → "1 day".
const formatWait = (waitDays) => {
  const mins = Math.round((parseFloat(waitDays) || 0) * 1440);
  if (mins <= 0) return '0 min';
  if (mins < 60) return `${mins} min`;
  if (mins < 1440) { const h = mins / 60; return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`; }
  const d = mins / 1440;
  return `${Number.isInteger(d) ? d : +d.toFixed(2)} day${d === 1 ? '' : 's'}`;
};

// Nodes in flow order: walk edges from the trigger; anything unreachable goes last.
function orderNodes(nodes, edges) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const next = {};
  for (const e of edges) (next[e.source] ||= []).push(e.target);
  const start = nodes.find(n => n.type === 'trigger') || nodes[0];
  const seen = new Set(); const out = [];
  const queue = start ? [start.id] : [];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !byId[id]) continue;
    seen.add(id); out.push(byId[id]);
    queue.push(...(next[id] || []));
  }
  return [...out, ...nodes.filter(n => !seen.has(n.id))];
}

const nodeCaption = (n) => {
  const d = n.data || {};
  if (n.type === 'wait') return `Wait ${formatWait(d.waitDays)}`;
  if (n.type === 'trigger') return d.segmentId ? `Segment ${d.segmentId}` : (d.triggerType || 'Entry');
  return [d.channel, d.sendHour && `@ ${d.sendHour}`].filter(Boolean).join(' ');
};

const isEmailNode = (n) => n.type === 'action' && (n.data?.channel || 'email').toLowerCase() === 'email';

const TYPE_COLORS = { trigger: '#8b5cf6', action: '#3b82f6', wait: '#f59e0b', condition: '#14b8a6' };

const COLS = [
  { key: 'entries',      label: 'Entries' },
  { key: 'sent',         label: 'Sent' },
  { key: 'opened',       label: 'Opened' },
  { key: 'openRate',     label: 'Open %', tip: 'Opened ÷ Delivered (or Sent when delivery was not tracked)' },
  { key: 'clicked',      label: 'Clicked' },
  { key: 'ctr',          label: 'CTOR %', tip: 'Clicked ÷ Opened' },
  { key: 'unsubscribed', label: 'Unsub' },
  { key: 'failed',       label: 'Failed' },
  { key: 'booked',       label: 'Booked' },
];

function metric(row, key) {
  if (!row) return '—';
  if (key === 'openRate') return `${pct(row.opened, row.delivered || row.sent)}%`;
  if (key === 'ctr') return `${pct(row.clicked, row.opened)}%`;
  return fmt(row[key]);
}

// Preview of the email one node sent — template subject/HTML as archived, the subjects actually
// sent with dates, and a warning when the template was edited after the node's last send.
// The HTML renders in a sandboxed iframe (no scripts, no same-origin access).
function NodeEmailModal({ journeyId, node, onClose }) {
  const [state, setState] = useState({ loading: true });
  const [view, setView] = useState('html');

  useEffect(() => {
    getArchivedNodeEmail(journeyId, node.id)
      .then(res => setState({ loading: false, data: res.data }))
      .catch(e => setState({ loading: false, error: e.message }));
  }, [journeyId, node.id]);

  const d = state.data;
  const t = d?.template;
  const html = d?.stored_email?.html || t?.html_body || t?.body || '';
  const subject = d?.stored_email?.subject || d?.subjects?.[0]?.subject || t?.html_subject_line || t?.subject || '—';
  const editedAfter = t && d?.last_sent_at && new Date(t.html_updated_at || t.updated_at) > new Date(d.last_sent_at);
  const label = { fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 700 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} className="card"
        style={{ width: 'min(980px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', background: 'var(--card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Eye size={16} color="#8b5cf6" />
          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {node.data?.label || node.id} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>· {node.id}{d?.send_hour ? ` · @ ${d.send_hour}` : ''}</span>
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        {state.loading && <div style={{ padding: 24, color: 'var(--text-tertiary)' }}><Loader2 size={14} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} /> Loading email from archive…</div>}
        {state.error && <div style={{ padding: 24, color: '#ef4444' }}>{state.error}</div>}

        {d && (
          <div style={{ overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div><div style={label}>Template</div><div style={{ color: 'var(--text-primary)' }}>{t ? `${t.name} #${t.id}` : (d.template_id ? `#${d.template_id} (not found)` : '—')}</div></div>
              <div><div style={label}>Emails sent</div><div style={{ color: 'var(--text-primary)' }}>{fmt(d.emails)}</div></div>
              <div><div style={label}>Sent on</div><div style={{ color: 'var(--text-primary)' }}>{d.first_sent_at ? `${fmtDate(d.first_sent_at)}${fmtDate(d.last_sent_at) !== fmtDate(d.first_sent_at) ? ` → ${fmtDate(d.last_sent_at)}` : ''}` : '—'}</div></div>
              <div><div style={label}>Template last edited</div><div style={{ color: 'var(--text-primary)' }}>{t ? fmtDate(t.html_updated_at || t.updated_at) : '—'}</div></div>
            </div>

            {d.stored_email ? (
              <div style={{ fontSize: 12, color: '#22c55e' }}><Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Exact email as sent (frozen at send time).</div>
            ) : editedAfter ? (
              <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                This template was edited after this node&apos;s last send — the preview shows the newer version, not exactly what was sent. The subjects below are what was actually sent.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}><Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Template as sent; personal fields ({'{{ … }}'}) were filled per contact at send time.</div>
            )}

            <div>
              <div style={label}>Subject{d.subjects?.length > 1 ? 's sent' : ''}</div>
              {d.subjects?.length ? d.subjects.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, color: 'var(--text-primary)' }}>{s.subject || '—'}</span>
                  <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{fmt(s.emails)} · {fmtDate(s.first_sent_at)}</span>
                </div>
              )) : <div style={{ color: 'var(--text-primary)' }}>{subject}</div>}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {['html', 'source'].map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', background: view === v ? 'var(--bg-secondary)' : 'transparent', color: 'var(--text-primary)', fontWeight: view === v ? 700 : 400 }}>
                  {v === 'html' ? 'Preview' : 'HTML source'}
                </button>
              ))}
            </div>
            {!html ? (
              <div style={{ color: 'var(--text-tertiary)' }}>No HTML stored for this template.</div>
            ) : view === 'html' ? (
              <iframe title="Email preview" sandbox="" srcDoc={html}
                style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
            ) : (
              <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 11.5, padding: 12, borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{html}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JourneyArchivePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [expanded, setExpanded] = useState({});
  const [downloading, setDownloading] = useState(null);
  const [preview, setPreview] = useState(null);   // { journeyId, node }

  const load = useCallback(async (fresh) => {
    setLoading(true);
    try {
      const res = await getArchivedJourneys(fresh);
      setRows(res.data || []);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load the archive');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => [...new Set(rows.map(r => r.completed_month))].sort().reverse(), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (!month || r.completed_month === month) &&
      (!q || `${r.name || ''} #${r.journey_id}`.toLowerCase().includes(q)));
  }, [rows, search, month]);

  const toggle = async (jid) => {
    if (expanded[jid]) { setExpanded(prev => { const n = { ...prev }; delete n[jid]; return n; }); return; }
    setExpanded(prev => ({ ...prev, [jid]: { loading: true } }));
    try {
      const res = await getArchivedJourney(jid);
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, data: res.data } }));
    } catch (e) {
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, error: e.message } }));
    }
  };

  const download = async (jid, table) => {
    setDownloading(`${jid}:${table}`);
    try {
      const res = await getArchivedTableDownload(jid, table);
      window.location.href = res.data.url;   // signed S3 link — the browser downloads directly from S3
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    } finally { setDownloading(null); }
  };

  const ctrl = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13,
    flex: '0 0 auto', height: 36, boxSizing: 'border-box',
  };
  const btn = { ...ctrl, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' };
  const th = {
    position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-secondary)', padding: '10px 12px',
    whiteSpace: 'nowrap', fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase',
    color: 'var(--text-tertiary)', fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'right',
  };
  const td = { padding: '10px 12px', textAlign: 'right', color: 'var(--text-primary)' };
  const colSpan = COLS.length + 4;

  const renderDetail = (d) => {
    const statById = Object.fromEntries((d.nodes || []).map(s => [s.node_id, s]));
    const flow = orderNodes(d.flow.nodes || [], d.flow.edges || []);
    const tables = Object.entries(d.manifest?.tables || {});
    const section = { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '18px 0 8px' };

    return (
      <div style={{ padding: '6px 20px 20px 44px' }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
          <span>Created {fmtDate(d.flow.created_at)}</span>
          <span>Last updated {fmtDate(d.flow.updated_at)}</span>
          {d.flow.custom_segment_id && <span>Custom segment #{d.flow.custom_segment_id}</span>}
          <span>Archived {fmtDate(d.manifest?.exported_at)}</span>
        </div>
        {d.flow.description && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>{d.flow.description}</div>}

        <div style={section}>Flow</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {flow.map((n, i) => (
            <Fragment key={n.id}>
              {i > 0 && <ArrowRight size={13} color="var(--text-tertiary)" />}
              <div title={n.id} style={{
                padding: '6px 10px', borderRadius: 8, background: 'var(--card)', fontSize: 12,
                border: `1px solid ${(TYPE_COLORS[n.type] || '#94a3b8')}55`, borderLeft: `3px solid ${TYPE_COLORS[n.type] || '#94a3b8'}`,
              }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{n.data?.label || n.id}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{nodeCaption(n)}</div>
              </div>
            </Fragment>
          ))}
        </div>

        <div style={section}>Per-node results</div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', width: 40 }}>#</th>
                <th style={{ ...th, textAlign: 'left' }}>Node</th>
                <th style={{ ...th, textAlign: 'center' }} title="Preview the email this node sent">Email</th>
                {COLS.filter(c => c.key !== 'booked').map(c => <th key={c.key} style={th} title={c.tip}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {flow.map((n, i) => {
                const s = statById[n.id];
                return (
                  <tr key={n.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--text-tertiary)' }}>{i + 1}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      {n.data?.label || n.id} <span style={{ color: 'var(--text-tertiary)' }}>({nodeCaption(n)})</span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {isEmailNode(n) && (
                        <button onClick={() => setPreview({ journeyId: d.journey_id, node: n })} disabled={!d.has_templates}
                          title={d.has_templates ? 'Preview the email this node sent' : 'Email templates not archived for this journey yet (added by the next archive run)'}
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-tertiary)', cursor: d.has_templates ? 'pointer' : 'not-allowed', opacity: d.has_templates ? 1 : 0.4 }}>
                          <Eye size={14} />
                        </button>
                      )}
                    </td>
                    {COLS.filter(c => c.key !== 'booked').map(c => <td key={c.key} style={td}>{metric(s, c.key)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={section}>Archived data</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tables.map(([t, info]) => {
            const busy = downloading === `${d.journey_id}:${t}`;
            const empty = !Number(info.rows);
            return (
              <button key={t} onClick={() => download(d.journey_id, t)} disabled={busy || empty}
                title={empty ? 'No rows' : 'Download gzipped CSV (link valid 15 min)'}
                style={{ ...btn, height: 'auto', padding: '8px 12px', opacity: empty ? 0.5 : 1, cursor: empty ? 'default' : 'pointer' }}>
                {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                <span style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{t}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmt(info.rows)} rows · {fmtBytes(info.gz_bytes)}</div>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Archive size={22} color="#8b5cf6" />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Journey Archive</h1>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
        <Info size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
        Completed journeys moved to S3 storage. Read-only — numbers are the journey&apos;s final results at the time it was archived.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'nowrap', overflowX: 'auto' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search journey or #id…"
            style={{ ...ctrl, paddingLeft: 30, width: 220 }} />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={14} /></button>}
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...ctrl, width: 170 }} title="Month the journey completed">
          <option value="">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flex: '0 0 auto' }}>{visible.length} of {rows.length}</span>
        <div style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
          <button onClick={() => load(true)} style={btn}><RefreshCw size={14} /> Reload</button>
        </div>
      </div>

      {error && <div style={{ padding: 14, borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#ef4444', marginBottom: 16 }}>{error}</div>}

      {loading ? (
        <div>{[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8, marginBottom: 8 }} />)}</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 32 }} />
                <th style={{ ...th, textAlign: 'left' }}>Journey</th>
                <th style={{ ...th, textAlign: 'left' }}>Completed</th>
                {COLS.map(c => <th key={c.key} style={th} title={c.tip}>{c.label}</th>)}
                <th style={th} title="Compressed size of all archived files">Archive</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={colSpan} style={{ padding: 28, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  {rows.length === 0 ? 'No journeys have been archived yet.' : 'No archived journeys match the current filters.'}
                </td></tr>
              )}
              {visible.map(r => {
                const exp = expanded[r.journey_id];
                return (
                  <Fragment key={r.journey_id}>
                    <tr onClick={() => toggle(r.journey_id)} className="jrow" style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                      <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                        {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</span>
                        <span style={{ color: 'var(--text-tertiary)' }}> #{r.journey_id}</span>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{monthLabel(r.completed_month)}</td>
                      {COLS.map(c => <td key={c.key} style={td}>{metric(r.summary, c.key)}</td>)}
                      <td style={{ ...td, color: 'var(--text-secondary)' }}>{fmtBytes(archiveBytes(r))}</td>
                    </tr>
                    {exp && (
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={colSpan} style={{ padding: 0 }}>
                          {exp.loading && <div style={{ padding: 14, color: 'var(--text-tertiary)' }}><Loader2 size={13} className="spin" style={{ verticalAlign: -2, marginRight: 6 }} /> Loading from archive…</div>}
                          {exp.error && <div style={{ padding: 14, color: '#ef4444' }}>{exp.error}</div>}
                          {exp.data && renderDetail(exp.data)}
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

      {preview && <NodeEmailModal journeyId={preview.journeyId} node={preview.node} onClose={() => setPreview(null)} />}

      <style jsx>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .jrow:hover { background: var(--bg-secondary); }
      `}</style>
    </div>
  );
}
