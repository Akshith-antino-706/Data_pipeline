'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Eye, Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getSegmentCustomers, getUnifiedContact } from '@/lib/api';
import { slugToCombo } from '@/lib/segmentSlug';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { PageHeader, Chip, Button, Input, Table, EmptyState, Skeleton } from '@/components/ui';
import { SegmentStat } from '@/components/ui/SegmentStat';
import { SegmentPager } from '@/components/ui/SegmentPager';
import { SegmentContactModal, fmtAED, type SegmentContactView } from '@/components/ui/SegmentContactModal';
import { segmentStatusMeta, tierLabel, geoLabel } from '@/components/ui/SegmentStatus';
import s from '@/components/ui/Segment.module.css';
import type { Id, QueryParams } from '@/types/api';

interface SegmentCustomer {
  id: Id;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  is_indian?: boolean | null;
  total_tour_bookings: number;
  total_hotel_bookings: number;
  total_visa_bookings: number;
  total_flight_bookings: number;
  total_chats: number;
  total_booking_revenue: string;
}
interface SegmentCustomersResponse { total: number; totalPages: number; data: SegmentCustomer[] }

const fmt = (n: number | null | undefined) => (n || 0).toLocaleString();

function bookingSummary(c: SegmentCustomer): string {
  const parts: string[] = [];
  if (c.total_tour_bookings > 0) parts.push(`${c.total_tour_bookings} tours`);
  if (c.total_hotel_bookings > 0) parts.push(`${c.total_hotel_bookings} hotels`);
  if (c.total_visa_bookings > 0) parts.push(`${c.total_visa_bookings} visas`);
  if (c.total_flight_bookings > 0) parts.push(`${c.total_flight_bookings} flights`);
  if (c.total_chats > 0) parts.push(`${c.total_chats} chats`);
  return parts.join(' · ') || '—';
}

export default function SegmentDetailPage() {
  const { slug } = useParams();
  const combo = slugToCombo(slug as string);
  const { businessType } = useBusinessType();

  const [customers, setCustomers] = useState<SegmentCustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [userDetail, setUserDetail] = useState<SegmentContactView | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  const loadCustomers = useCallback(async (pg = 1, q = '') => {
    setLoading(true);
    try {
      const params: QueryParams = { page: pg, limit: 25 };
      if (businessType !== 'All') params.businessType = businessType;
      if (combo.bookingStatus) params.bookingStatus = combo.bookingStatus;
      if (combo.productTier) params.productTier = combo.productTier;
      if (combo.geography) params.geography = combo.geography;
      if (q) params.search = q;
      const res = await getSegmentCustomers(params) as SegmentCustomersResponse;
      setCustomers(res);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [businessType, combo.bookingStatus, combo.productTier, combo.geography]);

  useEffect(() => { loadCustomers(1, ''); }, [loadCustomers]);

  const openUserDetail = async (contactId: Id) => {
    setUserDetailLoading(true);
    try {
      const res = await getUnifiedContact(contactId) as SegmentContactView & { data?: SegmentContactView };
      setUserDetail(res.data || res);
    } catch (err) { console.error(err); }
    setUserDetailLoading(false);
  };
  const closeUserDetail = useCallback(() => { setUserDetail(null); setUserDetailLoading(false); }, []);

  const statusMeta = combo.bookingStatus ? segmentStatusMeta(combo.bookingStatus) : null;
  const accent = statusMeta?.color || 'var(--gold)';
  const rows = customers?.data || [];
  const goPage = (p: number) => { setPage(p); loadCustomers(p, search); };

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Segments', href: '/segmentation' }, { label: combo.label }]}
        title={combo.label}
        meta={
          <span className={s.row} style={{ gap: 6 }}>
            {combo.bookingStatus && statusMeta && <Chip tone={statusMeta.tone}>{statusMeta.label}</Chip>}
            {combo.productTier && <Chip tone={combo.productTier === 'LUXURY' ? 'gold' : 'mute'}>{tierLabel(combo.productTier)}</Chip>}
            {combo.geography && <Chip tone="info">{geoLabel(combo.geography)}</Chip>}
          </span>
        }
        description={loading && !customers ? <Skeleton width={120} height={14} /> : `${fmt(customers?.total || 0)} customers`}
      />

      {loading && !customers && (
        <div className={s.stats} aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className={s.stat}><Skeleton width={90} height={12} /><Skeleton width={110} height={24} /></div>)}</div>
      )}
      {customers && !loading && (
        <div className={s.stats}>
          <SegmentStat label="Total Customers" value={fmt(customers.total)} />
          <SegmentStat label="Total Revenue (Page)" value={fmtAED(rows.reduce((sum, c) => sum + (parseFloat(c.total_booking_revenue) || 0), 0))} />
          <SegmentStat label="Page" value={`${page} / ${customers.totalPages || 1}`} />
        </div>
      )}

      {rows.length > 0 && !loading && (
        <section className={s.card} aria-label="Top revenue on this page">
          <div className={s.cardHead}><h2 className={s.cardTitle}>Top revenue</h2><span className={s.help}>This page of customers</span></div>
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <BarChart data={rows.slice(0, 10).map(c => ({ name: (c.name || 'Unknown').split(' ')[0], rev: parseFloat(c.total_booking_revenue) || 0 }))}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--ink3)' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip formatter={(v) => fmtAED(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="rev" fill={accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className={s.toolbar}>
        <div className={s.search} style={{ position: 'relative', maxWidth: 420 }}>
          <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
          <Input
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); loadCustomers(1, search); } }}
            placeholder="Search name, email, phone..."
            style={{ paddingLeft: 34 }}
          />
        </div>
      </div>

      {loading ? (
        <div className={s.tableSkel} aria-label="Loading customers" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={s.tableSkelRow}>
              <Skeleton width="20%" height={14} /><Skeleton width="26%" height={14} /><Skeleton width="14%" height={14} /><Skeleton width="18%" height={14} /><Skeleton width="10%" height={14} />
            </div>
          ))}
        </div>
      ) : rows.length > 0 ? (
        <>
          <Table label="Customers" style={{ minWidth: 760 }}>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Phone</th><th>Bookings</th><th className={s.r}>Revenue</th><th><span className={s.srOnly}>Details</span></th></tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{c.name || 'Unknown'}</span>
                    {c.is_indian && <> <Chip tone="warn">Indian</Chip></>}
                  </td>
                  <td className={s.note}>{c.email || '—'}</td>
                  <td className={s.note}>{c.phone || '—'}</td>
                  <td className={s.help}>{bookingSummary(c)}</td>
                  <td className={`${s.r} ${s.num}`} style={{ fontWeight: 600 }}>{parseFloat(c.total_booking_revenue) > 0 ? fmtAED(c.total_booking_revenue) : '—'}</td>
                  <td className={s.r}>
                    <Button variant="ghost" size="sm" icon title="View user details" aria-label={`View ${c.name || 'contact'} details`} onClick={() => openUserDetail(c.id)}><Eye size={14} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <SegmentPager page={page} totalPages={customers?.totalPages || 0} onPage={goPage} />
        </>
      ) : (
        <EmptyState title="No customers found" description={search ? 'Try a different search.' : undefined} />
      )}

      <SegmentContactModal contact={userDetail} loading={userDetailLoading} onClose={closeUserDetail} />
    </div>
  );
}
