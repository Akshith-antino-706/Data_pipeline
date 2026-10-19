'use client';

import { useState, useEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react';
import { Mail, MessageCircle, Smartphone, RefreshCw, ChevronLeft, ChevronRight, Eye, MousePointerClick, Search, X } from 'lucide-react';
import { getSendLog, getJourneys, getOverviewMessages } from '@/lib/api';
import type { OverviewMessage, OverviewMessagesParams } from '@/lib/api';
import type { SendLogRow } from '@/types/api';
import { Button, Chip, EmptyState, ErrorState, PageHeader, Skeleton, Table, Tabs } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import styles from './log.module.css';

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
  | { state: 'ok'; rows: OverviewMessage[]; total: number | null; days: number | null }
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
      ['Error', selected.row.error_message || '—'],
      ['Journey', selected.row.journey_id != null ? `#${selected.row.journey_id}` : '—'],
      ['Node', selected.row.node_id || '—'],
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
      ['Error', selected.row.error || '—'],
      ['Journey', selected.row.journeyId != null ? `#${selected.row.journeyId}` : '—'],
      ['Node', selected.row.nodeId || '—'],
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
  const [data, setData] = useState<{ rows: SendLogRow[]; total: number; estimated: boolean }>({ rows: [], total: 0, estimated: false });
  const [unified, setUnified] = useState<UnifiedState>({ state: 'ok', rows: [], total: 0, days: null });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Selected | null>(null);

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
          setData({ rows: d?.rows ?? [], total: typeof d?.total === 'number' ? d.total : 0, estimated: d?.estimated === true });
        } catch {
          setData({ rows: [], total: 0, estimated: false });
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
  const total: number | null = isEmail ? data.total : unified.state === 'ok' ? unified.total : null;
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
  else if (isEmail) headerMeta = `${fmt(data.total)} records${data.estimated ? ' (estimated)' : ''}`;
  else if (unified.state === 'ok' && unified.total != null) headerMeta = `${fmt(unified.total)} records`;
  else headerMeta = 'Total unavailable';

  const rangeText = total != null && total > 0
    ? `${fmt(Math.min((page - 1) * limit + 1, total))}–${fmt(Math.min(page * limit, total))} of ${fmt(total)}`
    : total == null && !isEmail ? 'Total unavailable' : '';

  return (
    <div className={styles.page}>
      <PageHeader
        title="Message log"
        breadcrumbs={[{ label: 'Logs' }, { label: 'Message log' }]}
        description={
          <>
            <span>{headerMeta}</span>
            {!isEmail && unified.state === 'ok' && unified.days != null && <span className={styles.muted}> · last {unified.days} days</span>}
          </>
        }
        actions={
          <Button size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? styles.spin : undefined} /> Refresh
          </Button>
        }
      />

      <Tabs<ChannelKey>
        label="Channel"
        value={channel}
        onChange={k => { setChannel(k); setSelected(null); }}
        items={CHANNEL_TABS.map(t => ({ key: t.key, label: <span className={styles.tabLabel}><ChannelIcon channel={t.key} />{t.label}</span> }))}
      />

      <div className={styles.filters}>
        <div className={styles.filterRow}>
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
          {activeFilterCount > 0 && (
            <button type="button" className={styles.clear} onClick={clearAllFilters}>
              <X size={12} /> Clear ({activeFilterCount})
            </button>
          )}
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

          <label className={styles.selectWrap}>
            <span className={styles.selectLabel}>Journey</span>
            <select className={styles.select} value={journeyId} onChange={e => setJourneyId(e.target.value)}>
              <option value="">All Journeys</option>
              {journeys.map(j => (
                <option key={j.journey_id || j.id} value={j.journey_id || j.id}>
                  #{j.journey_id || j.id} · {j.name}
                </option>
              ))}
            </select>
          </label>

          {isEmail && journeyId && (
            <label className={styles.selectWrap}>
              <span className={styles.selectLabel}>Node</span>
              <select className={styles.select} value={nodeId} onChange={e => setNodeId(e.target.value)}>
                <option value="">All Nodes</option>
                {journeyNodes.length === 0 && <option disabled>No action nodes</option>}
                {journeyNodes.map(n => (
                  <option key={n.id} value={n.id}>{n.data?.label || n.id}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!isEmail && (
          <p className={styles.note}>Node and subscription filters are available on the Email tab only.</p>
        )}
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
                      <div className={styles.strong}>{row.uc_name || row.contact_name || '—'}</div>
                      {row.email_unsubscribed === 'Yes' && <Chip tone="bad">Unsubscribed</Chip>}
                    </td>
                    <td className={styles.ellipsis}>{row.email || '—'}</td>
                    <td>
                      {row.subject && <div className={styles.strong}>{row.subject}</div>}
                      <div className={styles.muted}>{row.template_label || '—'}</div>
                    </td>
                    <td><StatusPill status={row.status} /></td>
                    <td>
                      {row.journey_id ? (
                        <a href={`/journeys?id=${row.journey_id}`} className={styles.link} onClick={e => e.stopPropagation()}>#{row.journey_id}</a>
                      ) : row.source ? <span className={styles.muted}>{row.source}</span> : '—'}
                      {row.node_id && <div className={styles.mono}>{row.node_id}</div>}
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
                  <td className={styles.strong}>{row.contactName || '—'}</td>
                  <td className={styles.ellipsis}>{row.recipient || '—'}</td>
                  <td className={styles.ellipsis}>
                    {row.label || '—'}
                    {row.error && <div className={styles.badText}>{row.error}</div>}
                  </td>
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    {row.journeyId != null
                      ? <a href={`/journeys?id=${row.journeyId}`} className={styles.link} onClick={e => e.stopPropagation()}>#{row.journeyId}</a>
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
