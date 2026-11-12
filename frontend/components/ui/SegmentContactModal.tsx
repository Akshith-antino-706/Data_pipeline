'use client';

import { useEffect, useId, useState } from 'react';
import { Loader2, Mail, MapPin, Phone, X } from 'lucide-react';
import { Button } from './Button';
import { Chip } from './Chip';
import { segmentStatusMeta } from './SegmentStatus';
import s from './Segment.module.css';

export interface SegmentContactBooking {
  service_name?: string | null;
  guest_name?: string | null;
  bill_no?: string | number | null;
  selling_price?: string | number | null;
  is_cancel?: string | null;
  status?: string | null;
  travel_date?: string | null;
  bill_date?: string | null;
  booking_date?: string | null;
}

type BookingKey = 'rayna_tours' | 'rayna_packages' | 'rayna_hotels' | 'rayna_visas' | 'rayna_others' | 'rayna_flights';
type CountKey = 'total_tour_bookings' | 'total_package_bookings' | 'total_hotel_bookings' | 'total_visa_bookings' | 'total_other_bookings' | 'total_flight_bookings';

export type SegmentContactView = {
  name?: string | null;
  email?: string | null;
  mobile?: string | null;
  country?: string | null;
  booking_status?: string | null;
  contact_type?: string | null;
  product_tier?: string | null;
  is_indian?: boolean | null;
  total_booking_revenue?: number | string | null;
} & Partial<Record<CountKey, number | null>> & Partial<Record<BookingKey, SegmentContactBooking[] | null>>;

const TYPES: { key: BookingKey; countKey: CountKey; label: string }[] = [
  { key: 'rayna_tours', countKey: 'total_tour_bookings', label: 'Tours' },
  { key: 'rayna_packages', countKey: 'total_package_bookings', label: 'Packages' },
  { key: 'rayna_hotels', countKey: 'total_hotel_bookings', label: 'Hotels' },
  { key: 'rayna_visas', countKey: 'total_visa_bookings', label: 'Visas' },
  { key: 'rayna_others', countKey: 'total_other_bookings', label: 'Others' },
  { key: 'rayna_flights', countKey: 'total_flight_bookings', label: 'Flights' },
];

const fmt = (n: number | null | undefined) => (n || 0).toLocaleString();
export const fmtAED = (n: unknown) => `AED ${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isCancelled = (b: SegmentContactBooking) => b.is_cancel === '1' || b.status === 'Cancelled';
const price = (b: SegmentContactBooking) => { const v = parseFloat(String(b.selling_price ?? '')); return Number.isFinite(v) ? v : 0; };

export interface SegmentContactModalProps {
  contact: SegmentContactView | null;
  loading: boolean;
  onClose: () => void;
}

/** Contact detail popup (bookings by type, totals) shared by the segment detail pages. */
export function SegmentContactModal({ contact: u, loading, onClose }: SegmentContactModalProps) {
  const titleId = useId();
  const [expanded, setExpanded] = useState<BookingKey | null>(null);
  const open = !!u || loading;

  useEffect(() => {
    if (!open) { setExpanded(null); return; }
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const types = u ? TYPES.filter(t => (u[t.countKey] || 0) > 0) : [];
  const totalBookings = u ? TYPES.reduce((sum, t) => sum + (u[t.countKey] || 0), 0) : 0;
  const status = u?.booking_status ? segmentStatusMeta(u.booking_status) : null;

  return (
    <div className={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {!u ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }} id={titleId} aria-label="Loading contact"><Loader2 size={24} className="spin" /></div>
        ) : (
          <>
            <div className={s.modalHead}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <h2 id={titleId} className={s.modalTitle}>{u.name || 'Unknown'}</h2>
                <div className={s.help} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {u.email && <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflowWrap: 'anywhere' }}><Mail size={12} aria-hidden="true" />{u.email}</span>}
                  {u.mobile && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={12} aria-hidden="true" />{u.mobile}</span>}
                  {u.country && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={12} aria-hidden="true" />{u.country}</span>}
                </div>
                <div className={s.row} style={{ gap: 6 }}>
                  {status && <Chip tone={status.tone}>{status.label}</Chip>}
                  {u.contact_type && <Chip>{u.contact_type}</Chip>}
                  {u.product_tier && <Chip tone={u.product_tier === 'LUXURY' ? 'gold' : 'mute'}>{u.product_tier}</Chip>}
                  {u.is_indian && <Chip tone="warn">INDIAN</Chip>}
                </div>
              </div>
              <Button variant="ghost" size="sm" icon aria-label="Close" onClick={onClose}><X size={18} /></Button>
            </div>

            <div className={s.cols2}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className={s.eyebrow}>Booking Breakdown</span>
                {types.length === 0 && <span className={s.note}>No bookings.</span>}
                {types.map(t => {
                  const bookings = u[t.key] || [];
                  const rev = bookings.filter(b => !isCancelled(b)).reduce((sum, b) => sum + price(b), 0);
                  const isOpen = expanded === t.key;
                  return (
                    <div key={t.key}>
                      <button type="button" className={s.typeRow} aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : t.key)}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</span>
                        <span className={s.num} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                          <b>{fmt(u[t.countKey])}</b>
                          <span style={{ color: 'var(--ink2)' }}>{fmtAED(rev)}</span>
                        </span>
                      </button>
                      {isOpen && bookings.length > 0 && (
                        <div className={s.bookingList}>
                          {bookings.map((b, i) => (
                            <div key={i} className={s.booking}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontWeight: 500 }}>{b.service_name || b.guest_name || `Booking #${b.bill_no || i + 1}`}</span>
                                <span className={`${s.num} ${isCancelled(b) ? s.bad : s.ok}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtAED(b.selling_price)}</span>
                              </div>
                              <div className={s.help} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                                {(b.travel_date || b.bill_date) && <span>Travel: {(b.travel_date || b.bill_date || '').slice(0, 10)}</span>}
                                {b.booking_date && <span>Booked: {b.booking_date}</span>}
                                {isCancelled(b) && <span className={s.bad} style={{ fontWeight: 600 }}>CANCELLED</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className={s.eyebrow}>Summary</span>
                <div className={s.tile}><span className={s.help}>Total Bookings</span><span className={s.statValue}>{fmt(totalBookings)}</span></div>
                <div className={s.tile}><span className={s.help}>Total Revenue</span><span className={s.statValue} style={{ fontSize: 20 }}>{fmtAED(u.total_booking_revenue)}</span></div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
