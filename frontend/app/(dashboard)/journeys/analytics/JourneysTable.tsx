'use client';

/**
 * "Your journeys" table on the Performance page.
 *
 * Rows come from the precomputed journey_node_stats rollup (all-time totals, refreshed every
 * 30 min by a background job) and are paged ON THE SERVER: search, status, type and sort are
 * sent to GET /api/v3/journeys/analytics/table, which returns one page plus a total.
 *
 * Nothing runs per row when the page opens. A journey's step breakdown is fetched only when
 * its row is expanded:
 *   - no day picked → all-time step numbers (with "real people" counts)
 *   - a day picked  → only the steps that sent on that Dubai day, scoped to that day.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, Loader2, MoreHorizontal, RefreshCw, Search,
  ShieldCheck, X,
} from 'lucide-react';
import {
  getJourneyAnalyticsTable, getJourneyAnalyticsNodes, refreshJourneyAnalytics, regenerateJourneyQaReports,
} from '@/lib/api';
import type { JourneyAnalyticsSort, JourneyAnalyticsTableOptions } from '@/lib/api';
import { Button, Card, Chip, Skeleton } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import EmailQaReportModal from '../EmailQaReportModal';
import styles from './analytics.module.css';

interface AnalyticsRow {
  [key: string]: string | number | null | undefined;
  journey_id: string | number;
  journey_name?: string;
  journey_status: string;
  journey_type?: string;
  node_id?: string;
  node_label?: string;
  node_type?: string;
  template_id?: string | number | null;
  bot_window_sec?: number;
  entries?: number; sent: number; delivered: number; failed?: number;
  opened: number; human_opened?: number | null;
  clicked: number; human_clicked?: number | null;
  landed: number; bounced?: number; unsubscribed?: number; gtm_events?: number; booked?: number;
}
interface AnalyticsMeta { last_run_at?: string | null; journeys_run?: number }
interface AnalyticsTableResponse {
  data?: { journeys?: AnalyticsRow[]; meta?: AnalyticsMeta | null; total?: number; page?: number; limit?: number };
}
interface ExpandedState { loading: boolean; nodes?: AnalyticsRow[]; error?: string }
interface QaModalState { templateId: string | number | null | undefined; templateName: string | undefined }
type TypeFilter = 'all' | 'fixed' | 'continuous';

export const PAGE_SIZES = [20, 50] as const;
const EXPORT_BATCH = 200;
const TZ = 'Asia/Dubai';

// ── Formatting (plain words, thousands separators, never NaN) ─────────────
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const fmt = (v: unknown): string => (has(v) ? num(v).toLocaleString('en-US') : '—');
/** Percentage with one decimal, or null when there is nothing to divide by. */
const rateOf = (part: unknown, whole: unknown): number | null => {
  const w = num(whole);
  return w > 0 ? Math.round((num(part) / w) * 1000) / 10 : null;
};
const fmtRate = (r: number | null): string => (r === null ? '—' : `${r.toLocaleString('en-US')}%`);
const openRate = (r: AnalyticsRow) => rateOf(r.opened, num(r.delivered) || num(r.sent));
const clickRate = (r: AnalyticsRow) => rateOf(r.clicked, r.opened);

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return 'not yet';
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return 'not yet';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86400) return plural(Math.floor(s / 3600), 'hour');
  return plural(Math.floor(s / 86400), 'day');
}
/** "Tue, 20 Oct 2026, 3:05 PM" in Dubai time, for tooltips. */
function dubaiDateTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(/\u202f/g, ' ');
}
/** A YYYY-MM-DD calendar day as "Thu, 1 Oct" (year added when it isn't this year). */
function humanDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return 'that day';
  const d = new Date(t);
  const thisYear = new Date().toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' });
  const wd = d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' });
  const label = `${wd}, ${d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })}`;
  const year = d.toLocaleDateString('en-GB', { timeZone: 'UTC', year: 'numeric' });
  return year === thisYear ? label : `${label} ${year}`;
}
function dubaiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

const STATUS_LABEL: Record<string, { label: string; tone: ChipTone }> = {
  active: { label: 'Active', tone: 'ok' },
  paused: { label: 'Paused', tone: 'warn' },
  completed: { label: 'Finished', tone: 'info' },
  draft: { label: 'Draft', tone: 'mute' },
};
function statusOf(s: string | null | undefined): { label: string; tone: ChipTone } {
  const key = String(s ?? '').toLowerCase();
  if (STATUS_LABEL[key]) return STATUS_LABEL[key];
  return { label: key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Unknown', tone: 'mute' };
}
const isAlwaysOn = (r: AnalyticsRow) => r.journey_type === 'gtm';

/** Raw count plus a muted "real people" line when the rollup has it. */
function Engaged({ raw, human }: { raw: unknown; human: number | null | undefined }) {
  return (
    <span className={styles.engaged}>
      <span>{fmt(raw)}</span>
      {has(human) && num(raw) > 0 && <span className={styles.subNum} title="Opened or clicked by real people (not email security scanners)">{fmt(human)} real people</span>}
    </span>
  );
}

/** Small bar under a rate so the eye can compare rows quickly. */
function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className={styles.rateCell}>
      <span>{fmtRate(rate)}</span>
      {rate !== null && (
        <span className={styles.rateTrack} aria-hidden="true">
          <span className={styles.rateFill} style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
        </span>
      )}
    </span>
  );
}

interface SortHeadProps { label: string; field: JourneyAnalyticsSort; sort: JourneyAnalyticsSort; dir: 'asc' | 'desc'; onSort: (f: JourneyAnalyticsSort) => void; left?: boolean; tip?: string }
function SortHead({ label, field, sort, dir, onSort, left, tip }: SortHeadProps) {
  const on = sort === field;
  return (
    <th className={left ? styles.left : undefined} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} title={tip}>
      <button type="button" className={styles.sortBtn} onClick={() => onSort(field)}>
        {label}{on ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

function useCloseOnOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

interface RowMenuProps { row: AnalyticsRow; expanded: boolean; refreshing: boolean; onToggle: () => void; onRefresh: () => void }
function RowMenu({ row, expanded, refreshing, onToggle, onRefresh }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useCloseOnOutside(open, close);
  const name = row.journey_name || `Journey #${row.journey_id}`;
  return (
    <div className={styles.menuWrap} ref={ref} onClick={e => e.stopPropagation()}>
      <button type="button" className={styles.iconBtn} aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        {refreshing ? <Loader2 size={15} className={styles.spin} /> : <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div role="menu" aria-label={`Actions for ${name}`} className={styles.menu}>
          <Link href={`/journeys/${row.journey_id}`} role="menuitem" className={styles.menuItem}>
            <ExternalLink size={14} /> Open journey
          </Link>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { close(); onToggle(); }}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? 'Hide steps' : 'Show steps'}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={refreshing}
            title="Recalculate this journey's numbers now (they also update every 30 minutes)"
            onClick={() => { close(); onRefresh(); }}>
            <RefreshCw size={14} /> Update numbers now
          </button>
        </div>
      )}
    </div>
  );
}

function ToolsMenu({ regenLoading, onRegen, onReload }: { regenLoading: boolean; onRegen: () => void; onReload: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useCloseOnOutside(open, close);
  return (
    <div className={styles.menuWrap} ref={ref}>
      <Button size="sm" aria-label="More table actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {regenLoading ? <Loader2 size={14} className={styles.spin} /> : <MoreHorizontal size={16} />}
      </Button>
      {open && (
        <div role="menu" aria-label="Table actions" className={styles.menu}>
          <button type="button" role="menuitem" className={styles.menuItem} disabled={regenLoading}
            title="Run the automatic email checks again for every journey email (also runs daily at 3:30 AM)"
            onClick={() => { close(); onRegen(); }}>
            <ShieldCheck size={14} /> {regenLoading ? 'Checking emails…' : 'Re-run email checks'}
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { close(); onReload(); }}>
            <RefreshCw size={14} /> Reload table
          </button>
        </div>
      )}
    </div>
  );
}

const STEP_COLS = 10;
const MAIN_COLS = 7;

export default function JourneysTable() {
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<AnalyticsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSortKey] = useState<JourneyAnalyticsSort>('entries');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  const [dateFilter, setDateFilter] = useState(''); // '' = all time; YYYY-MM-DD = one Dubai day
  const [expanded, setExpanded] = useState<Record<string, ExpandedState>>({});
  const [refreshingId, setRefreshingId] = useState<string | number | null>(null);
  const [qaModal, setQaModal] = useState<QaModalState | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Search waits until typing pauses, then goes to the server and back to page 1.
  useEffect(() => {
    const q = searchInput.trim();
    if (q === search) return undefined;
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const filterOpts = useCallback((): JourneyAnalyticsTableOptions => {
    const o: JourneyAnalyticsTableOptions = { sort, dir };
    if (search) o.search = search;
    if (type !== 'all') o.type = type;
    return o;
  }, [search, type, sort, dir]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getJourneyAnalyticsTable(status, { page, limit, ...filterOpts() }) as AnalyticsTableResponse | null;
      const d = res?.data;
      const list = Array.isArray(d?.journeys) ? d.journeys : [];
      if (typeof d?.total === 'number' && Number.isFinite(d.total)) {
        setRows(list);
        setTotal(d.total);
      } else {
        // Older API without paging: it returned everything, so page it here.
        setRows(list.slice((page - 1) * limit, page * limit));
        setTotal(list.length);
      }
      setMeta(d?.meta || null);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load journeys');
    } finally { setLoading(false); }
  }, [status, page, limit, filterOpts]);

  useEffect(() => { load(); }, [load]);
  // A new page, filter or day means different rows/steps → collapse so steps reload fresh.
  useEffect(() => { setExpanded({}); }, [dateFilter, status, type, search, sort, dir, page, limit]);

  const loadNodes = async (jid: string | number): Promise<AnalyticsRow[]> => {
    const res = await getJourneyAnalyticsNodes(jid, dateFilter || undefined) as { data?: AnalyticsRow[] } | null;
    return (res?.data || []).filter(r => r.node_id !== '__ALL__');
  };

  const toggle = async (jid: string | number) => {
    if (expanded[jid]) { setExpanded(prev => { const n = { ...prev }; delete n[jid]; return n; }); return; }
    setExpanded(prev => ({ ...prev, [jid]: { loading: true } }));
    try {
      const nodes = await loadNodes(jid);
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, nodes } }));
    } catch (e) {
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, error: (e as Error).message } }));
    }
  };

  const refreshOne = async (jid: string | number) => {
    setRefreshingId(jid);
    try {
      await refreshJourneyAnalytics(jid);
      await load();
      if (expanded[jid]) { const nodes = await loadNodes(jid); setExpanded(prev => ({ ...prev, [jid]: { loading: false, nodes } })); }
    } catch { /* surfaced on next load */ } finally { setRefreshingId(null); }
  };

  const regenReports = async () => {
    setRegenLoading(true);
    try {
      const res = await regenerateJourneyQaReports() as { data?: { ok?: number; failed?: number; skipped?: number; total?: number } } | null;
      const d = res?.data || {};
      alert(`Email checks finished — ${fmt(d.ok || 0)} updated, ${fmt(d.failed || 0)} failed, ${fmt(d.skipped || 0)} skipped (of ${fmt(d.total || 0)} emails).`);
    } catch (e) {
      alert(`Email checks failed: ${(e as Error).message}`);
    } finally {
      setRegenLoading(false);
    }
  };

  const onSort = (field: JourneyAnalyticsSort) => {
    setPage(1);
    if (sort === field) { setDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(field);
    setDir(field === 'name' ? 'asc' : 'desc');
  };

  /** CSV of every journey matching the current filters (all pages), fetched in batches. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: AnalyticsRow[] = [];
      for (let p = 1; p <= 500; p++) {
        const res = await getJourneyAnalyticsTable(status, { ...filterOpts(), page: p, limit: EXPORT_BATCH }) as AnalyticsTableResponse | null;
        const batch = res?.data?.journeys || [];
        all.push(...batch);
        const t = res?.data?.total;
        if (typeof t !== 'number' || batch.length < EXPORT_BATCH || all.length >= t) break;
      }
      const cell = (v: unknown) => (has(v) ? String(num(v)) : '');
      const headers = ['Journey', 'Journey ID', 'Status', 'Type', 'People entered', 'Sent', 'Delivered', "Didn't send", 'Opened', 'Opened (real people)', 'Opened %',
        'Clicked', 'Clicked (real people)', 'Clicked % of opened', 'Reached website', 'Bounced', 'Unsubscribed', 'Website actions', 'Booked'];
      const lines = [headers.join(',')];
      for (const r of all) {
        lines.push([
          `"${String(r.journey_name || '').replace(/"/g, '""')}"`, r.journey_id, statusOf(r.journey_status).label, isAlwaysOn(r) ? 'Always on' : 'One-time',
          cell(r.entries), cell(r.sent), cell(r.delivered), cell(r.failed), cell(r.opened), cell(r.human_opened), openRate(r) ?? '',
          cell(r.clicked), cell(r.human_clicked), clickRate(r) ?? '', cell(r.landed), cell(r.bounced), cell(r.unsubscribed), cell(r.gtm_events), cell(r.booked),
        ].join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `journey-performance-${dubaiToday()}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${(e as Error).message}`);
    } finally { setExporting(false); }
  };

  const pages = Math.max(1, Math.ceil(total / limit));
  // If the list shrank (e.g. after an update) and this page no longer exists, step back.
  useEffect(() => { if (!loading && page > pages) setPage(pages); }, [loading, page, pages]);
  const firstShown = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastShown = Math.min(total, (page - 1) * limit + rows.length);
  const botWindow = num(rows[0]?.bot_window_sec) || 15;
  const filtered = !!(search || status || type !== 'all');

  const stepTable = (r: AnalyticsRow, exp: ExpandedState) => (
    <div className={styles.steps}>
      <dl className={styles.journeyFacts}>
        <div><dt>People entered</dt><dd>{fmt(r.entries)}</dd></div>
        <div><dt>Delivered</dt><dd>{fmt(r.delivered)}</dd></div>
        <div><dt>Didn&apos;t send</dt><dd>{fmt(r.failed)}</dd></div>
        <div><dt>Bounced</dt><dd>{fmt(r.bounced)}</dd></div>
        <div><dt>Reached website</dt><dd>{fmt(r.landed)}</dd></div>
        <div><dt>Website actions</dt><dd>{fmt(r.gtm_events)}</dd></div>
        <div><dt>Booked</dt><dd>{fmt(r.booked)}</dd></div>
      </dl>
      <p className={styles.help}>
        {dateFilter
          ? <>Steps that sent on {humanDay(dateFilter)} (Dubai time), with numbers for that day only. Booked is counted per journey, not per step.</>
          : <>All-time numbers per step. “Real people” means opened or clicked at least {botWindow} seconds after sending — faster ones are usually email security scanners.</>}
      </p>
      {exp.loading && <p className={styles.help}><Loader2 size={13} className={styles.spin} /> Loading steps…</p>}
      {exp.error && <p className={styles.errorText} role="alert">{exp.error}</p>}
      {exp.nodes && exp.nodes.length === 0 && (
        <p className={styles.help}>{dateFilter ? `No step sent on ${humanDay(dateFilter)}.` : 'No step numbers yet.'}</p>
      )}
      {exp.nodes && exp.nodes.length > 0 && (
        <div className={styles.stepScroll}>
          <table className={styles.stepTable} aria-label={`Steps of ${r.journey_name || `journey #${r.journey_id}`}`}>
            <thead>
              <tr>
                <th className={styles.left}>Step</th>
                <th title="Automatic check of the email for spam risk and broken links">Email check</th>
                <th>Sent</th><th>Delivered</th><th>Opened</th><th>Opened %</th><th>Clicked</th>
                <th title="Of the people who opened, how many clicked">Clicked %</th>
                <th title="Clicked and then did something on the website">Reached website</th><th>Unsubscribed</th>
              </tr>
            </thead>
            <tbody>
              {exp.nodes.map(n => (
                <tr key={n.node_id}>
                  <td className={styles.left} title={n.node_label}>{n.node_label || n.node_id}</td>
                  <td>
                    {n.template_id ? (
                      <button type="button" className={styles.iconBtn}
                        onClick={() => setQaModal({ templateId: n.template_id, templateName: n.node_label })}
                        title="See the email check for this step" aria-label={`See the email check for ${n.node_label || 'this step'}`}>
                        <Eye size={14} />
                      </button>
                    ) : <span className={styles.muted}>—</span>}
                  </td>
                  <td>{fmt(n.sent)}</td>
                  <td>{fmt(n.delivered)}</td>
                  <td><Engaged raw={n.opened} human={n.human_opened} /></td>
                  <td>{fmtRate(openRate(n))}</td>
                  <td><Engaged raw={n.clicked} human={n.human_clicked} /></td>
                  <td>{fmtRate(clickRate(n))}</td>
                  <td>{fmt(n.landed)}</td>
                  <td>{fmt(n.unsubscribed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link href={`/journeys/${r.journey_id}`} className={styles.openLink}>Open journey <ExternalLink size={12} /></Link>
    </div>
  );

  let body: ReactNode;
  if (loading && rows.length === 0) {
    body = (
      <div className={styles.loadingRows} data-testid="journeys-loading">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={40} radius={8} />)}
      </div>
    );
  } else {
    body = (
      <div className={styles.tableScroll}>
        <table className={styles.journeyTable} aria-label="Your journeys">
          <thead>
            <tr>
              <th className={styles.chevCol}><span className={styles.srOnly}>Expand</span></th>
              <SortHead label="Journey" field="name" sort={sort} dir={dir} onSort={onSort} left />
              <th className={styles.left}>Status</th>
              <SortHead label="Sent" field="sent" sort={sort} dir={dir} onSort={onSort} tip="Messages sent (not counting ones that failed)" />
              <SortHead label="Opened %" field="openRate" sort={sort} dir={dir} onSort={onSort} tip="Of the delivered messages, how many were opened" />
              <SortHead label="Clicked %" field="clickRate" sort={sort} dir={dir} onSort={onSort} tip="Of the people who opened, how many clicked a link" />
              <SortHead label="Unsubscribed" field="unsubscribed" sort={sort} dir={dir} onSort={onSort} tip="People who asked to stop receiving messages" />
              <th className={styles.menuCol}><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={MAIN_COLS + 1} className={styles.emptyCell}>
                {filtered
                  ? 'No journeys match your search or filters.'
                  : 'No journey numbers yet. They are calculated every 30 minutes.'}
              </td></tr>
            )}
            {rows.map(r => {
              const exp = expanded[r.journey_id];
              const st = statusOf(r.journey_status);
              const name = r.journey_name || `Journey #${r.journey_id}`;
              return (
                <Fragment key={r.journey_id}>
                  <tr className={exp ? `${styles.jrow} ${styles.jrowOpen}` : styles.jrow} onClick={() => toggle(r.journey_id)}>
                    <td className={styles.chevCol}>
                      <button type="button" className={styles.chevBtn} aria-expanded={!!exp} aria-label={`${exp ? 'Hide' : 'Show'} steps for ${name}`}
                        onClick={e => { e.stopPropagation(); toggle(r.journey_id); }}>
                        {exp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </td>
                    <td className={`${styles.left} ${styles.nameCell}`} title={name}>
                      <span className={styles.jname}>{name}</span>
                      <span className={styles.muted}> #{r.journey_id}</span>
                      {isAlwaysOn(r) && <Chip tone="info" className={styles.typeChip} title="Always on: people join whenever they qualify">Always on</Chip>}
                    </td>
                    <td className={styles.left}><Chip tone={st.tone}>{st.label}</Chip></td>
                    <td>{fmt(r.sent)}</td>
                    <td><RateBar rate={openRate(r)} /></td>
                    <td>{fmtRate(clickRate(r))}</td>
                    <td>{fmt(r.unsubscribed)}</td>
                    <td className={styles.menuCol}>
                      <RowMenu row={r} expanded={!!exp} refreshing={refreshingId === r.journey_id}
                        onToggle={() => toggle(r.journey_id)} onRefresh={() => refreshOne(r.journey_id)} />
                    </td>
                  </tr>
                  {exp && (
                    <tr className={styles.stepRow}>
                      <td colSpan={MAIN_COLS + 1}>{stepTable(r, exp)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card className={styles.tableCard} aria-label="Your journeys">
      <div className={styles.tableHead}>
        <div className={styles.tableTitleBlock}>
          <h2 className={styles.sectionTitle}>Your journeys</h2>
          <span className={styles.metaLine} title={meta?.last_run_at ? `Last updated ${dubaiDateTime(meta.last_run_at)} (Dubai time)` : undefined}>
            All time · numbers updated {timeAgo(meta?.last_run_at)}
          </span>
        </div>
        <div className={styles.tableActions}>
          <Button size="sm" onClick={exportCsv} disabled={exporting} title="Download every journey that matches your filters">
            {exporting ? <Loader2 size={14} className={styles.spin} /> : <Download size={14} />} Download CSV
          </Button>
          <ToolsMenu regenLoading={regenLoading} onRegen={regenReports} onReload={load} />
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Search size={14} className={styles.searchIcon} aria-hidden="true" />
          <input className={`ui-input ${styles.searchInput}`} value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search by name or #id" aria-label="Search journeys" />
          {searchInput && (
            <button type="button" className={styles.clearBtn} aria-label="Clear search" onClick={() => setSearchInput('')}><X size={14} /></button>
          )}
        </div>
        <select className={`ui-input ${styles.select}`} value={status} title="Journey status" aria-label="Journey status"
          onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Finished</option>
          <option value="paused">Paused</option>
          <option value="draft">Draft</option>
        </select>
        <select className={`ui-input ${styles.select}`} value={type} title="Journey type" aria-label="Journey type"
          onChange={e => { setType(e.target.value as TypeFilter); setPage(1); }}>
          <option value="all">All types</option>
          <option value="fixed">One-time / scheduled</option>
          <option value="continuous">Always on</option>
        </select>
        <label className={styles.dayLabel} title="Pick a day to see only the steps that sent that day">
          Steps on
          <input type="date" className={`ui-input ${styles.dayInput}`} value={dateFilter} max={dubaiToday()}
            aria-label="Step breakdown day" onChange={e => setDateFilter(e.target.value)} />
          {dateFilter && <button type="button" className={styles.clearBtn} aria-label="Show all-time steps" onClick={() => setDateFilter('')}><X size={14} /></button>}
        </label>
      </div>

      {error && (
        <div className={styles.errorBox} role="alert">
          <span>Couldn&apos;t load your journeys. {error}</span>
          <Button size="sm" onClick={load}>Try again</Button>
        </div>
      )}

      {body}

      <div className={styles.pager}>
        <span className={styles.pagerText} aria-live="polite">
          {total === 0 ? 'No journeys to show' : `Showing ${fmt(firstShown)}–${fmt(lastShown)} of ${fmt(total)}`}
        </span>
        <label className={styles.pageSize}>
          Rows
          <select className={`ui-input ${styles.pageSizeSelect}`} value={limit} aria-label="Rows per page"
            onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className={styles.pagerBtns}>
          <Button size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} aria-label="Previous page">
            <ChevronLeft size={14} /> Prev
          </Button>
          <span className={styles.pagerText}>Page {fmt(page)} of {fmt(pages)}</span>
          <Button size="sm" onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages || loading} aria-label="Next page">
            Next <ChevronRight size={14} />
          </Button>
        </div>
      </div>

      {qaModal && (
        <EmailQaReportModal templateId={qaModal.templateId} templateName={qaModal.templateName} onClose={() => setQaModal(null)} />
      )}
    </Card>
  );
}
