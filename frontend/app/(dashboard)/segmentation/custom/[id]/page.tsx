'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, Search } from 'lucide-react';
import { getCustomSegmentById, getCustomSegmentCustomers, getUnifiedContact } from '@/lib/api';
import { PageHeader, Chip, Button, Input, Table, EmptyState, Skeleton } from '@/components/ui';
import { SegmentStat } from '@/components/ui/SegmentStat';
import { SegmentPager } from '@/components/ui/SegmentPager';
import { SegmentContactModal, type SegmentContactView } from '@/components/ui/SegmentContactModal';
import { segmentStatusMeta, tierLabel, geoLabel } from '@/components/ui/SegmentStatus';
import s from '@/components/ui/Segment.module.css';
import type { QueryParams } from '@/types/api';

interface SegmentCondition { field?: string; value?: string | number | (string | number)[] }
interface CustomSegment { name?: string; description?: string; color?: string; conditions?: SegmentCondition[] }
interface SegmentCustomer {
  id: number | string; name?: string; email?: string; mobile?: string; country?: string; city?: string;
  is_indian?: boolean; booking_status?: string; product_tier?: string; geography?: string;
}
interface CustomersResponse { data?: SegmentCustomer[]; total?: number; totalPages?: number }

const fmt = (n: number | null | undefined) => (n || 0).toLocaleString();

const conditionText = (c: SegmentCondition) =>
  `${c.field?.replace(/_/g, ' ') ?? ''}${c.value && !Array.isArray(c.value) ? `: ${c.value}` : ''}${Array.isArray(c.value) ? `: ${c.value.join(', ')}` : ''}`;

export default function CustomSegmentDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [segment, setSegment] = useState<CustomSegment | null>(null);
  const [customers, setCustomers] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [segLoading, setSegLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [userDetail, setUserDetail] = useState<SegmentContactView | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await getCustomSegmentById(id) as { data?: CustomSegment | null } & CustomSegment;
        setSegment(res && 'data' in res ? (res.data ?? null) : res);
      } catch (err) { console.error(err); }
      setSegLoading(false);
    })();
  }, [id]);

  const loadCustomers = useCallback(async (pg = 1, q = '') => {
    setLoading(true);
    try {
      const params: QueryParams = { page: pg, limit: 25 };
      if (q) params.search = q;
      const res = await getCustomSegmentCustomers(id, params);
      setCustomers(res as CustomersResponse);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadCustomers(1, ''); }, [loadCustomers]);

  const openUserDetail = async (contactId: number | string) => {
    setUserDetailLoading(true);
    try {
      const res = await getUnifiedContact(contactId) as { data?: SegmentContactView } & SegmentContactView;
      setUserDetail(res.data || res);
    } catch (err) { console.error(err); }
    setUserDetailLoading(false);
  };
  const closeUserDetail = useCallback(() => { setUserDetail(null); setUserDetailLoading(false); }, []);

  if (segLoading) {
    return (
      <div className={s.page} aria-busy="true" aria-label="Loading segment">
        <div className={s.skelRows}>
          <Skeleton width="min(220px, 40%)" height={12} />
          <Skeleton width="min(420px, 60%)" height={28} />
          <Skeleton width="min(520px, 80%)" height={14} />
        </div>
        <section className={s.card} aria-hidden="true"><Skeleton width={60} height={12} /><div className={s.row}><Skeleton width={140} height={26} radius={999} /><Skeleton width={200} height={26} radius={999} /></div></section>
        <div className={s.stats} aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className={s.stat}><Skeleton width={90} height={12} /><Skeleton width={110} height={24} /></div>)}</div>
        <Skeleton width="min(420px, 100%)" height={36} radius={8} />
        <CustomersTableSkeleton />
      </div>
    );
  }

  if (!segment) {
    return (
      <div className={s.page}>
        <EmptyState title="Segment not found" action={<Link href="/segmentation" className="ui-btn ui-btn--sm">Back to Segmentation</Link>} />
      </div>
    );
  }

  const rows = customers?.data || [];
  const goPage = (p: number) => { setPage(p); loadCustomers(p, search); };

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Segments', href: '/segmentation' }, { label: segment.name || 'Segment' }]}
        title={segment.name}
        meta={<Chip tone="gold">Custom</Chip>}
        description={
          <>
            {segment.description && <>{segment.description}<br /></>}
            <span className={s.help}>{loading ? 'Loading...' : `${fmt(customers?.total || 0)} customers`}</span>
          </>
        }
      />

      {(segment.conditions || []).length > 0 && (
        <section className={s.card} aria-label="Rules">
          <span className={s.eyebrow}>Rules</span>
          <div className={s.row} style={{ gap: 6 }}>
            {(segment.conditions || []).map((c, i) => <Chip key={i} tone="gold">{conditionText(c)}</Chip>)}
          </div>
        </section>
      )}

      {loading && !customers ? (
        <div className={s.stats} aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className={s.stat}><Skeleton width={90} height={12} /><Skeleton width={110} height={24} /></div>)}</div>
      ) : customers && (
        <div className={s.stats}>
          <SegmentStat label="Total Customers" value={fmt(customers.total)} />
          <SegmentStat label="Conditions" value={segment.conditions?.length || 0} />
          <SegmentStat label="Page" value={`${page} / ${customers.totalPages || 1}`} />
        </div>
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
        <CustomersTableSkeleton />
      ) : rows.length > 0 ? (
        <>
          <Table label="Customers" style={{ minWidth: 820 }}>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Mobile</th><th>Booking status</th><th>Tier</th><th>Geography</th><th>Location</th><th><span className={s.srOnly}>Details</span></th></tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const st = c.booking_status ? segmentStatusMeta(c.booking_status) : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{c.name || 'Unknown'}</span>
                      {c.is_indian && <> <Chip tone="warn">Indian</Chip></>}
                    </td>
                    <td className={s.note}>{c.email || '—'}</td>
                    <td className={s.note}>{c.mobile || '—'}</td>
                    <td>{st ? <Chip tone={st.tone}>{st.label}</Chip> : '—'}</td>
                    <td>{c.product_tier ? <Chip tone={c.product_tier === 'LUXURY' ? 'gold' : 'mute'}>{tierLabel(c.product_tier)}</Chip> : '—'}</td>
                    <td>{c.geography ? <Chip tone="info">{geoLabel(c.geography)}</Chip> : '—'}</td>
                    <td className={s.help}>{c.country ? `${c.country}${c.city ? ` · ${c.city}` : ''}` : '—'}</td>
                    <td className={s.r}>
                      <Button variant="ghost" size="sm" icon title="View user details" aria-label={`View ${c.name || 'contact'} details`} onClick={() => openUserDetail(c.id)}><Eye size={14} /></Button>
                    </td>
                  </tr>
                );
              })}
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

/** Rows shaped like the customers table (8 columns), used while the segment or a page loads. */
function CustomersTableSkeleton() {
  return (
    <div className={s.tableSkel} aria-label="Loading customers" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={s.tableSkelRow}>
          <Skeleton width="18%" height={14} /><Skeleton width="24%" height={14} /><Skeleton width="12%" height={14} />
          <Skeleton width={78} height={22} radius={999} /><Skeleton width={70} height={22} radius={999} /><Skeleton width={96} height={22} radius={999} />
          <Skeleton width="10%" height={14} />
        </div>
      ))}
    </div>
  );
}
