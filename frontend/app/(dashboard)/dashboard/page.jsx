'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getSegmentationTree, getSegmentActivity, getCampaigns, getJourneys, getUnifiedStats } from '@/lib/api';
import { RefreshCw, Target, TrendingUp, Users, GitBranch, DollarSign, Megaphone, UserCheck, Activity, Mail, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
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
  const [treeLoading, setTreeLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const { businessType } = useBusinessType();

  // ── email schedule summary ─────────────────────────────────────────
  const [quickStats, setQuickStats] = useState({ contacts: null, campaigns: null, journeys: null, conversations: null });

  useEffect(() => {
    const btParam = businessType === 'All' ? {} : { businessType };
    Promise.allSettled([
      getUnifiedStats(btParam),
      getCampaigns({ limit: 1 }),
      getJourneys({ limit: 1 }),
    ]).then(([contacts, campaigns, journeys]) => {
      setQuickStats({
        contacts:      contacts.status  === 'fulfilled' ? contacts.value?.data?.total_contacts   ?? null : null,
        conversations: contacts.status  === 'fulfilled' ? contacts.value?.data?.conversations_7d ?? null : null,
        campaigns:     campaigns.status === 'fulfilled' ? campaigns.value?.total ?? null : null,
        journeys:      journeys.status  === 'fulfilled' ? journeys.value?.total  ?? null : null,
      });
    });
  }, [businessType]);

  const [schedSummary, setSchedSummary] = useState({ running: 0, total: 0, lastSentDay: null, lastSentAt: null });
  useEffect(() => {
    fetch(`${API_BASE}/api/v3/test-sends/schedule/list`)
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d?.data) ? d.data : [];
        const running = list.filter(s => s.is_running);
        const last = list.find(s => s.last_sent_at);
        setSchedSummary({
          running:     running.length,
          total:       list.length,
          lastSentDay: last?.last_sent_day ?? null,
          lastSentAt:  last?.last_sent_at  ?? null,
        });
      })
      .catch(() => {});
  }, []);

  const loadData = () => {
    const params = {};
    if (businessType !== 'All') params.businessType = businessType;

    setTreeLoading(true);
    getSegmentationTree(params)
      .catch(() => ({}))
      .then(t => setTree(t))
      .finally(() => setTreeLoading(false));

    setActivityLoading(true);
    getSegmentActivity({ days: 7 })
      .catch(() => ({}))
      .then(a => setActivity(a))
      .finally(() => setActivityLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [businessType]);

  const fmt = (n) => Number(n || 0).toLocaleString();
  const fmtAED = (n) => `AED ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtM = (n) => `AED ${(Number(n || 0) / 1000000).toFixed(2)}M`;

  const totals = tree?.totals || {};
  const statusCounts = tree?.statusCounts || [];
  const revenueByType = tree?.revenueByType;
  const logs = activity?.logs || [];

  const totalEntered = logs.reduce((s, r) => s + (r.entered || 0), 0);
  const totalConverted = logs.reduce((s, r) => s + (r.converted || 0), 0);
  const totalReached = logs.reduce((s, r) => s + (r.total_reached || 0), 0);

  const barData = statusCounts.map(s => ({
    name: STATUS_LABELS[s.booking_status] || s.booking_status,
    customers: s.count,
    color: STATUS_COLORS[s.booking_status] || '#64748b',
  }));

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* Header */}
      <motion.div variants={fadeInUp}>
        <div className="page-header">
          <div>
            <h2>Dashboard</h2>
            <div className="page-header-sub">Rayna Tours — {businessType === 'All' ? 'All' : businessType} Overview</div>
          </div>
          <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-secondary"
              onClick={loadData}
              disabled={treeLoading || activityLoading}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* KPIs */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-4 mb-24">
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><Users size={18} color="var(--blue)" /></div>
          {treeLoading
            ? <div className="skeleton" style={{ width: 80, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-blue">{fmt(totals.total)}</div>
          }
          <div className="kpi-label">Total {businessType === 'All' ? '' : businessType + ' '}Customers</div>
        </Link>
        <Link href="/segmentation" className="card kpi no-underline color-inherit">
          <div className="icon-box"><Target size={18} color="var(--green)" /></div>
          {treeLoading
            ? <div className="skeleton" style={{ width: 60, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-green">{totals.segment_count || 0}</div>
          }
          <div className="kpi-label">Active Segments</div>
        </Link>
        <Link href="/segment-activity" className="card kpi no-underline color-inherit">
          <div className="icon-box"><TrendingUp size={18} color="var(--purple)" /></div>
          {quickStats.conversations === null
            ? <div className="skeleton" style={{ width: 60, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-purple">{fmt(quickStats.conversations)}</div>
          }
          <div className="kpi-label">Conversations (7d)</div>
        </Link>
        <Link href="/campaigns" className="card kpi no-underline color-inherit">
          <div className="icon-box"><DollarSign size={18} color="var(--orange)" /></div>
          {treeLoading
            ? <div className="skeleton" style={{ width: 100, height: 28, borderRadius: 6, margin: '4px 0 8px' }} />
            : <div className="kpi-value kpi-orange">{fmtM(revenueByType?.total)}</div>
          }
          <div className="kpi-label">Total Confirmed Revenue</div>
        </Link>
      </motion.div>

      {/* Segment Distribution Chart */}
      <motion.div variants={fadeInUp}>
        <div className="card mb-24">
          <div className="card-header">
            <h3>Segment Distribution</h3>
            <Link href="/segmentation" className="btn btn-sm btn-ghost">View Details</Link>
          </div>
          {treeLoading ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 250, padding: '0 8px 8px' }}>
              {[65, 85, 45, 90, 55, 70, 40, 60].map((h, i) => (
                <div key={i} className="skeleton" style={{ flex: 1, height: `${h}%`, borderRadius: '6px 6px 0 0' }} />
              ))}
            </div>
          ) : barData.length > 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
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
            </motion.div>
          ) : (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              No segment data available
            </div>
          )}
        </div>
      </motion.div>

      {/* Quick Actions — always visible */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-3 mb-24">
        {[
          { href: '/contacts',  Icon: UserCheck, color: 'var(--blue)',   label: 'Contacts',  val: quickStats.contacts },
          { href: '/campaigns', Icon: Megaphone, color: 'var(--green)',  label: 'Campaigns', val: quickStats.campaigns },
          { href: '/journeys',  Icon: GitBranch, color: 'var(--purple)', label: 'Journeys',  val: quickStats.journeys },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="card action-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: '20px 24px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: `color-mix(in srgb, ${item.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <item.Icon size={22} color={item.color} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{item.label}</div>
              {item.val === null
                ? <div className="skeleton" style={{ width: 80, height: 22, borderRadius: 4, marginTop: 4 }} />
                : <div style={{ fontSize: 22, fontWeight: 700, color: item.color, marginTop: 2, letterSpacing: -0.5 }}>{fmt(item.val)}</div>
              }
            </div>
          </Link>
        ))}
        {/* <Link href="/segment-activity" className="card action-card">
          <Activity size={24} color="var(--orange)" />
          <div className="action-title">Segment Activity</div>
          <div className="action-desc">Daily entries, exits & reach</div>
        </Link> */}
      </motion.div>

      {/* Email Schedule Status — always visible (own useEffect) */}
      {/* <motion.div variants={fadeInUp}>
        <div className="card mb-24">
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={16} color="#e2b340" /> Email Scheduless
            </h3>
            <Link href="/test-sends" className="btn btn-sm btn-ghost">Manage</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '4px 0' }}>
            <div style={{ textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: schedSummary.running > 0 ? '#22c55e' : 'var(--text-primary)' }}>
                {schedSummary.running}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                {schedSummary.running > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />}
                Active Schedules
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>
                {schedSummary.total}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Total Schedules</div>
            </div>
            <div style={{ textAlign: 'center', padding: '14px 8px' }}>
              {schedSummary.lastSentDay ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#e2b340', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <CheckCircle2 size={20} /> Day {schedSummary.lastSentDay}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Last sent · {new Date(schedSummary.lastSentAt).toLocaleTimeString()}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-tertiary)' }}>—</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>No sends yet</div>
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div> */}

      {/* Last 7 Days Activity */}
      <motion.div variants={fadeInUp}>
        <div className="card mb-24">
          <div className="card-header">
            <h3>Last 7 Days Activity</h3>
            <Link href="/segment-activity" className="btn btn-sm btn-ghost">View All</Link>
          </div>
          {activityLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '0 4px' }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} style={{ textAlign: 'center', padding: 16 }}>
                  <div className="skeleton" style={{ width: 80, height: 28, borderRadius: 6, margin: '0 auto 8px' }} />
                  <div className="skeleton" style={{ width: 120, height: 12, borderRadius: 6, margin: '0 auto' }} />
                </div>
              ))}
            </div>
          ) : logs.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '0 4px' }}
            >
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
            </motion.div>
          ) : (
            <div style={{ padding: '20px 4px', color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
              No activity in the last 7 days
            </div>
          )}
        </div>
      </motion.div>

      {/* Revenue by Segment */}
      <motion.div variants={fadeInUp}>
        <div className="card">
          <div className="card-header">
            <h3>Revenue by Segment</h3>
          </div>
          {treeLoading ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Segment</th><th style={{ textAlign: 'right' }}>Customers</th><th style={{ textAlign: 'right' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td><div className="skeleton" style={{ width: 120, height: 14, borderRadius: 4 }} /></td>
                      <td style={{ textAlign: 'right' }}><div className="skeleton" style={{ width: 60, height: 14, borderRadius: 4, marginLeft: 'auto' }} /></td>
                      <td style={{ textAlign: 'right' }}><div className="skeleton" style={{ width: 90, height: 14, borderRadius: 4, marginLeft: 'auto' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : statusCounts.length > 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
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
            </motion.div>
          ) : (
            <div style={{ padding: '20px 16px', color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
              No segment revenue data available
            </div>
          )}
        </div>
      </motion.div>

      {!treeLoading && !tree?.totals && (
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
