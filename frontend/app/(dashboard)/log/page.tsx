'use client';

import { useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Mail, MessageCircle, Smartphone, RefreshCw, ChevronLeft, ChevronRight, Eye, MousePointerClick, Search, X, Copy, Check } from 'lucide-react';
import { getSendLog, getJourneys, getOverviewMessages } from '@/lib/api';
import type { OverviewMessage, OverviewMessagesParams } from '@/lib/api';
import type { SendLogRow } from '@/types/api';
import { Button, Chip, EmptyState, ErrorState, PageHeader, Skeleton, Table, Tabs } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from './log.module.css';
import SearchPicker from './SearchPicker';
import { friendlyError } from '@/lib/friendlyError';
import { nodeLabel } from '@/lib/nodeLabel';

const friendlyText = (raw: string | null | undefined): string => {
  const f = friendlyError(raw);
  return f ? `${f.reason}. ${f.action}` : '—';
};

interface LogNode { id: string; type?: string; data?: { label?: string } }
interface LogJourney { id?: number | string; journey_id?: number | string; name?: string; nodes?: LogNode[] }

type ChannelKey = 'all' | 'email' | 'whatsapp' | 'sms';

const CHANNEL_TABS: { key: ChannelKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'sms', label: 'SMS' },
];

const SUB_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'unsubscribed', label: 'Unsubscribed' },
];

const STATUS_FILTERS = [
  { key: '', label: 'All Status' },
  { key: 'sent', label: 'Sent' },
  { key: 'opened', label: 'Opened' },
  { key: 'clicked', label: 'Clicked' },
  { key: 'failed', label: 'Failed' },
  { key: 'queued', label: 'Queued' },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const STATUS_META: Record<string, { label: string; tone: ChipTone }> = {
  sent: { label: 'Sent', tone: 'info' },
  queued: { label: 'Queued', tone: 'warn' },
  opened: { label: 'Opened', tone: 'ok' },
  clicked: { label: 'Clicked', tone: 'gold' },
  failed: { label: 'Failed', tone: 'bad' },
  delivered: { label: 'Delivered', tone: 'ok' },
  read: { label: 'Read', tone: 'ok' },
};

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString());

/** Shows a copy button on row hover; copies `text` without opening the row. */
function Copyable({ text, children, className }: { text: string | null | undefined; children: React.ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  if (!text) return <span className={className}>{children}</span>;
  const copy = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ }
  };
  return (
    <span className={[styles.copyWrap, className ?? ''].filter(Boolean).join(' ')}>
      {children}
      <button
        type="button"
        className={done ? styles.copyBtnDone : styles.copyBtn}
        aria-label={done ? 'Copied' : `Copy ${text}`}
        title={done ? 'Copied' : 'Copy'}
        onClick={copy}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void copy(e); } }}
      >
        {done ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AE', { timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className={styles.muted}>—</span>;
  const m = STATUS_META[status] ?? { label: status, tone: 'mute' as const };
  return <Chip tone={m.tone} dot>{m.label}</Chip>;
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === 'email') return <Mail size={13} aria-hidden="true" />;
  if (channel === 'whatsapp') return <MessageCircle size={13} aria-hidden="true" />;
  if (channel === 'sms') return <Smartphone size={13} aria-hidden="true" />;
  return null;
}

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' };

type Selected = { kind: 'email'; row: SendLogRow } | { kind: 'unified'; row: OverviewMessage };

type UnifiedState =
  | { state: 'ok'; rows: OverviewMessage[]; total: number | null; days: number | null; capped: boolean }
  | { state: 'unavailable' }
  | { state: 'error'; message: string };

function rowKeyHandler(open: () => void) {
  return (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
}

function DetailDrawer({ selected, onClose }: { selected: Selected; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fields: [string, string][] = selected.kind === 'email'
    ? [
      ['Channel', 'Email'],
      ['ID', String(selected.row.id)],
      ['Contact', selected.row.uc_name || selected.row.contact_name || '—'],
      ['Email', selected.row.email || '—'],
      ['Unsubscribed', selected.row.email_unsubscribed || '—'],
      ['Subject', selected.row.subject || '—'],
      ['Template', selected.row.template_label || '—'],
      ['Status', selected.row.status || '—'],
      ['Why it failed', friendlyText(selected.row.error_message)],
      ['Technical details', selected.row.error_message || '—'],
      ['Journey', selected.row.journey_id != null ? `#${selected.row.journey_id}` : '—'],
      ['Node', nodeLabel(selected.row.node_id) || '—'],
      ['Day number', selected.row.day_number != null ? String(selected.row.day_number) : '—'],
      ['Source', selected.row.source || '—'],
      ['Provider', selected.row.provider || '—'],
      ['External ID', selected.row.external_id || '—'],
      ['Unified contact ID', selected.row.unified_id != null ? String(selected.row.unified_id) : '—'],
      ['Created', fmtDate(selected.row.created_at)],
      ['Sent', fmtDate(selected.row.sent_at)],
      ['Opened', fmtDate(selected.row.opened_at)],
      ['Clicked', fmtDate(selected.row.clicked_at)],
      ['Duration', selected.row.duration_ms != null ? `${fmt(selected.row.duration_ms)} ms` : '—'],
    ]
    : [
      ['Channel', CHANNEL_LABEL[selected.row.channel] ?? selected.row.channel],
      ['ID', String(selected.row.id)],
      ['Contact', selected.row.contactName || '—'],
      ['Recipient', selected.row.recipient || '—'],
      ['Message', selected.row.label || '—'],
      ['Status', selected.row.status || '—'],
      ['Why it failed', friendlyText(selected.row.error)],
      ['Technical details', selected.row.error || '—'],
      ['Journey', selected.row.journeyId != null ? `#${selected.row.journeyId}` : '—'],
      ['Node', nodeLabel(selected.row.nodeId) || '—'],
      ['Time', fmtDate(selected.row.time)],
      ['Opened', fmtDate(selected.row.openedAt)],
      ['Clicked', fmtDate(selected.row.clickedAt)],
    ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Message details" onClick={e => e.stopPropagation()}>
        <div className={styles.drawerHead}>
          <h2>Message details</h2>
          <Button variant="ghost" size="sm" aria-label="Close details" onClick={onClose}><X size={16} /></Button>
        </div>
        <dl className={styles.fields}>
          {fields.map(([k, v]) => (
            <div key={k} className={styles.fieldRow}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}

export default function LogPage() {
  const [channel, setChannel] = useState<ChannelKey>('email');
  const [subFilter, setSubFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [journeyId, setJourneyId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<{ rows: SendLogRow[]; total: number; estimated: boolean; capped: boolean }>({ rows: [], total: 0, estimated: false, capped: false });
  const [unified, setUnified] = useState<UnifiedState>({ state: 'ok', rows: [], total: 0, days: null, capped: false });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Selected | null>(null);

  // Deep links such as /log?channel=all&status=failed (used by Home's "View failed").
  // Read once on mount from window.location so the page needs no Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ch = q.get('channel');
    if (ch === 'all' || ch === 'email' || ch === 'whatsapp' || ch === 'sms') setChannel(ch);
    const st = q.get('status');
    if (st && STATUS_FILTERS.some(f => f.key === st)) setStatusFilter(st);
  }, []);

  // Keep the URL in step with the chosen tab and status, so the address bar is accurate and
  // the view can be shared or bookmarked. replaceState avoids adding history entries.
  const [urlReady, setUrlReady] = useState(false);
  useEffect(() => { setUrlReady(true); }, []);
  useEffect(() => {
    if (!urlReady) return;
    const q = new URLSearchParams(window.location.search);
    if (channel === 'email') q.delete('channel'); else q.set('channel', channel);
    if (statusFilter) q.set('status', statusFilter); else q.delete('status');
    const qs = q.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', next);
  }, [channel, statusFilter, urlReady]);

  const [journeys, setJourneys] = useState<LogJourney[]>([]);
  const [journeyNodes, setJourneyNodes] = useState<LogNode[]>([]);

  const isEmail = channel === 'email';

  useEffect(() => {
    (getJourneys({ limit: 200 }) as Promise<{ data?: { data?: LogJourney[] } & LogJourney[] }>)
      .then(res => setJourneys(res?.data?.data || res?.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!journeyId) { setJourneyNodes([]); setNodeId(''); return; }
    const jny = journeys.find(j => String(j.journey_id || j.id) === String(journeyId));
    const nodes = Array.isArray(jny?.nodes) ? jny.nodes.filter(n => n.type === 'action') : [];
    setJourneyNodes(nodes);
    setNodeId('');
  }, [journeyId, journeys]);

  const activeFilterCount = (isEmail
    ? [statusFilter, search, journeyId, nodeId, subFilter !== 'all' ? subFilter : '']
    : [statusFilter, search, journeyId]).filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (channel === 'email') {
        // Email keeps the original send-log API with all its filters.
        const params = {
          page,
          limit,
          ...(search ? { email: search } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(journeyId ? { journeyId } : {}),
          ...(nodeId ? { nodeId } : {}),
          ...(subFilter !== 'all' ? { subscriptionStatus: subFilter } : {}),
        };
        try {
          const res = await getSendLog(params);
          const d = res?.data;
          setData({ rows: d?.rows ?? [], total: typeof d?.total === 'number' ? d.total : 0, estimated: d?.estimated === true, capped: d?.capped === true });
        } catch {
          setData({ rows: [], total: 0, estimated: false, capped: false });
        }
        return;
      }
      // All / WhatsApp / SMS use the unified overview messages endpoint.
      const jid = Number(journeyId);
      const params: OverviewMessagesParams = {
        page,
        limit,
        ...(channel !== 'all' ? { channel } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search ? { q: search } : {}),
        ...(journeyId && Number.isFinite(jid) ? { journeyId: jid } : {}),
      };
      try {
        const res = await getOverviewMessages(params);
        const m = res?.messages;
        if (!m || !m.available) { setUnified({ state: 'unavailable' }); return; }
        setUnified({
          state: 'ok',
          rows: Array.isArray(m.rows) ? m.rows : [],
          total: typeof res.total === 'number' && Number.isFinite(res.total) ? res.total : null,
          days: typeof res.days === 'number' && Number.isFinite(res.days) ? res.days : null,
          capped: res.capped === true,
        });
      } catch (e) {
        setUnified({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, journeyId, nodeId, subFilter, channel]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [channel, subFilter, statusFilter, search, journeyId, nodeId, limit]);

  // Totals: email always numeric; unified may be null (unknown).
  // A capped total ("10,000+") isn't the real size, so paging becomes open-ended (Next until a short page).
  const capped = isEmail ? data.capped : unified.state === 'ok' && unified.capped;
  const total: number | null = capped ? null : isEmail ? data.total : unified.state === 'ok' ? unified.total : null;
  const rowCount = isEmail ? data.rows.length : unified.state === 'ok' ? unified.rows.length : 0;
  const totalPages = total != null ? Math.max(1, Math.ceil(total / limit)) : null;
  const lastPage = totalPages != null ? page >= totalPages : rowCount < limit;

  function handleSearch(e: FormEvent<HTMLFormElement>) {
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

  const closeDrawer = useCallback(() => setSelected(null), []);

  let headerMeta: string;
  if (loading) headerMeta = 'Loading…';
  else if (isEmail) headerMeta = `${fmt(data.total)}${data.capped ? '+' : ''} records${data.estimated ? ' (estimated)' : ''}`;
  else if (unified.state === 'ok' && unified.total != null) headerMeta = `${fmt(unified.total)}${unified.capped ? '+' : ''} records`;
  else headerMeta = 'Total unavailable';

  const rangeText = capped && rowCount > 0
    ? `${fmt((page - 1) * limit + 1)}–${fmt((page - 1) * limit + rowCount)} of 10,000+`
    : total != null && total > 0
      ? `${fmt(Math.min((page - 1) * limit + 1, total))}–${fmt(Math.min(page * limit, total))} of ${fmt(total)}`
      : total == null && !isEmail ? 'Total unavailable' : '';

  return (
    <div className={styles.page}>
      <PageHeader
        title="Message log"
        meta={
          <span className={styles.headerMeta}>
            <span>{headerMeta}</span>
            {!isEmail && unified.state === 'ok' && unified.days != null && <span className={styles.muted}> · last {unified.days} days</span>}
          </span>
        }
        actions={
          <Button size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? styles.spin : undefined} /> Refresh
          </Button>
        }
      />

      <div className={styles.filters}>
        <div className={styles.filterRow}>
          <Tabs<ChannelKey>
            label="Channel"
            value={channel}
            onChange={k => { setChannel(k); setSelected(null); }}
            items={CHANNEL_TABS.map(t => ({ key: t.key, label: <span className={styles.tabLabel}><ChannelIcon channel={t.key} />{t.label}</span> }))}
          />
          {isEmail && (
            <div className={styles.seg} role="group" aria-label="Subscription">
              {SUB_FILTERS.map(f => (
                <button key={f.key} type="button" className={subFilter === f.key ? styles.segOn : styles.segBtn} aria-pressed={subFilter === f.key} onClick={() => setSubFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className={styles.pills} role="group" aria-label="Status">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} type="button" className={statusFilter === f.key ? styles.pillOn : styles.pill} aria-pressed={statusFilter === f.key} onClick={() => setStatusFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterRow}>
          <form onSubmit={handleSearch} className={styles.searchForm}>
            <input
              className={styles.input}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={isEmail ? 'Search by email…' : 'Search recipient or contact…'}
              aria-label="Search"
            />
            <Button type="submit" size="sm" variant="primary"><Search size={13} /> Search</Button>
            {search && (
              <Button type="button" size="sm" variant="ghost" aria-label="Clear search" onClick={() => { setSearch(''); setSearchInput(''); }}>
                <X size={13} />
              </Button>
            )}
          </form>

          <SearchPicker
            items={journeys.map(j => ({ id: String(j.journey_id ?? j.id ?? ''), name: j.name ?? '' })).filter(j => j.id)}
            value={journeyId}
            onChange={setJourneyId}
          />

          {isEmail && journeyId && (
            <SearchPicker
              label="Node"
              noun="node"
              allLabel={journeyNodes.length === 0 ? 'No action nodes' : 'All nodes'}
              idPrefix=""
              sortByIdDesc={false}
              items={journeyNodes.map(n => ({ id: String(n.id), name: n.data?.label ? `${nodeLabel(n.id)} · ${n.data.label}` : nodeLabel(n.id) }))}
              showId={false}
              value={nodeId}
              onChange={setNodeId}
            />
          )}
          {activeFilterCount > 0 && (
            <button type="button" className={styles.clear} onClick={clearAllFilters}>
              <X size={12} /> Clear ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className={styles.skeletons} aria-hidden="true">
          {Array.from({ length: Math.min(limit, 10) }).map((_, i) => <Skeleton key={i} height={36} />)}
        </div>
      ) : isEmail ? (
        data.rows.length === 0 ? (
          <EmptyState title="No send logs found" />
        ) : (
          <Table label="Email send log">
            <thead>
              <tr>
                <th>Contact</th><th>Email</th><th>Subject / Template</th><th>Status</th><th>Journey / Node</th><th>Sent At</th><th>Opened / Clicked</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(row => {
                const open = () => setSelected({ kind: 'email', row });
                return (
                  <tr key={row.id} className={styles.clickRow} tabIndex={0} onClick={open} onKeyDown={rowKeyHandler(open)} aria-label={`Message ${row.id} details`}>
                    <td>
                      <Copyable text={row.uc_name || row.contact_name} className={styles.strong}>{row.uc_name || row.contact_name || '—'}</Copyable>
                      {row.email_unsubscribed === 'Yes' && <div><Chip tone="bad">Unsubscribed</Chip></div>}
                    </td>
                    <td className={styles.ellipsis}><Copyable text={row.email}>{row.email || '—'}</Copyable></td>
                    <td>
                      {row.subject && <div><Copyable text={row.subject} className={styles.strong}>{row.subject}</Copyable></div>}
                      <div className={styles.muted}>{row.template_label || '—'}</div>
                    </td>
                    <td><StatusPill status={row.status} /></td>
                    <td>
                      {row.journey_id ? (
                        <a href={`/journeys/${row.journey_id}`} className={styles.link} onClick={e => e.stopPropagation()}>#{row.journey_id}</a>
                      ) : row.source ? <span className={styles.muted}>{row.source}</span> : '—'}
                      {row.node_id && <div className={styles.mono}>{nodeLabel(row.node_id)}</div>}
                    </td>
                    <td className={styles.nowrap}>{fmtDate(row.sent_at || row.created_at)}</td>
                    <td>
                      {row.opened_at
                        ? <div className={styles.okText}><Eye size={11} /> {fmtDate(row.opened_at)}</div>
                        : <div className={styles.muted}>Not opened</div>}
                      {row.clicked_at && <div className={styles.goldText}><MousePointerClick size={11} /> {fmtDate(row.clicked_at)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )
      ) : unified.state === 'error' ? (
        <ErrorState title="Couldn't load messages" description="The message log request failed." details={unified.message} action={<Button size="sm" onClick={load}>Retry</Button>} />
      ) : unified.state === 'unavailable' ? (
        <EmptyState title="Message log unavailable" description="The message log source is not available right now." />
      ) : unified.rows.length === 0 ? (
        <EmptyState title="No messages found" />
      ) : (
        <Table label="Message log">
          <thead>
            <tr>
              <th>Channel</th><th>Contact</th><th>Recipient</th><th>Message</th><th>Status</th><th>Journey / Node</th><th>Time</th><th>Opened / Clicked</th>
            </tr>
          </thead>
          <tbody>
            {unified.rows.map(row => {
              const open = () => setSelected({ kind: 'unified', row });
              return (
                <tr key={`${row.channel}-${row.id}`} className={styles.clickRow} tabIndex={0} onClick={open} onKeyDown={rowKeyHandler(open)} aria-label={`Message ${row.id} details`}>
                  <td><span className={styles.tabLabel}><ChannelIcon channel={row.channel} />{CHANNEL_LABEL[row.channel] ?? row.channel}</span></td>
                  <td><Copyable text={row.contactName} className={styles.strong}>{row.contactName || '—'}</Copyable></td>
                  <td className={styles.ellipsis}><Copyable text={row.recipient}>{row.recipient || '—'}</Copyable></td>
                  <td className={styles.ellipsis}>
                    <Copyable text={row.label}>{row.label || '—'}</Copyable>
                    {row.error && <div className={styles.badText} title={row.error}>{friendlyError(row.error)?.reason}</div>}
                  </td>
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    {row.journeyId != null
                      ? <a href={`/journeys/${row.journeyId}`} className={styles.link} onClick={e => e.stopPropagation()}>#{row.journeyId}</a>
                      : '—'}
                    {row.nodeId && <div className={styles.mono}>{row.nodeId}</div>}
                  </td>
                  <td className={styles.nowrap}>{fmtDate(row.time)}</td>
                  <td>
                    {row.openedAt ? <div className={styles.okText}><Eye size={11} /> {fmtDate(row.openedAt)}</div> : <div className={styles.muted}>—</div>}
                    {row.clickedAt && <div className={styles.goldText}><MousePointerClick size={11} /> {fmtDate(row.clickedAt)}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <div className={styles.pager}>
        <div className={styles.pagerSizes}>
          <span className={styles.muted}>Rows per page:</span>
          {PAGE_SIZE_OPTIONS.map(n => (
            <button key={n} type="button" className={limit === n ? styles.pillOn : styles.pill} aria-pressed={limit === n} onClick={() => setLimit(n)}>{n}</button>
          ))}
          <span className={styles.muted}>{rangeText}</span>
        </div>
        <div className={styles.pagerNav}>
          <Button size="sm" onClick={() => setPage(1)} disabled={page === 1}>«</Button>
          <Button size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={14} /> Prev</Button>
          <span className={styles.muted}>{totalPages != null ? `${page} / ${totalPages}` : `Page ${page}`}</span>
          <Button size="sm" onClick={() => setPage(p => (totalPages != null ? Math.min(totalPages, p + 1) : p + 1))} disabled={lastPage}>Next <ChevronRight size={14} /></Button>
          {totalPages != null && (
            <Button size="sm" onClick={() => setPage(totalPages)} disabled={lastPage}>»</Button>
          )}
        </div>
      </div>

      {selected && <DetailDrawer selected={selected} onClose={closeDrawer} />}
    </div>
  );
}
