'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSegmentActivity, snapshotDailySegments, getSegmentCustomers, downloadSegmentActivity, downloadSegmentCustomers, getUnifiedContact, getSegmentChanges } from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, TrendingUp, TrendingDown, ArrowRightLeft, Mail, MessageCircle, Bell,
  RefreshCw, Loader2, Calendar, DollarSign, Filter, Download, Eye, X,
  ChevronLeft, ChevronRight, Phone, Search, Globe, Building2, Hash, MapPin,
  Clock, Palmtree, Hotel, FileText, Plane, ChevronDown, ChevronUp, Layers,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Variants } from 'framer-motion';
import type { QueryParams } from '@/types/api';
import { PageHeader, Button, Select, Table, EmptyState, Skeleton } from '@/components/ui';
import { SegmentStat } from '@/components/ui/SegmentStat';
import { SegmentBars, type SegmentBarRow } from '@/components/ui/SegmentBars';
import { segmentStatusMeta } from '@/components/ui/SegmentStatus';
import s from '@/components/ui/Segment.module.css';

interface SegmentLogRow { log_date?: string; segment_label: string; total_count?: number; entered: number; exited: number; converted: number; emails_sent?: number; whatsapp_sent?: number; push_sent?: number; total_reached?: number; journey_active?: number; revenue?: number | string }
interface LiveSegment { segment_label: string; total_count?: number; revenue?: string | number }
interface SegmentActivityData { liveToday?: LiveSegment[]; logs?: SegmentLogRow[] }
interface SegmentChange { segment: string; before?: number; after?: number; change: number }
interface SegmentChangesData { changes?: SegmentChange[]; before?: { date?: string }; after?: { date?: string } }
type BookingRow = Record<string, string | number | null | undefined>;
interface ContactDetail {
  id: string | number; name?: string; sources?: string; booking_status?: string; product_tier?: string; geography?: string; segments?: string;
  email?: string; mobile?: string; city?: string; country?: string; contact_type?: string;
  total_tour_bookings: number; total_hotel_bookings: number; total_visa_bookings: number; total_package_bookings: number; total_other_bookings: number;
  total_booking_revenue?: number; rayna_tours?: BookingRow[]; rayna_hotels?: BookingRow[]; rayna_visas?: BookingRow[]; rayna_packages?: BookingRow[]; rayna_others?: BookingRow[];
  created_at?: string; updated_at?: string;
}
interface BookingColumn { key: string; label: string; render?: (v: never, row: BookingRow) => React.ReactNode }

const fadeInUp: Variants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const fmt = (n: number | undefined) => (n || 0).toLocaleString();
const fmtAED = (n: number | string | undefined) => `AED ${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ON_TRIP:         { label: 'On Trip',        color: 'var(--ok)' },
  FUTURE_TRAVEL:   { label: 'Future Travel',  color: 'var(--info)' },
  PAST_BOOKING:    { label: 'Past Booking',   color: 'var(--gold)' },
  CANCELLED:       { label: 'Cancelled',      color: 'var(--bad)' },
  PROSPECT:        { label: 'Prospect',       color: 'var(--ink3)' },
};

function formatDate(d: string | number | null | undefined) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SegmentActivity() {
  const [data, setData] = useState<SegmentActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [days, setDays] = useState(2);
  const [segmentFilter, setSegmentFilter] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const { businessType } = useBusinessType();

  // Detail panel state
  const [detailSegment, setDetailSegment] = useState<string | null>(null);
  const [detailCustomers, setDetailCustomers] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSearch, setDetailSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: QueryParams = { days };
      if (businessType !== 'All') params.businessType = businessType;
      if (segmentFilter) params.segment = segmentFilter;
      const res = await getSegmentActivity(params) as SegmentActivityData;
      setData(res);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [days, segmentFilter, businessType]);

  useEffect(() => { loadData(); }, [loadData]);

  const refreshLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const params: QueryParams = { days };
      if (businessType !== 'All') params.businessType = businessType;
      if (segmentFilter) params.segment = segmentFilter;
      const res = await getSegmentActivity(params) as SegmentActivityData;
      setData(prev => ({ ...prev, logs: res.logs }));
    } catch (err) { console.error(err); }
    setLogLoading(false);
  }, [days, segmentFilter, businessType]);

  const handleSnapshot = async () => {
    setSnapshotting(true);
    try { await snapshotDailySegments(); await loadData(); getSegmentChanges().then(setChanges as (v: unknown) => void).catch(console.error); } catch (err) { console.error(err); }
    setSnapshotting(false);
  };

  const openDetail = async (segmentLabel: string) => {
    setDetailSegment(segmentLabel);
    setDetailPage(1);
    setDetailSearch('');
    setDetailLoading(true);
    try {
      const res = await getSegmentCustomers({ bookingStatus: segmentLabel, ...(businessType !== 'All' && { businessType }), page: 1, limit: 25 });
      setDetailCustomers(res);
    } catch (err) { console.error(err); }
    setDetailLoading(false);
  };

  const loadDetailPage = async (page: number, search: string) => {
    setDetailLoading(true);
    try {
      const res = await getSegmentCustomers({ bookingStatus: detailSegment, ...(businessType !== 'All' && { businessType }), page, limit: 25, search });
      setDetailCustomers(res);
      setDetailPage(page);
    } catch (err) { console.error(err); }
    setDetailLoading(false);
  };

  const closeDetail = () => { setDetailSegment(null); setDetailCustomers(null); };

  // Contact detail modal
  const [contactDetail, setContactDetail] = useState<ContactDetail | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [changes, setChanges] = useState<SegmentChangesData | null>(null);

  useEffect(() => {
    getSegmentChanges().then(setChanges as (v: unknown) => void).catch(console.error);
  }, []);

  const openContact = async (id: string | number) => {
    setContactLoading(true);
    try { const res = await getUnifiedContact(id, { bookings: 500 }) as { data: ContactDetail }; setContactDetail(res.data); }
    catch { /* ignore */ }
    setContactLoading(false);
  };

  const liveToday = data?.liveToday || [];
  const totalCustomers = liveToday.reduce((s, r) => s + (r.total_count || 0), 0);
  const totalRevenue = liveToday.reduce((s, r) => s + (parseFloat(r.revenue as string) || 0), 0);
  const logs = data?.logs || [];
  const totalEntered = logs.reduce((s, r) => s + (r.entered || 0), 0);
  const totalExited = logs.reduce((s, r) => s + (r.exited || 0), 0);
  const totalConverted = logs.reduce((s, r) => s + (r.converted || 0), 0);
  const totalReached = logs.reduce((s, r) => s + (r.total_reached || 0), 0);

  const logsByDate: Record<string, SegmentLogRow[]> = {};
  for (const log of logs) { const d = log.log_date?.slice(0, 10) as string; if (!logsByDate[d]) logsByDate[d] = []; logsByDate[d].push(log); }
  const dates = Object.keys(logsByDate).sort((a, b) => b.localeCompare(a));

  const filterParams = { days, segment: segmentFilter, ...(businessType !== 'All' && { businessType }) };
  const liveRows: SegmentBarRow[] = liveToday.map(seg => {
    const m = segmentStatusMeta(seg.segment_label);
    return {
      key: seg.segment_label,
      label: m.label,
      value: Number(seg.total_count) || 0,
      color: m.color,
      selected: detailSegment === seg.segment_label,
      onSelect: () => openDetail(seg.segment_label),
      figures: <><b>{fmt(seg.total_count)}</b> <span className={s.help}>{fmtAED(seg.revenue)}</span></>,
    };
  });
  const periodLabel = days === 1 ? 'last 24 hours' : `last ${days} days`;

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Segments', href: '/segmentation' }, { label: 'Changes over time' }]}
        title="Segment activity"
        description="Daily segment entries, exits, conversions and reach. Click a segment to load its customers."
        actions={
          <>
            <Button onClick={handleSnapshot} disabled={snapshotting}>
              {snapshotting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} aria-hidden="true" />} Snapshot now
            </Button>
            <Button variant="primary" onClick={() => downloadSegmentActivity(filterParams)}>
              <Download size={14} aria-hidden="true" /> Download CSV
            </Button>
          </>
        }
      />

      <div className={s.toolbar} role="group" aria-label="Filters">
        <Select aria-label="Period" value={days} onChange={e => setDays(parseInt(e.target.value))} style={{ width: 'auto', minWidth: 160, height: 36 }}>
          <option value={1}>Last 24 hours</option>
          <option value={2}>Last 2 days</option>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
        <Select aria-label="Segment" value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} style={{ width: 'auto', minWidth: 180, height: 36 }}>
          <option value="">All Segments</option>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className={s.stats}>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className={s.stat}><Skeleton width={80} height={12} /><Skeleton width={110} height={24} /></div>)}
        </div>
      ) : (
        <div className={s.stats}>
          <SegmentStat label="Total customers" value={fmt(totalCustomers)} help="In segments today" />
          <SegmentStat label="Joined a segment" value={fmt(totalEntered)} help={periodLabel} color="var(--ok)" />
          <SegmentStat label="Left a segment" value={fmt(totalExited)} help={periodLabel} color="var(--bad)" />
          <SegmentStat label="Converted" value={fmt(totalConverted)} help={periodLabel} />
          <SegmentStat label="Reached" value={fmt(totalReached)} help={periodLabel} />
          <SegmentStat label="Revenue" value={fmtAED(totalRevenue)} help="Segments today" />
        </div>
      )}

      <section className={s.card} aria-label="Live segment counts">
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>Live segment counts</h2>
          <span className={s.help}>Today · bar length is to scale · click a segment to load its customers</span>
        </div>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={22} />)
          : liveRows.length > 0 ? <SegmentBars label="Live segment counts" rows={liveRows} /> : <span className={s.note}>No live counts yet.</span>}
      </section>

      {changes?.changes?.length as number > 0 && (
        <section className={s.card} aria-label="Segment changes">
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Segment changes</h2>
            <span className={s.help}>{changes!.before?.date} → {changes!.after?.date}</span>
          </div>
          <Table label="Segment changes" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th>Booking status</th>
                <th className={s.r}>Before ({changes!.before?.date?.slice(5)})</th>
                <th className={s.r}>After ({changes!.after?.date?.slice(5)})</th>
                <th className={s.r}>Change</th>
              </tr>
            </thead>
            <tbody>
              {changes!.changes!.map(c => {
                const m = segmentStatusMeta(c.segment);
                return (
                  <tr key={c.segment}>
                    <td><span className={s.row} style={{ gap: 8 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} />{m.label}</span></td>
                    <td className={`${s.r} ${s.num}`}>{fmt(c.before)}</td>
                    <td className={`${s.r} ${s.num}`} style={{ fontWeight: 600 }}>{fmt(c.after)}</td>
                    <td className={`${s.r} ${s.num}`} style={{ fontWeight: 600, color: c.change > 0 ? 'var(--ok)' : c.change < 0 ? 'var(--bad)' : 'var(--ink3)' }}>
                      {c.change > 0 ? `+${fmt(c.change)}` : c.change < 0 ? fmt(c.change) : '0'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}

      {loading ? (
        <div className={s.card}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={18} />)}</div>
      ) : (
      <section className={s.card} aria-label="Daily log">
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>Daily log</h2>
          <span className={s.spacer} />
          <Button size="sm" variant="ghost" onClick={refreshLog} disabled={logLoading}>
            {logLoading ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} aria-hidden="true" />} Refresh
          </Button>
          <Button size="sm" onClick={() => downloadSegmentActivity(filterParams)}>
            <Download size={12} aria-hidden="true" /> Export
          </Button>
        </div>
        {logLoading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><Loader2 size={18} className="spin" style={{ color: 'var(--ink3)' }} /></div>
        ) : dates.length === 0 ? (
          <EmptyState title="No daily logs yet" description={'Click "Snapshot now" to capture today\'s data.'} />
        ) : (
          <Table label="Daily log" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Segment</th>
                <th className={s.r}>Total</th>
                <th className={s.r}>Entered</th>
                <th className={s.r}>Exited</th>
                <th className={s.r}>Converted</th>
                <th className={s.r}>Email</th>
                <th className={s.r}>WhatsApp</th>
                <th className={s.r}>Push</th>
                <th className={s.r}>Reached</th>
                <th className={s.r}>In journeys</th>
                <th className={s.r}>Revenue</th>
                <th><span className={s.srOnly}>Open</span></th>
              </tr>
            </thead>
            <tbody>
              {dates.map(date => logsByDate[date].map((row, i) => {
                const m = segmentStatusMeta(row.segment_label);
                return (
                  <tr key={`${date}-${row.segment_label}`} className={s.clickRow} onClick={() => openDetail(row.segment_label)}>
                    <td className={s.help}>{i === 0 ? formatDate(date) : ''}</td>
                    <td><span className={s.row} style={{ gap: 8, flexWrap: 'nowrap' }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} />{m.label}</span></td>
                    <td className={`${s.r} ${s.num}`} style={{ fontWeight: 600 }}>{fmt(row.total_count)}</td>
                    <td className={`${s.r} ${s.num}`} style={{ color: row.entered > 0 ? 'var(--ok)' : 'var(--ink3)' }}>{row.entered > 0 ? `+${fmt(row.entered)}` : '0'}</td>
                    <td className={`${s.r} ${s.num}`} style={{ color: row.exited > 0 ? 'var(--bad)' : 'var(--ink3)' }}>{row.exited > 0 ? `-${fmt(row.exited)}` : '0'}</td>
                    <td className={`${s.r} ${s.num}`}>{fmt(row.converted)}</td>
                    <td className={`${s.r} ${s.num}`}>{fmt(row.emails_sent)}</td>
                    <td className={`${s.r} ${s.num}`}>{fmt(row.whatsapp_sent)}</td>
                    <td className={`${s.r} ${s.num}`}>{fmt(row.push_sent)}</td>
                    <td className={`${s.r} ${s.num}`} style={{ fontWeight: 500 }}>{fmt(row.total_reached)}</td>
                    <td className={`${s.r} ${s.num}`}>{fmt(row.journey_active)}</td>
                    <td className={`${s.r} ${s.num}`} style={{ fontWeight: 500 }}>{fmtAED(row.revenue)}</td>
                    <td className={s.r}><Eye size={13} aria-hidden="true" style={{ color: 'var(--ink3)' }} /></td>
                  </tr>
                );
              }))}
            </tbody>
          </Table>
        )}
      </section>
      )}
      {/* Customer Detail Panel — below daily log */}
      {/* <AnimatePresence>
        {detailSegment && (
          <motion.div variants={fadeInUp} initial="hidden" animate="visible" exit="hidden"
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_CONFIG[detailSegment]?.color || 'var(--ink3)' }} />
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
                        <th style={thStyle}>Mobile</th>
                        <th style={thStyle}>Country</th>
                        <th style={thStyle}>Type</th>
                        <th style={thStyle}>Tier</th>
                        <th style={thStyle}>Geography</th>
                        <th style={thStyle}>Sources</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailCustomers.data.map(c => (
                        <tr key={c.id} onClick={() => openContact(c.id)}
                          style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ ...tdStyle, fontWeight: 500 }}>{c.name || '\u2014'}</td>
                          <td style={{ ...tdStyle, fontSize: 11 }}>{c.email || '\u2014'}</td>
                          <td style={{ ...tdStyle, fontSize: 11 }}>{c.mobile || '\u2014'}</td>
                          <td style={tdStyle}>{c.country || '\u2014'}</td>
                          <td style={tdStyle}>{c.contact_type || '\u2014'}</td>
                          <td style={tdStyle}>{c.product_tier || '\u2014'}</td>
                          <td style={tdStyle}>{c.geography || '\u2014'}</td>
                          <td style={{ ...tdStyle, fontSize: 11 }}>{c.sources || '\u2014'}</td>
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
      </AnimatePresence> */}

      {/* Contact Detail Modal */}
      <AnimatePresence>
        {(contactDetail || contactLoading) && (
          <motion.div className={s.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setContactDetail(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()} className={s.modal} role="dialog" aria-modal="true" aria-label="Contact details" style={{ maxWidth: 800, gap: 0 }}>
              {contactLoading && !contactDetail ? (
                <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} className="spin" /></div>
              ) : contactDetail && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{contactDetail.name || 'Unknown'}</h3>
                      <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'monospace' }}>ID: {contactDetail.id}</span>
                      <div style={{ marginTop: 6 }}>{contactDetail.sources?.split(',').map(s => <span key={s} className={`badge badge-blue`} style={{ fontSize: 10, marginRight: 4 }}>{s.trim()}</span>)}</div>
                    </div>
                    <Button variant="ghost" size="sm" icon aria-label="Close" onClick={() => setContactDetail(null)}><X size={16} /></Button>
                  </div>

                  <ModalSection title="Segment">
                    <DetailRow icon={Hash} label="Status" value={contactDetail.booking_status} />
                    <DetailRow icon={Hash} label="Product Tier" value={contactDetail.product_tier || 'N/A'} />
                    <DetailRow icon={Globe} label="Geography" value={contactDetail.geography || 'Unknown'} />
                    <DetailRow icon={Layers} label="Full Segment" value={contactDetail.segments} />
                  </ModalSection>

                  <ModalSection title="Contact Information">
                    <DetailRow icon={Mail} label="Email" value={contactDetail.email} />
                    <DetailRow icon={Phone} label="Mobile" value={contactDetail.mobile} />
                    <DetailRow icon={MapPin} label="City" value={contactDetail.city} />
                    <DetailRow icon={Globe} label="Country" value={contactDetail.country} />
                    <DetailRow icon={Hash} label="Type" value={contactDetail.contact_type} />
                  </ModalSection>

                  {(contactDetail.total_tour_bookings > 0 || contactDetail.total_hotel_bookings > 0 || contactDetail.total_visa_bookings > 0 || contactDetail.total_package_bookings > 0 || contactDetail.total_other_bookings > 0) && (
                    <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted-foreground)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>Booking Summary</div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {contactDetail.total_tour_bookings > 0 && <MiniStat icon={Palmtree} label="Tours" value={contactDetail.total_tour_bookings} color="#10b981" />}
                        {contactDetail.total_hotel_bookings > 0 && <MiniStat icon={Hotel} label="Hotels" value={contactDetail.total_hotel_bookings} color="#6366f1" />}
                        {contactDetail.total_visa_bookings > 0 && <MiniStat icon={FileText} label="Visas" value={contactDetail.total_visa_bookings} color="#f59e0b" />}
                        {contactDetail.total_package_bookings > 0 && <MiniStat icon={Layers} label="Packages" value={contactDetail.total_package_bookings} color="#3b82f6" />}
                        {contactDetail.total_other_bookings > 0 && <MiniStat icon={Hash} label="Others" value={contactDetail.total_other_bookings} color="#64748b" />}
                        <MiniStat icon={DollarSign} label="Revenue" value={fmtAED(contactDetail.total_booking_revenue)} color="var(--primary)" />
                      </div>
                    </div>
                  )}

                  <BookingTable icon={Palmtree} title="Tour Bookings" color="#10b981" rows={contactDetail.rayna_tours} columns={tourColumns} />
                  <BookingTable icon={Hotel} title="Hotel Bookings" color="#6366f1" rows={contactDetail.rayna_hotels} columns={hotelColumns} />
                  <BookingTable icon={FileText} title="Visa Bookings" color="#f59e0b" rows={contactDetail.rayna_visas} columns={visaColumns} />
                  <BookingTable icon={Layers} title="Package Bookings" color="#3b82f6" rows={contactDetail.rayna_packages} columns={tourColumns} />
                  <BookingTable icon={Hash} title="Other Bookings" color="#64748b" rows={contactDetail.rayna_others} columns={tourColumns} />

                  <ModalSection title="Timeline">
                    <DetailRow icon={Calendar} label="Created" value={formatDate(contactDetail.created_at)} />
                    <DetailRow icon={Clock} label="Updated" value={formatDate(contactDetail.updated_at)} />
                  </ModalSection>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Helper Components ────────────────────────────────── */

function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted-foreground)', marginBottom: 10, letterSpacing: 0.5, fontWeight: 600 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px 24px' }}>{children}</div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)', minWidth: 70 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{value || '\u2014'}</span>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: React.ReactNode; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon size={14} style={{ color }} />
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{label}:</span>
      <span style={{ fontSize: 13, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

interface BookingTableProps { icon: LucideIcon; title: string; color: string; rows?: BookingRow[]; columns: BookingColumn[] }
function BookingTable({ icon: Icon, title, color, rows, columns }: BookingTableProps) {
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
            <tbody>{rows!.map((r, i) => (
              <tr key={i}>{columns.map(c => <td key={c.key} style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{c.render ? c.render(r[c.key] as never, r) : (r[c.key] ?? '\u2014')}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtCurrency(v: string | number | null | undefined) { return v == null ? '\u2014' : `AED ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

const tourColumns: BookingColumn[] = [
  { key: 'bill_serial', label: 'Bill #' },
  { key: 'service_name', label: 'Service', render: (v: string) => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'travel_date', label: 'Travel Date', render: (v: string) => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'selling_price', label: 'Amount', render: (v: number) => fmtCurrency(v) },
  { key: 'is_cancel', label: 'Cancelled', render: (v: string) => v === '1' ? 'Yes' : 'No' },
];
const hotelColumns: BookingColumn[] = [
  { key: 'bill_serial', label: 'Bill #' },
  { key: 'service_name', label: 'Hotel', render: (v: string) => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'travel_date', label: 'Travel Date', render: (v: string) => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'selling_price', label: 'Amount', render: (v: number) => fmtCurrency(v) },
  { key: 'is_cancel', label: 'Cancelled', render: (v: string) => v === '1' ? 'Yes' : 'No' },
];
const visaColumns: BookingColumn[] = [
  { key: 'bill_serial', label: 'Bill #' },
  { key: 'service_name', label: 'Visa Type', render: (v: string) => v ? (v.length > 30 ? v.slice(0, 30) + '...' : v) : '\u2014' },
  { key: 'travel_date', label: 'Travel Date', render: (v: string) => formatDate(v) },
  { key: 'guest_name', label: 'Guest' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'selling_price', label: 'Amount', render: (v: number) => fmtCurrency(v) },
  { key: 'is_cancel', label: 'Cancelled', render: (v: string) => v === '1' ? 'Yes' : 'No' },
];

const thStyle: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '10px 14px', whiteSpace: 'nowrap' };
