import { useState, useEffect, useCallback } from 'react';
import { getFunnelOverview, getSegmentV3, runSegmentation, getSegmentSummary, getSegmentV3Customers, runV3MigrateAll, getSegmentAffinity, previewSegmentEmail, useSegmentEmail, createCampaign, executeCampaign, processQueue } from '../api';
import { Target, Users, Play, ChevronRight, ArrowLeft, Search, Database, RefreshCw, ShoppingBag, Clock, Megaphone, Package, Send, X, Eye, Loader, CheckCircle, AlertCircle } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const PRIORITY_COLORS = { Critical: '#dc2626', High: '#fbbf24', Medium: '#4caf50', Low: '#eab308' };
const CHANNEL_ICONS = { whatsapp: '📱', email: '✉️', sms: '💬', push: '🔔', rcs: '💎', web: '🌐' };

export default function SegmentsV2() {
  const [stages, setStages] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [custPage, setCustPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [custLoading, setCustLoading] = useState(false);
  const [affinity, setAffinity] = useState(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState(null);
  const [expandedStage, setExpandedStage] = useState(null);

  // Run Segment Campaign state
  const [runModal, setRunModal] = useState(false);
  const [runStep, setRunStep] = useState('preview'); // preview | running | done | error
  const [emailPreview, setEmailPreview] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [runError, setRunError] = useState(null);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [f, s] = await Promise.all([
        getFunnelOverview().catch(() => ({ data: [] })),
        getSegmentSummary().catch(() => ({ data: null }))
      ]);
      setStages(f.data || []);
      setSummary(s.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await runSegmentation();
      showToast(`Segmentation complete: ${res.data?.total_assigned || 0} assignments`, 'success');
      await loadData();
    } catch (err) { showToast(err.message, 'error'); }
    setRunning(false);
  };

  const openSegment = async (segId) => {
    setSelected(segId);
    setDetail(null);
    setCustomers(null);
    setAffinity(null);
    setCustPage(1);
    setDetailLoading(true);
    try {
      const [d, c, aff] = await Promise.all([
        getSegmentV3(segId),
        getSegmentV3Customers(segId, { page: 1, limit: 25 }),
        getSegmentAffinity(segId).catch(() => ({ data: null }))
      ]);
      setDetail(d.data);
      setCustomers(c);
      setAffinity(aff.data);
    } catch (err) { showToast('Failed to load segment details', 'error'); }
    setDetailLoading(false);
  };

  const loadCustPage = async (page) => {
    setCustPage(page);
    setCustLoading(true);
    try {
      const c = await getSegmentV3Customers(selected, { page, limit: 25, search });
      setCustomers(c);
    } catch (err) { showToast('Failed to load customers', 'error'); }
    setCustLoading(false);
  };

  const fmt = (n) => Number(n || 0).toLocaleString();
  const parseKeyPoints = (kp) => {
    if (Array.isArray(kp)) return kp;
    try { return JSON.parse(kp); } catch { return []; }
  };

  const openRunModal = async (segmentName) => {
    setRunModal(true);
    setRunStep('preview');
    setEmailPreview(null);
    setRunResult(null);
    setRunError(null);
    try {
      const res = await previewSegmentEmail(segmentName);
      setEmailPreview(res.data);
    } catch (err) {
      setEmailPreview({ error: 'No email template configured for this segment' });
    }
  };

  const executeSegmentCampaign = async (segmentName) => {
    setRunStep('running');
    setRunResult(null);
    setRunError(null);
    try {
      // Step 1: Create content template from segment
      const tplRes = await useSegmentEmail(segmentName);
      const templateId = tplRes.data?.id;
      if (!templateId) throw new Error('Failed to create email template');

      // Step 2: Create campaign
      const campRes = await createCampaign({
        name: `${segmentName} — Email Campaign`,
        segmentLabel: segmentName,
        channel: 'email',
        templateId: String(templateId),
      });
      const campaignId = campRes.data?.id;
      if (!campaignId) throw new Error('Failed to create campaign');

      // Step 3: Execute campaign (queue messages)
      const execRes = await executeCampaign(campaignId);
      const queued = execRes.data?.queued || 0;

      // Step 4: Process queue (send emails)
      const queueRes = await processQueue();
      const sent = queueRes.data?.sent || 0;
      const failed = queueRes.data?.failed || 0;

      setRunResult({ campaignId, queued, sent, failed, templateId });
      setRunStep('done');
    } catch (err) {
      setRunError(err.message || 'Campaign execution failed');
      setRunStep('error');
    }
  };

  if (loading) return <div className="spinner">Loading segments engine...</div>;

  // ── Segment Detail View ──────────────────────────────────
  if (selected) {
    if (detailLoading || !detail) return <div className="spinner">Loading segment details...</div>;

    const strat = detail.strategies?.[0];
    const steps = strat?.flow_steps || [];
    const m = detail.metrics || {};

    return (
      <div>
        <button className="btn btn-secondary" onClick={() => { setSelected(null); setDetail(null); }} style={{ marginBottom: 20 }}>
          <ArrowLeft size={14} /> Back to Segments
        </button>

        <div className="page-header">
          <div>
            <h2>{detail.segment_name}</h2>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <span className="badge" style={{ background: detail.stage_color + '25', color: detail.stage_color }}>{detail.stage_name}</span>
              <span className="badge" style={{ background: PRIORITY_COLORS[detail.priority] + '25', color: PRIORITY_COLORS[detail.priority] }}>{detail.priority} Priority</span>
              <span className="badge badge-blue">{detail.customer_type}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              className="btn btn-primary"
              onClick={() => openRunModal(detail.segment_name)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#dc2626', border: 'none', padding: '10px 20px', fontSize: 13, fontWeight: 600 }}
            >
              <Send size={14} /> Run Segment
            </button>
            <div className="kpi-value kpi-blue" style={{ fontSize: 24 }}>{fmt(detail.customer_count)}<span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 400, marginLeft: 6 }}>customers</span></div>
          </div>
        </div>

        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16, lineHeight: 1.7 }}>{detail.segment_description}</p>

        {/* Segment Logic — WHY this segment exists */}
        {detail.segment_logic && (
          <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #dc2626', background: 'var(--card)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <Database size={18} color="#dc2626" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#dc2626', marginBottom: 6, letterSpacing: '0.5px' }}>Segment Logic</div>
                <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, fontWeight: 500 }}>{detail.segment_logic}</div>
                {detail.data_sources && detail.data_sources.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', alignSelf: 'center' }}>Data Sources:</span>
                    {detail.data_sources.map((ds, i) => (
                      <span key={i} className="badge" style={{ fontSize: 10, background: '#4caf5020', color: '#4caf50', padding: '2px 8px' }}>{ds.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                )}
                {detail.department_filter && (
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
                    <span style={{ fontWeight: 600 }}>Department:</span> {detail.department_filter}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, fontFamily: 'monospace', background: 'var(--bg)', padding: '6px 10px', borderRadius: 6, overflowX: 'auto' }}>
                  SQL: {detail.sql_criteria}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="card-grid card-grid-4" style={{ marginBottom: 20 }}>
          <div className="card kpi"><div className="kpi-value kpi-blue">{fmt(m.total_customers)}</div><div className="kpi-label">Customers</div></div>
          <div className="card kpi"><div className="kpi-value kpi-green">{m.avg_bookings || '0'}</div><div className="kpi-label">Avg Bookings</div></div>
          <div className="card kpi"><div className="kpi-value kpi-purple">AED {fmt(m.avg_revenue)}</div><div className="kpi-label">Avg Revenue</div></div>
          <div className="card kpi"><div className="kpi-value kpi-orange">{m.avg_recency || '—'}</div><div className="kpi-label">Avg Recency (days)</div></div>
        </div>

        {/* Product Affinity — WHAT / WHEN / HOW */}
        {affinity && (
          <div className="card-grid card-grid-3" style={{ marginBottom: 20 }}>
            {/* WHAT to sell */}
            <div className="card" style={{ borderTop: '3px solid #dc2626' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <ShoppingBag size={18} color="#dc2626" />
                <h3 style={{ margin: 0, fontSize: 14 }}>What to Sell</h3>
              </div>
              {affinity.what?.hero?.product && (
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, marginBottom: 12, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Hero Product</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {affinity.what.hero.image && (
                      <img src={affinity.what.hero.image} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{affinity.what.hero.product}</div>
                      {affinity.what.hero.url && (
                        <a href={affinity.what.hero.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)' }}>View →</a>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Primary Products</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {(affinity.what?.primary || []).map((p, i) => (
                  <span key={i} className="badge badge-purple" style={{ fontSize: 10 }}>{p}</span>
                ))}
              </div>
              {affinity.what?.crossSell?.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Cross-Sell</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                    {affinity.what.crossSell.map((p, i) => (
                      <span key={i} className="badge badge-blue" style={{ fontSize: 10 }}>{p}</span>
                    ))}
                  </div>
                </>
              )}
              {affinity.what?.upsell?.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Upsell</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {affinity.what.upsell.map((p, i) => (
                      <span key={i} className="badge badge-green" style={{ fontSize: 10 }}>{p}</span>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 16, marginTop: 12, padding: '10px 0 0', borderTop: '1px solid var(--border)' }}>
                <div><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{affinity.what?.affinityScore || 0}</div><div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Affinity Score</div></div>
                <div><div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>AED {affinity.what?.expectedAOV || 0}</div><div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Expected AOV</div></div>
              </div>
            </div>

            {/* WHEN to sell */}
            <div className="card" style={{ borderTop: '3px solid #fbbf24' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Clock size={18} color="#fbbf24" />
                <h3 style={{ margin: 0, fontSize: 14 }}>When to Sell</h3>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Best Day & Time</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{affinity.when?.bestDay} at {affinity.when?.bestTime}</div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Urgency</div>
                  <div style={{ marginTop: 4 }}>
                    <span className={`badge ${affinity.when?.urgency === 'critical' ? 'badge-red' : affinity.when?.urgency === 'high' ? 'badge-orange' : affinity.when?.urgency === 'medium' ? 'badge-blue' : 'badge-green'}`}>
                      {affinity.when?.urgency?.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Frequency</div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{affinity.when?.frequency?.replace('_', ' ')}</div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Trigger Event</div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2, color: '#fbbf24' }}>{affinity.when?.trigger?.replace(/_/g, ' ')}</div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Follow-up Sequence</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {(affinity.when?.followUpDays || []).map((d, i) => (
                      <span key={i} style={{ background: '#fbbf2420', color: '#fbbf24', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Day {d}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* HOW to sell */}
            <div className="card" style={{ borderTop: '3px solid #10b981' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Megaphone size={18} color="#10b981" />
                <h3 style={{ margin: 0, fontSize: 14 }}>How to Sell</h3>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Channels</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <span className={`badge ${affinity.how?.channel?.primary === 'whatsapp' ? 'badge-green' : 'badge-blue'}`}>{affinity.how?.channel?.primary} (primary)</span>
                    <span className="badge badge-orange">{affinity.how?.channel?.secondary}</span>
                  </div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Tone</div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2, textTransform: 'capitalize' }}>{affinity.how?.tone}</div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Discount Strategy</div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2, color: '#10b981' }}>
                    {affinity.how?.discount?.strategy === 'no_discount' ? 'No Discount' : `${affinity.how?.discount?.value || ''} (${affinity.how?.discount?.strategy})`}
                  </div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>CTA</div>
                  <div style={{
                    marginTop: 6, display: 'inline-block', background: '#dc2626', color: '#fff',
                    padding: '6px 16px', borderRadius: 8, fontWeight: 600, fontSize: 13
                  }}>{affinity.how?.cta}</div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {affinity.how?.socialProof && (
                    <span style={{ background: '#dc262620', color: '#dc2626', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Social Proof</span>
                  )}
                  {affinity.how?.scarcity && (
                    <span style={{ background: '#ef444420', color: '#ef4444', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>Scarcity</span>
                  )}
                </div>
                <div style={{ padding: '10px 0 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Personalize With</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {(affinity.how?.personalization || []).map((f, i) => (
                      <span key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 4, fontSize: 10 }}>{f}</span>
                    ))}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>
                  {affinity.how?.expectedConversion || 0}% expected conversion
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Charts Row */}
        <div className="card-grid card-grid-2" style={{ marginBottom: 20 }}>
          <div className="card">
            <div className="card-header"><h3>Channel Reachability</h3></div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[
                { channel: 'WhatsApp', count: parseInt(m.whatsapp_reachable || 0) },
                { channel: 'Email', count: parseInt(m.email_reachable || 0) },
                { channel: 'SMS', count: parseInt(m.sms_reachable || 0) },
              ]}>
                <XAxis dataKey="channel" tick={{ fill: '#a8a29e', fontSize: 12 }} />
                <YAxis tick={{ fill: '#a8a29e', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div className="card-header"><h3>Gender Distribution</h3></div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={[
                  { name: 'Male', value: parseInt(m.male_count || 0) },
                  { name: 'Female', value: parseInt(m.female_count || 0) },
                  { name: 'Other', value: Math.max(0, parseInt(m.total_customers || 0) - parseInt(m.male_count || 0) - parseInt(m.female_count || 0)) }
                ].filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  <Cell fill="#dc2626" /><Cell fill="#fbbf24" /><Cell fill="#a8a29e" />
                </Pie>
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Strategy Flow */}
        {strat && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <h3>Omnichannel Strategy</h3>
              <span className="badge badge-green">{strat.name}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {steps.map((step, i) => {
                const ch = step.channel || 'email';
                const chColor = ch === 'whatsapp' ? '#22c55e' : ch === 'email' ? '#3b82f6' : ch === 'sms' ? '#f59e0b' : ch === 'push' ? '#ef4444' : ch === 'web' ? '#8b5cf6' : '#6b7280';
                return (
                  <div key={i}>
                    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 10, alignItems: 'stretch' }}>
                      {/* Day badge */}
                      <div style={{
                        background: chColor + '15', border: `2px solid ${chColor}`,
                        borderRadius: 10, padding: '8px 6px', textAlign: 'center',
                        fontWeight: 700, color: chColor, fontSize: 12,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2
                      }}>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>Day</div>
                        <div style={{ fontSize: 18 }}>{step.day}</div>
                      </div>
                      {/* Step content */}
                      <div style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 16 }}>{CHANNEL_ICONS[ch] || '📢'}</span>
                          <span className={`badge badge-${ch === 'whatsapp' ? 'green' : ch === 'email' ? 'blue' : ch === 'sms' ? 'orange' : ch === 'push' ? 'red' : 'purple'}`} style={{ fontSize: 10 }}>
                            {ch}
                          </span>
                          {step.condition && <span className="badge badge-orange" style={{ fontSize: 9 }}>CONDITION</span>}
                          {step.goal && <span className="badge badge-green" style={{ fontSize: 9 }}>GOAL</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{step.action || step.label || step.message || 'Send message'}</div>
                        {step.condition && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>⚡ {step.condition}</div>}
                        {step.condition_next && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>↳ {step.condition_next}</div>}
                        {step.goal && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 4, fontWeight: 600 }}>🎯 Goal: {step.goal}</div>}
                      </div>
                    </div>
                    {/* Connector line */}
                    {i < steps.length - 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 35, height: 16 }}>
                        <div style={{ width: 2, height: 16, background: 'var(--border)' }} />
                        {steps[i + 1].day > step.day && (
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 8 }}>
                            ⏳ Wait {steps[i + 1].day - step.day} day{steps[i + 1].day - step.day > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Key Points */}
        {detail.key_points && parseKeyPoints(detail.key_points).length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><h3>Key Points</h3></div>
            <div style={{ display: 'grid', gap: 8 }}>
              {parseKeyPoints(detail.key_points).map((pt, i) => (
                <div key={i} style={{
                  padding: '10px 14px', background: 'var(--bg)', borderRadius: 8,
                  fontSize: 13, color: 'var(--text-dim)', display: 'flex', gap: 10, alignItems: 'flex-start',
                  border: '1px solid var(--border)'
                }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: 16 }}>{i + 1}.</span>
                  {pt}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Customer Table */}
        <div className="card">
          <div className="card-header">
            <h3>Customers ({fmt(customers?.total || 0)})</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--text-dim)' }} />
                <input
                  className="input-sm"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadCustPage(1)}
                  placeholder="Search name or email..."
                  style={{ paddingLeft: 30, width: 240 }}
                />
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => loadCustPage(1)}>
                <Search size={12} />
              </button>
            </div>
          </div>
          <div className="table-wrap" style={{ opacity: custLoading ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            <table>
              <thead><tr>
                <th>Name</th><th>Email</th><th>Type</th><th>Nationality</th><th>Bookings</th><th>Revenue</th><th>Recency</th><th>Status</th>
              </tr></thead>
              <tbody>
                {(customers?.data || []).map(c => (
                  <tr key={c.customer_id}>
                    <td style={{ fontWeight: 500 }}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{c.email || '—'}</td>
                    <td><span className={`badge ${c.customer_type === 'B2B' ? 'badge-purple' : 'badge-blue'}`}>{c.customer_type}</span></td>
                    <td>{c.nationality || '—'}</td>
                    <td style={{ fontWeight: 500 }}>{c.total_bookings || 0}</td>
                    <td style={{ fontWeight: 500 }}>AED {fmt(c.total_revenue)}</td>
                    <td>{c.days_since_last_booking != null ? `${c.days_since_last_booking}d` : '—'}</td>
                    <td><span className={`badge ${c.lead_status === 'converted' ? 'badge-green' : c.lead_status === 'active' ? 'badge-blue' : 'badge-orange'}`}>{c.lead_status || 'new'}</span></td>
                  </tr>
                ))}
                {!customers?.data?.length && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                    {custLoading ? 'Loading...' : 'No customers in this segment yet. Run segmentation first.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {customers && customers.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-sm btn-secondary" disabled={custPage <= 1} onClick={() => loadCustPage(custPage - 1)}>Previous</button>
              <span style={{ fontSize: 13, padding: '4px 12px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center' }}>
                Page {custPage} of {customers.totalPages}
              </span>
              <button className="btn btn-sm btn-secondary" disabled={custPage >= customers.totalPages} onClick={() => loadCustPage(custPage + 1)}>Next</button>
            </div>
          )}
        </div>

        {/* Run Segment Modal */}
        {runModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
          }} onClick={() => runStep !== 'running' && setRunModal(false)}>
            <div style={{
              background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh',
              overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }} onClick={e => e.stopPropagation()}>

              {/* Modal Header */}
              <div style={{
                padding: '20px 24px', borderBottom: '1px solid #e7e5e4',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Run Segment Campaign</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#78716c' }}>
                    {detail.segment_name} — {fmt(detail.customer_count)} customers
                  </p>
                </div>
                {runStep !== 'running' && (
                  <button onClick={() => setRunModal(false)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#78716c'
                  }}><X size={20} /></button>
                )}
              </div>

              {/* Modal Body */}
              <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>

                {/* Preview Step */}
                {runStep === 'preview' && (
                  <>
                    {!emailPreview ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#78716c' }}>
                        <Loader size={24} className="spin" style={{ marginBottom: 12 }} />
                        <div>Loading email preview...</div>
                      </div>
                    ) : emailPreview.error ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#78716c' }}>
                        <AlertCircle size={32} color="#dc2626" style={{ marginBottom: 12 }} />
                        <div>{emailPreview.error}</div>
                      </div>
                    ) : (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, color: '#78716c', marginBottom: 4 }}>Subject Line</div>
                          <div style={{ fontWeight: 600, fontSize: 14, padding: '10px 14px', background: '#fafaf9', borderRadius: 8, border: '1px solid #e7e5e4' }}>
                            {emailPreview.subject || 'No subject'}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: '#78716c', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Eye size={12} /> Email Preview
                        </div>
                        <div style={{
                          border: '1px solid #e7e5e4', borderRadius: 10, overflow: 'hidden',
                          maxHeight: 400, overflowY: 'auto'
                        }}>
                          <iframe
                            srcDoc={emailPreview.html || '<p>No preview available</p>'}
                            title="Email Preview"
                            style={{ width: '100%', height: 380, border: 'none' }}
                            sandbox=""
                          />
                        </div>
                        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fefce8', borderRadius: 8, border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
                          This will send emails to all <strong>{fmt(detail.customer_count)}</strong> customers in this segment via SMTP. Make sure your email template is ready.
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Running Step */}
                {runStep === 'running' && (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <Loader size={32} className="spin" style={{ color: '#dc2626', marginBottom: 16 }} />
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Executing Campaign...</div>
                    <div style={{ fontSize: 13, color: '#78716c' }}>Creating template, queueing messages, and sending emails.</div>
                    <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 8 }}>Please don't close this modal.</div>
                  </div>
                )}

                {/* Done Step */}
                {runStep === 'done' && runResult && (
                  <div style={{ textAlign: 'center', padding: 30 }}>
                    <CheckCircle size={48} color="#22c55e" style={{ marginBottom: 16 }} />
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#1c1917' }}>Campaign Executed!</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 20 }}>
                      <div style={{ background: '#fafaf9', borderRadius: 10, padding: 16, border: '1px solid #e7e5e4' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{runResult.queued}</div>
                        <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>Queued</div>
                      </div>
                      <div style={{ background: '#f0fdf4', borderRadius: 10, padding: 16, border: '1px solid #bbf7d0' }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>{runResult.sent}</div>
                        <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>Sent</div>
                      </div>
                      <div style={{ background: runResult.failed > 0 ? '#fef2f2' : '#fafaf9', borderRadius: 10, padding: 16, border: `1px solid ${runResult.failed > 0 ? '#fecaca' : '#e7e5e4'}` }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: runResult.failed > 0 ? '#dc2626' : '#a8a29e' }}>{runResult.failed}</div>
                        <div style={{ fontSize: 11, color: '#78716c', marginTop: 4 }}>Failed</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 16, fontSize: 12, color: '#78716c' }}>
                      Campaign #{runResult.campaignId} — Check the Campaigns page for detailed tracking.
                    </div>
                  </div>
                )}

                {/* Error Step */}
                {runStep === 'error' && (
                  <div style={{ textAlign: 'center', padding: 30 }}>
                    <AlertCircle size={48} color="#dc2626" style={{ marginBottom: 16 }} />
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#dc2626' }}>Campaign Failed</div>
                    <div style={{ fontSize: 13, color: '#78716c', marginBottom: 16 }}>{runError}</div>
                    <button className="btn btn-secondary" onClick={() => setRunStep('preview')}>Try Again</button>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              {runStep === 'preview' && emailPreview && !emailPreview.error && (
                <div style={{
                  padding: '16px 24px', borderTop: '1px solid #e7e5e4',
                  display: 'flex', justifyContent: 'flex-end', gap: 10
                }}>
                  <button className="btn btn-secondary" onClick={() => setRunModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => executeSegmentCampaign(detail.segment_name)}
                    style={{ background: '#dc2626', border: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px' }}
                  >
                    <Send size={14} /> Send Campaign
                  </button>
                </div>
              )}

              {runStep === 'done' && (
                <div style={{ padding: '16px 24px', borderTop: '1px solid #e7e5e4', display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={() => setRunModal(false)}
                    style={{ background: '#22c55e', border: 'none', padding: '10px 20px' }}>
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    );
  }

  // ── Main Funnel View ─────────────────────────────────────
  const totalCustomers = parseInt(summary?.total_customers) || 0;
  const segmentedCustomers = parseInt(summary?.segmented_customers) || 0;
  const segPct = totalCustomers > 0 ? ((segmentedCustomers / totalCustomers) * 100).toFixed(1) : '0.0';

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Customer Segments</h2>
          <div className="page-header-sub">28 segments across 7 funnel stages</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadData} title="Refresh data">
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-primary" onClick={handleRun} disabled={running}>
            <Play size={14} /> {running ? 'Running...' : 'Run Segmentation'}
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="card-grid card-grid-4" style={{ marginBottom: 24 }}>
        <div className="card kpi">
          <div className="kpi-value kpi-blue">{fmt(totalCustomers)}</div>
          <div className="kpi-label">Total Customers</div>
        </div>
        <div className="card kpi">
          <div className="kpi-value kpi-green">{fmt(segmentedCustomers)}</div>
          <div className="kpi-label">Segmented ({segPct}%)</div>
        </div>
        <div className="card kpi">
          <div className="kpi-value kpi-purple">{summary?.total_segments || 0}</div>
          <div className="kpi-label">Total Segments</div>
        </div>
        <div className="card kpi">
          <div className="kpi-value kpi-orange">{summary?.active_strategies || 0}</div>
          <div className="kpi-label">Active Strategies</div>
        </div>
      </div>

      {/* Stage Distribution Chart */}
      {summary?.stages && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h3>Funnel Stage Distribution</h3></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary.stages.map(s => ({
              name: s.stage_name?.split(' - ')[0] || s.stage_name,
              customers: parseInt(s.customer_count || 0),
              color: s.stage_color
            }))}>
              <XAxis dataKey="name" tick={{ fill: '#a8a29e', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fill: '#a8a29e', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e7e5e4', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="customers" radius={[6, 6, 0, 0]}>
                {summary.stages.map((s, i) => <Cell key={i} fill={s.stage_color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 7 Funnel Stages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {stages.map(stage => {
          const segments = stage.segments || [];
          const isExpanded = expandedStage === stage.stage_number;
          const totalInStage = segments.reduce((sum, s) => sum + (parseInt(s.customer_count) || 0), 0);

          return (
            <div key={stage.stage_id} className="card" style={{ borderLeft: `4px solid ${stage.stage_color}`, padding: isExpanded ? 20 : '16px 20px' }}>
              <div
                role="button"
                tabIndex={0}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setExpandedStage(isExpanded ? null : stage.stage_number)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpandedStage(isExpanded ? null : stage.stage_number)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: stage.stage_color, color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0
                  }}>
                    {stage.stage_number}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{stage.stage_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 1 }}>{stage.stage_description}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                  <span className="badge badge-blue">{segments.length} segments</span>
                  <div style={{ textAlign: 'right', minWidth: 60 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{fmt(totalInStage)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>customers</div>
                  </div>
                  <ChevronRight size={18} style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-dim)' }} />
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                  {segments.map(seg => (
                    <div
                      key={seg.segment_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openSegment(seg.segment_id)}
                      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && openSegment(seg.segment_id)}
                      className="card"
                      style={{
                        padding: '14px 16px', cursor: 'pointer',
                        borderLeft: `3px solid ${PRIORITY_COLORS[seg.priority]}`,
                        background: 'var(--bg)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{seg.segment_number}. {seg.segment_name}</span>
                            <span className="badge" style={{ background: PRIORITY_COLORS[seg.priority] + '20', color: PRIORITY_COLORS[seg.priority], fontSize: 10 }}>
                              {seg.priority}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {seg.segment_logic || seg.segment_description}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, marginLeft: 16 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, fontSize: 18 }}>{fmt(seg.customer_count)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>customers</div>
                          </div>
                          <ChevronRight size={16} color="var(--text-dim)" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
