import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getRFMOverview, getSegmentRFM, recalculateRFM, getFunnelOverview } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { RefreshCw, TrendingUp, Users, Award, AlertTriangle, Target, Heart } from 'lucide-react';

const RFM_COLORS = {
  'Champions': 'var(--green)',
  'Loyal Customers': 'var(--brand-primary)',
  'Potential Loyalists': 'var(--yellow)',
  'At Risk': 'var(--orange)',
  'Need Attention': 'var(--red)',
  'Hibernating': 'var(--red)',
  'Lost': 'var(--text-tertiary)'
};

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

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
      setOverview(rfm?.data || rfm || null);
      const funnelData = funnel?.data || funnel || {};
      const allSegs = (funnelData.stages || []).flatMap(s => s.segments || []);
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
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="p-24">
      <motion.div variants={fadeInUp} className="flex justify-between items-center mb-24">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>RFM Analysis</h1>
          <p className="text-secondary" style={{ margin: '4px 0 0' }}>Recency, Frequency, Monetary scoring across 28 segments</p>
        </div>
        <button className="btn btn-primary" onClick={handleRecalculate} disabled={recalculating}>
          <RefreshCw size={16} className={recalculating ? 'spin' : ''} /> {recalculating ? 'Recalculating...' : 'Recalculate RFM'}
        </button>
      </motion.div>

      {/* KPI Cards */}
      <motion.div variants={fadeInUp} className="kpi-strip mb-24">
        {[
          { icon: Users, label: 'Total Customers', value: parseInt(totals.total_customers || 0).toLocaleString(), color: 'var(--brand-primary)' },
          { icon: Award, label: 'Champions', value: parseInt(totals.champions || 0).toLocaleString(), color: 'var(--green)' },
          { icon: AlertTriangle, label: 'Lost Customers', value: parseInt(totals.lost || 0).toLocaleString(), color: 'var(--red)' },
          { icon: Heart, label: 'High Winback', value: parseInt(totals.high_winback || 0).toLocaleString(), color: 'var(--yellow)' },
          { icon: TrendingUp, label: 'Avg RFM Score', value: totals.avg_rfm_score || '0', color: 'var(--orange)' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="card p-20">
            <div className="flex items-center gap-8 mb-8">
              <Icon size={18} color={color} /> <span className="text-secondary text-sm">{label}</span>
            </div>
            <div className="font-bold" style={{ fontSize: 28, color }}>{value}</div>
          </div>
        ))}
      </motion.div>

      {/* Distribution Chart + Radar */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-2 mb-24">
        <div className="card card-section">
          <h3 className="mb-16" style={{ fontSize: 16 }}>RFM Segment Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dist} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis type="number" tick={{ fill: 'var(--text-tertiary)' }} />
              <YAxis dataKey="label" type="category" width={120} tick={{ fontSize: 12, fill: 'var(--text-tertiary)' }} />
              <Tooltip formatter={(v) => parseInt(v).toLocaleString()} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {dist.map((d, i) => <Cell key={i} fill={RFM_COLORS[d.label] || 'var(--text-tertiary)'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card card-section">
          <h3 className="mb-16" style={{ fontSize: 16 }}>RFM Score Radar</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
              <PolarRadiusAxis domain={[0, 5]} />
              <Radar name="Recency" dataKey="Recency" stroke="var(--brand-primary)" fill="var(--brand-primary)" fillOpacity={0.2} />
              <Radar name="Frequency" dataKey="Frequency" stroke="var(--green)" fill="var(--green)" fillOpacity={0.2} />
              <Radar name="Monetary" dataKey="Monetary" stroke="var(--orange)" fill="var(--orange)" fillOpacity={0.2} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Winback Probability */}
      <motion.div variants={fadeInUp} className="card card-section mb-24">
        <h3 className="mb-16" style={{ fontSize: 16 }}>Winback Probability by RFM Label</h3>
        <div className="kpi-strip">
          {dist.map(d => (
            <div key={d.label} className="p-16" style={{ borderRadius: 8, border: `2px solid color-mix(in srgb, ${RFM_COLORS[d.label]} 12%, transparent)`, background: `color-mix(in srgb, ${RFM_COLORS[d.label]} 3%, transparent)` }}>
              <div className="text-sm font-semibold" style={{ color: RFM_COLORS[d.label] }}>{d.label}</div>
              <div className="font-bold" style={{ fontSize: 24, margin: '4px 0' }}>{d.avg_winback_prob}%</div>
              <div className="text-xs text-secondary">{parseInt(d.count).toLocaleString()} customers | Avg Rev: AED {parseFloat(d.avg_revenue || 0).toFixed(0)}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Per-Segment RFM Drill Down */}
      <motion.div variants={fadeInUp} className="card card-section">
        <h3 className="mb-16" style={{ fontSize: 16 }}>Segment-Level RFM Analysis</h3>
        <div className="flex gap-8 mb-16" style={{ flexWrap: 'wrap' }}>
          {segments.map(s => (
            <button key={s.segment_id} onClick={() => selectSegment(s.segment_id)}
              className={`btn btn-sm ${selectedSegment === s.segment_id ? 'btn-primary' : 'btn-secondary'}`}
              style={{ borderRadius: 20, fontSize: 12 }}>
              S{s.segment_id}: {s.segment_name?.substring(0, 25)}
            </button>
          ))}
        </div>

        {segmentRFM && (
          <div className="card-grid card-grid-2 gap-20">
            <div>
              <h4 className="mb-8">{segmentRFM.segment_name}</h4>
              <table className="text-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                    <tr key={k} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td className="font-semibold text-secondary" style={{ padding: '8px 0' }}>{k}</td>
                      <td style={{ padding: '8px 0' }}>{v || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="mb-8">RFM Breakdown</h4>
              {segmentRFM.rfm_breakdown?.map(b => (
                <div key={b.rfm_segment_label} className="flex justify-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <span className="flex items-center gap-8">
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: RFM_COLORS[b.rfm_segment_label] || 'var(--text-tertiary)', display: 'inline-block' }} />
                    {b.rfm_segment_label}
                  </span>
                  <span>{parseInt(b.count).toLocaleString()} ({b.avg_winback}% winback)</span>
                </div>
              ))}

              <h4 className="mt-16 mb-8">Product Affinity</h4>
              {segmentRFM.product_affinity?.map(p => (
                <div key={p.product} className="mb-8">
                  <div className="flex justify-between text-sm mb-4">
                    <span>{p.product}</span>
                    <span>{(parseFloat(p.avg_score) * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 4, height: 6 }}>
                    <div style={{ width: `${parseFloat(p.avg_score) * 100}%`, background: 'var(--brand-primary)', borderRadius: 4, height: 6 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
