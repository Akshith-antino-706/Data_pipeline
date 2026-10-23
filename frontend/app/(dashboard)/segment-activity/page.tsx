'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSegmentActivity, snapshotDailySegments, downloadSegmentActivity, getSegmentChanges } from '@/lib/api';
import { comboToSlug } from '@/lib/segmentSlug';
import type { BookingStatus } from '@/lib/segmentSlug';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, TrendingUp, TrendingDown, ArrowRightLeft, Mail, MessageCircle, Bell,
  RefreshCw, Loader2, Calendar, DollarSign, Filter, Download, Eye, X,
  ChevronLeft, ChevronRight, Phone, Search, Globe, Building2, Hash, MapPin,
  Clock, Palmtree, Hotel, FileText, Plane, ChevronDown, ChevronUp, Layers,
} from 'lucide-react';
import type { QueryParams } from '@/types/api';
import { PageHeader, Button, Select, Table, EmptyState, Skeleton } from '@/components/ui';
import { SegmentStat } from '@/components/ui/SegmentStat';
import { SegmentBars, type SegmentBarRow } from '@/components/ui/SegmentBars';
import { segmentStatusMeta, SEGMENT_STATUS } from '@/components/ui/SegmentStatus';
import s from '@/components/ui/Segment.module.css';

interface SegmentLogRow { log_date?: string; segment_label: string; total_count?: number; entered: number; exited: number; converted: number; emails_sent?: number; whatsapp_sent?: number; push_sent?: number; total_reached?: number; journey_active?: number; revenue?: number | string }
interface LiveSegment { segment_label: string; total_count?: number; revenue?: string | number }
interface SegmentActivityData { liveToday?: LiveSegment[]; logs?: SegmentLogRow[] }
interface SegmentChange { segment: string; before?: number; after?: number; change: number }
interface SegmentChangesData { changes?: SegmentChange[]; before?: { date?: string }; after?: { date?: string } }

const fmt = (n: number | undefined) => (n || 0).toLocaleString();
const fmtAED = (n: number | string | undefined) => `AED ${(Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// Segment filter options come from the shared status map so nothing is missing (e.g. enquiry statuses).
const STATUS_OPTIONS = Object.entries(SEGMENT_STATUS).map(([key, m]) => ({ key, label: m.label }));

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
  const router = useRouter();
  // Clicking a segment opens its contacts page (the old inline panel was never rendered).
  const openSegment = (segmentLabel: string) => router.push('/segmentation/' + comboToSlug({ bookingStatus: segmentLabel as BookingStatus }));

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
      params.fresh = 1; // the log is cached 30 min server-side; Refresh must re-read it
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

  const [changes, setChanges] = useState<SegmentChangesData | null>(null);

  useEffect(() => {
    getSegmentChanges().then(setChanges as (v: unknown) => void).catch(console.error);
  }, []);

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
      onSelect: () => openSegment(seg.segment_label),
      figures: <><b>{fmt(seg.total_count)}</b> <span className={s.help}>{fmtAED(seg.revenue)}</span></>,
    };
  });
  const periodLabel = days === 1 ? 'last 24 hours' : `last ${days} days`;

  return (
    <div className={s.page}>
      <PageHeader
        breadcrumbs={[{ label: 'Audience' }, { label: 'Segments', href: '/segmentation' }, { label: 'Changes over time' }]}
        title="Segment activity"
        description="Daily segment entries, exits, conversions and reach. Click a segment to open its contacts."
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
          {STATUS_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
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
          <span className={s.help}>Today · bar length is to scale · click a segment to open its contacts</span>
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
        </div>
        {logLoading ? (
          <div aria-label="Refreshing daily log" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={18} />)}</div>
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
                  <tr key={`${date}-${row.segment_label}`} className={s.clickRow} onClick={() => openSegment(row.segment_label)}>
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
    </div>
  );
}
