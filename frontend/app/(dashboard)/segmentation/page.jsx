'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { getSegmentationTree, recomputeSegmentation, refreshSegmentationSnapshot, getGeneralSegment, getUnifiedContact, getCustomSegments, deleteCustomSegment } from '@/lib/api';
import CreateSegmentModal from './CreateSegmentModal';
import { comboToSlug } from '@/lib/segmentSlug';
import { useBusinessType } from '@/context/BusinessTypeContext';
import {
  Users, Plane, Hotel, Map, Ticket, Search, X,
  Loader2, Globe, MapPin, MessageCircle, DollarSign, Eye, RefreshCw, Plus, Filter, Trash2, List, AlertTriangle,
  Clock, TrendingUp, Phone, Mail, Send, Package, ShieldCheck, MoreHorizontal,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

/* ── Skeleton primitives ─────────────────────────────── */
const shimmer = {
  background: 'linear-gradient(90deg, var(--secondary) 25%, var(--border) 50%, var(--secondary) 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s infinite',
};

function SkeletonBox({ width, height = 20, borderRadius = 'var(--radius)', style = {} }) {
  return <div style={{ width, height, borderRadius, ...shimmer, ...style }} />;
}


const fmt = (n) => (n || 0).toLocaleString();
const fmtAED = (n) => `AED ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtM = (n) => `AED ${(Number(n || 0) / 1000000).toFixed(2)}M`;
const pct = (n, total) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%';
const fmtK = (n) => { const v = Number(n || 0); return v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(0); };

const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const today = new Date();
const onTripFrom = new Date(); onTripFrom.setDate(today.getDate() - 7);

const STATUS_CONFIG = {
  ON_TRIP:         { label: 'On Trip',         color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  icon: Plane,       desc: `${fmtDate(onTripFrom)} — ${fmtDate(today)}` },
  FUTURE_TRAVEL:   { label: 'Future Travel',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', icon: Clock,       desc: `After ${fmtDate(today)}` },
  ACTIVE_ENQUIRY:  { label: 'Active Enquiry',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: MessageCircle, desc: 'Enquired in last 30 days' },
  PAST_BOOKING:    { label: 'Past Booking',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: Ticket,      desc: `Before ${fmtDate(onTripFrom)}` },
  PAST_ENQUIRY:    { label: 'Past Enquiry',    color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: Search,      desc: 'Enquired 30+ days ago, not booked' },
  PROSPECT:        { label: 'Prospect',        color: '#64748b', bg: 'rgba(100,116,139,0.12)',icon: Users,       desc: 'Never engaged' },
};

const TIER_COLORS = { LUXURY: '#e2b340', STANDARD: '#94a3b8' };
const GEO_COLORS = { LOCAL: '#06b6d4', INTERNATIONAL: '#a78bfa' };

const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#f97316', '#64748b', '#06b6d4', '#e2b340'];

export default function CustomerSegmentation() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [generalLoading, setGeneralLoading] = useState(true);
  const [expandedStatus, setExpandedStatus] = useState(null);
  const [breakdownModal, setBreakdownModal] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [expandedBookingType, setExpandedBookingType] = useState(null);
  const { businessType } = useBusinessType();

  const [refreshing, setRefreshing] = useState(false);
  const [generalSeg, setGeneralSeg] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customSegments, setCustomSegments] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const loadData = useCallback(() => {
    const params = businessType === 'All' ? {} : { businessType };

    // Fire both independently so each section renders as soon as its data arrives
    setTreeLoading(true);
    getSegmentationTree(params)
      .then(tree => setData(tree))
      .catch(err => console.error('Failed to load segmentation tree:', err))
      .finally(() => setTreeLoading(false));

    setGeneralLoading(true);
    getGeneralSegment(params)
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
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadCustomSegments = useCallback(async () => {
    try {
      const res = await getCustomSegments();
      setCustomSegments(res.data || []);
    } catch (err) { console.error('Failed to load custom segments:', err); }
  }, []);

  useEffect(() => { loadCustomSegments(); }, [loadCustomSegments]);

  const handleDeleteClick = (seg, e) => {
    e.stopPropagation();
    setDeleteConfirm(seg);
  };

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

  const navigateToSegment = (combo) => {
    router.push('/segmentation/' + comboToSlug(combo));
  };

  const openUserDetail = async (contactId) => {
    setUserDetailLoading(true);
    setExpandedBookingType(null);
    try {
      const res = await getUnifiedContact(contactId);
      const d = res.data;
      // Filter bookings based on the current status context
      const statusCtx = null;
      if (statusCtx === 'ON_TRIP' || statusCtx === 'FUTURE_TRAVEL') {
        const now = new Date(); now.setHours(0,0,0,0);
        const filterFn = statusCtx === 'ON_TRIP'
          ? (b) => { const td = b.travel_date ? new Date(b.travel_date) : null; if (!td) return false; td.setHours(0,0,0,0); const diff = (now - td) / 86400000; return diff >= 0 && diff <= 7; }
          : (b) => { const td = b.travel_date ? new Date(b.travel_date) : null; if (!td) return false; td.setHours(0,0,0,0); return td > now; };
        const keys = ['rayna_tours','rayna_packages','rayna_hotels','rayna_visas','rayna_others','rayna_flights'];
        const countKeys = ['total_tour_bookings','total_package_bookings','total_hotel_bookings','total_visa_bookings','total_other_bookings','total_flight_bookings'];
        keys.forEach((k, i) => { d[k] = (d[k] || []).filter(filterFn); d[countKeys[i]] = d[k].length; });
        d.total_booking_revenue = keys.flatMap(k => d[k] || []).filter(b => b.is_cancel !== '1').reduce((s, b) => s + (parseFloat(b.selling_price) || 0), 0);
      }
      setUserDetail(d);
    } catch (err) { console.error('Failed to load user detail:', err); }
    setUserDetailLoading(false);
  };

  // Build breakdown for a specific status
  const getBreakdownForStatus = (status) => {
    if (!data?.breakdown) return [];
    return data.breakdown.filter(b => b.booking_status === status);
  };

  // Build General breakdown \u2014 aggregate across booking statuses, grouped by (tier, geography)
  const getGeneralBreakdown = () => {
    if (!data?.breakdown) return [];
    const agg = {};
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

  const comboLabel = (b) => {
    const parts = [b.booking_status ? (STATUS_CONFIG[b.booking_status]?.label || b.booking_status) : 'General'];
    if (b.product_tier) parts.push(b.product_tier === 'LUXURY' ? 'Luxury' : 'Standard');
    if (b.geography) parts.push(b.geography === 'LOCAL' ? 'Local' : 'International');
    return parts.join(' \u2014 ');
  };

  const { totals, statusCounts = [], breakdown, revenueByType: acicoRevenue } = data || {};
  const pieData = statusCounts.map(s => ({ name: STATUS_CONFIG[s.booking_status]?.label || s.booking_status, value: s.count }));

  return (
    <div style={{ padding: '28px 32px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Customer Segmentation</h1>
            <p style={{ color: 'var(--muted-foreground)', fontSize: 13, marginTop: 4 }}>
              3-step decision tree: Booking Status &rarr; Product Tier &rarr; Geography
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/segmentation/all-segments')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <List size={14} />
              All Segments
            </button>
            <button onClick={() => setShowCreateModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <Plus size={14} />
              Create Segment
            </button>
            <button onClick={handleRefresh} disabled={refreshing || treeLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: 'none', borderRadius: 'var(--radius)', cursor: (refreshing || treeLoading) ? 'wait' : 'pointer', opacity: (refreshing || treeLoading) ? 0.7 : 1, fontSize: 13, fontWeight: 500 }}>
              <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              {refreshing ? 'Recomputing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Top KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          {treeLoading ? Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '20px 24px' }}>
              <SkeletonBox width={90} height={10} style={{ marginBottom: 10 }} />
              <SkeletonBox width={130} height={24} />
            </div>
          )) : [
            { label: 'Total Customers', value: fmt(totals?.total), icon: Users },
            { label: 'Segmented', value: `${fmt(totals?.segmented)} (${pct(totals?.segmented, totals?.total)})`, icon: TrendingUp },
            { label: 'Segments', value: totals?.segment_count, icon: Map },
            { label: 'Total Confirmed Revenue', value: fmtM(acicoRevenue?.total), icon: DollarSign },
          ].map((kpi, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.35 }}
              style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <kpi.icon size={16} style={{ color: 'var(--muted-foreground)' }} />
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>{kpi.label}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.value}</div>
            </motion.div>
          ))}
        </div>

        {/* ACICO Revenue Breakdown */}
        {treeLoading ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '16px 20px', marginBottom: 32 }}>
            <SkeletonBox width={340} height={10} style={{ marginBottom: 14 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <SkeletonBox width={32} height={32} borderRadius="var(--radius)" />
                  <div>
                    <SkeletonBox width={50} height={12} style={{ marginBottom: 5 }} />
                    <SkeletonBox width={80} height={10} style={{ marginBottom: 5 }} />
                    <SkeletonBox width={70} height={13} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : acicoRevenue?.sources && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
            style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '16px 20px', marginBottom: 32 }}>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500, marginBottom: 12 }}>
              Revenue Breakdown — All-Time Confirmed (Cancelled Excluded)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {acicoRevenue.sources.map((s) => {
                const icons = { tours: Plane, hotels: Hotel, visas: Globe, flights: Ticket };
                const labels = { tours: 'Tours', hotels: 'Hotels', visas: 'Visas', flights: 'Flights' };
                const colors = { tours: '#22c55e', hotels: '#3b82f6', visas: '#f59e0b', flights: '#8b5cf6' };
                const Icon = icons[s.source] || DollarSign;
                return (
                  <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 'var(--radius)', background: `${colors[s.source]}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={16} style={{ color: colors[s.source] }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{labels[s.source] || s.source}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{fmt(s.bookings)} bookings</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: colors[s.source] }}>{fmtM(s.revenue)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Step 1: Booking Status cards */}
        <div style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', marginBottom: 16 }}>
            Step 1 &mdash; Booking Status
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 32 }}>
          {/* General card — independent from tree data */}
          {generalLoading ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <SkeletonBox width={36} height={36} borderRadius="var(--radius)" />
                <div><SkeletonBox width={80} height={13} style={{ marginBottom: 6 }} /><SkeletonBox width={120} height={10} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <SkeletonBox width={80} height={28} /><SkeletonBox width={130} height={11} />
              </div>
            </div>
          ) : generalSeg && (() => {
            const isExpanded = expandedStatus === '__general__';
            return (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
                onClick={() => setExpandedStatus(isExpanded ? null : '__general__')}
                style={{
                  background: 'var(--card)', border: `1px solid ${isExpanded ? '#e2b340' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-xl)', padding: '18px 20px', cursor: 'pointer',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxShadow: isExpanded ? '0 0 0 1px rgba(226,179,64,0.4)' : 'none',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'rgba(226,179,64,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Send size={18} style={{ color: '#e2b340' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>General</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Cross-status broadcast</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: '#e2b340' }}>{fmt(generalSeg.totalContacts)}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{fmt(generalSeg.emailEligible)} email &middot; {fmt(generalSeg.waEligible)} wa</span>
                </div>
              </motion.div>
            );
          })()}

          {/* Status cards — skeleton until tree data arrives */}
          {treeLoading ? Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <SkeletonBox width={36} height={36} borderRadius="var(--radius)" />
                <div><SkeletonBox width={90} height={13} style={{ marginBottom: 6 }} /><SkeletonBox width={130} height={10} /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <SkeletonBox width={80} height={28} /><SkeletonBox width={120} height={11} />
              </div>
            </div>
          )) : statusCounts.map((s, i) => {
            const cfg = STATUS_CONFIG[s.booking_status] || { label: s.booking_status, color: '#64748b', bg: 'rgba(100,116,139,0.12)', icon: Users };
            const Icon = cfg.icon;
            const isExpanded = expandedStatus === s.booking_status;
            return (
              <motion.div key={s.booking_status} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.35 }}
                onClick={() => setExpandedStatus(isExpanded ? null : s.booking_status)}
                style={{
                  background: 'var(--card)', border: `1px solid ${isExpanded ? cfg.color : 'var(--border)'}`,
                  borderRadius: 'var(--radius-xl)', padding: '18px 20px', cursor: 'pointer',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  boxShadow: isExpanded ? `0 0 0 1px ${cfg.color}40` : 'none',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} style={{ color: cfg.color }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{cfg.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{cfg.desc}</div>
                  </div>
                  {s.total_bookings != null && (
                    <div
                      onClick={(e) => { e.stopPropagation(); setBreakdownModal({ ...s, color: cfg.color, bg: cfg.bg, label: cfg.label }); }}
                      style={{
                        width: 28, height: 28, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--background)', border: '1px solid var(--border)',
                        cursor: 'pointer', transition: 'background 0.2s',
                      }}
                      title="View booking breakdown"
                    >
                      <Eye size={14} style={{ color: 'var(--muted-foreground)' }} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color: cfg.color }}>{fmt(s.count)}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{pct(s.count, totals?.total)} &middot; {fmtAED(s.revenue)}</span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Step 2+3: Breakdown for expanded status */}
        <AnimatePresence>
          {expandedStatus === '__general__' && (
            <motion.div key="general-expanded" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              style={{ marginBottom: 32, overflow: 'hidden' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', marginBottom: 16 }}>
                Step 2+3 &mdash; General Breakdown
              </h2>
              <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {getGeneralBreakdown().map((b, i) => {
                  const label = comboLabel(b);
                  const isSelected = false;
                  const tierColor = TIER_COLORS[b.product_tier] || '#94a3b8';
                  const geoColor = GEO_COLORS[b.geography] || '#94a3b8';
                  return (
                    <motion.div key={i} variants={fadeInUp}
                      onClick={() => navigateToSegment({ bookingStatus: null, productTier: b.product_tier, geography: b.geography, label })}
                      style={{
                        background: 'var(--card)', border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-xl)', padding: '18px 20px', cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: isSelected ? '0 0 0 1px var(--primary)' : 'none',
                      }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{label}</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        {b.product_tier && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: b.product_tier === 'LUXURY' ? 'rgba(226,179,64,0.15)' : 'rgba(148,163,184,0.15)', color: tierColor, fontWeight: 500 }}>
                            {b.product_tier === 'LUXURY' ? 'Luxury' : 'Standard'}
                          </span>
                        )}
                        {b.geography && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: b.geography === 'LOCAL' ? 'rgba(6,182,212,0.15)' : 'rgba(167,139,250,0.15)', color: geoColor, fontWeight: 500 }}>
                            {b.geography === 'LOCAL' ? 'Local' : 'International'}
                          </span>
                        )}
                        {b.indian_count > 0 && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 500 }}>
                            {b.indian_count} Indian
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div><span style={{ color: 'var(--muted-foreground)' }}>Customers</span><div style={{ fontWeight: 700, fontSize: 18 }}>{fmt(b.count)}</div></div>
                        <div><span style={{ color: 'var(--muted-foreground)' }}>Revenue</span><div style={{ fontWeight: 600, fontSize: 13 }}>{fmtAED(b.revenue)}</div></div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 12, fontSize: 11, color: 'var(--muted-foreground)' }}>
                        <div title="Tours"><Plane size={12} style={{ marginRight: 2 }} />{fmt(b.total_tours)}</div>
                        <div title="Hotels"><Hotel size={12} style={{ marginRight: 2 }} />{fmt(b.total_hotels)}</div>
                        <div title="Visas"><Ticket size={12} style={{ marginRight: 2 }} />{fmt(b.total_visas)}</div>
                        <div title="Flights"><Globe size={12} style={{ marginRight: 2 }} />{fmt(b.total_flights)}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
          {expandedStatus && expandedStatus !== '__general__' && (
            <motion.div key={`status-${expandedStatus}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              style={{ marginBottom: 32, overflow: 'hidden' }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', marginBottom: 16 }}>
                Step 2+3 &mdash; {STATUS_CONFIG[expandedStatus]?.label} Breakdown
              </h2>
              <motion.div variants={staggerContainer} initial="hidden" animate="visible"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {getBreakdownForStatus(expandedStatus).map((b, i) => {
                  const label = comboLabel(b);
                  const isSelected = false;
                  const tierColor = TIER_COLORS[b.product_tier] || '#94a3b8';
                  const geoColor = GEO_COLORS[b.geography] || '#94a3b8';
                  return (
                    <motion.div key={i} variants={fadeInUp}
                      onClick={() => navigateToSegment({ bookingStatus: b.booking_status, productTier: b.product_tier, geography: b.geography, label })}
                      style={{
                        background: 'var(--card)', border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-xl)', padding: '18px 20px', cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: isSelected ? '0 0 0 1px var(--primary)' : 'none',
                      }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{label}</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        {b.product_tier && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: b.product_tier === 'LUXURY' ? 'rgba(226,179,64,0.15)' : 'rgba(148,163,184,0.15)', color: tierColor, fontWeight: 500 }}>
                            {b.product_tier === 'LUXURY' ? 'Luxury' : 'Standard'}
                          </span>
                        )}
                        {b.geography && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: b.geography === 'LOCAL' ? 'rgba(6,182,212,0.15)' : 'rgba(167,139,250,0.15)', color: geoColor, fontWeight: 500 }}>
                            {b.geography === 'LOCAL' ? 'Local' : 'International'}
                          </span>
                        )}
                        {b.indian_count > 0 && (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 500 }}>
                            {b.indian_count} Indian
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div><span style={{ color: 'var(--muted-foreground)' }}>Customers</span><div style={{ fontWeight: 700, fontSize: 18 }}>{fmt(b.count)}</div></div>
                        <div><span style={{ color: 'var(--muted-foreground)' }}>Revenue</span><div style={{ fontWeight: 600, fontSize: 13 }}>{fmtAED(b.revenue)}</div></div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 12, fontSize: 11, color: 'var(--muted-foreground)' }}>
                        <div title="Tours"><Plane size={12} style={{ marginRight: 2 }} />{fmt(b.total_tours)}</div>
                        <div title="Hotels"><Hotel size={12} style={{ marginRight: 2 }} />{fmt(b.total_hotels)}</div>
                        <div title="Visas"><Ticket size={12} style={{ marginRight: 2 }} />{fmt(b.total_visas)}</div>
                        <div title="Flights"><Globe size={12} style={{ marginRight: 2 }} />{fmt(b.total_flights)}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status Distribution Chart */}
        {!expandedStatus && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Status Distribution</h3>
            <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
              <div style={{ width: 200, height: 200 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                {statusCounts.map((s, i) => {
                  const cfg = STATUS_CONFIG[s.booking_status];
                  return (
                    <div key={s.booking_status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i] }} />
                      <span style={{ fontSize: 13 }}>{cfg?.label || s.booking_status}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 13 }}>{fmt(s.count)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      {/* Custom Segments */}
        {customSegments.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)', margin: 0 }}>
                Custom Segments
              </h2>
              <button onClick={() => router.push('/segmentation/all-segments')}
                style={{ fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                View All →
              </button>
            </div>
            <motion.div variants={staggerContainer} initial="hidden" animate="visible"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {customSegments.map(seg => (
                <motion.div key={seg.id} variants={fadeInUp}
                  onClick={() => router.push(`/segmentation/custom/${seg.id}`)}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-xl)', padding: '18px 20px',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: `${seg.color || '#3b82f6'}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Filter size={18} style={{ color: seg.color || '#3b82f6' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{seg.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
                        {seg.conditions?.length || 0} condition{(seg.conditions?.length || 0) !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <button onClick={(e) => handleDeleteClick(seg, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}
                      title="Delete segment">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: seg.color || '#3b82f6' }}>
                      {(seg.cached_count || 0).toLocaleString()}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>contacts</span>
                  </div>
                  {/* Condition tags */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
                    {(seg.conditions || []).slice(0, 3).map((c, i) => (
                      <span key={i} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--secondary)', color: 'var(--muted-foreground)' }}>
                        {c.field?.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {(seg.conditions || []).length > 3 && (
                      <span style={{ fontSize: 10, padding: '2px 6px', color: 'var(--muted-foreground)' }}>
                        +{seg.conditions.length - 3} more
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        )}

      {/* Create Segment Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateSegmentModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => { toast.success('Segment created'); loadCustomSegments(); }}
          />
        )}
      </AnimatePresence>

      {/* Booking Breakdown Modal */}
      <AnimatePresence>
        {breakdownModal && (() => {
          const m = breakdownModal;
          const bb = m.booking_breakdown || {};
          const types = [
            { key: 'tours', label: 'Tours', icon: Plane },
            { key: 'packages', label: 'Packages', icon: Package },
            { key: 'hotels', label: 'Hotels', icon: Hotel },
            { key: 'visas', label: 'Visas', icon: ShieldCheck },
            { key: 'others', label: 'Others', icon: MoreHorizontal },
          ].filter(t => bb[t.key] > 0);
          return (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setBreakdownModal(null)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'var(--card)', borderRadius: 'var(--radius-xl)', padding: '24px 28px',
                  width: 720, maxWidth: '92vw', border: `1px solid ${m.color}40`,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(() => { const Ic = STATUS_CONFIG[m.booking_status]?.icon || Users; return <Ic size={18} style={{ color: m.color }} />; })()}
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{m.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{fmt(m.count)} customers</div>
                    </div>
                  </div>
                  <button onClick={() => setBreakdownModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', padding: 4 }}>
                    <X size={18} />
                  </button>
                </div>

                {/* Two-column layout */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Left — Booking type breakdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 2 }}>Booking Breakdown</div>
                    {types.map(t => {
                      const count = bb[t.key] || 0;
                      const rev = parseFloat(bb[`${t.key}_revenue`]) || 0;
                      const pctOfTotal = m.total_bookings > 0 ? (count / m.total_bookings * 100) : 0;
                      return (
                        <div key={t.key} style={{ padding: '10px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <t.icon size={14} style={{ color: m.color }} />
                              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: m.color }}>{fmt(count)}</span>
                          </div>
                          <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 4 }}>
                            <div style={{ width: `${pctOfTotal}%`, height: '100%', background: m.color, borderRadius: 2, transition: 'width 0.3s' }} />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted-foreground)' }}>
                            <span>{pctOfTotal.toFixed(1)}%</span>
                            <span>{fmtAED(rev)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Right — Totals */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 2 }}>Summary</div>
                    <div style={{ padding: '16px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Bookings</div>
                      <div style={{ fontSize: 28, fontWeight: 700, color: m.color }}>{fmt(m.total_bookings)}</div>
                    </div>
                    <div style={{ padding: '16px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 4 }}>Total Revenue</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{fmtAED(m.revenue)}</div>
                    </div>
                    {/* Per-type summary list */}
                    <div style={{ padding: '12px 14px', background: 'var(--background)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 10 }}>By Type</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {types.map(t => {
                          const count = bb[t.key] || 0;
                          const rev = parseFloat(bb[`${t.key}_revenue`]) || 0;
                          return (
                            <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <t.icon size={12} style={{ color: m.color }} />
                                <span style={{ fontWeight: 500 }}>{t.label}</span>
                              </div>
                              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                <span style={{ fontWeight: 600 }}>{fmt(count)}</span>
                                <span style={{ color: 'var(--muted-foreground)', fontSize: 11, minWidth: 80, textAlign: 'right' }}>{fmtAED(rev)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* User Detail Modal */}
      <AnimatePresence>
        {(userDetail || userDetailLoading) && (() => {
          const u = userDetail;
          const BOOKING_TYPES = [
            { key: 'rayna_tours', label: 'Tours', countKey: 'total_tour_bookings', icon: Plane, color: '#22c55e' },
            { key: 'rayna_packages', label: 'Packages', countKey: 'total_package_bookings', icon: Package, color: '#3b82f6' },
            { key: 'rayna_hotels', label: 'Hotels', countKey: 'total_hotel_bookings', icon: Hotel, color: '#8b5cf6' },
            { key: 'rayna_visas', label: 'Visas', countKey: 'total_visa_bookings', icon: ShieldCheck, color: '#f59e0b' },
            { key: 'rayna_others', label: 'Others', countKey: 'total_other_bookings', icon: MoreHorizontal, color: '#64748b' },
            { key: 'rayna_flights', label: 'Flights', countKey: 'total_flight_bookings', icon: Globe, color: '#06b6d4' },
          ];
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
                      {/* Left — Booking type breakdown (expandable) */}
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

                              {/* Expanded bookings list */}
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
                        {/* Per-type summary */}
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setDeleteConfirm(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--card)', borderRadius: 'var(--radius-xl)', padding: '28px 32px',
                width: 420, maxWidth: '90vw', border: '1px solid var(--border)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} style={{ color: '#ef4444' }} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Delete Segment</div>
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>This action cannot be undone</div>
                </div>
              </div>
              <div style={{ padding: '14px 16px', background: 'var(--secondary)', borderRadius: 'var(--radius)', marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{deleteConfirm.name}</div>
                {deleteConfirm.description && (
                  <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>{deleteConfirm.description}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 6 }}>
                  {deleteConfirm.conditions?.length || 0} condition{(deleteConfirm.conditions?.length || 0) !== 1 ? 's' : ''} · {(deleteConfirm.cached_count || 0).toLocaleString()} contacts
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setDeleteConfirm(null)}
                  style={{ padding: '8px 20px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--foreground)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={confirmDelete}
                  style={{ padding: '8px 20px', borderRadius: 'var(--radius)', border: 'none', background: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
