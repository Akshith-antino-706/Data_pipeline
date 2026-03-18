import { useState, useEffect } from 'react';
import { getCampaigns, getCampaign, createCampaign, executeCampaign, getSegments, getTemplates, getStrategies } from '../api';
import { Plus, Play, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const STATUS_BADGE = { draft: 'badge-gray', scheduled: 'badge-blue', running: 'badge-purple', paused: 'badge-orange', completed: 'badge-green', failed: 'badge-red' };

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', segmentLabel: '', channel: 'email', templateId: '', strategyId: '' });

  useEffect(() => {
    Promise.all([getCampaigns(), getSegments(), getTemplates(), getStrategies()])
      .then(([c, s, t, st]) => {
        setCampaigns(c.data);
        setSegments(s.data);
        setTemplates(t.data);
        setStrategies(st.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const selectCampaign = async (id) => {
    const data = await getCampaign(id);
    setSelected(data.data);
  };

  const handleCreate = async () => {
    const data = await createCampaign({
      ...form,
      templateId: parseInt(form.templateId),
      strategyId: form.strategyId ? parseInt(form.strategyId) : null,
    });
    setCampaigns([data.data, ...campaigns]);
    setShowCreate(false);
    setForm({ name: '', segmentLabel: '', channel: 'email', templateId: '', strategyId: '' });
  };

  const handleExecute = async (id) => {
    await executeCampaign(id);
    const updated = await getCampaigns();
    setCampaigns(updated.data);
    selectCampaign(id);
  };

  if (loading) return <div className="spinner">Loading campaigns...</div>;

  const fmt = (n) => Number(n || 0).toLocaleString();

  return (
    <div>
      <div className="page-header">
        <h2>Campaigns</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New Campaign</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 20 }}>
        {/* Campaign List */}
        <div className="card">
          <div className="card-header"><h3>All Campaigns ({campaigns.length})</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Campaign</th><th>Channel</th><th>Segment</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td className={`channel-${c.channel}`}>{c.channel}</td>
                    <td>{c.segment_label}</td>
                    <td><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                    <td>{fmt(c.sent_count)}</td>
                    <td>{fmt(c.delivered_count)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => selectCampaign(c.id)}><Eye size={12} /></button>
                        {['draft', 'scheduled'].includes(c.status) && (
                          <button className="btn btn-success btn-sm" onClick={() => handleExecute(c.id)}><Play size={12} /> Launch</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && <tr><td colSpan={7} className="empty">No campaigns yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Campaign Detail */}
        {selected && (
          <div className="card">
            <div className="card-header">
              <h3>{selected.name}</h3>
              <span className={`badge ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
            </div>

            {/* KPI Row */}
            <div className="card-grid card-grid-3" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--blue)' }}>{fmt(selected.target_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>TARGET</div>
              </div>
              <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>{fmt(selected.sent_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>SENT</div>
              </div>
              <div style={{ textAlign: 'center', padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>{fmt(selected.delivered_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>DELIVERED</div>
              </div>
            </div>

            <div className="card-grid card-grid-4" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(selected.read_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Read</div>
              </div>
              <div style={{ textAlign: 'center', padding: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(selected.clicked_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Clicked</div>
              </div>
              <div style={{ textAlign: 'center', padding: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--red)' }}>{fmt(selected.bounced_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Bounced</div>
              </div>
              <div style={{ textAlign: 'center', padding: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--red)' }}>{fmt(selected.failed_count)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Failed</div>
              </div>
            </div>

            {/* Status Breakdown */}
            {selected.statusBreakdown?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Message Status</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={selected.statusBreakdown} layout="vertical">
                    <XAxis type="number" stroke="#a8a29e" fontSize={11} />
                    <YAxis type="category" dataKey="status" stroke="#a8a29e" fontSize={11} width={70} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                    <Bar dataKey="count" fill="#dc2626" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Template Preview */}
            {selected.template_body && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>Template Preview</div>
                {selected.template_subject && <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.template_subject}</div>}
                <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, fontSize: 13, maxHeight: 200, overflow: 'auto' }}
                  dangerouslySetInnerHTML={{ __html: selected.template_body }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Campaign</h3>
            <div className="form-group">
              <label>Campaign Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. March Dormant Re-engagement" />
            </div>
            <div className="form-group">
              <label>Target Segment</label>
              <select value={form.segmentLabel} onChange={e => setForm({ ...form, segmentLabel: e.target.value })}>
                <option value="">Select...</option>
                {segments.map(s => <option key={s.segment_label} value={s.segment_label}>{s.segment_label} ({s.total})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Channel</label>
              <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
                {['whatsapp', 'email', 'sms', 'push'].map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Template</label>
              <select value={form.templateId} onChange={e => setForm({ ...form, templateId: e.target.value })}>
                <option value="">Select...</option>
                {templates.filter(t => !form.channel || t.channel === form.channel).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.channel})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Strategy (optional)</label>
              <select value={form.strategyId} onChange={e => setForm({ ...form, strategyId: e.target.value })}>
                <option value="">None</option>
                {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!form.name || !form.segmentLabel || !form.templateId}>Create Campaign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
