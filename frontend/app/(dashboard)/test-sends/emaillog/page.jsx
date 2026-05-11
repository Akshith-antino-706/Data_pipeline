'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardList, Search, X, Loader2, ChevronLeft, ChevronRight, ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

export default function EmailLogPage() {
  const [logs, setLogs] = useState([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('');
  const debounceRef = useRef(null);

  const loadLogs = useCallback(async (page = 1, search = '', status = '') => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (search.trim()) params.set('email', search.trim());
      if (status) params.set('status', status);
      const data = await apiGet(`/api/v3/test-sends/send-log?${params}`);
      setLogs(data.rows || []);
      setLogTotal(data.total || 0);
      setLogPage(data.page || 1);
    } catch { setLogs([]); }
    setLogsLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadLogs(1, logSearch, logStatusFilter);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [logSearch, logStatusFilter, loadLogs]);

  const totalPages = Math.ceil(logTotal / 20);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/test-sends" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--card)',
            color: 'var(--muted-foreground)', cursor: 'pointer', textDecoration: 'none',
          }}>
            <ArrowLeft size={16} />
          </Link>
          <ClipboardList size={22} style={{ color: '#e2b340' }} />
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Email Send Logs</h1>
            {logTotal > 0 && (
              <p style={{ fontSize: 13, color: 'var(--muted-foreground)', margin: 0 }}>
                {logTotal} record{logTotal !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => loadLogs(logPage, logSearch, logStatusFilter)}
          style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '9px 16px',
            fontSize: 13, color: 'var(--foreground)', cursor: 'pointer', fontWeight: 600,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap',
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', padding: '14px 18px',
      }}>
        <div style={{
          flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--background)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '8px 12px',
        }}>
          <Search size={14} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
          <input
            type="text"
            value={logSearch}
            onChange={e => setLogSearch(e.target.value)}
            placeholder="Search by email..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--foreground)',
            }}
          />
          {logSearch && (
            <X size={12} style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }}
              onClick={() => setLogSearch('')} />
          )}
        </div>
        <select
          value={logStatusFilter}
          onChange={e => setLogStatusFilter(e.target.value)}
          style={{
            padding: '8px 14px', fontSize: 13, minWidth: 140,
            background: 'var(--background)', color: 'var(--foreground)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          }}
        >
          <option value="">All Statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', overflow: 'hidden',
      }}>
        {logsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 64 }}>
            <Loader2 size={24} className="spin" style={{ color: 'var(--muted-foreground)' }} />
          </div>
        ) : logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 64, color: 'var(--muted-foreground)', fontSize: 14 }}>
            No send logs found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Status', 'Email', 'Template', 'Sent At', 'Opened', 'Clicked', 'Duration'].map(h => (
                    <th key={h} style={{
                      padding: '10px 12px', textAlign: 'left', fontSize: 11,
                      fontWeight: 600, color: 'var(--muted-foreground)',
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((row, i) => {
                  const statusCfg = {
                    queued:  { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
                    sent:    { bg: 'rgba(59,130,246,0.15)',  color: '#3b82f6' },
                    failed:  { bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' },
                    opened:  { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
                    clicked: { bg: 'rgba(168,85,247,0.15)',  color: '#a855f7' },
                  }[row.status] || { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
                  return (
                    <tr key={row.id} style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          background: statusCfg.bg, color: statusCfg.color,
                          fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                        }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 500 }}>{row.email}</div>
                        {row.contact_name && (
                          <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{row.contact_name}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)' }}>
                        {row.template_label || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)', fontSize: 12 }}>
                        {row.sent_at ? new Date(row.sent_at).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {row.opened_at ? (
                          <span style={{ color: '#22c55e', fontWeight: 600 }}>
                            {new Date(row.opened_at).toLocaleString()}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {row.clicked_at ? (
                          <span style={{ color: '#a855f7', fontWeight: 600 }}>
                            {new Date(row.clicked_at).toLocaleString()}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--muted-foreground)', fontSize: 12 }}>
                        {row.duration_ms != null ? `${row.duration_ms}ms` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {logTotal > 20 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 18px', borderTop: '1px solid var(--border)',
            fontSize: 13, color: 'var(--muted-foreground)',
          }}>
            <span>Page {logPage} of {totalPages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => loadLogs(logPage - 1, logSearch, logStatusFilter)}
                disabled={logPage <= 1}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '5px 12px',
                  cursor: logPage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: logPage <= 1 ? 0.4 : 1, color: 'var(--foreground)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                onClick={() => loadLogs(logPage + 1, logSearch, logStatusFilter)}
                disabled={logPage >= totalPages}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '5px 12px',
                  cursor: logPage >= totalPages ? 'not-allowed' : 'pointer',
                  opacity: logPage >= totalPages ? 0.4 : 1, color: 'var(--foreground)',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
