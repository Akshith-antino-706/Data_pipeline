'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { authFetch } from '@/lib/api';
import { Button, Card, Chip, EmptyState, PageHeader, Select, Skeleton, Table } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from '../sends.module.css';
import type { SendLogPage, SendLogRow } from '@/types/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function apiGet(path: string): Promise<unknown> {
  const res = await authFetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({})) as { error?: string; data?: unknown };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data || data;
}

const STATUS_TONE: Record<string, ChipTone> = {
  queued: 'mute', sent: 'info', failed: 'bad', opened: 'ok', clicked: 'gold',
};

export default function EmailLogPage() {
  const [logs, setLogs] = useState<SendLogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLogs = useCallback(async (page = 1, search = '', status = '') => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 } as unknown as Record<string, string>);
      if (search.trim()) params.set('email', search.trim());
      if (status) params.set('status', status);
      const data = await apiGet(`/api/v3/test-sends/send-log?${params}`) as Partial<SendLogPage>;
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
    return () => clearTimeout(debounceRef.current!);
  }, [logSearch, logStatusFilter, loadLogs]);

  const totalPages = Math.ceil(logTotal / 20);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Email Send Logs"
        breadcrumbs={[{ label: 'Sends' }, { label: 'Test Sends', href: '/test-sends' }, { label: 'Email logs' }]}
        description={logTotal > 0 ? `${logTotal} record${logTotal !== 1 ? 's' : ''}` : undefined}
        actions={
          <Button onClick={() => loadLogs(logPage, logSearch, logStatusFilter)}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
        }
      />

      <Card>
        <div className={styles.filters}>
          <div className={styles.search}>
            <Search size={16} className={styles.muted} aria-hidden="true" />
            <input
              type="text"
              className={styles.searchInput}
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
              placeholder="Search by email..."
              aria-label="Search logs by email"
            />
            {logSearch && (
              <button type="button" className={styles.iconBtn} aria-label="Clear search" onClick={() => setLogSearch('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <Select
            className={styles.statusSelect}
            aria-label="Filter by status"
            value={logStatusFilter}
            onChange={e => setLogStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="sent">Sent</option>
            <option value="opened">Opened</option>
            <option value="clicked">Clicked</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
      </Card>

      <Card>
        {logsLoading ? (
          <div className={styles.skeletons} aria-busy="true">
            <div className={styles.loadingInline}><Loader2 size={16} className="spin" /> Loading logs…</div>
            {[0, 1, 2, 3, 4, 5].map(k => <Skeleton key={k} height={28} />)}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState title="No send logs found." description="Try a different email or status filter." />
        ) : (
          <Table label="Email send logs">
            <thead>
              <tr>
                {['Status', 'Email', 'Template', 'Sent At', 'Opened', 'Clicked', 'Duration'].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {logs.map(row => (
                <tr key={row.id}>
                  <td className={styles.nowrap}><Chip tone={STATUS_TONE[row.status] ?? 'mute'}>{row.status}</Chip></td>
                  <td>
                    <div className={styles.ellipsis}>{row.email}</div>
                    {row.contact_name && <div className={styles.muted}>{row.contact_name}</div>}
                  </td>
                  <td className={styles.nowrap}>{row.template_label || '—'}</td>
                  <td className={styles.nowrap}>{row.sent_at ? new Date(row.sent_at).toLocaleString() : '—'}</td>
                  <td className={styles.nowrap}>
                    {row.opened_at ? <span className={styles.okText}>{new Date(row.opened_at).toLocaleString()}</span> : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.nowrap}>
                    {row.clicked_at ? <span className={styles.purpleText}>{new Date(row.clicked_at).toLocaleString()}</span> : <span className={styles.muted}>—</span>}
                  </td>
                  <td className={styles.nowrap}>{row.duration_ms != null ? `${row.duration_ms}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {logTotal > 20 && (
          <div className={styles.pager}>
            <span>Page {logPage} of {totalPages}</span>
            <div className={styles.pagerNav}>
              <Button size="sm" onClick={() => loadLogs(logPage - 1, logSearch, logStatusFilter)} disabled={logPage <= 1}>
                <ChevronLeft size={14} aria-hidden="true" /> Prev
              </Button>
              <Button size="sm" onClick={() => loadLogs(logPage + 1, logSearch, logStatusFilter)} disabled={logPage >= totalPages}>
                Next <ChevronRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
