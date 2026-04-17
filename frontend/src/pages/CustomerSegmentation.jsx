import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSegmentationTree, getSegmentCustomers } from '../api';
import { useBusinessType } from '../App';
import {
  Users, Plane, Hotel, Map, Ticket, Search, X, ChevronLeft, ChevronRight,
  Loader2, Globe, MapPin, MessageCircle, DollarSign, Gem, Eye, RefreshCw,
  Clock, TrendingUp, Phone, Mail,
} from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const fmt = (n) => (n || 0).toLocaleString();
const fmtAED = (n) => `AED ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
const pct = (n, total) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';

const STATUS_CONFIG = {
  ON_TRIP:         { label: 'On Trip',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  icon: Plane,       desc: 'Currently travelling' },
  FUTURE_TRAVEL:   { label: 'Future Travel',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: Clock,       desc: 'Booked, travel date ahead' },
  ACTIVE_ENQUIRY:  { label: 'Active Enquiry',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: MessageCircle, desc: 'Enquired in last 30 days' },
  PAST_BOOKING:    { label: 'Past Booking',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: Ticket,      desc: 'Completed past trips' },
  PAST_ENQUIRY:    { label: 'Past Enquiry',    color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: Search,      desc: 'Enquired 30+ days ago, not booked' },
  PROSPECT:        { label: 'Prospect',        color: '#64748b', bg: 'rgba(100,116,139,0.12)',icon: Users,       desc: 'Never engaged' },
};

const TIER_COLORS = { LUXURY: '#e2b340', STANDARD: '#94a3b8' };
const GEO_COLORS = { LOCAL: '#06b6d4', INTERNATIONAL: '#a78bfa' };

const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#f97316', '#64748b', '#06b6d4', '#e2b340'];

export default function CustomerSegmentation() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCombo, setSelectedCombo] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [custLoading, setCustLoading] = useState(false);
  const [custPage, setCustPage] = useState(1);
  const [custSearch, setCustSearch] = useState('');
  const [expandedStatus, setExpandedStatus] = useState(null);
  const { businessType } = useBusinessType();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSegmentationTree({ businessType });
      setData(res);
    } catch (err) { console.error('Failed to load segmentation:', err); }
    setLoading(false);
  }, [businessType]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadCustomers = useCallback(async (combo, page = 1, search = '') => {
    setCustLoading(true);
    try {
      const params = { page, limit: 25, businessType };
      if (combo.bookingStatus) params.bookingStatus = combo.bookingStatus;
      if (combo.productTier) params.productTier = combo.productTier;
      if (combo.geography) params.geography = combo.geography;
      if (search) params.search = search;
      const res = await getSegmentCustomers(params);
      setCustomers(res);
    } catch (err) { console.error(err); }
    setCustLoading(false);
  }, [businessType]);

  const openCombo = (combo) => {
    setSelectedCombo(combo);
    setCustPage(1);
    setCustSearch('');
    loadCustomers(combo, 1, '');
  };

  const closePanel = () => { setSelectedCombo(null); setCustomers(null); };

  // Build breakdown for a specific status
  const getBreakdownForStatus = (status) => {
    if (!data?.breakdown) return [];
    return data.breakdown.filter(b => b.booking_status === status);
  };

  const comboLabel = (b) => {
    const parts = [STATUS_CONFIG[b.booking_status]?.label || b.booking_status];
    if (b.product_tier) parts.push(b.product_tier === 'LUXURY' ? 'Luxury' : 'Standard');
    if (b.geography) parts.push(b.geography === 'LOCAL' ? 'Local' : 'International');
    return parts.join(' \u2014 ');
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12 }}>
      <Loader2 size={24} className="spin" /> <span style={{ color: 'var(--muted-foreground)' }}>Loading segmentation...</span>
    </div>
  );

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)' }}>Failed to load segmentation data.</div>;

  const { totals, statusCounts, breakdown } = data;

  // Pie chart data for status distribution
  const pieData = statusCounts.map(s => ({ name: STATUS_CONFIG[s.booking_status]?.label || s.booking_status, value: s.count }));

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px', transition: 'all 0.3s' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Customer Segmentation</h1>
            <p style={{ color: 'var(--muted-foreground)', fontSize: 13, marginTop: 4 }}>
              3-step decision tree: Booking Status &rarr; Product Tier &rarr; Geography
            </p>
          </div>
          <button onClick={loadData} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Top KPIs */}
        <motion.div variants={staggerContainer} initial="hidden" animate="visible"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Total Customers', value: fmt(totals.total), icon: Users },
            { label: 'Segmented', value: `${fmt(totals.segmented)} (${pct(totals.segmented, totals.total)})`, icon: TrendingUp },
            { label: 'Segments', value: totals.segment_count, icon: Map },
            { label: 'Total Revenue', value: fmtAED(totals.total_revenue), icon: DollarSign },
          ].map((kpi, i) => (
            <motion.div key={i} variants={fadeInUp}
              style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <kpi.icon size={16} style={{ color: 'var(--muted-foreground)' }} />
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>{kpi.label}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.value}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* Step 1: Booking Status cards */}
        <div style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', marginBottom: 16 }}>
            Step 1 &mdash; Booking Status
          </h2>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="visible"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 32 }}>
          {statusCounts.map((s) => {
            const cfg = STATUS_CONFIG[s.booking_status] || { label: s.booking_status, color: '#64748b', bg: 'rgba(100,116,139,0.12)', icon: Users };
            const Icon = cfg.icon;
            const isExpanded = expandedStatus === s.booking_status;
            return (
              <motion.div key={s.booking_status} variants={fadeInUp}
                onClick={() => setExpandedStatus(isExpanded ? null : s.booking_status)}
                style={{
                  background: 'var(--card)', border: `1px solid ${isExpanded ? cfg.color : 'var(--border)'}`,
                  borderRadius: 'var(--radius-xl)', padding: '18px 20px', cursor: 'pointer',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxShadow: isExpanded ? `0 0 0 1px ${cfg.color}40` : 'none',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} style={{ color: cfg.color }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{cfg.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{cfg.desc}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: cfg.color }}>{fmt(s.count)}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{pct(s.count, totals.total)} &middot; {fmtAED(s.revenue)}</span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Step 2+3: Breakdown for expanded status */}
        <AnimatePresence>
          {expandedStatus && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              style={{ marginBottom: 32, overflow: 'hidden' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', marginBottom: 16 }}>
                Step 2+3 &mdash; {STATUS_CONFIG[expandedStatus]?.label} Breakdown
              </h2>
              <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {getBreakdownForStatus(expandedStatus).map((b, i) => {
                  const label = comboLabel(b);
                  const isSelected = selectedCombo && selectedCombo.bookingStatus === b.booking_status && selectedCombo.productTier === b.product_tier && selectedCombo.geography === b.geography;
                  const tierColor = TIER_COLORS[b.product_tier] || '#94a3b8';
                  const geoColor = GEO_COLORS[b.geography] || '#94a3b8';
                  return (
                    <motion.div key={i} variants={fadeInUp}
                      onClick={() => openCombo({ bookingStatus: b.booking_status, productTier: b.product_tier, geography: b.geography, label })}
                      style={{
                        background: 'var(--card)', border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-xl)', padding: '18px 20px', cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: isSelected ? '0 0 0 1px var(--primary)' : 'none',
                      }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{label}</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        {b.product_tier && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: b.product_tier === 'LUXURY' ? 'rgba(226,179,64,0.15)' : 'rgba(148,163,184,0.15)', color: tierColor, fontWeight: 500 }}>
                            {b.product_tier === 'LUXURY' ? 'Luxury' : 'Standard'}
                          </span>
                        )}
                        {b.geography && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: b.geography === 'LOCAL' ? 'rgba(6,182,212,0.15)' : 'rgba(167,139,250,0.15)', color: geoColor, fontWeight: 500 }}>
                            {b.geography === 'LOCAL' ? 'Local' : 'International'}
                          </span>
                        )}
                        {b.indian_count > 0 && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 500 }}>
                            {b.indian_count} Indian
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div><span style={{ color: 'var(--muted-foreground)' }}>Customers</span><div style={{ fontWeight: 700, fontSize: 18 }}>{fmt(b.count)}</div></div>
                        <div><span style={{ color: 'var(--muted-foreground)' }}>Revenue</span><div style={{ fontWeight: 600, fontSize: 13 }}>{fmtAED(b.revenue)}</div></div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 12, fontSize: 11, color: 'var(--muted-foreground)' }}>
                        <div title="Tours"><Plane size={12} style={{ marginRight: 2 }} />{fmt(b.total_tours)}</div>
                        <div title="Hotels"><Hotel size={12} style={{ marginRight: 2 }} />{fmt(b.total_hotels)}</div>
                        <div title="Visas"><Ticket size={12} style={{ marginRight: 2 }} />{fmt(b.total_visas)}</div>
                        <div title="Flights"><Globe size={12} style={{ marginRight: 2 }} />{fmt(b.total_flights)}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status Distribution Chart */}
        {!expandedStatus && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Status Distribution</h3>
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <div style={{ width: 200, height: 200 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                {statusCounts.map((s, i) => {
                  const cfg = STATUS_CONFIG[s.booking_status];
                  return (
                    <div key={s.booking_status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i] }} />
                      <span style={{ fontSize: 13 }}>{cfg?.label || s.booking_status}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13 }}>{fmt(s.count)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel — Customer Detail */}
      <AnimatePresence>
        {selectedCombo && (
          <motion.div
            initial={{ width: 0, opacity: 0 }} animate={{ width: 480, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            style={{ borderLeft: '1px solid var(--border)', background: 'var(--card)', overflowY: 'auto', overflowX: 'hidden', flexShrink: 0 }}>
            <div style={{ padding: '24px 20px' }}>
              {/* Panel header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{selectedCombo.label}</h3>
                  <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                    {customers ? `${fmt(customers.total)} customers` : 'Loading...'}
                  </p>
                </div>
                <button onClick={closePanel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}>
                  <X size={18} />
                </button>
              </div>

              {/* Panel KPIs */}
              {customers && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
                  <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Customers</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(customers.total)}</div>
                  </div>
                  <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Revenue</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {fmtAED(customers.data?.reduce((sum, c) => sum + (parseFloat(c.total_booking_revenue) || 0), 0))}
                    </div>
                  </div>
                </div>
              )}

              {/* Revenue bar chart */}
              {customers?.data?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--muted-foreground)' }}>Top Revenue</div>
                  <div style={{ height: 120 }}>
                    <ResponsiveContainer>
                      <BarChart data={customers.data.slice(0, 8).map(c => ({ name: (c.name || 'Unknown').split(' ')[0], rev: parseFloat(c.total_booking_revenue) || 0 }))}>
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip formatter={(v) => fmtAED(v)} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }} />
                        <Bar dataKey="rev" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Search */}
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
                <input
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setCustPage(1); loadCustomers(selectedCombo, 1, custSearch); } }}
                  placeholder="Search name, email, phone..."
                  style={{ width: '100%', padding: '8px 10px 8px 32px', background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--foreground)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Customer list */}
              {custLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Loader2 size={20} className="spin" /></div>
              ) : customers?.data?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {customers.data.map((c) => (
                    <div key={c.unified_id}
                      style={{ background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name || 'Unknown'}</div>
                        {c.is_indian && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 500 }}>INDIAN</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted-foreground)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {c.email && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} />{c.email}</div>}
                        {c.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{c.phone}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--muted-foreground)' }}>
                        {c.total_tour_bookings > 0 && <span><Plane size={11} /> {c.total_tour_bookings} tours</span>}
                        {c.total_hotel_bookings > 0 && <span><Hotel size={11} /> {c.total_hotel_bookings} hotels</span>}
                        {c.total_visa_bookings > 0 && <span><Ticket size={11} /> {c.total_visa_bookings} visas</span>}
                        {c.total_flight_bookings > 0 && <span><Globe size={11} /> {c.total_flight_bookings} flights</span>}
                        {c.total_chats > 0 && <span><MessageCircle size={11} /> {c.total_chats} chats</span>}
                      </div>
                      {parseFloat(c.total_booking_revenue) > 0 && (
                        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>{fmtAED(c.total_booking_revenue)}</div>
                      )}
                    </div>
                  ))}

                  {/* Pagination */}
                  {customers.totalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 13 }}>
                      <button disabled={custPage <= 1} onClick={() => { setCustPage(custPage - 1); loadCustomers(selectedCombo, custPage - 1, custSearch); }}
                        style={{ background: 'none', border: 'none', cursor: custPage <= 1 ? 'default' : 'pointer', color: custPage <= 1 ? 'var(--muted)' : 'var(--foreground)', padding: 4 }}>
                        <ChevronLeft size={16} />
                      </button>
                      <span style={{ color: 'var(--muted-foreground)' }}>{custPage} / {customers.totalPages}</span>
                      <button disabled={custPage >= customers.totalPages} onClick={() => { setCustPage(custPage + 1); loadCustomers(selectedCombo, custPage + 1, custSearch); }}
                        style={{ background: 'none', border: 'none', cursor: custPage >= customers.totalPages ? 'default' : 'pointer', color: custPage >= customers.totalPages ? 'var(--muted)' : 'var(--foreground)', padding: 4 }}>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted-foreground)', fontSize: 13 }}>No customers found</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
