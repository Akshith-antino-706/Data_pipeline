import { useState, useEffect, useCallback } from 'react';
import { getFunnelData, getSegmentFunnel, getChannelEffectiveness, getKeyMetrics, aiInsights, aiAutoOptimize } from '../api';
import { TrendingUp, ArrowLeft, Zap, BarChart2, RefreshCw, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

const COLORS = ['#dc2626', '#eab308', '#00b894', '#fbbf24', '#dc2626', '#dc2626', '#eab308'];

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

  // ── Segment Funnel Detail ────────────────────────────────
  if (selectedSegment) {
    if (segFunnelLoading || !segmentFunnel) return <div className="spinner">Loading segment funnel...</div>;

    const sf = segmentFunnel;
    const funnel = sf.funnel || [];
    const maxCount = Math.max(...funnel.map(f => f.count), 1);

    return (
      <div>
        <button className="btn btn-secondary" onClick={() => { setSelectedSegment(null); setSegmentFunnel(null); }} style={{ marginBottom: 20 }}>
          <ArrowLeft size={14} /> Back to Funnel Overview
        </button>

        <div className="page-header">
          <div>
            <h2>{sf.segment?.segment_name}</h2>
            <div className="page-header-sub">Conversion funnel for this segment</div>
          </div>
        </div>

        {/* Visual Funnel */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><h3>Conversion Funnel</h3></div>
          <div style={{ padding: '16px 0' }}>
            {funnel.map((step, i) => {
              const width = Math.max(15, (step.count / maxCount) * 100);
              const dropoff = i > 0 ? funnel[i - 1].count - step.count : 0;
              const dropPct = i > 0 && funnel[i - 1].count > 0 ? ((dropoff / funnel[i - 1].count) * 100).toFixed(0) : 0;
              return (
                <div key={step.stage} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{step.stage}</span>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>{fmt(step.count)}</span>
                      {i > 0 && dropoff > 0 && (
                        <span style={{ color: 'var(--red)', fontSize: 11 }}>-{dropPct}% drop-off</span>
                      )}
                    </div>
                  </div>
                  <div style={{ height: 36, background: 'var(--bg)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{
                      width: `${width}%`, height: '100%',
                      background: `linear-gradient(90deg, ${step.color || COLORS[i]}, ${step.color || COLORS[i]}dd)`,
                      borderRadius: 8, display: 'flex', alignItems: 'center', paddingLeft: 12,
                      transition: 'width 0.6s ease-out', fontSize: 12, color: '#fff', fontWeight: 600
                    }}>
                      {width > 20 && pct(step.count, funnel[0].count)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Conversion Breakdowns */}
        <div className="card-grid card-grid-2" style={{ marginBottom: 20 }}>
          <div className="card">
            <div className="card-header"><h3>By Channel</h3></div>
            {sf.channelConversions?.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sf.channelConversions}>
                  <XAxis dataKey="source_channel" tick={{ fill: '#a8a29e', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#a8a29e', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8 }} />
                  <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>No conversion data yet</div>}
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
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>No conversion data yet</div>}
          </div>
        </div>

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    );
  }

  // ── Main Funnel View ─────────────────────────────────────
  const totalCustomers = funnelData.reduce((s, d) => s + parseInt(d.customer_count || 0), 0);

  return (
    <div>
      <div className="page-header">
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
      </div>

      {/* Key Metrics */}
      <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
        <div className="card kpi"><div className="kpi-value kpi-green">{metrics?.avg_conversion_rate || '0.0'}%</div><div className="kpi-label">Avg Conversion Rate</div></div>
        <div className="card kpi"><div className="kpi-value kpi-blue">AED {fmt(metrics?.total_revenue)}</div><div className="kpi-label">Total Revenue</div></div>
        <div className="card kpi"><div className="kpi-value kpi-orange">{metrics?.avg_days_to_convert != null ? `${metrics.avg_days_to_convert}d` : '—'}</div><div className="kpi-label">Avg Days to Convert</div></div>
        <div className="card kpi"><div className="kpi-value kpi-purple">{fmt(metrics?.total_messages_sent)}</div><div className="kpi-label">Messages Sent</div></div>
      </div>

      {/* Funnel by Stage */}
      <div className="card" style={{ marginBottom: 24 }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: stage.stage_color, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, flexShrink: 0
                        }}>{stage.stage_number}</div>
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{stage.stage_name}</span>
                      </div>
                    </td>
                    <td>{stage.segment_count}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(stage.customer_count)}</td>
                    <td>{fmt(stage.messages_sent)}</td>
                    <td>{fmt(stage.messages_delivered)}</td>
                    <td>{fmt(stage.messages_read)}</td>
                    <td>{fmt(stage.messages_clicked)}</td>
                    <td style={{ fontWeight: 600, color: parseInt(stage.total_conversions) > 0 ? 'var(--green)' : 'inherit' }}>{fmt(stage.total_conversions)}</td>
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
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
            No funnel data yet. Run segmentation and campaigns first.
          </div>
        )}
      </div>

      {/* Channel Effectiveness */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><h3>Channel Effectiveness</h3></div>
        {channels.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={channels}>
                <XAxis dataKey="channel" tick={{ fill: '#a8a29e', fontSize: 12 }} />
                <YAxis tick={{ fill: '#a8a29e', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="delivery_rate" fill="#00b894" name="Delivery %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="open_rate" fill="#eab308" name="Open %" radius={[4, 4, 0, 0]} />
                <Bar dataKey="click_rate" fill="#fbbf24" name="Click %" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr>
                  <th>Channel</th><th>Campaigns</th><th>Sent</th><th>Delivered</th><th>Clicked</th><th>Conversions</th><th>Revenue</th><th>Delivery %</th><th>Open %</th><th>Click %</th>
                </tr></thead>
                <tbody>
                  {channels.map(c => (
                    <tr key={c.channel}>
                      <td style={{ fontWeight: 500, textTransform: 'capitalize' }}>{c.channel}</td>
                      <td>{c.campaigns}</td>
                      <td>{fmt(c.total_sent)}</td>
                      <td>{fmt(c.total_delivered)}</td>
                      <td>{fmt(c.total_clicked)}</td>
                      <td style={{ fontWeight: 600 }}>{fmt(c.conversions)}</td>
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
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
            No campaign data yet. Execute campaigns to see channel effectiveness.
          </div>
        )}
      </div>

      {/* AI Insights */}
      {insights && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3>AI Insights</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(insights.insights || []).map((ins, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', alignItems: 'flex-start' }}>
                <span className={`badge ${ins.type === 'success' ? 'badge-green' : ins.type === 'warning' ? 'badge-orange' : ins.type === 'action' ? 'badge-blue' : 'badge-gray'}`} style={{ flexShrink: 0 }}>
                  {ins.type}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ins.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{ins.description}</div>
                </div>
                {ins.metric && <span style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{ins.metric}</span>}
              </div>
            ))}
          </div>
          {(insights.recommendations || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Recommendations</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {insights.recommendations.map((rec, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <span className={`badge ${rec.priority === 'high' ? 'badge-red' : 'badge-orange'}`} style={{ flexShrink: 0 }}>{rec.priority}</span>
                    <div>
                      <div style={{ fontSize: 13 }}>{rec.action}</div>
                      <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>Expected: {rec.expected_impact}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Auto-optimize Results */}
      {optimizeResult && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3>Optimization Results</h3>
            <span className="badge badge-green">{optimizeResult.optimized?.length || 0} strategies optimized</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
            Analyzed {optimizeResult.strategies_analyzed || 0} active strategies with completed campaigns.
          </p>
          {(optimizeResult.optimized || []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {optimizeResult.optimized.map((opt, i) => (
                <div key={i} style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{opt.name}</span>
                    <span className="badge badge-purple">Score: {opt.score}/100</span>
                  </div>
                  {opt.suggestions?.map((s, j) => (
                    <div key={j} style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 0' }}>{s.description}</div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-dim)' }}>
              All strategies are performing well. No optimizations needed.
            </div>
          )}
        </div>
      )}

      {/* Confirm Auto-Optimize Dialog */}
      {confirmOptimize && (
        <div className="confirm-overlay" onClick={() => setConfirmOptimize(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <AlertCircle size={32} color="var(--orange)" style={{ marginBottom: 12 }} />
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
    </div>
  );
}
