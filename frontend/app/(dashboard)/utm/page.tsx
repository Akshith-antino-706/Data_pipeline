'use client';

/**
 * Website & links (/utm).
 *
 * Top: the website overview (WebsiteOverview.tsx). Below it, the link tools in tabs:
 *   Email visits · Campaign links · My links · Segments · Link builder
 *
 * Loading rules:
 *   - On page open only the overview and the open tab load. Every other tab loads the first time
 *     it is opened and keeps its data afterwards (panels stay mounted, just hidden).
 *   - Every list shows skeleton rows while its request runs (first load, page change, filter
 *     change, Try again) — never an empty state or an old error.
 *   - A dropped connection (TypeError) gets one quiet retry; after 8s a "Still working" note shows;
 *     a slow response for an old page/filter never overwrites a newer one.
 *
 * Paging (20 rows by default, 20/50 to choose):
 *   - Server side: email visits log, campaign links, personal (user) links.
 *   - Server side too: visits by campaign (grouped on the server, same date range as the visits list).
 *   - Client side (small lists the API returns in one go): segments.
 */

import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type FormEvent, type ReactNode,
} from 'react';
import {
  Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Link2, Loader2, MoreHorizontal, Plus, RefreshCw, Search, X, Zap,
} from 'lucide-react';
import {
  getUTMAnalytics, getUTMSegments, buildUTM, generateSegmentUTM, generateAllUTM, generateUserLinks, getUserLinks,
  getUserLinkStats, getCampaigns, getEmailUtmLog, getEmailUtmSummary,
} from '@/lib/api';
import type { QueryParams } from '@/types/api';
import {
  Button, Card, Chip, ConfirmDialog, Field, Input, PageHeader, Select, Skeleton, Tabs,
} from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import WebsiteOverview from './WebsiteOverview';
import styles from './utm.module.css';

// ── API shapes ───────────────────────────────────────────────────────────────
type NumLike = number | string | null | undefined;
interface UtmLink {
  utm_id: string | number; channel?: string | null; campaign_name?: string | null; template_name?: string | null;
  campaign_status?: string | null; segment_label?: string | null; target_count?: NumLike; full_url?: string | null; clicks?: NumLike;
}
interface UtmChannelSummary { channel?: string | null; total_links?: NumLike; total_clicks?: NumLike }
interface UtmAnalyticsResponse { links?: UtmLink[]; summary?: UtmChannelSummary[]; total?: NumLike }
interface UtmSegment { segment_name: string; utm_count?: NumLike; campaign_count?: NumLike; customer_count?: NumLike; total_clicks?: NumLike }
interface UserLinkCampaign { campaign_id: string | number; campaign_name?: string | null }
interface UserLinkStatsData { campaigns: UserLinkCampaign[] }
interface UserLink {
  link_id: string | number; click_count?: NumLike; token: string; customer_name?: string | null; customer_email?: string | null;
  campaign_name?: string | null; segment_label?: string | null; channel?: string | null; last_clicked_at?: string | null;
}
interface UserLinksResponse { links?: UserLink[]; stats?: { total_links?: NumLike; clicked_links?: NumLike } }
interface CampaignOption { id: string | number; name?: string | null; segment_label?: string | null; channel?: string | null }
interface EmailVisit {
  id: string | number; contact_name?: string | null; email?: string | null; utm_campaign?: string | null; utm_source?: string | null;
  utm_medium?: string | null; destination_url?: string | null; created_at?: string | null;
}
interface EmailVisitCampaign { utm_campaign?: string | null; utm_source?: string | null; utm_medium?: string | null; total_clicks?: NumLike; unique_visitors?: NumLike; unique_emails?: NumLike }
interface Paged<R> { rows: R[]; total: number; /** The server stopped counting at `total` (shown as "10,000+"). */ capped?: boolean }

// ── Constants & formatting ───────────────────────────────────────────────────
const TZ = 'Asia/Dubai';
const PAGE_SIZES = [20, 50] as const;
const DEFAULT_PAGE_SIZE: number = PAGE_SIZES[0];
const CAMPAIGN_PICK_LIMIT = 50;
const RETRY_DELAY_MS = 1500;
const SLOW_AFTER_MS = 8000;
const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_LANDING = 'https://www.raynatours.com/activities';
const FIXED_SOURCE = 'AI_marketer';
const BUILDER_CHANNELS = ['email', 'whatsapp', 'sms', 'push', 'web'] as const;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (v: unknown): string => num(v).toLocaleString('en-US');

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS', push: 'Push', rcs: 'RCS', web: 'Website' };
const channelLabel = (c: string | null | undefined): string => {
  const k = String(c ?? '').toLowerCase();
  return CHANNEL_LABEL[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : '—');
};
const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  running: { label: 'Running', tone: 'ok' }, active: { label: 'Running', tone: 'ok' },
  scheduled: { label: 'Scheduled', tone: 'info' }, completed: { label: 'Finished', tone: 'info' },
  paused: { label: 'Paused', tone: 'warn' }, draft: { label: 'Draft', tone: 'mute' },
};
const statusOf = (s: string | null | undefined): { label: string; tone: ChipTone } => {
  const k = String(s ?? '').toLowerCase();
  return STATUS[k] ?? (k ? { label: k.charAt(0).toUpperCase() + k.slice(1), tone: 'mute' } : STATUS.draft);
};

function parseTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** "20 Oct, 3:05 PM" in Dubai time (year added when it isn't this year); "—" when missing/invalid. */
function dubaiShort(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return '—';
  const sameYear = d.toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' }) === new Date().toLocaleDateString('en-GB', { timeZone: TZ, year: 'numeric' });
  return d.toLocaleString('en-GB', {
    timeZone: TZ, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(/\u202f/g, ' ');
}
/** "Tue, 20 Oct 2026, 3:05 PM (Dubai time)" for tooltips. */
function dubaiFull(ts: string | null | undefined): string | undefined {
  const d = parseTs(ts);
  if (!d) return undefined;
  return `${d.toLocaleString('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(/\u202f/g, ' ')} (Dubai time)`;
}
function dubaiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}
/** The last 7 Dubai days, today included. */
function last7Days(): { from: string; to: string } {
  const to = dubaiToday();
  return { from: addDays(to, -6), to };
}
/** "14 Oct" (with the year when it isn't this year). */
function humanDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return day;
  const d = new Date(t);
  const label = d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return day.slice(0, 4) === dubaiToday().slice(0, 4) ? label : `${label} ${day.slice(0, 4)}`;
}
function humanRange(from: string, to: string): string {
  if (from && to) return `${humanDay(from)} – ${humanDay(to)}`;
  if (from) return `from ${humanDay(from)}`;
  if (to) return `up to ${humanDay(to)}`;
  return 'all time';
}
/** Path of a URL for display ("/dubai/tours"); the raw text when it isn't a URL. */
function urlPath(url: string): string {
  try { return new URL(url).pathname || url; } catch { return url; }
}
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : [];
}
/** Lists come back as `[...]`, `{ data: [...] }` or `{ <key>: [...] }`. */
function listFrom<T>(res: unknown, key?: string): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object') {
    const o = res as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as T[];
    if (key && Array.isArray(o[key])) return o[key] as T[];
  }
  return [];
}
const errText = (e: unknown): string => (e instanceof Error && e.message) || 'Request failed';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Toasts (one per page, shared by every tab) ─────────────────────────────
type ToastType = 'success' | 'error' | 'info';
type Notify = (msg: string, type?: ToastType) => void;
const ToastCtx = createContext<Notify>(() => {});
const useNotify = () => useContext(ToastCtx);

// ── Data loading ───────────────────────────────────────────────────────────
interface Loader<T> { data: T | null; loading: boolean; error: string | null; slow: boolean; reload: () => Promise<void> }

/**
 * Runs `fetcher` whenever it changes (and `enabled` is true). `loading` is true from the first
 * render until the first answer, so an empty state can never flash before data arrives.
 */
function useLoader<T>(fetcher: () => Promise<T>, enabled = true): Loader<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [settled, setSettled] = useState(false);
  const [slow, setSlow] = useState(false);
  const reqId = useRef(0);

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setPending(true);
    setError(null);
    setSlow(false);
    const timer = setTimeout(() => { if (id === reqId.current) setSlow(true); }, SLOW_AFTER_MS);
    try {
      let res: T;
      try {
        res = await fetcher();
      } catch (e) {
        // A dropped connection gets one quiet retry before an error is shown.
        if (!(e instanceof TypeError)) throw e;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        if (id !== reqId.current) return;
        res = await fetcher();
      }
      if (id !== reqId.current) return;
      setData(res);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(errText(e));
    } finally {
      clearTimeout(timer);
      if (id === reqId.current) { setPending(false); setSlow(false); setSettled(true); }
    }
  }, [fetcher]);

  useEffect(() => { if (enabled) void run(); }, [enabled, run]);
  useEffect(() => () => { reqId.current += 1; }, []);

  const loading = pending || (enabled && !settled);
  return { data, loading, error: loading ? null : error, slow: loading && slow, reload: run };
}

function useDebounced<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Client-side paging for small lists the API returns in one go. */
function useClientPage<R>(list: R[]) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(list.length / limit));
  const current = Math.min(page, pages);
  const rows = useMemo(() => list.slice((current - 1) * limit, current * limit), [list, current, limit]);
  return { page: current, limit, total: list.length, rows, setPage, setLimit: (n: number) => { setLimit(n); setPage(1); } };
}

// ── Shared UI pieces ───────────────────────────────────────────────────────
interface PagerProps {
  page: number; limit: number; total: number; shown: number; loading?: boolean; noun: string; capped?: boolean;
  onPage: (p: number) => void; onLimit: (n: number) => void;
}
function Pager({ page, limit, total, shown, loading = false, noun, capped = false, onPage, onLimit }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / limit));
  // Nothing to page through: everything fits on one page of the smallest size.
  if (total <= PAGE_SIZES[0] && page === 1) return null;
  const first = total === 0 || shown === 0 ? 0 : (page - 1) * limit + 1;
  const last = first === 0 ? 0 : first + shown - 1;
  return (
    <div className={styles.pager}>
      <span className={styles.pagerText} aria-live="polite">
        {loading && total === 0 ? 'Loading…' : total === 0 ? `No ${noun} to show` : `Showing ${fmt(first)}–${fmt(last)} of ${fmt(total)}${capped ? '+' : ''}`}
      </span>
      <label className={styles.pageSize}>
        Rows
        <select className={`ui-input ${styles.pageSizeSelect}`} value={limit} aria-label="Rows per page"
          onChange={e => onLimit(Number(e.target.value))}>
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className={styles.pagerBtns}>
        <Button size="sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1 || loading} aria-label="Previous page">
          <ChevronLeft size={14} /> Prev
        </Button>
        <span className={styles.pagerText}>Page {fmt(page)} of {fmt(pages)}</span>
        <Button size="sm" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages || loading} aria-label="Next page">
          Next <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

/** A URL shown as its path (ellipsis), the full URL on hover, and a copy button. */
function LinkCell({ url, label, open = true }: { url: string | null | undefined; label?: string; open?: boolean }) {
  const notify = useNotify();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  if (!url) return <span className={styles.muted}>—</span>;
  const text = label ?? urlPath(url);
  const isWeb = /^https?:\/\//i.test(url);
  const onCopy = async () => {
    if (await copyText(url)) setCopied(true);
    else notify("Couldn't copy — your browser blocked it. Select the link and copy it by hand.", 'error');
  };
  return (
    <span className={styles.linkCell}>
      {open && isWeb
        ? <a className={styles.linkText} href={url} target="_blank" rel="noreferrer" title={url}>{text}</a>
        : <span className={styles.linkText} title={url}>{text}</span>}
      <button type="button" className={copied ? `${styles.iconBtn} ${styles.iconBtnDone}` : styles.iconBtn}
        onClick={onCopy} aria-label={copied ? 'Link copied' : `Copy link ${text}`} title={copied ? 'Copied' : 'Copy full link'}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </span>
  );
}

interface Col<R> { key: string; label: ReactNode; cell: (r: R) => ReactNode; num?: boolean; title?: string }
interface ListTableProps<R> {
  label: string; testId: string; cols: Col<R>[]; rows: R[]; rowKey: (r: R) => string | number;
  loading: boolean; slow: boolean; error: string | null; onRetry: () => void;
  empty: ReactNode; errorTitle: string; skeletonRows: number;
}
/** Table with skeleton rows while loading, a plain error with Try again, and an empty message. */
function ListTable<R>({ label, testId, cols, rows, rowKey, loading, slow, error, onRetry, empty, errorTitle, skeletonRows }: ListTableProps<R>) {
  if (error && !loading) return <ErrorLine text={errorTitle} details={error} onRetry={onRetry} />;
  if (!loading && rows.length === 0) return <p className={styles.note}>{empty}</p>;
  return (
    <>
      {slow && <p className={styles.slowNote} role="status">Still working on it… this can take a little longer when there is a lot of data.</p>}
      <div className={styles.tableScroll}>
        <table className={styles.dataTable} aria-label={label} aria-busy={loading}>
          <thead>
            <tr>
              {cols.map(c => <th key={c.key} className={c.num ? styles.num : undefined} title={c.title} scope="col">{c.label}</th>)}
            </tr>
          </thead>
          <tbody data-testid={loading ? `${testId}-loading` : undefined}>
            {loading && Array.from({ length: Math.max(3, skeletonRows) }, (_, i) => (
              <tr key={`sk-${i}`} className={styles.skelRow}>
                {cols.map(c => <td key={c.key}><Skeleton height={12} width={c.num ? 48 : '80%'} /></td>)}
              </tr>
            ))}
            {!loading && rows.map(r => (
              <tr key={rowKey(r)}>
                {cols.map(c => <td key={c.key} className={c.num ? styles.num : undefined}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One compact line for a failed load, with Try again (raw error on hover). */
function ErrorLine({ text, details, onRetry }: { text: string; details?: string | null; onRetry: () => void }) {
  return (
    <div className={styles.errorBox} role="alert">
      <span title={details ?? undefined}>{text}. Check your connection and try again.</span>
      <Button size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className={styles.searchWrap}>
      <Search size={14} className={styles.searchIcon} aria-hidden="true" />
      <input className={`ui-input ${styles.searchInput}`} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} aria-label={label} />
      {value && (
        <button type="button" className={styles.clearBtn} aria-label="Clear search" onClick={() => onChange('')}><X size={14} /></button>
      )}
    </div>
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

interface MenuItem { label: string; icon: ReactNode; onSelect: () => void; disabled?: boolean; title?: string }
function MoreMenu({ label, busy = false, items }: { label: string; busy?: boolean; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useCloseOnOutside(open, close);
  return (
    <div className={styles.menuWrap} ref={ref}>
      <Button size="sm" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {busy ? <Loader2 size={14} className={styles.spin} /> : <MoreHorizontal size={16} />}
      </Button>
      {open && (
        <div role="menu" aria-label={label} className={styles.menu}>
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" className={styles.menuItem} disabled={it.disabled} title={it.title}
              onClick={() => { close(); it.onSelect(); }}>
              {it.icon} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Email visits ──────────────────────────────────────────────────────
interface VisitFilter { email: string; campaign: string; from: string; to: string }

function EmailVisitsTab() {
  const [defaults] = useState(last7Days);
  const [draft, setDraft] = useState<VisitFilter>(() => ({ email: '', campaign: '', ...defaults }));
  const [applied, setApplied] = useState<VisitFilter>(draft);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  const fetchLog = useCallback(async (): Promise<Paged<EmailVisit>> => {
    const params: QueryParams = { page, limit };
    if (applied.email.trim()) params.email = applied.email.trim();
    if (applied.campaign.trim()) params.utm_campaign = applied.campaign.trim();
    // Whole Dubai days: from 00:00 on the first day to the end of the last day (+04:00).
    if (applied.from) params.dateFrom = `${applied.from}T00:00:00+04:00`;
    if (applied.to) params.dateTo = `${applied.to}T23:59:59.999+04:00`;
    const res = await getEmailUtmLog(params) as { data?: { rows?: unknown; total?: NumLike; capped?: boolean } } | null;
    return { rows: asArray<EmailVisit>(res?.data?.rows), total: num(res?.data?.total), capped: res?.data?.capped === true };
  }, [page, limit, applied]);
  const log = useLoader(fetchLog);

  // Visits by campaign: grouped and paged on the server, over the same date range and campaign search.
  const [sumPage, setSumPage] = useState(1);
  const [sumLimit, setSumLimit] = useState(DEFAULT_PAGE_SIZE);
  const fetchSummary = useCallback(async (): Promise<Paged<EmailVisitCampaign>> => {
    const params: QueryParams = { page: sumPage, limit: sumLimit };
    if (applied.campaign.trim()) params.q = applied.campaign.trim();
    if (applied.from) params.dateFrom = `${applied.from}T00:00:00+04:00`;
    if (applied.to) params.dateTo = `${applied.to}T23:59:59.999+04:00`;
    const res = await getEmailUtmSummary(params) as { data?: { byCampaign?: unknown; total?: NumLike } } | null;
    const rows = asArray<EmailVisitCampaign>(res?.data?.byCampaign);
    return { rows, total: num(res?.data?.total) || rows.length };
  }, [sumPage, sumLimit, applied]);
  const summary = useLoader(fetchSummary);
  const summaryRows = summary.data?.rows ?? [];

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    setApplied({ ...draft });
    setPage(1);
    setSumPage(1);
  };
  const setRange = (from: string, to: string) => {
    const f = { email: '', campaign: '', from, to };
    setDraft(f);
    setApplied(f);
    setPage(1);
    setSumPage(1);
  };
  const noSearch = !applied.email.trim() && !applied.campaign.trim();
  const isLast7 = applied.from === defaults.from && applied.to === defaults.to;
  const allDates = !applied.from && !applied.to;
  const rows = log.data?.rows ?? [];
  // Nothing at all for the default view → one compact line instead of an empty card.
  const bare = noSearch && (isLast7 || allDates) && !log.loading && !log.error && (log.data?.total ?? 0) === 0;

  const visitCols: Col<EmailVisit>[] = [
    { key: 'who', label: 'Person', cell: v => (
      <span className={styles.nameCell}>
        <span className={styles.nameText}>{v.contact_name || v.email || 'Unknown'}</span>
        {v.contact_name && v.email && <span className={styles.sub}>{v.email}</span>}
      </span>
    ) },
    { key: 'campaign', label: 'Campaign', title: 'utm_campaign', cell: v => v.utm_campaign || <span className={styles.muted}>—</span> },
    // Source (always AI_marketer) and Channel (always email on this tab) are left out: they never vary here.
    { key: 'page', label: 'Page visited', cell: v => <LinkCell url={v.destination_url} /> },
    { key: 'when', label: 'When', cell: v => <span className={styles.nowrap} title={dubaiFull(v.created_at)}>{dubaiShort(v.created_at)}</span> },
  ];
  const campaignCols: Col<EmailVisitCampaign>[] = [
    { key: 'campaign', label: 'Campaign', cell: r => <span className={styles.strong}>{r.utm_campaign || '—'}</span> },
    { key: 'clicks', label: 'Visits', num: true, cell: r => fmt(r.total_clicks) },
    { key: 'people', label: 'People', num: true, title: 'Different people who visited', cell: r => fmt(r.unique_visitors) },
    { key: 'emails', label: 'Email addresses', num: true, cell: r => fmt(r.unique_emails) },
  ];

  return (
    <>
      {bare ? (
        <p className={styles.note} data-testid="visits-none">
          {isLast7 ? `No email visits in the last 7 days (${humanRange(applied.from, applied.to)}).` : 'No email visits yet.'}
          {isLast7 && <Button size="sm" variant="ghost" onClick={() => setRange('', '')}>Show all dates</Button>}
        </p>
      ) : (
        <Card className={styles.card} aria-label="Visits from emails">
          <div className={styles.cardHead}>
            <div className={styles.cardTitleBlock}>
              <h3 className={styles.cardTitle}>Visits from emails</h3>
              <span className={styles.metaLine}>
                {allDates ? 'All dates' : `${humanRange(applied.from, applied.to)} (Dubai time)`}
                {!log.loading && log.data ? ` · ${fmt(log.data.total)}${log.data.capped ? '+' : ''} visit${log.data.total === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            <Button size="sm" onClick={() => void log.reload()} disabled={log.loading} aria-label="Refresh visits">
              {log.loading ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}
            </Button>
          </div>
          <form className={styles.toolbar} onSubmit={apply} aria-label="Filter visits">
            <label className={`${styles.filterField} ${styles.filterGrow}`}>
              Email address
              <input className={`ui-input ${styles.control}`} value={draft.email} placeholder="Part of an email"
                onChange={e => setDraft(f => ({ ...f, email: e.target.value }))} />
            </label>
            <label className={`${styles.filterField} ${styles.filterGrow}`}>
              Campaign
              <input className={`ui-input ${styles.control}`} value={draft.campaign} placeholder="e.g. day1_welcome"
                onChange={e => setDraft(f => ({ ...f, campaign: e.target.value }))} />
            </label>
            <label className={`${styles.filterField} ${styles.filterDate}`}>
              From
              <input type="date" className={`ui-input ${styles.control}`} value={draft.from} max={draft.to || undefined}
                onChange={e => setDraft(f => ({ ...f, from: e.target.value }))} />
            </label>
            <label className={`${styles.filterField} ${styles.filterDate}`}>
              To
              <input type="date" className={`ui-input ${styles.control}`} value={draft.to} min={draft.from || undefined}
                onChange={e => setDraft(f => ({ ...f, to: e.target.value }))} />
            </label>
            <Button type="submit" variant="primary" disabled={log.loading}>
              {log.loading ? <Loader2 size={14} className={styles.spin} /> : <Search size={14} />} Search
            </Button>
            {!(noSearch && isLast7) && <Button variant="ghost" onClick={() => setRange(defaults.from, defaults.to)}>Last 7 days</Button>}
          </form>
          <ListTable label="Email visits" testId="visits" cols={visitCols} rows={rows} rowKey={v => v.id}
            loading={log.loading} slow={log.slow} error={log.error} onRetry={() => void log.reload()}
            errorTitle="Couldn't load email visits" skeletonRows={Math.min(limit, rows.length || 8)}
            empty="No visits match these filters. Try a wider date range or clear the search." />
          <Pager page={page} limit={limit} total={log.data?.total ?? 0} capped={log.data?.capped} shown={rows.length} loading={log.loading} noun="visits"
            onPage={setPage} onLimit={n => { setLimit(n); setPage(1); }} />
        </Card>
      )}

      {summary.error ? (
        <ErrorLine text="Couldn't load visits by campaign" details={summary.error} onRetry={() => void summary.reload()} />
      ) : (summary.loading || summaryRows.length > 0) && (
        <Card className={styles.card} aria-label="Visits by campaign">
          <div className={styles.cardHead}>
            <div className={styles.cardTitleBlock}>
              <h3 className={styles.cardTitle}>Visits by campaign</h3>
              <span className={styles.metaLine}>
                {allDates ? 'All dates' : `${humanRange(applied.from, applied.to)} (Dubai time)`}
                {applied.campaign.trim() ? ` · campaigns matching “${applied.campaign.trim()}”` : ''}
              </span>
            </div>
          </div>
          <ListTable label="Visits by campaign" testId="visits-by-campaign" cols={campaignCols} rows={summaryRows}
            rowKey={r => `${r.utm_campaign ?? ''}|${r.utm_source ?? ''}|${r.utm_medium ?? ''}`}
            loading={summary.loading} slow={summary.slow} error={null} onRetry={() => void summary.reload()}
            errorTitle="Couldn't load visits by campaign" skeletonRows={Math.min(sumLimit, summaryRows.length || 5)}
            empty="No campaign visits yet." />
          <Pager page={sumPage} limit={sumLimit} total={summary.data?.total ?? 0} shown={summaryRows.length}
            loading={summary.loading} noun="campaigns" onPage={setSumPage} onLimit={n => { setSumLimit(n); setSumPage(1); }} />
        </Card>
      )}
    </>
  );
}

// ── Tab: Campaign links ────────────────────────────────────────────────────
function CampaignLinksTab({ segments, segmentsLoading, onChanged }: { segments: UtmSegment[]; segmentsLoading: boolean; onChanged: () => void }) {
  const notify = useNotify();
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim());
  const [segment, setSegment] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [confirmAll, setConfirmAll] = useState(false);
  const [generating, setGenerating] = useState(false);

  // A new search or audience goes back to page 1.
  const [lastFilter, setLastFilter] = useState(`${search}|${segment}`);
  if (lastFilter !== `${search}|${segment}`) { setLastFilter(`${search}|${segment}`); setPage(1); }

  const fetchLinks = useCallback(async () => {
    const params: QueryParams = { page, limit };
    if (search) params.search = search;
    if (segment) params.segmentLabel = segment;
    const res = await getUTMAnalytics(params) as UtmAnalyticsResponse | { data?: UtmAnalyticsResponse } | null;
    const d: UtmAnalyticsResponse = (res && 'data' in res && res.data) ? res.data : (res as UtmAnalyticsResponse | null) ?? {};
    const links = asArray<UtmLink>(d.links);
    const summary = asArray<UtmChannelSummary>(d.summary);
    if (d.total !== undefined && d.total !== null && Number.isFinite(Number(d.total))) {
      return { rows: links, total: num(d.total), summary };
    }
    // Older API without paging: it returned the newest 200, so page them here.
    return { rows: links.slice((page - 1) * limit, page * limit), total: links.length, summary };
  }, [page, limit, search, segment]);
  const list = useLoader(fetchLinks);
  const rows = list.data?.rows ?? [];
  const summary = list.data?.summary ?? [];

  const closeConfirm = useCallback(() => setConfirmAll(false), []);
  const generateAll = async () => {
    setGenerating(true);
    try {
      const r = await generateAllUTM() as { total_links?: NumLike; segments_processed?: NumLike } | null;
      notify(`Created ${fmt(r?.total_links)} campaign links across ${fmt(r?.segments_processed)} audiences.`, 'success');
      setConfirmAll(false);
      void list.reload();
      onChanged();
    } catch (e) {
      notify(`Couldn't create the links: ${errText(e)}`, 'error');
    } finally { setGenerating(false); }
  };

  const filtered = !!(search || segment);
  const cols: Col<UtmLink>[] = [
    { key: 'campaign', label: 'Campaign', cell: l => {
      const st = statusOf(l.campaign_status);
      return (
        <span className={styles.nameCell}>
          <span className={styles.nameText} title={l.campaign_name || l.template_name || undefined}>{l.campaign_name || l.template_name || 'Unnamed campaign'}</span>
          <span className={styles.chipRow}><Chip tone={st.tone}>{st.label}</Chip></span>
        </span>
      );
    } },
    { key: 'channel', label: 'Channel', cell: l => channelLabel(l.channel) },
    { key: 'audience', label: 'Audience', cell: l => (
      <span>
        <span className={styles.nameText}>{l.segment_label || '—'}</span>
        {num(l.target_count) > 0 && <span className={styles.sub}>{fmt(l.target_count)} people</span>}
      </span>
    ) },
    { key: 'link', label: 'Link', cell: l => <LinkCell url={l.full_url} /> },
    { key: 'clicks', label: 'Clicks', num: true, cell: l => fmt(l.clicks) },
  ];
  const bare = !filtered && !list.loading && !list.error && (list.data?.total ?? 0) === 0;
  const confirm = (
    <ConfirmDialog open={confirmAll} busy={generating} onCancel={closeConfirm} onConfirm={() => void generateAll()}
      title="Create links for all campaigns?"
      description="This creates a tracked link for every campaign, in every audience, that doesn't have one yet. Links that already exist are kept with their numbers. It can take a minute."
      confirmLabel={generating ? 'Creating…' : 'Create links'} />
  );

  if (bare) {
    return (
      <div className={styles.note} data-testid="campaign-links-none">
        No campaign links yet.
        <Button size="sm" onClick={() => setConfirmAll(true)} disabled={generating}>
          <Zap size={14} /> Create links for all campaigns
        </Button>
        {confirm}
      </div>
    );
  }

  return (
    <Card className={styles.card} aria-label="Campaign links">
      <div className={styles.cardHead}>
        <div className={styles.cardTitleBlock}>
          <h3 className={styles.cardTitle}>Campaign links</h3>
          <span className={styles.metaLine}>One tracked link per campaign and audience</span>
        </div>
        <div className={styles.cardActions}>
          <MoreMenu label="More campaign link actions" busy={generating} items={[
            { label: 'Create links for all campaigns', icon: <Zap size={14} />, disabled: generating, onSelect: () => setConfirmAll(true),
              title: 'Create a tracked link for every campaign that does not have one yet' },
            { label: 'Reload list', icon: <RefreshCw size={14} />, onSelect: () => void list.reload() },
          ]} />
        </div>
      </div>
      <div className={styles.toolbar}>
        <SearchBox value={searchInput} onChange={setSearchInput} placeholder="Search campaign or audience" label="Search campaign links" />
        <select className={`ui-input ${styles.select}`} value={segment} aria-label="Audience" disabled={segmentsLoading}
          onChange={e => setSegment(e.target.value)}>
          <option value="">{segmentsLoading ? 'Loading audiences…' : 'All audiences'}</option>
          {segments.map(s => <option key={s.segment_name} value={s.segment_name}>{s.segment_name}</option>)}
        </select>
      </div>
      {!list.loading && summary.length > 0 && (
        <div className={styles.channelStrip} aria-label="Links by channel">
          {summary.map(c => (
            <span key={c.channel ?? 'none'} className={styles.channelPill}>
              {channelLabel(c.channel)} <b>{fmt(c.total_links)}</b> links · <b>{fmt(c.total_clicks)}</b> clicks
            </span>
          ))}
        </div>
      )}
      <ListTable label="Campaign links" testId="campaign-links" cols={cols} rows={rows} rowKey={l => l.utm_id}
        loading={list.loading} slow={list.slow} error={list.error} onRetry={() => void list.reload()}
        errorTitle="Couldn't load campaign links" skeletonRows={Math.min(limit, rows.length || 8)}
        empty="No campaign links match your search." />
      <Pager page={page} limit={limit} total={list.data?.total ?? 0} shown={rows.length} loading={list.loading} noun="links"
        onPage={setPage} onLimit={n => { setLimit(n); setPage(1); }} />
      {confirm}
    </Card>
  );
}

// ── Tab: My links (personal, one per person) ───────────────────────────────
// Totals and the per-campaign breakdown are already in the overview's campaign links section,
// so this tab only has the tool (create) and the paged list of links.
function MyLinksTab() {
  const notify = useNotify();
  // Campaigns that already have personal links — used for the list's campaign filter.
  const fetchLinkedCampaigns = useCallback(async () => asArray<UserLinkCampaign>((await getUserLinkStats() as Partial<UserLinkStatsData> | null)?.campaigns), []);
  const linked = useLoader(fetchLinkedCampaigns);
  // Campaign picker for "Create personal links": searched on the server (name or audience), 50 at a time,
  // instead of the first 20 campaigns only.
  const [campaignQInput, setCampaignQInput] = useState('');
  const campaignQ = useDebounced(campaignQInput.trim());
  const fetchCampaigns = useCallback(async () => listFrom<CampaignOption>(
    await getCampaigns(campaignQ ? { search: campaignQ, limit: CAMPAIGN_PICK_LIMIT } : { limit: CAMPAIGN_PICK_LIMIT }), 'campaigns'), [campaignQ]);
  const campaigns = useLoader(fetchCampaigns);

  const [campaignId, setCampaignId] = useState('');
  const [clicked, setClicked] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput.trim());
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [lastFilter, setLastFilter] = useState(`${campaignId}|${clicked}|${search}`);
  if (lastFilter !== `${campaignId}|${clicked}|${search}`) { setLastFilter(`${campaignId}|${clicked}|${search}`); setPage(1); }

  const fetchLinks = useCallback(async (): Promise<Paged<UserLink>> => {
    const params: QueryParams = { page, limit };
    if (campaignId) params.campaignId = campaignId;
    if (clicked) params.clicked = clicked;
    if (search) params.search = search;
    const res = await getUserLinks(params) as UserLinksResponse | null;
    return { rows: asArray<UserLink>(res?.links), total: num(res?.stats?.total_links) };
  }, [page, limit, campaignId, clicked, search]);
  const links = useLoader(fetchLinks);
  const rows = links.data?.rows ?? [];

  const [genFor, setGenFor] = useState('');
  const [generating, setGenerating] = useState(false);
  const generate = async () => {
    if (!genFor) return;
    setGenerating(true);
    try {
      const r = await generateUserLinks(genFor) as { links_generated?: NumLike; campaign_name?: string | null } | null;
      notify(`Created ${fmt(r?.links_generated)} personal links for "${r?.campaign_name ?? 'the campaign'}".`, 'success');
      void linked.reload();
      void links.reload();
    } catch (e) {
      notify(`Couldn't create personal links: ${errText(e)}`, 'error');
    } finally { setGenerating(false); }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkCols: Col<UserLink>[] = [
    { key: 'who', label: 'Person', cell: l => (
      <span className={styles.nameCell}>
        <span className={styles.nameText}>{l.customer_name || 'Unknown'}</span>
        {l.customer_email && <span className={styles.sub}>{l.customer_email}</span>}
      </span>
    ) },
    { key: 'campaign', label: 'Campaign', cell: l => (
      <span className={styles.nameCell}>
        <span className={styles.nameText}>{l.campaign_name || '—'}</span>
        {(l.segment_label || l.channel) && <span className={styles.sub}>{[l.segment_label, l.channel ? channelLabel(l.channel) : null].filter(Boolean).join(' · ')}</span>}
      </span>
    ) },
    { key: 'link', label: 'Link', cell: l => <LinkCell url={`${origin}/api/v3/utm/track/${l.token}`} label={`/track/${l.token}`} open={false} /> },
    { key: 'clicks', label: 'Clicks', num: true, cell: l => fmt(l.click_count) },
    { key: 'last', label: 'Last click', cell: l => (l.last_clicked_at
      ? <span className={styles.nowrap} title={dubaiFull(l.last_clicked_at)}>{dubaiShort(l.last_clicked_at)}</span>
      : <span className={styles.muted}>Not yet</span>) },
  ];

  const filtered = !!(campaignId || clicked || search);
  const bare = !filtered && !links.loading && !links.error && (links.data?.total ?? 0) === 0;
  const campaignList = campaigns.data ?? [];

  let createTool: ReactNode;
  if (campaigns.loading && !campaigns.data) {
    createTool = <Skeleton height={34} width={320} />;
  } else if (campaigns.error) {
    createTool = <ErrorLine text="Couldn't load campaigns" details={campaigns.error} onRetry={() => void campaigns.reload()} />;
  } else if (campaignList.length === 0 && !campaignQ) {
    createTool = <p className={styles.note}>There are no campaigns to create personal links for yet.</p>;
  } else {
    createTool = (
      <div className={styles.createRow}>
        <SearchBox value={campaignQInput} onChange={setCampaignQInput} placeholder="Find a campaign by name or audience" label="Find a campaign" />
        <label className={styles.filterField}>
          Create personal links for
          <select className={`ui-input ${styles.control}`} value={genFor} onChange={e => setGenFor(e.target.value)}
            disabled={campaigns.loading && campaignList.length === 0}>
            <option value="">{campaigns.loading ? 'Searching…' : campaignList.length === 0 ? 'No campaigns match' : 'Choose a campaign'}</option>
            {campaignList.map(c => (
              <option key={c.id} value={String(c.id)}>
                {c.name || `Campaign #${c.id}`}{c.segment_label ? ` — ${c.segment_label}` : ''}{c.channel ? ` (${channelLabel(c.channel)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" onClick={() => void generate()} disabled={!genFor || generating}>
          {generating ? <Loader2 size={14} className={styles.spin} /> : <Plus size={14} />} {generating ? 'Creating…' : 'Create links'}
        </Button>
      </div>
    );
  }

  return (
    <>
      <p className={styles.intro}>
        Personal links give every person in a campaign their own link, so you can see exactly who clicked.
      </p>
      {createTool}

      {bare ? (
        <p className={styles.note} data-testid="personal-links-none">No personal links yet.</p>
      ) : (
        <Card className={styles.card} aria-label="Personal links">
          <div className={styles.cardHead}>
            <div className={styles.cardTitleBlock}>
              <h3 className={styles.cardTitle}>Personal links</h3>
              {!links.loading && links.data && <span className={styles.metaLine}>{fmt(links.data.total)} links</span>}
            </div>
            <Button size="sm" onClick={() => void links.reload()} disabled={links.loading} aria-label="Refresh personal links">
              {links.loading ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}
            </Button>
          </div>
          <div className={styles.toolbar}>
            <SearchBox value={searchInput} onChange={setSearchInput} placeholder="Name or email" label="Search personal links" />
            {(linked.data ?? []).length > 0 && (
              <select className={`ui-input ${styles.select}`} value={campaignId} aria-label="Campaign" onChange={e => setCampaignId(e.target.value)}>
                <option value="">All campaigns</option>
                {(linked.data ?? []).map(c => (
                  <option key={c.campaign_id} value={String(c.campaign_id)}>{c.campaign_name || `Campaign #${c.campaign_id}`}</option>
                ))}
              </select>
            )}
            <select className={`ui-input ${styles.select}`} value={clicked} aria-label="Clicked or not" onChange={e => setClicked(e.target.value)}>
              <option value="">Clicked or not</option>
              <option value="true">Clicked</option>
              <option value="false">Not clicked yet</option>
            </select>
          </div>
          <ListTable label="Personal links" testId="personal-links" cols={linkCols} rows={rows} rowKey={l => l.link_id}
            loading={links.loading} slow={links.slow} error={links.error} onRetry={() => void links.reload()}
            errorTitle="Couldn't load personal links" skeletonRows={Math.min(limit, rows.length || 8)}
            empty="No personal links match these filters." />
          <Pager page={page} limit={limit} total={links.data?.total ?? 0} shown={rows.length} loading={links.loading} noun="links"
            onPage={setPage} onLimit={n => { setLimit(n); setPage(1); }} />
        </Card>
      )}
    </>
  );
}

// ── Tab: Segments ──────────────────────────────────────────────────────────
function SegmentsTab({ loader, onChanged }: { loader: Loader<UtmSegment[]>; onChanged: () => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const paged = useClientPage(loader.data ?? []);
  const generate = async (label: string) => {
    setBusy(label);
    try {
      const r = await generateSegmentUTM(label) as { links?: unknown[] } | null;
      notify(`Created ${fmt(r?.links?.length ?? 0)} campaign links for ${label}.`, 'success');
      onChanged();
    } catch (e) {
      notify(`Couldn't create links for ${label}: ${errText(e)}`, 'error');
    } finally { setBusy(null); }
  };
  const cols: Col<UtmSegment>[] = [
    { key: 'name', label: 'Audience', cell: s => <span className={styles.strong}>{s.segment_name}</span> },
    { key: 'people', label: 'People', num: true, cell: s => fmt(s.customer_count) },
    { key: 'campaigns', label: 'Campaigns', num: true, cell: s => fmt(s.campaign_count) },
    { key: 'links', label: 'Tracked links', num: true, cell: s => (num(s.utm_count) > 0 ? fmt(s.utm_count) : <Chip tone="mute">None yet</Chip>) },
    { key: 'clicks', label: 'Clicks', num: true, cell: s => fmt(s.total_clicks) },
    { key: 'act', label: <span className={styles.srOnly}>Actions</span>, num: true, cell: s => {
      const noCampaigns = num(s.campaign_count) === 0;
      return (
        <Button size="sm" onClick={() => void generate(s.segment_name)} disabled={busy !== null || noCampaigns}
          title={noCampaigns ? 'This audience has no campaigns yet' : 'Create a tracked link for each campaign in this audience'}
          aria-label={`${num(s.utm_count) > 0 ? 'Update' : 'Create'} links for ${s.segment_name}`}>
          {busy === s.segment_name ? <><Loader2 size={14} className={styles.spin} /> Creating…</> : num(s.utm_count) > 0 ? 'Update links' : 'Create links'}
        </Button>
      );
    } },
  ];
  if (loader.error && !loader.loading) return <ErrorLine text="Couldn't load audiences" details={loader.error} onRetry={() => void loader.reload()} />;
  if (!loader.loading && paged.total === 0) return <p className={styles.note} data-testid="segments-none">No audiences yet.</p>;
  return (
    <Card className={styles.card} aria-label="Segments">
      <div className={styles.cardHead}>
        <div className={styles.cardTitleBlock}>
          <h3 className={styles.cardTitle}>Audiences (segments)</h3>
          <span className={styles.metaLine}>Tracked campaign links per audience</span>
        </div>
        <Button size="sm" onClick={() => void loader.reload()} disabled={loader.loading} aria-label="Refresh audiences">
          {loader.loading ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}
        </Button>
      </div>
      <ListTable label="Audiences" testId="segments" cols={cols} rows={paged.rows} rowKey={s => s.segment_name}
        loading={loader.loading} slow={loader.slow} error={loader.error} onRetry={() => void loader.reload()}
        errorTitle="Couldn't load audiences" skeletonRows={paged.rows.length || 8} empty="No audiences yet." />
      <Pager page={paged.page} limit={paged.limit} total={paged.total} shown={paged.rows.length} loading={loader.loading}
        noun="audiences" onPage={paged.setPage} onLimit={paged.setLimit} />
    </Card>
  );
}

// ── Link builder ───────────────────────────────────────────────────────────
interface BuilderState { baseUrl: string; channel: string; campaignName: string; segmentLabel: string; contentNumber: number }
const cleanPart = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
function isValidUrl(u: string): boolean {
  try { new URL(u); return true; } catch { return false; }
}
/** Same link the server's buildUTM makes, so the preview matches what Create returns. */
function previewLink(b: BuilderState): string | null {
  if (!isValidUrl(b.baseUrl)) return null;
  const medium = b.channel || 'email';
  const params = new URLSearchParams({
    utm_source: FIXED_SOURCE,
    utm_medium: medium,
    utm_campaign: `${cleanPart(b.campaignName || 'campaign')}_${cleanPart(b.segmentLabel || 'all')}`,
    utm_content: `${medium}_${b.contentNumber}`,
  });
  return `${b.baseUrl}?${params.toString()}`;
}

function ParamLabel({ label, param }: { label: string; param: string }) {
  return <>{label}<span className={styles.paramName}>{param}</span></>;
}

function LinkBuilder({ segments, segmentsLoading, segmentsError, onRetrySegments }: {
  segments: UtmSegment[]; segmentsLoading: boolean; segmentsError: string | null; onRetrySegments: () => void;
}) {
  const notify = useNotify();
  const [b, setB] = useState<BuilderState>({ baseUrl: DEFAULT_LANDING, channel: 'email', campaignName: '', segmentLabel: '', contentNumber: 1 });
  const [created, setCreated] = useState('');
  const [creating, setCreating] = useState(false);
  const [touchedUrl, setTouchedUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const update = (patch: Partial<BuilderState>) => { setB(prev => ({ ...prev, ...patch })); setCreated(''); };
  const urlOk = isValidUrl(b.baseUrl);
  const preview = previewLink(b);
  const ready = !!b.segmentLabel && !!b.campaignName.trim();
  const finalLink = created || preview;

  const create = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!urlOk) {
      setTouchedUrl(true);
      setCreated('');
      notify('Please enter a valid landing page URL (e.g. https://www.raynatours.com/activities)', 'error');
      return;
    }
    if (!ready) return;
    setCreating(true);
    try {
      const r = await buildUTM(b) as { utm_url?: string } | null;
      if (!r?.utm_url) throw new Error('No link came back');
      setCreated(r.utm_url);
      notify('Your tracked link is ready.', 'success');
    } catch (err) {
      notify(`Couldn't create the link: ${errText(err)}`, 'error');
    } finally { setCreating(false); }
  };
  const copy = async () => {
    if (!finalLink) return;
    if (await copyText(finalLink)) setCopied(true);
    else notify("Couldn't copy — your browser blocked it. Select the link and copy it by hand.", 'error');
  };

  const query = finalLink && finalLink.includes('?') ? finalLink.slice(finalLink.indexOf('?') + 1) : '';
  const base = finalLink ? finalLink.split('?')[0] : '';
  const parts = query ? query.split('&').map(p => {
    const [k, v = ''] = p.split('=');
    let val = v;
    try { val = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    return { k, v: val };
  }) : [];

  return (
    <div className={styles.builder}>
      <Card className={styles.card} aria-label="Link details">
        <h3 className={styles.cardTitle}>Link details</h3>
        <form className={styles.form} onSubmit={create} noValidate>
          <Field label="Destination page" required
            help="The page on raynatours.com people should land on."
            error={touchedUrl && !urlOk ? 'Enter a full web address, starting with https://' : undefined}>
            {p => <Input {...p} value={b.baseUrl} inputMode="url" onBlur={() => setTouchedUrl(true)}
              onChange={e => update({ baseUrl: e.target.value })} placeholder={DEFAULT_LANDING} />}
          </Field>
          <Field label={<ParamLabel label="Campaign name" param="utm_campaign" />} required
            help="A short name, e.g. Spring_Sale. Spaces and symbols become _.">
            {p => <Input {...p} value={b.campaignName} onChange={e => update({ campaignName: e.target.value })} placeholder="e.g. Spring_Sale_Email" />}
          </Field>
          <Field label="Audience" required help="Added to the campaign name so you can compare audiences."
            error={segmentsError ? "Couldn't load audiences." : undefined}>
            {p => (
              <Select {...p} value={b.segmentLabel} disabled={segmentsLoading} onChange={e => update({ segmentLabel: e.target.value })}>
                <option value="">{segmentsLoading ? 'Loading audiences…' : 'Choose an audience'}</option>
                {segments.map(s => (
                  <option key={s.segment_name} value={s.segment_name}>
                    {s.segment_name}{s.customer_count !== undefined && s.customer_count !== null ? ` (${fmt(s.customer_count)} people)` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {segmentsError && <Button size="sm" onClick={onRetrySegments}>Try again</Button>}
          <div className={styles.formRow}>
            <Field label={<ParamLabel label="Medium" param="utm_medium" />} help="Where the link is shared.">
              {p => (
                <Select {...p} value={b.channel} onChange={e => update({ channel: e.target.value })}>
                  {BUILDER_CHANNELS.map(c => <option key={c} value={c}>{channelLabel(c)}</option>)}
                </Select>
              )}
            </Field>
            <Field label={<ParamLabel label="Version" param="utm_content" />} help="Use 2, 3… to tell links in the same message apart.">
              {p => <Input {...p} type="number" min={1} value={b.contentNumber}
                onChange={e => update({ contentNumber: parseInt(e.target.value, 10) || 1 })} />}
            </Field>
          </div>
          <Field label={<ParamLabel label="Source" param="utm_source" />} help="Set automatically so every visit is credited to our messages.">
            {p => <div id={p.id} className={styles.fixedValue}>{FIXED_SOURCE}</div>}
          </Field>
          <div className={styles.builderActions}>
            <Button type="submit" variant="primary" disabled={!ready || creating}>
              {creating ? <Loader2 size={14} className={styles.spin} /> : <Link2 size={14} />} {creating ? 'Creating…' : 'Create link'}
            </Button>
          </div>
          {!ready && <p className={styles.previewHelp}>Enter a campaign name and choose an audience to create the link.</p>}
        </form>
      </Card>

      <div className={styles.builderStack}>
        <Card className={styles.card} aria-label="Your link">
          {created ? (
            <p className={styles.resultTitle}><Check size={14} /> Your link is ready</p>
          ) : (
            <h3 className={styles.cardTitle}>Preview</h3>
          )}
          <p className={styles.preview} data-testid="link-preview">
            {finalLink ? (
              <>
                {base}
                {parts.length > 0 && <span className={styles.previewKey}>?</span>}
                {parts.map((p, i) => (
                  <span key={`${p.k}-${i}`}>
                    {i > 0 && <span className={styles.previewKey}>&amp;</span>}
                    <span className={styles.previewKey}>{p.k}=</span>
                    <span className={styles.previewVal}>{p.v}</span>
                  </span>
                ))}
              </>
            ) : <span className={styles.previewEmpty}>Enter a valid destination page to see the link.</span>}
          </p>
          {!created && finalLink && <p className={styles.previewHelp}>This updates as you type. Click Create link to confirm it.</p>}
          <div className={styles.builderActions}>
            <Button onClick={() => void copy()} disabled={!finalLink}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
            </Button>
            {created && (
              <a className="ui-btn" href={created} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function BuilderDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={styles.drawerBackdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.drawerHead}>
          <h2 id={titleId} className={styles.drawerTitle}>Create a tracked link</h2>
          <Button icon variant="ghost" ref={closeRef} onClick={onClose} aria-label="Close"><X size={16} /></Button>
        </div>
        <div className={styles.drawerBody}>{children}</div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
type TabKey = 'visits' | 'campaigns' | 'links' | 'segments' | 'builder';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'visits', label: 'Email visits' },
  { key: 'campaigns', label: 'Campaign links' },
  { key: 'links', label: 'My links' },
  { key: 'segments', label: 'Segments' },
  { key: 'builder', label: 'Link builder' },
];
const DEFAULT_TAB: TabKey = 'visits';
const isTab = (v: string | null): v is TabKey => TABS.some(t => t.key === v);
const NEEDS_SEGMENTS: TabKey[] = ['campaigns', 'segments', 'builder'];

export default function UTMTracking() {
  const [tab, setTab] = useState<TabKey>(DEFAULT_TAB);
  const [visited, setVisited] = useState<TabKey[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [segmentsWanted, setSegmentsWanted] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: ToastType; id: number } | null>(null);

  // The open tab lives in ?tab= so a refresh or shared link opens the same tab.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    const start = isTab(fromUrl) ? fromUrl : DEFAULT_TAB;
    setTab(start);
    setVisited([start]);
    if (NEEDS_SEGMENTS.includes(start)) setSegmentsWanted(true);
  }, []);

  const openTab = (key: TabKey) => {
    setTab(key);
    setVisited(v => (v.includes(key) ? v : [...v, key]));
    if (NEEDS_SEGMENTS.includes(key)) setSegmentsWanted(true);
    const url = new URL(window.location.href);
    if (key === DEFAULT_TAB) url.searchParams.delete('tab'); else url.searchParams.set('tab', key);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const fetchSegments = useCallback(async () => listFrom<UtmSegment>(await getUTMSegments()), []);
  const segments = useLoader(fetchSegments, segmentsWanted);
  const reloadSegments = segments.reload;
  const onLinksChanged = useCallback(() => { void reloadSegments(); }, [reloadSegments]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback<Notify>((msg, type = 'info') => setToast({ msg, type, id: Date.now() }), []);

  const openDrawer = () => { setSegmentsWanted(true); setDrawerOpen(true); };
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const segList = segments.data ?? [];
  const builder = (
    <LinkBuilder segments={segList} segmentsLoading={segments.loading} segmentsError={segments.error}
      onRetrySegments={() => void segments.reload()} />
  );
  const panel = (key: TabKey, content: ReactNode) => (visited.includes(key) ? (
    <div key={key} role="tabpanel" aria-label={TABS.find(t => t.key === key)?.label} hidden={tab !== key} className={styles.tabPanel}>
      {content}
    </div>
  ) : null);

  return (
    <ToastCtx.Provider value={notify}>
      <div className={styles.page}>
        <PageHeader
          title="Website & links"
          description="What people do on raynatours.com after our messages, and the tracked links that bring them there."
          actions={<Button variant="primary" onClick={openDrawer}><Plus size={14} /> Create a tracked link</Button>}
        />

        <WebsiteOverview />

        <section className={styles.tools} aria-label="Link tools">
          <h2 className={styles.toolsTitle}>Link tools</h2>
          <div className={styles.tabsScroll}><Tabs label="Link tools" items={TABS} value={tab} onChange={openTab} /></div>
          {panel('visits', <EmailVisitsTab />)}
          {panel('campaigns', <CampaignLinksTab segments={segList} segmentsLoading={segments.loading} onChanged={onLinksChanged} />)}
          {panel('links', <MyLinksTab />)}
          {panel('segments', <SegmentsTab loader={segments} onChanged={onLinksChanged} />)}
          {panel('builder', builder)}
        </section>

        <BuilderDrawer open={drawerOpen} onClose={closeDrawer}>{builder}</BuilderDrawer>

        {toast && <div key={toast.id} className={`toast toast-${toast.type}`} role="status">{toast.msg}</div>}
      </div>
    </ToastCtx.Provider>
  );
}
