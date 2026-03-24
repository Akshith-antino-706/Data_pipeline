import { useState, useEffect } from 'react';
import { getApprovalQueue, getApprovalStats, approveItem, rejectItem, aiAnalyzeStrategies } from '../api';
import { Shield, Check, X, Clock, AlertTriangle, Brain } from 'lucide-react';

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
      setQueue(q);
      setStats(s);
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

  const priorityColors = { critical: '#ef4444', high: '#fbbf24', normal: '#dc2626', low: '#6b7280' };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>Human Approval</h1>
          <p style={{ color: '#78716c', margin: 0 }}>Review and approve AI-optimized strategies, campaigns, and content before activation</p>
        </div>
        <button onClick={handleAnalyze} disabled={analyzing}
          style={{ padding: '10px 20px', borderRadius: 10, border: '2px solid #dc2626', background: analyzing ? '#fef2f2' : '#dc2626', color: analyzing ? '#dc2626' : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={16} /> {analyzing ? 'Analyzing Strategies...' : 'AI Analyze All Strategies'}
        </button>
      </div>

      {analysisResult && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#166534' }}>
            AI Analysis Complete — {analysisResult.analyzed} strategies analyzed, {analysisResult.suggestions_created} suggestions created
          </div>
          {analysisResult.suggestions?.map((s, i) => (
            <div key={i} style={{ fontSize: 12, color: '#15803d', marginTop: 4 }}>
              • <b>{s.segment}</b>: {s.summary}
            </div>
          ))}
          {analysisResult.suggestions_created === 0 && (
            <div style={{ fontSize: 12, color: '#15803d' }}>All strategies look healthy. No changes suggested.</div>
          )}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Pending', value: stats.pending_count || 0, icon: Clock, color: '#fbbf24' },
          { label: 'Approved', value: stats.approved_count || 0, icon: Check, color: '#22c55e' },
          { label: 'Rejected', value: stats.rejected_count || 0, icon: X, color: '#ef4444' },
          { label: 'Avg Review Time', value: stats.avg_review_hours ? `${stats.avg_review_hours}h` : 'N/A', icon: Shield, color: '#dc2626' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e7e5e4' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon size={16} color={color} /> <span style={{ color: '#78716c', fontSize: 12 }}>{label}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: '8px 20px', borderRadius: 20, border: filter === s ? '2px solid #dc2626' : '1px solid #e7e5e4', background: filter === s ? '#fef2f2' : 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500, textTransform: 'capitalize' }}>
            {s}
          </button>
        ))}
      </div>

      {/* Queue */}
      {loading ? <div className="spinner">Loading...</div> : queue.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 12, padding: 60, textAlign: 'center', border: '1px solid #e7e5e4' }}>
          <Shield size={48} color="#a8a29e" />
          <p style={{ color: '#78716c', marginTop: 12 }}>No {filter} approvals</p>
          {filter === 'pending' && <p style={{ color: '#a8a29e', fontSize: 13 }}>AI-optimized changes will appear here for your review before going live.</p>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {queue.map(item => (
            <div key={item.approval_id} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e7e5e4', borderLeft: `4px solid ${priorityColors[item.priority]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ padding: '2px 10px', borderRadius: 10, background: `${priorityColors[item.priority]}15`, color: priorityColors[item.priority], fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                      {item.priority}
                    </span>
                    <span style={{ padding: '2px 10px', borderRadius: 10, background: '#f5f5f4', fontSize: 11, fontWeight: 600 }}>
                      {item.entity_type} / {item.action}
                    </span>
                    {item.segment_label && <span style={{ fontSize: 11, color: '#78716c' }}>Segment: {item.segment_label}</span>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{item.entity_name || `${item.entity_type} #${item.entity_id}`}</div>
                  {item.changes_summary && <div style={{ fontSize: 13, color: '#78716c', marginBottom: 4 }}>{item.changes_summary}</div>}
                  {item.ai_reasoning && (
                    <div style={{ fontSize: 12, color: '#78716c', background: '#fafaf9', padding: 8, borderRadius: 6, marginTop: 8 }}>
                      <strong>AI Reasoning:</strong> {item.ai_reasoning}
                    </div>
                  )}
                  {item.ai_confidence && (
                    <div style={{ fontSize: 12, color: '#78716c', marginTop: 4 }}>
                      AI Confidence: <span style={{ fontWeight: 600, color: item.ai_confidence >= 80 ? '#22c55e' : item.ai_confidence >= 50 ? '#f59e0b' : '#ef4444' }}>{item.ai_confidence}%</span>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 8 }}>
                    Requested by {item.requested_by} at {new Date(item.requested_at).toLocaleString()}
                    {item.reviewed_by && ` | Reviewed by ${item.reviewed_by} at ${new Date(item.reviewed_at).toLocaleString()}`}
                  </div>
                </div>
                {item.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
                    <button onClick={() => handleApprove(item.approval_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                      <Check size={14} /> Approve
                    </button>
                    <button onClick={() => handleReject(item.approval_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
