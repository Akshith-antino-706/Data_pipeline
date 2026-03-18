import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getSegmentSummary, getKeyMetrics, getCampaignPerformance } from '../api';
import { RefreshCw, Target, TrendingUp, Users, Zap, Send, FileText, GitBranch } from 'lucide-react';
import { Link } from 'react-router-dom';

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
    <div>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <div className="page-header-sub">Rayna Tours Omnichannel Overview</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Platform KPIs */}
      <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
        <Link to="/segments" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <Users size={18} color="var(--blue)" />
          </div>
          <div className="kpi-value kpi-blue">{fmt(segSummary?.total_customers)}</div>
          <div className="kpi-label">Total Customers</div>
        </Link>
        <Link to="/segments" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <Target size={18} color="var(--green)" />
          </div>
          <div className="kpi-value kpi-green">{fmt(segSummary?.segmented_customers)}</div>
          <div className="kpi-label">Segmented</div>
        </Link>
        <Link to="/strategies" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <Zap size={18} color="var(--purple)" />
          </div>
          <div className="kpi-value kpi-purple">{segSummary?.active_strategies || 0}</div>
          <div className="kpi-label">Active Strategies</div>
        </Link>
        <Link to="/funnel" className="card kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <TrendingUp size={18} color="var(--orange)" />
          </div>
          <div className="kpi-value kpi-orange">{funnelMetrics?.avg_conversion_rate || '0.0'}%</div>
          <div className="kpi-label">Conversion Rate</div>
        </Link>
      </div>

      {/* Funnel Stage Distribution */}
      {segSummary?.stages && (
        <div className="card" style={{ marginBottom: 24 }}>
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
              <XAxis dataKey="name" tick={{ fill: '#a8a29e', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fill: '#a8a29e', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
              <Bar dataKey="customers" name="Customers" radius={[6, 6, 0, 0]}>
                {segSummary.stages.map((s, i) => <Cell key={i} fill={s.stage_color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
        <Link to="/content" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', padding: '24px 16px' }}>
          <FileText size={24} color="var(--blue)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>Content</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Templates & AI Generation</div>
        </Link>
        <Link to="/campaigns" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', padding: '24px 16px' }}>
          <Send size={24} color="var(--green)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>Campaigns</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Execute & Track</div>
        </Link>
        <Link to="/journeys" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', padding: '24px 16px' }}>
          <GitBranch size={24} color="var(--purple)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>Journeys</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Flow Builder</div>
        </Link>
        <Link to="/rfm" className="card" style={{ textDecoration: 'none', color: 'inherit', textAlign: 'center', padding: '24px 16px' }}>
          <Target size={24} color="var(--orange)" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>RFM Analysis</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Recency · Frequency · Monetary</div>
        </Link>
      </div>

      {/* Campaign Performance Summary */}
      {campaigns && campaigns.length > 0 && (
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
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
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
      )}

      {!segSummary && (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h3 style={{ marginBottom: 8 }}>No Data Available</h3>
          <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>Run migrations and segmentation to start populating your dashboard.</p>
          <Link to="/segments" className="btn btn-primary">Go to Segments</Link>
        </div>
      )}
    </div>
  );
}
