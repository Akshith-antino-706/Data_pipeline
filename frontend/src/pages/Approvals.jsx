import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getApprovalQueue, getApprovalStats, approveItem, rejectItem, aiAnalyzeStrategies } from '../api';
import { Shield, Check, X, Clock, AlertTriangle, Brain } from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

const priorityColorMap = {
  critical: 'red',
  high: 'orange',
  normal: 'red',
  low: 'gray',
};

export default function Approvals() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [filter, setFilter] = useState('pending');

  useEffect(() => { load(); }, [filter]);

  async function load() {
    setLoading(true);
    try {
      const [q, s] = await Promise.all([getApprovalQueue({ status: filter }), getApprovalStats()]);
      setQueue(Array.isArray(q) ? q : (q.data || []));
      setStats(s && typeof s === 'object' && !Array.isArray(s) ? (s.data || s) : {});
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysisResult(null);
    try {
      const res = await aiAnalyzeStrategies();
      setAnalysisResult(res.data);
      if (res.data?.suggestions_created > 0) {
        setFilter('pending');
        await load();
      }
    } catch (err) { console.error(err); }
    setAnalyzing(false);
  }

  async function handleApprove(id) {
    try { await approveItem(id, 'admin'); load(); } catch (err) { console.error(err); }
  }

  async function handleReject(id) {
    try { await rejectItem(id, 'admin'); load(); } catch (err) { console.error(err); }
  }

  function getPriorityBadgeClass(priority) {
    const map = { critical: 'badge-red', high: 'badge-orange', normal: 'badge-red', low: 'badge-gray' };
    return map[priority] || 'badge-gray';
  }

  function getConfidenceClass(confidence) {
    if (confidence >= 80) return 'kpi-green';
    if (confidence >= 50) return 'kpi-orange';
    return 'kpi-red';
  }

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} className="p-24">
      <motion.div variants={fadeInUp} className="flex justify-between mb-24" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="font-bold" style={{ fontSize: 28, margin: '0 0 4px' }}>Human Approval</h1>
          <p className="text-secondary mb-0">Review and approve AI-optimized strategies, campaigns, and content before activation</p>
        </div>
        <button onClick={handleAnalyze} disabled={analyzing}
          className={`btn btn-lg font-semibold ${analyzing ? 'btn-secondary' : 'btn-danger'}`}
          style={analyzing ? { borderColor: 'var(--red)', color: 'var(--red)' } : undefined}>
          <Brain size={16} /> {analyzing ? 'Analyzing Strategies...' : 'AI Analyze All Strategies'}
        </button>
      </motion.div>

      {analysisResult && (
        <motion.div variants={fadeInUp} className="alert alert-success">
          <div className="font-semibold" style={{ fontSize: 14, marginBottom: 6 }}>
            AI Analysis Complete — {analysisResult.analyzed} strategies analyzed, {analysisResult.suggestions_created} suggestions created
          </div>
          {analysisResult.suggestions?.map((s, i) => (
            <div key={i} className="text-sm" style={{ marginTop: 4 }}>
              <b>{s.segment}</b>: {s.summary}
            </div>
          ))}
          {analysisResult.suggestions_created === 0 && (
            <div className="text-sm">All strategies look healthy. No changes suggested.</div>
          )}
        </motion.div>
      )}

      {/* Stats */}
      <motion.div variants={fadeInUp} className="kpi-strip">
        {[
          { label: 'Pending', value: stats.pending_count || 0, icon: Clock, colorClass: 'kpi-orange' },
          { label: 'Approved', value: stats.approved_count || 0, icon: Check, colorClass: 'kpi-green' },
          { label: 'Rejected', value: stats.rejected_count || 0, icon: X, colorClass: 'kpi-red' },
          { label: 'Avg Review Time', value: stats.avg_review_hours ? `${stats.avg_review_hours}h` : 'N/A', icon: Shield, colorClass: 'kpi-red' },
        ].map(({ label, value, icon: Icon, colorClass }) => (
          <div key={label} className="card">
            <div className="flex items-center gap-8 mb-8 justify-center">
              <Icon size={16} className={colorClass} /> <span className="text-secondary text-sm">{label}</span>
            </div>
            <div className={`font-bold ${colorClass}`} style={{ fontSize: 28 }}>{value}</div>
          </div>
        ))}
      </motion.div>

      {/* Filter Tabs */}
      <motion.div variants={fadeInUp} className="flex gap-8 mb-16">
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`btn font-medium ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ borderRadius: 20, textTransform: 'capitalize' }}>
            {s}
          </button>
        ))}
      </motion.div>

      {/* Queue */}
      <motion.div variants={fadeInUp}>
        {loading ? <div className="spinner">Loading...</div> : queue.length === 0 ? (
          <div className="card text-center" style={{ padding: 60 }}>
            <Shield size={48} color="var(--text-tertiary)" />
            <p className="text-secondary mt-8">No {filter} approvals</p>
            {filter === 'pending' && <p className="text-tertiary text-base">AI-optimized changes will appear here for your review before going live.</p>}
          </div>
        ) : (
          <div className="flex-col gap-12">
            {queue.map(item => {
              const badgeColor = priorityColorMap[item.priority] || 'gray';
              return (
                <div key={item.approval_id} className="card" style={{ borderLeftWidth: 4, borderLeftColor: `var(--${badgeColor === 'gray' ? 'text-secondary' : badgeColor})` }}>
                  <div className="flex justify-between" style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div className="flex items-center gap-8 mb-8">
                        <span className={`badge ${getPriorityBadgeClass(item.priority)}`} style={{ textTransform: 'uppercase' }}>
                          {item.priority}
                        </span>
                        <span className="badge badge-gray">
                          {item.entity_type} / {item.action}
                        </span>
                        {item.segment_label && <span className="text-xs text-secondary">Segment: {item.segment_label}</span>}
                      </div>
                      <div className="font-semibold" style={{ fontSize: 15, marginBottom: 4 }}>{item.entity_name || `${item.entity_type} #${item.entity_id}`}</div>
                      {item.changes_summary && <div className="text-base text-secondary mb-4">{item.changes_summary}</div>}
                      {item.ai_reasoning && (
                        <div className="text-sm text-secondary mt-8" style={{ background: 'var(--bg-secondary)', padding: 8, borderRadius: 6 }}>
                          <strong>AI Reasoning:</strong> {item.ai_reasoning}
                        </div>
                      )}
                      {item.ai_confidence && (
                        <div className="text-sm text-secondary mt-8">
                          AI Confidence: <span className={`font-semibold ${getConfidenceClass(item.ai_confidence)}`}>{item.ai_confidence}%</span>
                        </div>
                      )}
                      <div className="text-xs text-tertiary mt-8">
                        Requested by {item.requested_by} at {new Date(item.requested_at).toLocaleString()}
                        {item.reviewed_by && ` | Reviewed by ${item.reviewed_by} at ${new Date(item.reviewed_at).toLocaleString()}`}
                      </div>
                    </div>
                    {item.status === 'pending' && (
                      <div className="flex gap-8" style={{ marginLeft: 16 }}>
                        <button onClick={() => handleApprove(item.approval_id)} className="btn btn-success">
                          <Check size={14} /> Approve
                        </button>
                        <button onClick={() => handleReject(item.approval_id)} className="btn btn-danger">
                          <X size={14} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
