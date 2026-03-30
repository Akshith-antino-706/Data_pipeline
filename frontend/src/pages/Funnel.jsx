import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { getFunnelData, getSegmentFunnel, getChannelEffectiveness, getKeyMetrics, aiInsights, aiAutoOptimize } from '../api';
import { TrendingUp, ArrowLeft, Zap, BarChart2, RefreshCw, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

const COLORS = ['var(--red)', 'var(--yellow)', 'var(--green)', 'var(--yellow)', 'var(--red)', 'var(--red)', 'var(--yellow)'];

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

export default function Funnel() {
  const [funnelData, setFunnelData] = useState([]);
  const [channels, setChannels] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [segmentFunnel, setSegmentFunnel] = useState(null);
  const [segFunnelLoading, setSegFunnelLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmOptimize, setConfirmOptimize] = useState(false);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [f, c, m] = await Promise.all([
        getFunnelData().catch(() => ({ data: [] })),
        getChannelEffectiveness().catch(() => ({ data: [] })),
        getKeyMetrics().catch(() => ({ data: null }))
      ]);
      setFunnelData(f.data || []);
      setChannels(c.data || []);
      setMetrics(m.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const loadInsights = async () => {
    setInsightsLoading(true);
    try {
      const res = await aiInsights();
      setInsights(res.data);
    } catch (err) { showToast('Failed to load AI insights', 'error'); }
    setInsightsLoading(false);
  };

  const handleAutoOptimize = async () => {
    setConfirmOptimize(false);
    setOptimizing(true);
    try {
      const res = await aiAutoOptimize();
      setOptimizeResult(res.data);
      showToast(`Optimized ${res.data?.optimized?.length || 0} strategies`, 'success');
    } catch (err) { showToast('Optimization failed', 'error'); }
    setOptimizing(false);
  };

  const openSegmentFunnel = async (segmentId) => {
    setSelectedSegment(segmentId);
    setSegmentFunnel(null);
    setSegFunnelLoading(true);
    try {
      const res = await getSegmentFunnel(segmentId);
      setSegmentFunnel(res.data);
    } catch (err) { showToast('Failed to load segment funnel', 'error'); }
    setSegFunnelLoading(false);
  };

  const fmt = (n) => Number(n || 0).toLocaleString();
  const pct = (a, b) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '0%';

  if (loading) return <div className="spinner">Loading funnel data...</div>;

  // -- Segment Funnel Detail --
  if (selectedSegment) {
    if (segFunnelLoading || !segmentFunnel) return <div className="spinner">Loading segment funnel...</div>;

    const sf = segmentFunnel;
    const funnel = sf.funnel || [];
    const maxCount = Math.max(...funnel.map(f => f.count), 1);

    return (
      <div>
        <button className="btn btn-secondary mb-20" onClick={() => { setSelectedSegment(null); setSegmentFunnel(null); }}>
          <ArrowLeft size={14} /> Back to Funnel Overview
        </button>

        <div className="page-header">
          <div>
            <h2>{sf.segment?.segment_name}</h2>
            <div className="page-header-sub">Conversion funnel for this segment</div>
          </div>
        </div>

        {/* Visual Funnel */}
        <div className="card mb-20">
          <div className="card-header"><h3>Conversion Funnel</h3></div>
          <div className="card-section">
            {funnel.map((step, i) => {
              const width = Math.max(15, (step.count / maxCount) * 100);
              const dropoff = i > 0 ? funnel[i - 1].count - step.count : 0;
              const dropPct = i > 0 && funnel[i - 1].count > 0 ? ((dropoff / funnel[i - 1].count) * 100).toFixed(0) : 0;
              return (
                <div key={step.stage} className="mb-8">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-sm font-medium">{step.stage}</span>
                    <div className="flex gap-16 text-xs items-center">
                      <span className="font-bold">{fmt(step.count)}</span>
                      {i > 0 && dropoff > 0 && (
                        <span className="text-xs" style={{ color: 'var(--red)' }}>-{dropPct}% drop-off</span>
                      )}
                    </div>
                  </div>
                  <div style={{ height: 36, background: 'var(--bg-secondary)', borderRadius: 8, overflow: 'hidden' }}>
                    <div
                      className="funnel-bar"
                      style={{
                        width: `${width}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${step.color || COLORS[i]}, ${step.color || COLORS[i]}dd)`
                      }}
                    >
                      {width > 20 && pct(step.count, funnel[0].count)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Conversion Breakdowns */}
        <div className="card-grid card-grid-2 mb-20">
          <div className="card">
            <div className="card-header"><h3>By Channel</h3></div>
            {sf.channelConversions?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sf.channelConversions}>
                  <XAxis dataKey="source_channel" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="count" fill="var(--red)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="p-24 text-center text-secondary">No conversion data yet</div>}
          </div>
          <div className="card">
            <div className="card-header"><h3>By Type</h3></div>
            {sf.conversionTypes?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={sf.conversionTypes} dataKey="count" nameKey="conversion_type" cx="50%" cy="50%" outerRadius={70}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {sf.conversionTypes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="p-24 text-center text-secondary">No conversion data yet</div>}
          </div>
        </div>

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    );
  }

  // -- Main Funnel View --
  const totalCustomers = funnelData.reduce((s, d) => s + parseInt(d.customer_count || 0), 0);

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      <motion.div variants={fadeInUp} className="page-header">
        <div>
          <h2>Conversion Funnel</h2>
          <div className="page-header-sub">Track customer journey from segment to conversion</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={14} /></button>
          <button className="btn btn-secondary" onClick={loadInsights} disabled={insightsLoading}>
            <BarChart2 size={14} /> {insightsLoading ? 'Loading...' : 'AI Insights'}
          </button>
          <button className="btn btn-primary" onClick={() => setConfirmOptimize(true)} disabled={optimizing}>
            <Zap size={14} /> {optimizing ? 'Optimizing...' : 'Auto-Optimize'}
          </button>
        </div>
      </motion.div>

      {/* Key Metrics */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-4 mb-24">
        <div className="card kpi"><div className="kpi-value kpi-green">{metrics?.avg_conversion_rate || '0.0'}%</div><div className="kpi-label">Avg Conversion Rate</div></div>
        <div className="card kpi"><div className="kpi-value kpi-blue">AED {fmt(metrics?.total_revenue)}</div><div className="kpi-label">Total Revenue</div></div>
        <div className="card kpi"><div className="kpi-value kpi-orange">{metrics?.avg_days_to_convert != null ? `${metrics.avg_days_to_convert}d` : '--'}</div><div className="kpi-label">Avg Days to Convert</div></div>
        <div className="card kpi"><div className="kpi-value kpi-purple">{fmt(metrics?.total_messages_sent)}</div><div className="kpi-label">Messages Sent</div></div>
      </motion.div>

      {/* Funnel by Stage */}
      <motion.div variants={fadeInUp} className="card mb-24">
        <div className="card-header">
          <h3>7-Stage Customer Funnel</h3>
          <span className="badge badge-blue">{fmt(totalCustomers)} total customers</span>
        </div>
        {funnelData.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Stage</th><th>Segments</th><th>Customers</th><th>Sent</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Conversions</th><th>Revenue</th><th>Conv %</th>
              </tr></thead>
              <tbody>
                {funnelData.map((stage, i) => (
                  <tr key={stage.stage_number} style={{ cursor: 'pointer' }}
                    onClick={() => {
                      /* Navigate to first segment in this stage if available */
                    }}>
                    <td>
                      <div className="flex items-center gap-8">
                        <div className="flex items-center justify-center text-xs font-bold" style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: stage.stage_color, color: '#fff', flexShrink: 0
                        }}>{stage.stage_number}</div>
                        <span className="font-medium text-sm">{stage.stage_name}</span>
                      </div>
                    </td>
                    <td>{stage.segment_count}</td>
                    <td className="font-semibold">{fmt(stage.customer_count)}</td>
                    <td>{fmt(stage.messages_sent)}</td>
                    <td>{fmt(stage.messages_delivered)}</td>
                    <td>{fmt(stage.messages_read)}</td>
                    <td>{fmt(stage.messages_clicked)}</td>
                    <td className="font-semibold" style={{ color: parseInt(stage.total_conversions) > 0 ? 'var(--green)' : 'inherit' }}>{fmt(stage.total_conversions)}</td>
                    <td>AED {fmt(stage.total_revenue)}</td>
                    <td>
                      <span className={`badge ${parseFloat(stage.conversion_rate) > 5 ? 'badge-green' : parseFloat(stage.conversion_rate) > 0 ? 'badge-orange' : 'badge-gray'}`}>
                        {stage.conversion_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-24 text-center text-secondary">
            No funnel data yet. Run segmentation and campaigns first.
          </div>
        )}
      </motion.div>

      {/* Channel Effectiveness */}
      <motion.div variants={fadeInUp} className="card mb-24">
        <div className="card-header"><h3>Channel Effectiveness</h3></div>
        {channels.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={channels}>
                <XAxis dataKey="channel" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)', fontSize: 12 }} />
                <Bar dataKey="delivery_rate" fill="var(--green)" name="Delivery %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="open_rate" fill="var(--yellow)" name="Open %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="click_rate" fill="var(--yellow)" name="Click %" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="table-wrap mt-16">
              <table>
                <thead><tr>
                  <th>Channel</th><th>Campaigns</th><th>Sent</th><th>Delivered</th><th>Clicked</th><th>Conversions</th><th>Revenue</th><th>Delivery %</th><th>Open %</th><th>Click %</th>
                </tr></thead>
                <tbody>
                  {channels.map(c => (
                    <tr key={c.channel}>
                      <td className="font-medium" style={{ textTransform: 'capitalize' }}>{c.channel}</td>
                      <td>{c.campaigns}</td>
                      <td>{fmt(c.total_sent)}</td>
                      <td>{fmt(c.total_delivered)}</td>
                      <td>{fmt(c.total_clicked)}</td>
                      <td className="font-semibold">{fmt(c.conversions)}</td>
                      <td>AED {fmt(c.revenue)}</td>
                      <td><span className="badge badge-green">{c.delivery_rate}%</span></td>
                      <td><span className="badge badge-blue">{c.open_rate}%</span></td>
                      <td><span className="badge badge-orange">{c.click_rate}%</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="p-24 text-center text-secondary">
            No campaign data yet. Execute campaigns to see channel effectiveness.
          </div>
        )}
      </motion.div>

      {/* AI Insights */}
      {insights && (
        <motion.div variants={fadeInUp} className="card mb-24">
          <div className="card-header"><h3>AI Insights</h3></div>
          <div className="flex flex-col gap-8">
            {(insights.insights || []).map((ins, i) => (
              <div key={i} className="flex gap-12 items-center" style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)', alignItems: 'flex-start' }}>
                <span className={`badge ${ins.type === 'success' ? 'badge-green' : ins.type === 'warning' ? 'badge-orange' : ins.type === 'action' ? 'badge-blue' : 'badge-gray'}`} style={{ flexShrink: 0 }}>
                  {ins.type}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="font-semibold text-sm">{ins.title}</div>
                  <div className="text-xs text-secondary" style={{ marginTop: 2 }}>{ins.description}</div>
                </div>
                {ins.metric && <span className="font-bold" style={{ fontSize: 14, flexShrink: 0 }}>{ins.metric}</span>}
              </div>
            ))}
          </div>
          {(insights.recommendations || []).length > 0 && (
            <div className="mt-16">
              <h4 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-8">Recommendations</h4>
              <div className="flex flex-col gap-8">
                {insights.recommendations.map((rec, i) => (
                  <div key={i} className="flex gap-12" style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                    <span className={`badge ${rec.priority === 'high' ? 'badge-red' : 'badge-orange'}`} style={{ flexShrink: 0 }}>{rec.priority}</span>
                    <div>
                      <div className="text-sm">{rec.action}</div>
                      <div className="text-xs" style={{ color: 'var(--green)', marginTop: 2 }}>Expected: {rec.expected_impact}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Auto-optimize Results */}
      {optimizeResult && (
        <motion.div variants={fadeInUp} className="card mb-24">
          <div className="card-header">
            <h3>Optimization Results</h3>
            <span className="badge badge-green">{optimizeResult.optimized?.length || 0} strategies optimized</span>
          </div>
          <p className="text-sm text-secondary mb-8">
            Analyzed {optimizeResult.strategies_analyzed || 0} active strategies with completed campaigns.
          </p>
          {(optimizeResult.optimized || []).length > 0 ? (
            <div className="flex flex-col gap-8">
              {optimizeResult.optimized.map((opt, i) => (
                <div key={i} style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-semibold text-sm">{opt.name}</span>
                    <span className="badge badge-purple">Score: {opt.score}/100</span>
                  </div>
                  {opt.suggestions?.map((s, j) => (
                    <div key={j} className="text-xs text-secondary" style={{ padding: '4px 0' }}>{s.description}</div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-20 text-center text-secondary">
              All strategies are performing well. No optimizations needed.
            </div>
          )}
        </motion.div>
      )}

      {/* Confirm Auto-Optimize Dialog */}
      {confirmOptimize && (
        <div className="confirm-overlay" onClick={() => setConfirmOptimize(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <AlertCircle size={32} color="var(--orange)" className="mb-8" />
            <h3>Auto-Optimize All Strategies?</h3>
            <p>AI will analyze all active strategies with campaign data and automatically adjust underperforming ones.</p>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmOptimize(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAutoOptimize}>Optimize</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </motion.div>
  );
}
