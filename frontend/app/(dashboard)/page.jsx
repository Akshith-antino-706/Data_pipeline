'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { getSegmentationTree, getSegmentActivity } from '@/lib/api';
import { RefreshCw, Target, TrendingUp, Users, Send, FileText, GitBranch, DollarSign, Megaphone, UserCheck, Activity, Calendar } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useBusinessType } from '@/context/BusinessTypeContext';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const STATUS_COLORS = {
  ON_TRIP: '#22c55e', FUTURE_TRAVEL: '#3b82f6', ACTIVE_ENQUIRY: '#f59e0b',
  PAST_BOOKING: '#8b5cf6', PAST_ENQUIRY: '#f97316', PROSPECT: '#64748b',
  B2B_ACTIVE_PARTNER: '#22c55e', B2B_DORMANT_PARTNER: '#f97316',
  B2B_NEW_LEAD: '#3b82f6', B2B_PROSPECT: '#64748b',
};

const STATUS_LABELS = {
  ON_TRIP: 'On Trip', FUTURE_TRAVEL: 'Future Travel', ACTIVE_ENQUIRY: 'Active Enquiry',
  PAST_BOOKING: 'Past Booking', PAST_ENQUIRY: 'Past Enquiry', PROSPECT: 'Prospect',
  B2B_ACTIVE_PARTNER: 'Active Partner', B2B_DORMANT_PARTNER: 'Dormant Partner',
  B2B_NEW_LEAD: 'New Lead', B2B_PROSPECT: 'B2B Prospect',
};

export default function Dashboard() {
  const [tree, setTree] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const { businessType } = useBusinessType();

  // const [dateFrom, setDateFrom] = useState(() => {
  //   const d = new Date(); d.setDate(d.getDate() - 30);
  //   return d.toISOString().split('T')[0];
  // });
  // const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const loadData = () => {
    setLoading(true);
    const params = {};
    if (businessType !== 'All') params.businessType = businessType;
    // if (dateFrom) params.dateFrom = dateFrom;
    // if (dateTo) params.dateTo = dateTo;
    Promise.all([
      getSegmentationTree(params).catch(() => ({})),
      getSegmentActivity({ days: 7 }).catch(() => ({})),
    ])
      .then(([t, a]) => { setTree(t); setActivity(a); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [businessType]);

  if (loading) return (
    <div style={{ padding: '0' }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 24 }}>
        <div className="skeleton" style={{ width: 160, height: 24, borderRadius: 6, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 260, height: 14, borderRadius: 6 }} />
      </div>

      {/* KPI cards skeleton */}
      <div className="card-grid card-grid-4 mb-24">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: 80, height: 28, borderRadius: 6, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 120, height: 12, borderRadius: 6 }} />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="card mb-24" style={{ padding: 20 }}>
        <div className="skeleton" style={{ width: 180, height: 18, borderRadius: 6, marginBottom: 20 }} />
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 200 }}>
          {[65, 85, 45, 90, 55, 70].map((h, i) => (
            <div key={i} className="skeleton" style={{ flex: 1, height: `${h}%`, borderRadius: '6px 6px 0 0' }} />
          ))}
        </div>
      </div>

      {/* Action cards skeleton */}
      <div className="card-grid card-grid-4 mb-24">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 8, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: 100, height: 14, borderRadius: 6, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 140, height: 12, borderRadius: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );

  const fmt = (n) => Number(n || 0).toLocaleString();
  const fmtAED = (n) => `AED ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtM = (n) => `AED ${(Number(n || 0) / 1000000).toFixed(2)}M`;

  const totals = tree?.totals || {};
  const statusCounts = tree?.statusCounts || [];
  const revenueByType = tree?.revenueByType;
  const logs = activity?.logs || [];

  // Totals from recent activity
  const totalEntered = logs.reduce((s, r) => s + (r.entered || 0), 0);
  const totalConverted = logs.reduce((s, r) => s + (r.converted || 0), 0);
  const totalReached = logs.reduce((s, r) => s + (r.total_reached || 0), 0);

  // Bar chart data
  const barData = statusCounts.map(s => ({
    name: STATUS_LABELS[s.booking_status] || s.booking_status,
    customers: s.count,
    color: STATUS_COLORS[s.booking_status] || '#64748b',
  }));

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      <motion.div variants={fadeInUp}>
        <div className="page-header">
          <div>
            <h2>Dashboard</h2>
            <div className="page-header-sub">Rayna Tours — {businessType === 'All' ? 'All' : businessType} Overview</div>
          </div>
          <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Date filter — uncomment to enable
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <Calendar size={14} style={{ color: 'var(--text-tertiary)' }} />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: 12 }}
              />
              <span style={{ color: 'var(--text-tertiary)' }}>to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: 12 }}
              />
            </div>
            */}
            <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={14} /></button>
          </div>
        </div>
      </motion.div>

      {/* KPIs */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-4 mb-24">
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><Users size={18} color="var(--blue)" /></div>
          <div className="kpi-value kpi-blue">{fmt(totals.total)}</div>
          <div className="kpi-label">Total {businessType === 'All' ? '' : businessType + ' '}Customers</div>
        </Link>
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><Target size={18} color="var(--green)" /></div>
          <div className="kpi-value kpi-green">{totals.segment_count || 0}</div>
          <div className="kpi-label">Active Segments</div>
        </Link>
        <Link href="/segment-activity" className="card kpi no-underline color-inherit">
          <div className="icon-box"><TrendingUp size={18} color="var(--purple)" /></div>
          <div className="kpi-value kpi-purple">{fmt(totalConverted)}</div>
          <div className="kpi-label">Conversions (7d)</div>
        </Link>
        <Link href="/campaigns" className="card kpi no-underline color-inherit">
          <div className="icon-box"><DollarSign size={18} color="var(--orange)" /></div>
          <div className="kpi-value kpi-orange">{fmtM(revenueByType?.total)}</div>
          <div className="kpi-label">Total Confirmed Revenue</div>
        </Link>
      </motion.div>

      {/* Segment Distribution Chart */}
      {barData.length > 0 && (
        <motion.div variants={fadeInUp}>
          <div className="card mb-24">
            <div className="card-header">
              <h3>Segment Distribution</h3>
              <Link href="/segmentation" className="btn btn-sm btn-ghost">View Details</Link>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData}>
                <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => fmt(v)}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }}
                />
                <Bar dataKey="customers" name="Customers" radius={[6, 6, 0, 0]}>
                  {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* Quick Actions */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-4 mb-24">
        <Link href="/contacts" className="card action-card">
          <UserCheck size={24} color="var(--blue)" className="mb-8" />
          <div className="action-title">Contacts</div>
          <div className="action-desc">Unified customer database</div>
        </Link>
        <Link href="/campaigns" className="card action-card">
          <Megaphone size={24} color="var(--green)" className="mb-8" />
          <div className="action-title">Campaigns</div>
          <div className="action-desc">Execute & Track</div>
        </Link>
        <Link href="/journeys" className="card action-card">
          <GitBranch size={24} color="var(--purple)" className="mb-8" />
          <div className="action-title">Journeys</div>
          <div className="action-desc">Flow Builder</div>
        </Link>
        <Link href="/segment-activity" className="card action-card">
          <Activity size={24} color="var(--orange)" className="mb-8" />
          <div className="action-title">Segment Activity</div>
          <div className="action-desc">Daily entries, exits & reach</div>
        </Link>
      </motion.div>

      {/* Recent Activity Summary */}
      {logs.length > 0 && (
        <motion.div variants={fadeInUp}>
          <div className="card mb-24">
            <div className="card-header">
              <h3>Last 7 Days Activity</h3>
              <Link href="/segment-activity" className="btn btn-sm btn-ghost">View All</Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '0 4px' }}>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#22c55e' }}>{fmt(totalEntered)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Entered Segments</div>
              </div>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#8b5cf6' }}>{fmt(totalConverted)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Converted</div>
              </div>
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>{fmt(totalReached)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Messages Sent</div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Segment Revenue Breakdown */}
      {statusCounts.length > 0 && (
        <motion.div variants={fadeInUp}>
          <div className="card">
            <div className="card-header">
              <h3>Revenue by Segment</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Segment</th><th style={{ textAlign: 'right' }}>Customers</th><th style={{ textAlign: 'right' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {statusCounts.map((s) => (
                    <tr key={s.booking_status}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLORS[s.booking_status] || '#64748b' }} />
                          {STATUS_LABELS[s.booking_status] || s.booking_status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(s.count)}</td>
                      <td style={{ textAlign: 'right', color: '#f59e0b' }}>{fmtAED(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {!tree?.totals && (
        <motion.div variants={fadeInUp}>
          <div className="card empty">
            <h3 className="mb-8">No Data Available</h3>
            <p className="text-secondary mb-20">Run the unified sync to populate segmentation data.</p>
            <Link href="/segmentation" className="btn btn-primary">Go to Segmentation</Link>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
