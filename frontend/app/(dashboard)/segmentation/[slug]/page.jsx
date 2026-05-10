'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { getSegmentCustomers, getUnifiedContact } from '@/lib/api';
import { slugToCombo } from '@/lib/segmentSlug';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, Plane, Hotel, Ticket, Search, X, ChevronLeft, ChevronRight,
  Loader2, Globe, MapPin, MessageCircle, Eye, Phone, Mail, Package,
  ShieldCheck, MoreHorizontal, ArrowLeft,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const fmt = (n) => (n || 0).toLocaleString();
const fmtAED = (n) => `AED ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_CONFIG = {
  ON_TRIP:         { label: 'On Trip',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  FUTURE_TRAVEL:   { label: 'Future Travel',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  ACTIVE_ENQUIRY:  { label: 'Active Enquiry',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  PAST_BOOKING:    { label: 'Past Booking',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  PAST_ENQUIRY:    { label: 'Past Enquiry',    color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  PROSPECT:        { label: 'Prospect',        color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};

const BOOKING_TYPES = [
  { key: 'rayna_tours', label: 'Tours', countKey: 'total_tour_bookings', icon: Plane, color: '#22c55e' },
  { key: 'rayna_packages', label: 'Packages', countKey: 'total_package_bookings', icon: Package, color: '#3b82f6' },
  { key: 'rayna_hotels', label: 'Hotels', countKey: 'total_hotel_bookings', icon: Hotel, color: '#8b5cf6' },
  { key: 'rayna_visas', label: 'Visas', countKey: 'total_visa_bookings', icon: ShieldCheck, color: '#f59e0b' },
  { key: 'rayna_others', label: 'Others', countKey: 'total_other_bookings', icon: MoreHorizontal, color: '#64748b' },
  { key: 'rayna_flights', label: 'Flights', countKey: 'total_flight_bookings', icon: Globe, color: '#06b6d4' },
];

export default function SegmentDetailPage() {
  const { slug } = useParams();
  const combo = slugToCombo(slug);
  const { businessType } = useBusinessType();

  const [customers, setCustomers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [userDetail, setUserDetail] = useState(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [expandedBookingType, setExpandedBookingType] = useState(null);

  const loadCustomers = useCallback(async (pg = 1, q = '') => {
    setLoading(true);
    try {
      const params = { page: pg, limit: 25 };
      if (businessType !== 'All') params.businessType = businessType;
      if (combo.bookingStatus) params.bookingStatus = combo.bookingStatus;
      if (combo.productTier) params.productTier = combo.productTier;
      if (combo.geography) params.geography = combo.geography;
      if (q) params.search = q;
      const res = await getSegmentCustomers(params);
      setCustomers(res);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [businessType, combo.bookingStatus, combo.productTier, combo.geography]);

  useEffect(() => { loadCustomers(1, ''); }, [loadCustomers]);

  const openUserDetail = async (contactId) => {
    setUserDetailLoading(true);
    try {
      const res = await getUnifiedContact(contactId);
      setUserDetail(res.data || res);
    } catch (err) { console.error(err); }
    setUserDetailLoading(false);
  };

  const statusCfg = combo.bookingStatus ? STATUS_CONFIG[combo.bookingStatus] : null;
  const accentColor = statusCfg?.color || 'var(--primary)';

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Link href="/segmentation" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Segmentation
        </Link>
        <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{combo.label}</span>
      </div>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{combo.label}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            {loading ? 'Loading...' : `${fmt(customers?.total || 0)} customers`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {combo.bookingStatus && (
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: statusCfg?.bg || 'var(--secondary)', color: accentColor, fontWeight: 600 }}>
              {statusCfg?.label || combo.bookingStatus}
            </span>
          )}
          {combo.productTier && (
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: combo.productTier === 'LUXURY' ? 'rgba(226,179,64,0.15)' : 'rgba(148,163,184,0.15)', color: combo.productTier === 'LUXURY' ? '#e2b340' : '#94a3b8', fontWeight: 600 }}>
              {combo.productTier === 'LUXURY' ? 'Luxury' : 'Standard'}
            </span>
          )}
          {combo.geography && (
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: combo.geography === 'LOCAL' ? 'rgba(6,182,212,0.15)' : 'rgba(167,139,250,0.15)', color: combo.geography === 'LOCAL' ? '#06b6d4' : '#a78bfa', fontWeight: 600 }}>
              {combo.geography === 'LOCAL' ? 'Local' : 'International'}
            </span>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      {customers && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Customers</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(customers.total)}</div>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Revenue (Page)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>
              {fmtAED(customers.data?.reduce((sum, c) => sum + (parseFloat(c.total_booking_revenue) || 0), 0))}
            </div>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Page</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{page} / {customers.totalPages || 1}</div>
          </div>
        </div>
      )}

      {/* Top Revenue Chart */}
      {customers?.data?.length > 0 && !loading && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px', marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: 'var(--muted-foreground)' }}>Top Revenue (This Page)</div>
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <BarChart data={customers.data.slice(0, 10).map(c => ({ name: (c.name || 'Unknown').split(' ')[0], rev: parseFloat(c.total_booking_revenue) || 0 }))}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip formatter={(v) => fmtAED(v)} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }} />
                <Bar dataKey="rev" fill={accentColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); loadCustomers(1, search); } }}
          placeholder="Search name, email, phone..."
          style={{ width: '100%', padding: '10px 12px 10px 34px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--foreground)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
      </div>

      {/* Customer Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Loader2 size={24} className="spin" /></div>
      ) : customers?.data?.length > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {customers.data.map((c) => (
              <div key={c.id}
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{c.name || 'Unknown'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {c.is_indian && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 500 }}>INDIAN</span>}
                    <div
                      onClick={() => openUserDetail(c.id)}
                      style={{
                        width: 26, height: 26, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--background)', border: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.2s',
                      }}
                      title="View user details"
                    >
                      <Eye size={13} style={{ color: 'var(--muted-foreground)' }} />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {c.email && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} />{c.email}</div>}
                  {c.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{c.phone}</div>}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--muted-foreground)', flexWrap: 'wrap' }}>
                  {c.total_tour_bookings > 0 && <span><Plane size={11} /> {c.total_tour_bookings} tours</span>}
                  {c.total_hotel_bookings > 0 && <span><Hotel size={11} /> {c.total_hotel_bookings} hotels</span>}
                  {c.total_visa_bookings > 0 && <span><Ticket size={11} /> {c.total_visa_bookings} visas</span>}
                  {c.total_flight_bookings > 0 && <span><Globe size={11} /> {c.total_flight_bookings} flights</span>}
                  {c.total_chats > 0 && <span><MessageCircle size={11} /> {c.total_chats} chats</span>}
                </div>
                {parseFloat(c.total_booking_revenue) > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{fmtAED(c.total_booking_revenue)}</div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {customers.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 20, fontSize: 13 }}>
              <button disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); loadCustomers(p, search); }}
                className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ChevronLeft size={14} /> Prev
              </button>
              <span style={{ color: 'var(--muted-foreground)' }}>Page {page} of {customers.totalPages}</span>
              <button disabled={page >= customers.totalPages} onClick={() => { const p = page + 1; setPage(p); loadCustomers(p, search); }}
                className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted-foreground)', fontSize: 14 }}>No customers found</div>
      )}

      {/* User Detail Modal */}
      <AnimatePresence>
        {(userDetail || userDetailLoading) && (() => {
          const u = userDetail;
          const totalBookings = u ? BOOKING_TYPES.reduce((s, t) => s + (u[t.countKey] || 0), 0) : 0;
          return (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setUserDetail(null); setExpandedBookingType(null); }}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1100,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'var(--card)', borderRadius: 'var(--radius-xl)', padding: '24px 28px',
                  width: 760, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto',
                  border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}>

                {userDetailLoading && !u ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Loader2 size={24} className="spin" /></div>
                ) : u && (
                  <>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 18, fontWeight: 700 }}>{u.name || 'Unknown'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--muted-foreground)' }}>
                          {u.email && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Mail size={12} />{u.email}</div>}
                          {u.mobile && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={12} />{u.mobile}</div>}
                          {u.country && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={12} />{u.country}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                          {u.booking_status && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: STATUS_CONFIG[u.booking_status]?.bg || 'var(--secondary)', color: STATUS_CONFIG[u.booking_status]?.color || 'var(--foreground)', fontWeight: 600 }}>{STATUS_CONFIG[u.booking_status]?.label || u.booking_status}</span>}
                          {u.contact_type && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--secondary)', color: 'var(--foreground)', fontWeight: 500 }}>{u.contact_type}</span>}
                          {u.product_tier && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: u.product_tier === 'LUXURY' ? 'rgba(226,179,64,0.15)' : 'var(--secondary)', color: u.product_tier === 'LUXURY' ? '#e2b340' : 'var(--foreground)', fontWeight: 500 }}>{u.product_tier}</span>}
                          {u.is_indian && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 500 }}>INDIAN</span>}
                        </div>
                      </div>
                      <button onClick={() => { setUserDetail(null); setExpandedBookingType(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}>
                        <X size={18} />
                      </button>
                    </div>

                    {/* Two-column layout */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                      {/* Left — Booking type breakdown */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 2 }}>Booking Breakdown</div>
                        {BOOKING_TYPES.filter(t => (u[t.countKey] || 0) > 0).map(t => {
                          const count = u[t.countKey] || 0;
                          const bookings = u[t.key] || [];
                          const rev = bookings.filter(b => b.is_cancel !== '1' && b.status !== 'Cancelled').reduce((s, b) => s + (parseFloat(b.selling_price) || 0), 0);
                          const isExpanded = expandedBookingType === t.key;
                          return (
                            <div key={t.key}>
                              <div
                                onClick={() => setExpandedBookingType(isExpanded ? null : t.key)}
                                style={{
                                  padding: '10px 14px', background: 'var(--background)', borderRadius: 'var(--radius)',
                                  border: `1px solid ${isExpanded ? t.color + '60' : 'var(--border)'}`, cursor: 'pointer', transition: 'border-color 0.2s',
                                }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <t.icon size={14} style={{ color: t.color }} />
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right' }}>
                                    <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt(count)}</span>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: t.color, minWidth: 80 }}>{fmtAED(rev)}</span>
                                  </div>
                                </div>
                              </div>
                              <AnimatePresence>
                                {isExpanded && bookings.length > 0 && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                                    style={{ overflow: 'hidden' }}>
                                    <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4, marginLeft: 12, borderLeft: `2px solid ${t.color}30`, paddingLeft: 12 }}>
                                      {bookings.map((b, i) => (
                                        <div key={i} style={{ padding: '8px 10px', background: 'var(--secondary)', borderRadius: 'var(--radius)', fontSize: 12 }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                            <div style={{ fontWeight: 500, flex: 1 }}>{b.service_name || b.guest_name || `Booking #${b.bill_no || i + 1}`}</div>
                                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', color: b.is_cancel === '1' || b.status === 'Cancelled' ? '#ef4444' : '#22c55e' }}>
                                              {fmtAED(b.selling_price)}
                                            </div>
                                          </div>
                                          <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--muted-foreground)' }}>
                                            {(b.travel_date || b.bill_date) && <span>Travel: {(b.travel_date || b.bill_date || '').slice(0, 10)}</span>}
                                            {b.booking_date && <span>Booked: {b.booking_date}</span>}
                                            {(b.is_cancel === '1' || b.status === 'Cancelled') && <span style={{ color: '#ef4444', fontWeight: 500 }}>CANCELLED</span>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>

                      {/* Right — Totals */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 2 }}>Summary</div>
                        <div style={{ padding: '16px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Bookings</div>
                          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(totalBookings)}</div>
                        </div>
                        <div style={{ padding: '16px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Revenue</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{fmtAED(u.total_booking_revenue)}</div>
                        </div>
                        <div style={{ padding: '12px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', flex: 1 }}>
                          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 10 }}>By Type</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {BOOKING_TYPES.filter(t => (u[t.countKey] || 0) > 0).map(t => {
                              const count = u[t.countKey] || 0;
                              const bookings = u[t.key] || [];
                              const rev = bookings.filter(b => b.is_cancel !== '1' && b.status !== 'Cancelled').reduce((s, b) => s + (parseFloat(b.selling_price) || 0), 0);
                              return (
                                <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <t.icon size={12} style={{ color: t.color }} />
                                    <span style={{ fontWeight: 500 }}>{t.label}</span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <span style={{ fontWeight: 600 }}>{fmt(count)}</span>
                                    <span style={{ color: 'var(--muted-foreground)', fontSize: 11, minWidth: 75, textAlign: 'right' }}>{fmtAED(rev)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
