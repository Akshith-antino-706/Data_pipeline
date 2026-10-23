'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSegmentationTree, getSegmentActivity, getJourneys, getUnifiedStats, getContactSourcesBreakdown } from '@/lib/api';
import { RefreshCw, Target, TrendingUp, Users, GitBranch, DollarSign, UserCheck, Filter } from 'lucide-react';
import Link from 'next/link';
import type { QueryParams } from '@/types/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import HomeOverview from './HomeOverview';
import ContactSourcesCard from './ContactSourcesCard';
import homeStyles from './home.module.css';
import { Skeleton } from '@/components/ui';
import { segmentStatusMeta } from '@/components/ui/SegmentStatus';

// Recharts is only needed for the Segment Distribution chart — load it on the client after
// the page shell so it stays out of the initial bundle.
const SegmentBarChart = dynamic(() => import('./SegmentBarChart'), { ssr: false, loading: () => <ChartSkeleton /> });

// Dashboard numbers only change with the nightly syncs, so a short cache is safe. It stops
// the B2B/B2C toggle and back-navigation from refetching everything.
const STALE_MS = 2 * 60 * 1000;

interface StatusCount { booking_status: string; count: number; revenue?: number }
interface SegmentationTreeData {
  totals?: { total?: number; segment_count?: number };
  statusCounts?: StatusCount[];
  revenueByType?: { total?: number };
}
interface ActivityLog { entered?: number; converted?: number; total_reached?: number }
interface SegmentActivityData { logs?: ActivityLog[] }
interface TotalResponse { total?: number }

// The loaded chart is a ranked horizontal list (label · bar · count), so the loader is too.
function ChartSkeleton() {
  return (
    <div className={homeStyles.chartSkel} aria-busy="true" aria-label="Loading segment chart">
      {[88, 64, 40, 28, 16].map((w, i) => (
        <div key={i} className={homeStyles.chartSkelRow}>
          <Skeleton width={110} height={12} className="skeleton" />
          <Skeleton width={`${w}%`} height={10} radius={5} className="skeleton" />
          <Skeleton width={48} height={12} className="skeleton" />
        </div>
      ))}
    </div>
  );
}

/** Returns `value` after it has been stable for `ms` — keeps typing in a date box from refetching on every keystroke. */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// B2B statuses are not in the shared map; they keep their own labels/colours here.
const B2B_STATUS: Record<string, { label: string; color: string }> = {
  B2B_ACTIVE_PARTNER: { label: 'Active Partner', color: 'var(--ok)' }, B2B_DORMANT_PARTNER: { label: 'Dormant Partner', color: 'var(--warn)' },
  B2B_NEW_LEAD: { label: 'New Lead', color: 'var(--info)' }, B2B_PROSPECT: { label: 'B2B Prospect', color: 'var(--ink3)' },
};
// Unknown status codes (e.g. NEW_STATUS) → "New Status" instead of raw caps.
const titleCase = (v: string) => String(v || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const SEGMENT_KNOWN = new Set(['ON_TRIP', 'FUTURE_TRAVEL', 'ACTIVE_ENQUIRY', 'PAST_BOOKING', 'PAST_ENQUIRY', 'PROSPECT', 'CANCELLED']);
/** One label/colour source for every status on this page: shared map, then B2B, then title case for unknown codes. */
const statusMeta = (code: string): { label: string; color: string } =>
  SEGMENT_KNOWN.has(code) ? segmentStatusMeta(code) : (B2B_STATUS[code] ?? { label: titleCase(code), color: 'var(--ink3)' });

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Month-year options (e.g. "Jan 2026") from 1 year ahead down to 2 years back.
const MONTH_YEAR_OPTIONS = (() => {
  const cy = new Date().getFullYear();
  const opts = [];
  for (let y = cy + 1; y >= cy - 2; y--) {
    for (let m = 12; m >= 1; m--) opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
  }
  return opts;
})();

const PRODUCT_OPTIONS = [
  { value: 'all', label: 'All Products' },
  { value: 'tours', label: 'Tours' },
  { value: 'packages', label: 'Packages' },
  { value: 'hotels', label: 'Hotels' },
  { value: 'visas', label: 'Visas' },
  { value: 'others', label: 'Others' },
  { value: 'flights', label: 'Flights' },
];

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { businessType } = useBusinessType();
  const btParams = businessType === 'All' ? {} : { businessType };

  // Travel-date revenue filter (Revenue by Segment section)
  const [travelFrom, setTravelFrom] = useState('');
  const [travelTo, setTravelTo] = useState('');
  const [bookingFrom, setBookingFrom] = useState('');
  const [bookingTo, setBookingTo] = useState('');
  const [product, setProduct] = useState('all');
  const [showFilter, setShowFilter] = useState(false);
  const filterActive = !!(travelFrom || travelTo || bookingFrom || bookingTo || (product && product !== 'all'));

  // ── Contacts by source (date filter = contacts ADDED on that Dubai day) ──
  // Computed once (useState initializer) so it doesn't run Date.now() on every render.
  const [dubaiToday] = useState(() => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10));
  const [sourceFrom, setSourceFrom] = useState('');
  const [sourceTo, setSourceTo] = useState('');

  // All dashboard data goes through React Query: keyed on the inputs that change it and
  // cached for STALE_MS, so fast input changes can't leave a stale response on screen.
  const queryOpts = { staleTime: STALE_MS, refetchOnWindowFocus: false };

  const sourceFromQ = useDebounced(sourceFrom);
  const sourceToQ = useDebounced(sourceTo);
  const sourcesQ = useQuery({
    queryKey: ['dashboard', 'sources', sourceFromQ, sourceToQ],
    queryFn: () => getContactSourcesBreakdown(sourceFromQ || undefined, sourceToQ || undefined).then(r => r.data || null),
    ...queryOpts,
  });

  const quickQ = useQuery({
    queryKey: ['dashboard', 'quick', businessType],
    // allSettled so one failing call can't blank the other tiles.
    queryFn: () => Promise.allSettled([
      // cached=1: the backend serves this from a 10-min cache for the dashboard only.
      // quick=1: only the two numbers shown here (no six-table revenue pass); cached=1: 10-min server cache.
      getUnifiedStats({ ...btParams, cached: 1, quick: 1 }),
      getJourneys({ limit: 1 }) as Promise<TotalResponse>,
    ]).then(([contacts, journeys]) => ({
      contacts:      contacts.status  === 'fulfilled' ? contacts.value?.data?.total_contacts   ?? null : null,
      conversations: contacts.status  === 'fulfilled' ? contacts.value?.data?.conversations_7d ?? null : null,
      journeys:      journeys.status  === 'fulfilled' ? journeys.value?.total  ?? null : null,
    })),
    ...queryOpts,
  });
  const quickStats = quickQ.data || { contacts: null, journeys: null, conversations: null };

  // Base dashboard data — NOT affected by the Revenue-by-Segment filter.
  const treeQ = useQuery({
    queryKey: ['dashboard', 'tree', businessType],
    queryFn: () => getSegmentationTree(btParams).catch(() => ({})) as Promise<SegmentationTreeData>,
    ...queryOpts,
  });
  const activityQ = useQuery({
    queryKey: ['dashboard', 'activity'],
    // includeLive=0: Home only shows the daily log, so the server skips the heavy live-counts join.
    queryFn: () => getSegmentActivity({ days: 7, includeLive: 0 }).catch(() => ({})) as Promise<SegmentActivityData>,
    ...queryOpts,
  });

  // Filtered revenue-by-segment — scoped to THIS section only (separate from the base
  // `tree`, so the filter doesn't change any other card). Only fetched once a filter is set.
  const travelFromQ = useDebounced(travelFrom), travelToQ = useDebounced(travelTo);
  const bookingFromQ = useDebounced(bookingFrom), bookingToQ = useDebounced(bookingTo);
  const revQ = useQuery({
    queryKey: ['dashboard', 'rev', businessType, travelFromQ, travelToQ, bookingFromQ, bookingToQ, product],
    queryFn: () => {
      const params: QueryParams = { ...btParams };
      if (travelFromQ) params.travelFrom = travelFromQ;
      if (travelToQ) params.travelTo = travelToQ;
      if (bookingFromQ) params.bookingFrom = bookingFromQ;
      if (bookingToQ) params.bookingTo = bookingToQ;
      if (product && product !== 'all') params.product = product;
      return getSegmentationTree(params).catch(() => ({})) as Promise<SegmentationTreeData>;
    },
    enabled: filterActive,
    ...queryOpts,
  });

  const tree = treeQ.data ?? null;
  const activity = activityQ.data ?? null;
  const revData = filterActive ? (revQ.data ?? null) : null;
  const sourcesData = sourcesQ.data ?? null;
  const sourceRangeText = sourceFrom && sourceTo ? `contacts added ${sourceFrom} → ${sourceTo}` : sourceFrom ? `contacts added on/after ${sourceFrom}` : sourceTo ? `contacts added on/before ${sourceTo}` : 'total contacts';
  // Skeletons on first load and on a manual refresh, as before.
  const treeLoading = treeQ.isPending || treeQ.isFetching;
  const activityLoading = activityQ.isPending || activityQ.isFetching;
  const revLoading = filterActive && (revQ.isPending || revQ.isFetching);
  const sourcesLoading = sourcesQ.isPending || sourcesQ.isFetching;

  // Refresh button: drop every cached dashboard query and fetch again.
  const loadData = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] });

  // ── travel-date preset helpers ──
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const applyMonth = (offset: number) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    setTravelFrom(ymd(start)); setTravelTo(ymd(end));
  };
  const applyYear = () => {
    const y = new Date().getFullYear();
    setTravelFrom(`${y}-01-01`); setTravelTo(`${y}-12-31`);
  };
  const applyMonthPick = (val: string) => {
    if (!val) return;
    const [y, m] = val.split('-').map(Number);
    setTravelFrom(ymd(new Date(y, m - 1, 1))); setTravelTo(ymd(new Date(y, m, 0)));
  };
  const clearFilters = () => { setTravelFrom(''); setTravelTo(''); setBookingFrom(''); setBookingTo(''); setProduct('all'); };
  const activeCount = (travelFrom || travelTo ? 1 : 0) + (bookingFrom || bookingTo ? 1 : 0) + (product && product !== 'all' ? 1 : 0);
  // current "YYYY-MM" if the travel range exactly spans one month (to highlight the month picker)
  const pickedMonth = (travelFrom && travelTo && travelFrom.slice(0, 7) === travelTo.slice(0, 7)) ? travelFrom.slice(0, 7) : '';

  const fmt = (n: number | string | null | undefined) => Number(n || 0).toLocaleString();
  const fmtAED = (n: number | string | null | undefined) => `AED ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtM = (n: number | string | null | undefined) => `AED ${(Number(n || 0) / 1000000).toFixed(2)}M`;

  const totals: NonNullable<SegmentationTreeData['totals']> = tree?.totals || {};
  // Revenue-by-Segment uses the FILTERED data when a filter is active; everything
  // else on the dashboard keeps using the unfiltered `tree`.
  const statusCounts = ((filterActive ? revData : tree)?.statusCounts) || [];
  const revTableLoading = treeLoading || revLoading;
  const revenueByType = tree?.revenueByType;
  const logs = activity?.logs || [];

  const totalEntered = logs.reduce((s, r) => s + (r.entered || 0), 0);
  const totalConverted = logs.reduce((s, r) => s + (r.converted || 0), 0);
  const totalReached = logs.reduce((s, r) => s + (r.total_reached || 0), 0);

  const barData = statusCounts.map(s => ({
    name: statusMeta(s.booking_status).label || titleCase(s.booking_status),
    customers: s.count,
    color: statusMeta(s.booking_status).color || 'var(--ink3)',
  }));

  return (
    <div>
      <div>
        <HomeOverview
          extraActions={
            <button
              className="ui-btn ui-btn--icon"
              onClick={loadData}
              disabled={treeLoading || activityLoading}
              aria-label="Refresh dashboard"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
          }
        />
      </div>

      {/* Audience overview — the original dashboard, kept below the new Home sections. */}
      <div>
        <h2 className={homeStyles.sectionTitle}>Audience overview</h2>
        <p className={homeStyles.sectionSub}>Rayna Tours — {businessType === 'All' ? 'All' : businessType} Overview</p>
      </div>

      {/* KPIs */}
      <div className="card-grid card-grid-4 mb-24">
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><Users size={18} color="var(--blue)" /></div>
          {treeLoading
            ? <div className="skeleton" style={{ width: 80, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-blue">{fmt(totals.total)}</div>
          }
          <div className="kpi-label">Total {businessType === 'All' ? '' : businessType + ' '}Customers</div>
        </Link>
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><Target size={18} color="var(--green)" /></div>
          {treeLoading
            ? <div className="skeleton" style={{ width: 60, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-green">{totals.segment_count || 0}</div>
          }
          <div className="kpi-label">Active Segments</div>
        </Link>
        <Link href="/segment-activity" className="card kpi no-underline color-inherit">
          <div className="icon-box"><TrendingUp size={18} color="var(--purple)" /></div>
          {quickStats.conversations === null
            ? <div className="skeleton" style={{ width: 60, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-purple">{fmt(quickStats.conversations)}</div>
          }
          <div className="kpi-label">Conversations (7d)</div>
        </Link>
        {/* Was /campaigns (hidden from the UI for now); revenue detail lives on Segments. */}
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><DollarSign size={18} color="var(--orange)" /></div>
          {treeLoading
            ? <div className="skeleton" style={{ width: 100, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-orange">{fmtM(revenueByType?.total)}</div>
          }
          <div className="kpi-label">Total Confirmed Revenue</div>
        </Link>
      </div>

      {/* Segment Distribution Chart */}
      <div>
        <div className="card mb-24">
          <div className="card-header">
            <h3>Segment Distribution</h3>
            <Link href="/segmentation" className="btn btn-sm btn-ghost">View Details</Link>
          </div>
          {treeLoading ? (
            <ChartSkeleton />
          ) : barData.length > 0 ? (
            <div >
              <SegmentBarChart data={barData} fmt={fmt} />
            </div>
          ) : (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              No segment data available
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions — always visible */}
      <div className="card-grid card-grid-3 mb-24">
        {[
          { href: '/contacts',  Icon: UserCheck, color: 'var(--blue)',   label: 'Contacts',  val: quickStats.contacts },
          // Campaigns is hidden from the UI for now (page kept at /campaigns).
          // { href: '/campaigns', Icon: Megaphone, color: 'var(--green)',  label: 'Campaigns', val: quickStats.campaigns },
          { href: '/journeys',  Icon: GitBranch, color: 'var(--purple)', label: 'Journeys',  val: quickStats.journeys },
        ].filter(item => quickQ.isPending || item.val !== null).map((item) => (
          <Link key={item.href} href={item.href} className="card action-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '20px 24px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `color-mix(in srgb, ${item.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <item.Icon size={22} color={item.color} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{item.label}</div>
              {quickQ.isPending || item.val === null
                ? <div className="skeleton" style={{ width: 80, height: 22, borderRadius: 4, marginTop: 4 }} />
                : <div style={{ fontSize: 22, fontWeight: 700, color: item.color, marginTop: 2, letterSpacing: -0.5 }}>{fmt(item.val)}</div>
              }
            </div>
          </Link>
        ))}
      </div>

      {/* Last 7 Days Activity */}
      <div>
        <div className="card mb-24">
          <div className="card-header">
            <h3>Last 7 Days Activity</h3>
            <Link href="/segment-activity" className="btn btn-sm btn-ghost">View All</Link>
          </div>
          {activityLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '0 4px' }}>
              {[...Array<undefined>(3)].map((_, i) => (
                <div key={i} style={{ textAlign: 'center', padding: 16 }}>
                  <div className="skeleton" style={{ width: 80, height: 28, borderRadius: 6, margin: '0 auto 8px' }} />
                  <div className="skeleton" style={{ width: 120, height: 12, borderRadius: 6, margin: '0 auto' }} />
                </div>
              ))}
            </div>
          ) : logs.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '0 4px' }}
            >
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--ok)' }}>{fmt(totalEntered)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Entered Segments</div>
              </div>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--purple)' }}>{fmt(totalConverted)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Converted</div>
              </div>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--info)' }}>{fmt(totalReached)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Messages Sent</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px 4px', color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
              No activity in the last 7 days
            </div>
          )}
        </div>
      </div>

      {/* Contacts by Source — with a Dubai-date filter (future dates disabled). Picking a
          date shows how many contacts were ADDED to unified_contacts that day, by source. */}
      <div>
        <div className="card mb-24">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Contacts by Source</h3>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>From</span>
              <input
                type="date" value={sourceFrom} max={sourceTo || dubaiToday}
                onChange={e => setSourceFrom(e.target.value)}
                title="Range start — contacts added on/after this day (Dubai time). Future dates disabled."
                style={{ width: 148, flexShrink: 0, padding: '7px 10px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--text-primary)' }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>to</span>
              <input
                type="date" value={sourceTo} min={sourceFrom || undefined} max={dubaiToday}
                onChange={e => setSourceTo(e.target.value)}
                title="Range end — contacts added on/before this day (Dubai time). Future dates disabled."
                style={{ width: 148, flexShrink: 0, padding: '7px 10px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--text-primary)' }}
              />
              {(sourceFrom || sourceTo) && <button onClick={() => { setSourceFrom(''); setSourceTo(''); }} className="btn btn-sm btn-ghost" style={{ flexShrink: 0 }}>Clear</button>}
            </div>
          </div>

          {sourcesLoading ? (
            <div style={{ padding: '4px 4px' }}>
              {[...Array<undefined>(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 22, borderRadius: 6, marginBottom: 10 }} />)}
            </div>
          ) : !sourcesData ? (
            <div style={{ padding: '20px 4px', color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>Failed to load sources.</div>
          ) : (
            sourcesData.sources.length === 0 ? (
              <>
                <div style={{ padding: '0 4px 8px', fontSize: 13, color: 'var(--ink3)' }}>
                  <b style={{ fontSize: 28, color: 'var(--ink)', marginRight: 8 }}>{fmt(sourcesData.total)}</b>
                  {sourceRangeText} · 0 sources
                </div>
                <div style={{ padding: '12px 4px', color: 'var(--ink3)', fontSize: 13, textAlign: 'center' }}>
                  No contacts were added in the selected range.
                </div>
              </>
            ) : (
              <ContactSourcesCard total={sourcesData.total} sources={sourcesData.sources} rangeText={sourceRangeText} fmt={fmt} />
            )
          )}
        </div>
      </div>

      {/* Revenue by Segment */}
      <div>
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3>Revenue by Segment</h3>
            <button
              onClick={() => setShowFilter(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: (filterActive || showFilter) ? 'var(--ink)' : 'transparent', color: (filterActive || showFilter) ? 'var(--surface)' : 'inherit' }}
            >
              <Filter size={15} /> Filter{activeCount > 0 ? ` (${activeCount})` : ''}
            </button>
          </div>

          {/* Inline expanding filter panel — affects ONLY this section */}
          {showFilter && (() => {
            const inp = { padding: '6px 8px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, fontSize: 13, width: '100%', background: 'var(--surface)' };
            const rowStyle = { display: 'grid', gridTemplateColumns: '110px 1fr', alignItems: 'center', gap: 12, marginBottom: 12 };
            const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' };
            const presetBtn = { padding: '5px 12px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--surface)' };
            const presetOn = { background: 'var(--ink)', color: 'var(--surface)', borderColor: 'var(--ink)' };
            const isMonth = (off: number) => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() + off, 1); return pickedMonth === `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`; };
            const isYear = travelFrom === `${new Date().getFullYear()}-01-01` && travelTo === `${new Date().getFullYear()}-12-31`;
            return (
              <div style={{ padding: 16, borderBottom: '1px solid var(--border, #eef2f7)', background: 'var(--surface-2, #f8fafc)' }}>
                <div style={{ maxWidth: 560 }}>
                  <div style={rowStyle}>
                    <span style={lbl}>Product</span>
                    <select value={product} onChange={(e) => setProduct(e.target.value)} style={inp}>
                      {PRODUCT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div style={rowStyle}>
                    <span style={lbl}>Travel month</span>
                    <select value={pickedMonth} onChange={(e) => applyMonthPick(e.target.value)} style={inp}>
                      <option value="">Select month…</option>
                      {MONTH_YEAR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div style={{ ...rowStyle, marginBottom: 14 }}>
                    <span style={lbl} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button style={{ ...presetBtn, ...(isMonth(0) ? presetOn : {}) }} onClick={() => applyMonth(0)}>This Month</button>
                      <button style={{ ...presetBtn, ...(isMonth(1) ? presetOn : {}) }} onClick={() => applyMonth(1)}>Next Month</button>
                      <button style={{ ...presetBtn, ...(isYear ? presetOn : {}) }} onClick={applyYear}>This Year</button>
                    </div>
                  </div>

                  <div style={rowStyle}>
                    <span style={lbl}>Travel date</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="date" value={travelFrom} max={travelTo || undefined} onChange={(e) => setTravelFrom(e.target.value)} style={inp} />
                      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                      <input type="date" value={travelTo} min={travelFrom || undefined} onChange={(e) => setTravelTo(e.target.value)} style={inp} />
                    </div>
                  </div>

                  <div style={rowStyle}>
                    <span style={lbl}>Booking date</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="date" value={bookingFrom} max={bookingTo || undefined} onChange={(e) => setBookingFrom(e.target.value)} style={inp} />
                      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                      <input type="date" value={bookingTo} min={bookingFrom || undefined} onChange={(e) => setBookingTo(e.target.value)} style={inp} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                    <button onClick={clearFilters} style={{ padding: '6px 12px', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'var(--surface)', color: 'var(--bad)' }}>Clear all</button>
                    <button onClick={() => setShowFilter(false)} style={{ padding: '6px 16px', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: 'var(--ink)', color: 'var(--surface)' }}>Done</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {filterActive && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px', fontSize: 12, color: 'var(--text-secondary, #475569)', background: 'var(--surface-2, #f8fafc)', borderBottom: '1px solid var(--border, #eef2f7)' }}>
              {product !== 'all' && <span style={{ background: 'var(--sunken)', borderRadius: 12, padding: '2px 10px' }}>{PRODUCT_OPTIONS.find(o => o.value === product)?.label}</span>}
              {(travelFrom || travelTo) && <span style={{ background: 'var(--sunken)', borderRadius: 12, padding: '2px 10px' }}>Travel{travelFrom ? ` ${travelFrom}` : ''} → {travelTo || '…'}</span>}
              {(bookingFrom || bookingTo) && <span style={{ background: 'var(--sunken)', borderRadius: 12, padding: '2px 10px' }}>Booked{bookingFrom ? ` ${bookingFrom}` : ''} → {bookingTo || '…'}</span>}
              <button onClick={clearFilters} style={{ border: 'none', background: 'transparent', color: 'var(--bad)', cursor: 'pointer', fontSize: 12 }}>Clear</button>
            </div>
          )}
          {revTableLoading ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Segment</th><th style={{ textAlign: 'right' }}>Customers</th><th style={{ textAlign: 'right' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array<undefined>(5)].map((_, i) => (
                    <tr key={i}>
                      <td><div className="skeleton" style={{ width: 120, height: 14, borderRadius: 4 }} /></td>
                      <td style={{ textAlign: 'right' }}><div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4, marginLeft: 'auto' }} /></td>
                      <td style={{ textAlign: 'right' }}><div className="skeleton" style={{ width: 90, height: 14, borderRadius: 4, marginLeft: 'auto' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : statusCounts.length > 0 ? (
            <div >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Segment</th><th style={{ textAlign: 'right' }}>Customers</th><th style={{ textAlign: 'right' }}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusCounts.map((s) => (
                      <tr key={s.booking_status}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: statusMeta(s.booking_status).color }} />
                            {statusMeta(s.booking_status).label}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(s.count)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--gold-ink)' }}>{fmtAED(s.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px 16px', color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
              No segment revenue data available
            </div>
          )}
        </div>
      </div>

      {!treeLoading && !tree?.totals && (
        <div>
          <div className="card empty">
            <h3 className="mb-8">No Data Available</h3>
            <p className="text-secondary mb-20">Run the unified sync to populate segmentation data.</p>
            <Link href="/segmentation" className="btn btn-primary">Go to Segmentation</Link>
          </div>
        </div>
      )}
    </div>
  );
}
