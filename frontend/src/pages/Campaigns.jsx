import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getCampaigns, getCampaign, createCampaign, executeCampaign, getSegments, getTemplates, getStrategies } from '../api';
import { useBusinessType } from '../App';
import { Plus, Play, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const STATUS_BADGE = { draft: 'badge-gray', scheduled: 'badge-blue', running: 'badge-purple', paused: 'badge-orange', completed: 'badge-green', failed: 'badge-red' };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

export default function Campaigns() {
  const { businessType } = useBusinessType();
  const [campaigns, setCampaigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', segmentLabel: '', channel: 'email', templateId: '', strategyId: '' });

  useEffect(() => {
    Promise.allSettled([getCampaigns({ limit: 100 }), getSegments(), getTemplates({ limit: 100 }), getStrategies()])
      .then(([c, s, t, st]) => {
        if (c.status === 'fulfilled') setCampaigns(c.value.data || []);
        if (s.status === 'fulfilled') setSegments(Array.isArray(s.value) ? s.value : (s.value.data || []));
        if (t.status === 'fulfilled') setTemplates(t.value.data || []);
        if (st.status === 'fulfilled') setStrategies(st.value.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const selectCampaign = async (id) => {
    try {
      const data = await getCampaign(id);
      setSelected(data.data || null);
    } catch (err) { console.error(err); }
  };

  const handleCreate = async () => {
    try {
      const data = await createCampaign({
        ...form,
        templateId: parseInt(form.templateId),
        strategyId: form.strategyId ? parseInt(form.strategyId) : null,
      });
      if (data.data) setCampaigns([data.data, ...campaigns]);
      setShowCreate(false);
      setForm({ name: '', segmentLabel: '', channel: 'email', templateId: '', strategyId: '' });
    } catch (err) { console.error(err); }
  };

  const handleExecute = async (id) => {
    try {
      await executeCampaign(id);
      const updated = await getCampaigns();
      setCampaigns(updated.data || []);
      selectCampaign(id);
    } catch (err) { console.error(err); }
  };

  if (loading) return <div className="spinner">Loading campaigns...</div>;

  const fmt = (n) => Number(n || 0).toLocaleString();

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      <motion.div variants={fadeInUp} className="page-header">
        <h2>Campaigns</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New Campaign</button>
      </motion.div>

      <motion.div variants={fadeInUp} className={`split-pane ${selected ? 'has-detail' : ''}`}>
        {/* Campaign List */}
        <div className="card">
          <div className="card-header"><h3>All Campaigns ({campaigns.length})</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Campaign</th><th>Channel</th><th>Segment</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {campaigns.filter(c => {
                  const seg = (c.segment_label || '').toUpperCase();
                  if (businessType === 'B2B') return seg.startsWith('B2B');
                  return !seg.startsWith('B2B');
                }).map(c => (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td className={`channel-${c.channel}`}>{c.channel}</td>
                    <td>{c.segment_label}</td>
                    <td><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                    <td>{fmt(c.sent_count)}</td>
                    <td>{fmt(c.delivered_count)}</td>
                    <td>
                      <div className="flex gap-4">
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
            <div className="card-grid card-grid-3 mb-16">
              <div className="text-center" style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--blue)' }}>{fmt(selected.target_count)}</div>
                <div className="text-xs text-secondary">TARGET</div>
              </div>
              <div className="text-center" style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--green)' }}>{fmt(selected.sent_count)}</div>
                <div className="text-xs text-secondary">SENT</div>
              </div>
              <div className="text-center" style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--purple)' }}>{fmt(selected.delivered_count)}</div>
                <div className="text-xs text-secondary">DELIVERED</div>
              </div>
            </div>

            <div className="card-grid card-grid-4 mb-16">
              <div className="text-center" style={{ padding: 8 }}>
                <div className="text-xl font-semibold">{fmt(selected.read_count)}</div>
                <div className="text-xs text-secondary">Read</div>
              </div>
              <div className="text-center" style={{ padding: 8 }}>
                <div className="text-xl font-semibold">{fmt(selected.clicked_count)}</div>
                <div className="text-xs text-secondary">Clicked</div>
              </div>
              <div className="text-center" style={{ padding: 8 }}>
                <div className="text-xl font-semibold" style={{ color: 'var(--red)' }}>{fmt(selected.bounced_count)}</div>
                <div className="text-xs text-secondary">Bounced</div>
              </div>
              <div className="text-center" style={{ padding: 8 }}>
                <div className="text-xl font-semibold" style={{ color: 'var(--red)' }}>{fmt(selected.failed_count)}</div>
                <div className="text-xs text-secondary">Failed</div>
              </div>
            </div>

            {/* Status Breakdown */}
            {selected.statusBreakdown?.length > 0 && (
              <div className="mb-16">
                <div className="text-sm text-secondary mb-8">Message Status</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={selected.statusBreakdown} layout="vertical">
                    <XAxis type="number" stroke="var(--text-tertiary)" fontSize={11} />
                    <YAxis type="category" dataKey="status" stroke="var(--text-tertiary)" fontSize={11} width={70} />
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                    <Bar dataKey="count" fill="var(--red)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Template Preview */}
            {selected.template_body && (
              <div>
                <div className="text-sm text-secondary mb-8">Template Preview</div>
                {selected.template_subject && <div className="font-semibold mb-6">{selected.template_subject}</div>}
                <div className="text-base" style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, maxHeight: 200, overflow: 'auto' }}
                  dangerouslySetInnerHTML={{ __html: selected.template_body }} />
              </div>
            )}
          </div>
        )}
      </motion.div>

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
                {segments.map(s => <option key={s.segment_label || s.segment_name} value={s.segment_label || s.segment_name}>{s.segment_label || s.segment_name} ({s.total || s.customer_count || 0})</option>)}
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
    </motion.div>
  );
}
