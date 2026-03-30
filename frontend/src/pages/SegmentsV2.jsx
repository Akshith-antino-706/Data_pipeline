import { useState, useEffect, useCallback } from 'react';
import { getFunnelOverview, getSegmentV3, runSegmentation, getSegmentSummary, getSegmentV3Customers, runV3MigrateAll, getSegmentAffinity, previewSegmentEmail, useSegmentEmail, createCampaign, executeCampaign, processQueue } from '../api';
import { Target, Users, Play, ChevronRight, ArrowLeft, Search, Database, RefreshCw, ShoppingBag, Clock, Megaphone, Package, Send, X, Eye, Loader, CheckCircle, AlertCircle, MessageCircle, Mail, MessageSquare, Bell, Gem, Globe } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

const PRIORITY_COLORS = { Critical: 'var(--red)', High: 'var(--yellow)', Medium: 'var(--green)', Low: 'var(--orange)' };

const CHANNEL_ICON_MAP = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare, push: Bell, rcs: Gem, web: Globe };
const ChannelIcon = ({ channel, size = 14 }) => { const Icon = CHANNEL_ICON_MAP[channel]; return Icon ? <Icon size={size} /> : null; };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

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
        <button className="btn btn-secondary mb-24" onClick={() => { setSelected(null); setDetail(null); }}>
          <ArrowLeft size={14} /> Back to Segments
        </button>

        <div className="page-header">
          <div>
            <h2>{detail.segment_name}</h2>
            <div className="flex gap-8 flex-wrap" style={{ marginTop: 8 }}>
              <span className="badge" style={{ background: detail.stage_color + '25', color: detail.stage_color }}>{detail.stage_name}</span>
              <span className="badge" style={{ background: PRIORITY_COLORS[detail.priority] + '25', color: PRIORITY_COLORS[detail.priority] }}>{detail.priority} Priority</span>
              <span className="badge badge-blue">{detail.customer_type}</span>
            </div>
          </div>
          <div className="flex items-center gap-16">
            <button
              className="btn btn-primary flex items-center gap-6"
              onClick={() => openRunModal(detail.segment_name)}
              style={{ background: 'var(--red)', border: 'none', padding: '10px 20px', fontSize: 13, fontWeight: 600 }}
            >
              <Send size={14} /> Run Segment
            </button>
            <div className="kpi-value kpi-blue" style={{ fontSize: 24 }}>{fmt(detail.customer_count)}<span className="text-sm text-secondary" style={{ fontWeight: 400, marginLeft: 6 }}>customers</span></div>
          </div>
        </div>

        <p className="text-secondary mb-16" style={{ fontSize: 14, lineHeight: 1.7 }}>{detail.segment_description}</p>

        {/* Segment Logic — WHY this segment exists */}
        {detail.segment_logic && (
          <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--red)', background: 'var(--bg-card)' }}>
            <div className="flex" style={{ alignItems: 'flex-start', gap: 12 }}>
              <Database size={18} color="var(--red)" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="font-bold" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--red)', marginBottom: 6, letterSpacing: '0.5px' }}>Segment Logic</div>
                <div className="font-medium" style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6 }}>{detail.segment_logic}</div>
                {detail.data_sources && (Array.isArray(detail.data_sources) ? detail.data_sources : typeof detail.data_sources === 'string' ? detail.data_sources.replace(/[{}]/g, '').split(',').filter(Boolean) : []).length > 0 && (
                  <div className="flex gap-6 flex-wrap" style={{ marginTop: 10 }}>
                    <span className="text-xs text-secondary" style={{ alignSelf: 'center' }}>Data Sources:</span>
                    {(Array.isArray(detail.data_sources) ? detail.data_sources : typeof detail.data_sources === 'string' ? detail.data_sources.replace(/[{}]/g, '').split(',').filter(Boolean) : []).map((ds, i) => (
                      <span key={i} className="badge" style={{ fontSize: 10, background: 'var(--green-dim)', color: 'var(--green)', padding: '2px 8px' }}>{ds.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                )}
                {detail.department_filter && (
                  <div className="text-sm text-secondary" style={{ marginTop: 8 }}>
                    <span className="font-semibold">Department:</span> {detail.department_filter}
                  </div>
                )}
                <div className="text-xs text-secondary" style={{ marginTop: 8, fontFamily: 'monospace', background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: 6, overflowX: 'auto' }}>
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
            <div className="card" style={{ borderTop: '3px solid var(--red)' }}>
              <div className="flex items-center gap-8 mb-16">
                <ShoppingBag size={18} color="var(--red)" />
                <h3 style={{ margin: 0, fontSize: 14 }}>What to Sell</h3>
              </div>
              {affinity.what?.hero?.product && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 12, marginBottom: 12, border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary mb-4">Hero Product</div>
                  <div className="flex items-center" style={{ gap: 10 }}>
                    {affinity.what.hero.image && (
                      <img src={affinity.what.hero.image} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                    )}
                    <div>
                      <div className="font-semibold" style={{ fontSize: 13 }}>{affinity.what.hero.product}</div>
                      {affinity.what.hero.url && (
                        <a href={affinity.what.hero.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--red)' }}>View →</a>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="text-xs text-secondary" style={{ marginBottom: 6 }}>Primary Products</div>
              <div className="flex flex-wrap gap-4" style={{ marginBottom: 10 }}>
                {(affinity.what?.primary || []).map((p, i) => (
                  <span key={i} className="badge badge-purple" style={{ fontSize: 10 }}>{p}</span>
                ))}
              </div>
              {affinity.what?.crossSell?.length > 0 && (
                <>
                  <div className="text-xs text-secondary" style={{ marginBottom: 6 }}>Cross-Sell</div>
                  <div className="flex flex-wrap gap-4" style={{ marginBottom: 10 }}>
                    {affinity.what.crossSell.map((p, i) => (
                      <span key={i} className="badge badge-blue" style={{ fontSize: 10 }}>{p}</span>
                    ))}
                  </div>
                </>
              )}
              {affinity.what?.upsell?.length > 0 && (
                <>
                  <div className="text-xs text-secondary" style={{ marginBottom: 6 }}>Upsell</div>
                  <div className="flex flex-wrap gap-4">
                    {affinity.what.upsell.map((p, i) => (
                      <span key={i} className="badge badge-green" style={{ fontSize: 10 }}>{p}</span>
                    ))}
                  </div>
                </>
              )}
              <div className="flex gap-16" style={{ marginTop: 12, padding: '10px 0 0', borderTop: '1px solid var(--border-color)' }}>
                <div><div className="font-bold" style={{ fontSize: 18, color: 'var(--red)' }}>{affinity.what?.affinityScore || 0}</div><div className="text-xs text-secondary">Affinity Score</div></div>
                <div><div className="font-bold" style={{ fontSize: 18, color: 'var(--green)' }}>AED {affinity.what?.expectedAOV || 0}</div><div className="text-xs text-secondary">Expected AOV</div></div>
              </div>
            </div>

            {/* WHEN to sell */}
            <div className="card" style={{ borderTop: '3px solid var(--yellow)' }}>
              <div className="flex items-center gap-8 mb-16">
                <Clock size={18} color="var(--yellow)" />
                <h3 style={{ margin: 0, fontSize: 14 }}>When to Sell</h3>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Best Day & Time</div>
                  <div className="font-semibold" style={{ fontSize: 15, marginTop: 2 }}>{affinity.when?.bestDay} at {affinity.when?.bestTime}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Urgency</div>
                  <div style={{ marginTop: 4 }}>
                    <span className={`badge ${affinity.when?.urgency === 'critical' ? 'badge-red' : affinity.when?.urgency === 'high' ? 'badge-orange' : affinity.when?.urgency === 'medium' ? 'badge-blue' : 'badge-green'}`}>
                      {affinity.when?.urgency?.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Frequency</div>
                  <div className="font-semibold" style={{ fontSize: 14, marginTop: 2 }}>{affinity.when?.frequency?.replace('_', ' ')}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Trigger Event</div>
                  <div className="font-semibold" style={{ fontSize: 13, marginTop: 2, color: 'var(--yellow)' }}>{affinity.when?.trigger?.replace(/_/g, ' ')}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Follow-up Sequence</div>
                  <div className="flex gap-6" style={{ marginTop: 4 }}>
                    {(affinity.when?.followUpDays || []).map((d, i) => (
                      <span key={i} className="font-semibold" style={{ background: 'var(--yellow-dim)', color: 'var(--yellow)', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>Day {d}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* HOW to sell */}
            <div className="card" style={{ borderTop: '3px solid var(--green)' }}>
              <div className="flex items-center gap-8 mb-16">
                <Megaphone size={18} color="var(--green)" />
                <h3 style={{ margin: 0, fontSize: 14 }}>How to Sell</h3>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Channels</div>
                  <div className="flex gap-6" style={{ marginTop: 4 }}>
                    <span className={`badge ${affinity.how?.channel?.primary === 'whatsapp' ? 'badge-green' : 'badge-blue'}`}>{affinity.how?.channel?.primary} (primary)</span>
                    <span className="badge badge-orange">{affinity.how?.channel?.secondary}</span>
                  </div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Tone</div>
                  <div className="font-semibold" style={{ fontSize: 14, marginTop: 2, textTransform: 'capitalize' }}>{affinity.how?.tone}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Discount Strategy</div>
                  <div className="font-semibold" style={{ fontSize: 14, marginTop: 2, color: 'var(--green)' }}>
                    {affinity.how?.discount?.strategy === 'no_discount' ? 'No Discount' : `${affinity.how?.discount?.value || ''} (${affinity.how?.discount?.strategy})`}
                  </div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">CTA</div>
                  <div className="font-semibold" style={{
                    marginTop: 6, display: 'inline-block', background: 'var(--red)', color: 'var(--bg-card)',
                    padding: '6px 16px', borderRadius: 8, fontSize: 13
                  }}>{affinity.how?.cta}</div>
                </div>
                <div className="flex" style={{ gap: 10 }}>
                  {affinity.how?.socialProof && (
                    <span className="font-semibold" style={{ background: 'var(--red-dim)', color: 'var(--red)', padding: '4px 10px', borderRadius: 6, fontSize: 11 }}>Social Proof</span>
                  )}
                  {affinity.how?.scarcity && (
                    <span className="font-semibold" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--red)', padding: '4px 10px', borderRadius: 6, fontSize: 11 }}>Scarcity</span>
                  )}
                </div>
                <div style={{ padding: '10px 0 0', borderTop: '1px solid var(--border-color)' }}>
                  <div className="text-xs text-secondary">Personalize With</div>
                  <div className="flex flex-wrap gap-4" style={{ marginTop: 4 }}>
                    {(affinity.how?.personalization || []).map((f, i) => (
                      <span key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', padding: '2px 8px', borderRadius: 4, fontSize: 10 }}>{f}</span>
                    ))}
                  </div>
                </div>
                <div className="font-bold" style={{ fontSize: 14, color: 'var(--green)' }}>
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
                <XAxis dataKey="channel" tick={{ fill: 'var(--text-tertiary)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                <Bar dataKey="count" fill="var(--red)" radius={[4, 4, 0, 0]} />
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
                  <Cell fill="var(--red)" /><Cell fill="var(--yellow)" /><Cell fill="var(--text-tertiary)" />
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
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
                const chColor = ch === 'whatsapp' ? 'var(--green)' : ch === 'email' ? 'var(--blue)' : ch === 'sms' ? 'var(--orange)' : ch === 'push' ? 'var(--red)' : ch === 'web' ? 'var(--purple)' : 'var(--text-tertiary)';
                return (
                  <div key={i}>
                    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 10, alignItems: 'stretch' }}>
                      {/* Day badge */}
                      <div className="text-center font-bold" style={{
                        background: chColor + '15', border: `2px solid ${chColor}`,
                        borderRadius: 10, padding: '8px 6px',
                        color: chColor, fontSize: 12,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2
                      }}>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>Day</div>
                        <div style={{ fontSize: 18 }}>{step.day}</div>
                      </div>
                      {/* Step content */}
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border-color)' }}>
                        <div className="flex items-center gap-8 mb-4">
                          <ChannelIcon channel={ch} size={16} />
                          <span className={`badge badge-${ch === 'whatsapp' ? 'green' : ch === 'email' ? 'blue' : ch === 'sms' ? 'orange' : ch === 'push' ? 'red' : 'purple'}`} style={{ fontSize: 10 }}>
                            {ch}
                          </span>
                          {step.condition && <span className="badge badge-orange" style={{ fontSize: 9 }}>CONDITION</span>}
                          {step.goal && <span className="badge badge-green" style={{ fontSize: 9 }}>GOAL</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6 }}>{step.action || step.label || step.message || 'Send message'}</div>
                        {step.condition && <div className="text-xs" style={{ color: 'var(--orange)', marginTop: 4 }}>⚡ {step.condition}</div>}
                        {step.condition_next && <div className="text-xs" style={{ color: 'var(--orange)', marginTop: 4 }}>↳ {step.condition_next}</div>}
                        {step.goal && <div className="text-xs font-semibold" style={{ color: 'var(--green)', marginTop: 4 }}>🎯 Goal: {step.goal}</div>}
                      </div>
                    </div>
                    {/* Connector line */}
                    {i < steps.length - 1 && (
                      <div className="flex items-center" style={{ paddingLeft: 35, height: 16 }}>
                        <div style={{ width: 2, height: 16, background: 'var(--border-color)' }} />
                        {steps[i + 1].day > step.day && (
                          <span className="text-xs text-secondary" style={{ marginLeft: 8 }}>
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
                <div key={i} className="flex text-secondary" style={{
                  padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8,
                  fontSize: 13, gap: 10, alignItems: 'flex-start',
                  border: '1px solid var(--border-color)'
                }}>
                  <span className="font-bold" style={{ color: 'var(--red)', minWidth: 16 }}>{i + 1}.</span>
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
            <div className="flex items-center gap-8">
              <div style={{ position: 'relative' }}>
                <Search size={14} className="text-secondary" style={{ position: 'absolute', left: 10, top: 9 }} />
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
                    <td className="font-medium">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td className="text-sm text-secondary">{c.email || '—'}</td>
                    <td><span className={`badge ${c.customer_type === 'B2B' ? 'badge-purple' : 'badge-blue'}`}>{c.customer_type}</span></td>
                    <td>{c.nationality || '—'}</td>
                    <td className="font-medium">{c.total_bookings || 0}</td>
                    <td className="font-medium">AED {fmt(c.total_revenue)}</td>
                    <td>{c.days_since_last_booking != null ? `${c.days_since_last_booking}d` : '—'}</td>
                    <td><span className={`badge ${c.lead_status === 'converted' ? 'badge-green' : c.lead_status === 'active' ? 'badge-blue' : 'badge-orange'}`}>{c.lead_status || 'new'}</span></td>
                  </tr>
                ))}
                {!customers?.data?.length && (
                  <tr><td colSpan={8} className="text-center text-secondary p-24">
                    {custLoading ? 'Loading...' : 'No customers in this segment yet. Run segmentation first.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {customers && customers.totalPages > 1 && (
            <div className="flex justify-between items-center" style={{ justifyContent: 'center', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-sm btn-secondary" disabled={custPage <= 1} onClick={() => loadCustPage(custPage - 1)}>Previous</button>
              <span className="text-secondary flex items-center" style={{ fontSize: 13, padding: '4px 12px' }}>
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
              background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 720, maxHeight: '90vh',
              overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }} onClick={e => e.stopPropagation()}>

              {/* Modal Header */}
              <div className="flex justify-between items-center" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Run Segment Campaign</h3>
                  <p className="text-secondary" style={{ margin: '4px 0 0', fontSize: 13 }}>
                    {detail.segment_name} — {fmt(detail.customer_count)} customers
                  </p>
                </div>
                {runStep !== 'running' && (
                  <button onClick={() => setRunModal(false)} className="text-secondary" style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 4
                  }}><X size={20} /></button>
                )}
              </div>

              {/* Modal Body */}
              <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>

                {/* Preview Step */}
                {runStep === 'preview' && (
                  <>
                    {!emailPreview ? (
                      <div className="text-center text-secondary p-24">
                        <Loader size={24} className="spin" style={{ marginBottom: 12 }} />
                        <div>Loading email preview...</div>
                      </div>
                    ) : emailPreview.error ? (
                      <div className="text-center text-secondary p-24">
                        <AlertCircle size={32} color="var(--red)" style={{ marginBottom: 12 }} />
                        <div>{emailPreview.error}</div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-16">
                          <div className="text-sm text-secondary mb-4">Subject Line</div>
                          <div className="font-semibold" style={{ fontSize: 14, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                            {emailPreview.subject || 'No subject'}
                          </div>
                        </div>
                        <div className="text-sm text-secondary flex items-center gap-6 mb-8">
                          <Eye size={12} /> Email Preview
                        </div>
                        <div style={{
                          border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden',
                          maxHeight: 400, overflowY: 'auto'
                        }}>
                          <iframe
                            srcDoc={emailPreview.html || '<p>No preview available</p>'}
                            title="Email Preview"
                            style={{ width: '100%', height: 380, border: 'none' }}
                            sandbox=""
                          />
                        </div>
                        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--yellow-dim)', borderRadius: 8, border: '1px solid var(--yellow)', fontSize: 12, color: 'var(--orange)' }}>
                          This will send emails to all <strong>{fmt(detail.customer_count)}</strong> customers in this segment via SMTP. Make sure your email template is ready.
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Running Step */}
                {runStep === 'running' && (
                  <div className="text-center p-24">
                    <Loader size={32} className="spin" style={{ color: 'var(--red)', marginBottom: 16 }} />
                    <div className="font-semibold mb-8" style={{ fontSize: 16 }}>Executing Campaign...</div>
                    <div className="text-secondary" style={{ fontSize: 13 }}>Creating template, queueing messages, and sending emails.</div>
                    <div className="text-tertiary" style={{ fontSize: 12, marginTop: 8 }}>Please don't close this modal.</div>
                  </div>
                )}

                {/* Done Step */}
                {runStep === 'done' && runResult && (
                  <div className="text-center" style={{ padding: 30 }}>
                    <CheckCircle size={48} color="var(--green)" style={{ marginBottom: 16 }} />
                    <div className="font-bold mb-8" style={{ fontSize: 18, color: 'var(--text-primary)' }}>Campaign Executed!</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 20 }}>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 16, border: '1px solid var(--border-color)' }}>
                        <div className="font-bold" style={{ fontSize: 24, color: 'var(--red)' }}>{runResult.queued}</div>
                        <div className="text-xs text-secondary" style={{ marginTop: 4 }}>Queued</div>
                      </div>
                      <div style={{ background: 'var(--green-dim)', borderRadius: 10, padding: 16, border: '1px solid var(--green)' }}>
                        <div className="font-bold" style={{ fontSize: 24, color: 'var(--green)' }}>{runResult.sent}</div>
                        <div className="text-xs text-secondary" style={{ marginTop: 4 }}>Sent</div>
                      </div>
                      <div style={{ background: runResult.failed > 0 ? 'var(--red-dim)' : 'var(--bg-secondary)', borderRadius: 10, padding: 16, border: `1px solid ${runResult.failed > 0 ? 'var(--red)' : 'var(--border-color)'}` }}>
                        <div className="font-bold" style={{ fontSize: 24, color: runResult.failed > 0 ? 'var(--red)' : 'var(--text-tertiary)' }}>{runResult.failed}</div>
                        <div className="text-xs text-secondary" style={{ marginTop: 4 }}>Failed</div>
                      </div>
                    </div>
                    <div className="text-sm text-secondary" style={{ marginTop: 16 }}>
                      Campaign #{runResult.campaignId} — Check the Campaigns page for detailed tracking.
                    </div>
                  </div>
                )}

                {/* Error Step */}
                {runStep === 'error' && (
                  <div className="text-center" style={{ padding: 30 }}>
                    <AlertCircle size={48} color="var(--red)" style={{ marginBottom: 16 }} />
                    <div className="font-semibold mb-8" style={{ fontSize: 16, color: 'var(--red)' }}>Campaign Failed</div>
                    <div className="text-secondary mb-16" style={{ fontSize: 13 }}>{runError}</div>
                    <button className="btn btn-secondary" onClick={() => setRunStep('preview')}>Try Again</button>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              {runStep === 'preview' && emailPreview && !emailPreview.error && (
                <div className="flex justify-between" style={{
                  padding: '16px 24px', borderTop: '1px solid var(--border-color)',
                  justifyContent: 'flex-end', gap: 10
                }}>
                  <button className="btn btn-secondary" onClick={() => setRunModal(false)}>Cancel</button>
                  <button
                    className="btn btn-primary flex items-center gap-6"
                    onClick={() => executeSegmentCampaign(detail.segment_name)}
                    style={{ background: 'var(--red)', border: 'none', padding: '10px 20px' }}
                  >
                    <Send size={14} /> Send Campaign
                  </button>
                </div>
              )}

              {runStep === 'done' && (
                <div className="flex" style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={() => setRunModal(false)}
                    style={{ background: 'var(--green)', border: 'none', padding: '10px 20px' }}>
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
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      <motion.div variants={fadeInUp}>
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
      </motion.div>

      {/* Summary KPIs */}
      <motion.div variants={fadeInUp}>
      <div className="card-grid card-grid-4 mb-24">
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
        <div className="card mb-24">
          <div className="card-header"><h3>Funnel Stage Distribution</h3></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary.stages.map(s => ({
              name: s.stage_name?.split(' - ')[0] || s.stage_name,
              customers: parseInt(s.customer_count || 0),
              color: s.stage_color
            }))}>
              <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
              <Bar dataKey="customers" radius={[6, 6, 0, 0]}>
                {summary.stages.map((s, i) => <Cell key={i} fill={s.stage_color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      </motion.div>

      {/* 7 Funnel Stages */}
      <motion.div variants={fadeInUp}>
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
                className="flex justify-between items-center"
                style={{ cursor: 'pointer' }}
                onClick={() => setExpandedStage(isExpanded ? null : stage.stage_number)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpandedStage(isExpanded ? null : stage.stage_number)}
              >
                <div className="flex items-center" style={{ gap: 14 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: stage.stage_color, color: 'var(--bg-card)', fontWeight: 800, fontSize: 16, flexShrink: 0
                  }}>
                    {stage.stage_number}
                  </div>
                  <div>
                    <div className="font-semibold" style={{ fontSize: 15 }}>{stage.stage_name}</div>
                    <div className="text-sm text-secondary" style={{ marginTop: 1 }}>{stage.stage_description}</div>
                  </div>
                </div>
                <div className="flex items-center" style={{ gap: 14, flexShrink: 0 }}>
                  <span className="badge badge-blue">{segments.length} segments</span>
                  <div style={{ textAlign: 'right', minWidth: 60 }}>
                    <div className="font-bold" style={{ fontSize: 16 }}>{fmt(totalInStage)}</div>
                    <div className="text-xs text-secondary">customers</div>
                  </div>
                  <ChevronRight size={18} className="text-secondary" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
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
                        background: 'var(--bg-secondary)'
                      }}
                    >
                      <div className="flex justify-between items-center">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="flex items-center gap-8 flex-wrap">
                            <span className="font-semibold" style={{ fontSize: 14 }}>{seg.segment_number}. {seg.segment_name}</span>
                            <span className="badge" style={{ background: PRIORITY_COLORS[seg.priority] + '20', color: PRIORITY_COLORS[seg.priority], fontSize: 10 }}>
                              {seg.priority}
                            </span>
                          </div>
                          <div className="text-sm text-secondary" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {seg.segment_logic || seg.segment_description}
                          </div>
                        </div>
                        <div className="flex items-center gap-12" style={{ flexShrink: 0, marginLeft: 16 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div className="font-bold" style={{ fontSize: 18 }}>{fmt(seg.customer_count)}</div>
                            <div className="text-xs text-secondary">customers</div>
                          </div>
                          <ChevronRight size={16} color="var(--text-secondary)" />
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
      </motion.div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </motion.div>
  );
}
