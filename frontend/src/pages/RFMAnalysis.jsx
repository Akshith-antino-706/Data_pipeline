import { useState, useEffect } from 'react';
import { getRFMOverview, getSegmentRFM, recalculateRFM, getFunnelOverview } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { RefreshCw, TrendingUp, Users, Award, AlertTriangle, Target, Heart } from 'lucide-react';

const RFM_COLORS = {
  'Champions': '#22c55e',
  'Loyal Customers': '#dc2626',
  'Potential Loyalists': '#eab308',
  'At Risk': '#fbbf24',
  'Need Attention': '#dc2626',
  'Hibernating': '#ef4444',
  'Lost': '#6b7280'
};

export default function RFMAnalysis() {
  const [overview, setOverview] = useState(null);
  const [segments, setSegments] = useState([]);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [segmentRFM, setSegmentRFM] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [rfm, funnel] = await Promise.all([getRFMOverview(), getFunnelOverview()]);
      setOverview(rfm);
      const allSegs = funnel.stages?.flatMap(s => s.segments || []) || [];
      setSegments(allSegs);
    } catch (err) {
      console.error('RFM load error:', err);
    }
    setLoading(false);
  }

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      await recalculateRFM();
      await loadData();
    } catch (err) {
      console.error('Recalculate error:', err);
    }
    setRecalculating(false);
  }

  async function selectSegment(segId) {
    setSelectedSegment(segId);
    try {
      const data = await getSegmentRFM(segId);
      setSegmentRFM(data);
    } catch (err) {
      console.error('Segment RFM error:', err);
    }
  }

  if (loading) return <div className="spinner">Loading RFM Analysis...</div>;

  const dist = overview?.distribution || [];
  const totals = overview?.totals || {};

  const radarData = dist.map(d => ({
    label: d.label,
    Recency: parseFloat(d.avg_recency) || 0,
    Frequency: parseFloat(d.avg_frequency) || 0,
    Monetary: parseFloat(d.avg_monetary) || 0
  }));

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>RFM Analysis</h1>
          <p style={{ color: '#78716c', margin: '4px 0 0' }}>Recency, Frequency, Monetary scoring across 28 segments</p>
        </div>
        <button onClick={handleRecalculate} disabled={recalculating}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
          <RefreshCw size={16} className={recalculating ? 'spin' : ''} /> {recalculating ? 'Recalculating...' : 'Recalculate RFM'}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { icon: Users, label: 'Total Customers', value: parseInt(totals.total_customers || 0).toLocaleString(), color: '#dc2626' },
          { icon: Award, label: 'Champions', value: parseInt(totals.champions || 0).toLocaleString(), color: '#22c55e' },
          { icon: AlertTriangle, label: 'Lost Customers', value: parseInt(totals.lost || 0).toLocaleString(), color: '#ef4444' },
          { icon: Heart, label: 'High Winback', value: parseInt(totals.high_winback || 0).toLocaleString(), color: '#eab308' },
          { icon: TrendingUp, label: 'Avg RFM Score', value: totals.avg_rfm_score || '0', color: '#f59e0b' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e7e5e4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon size={18} color={color} /> <span style={{ color: '#78716c', fontSize: 13 }}>{label}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Distribution Chart + Radar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>RFM Segment Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dist} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="label" type="category" width={120} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => parseInt(v).toLocaleString()} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {dist.map((d, i) => <Cell key={i} fill={RFM_COLORS[d.label] || '#6b7280'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>RFM Score Radar</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 5]} />
              <Radar name="Recency" dataKey="Recency" stroke="#dc2626" fill="#dc2626" fillOpacity={0.2} />
              <Radar name="Frequency" dataKey="Frequency" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} />
              <Radar name="Monetary" dataKey="Monetary" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Winback Probability */}
      <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4', marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Winback Probability by RFM Label</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {dist.map(d => (
            <div key={d.label} style={{ padding: 16, borderRadius: 8, border: `2px solid ${RFM_COLORS[d.label]}20`, background: `${RFM_COLORS[d.label]}08` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: RFM_COLORS[d.label] }}>{d.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, margin: '4px 0' }}>{d.avg_winback_prob}%</div>
              <div style={{ fontSize: 12, color: '#78716c' }}>{parseInt(d.count).toLocaleString()} customers | Avg Rev: AED {parseFloat(d.avg_revenue || 0).toFixed(0)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-Segment RFM Drill Down */}
      <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Segment-Level RFM Analysis</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {segments.map(s => (
            <button key={s.segment_id} onClick={() => selectSegment(s.segment_id)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: selectedSegment === s.segment_id ? '2px solid #dc2626' : '1px solid #e7e5e4',
                background: selectedSegment === s.segment_id ? '#fef2f2' : 'white', cursor: 'pointer', fontSize: 12, fontWeight: 500
              }}>
              S{s.segment_id}: {s.segment_name?.substring(0, 25)}
            </button>
          ))}
        </div>

        {segmentRFM && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <h4 style={{ margin: '0 0 12px' }}>{segmentRFM.segment_name}</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {[
                    ['End Goal', segmentRFM.end_goal],
                    ['Winback Goal', segmentRFM.winback_goal],
                    ['Dominant RFM Label', segmentRFM.dominant_rfm_label],
                    ['Primary Winback Strategy', segmentRFM.primary_winback_strategy],
                    ['Avg RFM Score', segmentRFM.avg_rfm_score],
                    ['Avg Recency', segmentRFM.avg_recency + '/5'],
                    ['Avg Frequency', segmentRFM.avg_frequency + '/5'],
                    ['Avg Monetary', segmentRFM.avg_monetary + '/5'],
                    ['Winback Probability', segmentRFM.avg_winback_prob + '%'],
                    ['Recommended Coupon', segmentRFM.recommended_coupon],
                    ['Customers', parseInt(segmentRFM.customer_count).toLocaleString()],
                  ].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: '1px solid #f5f5f4' }}>
                      <td style={{ padding: '8px 0', fontWeight: 600, color: '#78716c' }}>{k}</td>
                      <td style={{ padding: '8px 0' }}>{v || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 style={{ margin: '0 0 12px' }}>RFM Breakdown</h4>
              {segmentRFM.rfm_breakdown?.map(b => (
                <div key={b.rfm_segment_label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f4' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: RFM_COLORS[b.rfm_segment_label] || '#6b7280', display: 'inline-block' }} />
                    {b.rfm_segment_label}
                  </span>
                  <span>{parseInt(b.count).toLocaleString()} ({b.avg_winback}% winback)</span>
                </div>
              ))}

              <h4 style={{ margin: '20px 0 12px' }}>Product Affinity</h4>
              {segmentRFM.product_affinity?.map(p => (
                <div key={p.product} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                    <span>{p.product}</span>
                    <span>{(parseFloat(p.avg_score) * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ background: '#f5f5f4', borderRadius: 4, height: 6 }}>
                    <div style={{ width: `${parseFloat(p.avg_score) * 100}%`, background: '#dc2626', borderRadius: 4, height: 6 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
