import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSegmentActivity, snapshotDailySegments, getSegmentCustomers, downloadSegmentActivity, downloadSegmentCustomers, getUnifiedContact } from '../api';
import { useBusinessType } from '../App';
import {
  Users, TrendingUp, TrendingDown, ArrowRightLeft, Mail, MessageCircle, Bell,
  RefreshCw, Loader2, Calendar, DollarSign, Filter, Download, Eye, X,
  ChevronLeft, ChevronRight, Phone, Search, Globe, Building2, Hash, MapPin,
  Clock, Palmtree, Hotel, FileText, Plane, ChevronDown, ChevronUp, Layers,
} from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const fmt = (n) => (n || 0).toLocaleString();
const fmtAED = (n) => `AED ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const STATUS_CONFIG = {
  ON_TRIP:         { label: 'On Trip',        color: '#22c55e' },
  FUTURE_TRAVEL:   { label: 'Future Travel',  color: '#3b82f6' },
  ACTIVE_ENQUIRY:  { label: 'Active Enquiry', color: '#f59e0b' },
  PAST_BOOKING:    { label: 'Past Booking',   color: '#8b5cf6' },
  PAST_ENQUIRY:    { label: 'Past Enquiry',   color: '#f97316' },
  PROSPECT:        { label: 'Prospect',       color: '#64748b' },
};

function formatDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SegmentActivity() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [days, setDays] = useState(30);
  const [segmentFilter, setSegmentFilter] = useState('');
  const { businessType } = useBusinessType();

  // Detail panel state
  const [detailSegment, setDetailSegment] = useState(null);
  const [detailCustomers, setDetailCustomers] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSearch, setDetailSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { days, businessType };
      if (segmentFilter) params.segment = segmentFilter;
      const res = await getSegmentActivity(params);
      setData(res);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [days, segmentFilter, businessType]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSnapshot = async () => {
    setSnapshotting(true);
    try { await snapshotDailySegments(); await loadData(); } catch (err) { console.error(err); }
    setSnapshotting(false);
  };

  const openDetail = async (segmentLabel) => {
    setDetailSegment(segmentLabel);
    setDetailPage(1);
    setDetailSearch('');
    setDetailLoading(true);
    try {
      const res = await getSegmentCustomers({ bookingStatus: segmentLabel, businessType, page: 1, limit: 25 });
      setDetailCustomers(res);
    } catch (err) { console.error(err); }
    setDetailLoading(false);
  };

  const loadDetailPage = async (page, search) => {
    setDetailLoading(true);
    try {
      const res = await getSegmentCustomers({ bookingStatus: detailSegment, businessType, page, limit: 25, search });
      setDetailCustomers(res);
      setDetailPage(page);
    } catch (err) { console.error(err); }
    setDetailLoading(false);
  };

  const closeDetail = () => { setDetailSegment(null); setDetailCustomers(null); };

  // Contact detail modal
  const [contactDetail, setContactDetail] = useState(null);
  const [contactLoading, setContactLoading] = useState(false);

  const openContact = async (id) => {
    setContactLoading(true);
    try { const res = await getUnifiedContact(id); setContactDetail(res.data); }
    catch { /* ignore */ }
    setContactLoading(false);
  };

  const liveToday = data?.liveToday || [];
  const totalCustomers = liveToday.reduce((s, r) => s + (r.total_count || 0), 0);
  const totalRevenue = liveToday.reduce((s, r) => s + (parseFloat(r.revenue) || 0), 0);
  const logs = data?.logs || [];
  const totalEntered = logs.reduce((s, r) => s + (r.entered || 0), 0);
  const totalExited = logs.reduce((s, r) => s + (r.exited || 0), 0);
  const totalConverted = logs.reduce((s, r) => s + (r.converted || 0), 0);
  const totalReached = logs.reduce((s, r) => s + (r.total_reached || 0), 0);

  const logsByDate = {};
  for (const log of logs) { const d = log.log_date?.slice(0, 10); if (!logsByDate[d]) logsByDate[d] = []; logsByDate[d].push(log); }
  const dates = Object.keys(logsByDate).sort((a, b) => b.localeCompare(a));

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <motion.div variants={fadeInUp} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Segment Activity</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            Daily segment entries, exits, conversions & reach &middot; Click any segment to view customers
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => downloadSegmentActivity({ days, segment: segmentFilter, businessType })}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 500 }}>
            <Download size={14} /> Download CSV
          </button>
          <button onClick={handleSnapshot} disabled={snapshotting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, color: 'var(--foreground)' }}>
            {snapshotting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Snapshot Now
          </button>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <motion.div variants={fadeInUp} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Customers', value: fmt(totalCustomers), icon: Users, color: 'var(--primary)' },
          { label: 'Entered', value: fmt(totalEntered), icon: TrendingUp, color: '#22c55e' },
          { label: 'Exited', value: fmt(totalExited), icon: TrendingDown, color: '#ef4444' },
          { label: 'Converted', value: fmt(totalConverted), icon: ArrowRightLeft, color: '#8b5cf6' },
          { label: 'Reached', value: fmt(totalReached), icon: Mail, color: '#3b82f6' },
          { label: 'Revenue', value: fmtAED(totalRevenue), icon: DollarSign, color: '#f59e0b' },
        ].map((kpi) => (
          <div key={kpi.label} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <kpi.icon size={14} style={{ color: kpi.color }} />
              <span style={{ fontSize: 11, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{kpi.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{kpi.value}</div>
          </div>
        ))}
      </motion.div>

      {/* Live Today — Clickable Segment Cards */}
      <motion.div variants={fadeInUp} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={14} /> Live Segment Counts (Today) — click to view customers
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          {liveToday.map(seg => {
            const cfg = STATUS_CONFIG[seg.segment_label] || { label: seg.segment_label, color: '#64748b' };
            const isSelected = detailSegment === seg.segment_label;
            return (
              <div key={seg.segment_label} onClick={() => openDetail(seg.segment_label)}
                style={{ padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--secondary)', borderLeft: `3px solid ${cfg.color}`, cursor: 'pointer', transition: 'all 0.2s', boxShadow: isSelected ? `0 0 0 2px ${cfg.color}` : 'none' }}>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>{cfg.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: cfg.color }}>{fmt(seg.total_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>{fmtAED(seg.revenue)}</div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div variants={fadeInUp} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Filter size={14} style={{ color: 'var(--muted-foreground)' }} />
        <select value={days} onChange={e => setDays(parseInt(e.target.value))}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}>
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)' }}>
          <option value="">All Segments</option>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
      </motion.div>

      {/* Daily Activity Table */}
      <motion.div variants={fadeInUp} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Daily Log</span>
          <button onClick={() => downloadSegmentActivity({ days, segment: segmentFilter, businessType })}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 11, color: 'var(--muted-foreground)' }}>
            <Download size={11} /> Export
          </button>
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} className="spin" /> Loading...</div>
        ) : dates.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)' }}>
            No daily logs yet. Click "Snapshot Now" to capture today's data.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--secondary)' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Segment</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#22c55e' }}>Entered</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#ef4444' }}>Exited</th>
                  <th style={{ ...thStyle, textAlign: 'right', color: '#8b5cf6' }}>Converted</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}><Mail size={12} /> Email</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}><MessageCircle size={12} /> WA</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}><Bell size={12} /> Push</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Reached</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Active</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Revenue</th>
                  <th style={{ ...thStyle, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {dates.map(date => {
                  const rows = logsByDate[date];
                  return rows.map((row, i) => {
                    const cfg = STATUS_CONFIG[row.segment_label] || { label: row.segment_label, color: '#64748b' };
                    return (
                      <tr key={`${date}-${row.segment_label}`} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => openDetail(row.segment_label)}>
                        <td style={tdStyle}>{i === 0 ? formatDate(date) : ''}</td>
                        <td style={tdStyle}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: cfg.color, flexShrink: 0 }} />
                            {cfg.label}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmt(row.total_count)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: row.entered > 0 ? '#22c55e' : 'var(--muted-foreground)' }}>
                          {row.entered > 0 ? `+${fmt(row.entered)}` : '0'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: row.exited > 0 ? '#ef4444' : 'var(--muted-foreground)' }}>
                          {row.exited > 0 ? `-${fmt(row.exited)}` : '0'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: row.converted > 0 ? '#8b5cf6' : 'var(--muted-foreground)' }}>
                          {fmt(row.converted)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(row.emails_sent)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(row.whatsapp_sent)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(row.push_sent)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>{fmt(row.total_reached)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(row.journey_active)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#f59e0b', fontWeight: 500 }}>{fmtAED(row.revenue)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}><Eye size={13} style={{ color: 'var(--muted-foreground)' }} /></td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
      {/* Customer Detail Panel — below daily log */}
      <AnimatePresence>
        {detailSegment && (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible" exit="hidden"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_CONFIG[detailSegment]?.color || '#64748b' }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{STATUS_CONFIG[detailSegment]?.label || detailSegment} Customers</span>
                {detailCustomers && <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>({fmt(detailCustomers.total)} total)</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
                  <input value={detailSearch} onChange={e => setDetailSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') loadDetailPage(1, detailSearch); }}
                    placeholder="Search..."
                    style={{ padding: '6px 8px 6px 28px', fontSize: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--secondary)', color: 'var(--foreground)', width: 180, outline: 'none' }} />
                </div>
                <button onClick={() => downloadSegmentCustomers({ bookingStatus: detailSegment, businessType })}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: 'var(--primary)', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12, color: '#fff', fontWeight: 500 }}>
                  <Download size={12} /> CSV
                </button>
                <button onClick={closeDetail} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}>
                  <X size={16} />
                </button>
              </div>
            </div>
            {detailLoading ? (
              <div style={{ padding: 32, textAlign: 'center' }}><Loader2 size={18} className="spin" /></div>
            ) : detailCustomers?.data?.length > 0 ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--secondary)' }}>
                        <th style={thStyle}>Name</th>
                        <th style={thStyle}>Email</th>
                        <th style={thStyle}>Phone</th>
                        <th style={thStyle}>Company</th>
                        <th style={thStyle}>Country</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Tours</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Hotels</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Visas</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Flights</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Revenue</th>
                        <th style={thStyle}>Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailCustomers.data.map(c => (
                        <tr key={c.unified_id} onClick={() => openContact(c.unified_id)}
                          style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{c.name || '\u2014'}</td>
                          <td style={{ ...tdStyle, fontSize: 11 }}>{c.email || '\u2014'}</td>
                          <td style={{ ...tdStyle, fontSize: 11 }}>{c.phone || '\u2014'}</td>
                          <td style={tdStyle}>{c.company_name || '\u2014'}</td>
                          <td style={tdStyle}>{c.country || '\u2014'}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{c.total_tour_bookings || 0}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{c.total_hotel_bookings || 0}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{c.total_visa_bookings || 0}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{c.total_flight_bookings || 0}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', color: '#f59e0b', fontWeight: 500 }}>{fmtAED(c.total_booking_revenue)}</td>
                          <td style={{ ...tdStyle, fontSize: 11 }}>{formatDate(c.last_seen_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {detailCustomers.totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                    <button disabled={detailPage <= 1} onClick={() => loadDetailPage(detailPage - 1, detailSearch)}
                      style={{ background: 'none', border: 'none', cursor: detailPage <= 1 ? 'default' : 'pointer', color: detailPage <= 1 ? 'var(--muted)' : 'var(--foreground)', padding: 4 }}>
                      <ChevronLeft size={16} />
                    </button>
                    <span style={{ color: 'var(--muted-foreground)' }}>{detailPage} / {detailCustomers.totalPages}</span>
                    <button disabled={detailPage >= detailCustomers.totalPages} onClick={() => loadDetailPage(detailPage + 1, detailSearch)}
                      style={{ background: 'none', border: 'none', cursor: detailPage >= detailCustomers.totalPages ? 'default' : 'pointer', color: detailPage >= detailCustomers.totalPages ? 'var(--muted)' : 'var(--foreground)', padding: 4 }}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted-foreground)' }}>No customers found</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contact Detail Modal */}
      <AnimatePresence>
        {(contactDetail || contactLoading) && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setContactDetail(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: 800, width: '92vw', maxHeight: '85vh', overflow: 'auto', background: 'var(--card)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border)', padding: 24 }}>
              {contactLoading && !contactDetail ? (
                <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} className="spin" /></div>
              ) : contactDetail && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{contactDetail.name || 'Unknown'}</h3>
                      <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'monospace' }}>ID: {contactDetail.unified_id}</span>
                      <div style={{ marginTop: 6 }}>{contactDetail.sources?.split(', ').map(s => <span key={s} className={`badge ${s === 'chat' ? 'badge-green' : s === 'rayna' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 10, marginRight: 4 }}>{s}</span>)}</div>
                    </div>
                    <button onClick={() => setContactDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}><X size={16} /></button>
                  </div>

                  <ModalSection title="Segment">
                    <DetailRow icon={Hash} label="Status" value={contactDetail.booking_status} />
                    <DetailRow icon={Hash} label="Product Tier" value={contactDetail.product_tier || 'N/A'} />
                    <DetailRow icon={Globe} label="Geography" value={contactDetail.geography || 'Unknown'} />
                    <DetailRow icon={Layers} label="Full Segment" value={contactDetail.segment_label} />
                  </ModalSection>

                  <ModalSection title="Contact Information">
                    <DetailRow icon={Mail} label="Email" value={contactDetail.email} />
                    <DetailRow icon={Phone} label="Phone" value={contactDetail.phone} />
                    <DetailRow icon={Building2} label="Company" value={contactDetail.company_name} />
                    <DetailRow icon={MapPin} label="City" value={contactDetail.city} />
                    <DetailRow icon={Globe} label="Country" value={contactDetail.country} />
                    <DetailRow icon={Hash} label="Type" value={contactDetail.contact_type} />
                  </ModalSection>

                  <ModalSection title="Chat Activity">
                    <DetailRow icon={MessageCircle} label="Total Chats" value={contactDetail.total_chats || 0} />
                    <DetailRow icon={Hash} label="Departments" value={contactDetail.chat_departments} />
                    <DetailRow icon={Clock} label="First Chat" value={formatDate(contactDetail.first_chat_at)} />
                    <DetailRow icon={Clock} label="Last Chat" value={formatDate(contactDetail.last_chat_at)} />
                  </ModalSection>

                  {(contactDetail.total_tour_bookings > 0 || contactDetail.total_hotel_bookings > 0 || contactDetail.total_visa_bookings > 0 || contactDetail.total_flight_bookings > 0) && (
                    <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted-foreground)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Booking Summary</div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {contactDetail.total_tour_bookings > 0 && <MiniStat icon={Palmtree} label="Tours" value={contactDetail.total_tour_bookings} color="#10b981" />}
                        {contactDetail.total_hotel_bookings > 0 && <MiniStat icon={Hotel} label="Hotels" value={contactDetail.total_hotel_bookings} color="#6366f1" />}
                        {contactDetail.total_visa_bookings > 0 && <MiniStat icon={FileText} label="Visas" value={contactDetail.total_visa_bookings} color="#f59e0b" />}
                        {contactDetail.total_flight_bookings > 0 && <MiniStat icon={Plane} label="Flights" value={contactDetail.total_flight_bookings} color="#3b82f6" />}
                        <MiniStat icon={DollarSign} label="Revenue" value={fmtAED(contactDetail.total_booking_revenue)} color="var(--primary)" />
                      </div>
                      {(contactDetail.first_booking_at || contactDetail.last_booking_at) && (
                        <div style={{ display: 'flex', gap: 24, marginTop: 10, fontSize: 12, color: 'var(--muted-foreground)' }}>
                          {contactDetail.first_booking_at && <span>First: {formatDate(contactDetail.first_booking_at)}</span>}
                          {contactDetail.last_booking_at && <span>Last: {formatDate(contactDetail.last_booking_at)}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  <BookingTable icon={Palmtree} title="Tour Bookings" color="#10b981" rows={contactDetail.rayna_tours} columns={tourColumns} />
                  <BookingTable icon={Hotel} title="Hotel Bookings" color="#6366f1" rows={contactDetail.rayna_hotels} columns={hotelColumns} />
                  <BookingTable icon={FileText} title="Visa Bookings" color="#f59e0b" rows={contactDetail.rayna_visas} columns={visaColumns} />
                  <BookingTable icon={Plane} title="Flight Bookings" color="#3b82f6" rows={contactDetail.rayna_flights} columns={flightColumns} />
                  <BookingTable icon={MessageCircle} title="Chats" color="#25D366" rows={contactDetail.chats_list} columns={chatColumns} />

                  <ModalSection title="Timeline">
                    <DetailRow icon={Calendar} label="First Seen" value={formatDate(contactDetail.first_seen_at)} />
                    <DetailRow icon={Clock} label="Last Seen" value={formatDate(contactDetail.last_seen_at)} />
                  </ModalSection>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Helper Components ────────────────────────────────── */

function ModalSection({ title, children }) {
  return (
    <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted-foreground)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>{children}</div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)', minWidth: 70 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{value || '\u2014'}</span>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon size={14} style={{ color }} />
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{label}:</span>
      <span style={{ fontSize: 13, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function BookingTable({ icon: Icon, title, color, rows, columns }) {
  const [expanded, setExpanded] = useState(false);
  const count = rows?.length || 0;
  if (count === 0) return null;
  return (
    <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', marginBottom: 12, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={14} style={{ color }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
          <span style={{ background: `${color}20`, color, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>{count}</span>
        </div>
        {expanded ? <ChevronUp size={16} style={{ color: 'var(--muted-foreground)' }} /> : <ChevronDown size={16} style={{ color: 'var(--muted-foreground)' }} />}
      </div>
      {expanded && (
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{columns.map(c => <th key={c.key} style={{ ...thStyle, fontSize: 10, padding: '8px 10px' }}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>{columns.map(c => <td key={c.key} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '\u2014')}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtCurrency(v) { return v == null ? '\u2014' : `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

const tourColumns = [
  { key: 'billno', label: 'Bill #' },
  { key: 'tours_name', label: 'Tour', render: v => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'tour_date', label: 'Tour Date', render: v => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'adult', label: 'Pax', render: (_v, r) => `${r.adult || 0}A ${r.child || 0}C ${r.infant || 0}I` },
  { key: 'total_sell', label: 'Amount', render: v => fmtCurrency(v) },
  { key: 'status', label: 'Status' },
];
const hotelColumns = [
  { key: 'billno', label: 'Bill #' },
  { key: 'hotel_name', label: 'Hotel', render: v => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'check_in_date', label: 'Check-in', render: v => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'no_of_rooms', label: 'Rooms' },
  { key: 'total_sell', label: 'Amount', render: v => fmtCurrency(v) },
];
const visaColumns = [
  { key: 'billno', label: 'Bill #' },
  { key: 'visa_type', label: 'Visa Type' },
  { key: 'applicant_name', label: 'Applicant' },
  { key: 'passport_number', label: 'Passport' },
  { key: 'apply_date', label: 'Applied', render: v => formatDate(v) },
  { key: 'status', label: 'Status' },
  { key: 'total_sell', label: 'Amount', render: v => fmtCurrency(v) },
];
const flightColumns = [
  { key: 'billno', label: 'Bill #' },
  { key: 'flight_no', label: 'Flight' },
  { key: 'airport_name', label: 'Airport', render: v => v ? (v.length > 25 ? v.slice(0, 25) + '...' : v) : '\u2014' },
  { key: 'from_datetime', label: 'Departure', render: v => formatDate(v) },
  { key: 'passenger_name', label: 'Passenger' },
  { key: 'status', label: 'Status' },
  { key: 'selling_price', label: 'Amount', render: v => fmtCurrency(v) },
];
const chatColumns = [
  { key: 'wa_name', label: 'WA Name' },
  { key: 'wa_id', label: 'WA ID' },
  { key: 'country', label: 'Country' },
  { key: 'status', label: 'Status', render: v => v === 0 ? 'Open' : v === 1 ? 'Resolved' : v },
  { key: 'last_short', label: 'Last Msg', render: v => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'last_msg_at', label: 'Last Msg At', render: v => formatDate(v) },
];

const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 14px', whiteSpace: 'nowrap' };
