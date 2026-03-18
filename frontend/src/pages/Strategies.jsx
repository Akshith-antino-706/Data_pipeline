import { useState, useEffect } from 'react';
import { getStrategies, getStrategy, createStrategy, optimizeStrategy, getSegments } from '../api';
import { Zap, Plus, Brain, ChevronRight } from 'lucide-react';

const STATUS_BADGE = { active: 'badge-green', paused: 'badge-orange', archived: 'badge-gray' };
const CHANNELS = ['whatsapp', 'email', 'sms', 'push'];

export default function Strategies() {
  const [strategies, setStrategies] = useState([]);
  const [segments, setSegments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [optimizing, setOptimizing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '', segmentLabel: '', channels: [], flowSteps: [] });

  useEffect(() => {
    Promise.all([getStrategies(), getSegments()])
      .then(([s, seg]) => {
        setStrategies(s.data || []);
        // getSegments returns flat array of segment objects (segment_name, customer_count)
        const segArr = Array.isArray(seg) ? seg : (seg?.data || []);
        setSegments(segArr);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const selectStrategy = async (id) => {
    const data = await getStrategy(id);
    setSelected(data.data);
  };

  const handleCreate = async () => {
    const data = await createStrategy(form);
    setStrategies([data.data, ...strategies]);
    setShowCreate(false);
    setForm({ name: '', description: '', segmentLabel: '', channels: [], flowSteps: [] });
  };

  const handleOptimize = async (id) => {
    setOptimizing(id);
    try {
      const result = await optimizeStrategy(id);
      setSelected(prev => prev?.id === id ? { ...prev, ai_score: result.data.score, ai_suggestions: JSON.stringify(result.data.suggestions) } : prev);
      // Refresh list
      const s = await getStrategies();
      setStrategies(s.data);
    } catch (err) { console.error(err); }
    setOptimizing(null);
  };

  const addFlowStep = () => {
    setForm(f => ({
      ...f,
      flowSteps: [...f.flowSteps, { day: f.flowSteps.length * 3, channel: 'whatsapp', templateId: null }],
    }));
  };

  if (loading) return <div className="spinner">Loading strategies...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Omnichannel Strategies</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New Strategy</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 20 }}>
        {/* Strategy List */}
        <div className="card">
          <div className="card-header"><h3>All Strategies ({strategies.length})</h3></div>
          {strategies.length === 0 ? (
            <div className="empty">No strategies yet. Create one to get started.</div>
          ) : (
            <div>
              {strategies.map(s => (
                <div key={s.id} onClick={() => selectStrategy(s.id)}
                  style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: selected?.id === s.id ? 'var(--bg-hover)' : 'transparent' }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 8 }}>
                      <span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                      <span>Segment: {s.segment_label}</span>
                      <span>Size: {Number(s.segment_size || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {s.ai_score && (
                      <span className={`badge ${s.ai_score >= 70 ? 'badge-green' : s.ai_score >= 40 ? 'badge-orange' : 'badge-red'}`}>
                        AI: {s.ai_score}
                      </span>
                    )}
                    <ChevronRight size={16} color="var(--text-dim)" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Strategy Detail */}
        {selected && (
          <div className="card">
            <div className="card-header">
              <h3>{selected.name}</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => handleOptimize(selected.id)} disabled={optimizing === selected.id}>
                <Brain size={14} /> {optimizing === selected.id ? 'Analyzing...' : 'AI Optimize'}
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>{selected.description || 'No description'}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
                <span className="badge badge-purple">Segment: {selected.segment_label}</span>
                <span className="badge badge-blue">Audience: {Number(selected.segment_size || 0).toLocaleString()}</span>
                {(Array.isArray(selected.channels) ? selected.channels : (selected.channels || '').replace(/[{}]/g, '').split(',').filter(Boolean)).map(ch => (
                  <span key={ch} className={`badge badge-${ch === 'whatsapp' ? 'green' : ch === 'email' ? 'blue' : ch === 'sms' ? 'orange' : 'red'}`}>{ch}</span>
                ))}
              </div>
            </div>

            {/* AI Score */}
            {selected.ai_score != null && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>AI Health Score</div>
                <div className="progress-bar" style={{ marginBottom: 6 }}>
                  <div className="progress-fill" style={{ width: `${selected.ai_score}%`, background: selected.ai_score >= 70 ? 'var(--green)' : selected.ai_score >= 40 ? 'var(--orange)' : 'var(--red)' }} />
                </div>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{selected.ai_score}/100</span>
              </div>
            )}

            {/* AI Suggestions */}
            {selected.ai_suggestions && (() => {
              const suggestions = typeof selected.ai_suggestions === 'string' ? JSON.parse(selected.ai_suggestions) : selected.ai_suggestions;
              return suggestions.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>AI Suggestions</div>
                  {suggestions.map((s, i) => (
                    <div key={i} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                      <span className={`badge ${s.severity === 'high' ? 'badge-red' : 'badge-orange'}`} style={{ marginRight: 8 }}>{s.type}</span>
                      {s.message}
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            {/* Flow Steps */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Flow Steps</div>
              {(typeof selected.flow_steps === 'string' ? JSON.parse(selected.flow_steps) : selected.flow_steps || []).map((step, i, arr) => (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 8, marginBottom: 2 }}>
                    <span className="badge badge-gray" style={{ minWidth: 50, textAlign: 'center' }}>Day {step.day}</span>
                    <span className={`badge badge-${step.channel === 'whatsapp' ? 'green' : step.channel === 'email' ? 'blue' : step.channel === 'sms' ? 'orange' : step.channel === 'push' ? 'red' : 'purple'}`}>{step.channel}</span>
                    <span style={{ flex: 1, fontWeight: 500, fontSize: 13 }}>{step.action || step.label || 'Send message'}</span>
                    {step.condition && <span className="badge badge-orange" style={{ fontSize: 11 }}>{step.condition}</span>}
                    {step.goal && <span className="badge badge-green" style={{ fontSize: 11 }}>{step.goal}</span>}
                  </div>
                  {i < arr.length - 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 30, height: 20 }}>
                      <div style={{ width: 2, height: 20, background: 'var(--border)', marginRight: 8 }} />
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {arr[i + 1].day - step.day > 0 ? `Wait ${arr[i + 1].day - step.day} day${arr[i + 1].day - step.day > 1 ? 's' : ''}` : 'Immediately'}
                        {step.condition_next ? ` → ${step.condition_next}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {(!selected.flow_steps || (Array.isArray(selected.flow_steps) && selected.flow_steps.length === 0)) && (
                <div className="empty" style={{ padding: 20 }}>No flow steps defined</div>
              )}
            </div>

            {/* Campaigns under this strategy */}
            {selected.campaigns?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Campaigns</div>
                <table>
                  <thead><tr><th>Name</th><th>Channel</th><th>Status</th><th>Sent</th><th>Delivered</th></tr></thead>
                  <tbody>
                    {selected.campaigns.map(c => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td className={`channel-${c.channel}`}>{c.channel}</td>
                        <td><span className={`badge ${c.status === 'completed' ? 'badge-green' : c.status === 'running' ? 'badge-blue' : 'badge-gray'}`}>{c.status}</span></td>
                        <td>{c.sent_count}</td>
                        <td>{c.delivered_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Strategy Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Omnichannel Strategy</h3>
            <div className="form-group">
              <label>Strategy Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q1 Re-engagement Campaign" />
            </div>
            <div className="form-group">
              <label>Target Segment</label>
              <select value={form.segmentLabel} onChange={e => setForm({ ...form, segmentLabel: e.target.value })}>
                <option value="">Select segment...</option>
                {segments.map(s => <option key={s.segment_name || s.segment_label} value={s.segment_name || s.segment_label}>{s.segment_name || s.segment_label} ({s.customer_count || s.total || 0})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Strategy description..." />
            </div>
            <div className="form-group">
              <label>Channels</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {CHANNELS.map(ch => (
                  <button key={ch} className={`btn btn-sm ${form.channels.includes(ch) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setForm(f => ({ ...f, channels: f.channels.includes(ch) ? f.channels.filter(c => c !== ch) : [...f.channels, ch] }))}>
                    {ch}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Flow Steps</label>
              {form.flowSteps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input type="number" placeholder="Day" value={step.day} onChange={e => {
                    const steps = [...form.flowSteps];
                    steps[i] = { ...steps[i], day: parseInt(e.target.value) || 0 };
                    setForm({ ...form, flowSteps: steps });
                  }} style={{ width: 80 }} />
                  <select value={step.channel} onChange={e => {
                    const steps = [...form.flowSteps];
                    steps[i] = { ...steps[i], channel: e.target.value };
                    setForm({ ...form, flowSteps: steps });
                  }}>
                    {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" onClick={addFlowStep}><Plus size={12} /> Add Step</button>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name || !form.segmentLabel}>Create Strategy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
