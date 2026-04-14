import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSegmentActivity, snapshotDailySegments, getSegmentCustomers, downloadSegmentActivity, downloadSegmentCustomers } from '../api';
import { useBusinessType } from '../App';
import {
  Users, TrendingUp, TrendingDown, ArrowRightLeft, Mail, MessageCircle, Bell,
  RefreshCw, Loader2, Calendar, DollarSign, Filter, Download, Eye, X,
  ChevronLeft, ChevronRight, Phone, Search,
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
      const params = { days };
      if (segmentFilter) params.segment = segmentFilter;
      const res = await getSegmentActivity(params);
      setData(res);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [days, segmentFilter]);

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
      const res = await getSegmentCustomers({ bookingStatus: segmentLabel, page: 1, limit: 25 });
      setDetailCustomers(res);
    } catch (err) { console.error(err); }
    setDetailLoading(false);
  };

  const loadDetailPage = async (page, search) => {
    setDetailLoading(true);
    try {
      const res = await getSegmentCustomers({ bookingStatus: detailSegment, page, limit: 25, search });
      setDetailCustomers(res);
      setDetailPage(page);
    } catch (err) { console.error(err); }
    setDetailLoading(false);
  };

  const closeDetail = () => { setDetailSegment(null); setDetailCustomers(null); };

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
          <button onClick={() => downloadSegmentActivity({ days, segment: segmentFilter })}
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
          <button onClick={() => downloadSegmentActivity({ days, segment: segmentFilter })}
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
                <button onClick={() => downloadSegmentCustomers({ bookingStatus: detailSegment })}
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
                        <tr key={c.unified_id} style={{ borderBottom: '1px solid var(--border)' }}>
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
    </motion.div>
  );
}

const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' };
const tdStyle = { padding: '10px 14px', whiteSpace: 'nowrap' };
