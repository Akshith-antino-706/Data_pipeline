'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GitBranch, Plus, RefreshCw, Search, Trash2, LayoutGrid, List, ChevronRight, Clock,
} from 'lucide-react';
import Link from 'next/link';
import hotToast from 'react-hot-toast';
import { deleteJourney } from '@/lib/api';
import {
  Button, buttonClass, Card, Chip, StatusChip, ConfirmDialog, EmptyState, ErrorState, PageHeader, Select, Skeleton, Table, Tabs,
} from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import type { JourneyNode, JourneySummary } from '@/types/f1Journeys';
import styles from './JourneyList.module.css';

// ── Types ──────────────────────────────────────────────────────
export type JourneyStatusTab = 'all' | 'active' | 'scheduled' | 'paused' | 'draft' | 'completed';
export type JourneyViewMode = 'cards' | 'list';
export type JourneySort = 'recent' | 'joined' | 'conversions' | 'name';
export type JourneyTypeFilter = 'any' | 'always' | 'once';

export interface JourneyListState {
  searchQuery: string; setSearchQuery: (v: string) => void;
  statusFilter: JourneyStatusTab; setStatusFilter: (v: JourneyStatusTab) => void;
  viewMode: JourneyViewMode; setViewMode: (v: JourneyViewMode) => void;
  page: number; setPage: (v: number | ((p: number) => number)) => void;
  sort: JourneySort; setSort: (v: JourneySort) => void;
  typeFilter: JourneyTypeFilter; setTypeFilter: (v: JourneyTypeFilter) => void;
  channelFilter: string; setChannelFilter: (v: string) => void;
}

/** List filters live in the page component so they survive opening a journey and coming back. */
export function useJourneyListState(): JourneyListState {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<JourneyStatusTab>('active'); // default = running journeys
  const [viewMode, setViewMode] = useState<JourneyViewMode>('cards');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<JourneySort>('recent');
  const [typeFilter, setTypeFilter] = useState<JourneyTypeFilter>('any');
  const [channelFilter, setChannelFilter] = useState('any');
  return {
    searchQuery, setSearchQuery, statusFilter, setStatusFilter, viewMode, setViewMode,
    page, setPage, sort, setSort, typeFilter, setTypeFilter, channelFilter, setChannelFilter,
  };
}

export interface JourneyListProps {
  journeys: JourneySummary[];
  loading: boolean;
  error: string | null;
  businessType: string;
  state: JourneyListState;
  onRefresh: () => void | Promise<void>;
  onOpen: (id: number) => void;
  /** Extra page-level nodes (e.g. the legacy toast) rendered after the list. */
  children?: ReactNode;
}

// ── Helpers ────────────────────────────────────────────────────
const PER_PAGE = 24;
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS', push: 'Push', rcs: 'RCS', web: 'Web',
};
const STATUS_TABS: { key: JourneyStatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Running' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'paused', label: 'Paused' },
  { key: 'draft', label: 'Drafts' },
  { key: 'completed', label: 'Completed' },
];

const num = (n: unknown): number => { const v = parseFloat(String(n ?? '')); return Number.isFinite(v) ? v : 0; };
const fmt = (n: unknown) => num(n).toLocaleString();
const pct = (n: unknown) => `${num(n).toFixed(1)}%`;
const dateMs = (d: string | undefined): number => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : 0; };
const timeAgo = (date: string | undefined): string => {
  const t = dateMs(date);
  if (!t) return '—';
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
};
const dubaiTime = (d: string) => new Date(d).toLocaleString('en-AE', {
  timeZone: 'Asia/Dubai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
});

const journeyChannels = (nodes: JourneyNode[] | null | undefined): string[] => {
  if (!nodes || !Array.isArray(nodes)) return [];
  const set = new Set<string>();
  nodes.forEach(n => { if (n.data?.channel) set.add(n.data.channel.toLowerCase()); });
  return [...set];
};
const isScheduled = (j: JourneySummary) =>
  j.status === 'draft' && !!j.scheduled_start_at && dateMs(j.scheduled_start_at) > Date.now();
const isAlwaysOn = (j: JourneySummary) => j.journey_type === 'gtm' || j.journey_type === 'continuous';
const matchesTab = (j: JourneySummary, tab: JourneyStatusTab) => {
  if (tab === 'all') return true;
  if (tab === 'scheduled') return isScheduled(j);
  if (tab === 'draft') return j.status === 'draft' && !isScheduled(j);
  return j.status === tab;
};
const statusView = (j: JourneySummary): { label: string; tone: ChipTone } => {
  if (isScheduled(j)) return { label: 'Scheduled', tone: 'info' };
  switch (j.status) {
    case 'active': return { label: 'Running', tone: 'ok' };
    case 'paused': return { label: 'Paused', tone: 'warn' };
    case 'draft': return { label: 'Draft', tone: 'mute' };
    case 'completed': return { label: 'Completed', tone: 'mute' };
    default: return { label: j.status || 'Unknown', tone: 'mute' };
  }
};
// Classify by name OR segment containing the scope word (substring, so "All B2B users" counts).
const matchesBusiness = (j: JourneySummary, businessType: string) => {
  if (businessType === 'All') return true;
  const name = (j.name || '').toUpperCase();
  const seg = (j.segment_name || '').toUpperCase();
  const isB2B = name.includes('B2B') || seg.includes('B2B');
  const isAffiliate = name.includes('AFFILIATE') || seg.includes('AFFILIATE');
  if (businessType === 'B2B') return isB2B;
  if (businessType === 'Affiliate') return isAffiliate;
  return !isB2B && !isAffiliate;
};

const muted = { color: 'var(--ink3)', fontSize: 12 } as const;

// ══════════════════════════════════════════════════════════════════
export default function JourneyList({
  journeys, loading, error, businessType, state, onRefresh, onOpen, children,
}: JourneyListProps) {
  const {
    searchQuery, setSearchQuery, statusFilter, setStatusFilter, viewMode, setViewMode,
    page, setPage, sort, setSort, typeFilter, setTypeFilter, channelFilter, setChannelFilter,
  } = state;
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Everything except the status tab — the tab counts follow these filters.
  const baseFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return journeys.filter(j => {
      if (!matchesBusiness(j, businessType)) return false;
      if (typeFilter === 'always' && !isAlwaysOn(j)) return false;
      if (typeFilter === 'once' && isAlwaysOn(j)) return false;
      if (channelFilter !== 'any' && !journeyChannels(j.nodes).includes(channelFilter)) return false;
      if (q && !(j.name?.toLowerCase().includes(q) || j.segment_name?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [journeys, businessType, typeFilter, channelFilter, searchQuery]);

  const tabCounts = useMemo(() => {
    const c = {} as Record<JourneyStatusTab, number>;
    STATUS_TABS.forEach(t => { c[t.key] = baseFiltered.filter(j => matchesTab(j, t.key)).length; });
    return c;
  }, [baseFiltered]);

  const filtered = useMemo(() => {
    const rows = baseFiltered.filter(j => matchesTab(j, statusFilter));
    const sorted = [...rows];
    if (sort === 'recent') sorted.sort((a, b) => dateMs(b.updated_at ?? b.created_at) - dateMs(a.updated_at ?? a.created_at));
    else if (sort === 'joined') sorted.sort((a, b) => num(b.total_entries) - num(a.total_entries));
    else if (sort === 'conversions') sorted.sort((a, b) => num(b.total_conversions) - num(a.total_conversions));
    else sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return sorted;
  }, [baseFiltered, statusFilter, sort]);

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    journeys.forEach(j => journeyChannels(j.nodes).forEach(c => set.add(c)));
    return [...set].sort();
  }, [journeys]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  // Reset to page 1 whenever the filters change; clamp if the list shrank (e.g. after a delete).
  useEffect(() => { setPage(1); }, [statusFilter, searchQuery, businessType, viewMode, sort, typeFilter, channelFilter, setPage]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount, setPage]);
  const paged = useMemo(() => filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filtered, page]);

  const summary = useMemo(() => ({
    total: journeys.length,
    active: journeys.filter(j => j.status === 'active').length,
    totalEntries: journeys.reduce((s, j) => s + (j.total_entries || 0), 0),
    avgConversion: journeys.length > 0 ? journeys.reduce((s, j) => s + num(j.conversion_rate), 0) / journeys.length : 0,
  }), [journeys]);

  const clearFilters = () => {
    setSearchQuery(''); setStatusFilter('all'); setTypeFilter('any'); setChannelFilter('any');
  };

  const cancelDelete = useCallback(() => { if (deletingId === null) setDeleteConfirm(null); }, [deletingId]);
  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm.id;
    setDeletingId(id);
    try {
      await deleteJourney(id);
      setDeleteConfirm(null);
      hotToast.success('Journey deleted successfully');
      await onRefresh();
    } catch (err) { hotToast.error((err as Error).message || 'Failed to delete journey'); }
    finally { setDeletingId(null); }
  };

  const deleteButton = (j: JourneySummary) => {
    const busy = deletingId === j.journey_id;
    return (
      <Button
        variant="ghost" size="sm" icon
        className={styles.deleteBtn}
        onClick={e => { e.stopPropagation(); setDeleteConfirm({ id: j.journey_id, name: j.name }); }}
        title={busy ? 'Deleting…' : 'Delete journey'}
        aria-label={`Delete ${j.name || 'journey'}`}
        disabled={busy}
      >
        {busy ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
      </Button>
    );
  };

  const channelChips = (j: JourneySummary) => {
    const ch = journeyChannels(j.nodes);
    if (ch.length === 0) return <span style={muted}>—</span>;
    return (
      <div className={styles.chipRow}>
        {ch.map(c => <Chip key={c} style={{ height: 22, fontSize: 11 }}>{CHANNEL_LABELS[c] || c}</Chip>)}
      </div>
    );
  };

  const kpis = [
    { label: 'Total journeys', value: String(summary.total) },
    { label: 'Running', value: String(summary.active) },
    { label: 'People joined', value: fmt(summary.totalEntries) },
    { label: 'Avg. conversion', value: pct(summary.avgConversion) },
  ];

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'Messaging' }, { label: 'Journeys' }]}
      title="Journeys"
      description="Automated series of messages. A journey keeps sending to the people in its segment until it ends or you pause it."
      actions={<>
        <Button icon aria-label="Refresh journeys" title="Refresh" onClick={() => { void onRefresh(); }}><RefreshCw size={16} /></Button>
        <Link href="/journeys/new" className={buttonClass('primary')}><Plus size={16} aria-hidden="true" /> Create journey</Link>
      </>}
    />
  );

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.page}>
        {header}
        <div className={styles.kpis}>
          {kpis.map(k => (
            <Card key={k.label} className={styles.kpi}>
              <div className={styles.eyebrow}>{k.label}</div>
              <Skeleton width={70} height={24} />
            </Card>
          ))}
        </div>
        <div className={styles.list} aria-busy="true" aria-label="Loading journeys">
          {[1, 2, 3].map(i => <Skeleton key={i} height={80} radius={12} />)}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}

      {/* ── KPIs ─────────────────────────────────────────────── */}
      <div className={styles.kpis}>
        {kpis.map(k => (
          <Card key={k.label} className={styles.kpi}>
            <div className={styles.eyebrow}>{k.label}</div>
            <div className={styles.kpiValue}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* ── Status tabs with counts ──────────────────────────── */}
      <Tabs<JourneyStatusTab>
        label="Journey status"
        value={statusFilter}
        onChange={setStatusFilter}
        items={STATUS_TABS.map(t => ({
          key: t.key,
          label: <span className={styles.tabLabel}>{t.label}{' '}<Chip className={styles.tabCount}>{tabCounts[t.key]}</Chip></span>,
        }))}
      />

      {/* ── Toolbar: search, filters, sort, view ─────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <label htmlFor="j-q" className={styles.srOnly}>Search journeys</label>
          <input
            id="j-q" type="search" className="ui-input" style={{ paddingLeft: 36 }}
            placeholder="Search by name or segment"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <Select aria-label="Journey type" className={styles.smallSelect} value={typeFilter} onChange={e => setTypeFilter(e.target.value as JourneyTypeFilter)}>
          <option value="any">Type: Any</option>
          <option value="always">Type: Always-on</option>
          <option value="once">Type: One-time</option>
        </Select>
        <Select aria-label="Channel" className={styles.smallSelect} value={channelFilter} onChange={e => setChannelFilter(e.target.value)}>
          <option value="any">Channel: Any</option>
          {channelOptions.map(c => <option key={c} value={c}>Channel: {CHANNEL_LABELS[c] || c}</option>)}
        </Select>
        <span className={styles.spacer} />
        <label htmlFor="j-sort" className="ui-help">Sort</label>
        <Select id="j-sort" className={styles.smallSelect} value={sort} onChange={e => setSort(e.target.value as JourneySort)}>
          <option value="recent">Recently updated</option>
          <option value="joined">Most joined</option>
          <option value="conversions">Most conversions</option>
          <option value="name">Name A–Z</option>
        </Select>
        <div className={styles.viewToggle} role="group" aria-label="View">
          <Button size="sm" icon variant={viewMode === 'cards' ? 'secondary' : 'ghost'} aria-label="Card view" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')}><LayoutGrid size={14} /></Button>
          <Button size="sm" icon variant={viewMode === 'list' ? 'secondary' : 'ghost'} aria-label="Table view" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}><List size={14} /></Button>
        </div>
      </div>

      <div className={styles.showing}>
        <span className="ui-help">Showing</span>
        <Chip tone="gold">Audience: {businessType}</Chip>
        <Chip>Status: {STATUS_TABS.find(t => t.key === statusFilter)?.label}</Chip>
        {searchQuery && <span className="ui-help">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>}
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      {error ? (
        <ErrorState
          title="Couldn't load journeys"
          description="The journey list didn't load. Journeys that are running keep sending on the server."
          details={error}
          action={<Button variant="primary" size="sm" onClick={() => { void onRefresh(); }}>Try again</Button>}
        />
      ) : filtered.length === 0 ? (
        journeys.length === 0 ? (
          <EmptyState
            icon={<GitBranch size={22} />}
            title="Create your first journey"
            description="Journeys send messages for you, for example a welcome email when someone signs up, then a WhatsApp offer three days later. Nothing sends until you review and start it."
            action={<Link href="/journeys/new" className={buttonClass('primary')}><Plus size={16} aria-hidden="true" /> Create journey</Link>}
          />
        ) : (
          <EmptyState
            icon={<Search size={20} />}
            title="No journeys match your filters"
            description="Try another status, search term or filter."
            action={<Button size="sm" onClick={clearFilters}>Clear filters</Button>}
          />
        )
      ) : viewMode === 'cards' ? (
        <div className={styles.grid}>
          {paged.map(j => {
            const st = statusView(j);
            const conv = num(j.conversion_rate);
            return (
              <Card key={j.journey_id} className={styles.jcard} onClick={() => onOpen(j.journey_id)}>
                <div className={styles.cardTop}>
                  <div style={{ minWidth: 0 }}>
                    <button type="button" className={styles.nameBtn} onClick={e => { e.stopPropagation(); onOpen(j.journey_id); }}>{j.name}</button>
                    {j.segment_name && <div className="ui-help">{j.segment_name}</div>}
                  </div>
                  <StatusChip tone={st.tone}>{st.label}</StatusChip>
                </div>
                {channelChips(j)}
                <dl className={styles.stats}>
                  <div><dt>Type</dt><dd>{isAlwaysOn(j) ? 'Always-on' : 'One-time'}</dd></div>
                  <div><dt>Steps</dt><dd>{j.node_count || 0}</dd></div>
                  <div><dt>Joined</dt><dd>{fmt(j.total_entries)}</dd></div>
                  <div><dt>Conversion</dt><dd>{pct(conv)}</dd></div>
                </dl>
                <div className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${Math.min(conv, 100)}%`, background: conv >= 10 ? 'var(--ok)' : conv > 0 ? 'var(--warn)' : 'var(--line)' }} />
                </div>
                {isScheduled(j) && j.scheduled_start_at && (
                  <Chip tone="info"><Clock size={12} aria-hidden="true" /> Starts {dubaiTime(j.scheduled_start_at)} Dubai</Chip>
                )}
                <div className={styles.cardFoot}>
                  <span className="ui-help">
                    {j.updated_at ? `Updated ${timeAgo(j.updated_at)}` : j.created_at ? `Created ${new Date(j.created_at).toLocaleDateString()}` : ''}
                  </span>
                  {deleteButton(j)}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Table label="Journeys">
          <thead>
            <tr>
              <th>Journey</th>
              <th>Status</th>
              <th>Type</th>
              <th>Channels</th>
              <th style={{ textAlign: 'right' }}>Steps</th>
              <th style={{ textAlign: 'right' }}>Joined</th>
              <th style={{ textAlign: 'right' }}>Conversion</th>
              <th>Updated</th>
              <th><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {paged.map(j => {
              const st = statusView(j);
              const conv = num(j.conversion_rate);
              return (
                <tr key={j.journey_id} className={styles.row} onClick={() => onOpen(j.journey_id)}>
                  <td style={{ minWidth: 220 }}>
                    <button type="button" className={styles.nameBtn} onClick={e => { e.stopPropagation(); onOpen(j.journey_id); }}>{j.name}</button>
                    <div className="ui-help">{j.segment_name || '—'}</div>
                  </td>
                  <td>
                    <StatusChip tone={st.tone}>{st.label}</StatusChip>
                    {isScheduled(j) && j.scheduled_start_at && <div className="ui-help" style={{ marginTop: 4 }}>Starts {dubaiTime(j.scheduled_start_at)}</div>}
                  </td>
                  <td className="ui-help" style={{ color: 'var(--ink2)', fontSize: 13 }}>{isAlwaysOn(j) ? 'Always-on' : 'One-time'}</td>
                  <td>{channelChips(j)}</td>
                  <td className={styles.num}>{j.node_count || 0}</td>
                  <td className={styles.num}>{fmt(j.total_entries)}</td>
                  <td className={styles.num} style={{ fontWeight: 600, color: conv >= 10 ? 'var(--ok)' : 'var(--ink2)' }}>{pct(conv)}</td>
                  <td className="ui-help" style={{ whiteSpace: 'nowrap' }}>{timeAgo(j.updated_at ?? j.created_at)}</td>
                  <td>
                    <div className={styles.rowActions}>
                      {deleteButton(j)}
                      <ChevronRight size={14} color="var(--ink3)" aria-hidden="true" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* ── Pagination ───────────────────────────────────────── */}
      {!error && filtered.length > PER_PAGE && (
        <div className={styles.pager}>
          <span style={{ fontSize: 13, color: 'var(--ink2)' }}>
            Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} journeys
          </span>
          <nav aria-label="Pagination" className={styles.pagerNav}>
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
            {pageWindow(page, pageCount).map(n => (
              <Button
                key={n} size="sm" variant={n === page ? 'secondary' : 'ghost'}
                aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined}
                className={n === page ? styles.pageOn : undefined}
                onClick={() => setPage(n)}
              >{n}</Button>
            ))}
            <Button size="sm" variant="ghost" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>Next</Button>
          </nav>
        </div>
      )}

      {children}

      <ConfirmDialog
        open={!!deleteConfirm}
        danger
        busy={deletingId !== null}
        title="Delete journey?"
        description={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p><b>{deleteConfirm?.name}</b></p>
            <p>This action cannot be undone</p>
            <p>This will permanently delete this journey and all associated entries and events.</p>
          </div>
        }
        confirmLabel={deletingId !== null ? 'Deleting…' : 'Delete'}
        onConfirm={() => { void confirmDelete(); }}
        onCancel={cancelDelete}
      />
    </div>
  );
}

/** Up to five page numbers centred on the current page. */
function pageWindow(page: number, count: number): number[] {
  const start = Math.max(1, Math.min(page - 2, count - 4));
  const end = Math.min(count, start + 4);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
