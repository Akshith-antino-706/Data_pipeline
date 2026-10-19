'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Map as MapIcon, Package, Building2, FileCheck, Plane, Layers, Loader2, Download, RefreshCw,
  Users, X, ExternalLink, Search,
} from 'lucide-react';
import {
  getAffinitySummary, getAffinityTopProducts, getAffinityCustomers, getContactAffinity, rebuildAffinity, downloadAffinityCSV,
} from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { CONTACT_TYPES } from '@/lib/contactTypes';
import {
  Button, Card, Checkbox, Chip, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, StatusChip, Table, Tabs, buttonClass,
} from '@/components/ui';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ContactType, Id } from '@/types/api';
import type { AffinityCustomerList, AffinitySummary, AffinityTopProduct, ContactAffinity } from '@/types/f7affinity';
import s from './affinity.module.css';

type View = 'service' | 'product';
interface IconCfg { label: string; icon: LucideIcon; color: string }
interface PillOption<T> { value: T; label: string }
interface PillGroupProps<T> { options: PillOption<T>[]; value: T; onChange: (value: T) => void; label: string }
interface RankCellProps { title: ReactNode; score: unknown; bookings: unknown }
interface TypeBadgesProps { contactType: string; isBulk?: boolean }
interface CustomerDrawerProps { id: Id; onClose: () => void }
interface ProductFilter { key: string; name: string }
interface BarItem { key: string; label: ReactNode; count: number | null | undefined; selected: boolean; disabled?: boolean; sub?: string; color: string; onPick: () => void }

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Business lines = the rayna_* booking tables
const SERVICES: Record<string, IconCfg> = {
  tours:    { label: 'Tours',    icon: MapIcon,   color: 'var(--info)' },
  packages: { label: 'Packages', icon: Package,   color: 'var(--purple)' },
  hotels:   { label: 'Hotels',   icon: Building2, color: 'var(--warn)' },
  visas:    { label: 'Visas',    icon: FileCheck, color: 'var(--ok)' },
  flights:  { label: 'Flights',  icon: Plane,     color: 'var(--ink3)' },
  others:   { label: 'Others',   icon: Layers,    color: 'var(--gold)' },
};

const VIEW_TABS: { key: View; label: string }[] = [
  { key: 'service', label: 'Services' },
  { key: 'product', label: 'Products' },
];

// "Booked in" window — ranks always use the full booking history
const PERIOD_OPTIONS = [
  { value: 'day', label: 'Last day' },
  { value: 'week', label: 'Last week' },
  { value: 'month', label: 'Last month' },
  { value: 'quarter', label: 'Last 3 months' },
  { value: 'year', label: 'Last year' },
  { value: 'all', label: 'All time' },
];
const SORT_OPTIONS = [
  { value: 'score', label: 'Interest score' },
  { value: 'bookings', label: 'Bookings in period' },
  { value: 'last', label: 'Latest booking' },
  { value: 'revenue', label: 'Revenue' },
];
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const RANKS = [1, 2, 3];

function formatNum(n: unknown) { return (Number(n) || 0).toLocaleString(); }
function formatAED(n: unknown) { return `AED ${Math.round(Number(n) || 0).toLocaleString()}`; }
// Old bookings decay to small scores — keep 2 decimals below 1 so they still read differently.
function formatScore(n: unknown) { const v = Number(n); return n == null || !Number.isFinite(v) ? '—' : v.toFixed(v < 1 ? 2 : 1); }
// 'YYYY-MM-DD' → '12 Mar 2025' (no Date parsing, so no timezone shift)
function formatDay(str: string | null | undefined) {
  if (!str) return '—';
  const [y, m, d] = String(str).slice(0, 10).split('-');
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TableSkeleton() {
  return (
    <div aria-label="Loading customers" aria-busy="true" className="ui-card" style={{ padding: 12 }}>
      {[0, 1, 2, 3, 4, 5].map(row => (
        <div key={row} style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(5, 1fr)', gap: 14, padding: '12px 4px', borderTop: row ? '1px solid var(--line)' : 'none' }}>
          {[0, 1, 2, 3, 4, 5].map(cell => <Skeleton key={cell} width="75%" height={12} />)}
        </div>
      ))}
    </div>
  );
}

// Single-select pill group.
function PillGroup<T extends string | number>({ options, value, onChange, label }: PillGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className={s.pills}>
      {options.map(o => (
        <button key={o.value} type="button" className={s.pill} onClick={() => onChange(o.value)} aria-pressed={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ServiceBadge({ service }: { service: string }) {
  const cfg = SERVICES[service];
  if (!cfg) return <span>{service}</span>;
  return <span className={s.service} style={{ color: cfg.color }}><cfg.icon size={14} aria-hidden="true" />{cfg.label}</span>;
}

// One "#n" cell: the service / product, with its score and bookings underneath.
function RankCell({ title, score, bookings }: RankCellProps) {
  if (!title) return <span style={{ color: 'var(--ink3)' }}>—</span>;
  return (
    <div style={{ minWidth: 0 }}>
      <div className={s.rankTitle} title={typeof title === 'string' ? title : undefined}>{title}</div>
      <div className={s.sub} style={{ fontVariantNumeric: 'tabular-nums' }}>score {formatScore(score)} · {formatNum(bookings)} booking{Number(bookings) === 1 ? '' : 's'}</div>
    </div>
  );
}

function TypeBadges({ contactType, isBulk }: TypeBadgesProps) {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <Chip tone="mute">{contactType}</Chip>
      {isBulk && <Chip tone="warn" title="50+ bookings in total (reseller, OTA, corporate) or a Rayna staff email">Bulk</Chip>}
    </span>
  );
}

// Horizontal bar list: click a row to filter the table.
function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map(i => Number(i.count) || 0), 1);
  return (
    <>
      {items.map(i => (
        <button key={i.key} type="button" className={s.bar} onClick={i.onPick} aria-pressed={i.selected} disabled={i.disabled}>
          <span className={s.barLabel}>{i.label}</span>
          <span className={s.barTrack} aria-hidden="true">
            <span className={s.barFill} style={{ width: `${((Number(i.count) || 0) / max) * 100}%`, background: i.color }} />
          </span>
          <span className={s.barNum}>{i.count != null ? formatNum(i.count) : '…'}</span>
          {i.sub && <span className={s.barSub}>{i.sub}</span>}
        </button>
      ))}
    </>
  );
}

// Side drawer: every ranked service and product of one customer.
function CustomerDrawer({ id, onClose }: CustomerDrawerProps) {
  const [data, setData] = useState<ContactAffinity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    (getContactAffinity(id) as Promise<ContactAffinity>)
      .then(d => { if (active) setData(d); })
      .catch((err: Error) => { if (active) setError(err.message || 'Failed to load customer'); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = data?.customer;
  const services = data?.services ?? [];
  const products = data?.products ?? [];

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <aside role="dialog" aria-label="Customer interests" className={s.drawer}>
        <div className={s.drawerHead}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{c?.name || (data || error ? 'Customer' : 'Loading…')}</h2>
            {c && <div className={s.note} style={{ marginTop: 4 }}>{[c.email, c.mobile, c.country].filter(Boolean).join(' · ')}</div>}
          </div>
          <Button variant="ghost" icon onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>

        {error && <div className={s.statusErr}>{error}</div>}
        {!data && !error && <div style={{ display: 'grid', gap: 14 }}><Skeleton height={60} /><Skeleton height={140} /><Skeleton height={200} /></div>}

        {c && (
          <>
            <div className={s.kpis}>
              {[
                { label: 'Bookings', value: formatNum(c.bookings_all) },
                { label: 'Revenue', value: formatAED(c.revenue_all) },
                { label: 'Score', value: formatScore(c.affinity_score) },
                { label: 'First booking', value: formatDay(c.first_booking_date) },
                { label: 'Last booking', value: formatDay(c.last_booking_date) },
                { label: 'Type', value: <TypeBadges contactType={c.contact_type} isBulk={c.is_bulk} /> },
              ].map(k => (
                <div key={k.label} className={s.kpi}>
                  <div className={s.kpiLabel}>{k.label}</div>
                  <div className={s.kpiValue}>{k.value}</div>
                </div>
              ))}
            </div>

            <h3>Services ({services.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className={s.drawerTable}>
                <thead><tr><th>#</th><th>Service</th><th className={s.r}>Bookings</th><th className={s.r}>Revenue</th><th>Last</th><th className={s.r}>Score</th></tr></thead>
                <tbody>
                  {services.map(sv => (
                    <tr key={sv.service}>
                      <td style={{ fontWeight: 700 }}>{sv.rank}</td>
                      <td><ServiceBadge service={sv.service} /></td>
                      <td className={s.r}>{formatNum(sv.bookings)}{sv.cancelled > 0 && <span style={{ color: 'var(--ink3)' }}> (+{sv.cancelled} cancelled)</span>}</td>
                      <td className={s.r}>{formatAED(sv.revenue)}</td>
                      <td>{formatDay(sv.last_booking_date)}</td>
                      <td className={s.r} style={{ fontWeight: 700 }}>{formatScore(sv.affinity_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>Products ({formatNum(c.product_count)}{c.product_count > products.length ? `, top ${products.length} shown` : ''})</h3>
            {products.length === 0 ? (
              <p className={s.help} style={{ marginBottom: 20 }}>Only fee, add-on or generic lines (e.g. “Ticket”, MIX Charges) — no products to rank.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className={s.drawerTable}>
                  <thead><tr><th>#</th><th>Product</th><th className={s.r}>Bookings</th><th>Last</th><th className={s.r}>Score</th></tr></thead>
                  <tbody>
                    {products.map(p => (
                      <tr key={p.product_key}>
                        <td style={{ fontWeight: 700 }}>{p.rank}</td>
                        <td style={{ whiteSpace: 'normal' }}>
                          <div>{p.product_name}</div>
                          <div className={s.sub}>{(p.services || []).map(x => SERVICES[x]?.label || x).join(', ')}</div>
                        </td>
                        <td className={s.r}>{formatNum(p.bookings)}</td>
                        <td>{formatDay(p.last_booking_date)}</td>
                        <td className={s.r} style={{ fontWeight: 700 }}>{formatScore(p.affinity_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Link href={`/contacts/${id}`} className={buttonClass('secondary')}>
              <ExternalLink size={15} /> Open contact profile
            </Link>
          </>
        )}
      </aside>
    </>
  );
}

export default function AffinityPage() {
  const { businessType } = useBusinessType();
  const [view, setView] = useState<View>('service');
  const [period, setPeriod] = useState('all');
  const [excludeBulk, setExcludeBulk] = useState(true);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<ProductFilter | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('score');
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [summary, setSummary] = useState<AffinitySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [topProducts, setTopProducts] = useState<AffinityTopProduct[]>([]);
  const [list, setList] = useState<AffinityCustomerList>({ total: 0, customers: [] });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Audience filters shared by every request on the page.
  const audience = useMemo(() => ({ businessType, period, excludeBulk: excludeBulk ? 1 : 0 }), [businessType, period, excludeBulk]);
  const listParams = useMemo(() => ({
    ...audience, view, sort, search,
    service: view === 'service' ? serviceFilter : undefined,
    product: view === 'product' ? productFilter?.key : undefined,
  }), [audience, view, sort, search, serviceFilter, productFilter]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('affinity-view');
      if (saved === 'service' || saved === 'product') setView(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let active = true;
    setSummaryError(null);
    (getAffinitySummary(audience) as Promise<AffinitySummary>)
      .then(d => { if (active) setSummary(d); })
      .catch((err: Error) => { if (active) setSummaryError(err.message || 'Failed to load booking interests summary'); });
    return () => { active = false; };
  }, [audience, refreshKey]);

  // While a build runs, poll its status; reload everything once it finishes.
  const building = summary?.status === 'running';
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => {
      (getAffinitySummary(audience) as Promise<AffinitySummary>)
        .then(d => { setSummary(d); if (d.status !== 'running') setRefreshKey(k => k + 1); })
        .catch(() => { /* keep polling */ });
    }, 8000);
    return () => clearInterval(timer);
  }, [building, audience]);

  useEffect(() => {
    if (view !== 'product') return;
    let active = true;
    (getAffinityTopProducts({ ...audience, limit: 12 }) as Promise<{ data?: AffinityTopProduct[] }>)
      .then(d => { if (active) setTopProducts(d.data || []); })
      .catch(() => { if (active) setTopProducts([]); });
    return () => { active = false; };
  }, [view, audience, refreshKey]);

  // Back to page 1 whenever what the table shows changes.
  useEffect(() => { setPage(1); }, [listParams, limit]);

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListError(null);
    (getAffinityCustomers({ ...listParams, limit, page }) as Promise<AffinityCustomerList>)
      .then(d => { if (active) setList({ ...d, customers: d?.customers ?? [] }); })
      .catch((err: Error) => { if (active) setListError(err.message || 'Failed to load customers'); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [listParams, limit, page, refreshKey]);

  const handleView = (v: View) => {
    setView(v);
    try { window.localStorage.setItem('affinity-view', v); } catch { /* ignore */ }
  };

  const handleRebuild = async () => {
    setRebuildError(null);
    try {
      await rebuildAffinity();
      setSummary(prev => ({ ...(prev || {}), status: 'running' }));
    } catch (err) {
      setRebuildError((err as Error).message || 'Could not start the rebuild');
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try { await downloadAffinityCSV(listParams); } catch (err) { setListError((err as Error).message); } finally { setDownloading(false); }
  };

  const totalPages = Math.max(Math.ceil((list.total || 0) / limit), 1);
  const notBuilt = summary && !summary.builtAt && !building;
  const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label;
  const scopeLabel = CONTACT_TYPES.includes(businessType as ContactType) ? businessType : CONTACT_TYPES.join(' + ');

  const serviceBars: BarItem[] = [{ service: null, customers: summary?.totalCustomers }, ...(summary?.topService || [])].map(sv => {
    const cfg = sv.service ? (SERVICES[sv.service] ?? { label: sv.service, icon: Users, color: 'var(--ink3)' }) : { label: 'All customers', icon: Users, color: 'var(--gold)' };
    const empty = Boolean(sv.service && !sv.customers);
    return {
      key: sv.service || 'all',
      label: <><cfg.icon size={14} aria-hidden="true" style={{ color: cfg.color, flexShrink: 0 }} />{cfg.label}</>,
      count: summary ? (sv.customers ?? 0) : null,
      selected: serviceFilter === sv.service,
      disabled: empty,
      sub: empty ? 'No bookings' : undefined,
      color: cfg.color,
      onPick: () => setServiceFilter(sv.service),
    };
  });
  const productBars: BarItem[] = [{ product_key: null, product_name: 'All products', customers: summary?.totalCustomers }, ...topProducts].map(p => ({
    key: p.product_key || 'all',
    label: <span title={p.product_name} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.product_name}</span>,
    count: p.customers,
    selected: (productFilter?.key || null) === p.product_key,
    color: p.product_key ? 'var(--info)' : 'var(--gold)',
    onPick: () => setProductFilter(p.product_key ? { key: p.product_key, name: p.product_name } : null),
  }));
  if (productFilter && !topProducts.some(p => p.product_key === productFilter.key)) {
    productBars.push({ key: productFilter.key, label: productFilter.name, count: null, selected: true, color: 'var(--info)', onPick: () => {} });
  }

  const filterLabel = view === 'service'
    ? (serviceFilter ? <> with <ServiceBadge service={serviceFilter} /> as #1</> : null)
    : (productFilter ? <> with <b>{productFilter.name}</b> as #1</> : null);

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Booking interests' }]}
        title="Booking interests"
        description="Each customer's top 3 services and products. Every booking adds 10 points, halving every 6 months, so frequent and recent bookings rank first."
        actions={(
          <>
            <Button onClick={handleDownload} disabled={downloading || !list.total}>
              {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {downloading ? 'Preparing…' : 'Export CSV'}
            </Button>
            <Link href="/segmentation" className={buttonClass('primary')}>Create segment from these filters</Link>
          </>
        )}
      />

      {/* Build status */}
      <Card className={s.status}>
        {building ? <StatusChip tone="info">Building now</StatusChip>
          : summary?.builtAt ? <StatusChip tone={summary.lastError ? 'warn' : 'ok'}>Built {formatDateTime(summary.builtAt)}</StatusChip>
          : summary ? <StatusChip tone="mute">Not built yet</StatusChip>
          : <Skeleton width={160} height={24} radius={999} />}
        <span className={s.statusNote}>Rebuilds every night at 4:30 AM Dubai</span>
        {rebuildError && <span className={s.statusErr}>{rebuildError}</span>}
        <span className={s.spacer} />
        <Button variant="ghost" size="sm" onClick={handleRebuild} disabled={building || !summary}>
          {building ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {building ? 'Building… (a few minutes)' : 'Rebuild now'}
        </Button>
      </Card>

      {summary?.lastError && !building && (
        <Card className={s.errorCard}>
          <b>Last build failed</b>
          <p className={s.note}>{summary.builtAt ? `Showing results from ${formatDateTime(summary.builtAt)}. ` : ''}Reason: {summary.lastError}</p>
        </Card>
      )}

      <Tabs label="Interest type" items={VIEW_TABS} value={view} onChange={handleView} />

      <div className={s.filters}>
        <span className={s.label}>Booked in</span>
        <PillGroup label="Booked in" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        <Checkbox checked={excludeBulk} onChange={setExcludeBulk} label="Hide resellers, OTAs, corporates (50+ bookings) and staff accounts" />
        <Chip tone="gold" title="Change in the sidebar">Audience: {scopeLabel}</Chip>
      </div>
      <p className={s.help} style={{ marginTop: -8 }}>“Booked in” only picks which customers are listed. Their ranks always use their full booking history.</p>

      {summaryError && <ErrorState title="Couldn't load the summary" description={summaryError} />}

      {notBuilt ? (
        <Card>
          <EmptyState
            title="Booking interests haven't been built yet"
            description="They build every night at 4:30 AM Dubai, or you can build them now (takes a few minutes)."
            action={<Button variant="primary" onClick={handleRebuild}>Build now</Button>}
          />
        </Card>
      ) : (
        <div className={s.main}>
          <Card className={s.side}>
            <span className={s.sideTitle}>{view === 'service' ? 'Customers by #1 service' : 'Most common #1 products'}</span>
            <span className={s.help}>Click to filter the table · bars to scale</span>
            <BarList items={view === 'service' ? serviceBars : productBars} />
          </Card>

          <div className={s.content}>
            <div className={s.toolbar}>
              <span className={s.note}>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNum(list.total)}</b> customers{filterLabel} · booked {periodLabel?.toLowerCase()} · page {page} of {totalPages}
                {listLoading && list.customers.length > 0 && <Loader2 size={14} className="animate-spin" style={{ marginLeft: 6, verticalAlign: 'middle' }} />}
              </span>
              <div className={s.controls}>
                <label htmlFor="bi-sort" className={s.help}>Sort</label>
                <Select id="bi-sort" className={s.smallSelect} value={sort} onChange={e => setSort(e.target.value)}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <label htmlFor="bi-rows" className={s.help}>Rows</label>
                <Select id="bi-rows" className={s.smallSelect} value={limit} onChange={e => setLimit(Number(e.target.value))}>
                  {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
            </div>

            <div className={s.search}>
              <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && setSearch(searchInput.trim())}
                placeholder="Search name, email, phone or product…" aria-label="Search customers" />
              <Button onClick={() => setSearch(searchInput.trim())}><Search size={15} />Search</Button>
              {search && <Button variant="ghost" onClick={() => { setSearchInput(''); setSearch(''); }}>Clear</Button>}
            </div>

            {listError && <div className={s.statusErr} role="alert">{listError}</div>}
            {listLoading && list.customers.length === 0 ? <TableSkeleton /> : list.customers.length === 0 ? (
              <Card><EmptyState title={`No customers booked ${periodLabel?.toLowerCase()}${search ? ' matching the search' : ''} with these filters.`} /></Card>
            ) : (
              <div style={{ opacity: listLoading ? 0.6 : 1 }}>
                <Table label="Customers" className={s.table}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Type</th>
                      {RANKS.map(r => <th key={r}>#{r} {view === 'service' ? 'service' : 'product'}</th>)}
                      <th className={s.num}>Bookings</th>
                      <th>Last booking</th>
                      <th className={s.num}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.customers.map(c => (
                      <tr key={c.unified_id} className={s.row} tabIndex={0} title="Show all ranks"
                        onClick={() => setSelectedId(c.unified_id)}
                        onKeyDown={e => { if (e.key === 'Enter') setSelectedId(c.unified_id); }}>
                        <td className={s.custCell}>
                          <div className={s.name}>{c.name || '—'}</div>
                          <div className={s.sub}>{[c.email, c.mobile].filter(Boolean).join(' · ') || '—'}</div>
                          {c.country && <div className={s.sub}>{c.country}</div>}
                        </td>
                        <td><TypeBadges contactType={c.contact_type} isBulk={c.is_bulk} /></td>
                        {RANKS.map(r => (
                          <td key={r}>
                            {view === 'service'
                              ? <RankCell title={c[`service_${r}`] && <ServiceBadge service={String(c[`service_${r}`])} />} score={c[`service_${r}_score`]} bookings={c[`service_${r}_bookings`]} />
                              : <RankCell title={c[`product_${r}_name`]} score={c[`product_${r}_score`]} bookings={c[`product_${r}_bookings`]} />}
                          </td>
                        ))}
                        <td className={s.num}>
                          <div style={{ fontWeight: 600 }}>{formatNum(c.bookings)}</div>
                          {period !== 'all' && <div className={s.sub}>of {formatNum(c.bookings_all)}</div>}
                        </td>
                        <td className={s.sub}>{formatDay(c.last_booking_date)}</td>
                        <td className={s.num} style={{ fontWeight: 700 }}>{formatScore(c.affinity_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
            <div className={s.pager}>
              <Button size="sm" disabled={page <= 1 || listLoading} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className={s.note}>{page} / {totalPages}</span>
              <Button size="sm" disabled={page >= totalPages || listLoading} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}

      {selectedId && <CustomerDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
