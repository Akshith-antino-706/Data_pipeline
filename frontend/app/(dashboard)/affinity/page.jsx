'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Heart, Map as MapIcon, Package, Building2, FileCheck, Plane, Layers, Loader2, Download, RefreshCw,
  ShoppingBag, Users, X, ExternalLink,
} from 'lucide-react';
import {
  getAffinitySummary, getAffinityTopProducts, getAffinityCustomers, getContactAffinity, rebuildAffinity, downloadAffinityCSV,
} from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { CONTACT_TYPES, contactTypeColor } from '@/lib/contactTypes';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Business lines = the rayna_* booking tables
const SERVICES = {
  tours:    { label: 'Tours',    icon: MapIcon,   color: '#0ea5e9' },
  packages: { label: 'Packages', icon: Package,   color: '#8b5cf6' },
  hotels:   { label: 'Hotels',   icon: Building2, color: '#f97316' },
  visas:    { label: 'Visas',    icon: FileCheck, color: '#22c55e' },
  flights:  { label: 'Flights',  icon: Plane,     color: '#64748b' },
  others:   { label: 'Others',   icon: Layers,    color: '#eab308' },
};

const VIEWS = {
  service: { label: 'Service affinity', description: 'Top 3 business lines per customer', icon: Layers, color: 'var(--brand-primary)' },
  product: { label: 'Product affinity', description: 'Top 3 products per customer', icon: ShoppingBag, color: '#8b5cf6' },
};

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
  { value: 'score', label: 'Affinity score' },
  { value: 'bookings', label: 'Bookings in period' },
  { value: 'last', label: 'Latest booking' },
  { value: 'revenue', label: 'Revenue' },
];
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const RANKS = [1, 2, 3];

function formatNum(n) { return (Number(n) || 0).toLocaleString(); }
function formatAED(n) { return `AED ${Math.round(Number(n) || 0).toLocaleString()}`; }
// Old bookings decay to small scores — keep 2 decimals below 1 so they still read differently.
function formatScore(n) { return n == null ? '—' : Number(n).toFixed(Number(n) < 1 ? 2 : 1); }
// 'YYYY-MM-DD' → '12 Mar 2025' (no Date parsing, so no timezone shift)
function formatDay(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SkeletonBlock({ width = '100%', height = 14, radius = 7, style = {} }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

function TableSkeleton() {
  return <div aria-label="Loading customers" aria-busy="true">{[0, 1, 2, 3, 4, 5].map(row => <div key={row} style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(7, 1fr)', gap: 14, padding: '12px 4px', borderTop: '1px solid var(--border-color)' }}>{[0, 1, 2, 3, 4, 5, 6, 7].map(cell => <SkeletonBlock key={cell} width="75%" height={12} />)}</div>)}</div>;
}

// Single-select pill group (same as the Leads registrations tab).
function PillGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border-color)', cursor: 'pointer',
            background: value === o.value ? 'var(--brand-primary)' : 'transparent',
            color: value === o.value ? '#fff' : 'var(--text-secondary)' }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterLabel({ children }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{children}</span>;
}

function ServiceBadge({ service }) {
  const s = SERVICES[service];
  if (!s) return <span>{service}</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: s.color }}>
      <s.icon size={14} />{s.label}
    </span>
  );
}

// One "#n" cell: the service / product, with its score and bookings underneath.
function RankCell({ title, score, bookings }) {
  if (!title) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }} title={typeof title === 'string' ? title : undefined}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>score {formatScore(score)} · {formatNum(bookings)} booking{Number(bookings) === 1 ? '' : 's'}</div>
    </div>
  );
}

function TypeBadges({ contactType, isBulk }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: contactTypeColor(contactType).bg, color: contactTypeColor(contactType).fg }}>{contactType}</span>
      {isBulk && <span title="50+ bookings in total (reseller, OTA, corporate) or a Rayna staff email" style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'rgba(100,116,139,0.15)', color: 'var(--text-secondary)' }}>Bulk</span>}
    </span>
  );
}

// Side drawer: every ranked service and product of one customer.
function CustomerDrawer({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    getContactAffinity(id)
      .then(d => { if (active) setData(d); })
      .catch(err => { if (active) setError(err.message || 'Failed to load customer'); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = data?.customer;
  const th = { padding: '6px 8px', textAlign: 'left', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' };
  const td = { padding: '6px 8px', borderBottom: '1px solid var(--border-color)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 300 }} />
      <aside role="dialog" aria-label="Customer affinity" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)', background: 'var(--bg-card)', borderLeft: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)', zIndex: 301, overflowY: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>{c?.name || (data || error ? 'Customer' : 'Loading…')}</h2>
            {c && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>{[c.email, c.mobile, c.country].filter(Boolean).join(' · ')}</div>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        {!data && !error && <div><SkeletonBlock height={60} style={{ marginBottom: 14 }} /><SkeletonBlock height={140} style={{ marginBottom: 14 }} /><SkeletonBlock height={200} /></div>}

        {c && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Bookings', value: formatNum(c.bookings_all) },
                { label: 'Revenue', value: formatAED(c.revenue_all) },
                { label: 'Score', value: formatScore(c.affinity_score) },
                { label: 'First booking', value: formatDay(c.first_booking_date) },
                { label: 'Last booking', value: formatDay(c.last_booking_date) },
                { label: 'Type', value: <TypeBadges contactType={c.contact_type} isBulk={c.is_bulk} /> },
              ].map(k => (
                <div key={k.label} style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.4 }}>{k.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{k.value}</div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Services ({data.services.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 20 }}>
              <thead><tr><th style={th}>#</th><th style={th}>Service</th><th style={{ ...th, textAlign: 'right' }}>Bookings</th><th style={{ ...th, textAlign: 'right' }}>Revenue</th><th style={th}>Last</th><th style={{ ...th, textAlign: 'right' }}>Score</th></tr></thead>
              <tbody>
                {data.services.map(s => (
                  <tr key={s.service}>
                    <td style={{ ...td, fontWeight: 700 }}>{s.rank}</td>
                    <td style={td}><ServiceBadge service={s.service} /></td>
                    <td style={{ ...td, textAlign: 'right' }}>{formatNum(s.bookings)}{s.cancelled > 0 && <span style={{ color: 'var(--text-tertiary)' }}> (+{s.cancelled} cancelled)</span>}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{formatAED(s.revenue)}</td>
                    <td style={td}>{formatDay(s.last_booking_date)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{formatScore(s.affinity_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Products ({formatNum(c.product_count)}{c.product_count > data.products.length ? `, top ${data.products.length} shown` : ''})</h3>
            {data.products.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>Only fee, add-on or generic lines (e.g. “Ticket”, MIX Charges) — no products to rank.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 20 }}>
                <thead><tr><th style={th}>#</th><th style={th}>Product</th><th style={{ ...th, textAlign: 'right' }}>Bookings</th><th style={th}>Last</th><th style={{ ...th, textAlign: 'right' }}>Score</th></tr></thead>
                <tbody>
                  {data.products.map(p => (
                    <tr key={p.product_key}>
                      <td style={{ ...td, fontWeight: 700 }}>{p.rank}</td>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        <div>{p.product_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{(p.services || []).map(s => SERVICES[s]?.label || s).join(', ')}</div>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{formatNum(p.bookings)}</td>
                      <td style={td}>{formatDay(p.last_booking_date)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{formatScore(p.affinity_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <Link href={`/contacts/${id}`} className="btn btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
  const [view, setView] = useState('service');
  const [period, setPeriod] = useState('all');
  const [excludeBulk, setExcludeBulk] = useState(true);
  const [serviceFilter, setServiceFilter] = useState(null);
  const [productFilter, setProductFilter] = useState(null); // { key, name }
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('score');
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [list, setList] = useState({ total: 0, customers: [] });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [rebuildError, setRebuildError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  // Audience filters shared by every request on the page.
  const audience = useMemo(() => ({ businessType, period, excludeBulk: excludeBulk ? 1 : 0 }), [businessType, period, excludeBulk]);
  const listParams = useMemo(() => ({
    ...audience, view, sort, search,
    service: view === 'service' ? serviceFilter : undefined,
    product: view === 'product' ? productFilter?.key : undefined,
  }), [audience, view, sort, search, serviceFilter, productFilter]);

  useEffect(() => {
    try { const saved = window.localStorage.getItem('affinity-view'); if (VIEWS[saved]) setView(saved); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let active = true;
    setSummaryError(null);
    getAffinitySummary(audience)
      .then(d => { if (active) setSummary(d); })
      .catch(err => { if (active) setSummaryError(err.message || 'Failed to load affinity summary'); });
    return () => { active = false; };
  }, [audience, refreshKey]);

  // While a build runs, poll its status; reload everything once it finishes.
  const building = summary?.status === 'running';
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => {
      getAffinitySummary(audience)
        .then(d => { setSummary(d); if (d.status !== 'running') setRefreshKey(k => k + 1); })
        .catch(() => { /* keep polling */ });
    }, 8000);
    return () => clearInterval(timer);
  }, [building, audience]);

  useEffect(() => {
    if (view !== 'product') return;
    let active = true;
    getAffinityTopProducts({ ...audience, limit: 12 })
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
    getAffinityCustomers({ ...listParams, limit, page })
      .then(d => { if (active) setList(d); })
      .catch(err => { if (active) setListError(err.message || 'Failed to load customers'); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [listParams, limit, page, refreshKey]);

  const handleView = (v) => {
    setView(v);
    try { window.localStorage.setItem('affinity-view', v); } catch { /* ignore */ }
  };

  const handleRebuild = async () => {
    setRebuildError(null);
    try {
      await rebuildAffinity();
      setSummary(s => ({ ...(s || {}), status: 'running' }));
    } catch (err) {
      setRebuildError(err.message || 'Could not start the rebuild');
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try { await downloadAffinityCSV(listParams); } catch (err) { setListError(err.message); } finally { setDownloading(false); }
  };

  const totalPages = Math.max(Math.ceil((list.total || 0) / limit), 1);
  const notBuilt = summary && !summary.builtAt && !building;
  const cardStyle = { padding: 20, marginBottom: 24 };
  const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)', position: 'sticky', top: 0, zIndex: 1 };
  const tdStyle = { padding: '8px 12px', whiteSpace: 'nowrap', verticalAlign: 'top' };
  const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label;
  const scopeLabel = CONTACT_TYPES.includes(businessType) ? businessType : CONTACT_TYPES.join(' + ');

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* Header */}
      <motion.div variants={fadeInUp} className="card" style={{ marginBottom: 18, padding: '22px 24px', background: 'linear-gradient(135deg, var(--bg-card) 0%, color-mix(in srgb, var(--brand-primary) 6%, var(--bg-card)) 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(236,72,153,0.12)' }}>
            <Heart size={24} style={{ color: '#ec4899' }} />
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <h1 style={{ fontSize: 25, fontWeight: 700, margin: 0 }}>Customer affinity</h1>
            <p style={{ color: 'var(--text-secondary)', margin: '5px 0 0', fontSize: 13.5 }}>
              Each customer&apos;s top 3 services and products, ranked from their bookings. Every booking adds 10 points, halving every 6 months — booked often and recently ranks first.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <button className="btn btn-ghost" onClick={handleRebuild} disabled={building || !summary} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {building ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
              {building ? 'Building… (a few minutes)' : 'Rebuild now'}
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
              {summary?.builtAt ? `Built ${formatDateTime(summary.builtAt)} · rebuilds nightly at 4:30 AM Dubai` : summary ? 'Not built yet' : '…'}
            </span>
            {summary?.lastError && !building && <span style={{ fontSize: 11.5, color: 'var(--red)', maxWidth: 360, textAlign: 'right' }}>Last build failed: {summary.lastError}</span>}
            {rebuildError && <span style={{ fontSize: 11.5, color: 'var(--red)' }}>{rebuildError}</span>}
          </div>
        </div>
      </motion.div>

      {/* View switcher */}
      <motion.div variants={fadeInUp} role="tablist" aria-label="Affinity view" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
        {Object.entries(VIEWS).map(([key, v]) => (
          <button key={key} role="tab" aria-selected={view === key} onClick={() => handleView(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 12, textAlign: 'left',
              border: `1px solid ${view === key ? v.color : 'var(--border-color)'}`,
              background: view === key ? `color-mix(in srgb, ${v.color} 10%, var(--bg-card))` : 'var(--bg-card)',
              color: view === key ? v.color : 'var(--text-secondary)',
              cursor: 'pointer', boxShadow: view === key ? '0 5px 16px rgba(15,23,42,0.07)' : 'none',
            }}>
            <span style={{ width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 9, background: view === key ? `color-mix(in srgb, ${v.color} 16%, transparent)` : 'var(--bg-secondary)' }}><v.icon size={17} /></span>
            <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{v.label}</span><span style={{ display: 'block', marginTop: 2, fontSize: 10.5, fontWeight: 400, color: 'var(--text-tertiary)' }}>{v.description}</span></span>
          </button>
        ))}
      </motion.div>

      {/* Filters */}
      <motion.div variants={fadeInUp} className="card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <FilterLabel>Booked in</FilterLabel>
          <PillGroup value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={excludeBulk} onChange={e => setExcludeBulk(e.target.checked)} style={{ accentColor: 'var(--brand-primary)', width: 14, height: 14, flex: '0 0 auto', margin: 0, cursor: 'pointer' }} />
            Hide bulk & internal accounts (50+ bookings — resellers, OTAs, corporates — or a Rayna staff email)
          </label>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Scope: <strong style={{ color: 'var(--text-primary)' }}>{scopeLabel}</strong> <span style={{ color: 'var(--text-tertiary)' }}>(change in the sidebar)</span>
          </span>
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
          “Booked in” only picks which customers are listed. Their ranks always use their full booking history.
        </p>
      </motion.div>

      {summaryError && <motion.div variants={fadeInUp} className="card" style={{ ...cardStyle, padding: 16, borderLeft: '4px solid var(--red)' }}><span style={{ color: 'var(--red)', fontSize: 14 }}>{summaryError}</span></motion.div>}

      {notBuilt ? (
        <motion.div variants={fadeInUp} className="card" style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 8px' }}>Affinity hasn&apos;t been built yet</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px' }}>It builds every night at 4:30 AM Dubai, or you can build it now (takes a few minutes).</p>
          <button className="btn btn-primary" onClick={handleRebuild}>Build now</button>
        </motion.div>
      ) : (
        <>
          {/* #1 service cards / #1 product chips — click to filter */}
          {view === 'service' ? (
            <motion.div variants={fadeInUp} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
              {[{ service: null, customers: summary?.totalCustomers }, ...(summary?.topService || [])].map(s => {
                const cfg = s.service ? SERVICES[s.service] : { label: 'All customers', icon: Users, color: 'var(--brand-primary)' };
                const selected = serviceFilter === s.service;
                const empty = s.service && !s.customers;
                return (
                  <button key={s.service || 'all'} onClick={() => setServiceFilter(s.service)} aria-pressed={selected} disabled={empty}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                      cursor: empty ? 'default' : 'pointer', opacity: empty ? 0.5 : 1,
                      border: `1px solid ${selected ? cfg.color : 'var(--border-color)'}`,
                      background: selected ? `color-mix(in srgb, ${cfg.color} 10%, var(--bg-card))` : 'var(--bg-card)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: cfg.color }}><cfg.icon size={15} />{cfg.label}</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{summary ? formatNum(s.customers) : '…'}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{s.service ? (empty ? 'No bookings' : 'customers with #1') : 'customers ranked'}</span>
                  </button>
                );
              })}
            </motion.div>
          ) : (
            <motion.div variants={fadeInUp} className="card" style={{ ...cardStyle, padding: 16 }}>
              <div style={{ marginBottom: 10 }}><FilterLabel>Most common #1 products</FilterLabel></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[{ product_key: null, product_name: 'All products', customers: summary?.totalCustomers }, ...topProducts].map(p => {
                  const selected = (productFilter?.key || null) === p.product_key;
                  return (
                    <button key={p.product_key || 'all'} onClick={() => setProductFilter(p.product_key ? { key: p.product_key, name: p.product_name } : null)} aria-pressed={selected}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12.5,
                        border: `1px solid ${selected ? '#8b5cf6' : 'var(--border-color)'}`,
                        background: selected ? 'color-mix(in srgb, #8b5cf6 12%, var(--bg-card))' : 'transparent',
                        color: selected ? '#8b5cf6' : 'var(--text-secondary)' }}>
                      <span style={{ fontWeight: 600 }}>{p.product_name}</span>
                      <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--text-tertiary)' }}>{p.customers != null ? formatNum(p.customers) : '…'}</span>
                    </button>
                  );
                })}
                {productFilter && !topProducts.some(p => p.product_key === productFilter.key) && (
                  <span style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12.5, border: '1px solid #8b5cf6', color: '#8b5cf6' }}>{productFilter.name}</span>
                )}
              </div>
            </motion.div>
          )}

          {/* Customers */}
          <motion.div variants={fadeInUp} className="card" style={cardStyle}>
            <div className="card-header" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                Customers
                {view === 'service' && serviceFilter && <> · #1 service <ServiceBadge service={serviceFilter} /></>}
                {view === 'product' && productFilter && <> · #1 product {productFilter.name}</>}
              </h3>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatNum(list.total)} customers · booked {periodLabel?.toLowerCase()} · page {page} of {totalPages}</span>
              {listLoading && list.customers.length > 0 && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-tertiary)' }} />}
              <button className="btn btn-ghost" onClick={handleDownload} disabled={downloading || !list.total} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                {downloading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={15} />}
                {downloading ? 'Preparing…' : 'Export CSV'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 8, flex: '1 1 280px' }}>
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && setSearch(searchInput.trim())}
                  placeholder="Search name, email, phone or product…"
                  style={{ flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
                <button className="btn btn-primary" onClick={() => setSearch(searchInput.trim())}>Search</button>
                {search && <button className="btn btn-ghost" onClick={() => { setSearchInput(''); setSearch(''); }}>Clear</button>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FilterLabel>Sort</FilterLabel>
                <PillGroup value={sort} onChange={setSort} options={SORT_OPTIONS} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FilterLabel>Rows</FilterLabel>
                <PillGroup value={limit} onChange={setLimit} options={ROWS_PER_PAGE_OPTIONS.map(n => ({ value: n, label: String(n) }))} />
              </div>
            </div>

            {listError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{listError}</div>}
            {listLoading && list.customers.length === 0 ? <TableSkeleton /> : list.customers.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No customers booked {periodLabel?.toLowerCase()}{search ? ' matching the search' : ''} with these filters.</div>
            ) : (
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border-color)', maxHeight: 640, opacity: listLoading ? 0.6 : 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Customer</th>
                      <th style={thStyle}>Country</th>
                      <th style={thStyle}>Type</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Bookings</th>
                      <th style={thStyle}>Last booking</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Score</th>
                      {RANKS.map(r => <th key={r} style={thStyle}>{view === 'service' ? 'Service' : 'Product'} #{r}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {list.customers.map((c, i) => (
                      <tr key={c.unified_id} onClick={() => setSelectedId(c.unified_id)} title="Show all ranks"
                        style={{ borderBottom: '1px solid var(--border-color)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', cursor: 'pointer' }}>
                        <td style={{ ...tdStyle, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || '—'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[c.email, c.mobile].filter(Boolean).join(' · ') || '—'}</div>
                        </td>
                        <td style={tdStyle}>{c.country || '—'}</td>
                        <td style={tdStyle}><TypeBadges contactType={c.contact_type} isBulk={c.is_bulk} /></td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <div style={{ fontWeight: 600 }}>{formatNum(c.bookings)}</div>
                          {period !== 'all' && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>of {formatNum(c.bookings_all)}</div>}
                        </td>
                        <td style={tdStyle}>{formatDay(c.last_booking_date)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatScore(c.affinity_score)}</td>
                        {RANKS.map(r => (
                          <td key={r} style={tdStyle}>
                            {view === 'service'
                              ? <RankCell title={c[`service_${r}`] && <ServiceBadge service={c[`service_${r}`]} />} score={c[`service_${r}_score`]} bookings={c[`service_${r}_bookings`]} />
                              : <RankCell title={c[`product_${r}_name`]} score={c[`product_${r}_score`]} bookings={c[`product_${r}_bookings`]} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 18 }}>
              <button className="btn btn-ghost" disabled={page <= 1 || listLoading} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
              <button className="btn btn-ghost" disabled={page >= totalPages || listLoading} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          </motion.div>
        </>
      )}

      {selectedId && <CustomerDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </motion.div>
  );
}
