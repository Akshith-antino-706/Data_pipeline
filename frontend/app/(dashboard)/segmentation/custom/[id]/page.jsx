'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { getCustomSegmentById, getCustomSegmentCustomers, getUnifiedContact } from '@/lib/api';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, Plane, Hotel, Ticket, Search, X, ChevronLeft, ChevronRight,
  Loader2, Globe, MapPin, MessageCircle, Eye, Phone, Mail, Package,
  ShieldCheck, MoreHorizontal, ArrowLeft, Filter,
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

export default function CustomSegmentDetailPage() {
  const { id } = useParams();

  const [segment, setSegment] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [segLoading, setSegLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [userDetail, setUserDetail] = useState(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [expandedBookingType, setExpandedBookingType] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getCustomSegmentById(id);
        setSegment(res.data || res);
      } catch (err) { console.error(err); }
      setSegLoading(false);
    })();
  }, [id]);

  const loadCustomers = useCallback(async (pg = 1, q = '') => {
    setLoading(true);
    try {
      const params = { page: pg, limit: 25 };
      if (q) params.search = q;
      const res = await getCustomSegmentCustomers(id, params);
      setCustomers(res);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadCustomers(1, ''); }, [loadCustomers]);

  const openUserDetail = async (contactId) => {
    setUserDetailLoading(true);
    try {
      const res = await getUnifiedContact(contactId);
      setUserDetail(res.data || res);
    } catch (err) { console.error(err); }
    setUserDetailLoading(false);
  };

  const accentColor = segment?.color || '#3b82f6';

  if (segLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Loader2 size={24} className="spin" /></div>;
  }

  if (!segment) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Segment not found</div>
        <Link href="/segmentation" style={{ fontSize: 13, color: 'var(--primary)' }}>Back to Segmentation</Link>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <Link href="/segmentation" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Segmentation
        </Link>
        <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>/</span>
        <Link href="/segmentation/all-segments" style={{ fontSize: 13, color: 'var(--muted-foreground)', textDecoration: 'none' }}>
          All Segments
        </Link>
        <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{segment.name}</span>
      </div>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: `${accentColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Filter size={18} style={{ color: accentColor }} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{segment.name}</h2>
              {segment.description && <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>{segment.description}</p>}
            </div>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            {loading ? 'Loading...' : `${fmt(customers?.total || 0)} customers`}
          </p>
        </div>
        {/* Condition tags */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 400, justifyContent: 'flex-end' }}>
          {(segment.conditions || []).map((c, i) => (
            <span key={i} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-sm)',
              background: `${accentColor}15`, color: accentColor, fontWeight: 600,
            }}>
              {c.field?.replace(/_/g, ' ')}
              {c.value && !Array.isArray(c.value) ? `: ${c.value}` : ''}
              {Array.isArray(c.value) ? `: ${c.value.join(', ')}` : ''}
            </span>
          ))}
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
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Conditions</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{segment.conditions?.length || 0}</div>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Page</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{page} / {customers.totalPages || 1}</div>
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
                  {c.mobile && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{c.mobile}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {c.booking_status && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: STATUS_CONFIG[c.booking_status]?.bg || 'var(--secondary)', color: STATUS_CONFIG[c.booking_status]?.color || 'var(--foreground)', fontWeight: 600 }}>
                      {STATUS_CONFIG[c.booking_status]?.label || c.booking_status}
                    </span>
                  )}
                  {c.product_tier && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: c.product_tier === 'LUXURY' ? 'rgba(226,179,64,0.15)' : 'var(--secondary)', color: c.product_tier === 'LUXURY' ? '#e2b340' : 'var(--foreground)', fontWeight: 500 }}>
                      {c.product_tier}
                    </span>
                  )}
                  {c.geography && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: c.geography === 'LOCAL' ? 'rgba(6,182,212,0.15)' : 'rgba(167,139,250,0.15)', color: c.geography === 'LOCAL' ? '#06b6d4' : '#a78bfa', fontWeight: 500 }}>
                      {c.geography}
                    </span>
                  )}
                </div>
                {c.country && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'var(--muted-foreground)' }}>
                    <MapPin size={11} /> {c.country} {c.city ? `· ${c.city}` : ''}
                  </div>
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
