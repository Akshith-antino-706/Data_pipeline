import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getSegmentSummary, getKeyMetrics, getCampaignPerformance } from '../api';
import { RefreshCw, Target, TrendingUp, Users, Zap, Send, FileText, GitBranch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

export default function Dashboard() {
  const [segSummary, setSegSummary] = useState(null);
  const [funnelMetrics, setFunnelMetrics] = useState(null);
  const [campaigns, setCampaigns] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      getSegmentSummary().catch(() => ({ data: null })),
      getKeyMetrics().catch(() => ({ data: null })),
      getCampaignPerformance().catch(() => ({ data: null })),
    ])
      .then(([seg, met, camp]) => {
        setSegSummary(seg?.data || null);
        setFunnelMetrics(met?.data || null);
        setCampaigns(camp?.data || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return <div className="spinner">Loading dashboard...</div>;

  const fmt = (n) => Number(n || 0).toLocaleString();

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      <motion.div variants={fadeInUp}>
        <div className="page-header">
          <div>
            <h2>Dashboard</h2>
            <div className="page-header-sub">Rayna Tours Omnichannel Overview</div>
          </div>
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={14} /></button>
          </div>
        </div>
      </motion.div>

      {/* Platform KPIs */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-4 mb-24">
        <Link to="/segments" className="card kpi no-underline color-inherit">
          <div className="icon-box">
            <Users size={18} color="var(--blue)" />
          </div>
          <div className="kpi-value kpi-blue">{fmt(segSummary?.total_customers)}</div>
          <div className="kpi-label">Total Customers</div>
        </Link>
        <Link to="/segments" className="card kpi no-underline color-inherit">
          <div className="icon-box">
            <Target size={18} color="var(--green)" />
          </div>
          <div className="kpi-value kpi-green">{fmt(segSummary?.segmented_customers)}</div>
          <div className="kpi-label">Segmented</div>
        </Link>
        <Link to="/strategies" className="card kpi no-underline color-inherit">
          <div className="icon-box">
            <Zap size={18} color="var(--purple)" />
          </div>
          <div className="kpi-value kpi-purple">{segSummary?.active_strategies || 0}</div>
          <div className="kpi-label">Active Strategies</div>
        </Link>
        <Link to="/funnel" className="card kpi no-underline color-inherit">
          <div className="icon-box">
            <TrendingUp size={18} color="var(--orange)" />
          </div>
          <div className="kpi-value kpi-orange">{funnelMetrics?.avg_conversion_rate || '0.0'}%</div>
          <div className="kpi-label">Conversion Rate</div>
        </Link>
      </motion.div>

      {/* Funnel Stage Distribution */}
      {segSummary?.stages && (
        <motion.div variants={fadeInUp}>
          <div className="card mb-24">
            <div className="card-header">
              <h3>Segment Distribution by Funnel Stage</h3>
              <Link to="/segments" className="btn btn-sm btn-ghost">View All</Link>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={segSummary.stages.map(s => ({
                name: s.stage_name?.split(' - ')[0] || s.stage_name,
                customers: parseInt(s.customer_count || 0),
                segments: parseInt(s.segment_count || 0),
                color: s.stage_color
              }))}>
                <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                <Bar dataKey="customers" name="Customers" radius={[6, 6, 0, 0]}>
                  {segSummary.stages.map((s, i) => <Cell key={i} fill={s.stage_color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* Quick Actions */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-4 mb-24">
        <Link to="/content" className="card action-card">
          <FileText size={24} color="var(--blue)" className="mb-8" />
          <div className="action-title">Content</div>
          <div className="action-desc">Templates & AI Generation</div>
        </Link>
        <Link to="/campaigns" className="card action-card">
          <Send size={24} color="var(--green)" className="mb-8" />
          <div className="action-title">Campaigns</div>
          <div className="action-desc">Execute & Track</div>
        </Link>
        <Link to="/journeys" className="card action-card">
          <GitBranch size={24} color="var(--purple)" className="mb-8" />
          <div className="action-title">Journeys</div>
          <div className="action-desc">Flow Builder</div>
        </Link>
        <Link to="/rfm" className="card action-card">
          <Target size={24} color="var(--orange)" className="mb-8" />
          <div className="action-title">RFM Analysis</div>
          <div className="action-desc">Recency · Frequency · Monetary</div>
        </Link>
      </motion.div>

      {/* Campaign Performance Summary */}
      {campaigns && campaigns.length > 0 && (
        <motion.div variants={fadeInUp}>
          <div className="card">
            <div className="card-header">
              <h3>Recent Campaigns</h3>
              <Link to="/campaigns" className="btn btn-sm btn-ghost">View All</Link>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th><th>Channel</th><th>Segment</th><th>Status</th><th>Sent</th><th>Open Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.slice(0, 8).map((c, i) => (
                    <tr key={i}>
                      <td className="font-medium">{c.name}</td>
                      <td><span className={`badge badge-${c.channel === 'email' ? 'blue' : 'green'}`}>{c.channel}</span></td>
                      <td>{c.segment_label || '—'}</td>
                      <td><span className={`badge ${c.status === 'executed' ? 'badge-green' : c.status === 'draft' ? 'badge-orange' : 'badge-blue'}`}>{c.status}</span></td>
                      <td>{fmt(c.sent_count)}</td>
                      <td>{c.open_rate ? `${c.open_rate}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {!segSummary && (
        <motion.div variants={fadeInUp}>
          <div className="card empty">
            <h3 className="mb-8">No Data Available</h3>
            <p className="text-secondary mb-20">Run migrations and segmentation to start populating your dashboard.</p>
            <Link to="/segments" className="btn btn-primary">Go to Segments</Link>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
