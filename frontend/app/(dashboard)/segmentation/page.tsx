'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, Plus, RefreshCw, Search, Trash2, X, Activity, List } from 'lucide-react';
import { getSegmentationTree, recomputeSegmentation, refreshSegmentationSnapshot, getGeneralSegment, getCustomSegments, deleteCustomSegment } from '@/lib/api';
import CreateSegmentModal from './CreateSegmentModal';
import { comboToSlug } from '@/lib/segmentSlug';
import { useBusinessType } from '@/context/BusinessTypeContext';
import { PageHeader, Button, Input, Chip, StatusChip, Table, EmptyState, ErrorState, Skeleton, ConfirmDialog } from '@/components/ui';
import { SegmentStat } from '@/components/ui/SegmentStat';
import { SegmentBars, type SegmentBarRow } from '@/components/ui/SegmentBars';
import { segmentStatusMeta, tierLabel, geoLabel } from '@/components/ui/SegmentStatus';
import s from '@/components/ui/Segment.module.css';
import type { SegmentCombo } from '@/lib/segmentSlug';
import type {
  CustomSegment, GeneralSegmentSummary, SegmentBreakdownRow, SegmentStatusCount, SegmentTree,
} from '@/types/f7segments';

type BreakdownModalState = SegmentStatusCount & { label: string; color: string };
type SegmentNav = Partial<SegmentCombo> & { label?: string };

const fmt = (n: number | string | null | undefined) => (n || 0).toLocaleString();
const fmtAED = (n: unknown) => `AED ${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtM = (n: unknown) => `AED ${(Number(n || 0) / 1000000).toFixed(2)}M`;
const pct = (n: number | undefined, total: number | undefined) => { const v = ((n ?? 0) / (total ?? 0)) * 100; return (total ?? 0) > 0 && Number.isFinite(v) ? v.toFixed(1) + '%' : '0%'; };

const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const today = new Date();
const onTripFrom = new Date(); onTripFrom.setDate(today.getDate() - 7);

/** What each ready-made status means (shown under its name). */
const STATUS_DESC: Record<string, string> = {
  ON_TRIP: `${fmtDate(onTripFrom)} — ${fmtDate(today)}`,
  FUTURE_TRAVEL: `After ${fmtDate(today)}`,
  ACTIVE_ENQUIRY: 'Enquired in last 30 days',
  PAST_BOOKING: `Before ${fmtDate(onTripFrom)}`,
  PAST_ENQUIRY: 'Enquired 30+ days ago, not booked',
  PROSPECT: 'Never engaged',
};

const SOURCE_LABELS: Record<string, string> = { tours: 'Tours', hotels: 'Hotels', visas: 'Visas', flights: 'Flights' };
const BOOKING_TYPES = [
  { key: 'tours', label: 'Tours' },
  { key: 'packages', label: 'Packages' },
  { key: 'hotels', label: 'Hotels' },
  { key: 'visas', label: 'Visas' },
  { key: 'others', label: 'Others' },
];

const GENERAL = '__general__';

export default function CustomerSegmentation() {
  const router = useRouter();
  const [data, setData] = useState<SegmentTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState(false);
  const [generalLoading, setGeneralLoading] = useState(true);
  const [expandedStatus, setExpandedStatus] = useState<string | null>(null);
  const [breakdownModal, setBreakdownModal] = useState<BreakdownModalState | null>(null);
  const { businessType } = useBusinessType();

  const [refreshing, setRefreshing] = useState(false);
  const [generalSeg, setGeneralSeg] = useState<GeneralSegmentSummary | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customSegments, setCustomSegments] = useState<CustomSegment[]>([]);
  const [customLoaded, setCustomLoaded] = useState(false);
  const [customError, setCustomError] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<CustomSegment | null>(null);

  const loadData = useCallback(() => {
    const params = businessType === 'All' ? {} : { businessType };

    // Fire both independently so each section renders as soon as its data arrives
    setTreeLoading(true);
    setTreeError(false);
    (getSegmentationTree(params) as Promise<SegmentTree>)
      .then(tree => setData(tree))
      .catch(err => { console.error('Failed to load segmentation tree:', err); setTreeError(true); })
      .finally(() => setTreeLoading(false));

    setGeneralLoading(true);
    (getGeneralSegment(params) as Promise<{ data?: GeneralSegmentSummary } | null>)
      .then(gen => setGeneralSeg(gen?.data || null))
      .catch(() => setGeneralSeg(null))
      .finally(() => setGeneralLoading(false));
  }, [businessType]);

  // Full recompute — re-runs ON_TRIP / FUTURE_TRAVEL / PAST_BOOKING rules against
  // today's date so contacts whose trip window just ended drop out correctly.
  // Takes 10-30s on ~1.6M contacts. Followed by MV refresh + re-fetch.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await recomputeSegmentation();
      await refreshSegmentationSnapshot();
      loadData();
    } catch (err) {
      console.error('Refresh failed:', err);
      toast.error('Couldn’t update counts');
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadCustomSegments = useCallback(async () => {
    try {
      const res = await getCustomSegments() as { data?: CustomSegment[] };
      setCustomSegments(res.data || []);
      setCustomError(false);
    } catch (err) {
      console.error('Failed to load custom segments:', err);
      setCustomError(true);
    }
    setCustomLoaded(true);
  }, []);

  useEffect(() => { loadCustomSegments(); }, [loadCustomSegments]);

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const id = deleteConfirm.id;
    setDeleteConfirm(null);
    try {
      await deleteCustomSegment(id);
      toast.success('Segment deleted');
      loadCustomSegments();
    } catch (err) {
      console.error('Failed to delete segment:', err);
      toast.error('Failed to delete segment');
    }
  };
  const cancelDelete = useCallback(() => setDeleteConfirm(null), []);

  const navigateToSegment = (combo: SegmentNav) => {
    router.push('/segmentation/' + comboToSlug(combo));
  };

  const getBreakdownForStatus = (status: string) => (data?.breakdown || []).filter(b => b.booking_status === status);

  // General breakdown — aggregate across booking statuses, grouped by (tier, geography)
  const getGeneralBreakdown = () => {
    if (!data?.breakdown) return [];
    const agg: Record<string, SegmentBreakdownRow & { revenue: number }> = {};
    for (const b of data.breakdown) {
      const key = `${b.product_tier || ''}|${b.geography || ''}`;
      const cur = agg[key] || {
        booking_status: null, product_tier: b.product_tier, geography: b.geography,
        count: 0, revenue: 0, indian_count: 0,
        total_tours: 0, total_hotels: 0, total_visas: 0, total_flights: 0,
      };
      cur.count         += +b.count         || 0;
      cur.revenue       += +b.revenue       || 0;
      cur.indian_count  += +b.indian_count  || 0;
      cur.total_tours   += +b.total_tours   || 0;
      cur.total_hotels  += +b.total_hotels  || 0;
      cur.total_visas   += +b.total_visas   || 0;
      cur.total_flights += +b.total_flights || 0;
      agg[key] = cur;
    }
    return Object.values(agg).sort((a, b) => b.count - a.count);
  };

  const comboLabel = (b: SegmentBreakdownRow) => {
    const parts = [b.booking_status ? segmentStatusMeta(b.booking_status).label : 'General'];
    if (b.product_tier) parts.push(tierLabel(b.product_tier));
    if (b.geography) parts.push(geoLabel(b.geography));
    return parts.join(' — ');
  };

  const { totals, statusCounts = [], revenueByType: acicoRevenue } = data || {};
  const toggle = (key: string) => setExpandedStatus(cur => (cur === key ? null : key));

  const barRows: SegmentBarRow[] = statusCounts.map(st => {
    const m = segmentStatusMeta(st.booking_status);
    return {
      key: st.booking_status,
      label: m.label,
      sub: STATUS_DESC[st.booking_status],
      value: Number(st.count) || 0,
      color: m.color,
      selected: expandedStatus === st.booking_status,
      onSelect: () => toggle(st.booking_status),
      figures: <><b>{fmt(st.count)}</b> <span className={s.help}>{pct(st.count, totals?.total)} · {fmtAED(st.revenue)}</span></>,
      action: st.total_bookings != null ? (
        <Button variant="ghost" size="sm" icon title="View booking breakdown" aria-label={`Booking breakdown for ${m.label}`}
          onClick={() => setBreakdownModal({ ...st, label: m.label, color: m.color })}>
          <Eye size={14} />
        </Button>
      ) : undefined,
    };
  });

  const generalRow: SegmentBarRow | null = generalSeg ? {
    key: GENERAL,
    label: 'General',
    sub: 'Cross-status broadcast',
    value: Number(generalSeg.totalContacts) || 0,
    color: 'var(--gold-ink)',
    selected: expandedStatus === GENERAL,
    onSelect: () => toggle(GENERAL),
    figures: <><b>{fmt(generalSeg.totalContacts)}</b> <span className={s.help}>{fmt(generalSeg.emailEligible)} email · {fmt(generalSeg.waEligible)} wa</span></>,
  } : null;

  const expandedRows = expandedStatus === GENERAL ? getGeneralBreakdown() : expandedStatus ? getBreakdownForStatus(expandedStatus) : [];
  const expandedTitle = expandedStatus === GENERAL ? 'General' : expandedStatus ? segmentStatusMeta(expandedStatus).label : '';

  const cq = customQuery.toLowerCase();
  const visibleCustom = customSegments.filter(seg => (seg.name ?? '').toLowerCase().includes(cq) || (seg.description || '').toLowerCase().includes(cq));

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Segments' }]}
        title="Segments"
        description="Groups of contacts you can message. Ready-made segments follow each contact's booking status; custom segments use your own rules."
        actions={
          <>
            <Button variant="ghost" onClick={() => router.push('/segment-activity')}><Activity size={16} aria-hidden="true" />Changes over time</Button>
            <Button onClick={() => router.push('/segmentation/all-segments')}><List size={16} aria-hidden="true" />All segments</Button>
            <Button variant="primary" onClick={() => setShowCreateModal(true)}><Plus size={16} aria-hidden="true" />Create segment</Button>
          </>
        }
      />

      <div className={s.statusLine}>
        {refreshing ? <StatusChip tone="info">Updating</StatusChip> : treeError ? <StatusChip tone="bad">Not loaded</StatusChip> : null}
        <span className={s.note}>
          Ready-made segments are recomputed against today&apos;s date. Updating counts re-runs every rule and takes 10–30 seconds.
        </span>
        <span className={s.spacer} />
        <Button size="sm" onClick={handleRefresh} disabled={refreshing || treeLoading}>
          <RefreshCw size={14} aria-hidden="true" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'Updating…' : 'Update counts now'}
        </Button>
      </div>

      {treeError ? (
        <div className={s.card} style={{ borderColor: 'var(--bad)' }}>
          <ErrorState
            title="Couldn't load segment counts"
            description="Segments still work in journeys and sends. Counts will appear when the service responds."
            action={<Button size="sm" variant="primary" onClick={loadData}>Try again</Button>}
          />
        </div>
      ) : (
        <>
          <div className={s.stats}>
            {treeLoading ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={s.stat}><Skeleton width={90} height={12} /><Skeleton width={130} height={24} /></div>
            )) : (
              <>
                <SegmentStat label="Total Customers" value={fmt(totals?.total)} />
                <SegmentStat label="Segmented" value={`${fmt(totals?.segmented)} (${pct(totals?.segmented, totals?.total)})`} />
                <SegmentStat label="Segments" value={totals?.segment_count ?? 0} />
                <SegmentStat label="Total Confirmed Revenue" value={fmtM(acicoRevenue?.total)} />
              </>
            )}
          </div>

          {!treeLoading && acicoRevenue?.sources && (
            <section className={s.card} aria-label="Revenue by product">
              <div className={s.cardHead}>
                <h2 className={s.cardTitle}>Revenue by product</h2>
                <span className={s.help}>All-time confirmed · cancelled bookings excluded</span>
              </div>
              <div className={s.stats}>
                {acicoRevenue.sources.map(src => (
                  <div key={src.source} className={s.tile}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{SOURCE_LABELS[src.source] || src.source}</span>
                    <span className={s.help}>{fmt(src.bookings)} bookings</span>
                    <span className={s.num} style={{ fontWeight: 700 }}>{fmtM(src.revenue)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={s.card} aria-label="Contacts by booking status">
            <div className={s.cardHead}>
              <h2 className={s.cardTitle}>Contacts by booking status</h2>
              <span className={s.help}>
                {businessType === 'All' ? 'All audiences' : businessType}
                {!treeLoading && ` · ${fmt(totals?.total)} contacts`} · bar length is to scale · click a row to see its breakdown
              </span>
            </div>
            {(treeLoading || generalLoading)
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={22} />)
              : (generalRow ? [generalRow, ...barRows] : barRows).length > 0
                ? <SegmentBars label="Contacts by booking status" rows={generalRow ? [generalRow, ...barRows] : barRows} />
                : <span className={s.note}>No booking-status counts yet.</span>}
          </section>

          {expandedStatus && (
            <section className={s.card} aria-label={`${expandedTitle} breakdown`}>
              <div className={s.cardHead}>
                <h2 className={s.cardTitle}>{expandedTitle} breakdown</h2>
                <span className={s.help}>By product tier and geography · click a row to see its contacts</span>
                <span className={s.spacer} />
                <Button variant="ghost" size="sm" icon aria-label="Close breakdown" onClick={() => setExpandedStatus(null)}><X size={16} /></Button>
              </div>
              {expandedRows.length === 0 ? <span className={s.note}>No breakdown rows for this status.</span> : (
                <Table label={`${expandedTitle} breakdown`} style={{ minWidth: 820 }}>
                  <thead>
                    <tr><th>Segment</th><th>Tags</th><th className={s.r}>Customers</th><th className={s.r}>Revenue</th><th className={s.r}>Tours</th><th className={s.r}>Hotels</th><th className={s.r}>Visas</th><th className={s.r}>Flights</th></tr>
                  </thead>
                  <tbody>
                    {expandedRows.map((b, i) => {
                      const label = comboLabel(b);
                      const go = () => navigateToSegment({ bookingStatus: expandedStatus === GENERAL ? null : b.booking_status, productTier: b.product_tier, geography: b.geography, label });
                      return (
                        <tr key={i} className={s.clickRow} onClick={go}>
                          <td><button type="button" className={s.nameBtn} onClick={e => { e.stopPropagation(); go(); }}>{label}</button></td>
                          <td>
                            <span className={s.row} style={{ gap: 4 }}>
                              {b.product_tier && <Chip tone={b.product_tier === 'LUXURY' ? 'gold' : 'mute'}>{tierLabel(b.product_tier)}</Chip>}
                              {b.geography && <Chip tone="info">{geoLabel(b.geography)}</Chip>}
                              {b.indian_count > 0 && <Chip tone="warn">{b.indian_count} Indian</Chip>}
                            </span>
                          </td>
                          <td className={`${s.r} ${s.num}`} style={{ fontWeight: 700 }}>{fmt(b.count)}</td>
                          <td className={`${s.r} ${s.num}`}>{fmtAED(b.revenue)}</td>
                          <td className={`${s.r} ${s.num}`}>{fmt(b.total_tours)}</td>
                          <td className={`${s.r} ${s.num}`}>{fmt(b.total_hotels)}</td>
                          <td className={`${s.r} ${s.num}`}>{fmt(b.total_visas)}</td>
                          <td className={`${s.r} ${s.num}`}>{fmt(b.total_flights)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </section>
          )}
        </>
      )}

      {/* Custom segments */}
      <section className={s.card} aria-label="Custom segments">
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>Custom segments</h2>
          <span className={s.help}>Your own rules · contact counts are from the last time each segment was counted</span>
          <span className={s.spacer} />
          {customSegments.length > 0 && <Button variant="ghost" size="sm" onClick={() => router.push('/segmentation/all-segments')}>View all</Button>}
        </div>
        {customError ? (
          <ErrorState title="Couldn't load custom segments" action={<Button size="sm" onClick={loadCustomSegments}>Try again</Button>} />
        ) : !customLoaded ? (
          <Skeleton height={40} />
        ) : customSegments.length === 0 ? (
          <EmptyState
            title="No custom segments yet"
            description="Ready-made segments are above. Create your own from booking status, product, location, website events or giveaways."
            action={<Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}><Plus size={14} aria-hidden="true" />Create segment</Button>}
          />
        ) : (
          <>
            <div className={s.search} style={{ position: 'relative' }}>
              <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
              <Input aria-label="Search custom segments" placeholder="Search segments" value={customQuery} onChange={e => setCustomQuery(e.target.value)} style={{ paddingLeft: 34 }} />
            </div>
            <Table label="Custom segments" style={{ minWidth: 720 }}>
              <thead>
                <tr><th>Segment</th><th>Kind</th><th className={s.r}>Contacts</th><th>Status</th><th><span className={s.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {visibleCustom.map(seg => {
                  const conds = seg.conditions || [];
                  const open = () => router.push(`/segmentation/custom/${seg.id}`);
                  return (
                    <tr key={seg.id} className={s.clickRow} onClick={open}>
                      <td style={{ maxWidth: 380 }}>
                        <button type="button" className={s.nameBtn} onClick={e => { e.stopPropagation(); open(); }}>{seg.name}</button>
                        <div className={s.help}>{conds.length} condition{conds.length !== 1 ? 's' : ''}</div>
                        <div className={s.tags}>
                          {conds.slice(0, 3).map((c, i) => <span key={i} className={s.tag}>{c.field?.replace(/_/g, ' ')}</span>)}
                          {conds.length > 3 && <span className={s.help}>+{conds.length - 3} more</span>}
                        </div>
                      </td>
                      <td><Chip tone="gold">Custom</Chip></td>
                      <td className={`${s.r} ${s.num}`} style={{ fontWeight: 600 }}>{(seg.cached_count || 0).toLocaleString()}</td>
                      <td>{seg.status === 'draft' ? <Chip tone="mute" dot>Draft</Chip> : seg.status === 'active' ? <Chip tone="ok" dot>Active</Chip> : '—'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className={s.actions}>
                          <Button variant="ghost" size="sm" icon title="Delete segment" aria-label={`Delete ${seg.name}`} onClick={() => setDeleteConfirm(seg)}>
                            <Trash2 size={14} style={{ color: 'var(--bad)' }} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleCustom.length === 0 && <tr><td colSpan={5} className={s.note}>No segments match your search.</td></tr>}
              </tbody>
            </Table>
          </>
        )}
      </section>

      {showCreateModal && (
        <CreateSegmentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { toast.success('Segment created'); loadCustomSegments(); }}
        />
      )}

      {/* Booking breakdown modal */}
      {breakdownModal && (() => {
        const m = breakdownModal;
        const bb = m.booking_breakdown || {};
        const types = BOOKING_TYPES.filter(t => Number(bb[t.key]) > 0);
        return (
          <div className={s.backdrop} onClick={e => { if (e.target === e.currentTarget) setBreakdownModal(null); }}>
            <div className={s.modal} role="dialog" aria-modal="true" aria-label={`${m.label} booking breakdown`}>
              <div className={s.modalHead}>
                <div>
                  <h2 className={s.modalTitle}>{m.label}</h2>
                  <span className={s.help}>{fmt(m.count)} customers</span>
                </div>
                <Button variant="ghost" size="sm" icon aria-label="Close" onClick={() => setBreakdownModal(null)}><X size={18} /></Button>
              </div>
              <div className={s.cols2}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className={s.eyebrow}>Booking Breakdown</span>
                  {types.map(t => {
                    const count = Number(bb[t.key]) || 0;
                    const rev = parseFloat(String(bb[`${t.key}_revenue`] ?? '')) || 0;
                    const share = (m.total_bookings ?? 0) > 0 ? (count / (m.total_bookings ?? 1)) * 100 : 0;
                    return (
                      <div key={t.key} className={s.tile}>
                        <div className={s.row} style={{ justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</span>
                          <b className={s.num}>{fmt(count)}</b>
                        </div>
                        <span className={s.barTrack} aria-hidden="true" style={{ height: 6 }}><span className={s.barFill} style={{ width: `${share}%`, background: m.color }} /></span>
                        <div className={`${s.row} ${s.help}`} style={{ justifyContent: 'space-between' }}>
                          <span>{share.toFixed(1)}%</span>
                          <span>{fmtAED(rev)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className={s.eyebrow}>Summary</span>
                  <div className={s.tile}><span className={s.help}>Total Bookings</span><span className={s.statValue}>{fmt(m.total_bookings)}</span></div>
                  <div className={s.tile}><span className={s.help}>Total Revenue</span><span className={s.statValue} style={{ fontSize: 20 }}>{fmtAED(m.revenue)}</span></div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDialog
        open={!!deleteConfirm}
        danger
        title="Delete segment?"
        confirmLabel="Delete"
        description={deleteConfirm ? (
          <p>
            <b>{deleteConfirm.name}</b>
            {deleteConfirm.description && <><br />{deleteConfirm.description}</>}
            <br />{deleteConfirm.conditions?.length || 0} condition{(deleteConfirm.conditions?.length || 0) !== 1 ? 's' : ''} · {(deleteConfirm.cached_count || 0).toLocaleString()} contacts. This can&apos;t be undone.
          </p>
        ) : undefined}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
