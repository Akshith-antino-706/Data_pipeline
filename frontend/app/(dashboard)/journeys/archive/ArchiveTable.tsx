'use client';

/**
 * Journey Archive table — the Performance "Your journeys" table for journeys archived to S3.
 *
 * Same look and controls as JourneysTable (search, type, sort, pages, rows per page, CSV, step
 * breakdown, "Steps on [day]", message previews), plus a month filter and the archived data
 * downloads. Everything comes from GET /api/v3/journey-archive/* — the archive files in S3,
 * never the live database. Above the table: "At a glance" totals for the journeys that match.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Eye, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { getArchiveTable, getArchiveNodes, getArchivedJourney, getArchivedTableDownload, downloadArchiveCsv } from '@/lib/api';
import type { ArchiveTableOptions, ArchiveTableSort } from '@/lib/api';
import { useUrlState } from '@/lib/useUrlState';
import { nodeLabel } from '@/lib/nodeLabel';
import { Button, Card, Chip, Skeleton } from '@/components/ui';
import StepEmailModal from '../analytics/StepEmailModal';
import styles from '../analytics/analytics.module.css';
import tiles from '../analytics/InsightsOverview.module.css';
import {
  num, fmt, fmtRate, rateOf, openRate, clickRate, timeAgo, dubaiDateTime, dubaiDate, humanDay, dubaiToday, statusOf, isAlwaysOn,
  Engaged, RateBar, SortHead,
} from '../analytics/tableParts';
import type { AnalyticsRow } from '../analytics/tableParts';
import ArchivedEmailModal from './ArchivedEmailModal';

interface ArchiveRow extends AnalyticsRow {
  completed_month: string;
  last_sent_at: string | null;
  archived_at: string | null;
  archive_bytes: number;
  has_templates: boolean;
}
interface ArchiveTotals { journeys: number; entries: number; sent: number; delivered: number; opened: number; clicked: number; unsubscribed: number; booked: number; archive_bytes: number }
interface ArchiveTableResponse {
  data?: {
    journeys?: ArchiveRow[]; total?: number; totals?: ArchiveTotals; months?: string[];
    meta?: { archived?: number; last_archived_at?: string | null };
  };
}
interface ArchiveTableInfo { rows?: number | string | null; gz_bytes?: number | string | null }
interface ExpandedState { loading: boolean; nodes?: AnalyticsRow[]; tables?: Array<[string, ArchiveTableInfo]>; error?: string }
type Preview =
  | { kind: 'archived-email'; journeyId: number | string; nodeId: string; label?: string }
  | { kind: 'whatsapp'; waTemplateId: string | number; label?: string };

const TYPE_FILTERS = ['all', 'fixed', 'continuous'] as const;
type TypeFilter = typeof TYPE_FILTERS[number];
const SORT_KEYS: readonly ArchiveTableSort[] = ['completed', 'entries', 'sent', 'delivered', 'opened', 'clicked', 'unsubscribed', 'booked', 'openRate', 'clickRate', 'name'];
const SORT_DIRS = ['asc', 'desc'] as const;
const PAGE_SIZES = [20, 50] as const;
const MAIN_COLS = 8;

export const fmtBytes = (b: number | string | null | undefined): string => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = Number(b);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** When the journey finished: its last send day, else the month it was filed under. */
const completedLabel = (r: ArchiveRow) => dubaiDate(r.last_sent_at) || monthLabel(r.completed_month);

/** What the eye button opens for an archived step: the archived email, or the WhatsApp template. */
function previewOf(r: ArchiveRow, n: AnalyticsRow): Preview | null {
  if (n.wa_template_id) return { kind: 'whatsapp', waTemplateId: n.wa_template_id, label: n.node_label };
  if (n.template_id && n.node_id && r.has_templates) return { kind: 'archived-email', journeyId: r.journey_id, nodeId: n.node_id, label: n.node_label };
  return null;
}

function Glance({ totals, loading }: { totals: ArchiveTotals | null; loading: boolean }) {
  const t = totals;
  const items: Array<{ key: string; label: string; value: string; sub?: string; help: string }> = t ? [
    { key: 'journeys', label: 'Journeys archived', value: fmt(t.journeys), help: `${fmtBytes(t.archive_bytes)} stored in S3` },
    { key: 'sent', label: 'Sent', value: fmt(t.sent), help: `${fmt(t.entries)} people entered these journeys` },
    { key: 'opened', label: 'Opened', value: fmt(t.opened), sub: rateOf(t.opened, t.delivered || t.sent) === null ? undefined : `${fmtRate(rateOf(t.opened, t.delivered || t.sent))} of ${t.delivered ? 'delivered' : 'sent'}`, help: 'Messages opened at least once' },
    { key: 'clicked', label: 'Clicked', value: fmt(t.clicked), sub: rateOf(t.clicked, t.opened) === null ? undefined : `${fmtRate(rateOf(t.clicked, t.opened))} of opened`, help: 'Opened and clicked a link' },
    { key: 'unsubscribed', label: 'Unsubscribed', value: fmt(t.unsubscribed), sub: rateOf(t.unsubscribed, t.sent) === null ? undefined : `${fmtRate(rateOf(t.unsubscribed, t.sent))} of sent`, help: 'Asked to stop receiving messages' },
  ] : [];
  return (
    <section aria-label="At a glance">
      <h2 className={tiles.sectionTitle}>At a glance</h2>
      <div className={tiles.kpiGrid}>
        {!t ? Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={tiles.tile}><Skeleton height={12} width="55%" /><Skeleton height={26} width="70%" /><Skeleton height={10} width="90%" /></div>
        )) : items.map(k => (
          <div key={k.key} className={tiles.tile} data-testid={`archive-kpi-${k.key}`} aria-busy={loading}>
            <div className={tiles.tileHead}><span className={tiles.tileLabel}>{k.label}</span></div>
            <div className={tiles.valueRow}>
              <span className={tiles.value}>{k.value}</span>
              {k.sub && <span className={tiles.valueSub}>{k.sub}</span>}
            </div>
            <p className={tiles.help}>{k.help}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ArchiveTable() {
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<ArchiveTotals | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ archived?: number; last_archived_at?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Type, sort and direction live in the URL so a refresh keeps the table as it was (same as Performance).
  const [type, setType] = useUrlState<TypeFilter>('type', 'all', TYPE_FILTERS);
  const [sort, setSortKey] = useUrlState<ArchiveTableSort>('sort', 'completed', SORT_KEYS);
  const [dir, setDir] = useUrlState<'asc' | 'desc'>('dir', 'desc', SORT_DIRS);
  const [month, setMonth] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  const [dateFilter, setDateFilter] = useState(''); // '' = all time; YYYY-MM-DD = one Dubai day
  const [expanded, setExpanded] = useState<Record<string, ExpandedState>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Search waits until typing pauses, then goes to the server and back to page 1.
  useEffect(() => {
    const q = searchInput.trim();
    if (q === search) return undefined;
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const filterOpts = useCallback((): ArchiveTableOptions => {
    const o: ArchiveTableOptions = { sort, dir };
    if (search) o.search = search;
    if (type !== 'all') o.type = type;
    if (month) o.month = month;
    return o;
  }, [search, type, month, sort, dir]);

  const load = useCallback(async (fresh?: boolean) => {
    setLoading(true);
    try {
      const res = await getArchiveTable({ page, limit, ...filterOpts(), fresh }) as ArchiveTableResponse | null;
      const d = res?.data;
      setRows(Array.isArray(d?.journeys) ? d.journeys : []);
      setTotal(num(d?.total));
      setTotals(d?.totals || null);
      setMonths(d?.months || []);
      setMeta(d?.meta || null);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load the archive');
    } finally { setLoading(false); }
  }, [page, limit, filterOpts]);

  useEffect(() => { load(); }, [load]);
  // A new page, filter or day means different rows/steps → collapse so steps reload fresh.
  useEffect(() => { setExpanded({}); }, [dateFilter, type, month, search, sort, dir, page, limit]);

  const toggle = async (jid: string | number) => {
    if (expanded[jid]) { setExpanded(prev => { const n = { ...prev }; delete n[jid]; return n; }); return; }
    setExpanded(prev => ({ ...prev, [jid]: { loading: true } }));
    try {
      const [nodesRes, detailRes] = await Promise.all([
        getArchiveNodes(jid, dateFilter || undefined) as Promise<{ data?: AnalyticsRow[] } | null>,
        getArchivedJourney(jid) as Promise<{ data?: { manifest?: { tables?: Record<string, ArchiveTableInfo> } } } | null>,
      ]);
      setExpanded(prev => ({
        ...prev,
        [jid]: { loading: false, nodes: nodesRes?.data || [], tables: Object.entries(detailRes?.data?.manifest?.tables || {}) },
      }));
    } catch (e) {
      setExpanded(prev => ({ ...prev, [jid]: { loading: false, error: (e as Error).message } }));
    }
  };

  const onSort = (field: ArchiveTableSort) => {
    setPage(1);
    if (sort === field) { setDir(dir === 'asc' ? 'desc' : 'asc'); return; }
    setSortKey(field);
    setDir(field === 'name' ? 'asc' : 'desc');
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadArchiveCsv(filterOpts());
    } catch (e) {
      alert(`Download failed: ${(e as Error).message}`);
    } finally { setExporting(false); }
  };

  const downloadTable = async (jid: string | number, table: string) => {
    setDownloading(`${jid}:${table}`);
    try {
      const res = await getArchivedTableDownload(jid, table) as { data: { url: string } };
      window.location.href = res.data.url;   // signed S3 link — the browser downloads directly from S3
    } catch (e) {
      alert(`Download failed: ${(e as Error).message}`);
    } finally { setDownloading(null); }
  };

  const pages = Math.max(1, Math.ceil(total / limit));
  // If the list shrank and this page no longer exists, step back.
  useEffect(() => { if (!loading && page > pages) setPage(pages); }, [loading, page, pages]);
  const firstShown = total === 0 ? 0 : (page - 1) * limit + 1;
  const lastShown = Math.min(total, (page - 1) * limit + rows.length);
  const botWindow = num(rows[0]?.bot_window_sec) || 15;
  const filtered = !!(search || month || type !== 'all');

  const stepTable = (r: ArchiveRow, exp: ExpandedState) => (
    <div className={styles.steps}>
      <dl className={styles.journeyFacts}>
        <div><dt>People entered</dt><dd>{fmt(r.entries)}</dd></div>
        <div><dt>Delivered</dt><dd>{fmt(r.delivered)}</dd></div>
        <div><dt>Didn&apos;t send</dt><dd>{fmt(r.failed)}</dd></div>
        <div><dt>Bounced</dt><dd>{fmt(r.bounced)}</dd></div>
        <div><dt>Reached website</dt><dd>{fmt(r.landed)}</dd></div>
        <div><dt>Website actions</dt><dd>{fmt(r.gtm_events)}</dd></div>
        <div><dt>Booked</dt><dd>{fmt(r.booked)}</dd></div>
        <div><dt>Archived on</dt><dd title={dubaiDateTime(r.archived_at)}>{dubaiDate(r.archived_at) || '—'}</dd></div>
      </dl>
      <p className={styles.help}>
        {dateFilter
          ? <>Steps that sent on {humanDay(dateFilter)} (Dubai time), worked out from the archived send log. Delivered, bounced and website numbers are not kept per day in the archive.</>
          : <>Final numbers per step, as they were when the journey was archived. “Real people” means opened or clicked at least {botWindow} seconds after sending — faster ones are usually email security scanners.</>}
      </p>
      {exp.loading && (
        <p className={styles.help}>
          <Loader2 size={13} className={styles.spin} /> {dateFilter ? 'Reading the archived send log… the first time for a journey can take a few seconds.' : 'Loading steps…'}
        </p>
      )}
      {exp.error && <p className={styles.errorText} role="alert">{exp.error}</p>}
      {exp.nodes && exp.nodes.length === 0 && (
        <p className={styles.help}>{dateFilter ? `No step sent on ${humanDay(dateFilter)}.` : 'No step numbers in the archive.'}</p>
      )}
      {exp.nodes && exp.nodes.length > 0 && (
        <div className={styles.stepScroll}>
          <table className={styles.stepTable} aria-label={`Steps of ${r.journey_name || `journey #${r.journey_id}`}`}>
            <thead>
              <tr>
                <th className={styles.left}>Step</th>
                <th title="See the email or WhatsApp message this step sent">Message</th>
                <th>Sent</th><th>Delivered</th><th>Opened</th><th>Opened %</th><th>Clicked</th>
                <th title="Of the people who opened, how many clicked">Clicked %</th>
                <th title="Clicked and then did something on the website">Reached website</th><th>Unsubscribed</th>
              </tr>
            </thead>
            <tbody>
              {exp.nodes.map(n => {
                const pv = previewOf(r, n);
                const what = pv?.kind === 'whatsapp' ? 'WhatsApp message' : 'email';
                return (
                  <tr key={n.node_id}>
                    <td className={styles.left} title={n.node_label}>{n.node_label || nodeLabel(n.node_id)}</td>
                    <td>
                      {pv ? (
                        <button type="button" className={styles.iconBtn} onClick={() => setPreview(pv)}
                          title={`See the ${what} this step sent`} aria-label={`See the ${what} for ${n.node_label || 'this step'}`}>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {exp.tables && exp.tables.length > 0 && (
        <div className={styles.archiveFiles} aria-label="Archived data">
          <span className={styles.archiveFilesLabel}>Archived data</span>
          {exp.tables.map(([t, info]) => {
            const busy = downloading === `${r.journey_id}:${t}`;
            const empty = !Number(info.rows);
            return (
              <Button key={t} size="sm" onClick={() => downloadTable(r.journey_id, t)} disabled={busy || empty}
                title={empty ? 'No rows' : 'Download as a gzipped CSV (link valid 15 min)'}>
                {busy ? <Loader2 size={13} className={styles.spin} /> : <Download size={13} />}
                {t} <span className={styles.muted}>· {fmt(info.rows)} rows · {fmtBytes(info.gz_bytes)}</span>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );

  let body: ReactNode;
  if (loading && rows.length === 0) {
    body = (
      <div className={styles.loadingRows} data-testid="archive-loading">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={40} radius={8} />)}
      </div>
    );
  } else {
    body = (
      <div className={styles.tableScroll}>
        <table className={styles.journeyTable} aria-label="Archived journeys">
          <thead>
            <tr>
              <th className={styles.chevCol}><span className={styles.srOnly}>Expand</span></th>
              <SortHead label="Journey" field="name" sort={sort} dir={dir} onSort={onSort} left />
              <th className={styles.left}>Status</th>
              <SortHead label="Completed" field="completed" sort={sort} dir={dir} onSort={onSort} left tip="Day of the journey's last send (Dubai time)" />
              <SortHead label="Sent" field="sent" sort={sort} dir={dir} onSort={onSort} tip="Messages sent (not counting ones that failed)" />
              <SortHead label="Opened %" field="openRate" sort={sort} dir={dir} onSort={onSort} tip="Of the delivered messages, how many were opened" />
              <SortHead label="Clicked %" field="clickRate" sort={sort} dir={dir} onSort={onSort} tip="Of the people who opened, how many clicked a link" />
              <SortHead label="Unsubscribed" field="unsubscribed" sort={sort} dir={dir} onSort={onSort} tip="People who asked to stop receiving messages" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={MAIN_COLS} className={styles.emptyCell}>
                {filtered ? 'No archived journeys match your search or filters.' : 'No journeys have been archived yet.'}
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
                    <td className={styles.left} title={dubaiDateTime(r.last_sent_at)}>{completedLabel(r)}</td>
                    <td>{fmt(r.sent)}</td>
                    <td><RateBar rate={openRate(r)} /></td>
                    <td>{fmtRate(clickRate(r))}</td>
                    <td>{fmt(r.unsubscribed)}</td>
                  </tr>
                  {exp && (
                    <tr className={styles.stepRow}>
                      <td colSpan={MAIN_COLS}>{stepTable(r, exp)}</td>
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
    <>
      <Glance totals={totals} loading={loading} />

      <Card className={styles.tableCard} aria-label="Archived journeys">
        <div className={styles.tableHead}>
          <div className={styles.tableTitleBlock}>
            <h2 className={styles.sectionTitle}>Archived journeys</h2>
            <span className={styles.metaLine} title={meta?.last_archived_at ? `Last archived ${dubaiDateTime(meta.last_archived_at)} (Dubai time)` : undefined}>
              {fmt(meta?.archived ?? 0)} in the archive · last archived {timeAgo(meta?.last_archived_at)}
            </span>
          </div>
          <div className={styles.tableActions}>
            <Button size="sm" onClick={exportCsv} disabled={exporting} title="Download every archived journey that matches your filters">
              {exporting ? <Loader2 size={14} className={styles.spin} /> : <Download size={14} />} Download CSV
            </Button>
            <Button size="sm" onClick={() => load(true)} disabled={loading} aria-label="Reload from the archive" title="Read the archive again (it is cached for 10 minutes)">
              <RefreshCw size={14} />
            </Button>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} aria-hidden="true" />
            <input className={`ui-input ${styles.searchInput}`} value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by name or #id" aria-label="Search archived journeys" />
            {searchInput && (
              <button type="button" className={styles.clearBtn} aria-label="Clear search" onClick={() => setSearchInput('')}><X size={14} /></button>
            )}
          </div>
          <select className={`ui-input ${styles.select}`} value={month} title="Month the journey finished" aria-label="Month finished"
            onChange={e => { setMonth(e.target.value); setPage(1); }}>
            <option value="">All months</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
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
            <span>Couldn&apos;t load the archive. {error}</span>
            <Button size="sm" onClick={() => load()}>Try again</Button>
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

        {preview?.kind === 'archived-email' && (
          <ArchivedEmailModal journeyId={preview.journeyId} nodeId={preview.nodeId} label={preview.label} onClose={() => setPreview(null)} />
        )}
        {preview?.kind === 'whatsapp' && (
          <StepEmailModal step={preview} readOnly onClose={() => setPreview(null)} />
        )}
      </Card>
    </>
  );
}
