import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getTemplates, createTemplate, approveTemplate, rejectTemplate, generateContent, getSegments, generateContentWithProducts, getSegmentProducts, getBaseTemplates, previewBaseTemplate, useBaseTemplate, getSegmentEmailTemplates, previewSegmentEmail, useSegmentEmail, createCampaign, executeCampaign, previewTemplate } from '../api';
import { Plus, Sparkles, Check, X, Image, Eye, Package, Send, Layout, ShoppingCart, Tag, Heart, UserCheck, Mail, Users, Play, Loader, CheckCircle, AlertCircle } from 'lucide-react';

const CHANNELS = ['whatsapp', 'email', 'sms', 'push'];
const STATUS_BADGE = { draft: 'badge-gray', pending_approval: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

// ── Design System CSS Variables ──────────────────────────────
// Colors now come from CSS custom properties (dark-mode-first design system)

export default function Content() {
  const [templates, setTemplates] = useState([]);
  const [segments, setSegments] = useState([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showPreview, setShowPreview] = useState(null);
  const [showProductGen, setShowProductGen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [productGenResult, setProductGenResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [baseTemplates, setBaseTemplates] = useState([]);
  const [showBaseGallery, setShowBaseGallery] = useState(false);
  const [basePreview, setBasePreview] = useState(null);
  const [basePreviewHtml, setBasePreviewHtml] = useState('');
  const [savingBase, setSavingBase] = useState(false);
  const [segmentTemplates, setSegmentTemplates] = useState([]);
  const [galleryTab, setGalleryTab] = useState('base');
  const [segPreview, setSegPreview] = useState(null);
  const [segPreviewHtml, setSegPreviewHtml] = useState('');
  const [startingCampaign, setStartingCampaign] = useState({});
  const [form, setForm] = useState({ name: '', channel: 'email', subject: '', body: '', ctaText: '', ctaUrl: '', variables: [] });
  const [genForm, setGenForm] = useState({ channel: 'whatsapp', segmentLabel: '', tone: 'professional', goal: '' });
  const [prodGenForm, setProdGenForm] = useState({ segmentLabel: '', channel: 'email', heading: '', couponCode: 'RAYNOW', productCount: 3 });

  const loadTemplates = async (channel) => {
    const params = { limit: 500 };
    if (channel && channel !== 'all') params.channel = channel;
    const data = await getTemplates(params);
    setTemplates(data.data || []);
    setTotal(data.total || 0);
  };

  useEffect(() => {
    Promise.all([getTemplates({ limit: 500 }), getSegments(), getBaseTemplates(), getSegmentEmailTemplates()])
      .then(([t, s, bt, st]) => {
        setTemplates(t.data || []); setTotal(t.total || 0); setSegments(Array.isArray(s) ? s : (s.data || [])); setBaseTemplates(bt.data || []); setSegmentTemplates(st.data || []);
        // Auto-open template if ?templateId= is in URL
        const params = new URLSearchParams(window.location.search);
        const tid = params.get('templateId');
        if (tid) {
          const tpl = (t.data || []).find(tp => String(tp.id) === tid);
          if (tpl) setShowPreview(tpl);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleTabChange = (channel) => { setTab(channel); loadTemplates(channel); };

  const handleCreate = async () => {
    const data = await createTemplate({ ...form, ...(generated?.aiGenerated && { aiGenerated: true, aiPrompt: generated.aiPrompt, aiModel: generated.aiModel }) });
    if (data.data) setTemplates([data.data, ...templates]);
    setShowCreate(false);
    setForm({ name: '', channel: 'email', subject: '', body: '', ctaText: '', ctaUrl: '', variables: [] });
    setGenerated(null);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateContent(genForm);
      setGenerated(result.data);
      setForm(f => ({ ...f, channel: genForm.channel, name: `AI: ${genForm.segmentLabel} - ${genForm.channel}`, subject: result.data.subject || '', body: result.data.body || '', ctaText: result.data.ctaText || '', ctaUrl: result.data.ctaUrl || '' }));
      setShowGenerate(false);
      setShowCreate(true);
    } catch (err) { console.error(err); }
    setGenerating(false);
  };

  const handleProductGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateContentWithProducts(prodGenForm);
      setProductGenResult(result.data);
    } catch (err) { console.error(err); }
    setGenerating(false);
  };

  const handleApprove = async (id) => { await approveTemplate(id); loadTemplates(tab); };
  const handleReject = async (id) => { await rejectTemplate(id); loadTemplates(tab); };

  const handleBasePreview = async (tpl) => {
    setBasePreview(tpl);
    try {
      const res = await previewBaseTemplate(tpl.id);
      setBasePreviewHtml(res.data?.html || '');
    } catch (err) { console.error(err); }
  };

  const handleUseBaseTemplate = async (tpl) => {
    setSavingBase(true);
    try {
      const res = await useBaseTemplate(tpl.id, { name: `${tpl.name} — ${new Date().toLocaleDateString()}` });
      setTemplates([res.data, ...templates]);
      setTotal(total + 1);
      setShowBaseGallery(false);
      setBasePreview(null);
      setBasePreviewHtml('');
    } catch (err) { console.error(err); }
    setSavingBase(false);
  };

  const handleSegPreview = async (segName) => {
    setSegPreview(segName);
    try {
      const res = await previewSegmentEmail(segName);
      setSegPreviewHtml(res.data?.html || '');
    } catch (err) { console.error(err); }
  };

  const handleUseSegTemplate = async (segName) => {
    setSavingBase(true);
    try {
      const res = await useSegmentEmail(segName, { name: `${segName} — Email Template` });
      setTemplates([res.data, ...templates]);
      setTotal(total + 1);
      setShowBaseGallery(false);
      setSegPreview(null);
      setSegPreviewHtml('');
    } catch (err) { console.error(err); }
    setSavingBase(false);
  };

  const handleStartCampaign = async (segName, segConfig) => {
    setStartingCampaign(prev => ({ ...prev, [segName]: 'loading' }));
    try {
      const tplRes = await useSegmentEmail(segName, { name: `${segName} — Campaign ${new Date().toLocaleDateString()}` });
      const templateId = tplRes.data?.id;
      if (!templateId) throw new Error('Failed to create template');

      const campRes = await createCampaign({
        name: `${segName} — Email Campaign`,
        segmentLabel: segName,
        channel: 'email',
        templateId,
      });
      const campaignId = campRes.data?.id;
      if (!campaignId) throw new Error('Failed to create campaign');

      await executeCampaign(campaignId);

      setStartingCampaign(prev => ({ ...prev, [segName]: 'success' }));
      setTimeout(() => setStartingCampaign(prev => { const n = { ...prev }; delete n[segName]; return n; }), 3000);
    } catch (err) {
      console.error('Start campaign error:', err);
      setStartingCampaign(prev => ({ ...prev, [segName]: 'error' }));
      setTimeout(() => setStartingCampaign(prev => { const n = { ...prev }; delete n[segName]; return n; }), 3000);
    }
  };

  if (loading) return <div className="spinner">Loading templates...</div>;

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: 24 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── Header ─────────────────────────────────────── */}
      <motion.div variants={fadeInUp} className="card-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Content Templates</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>{total} templates across {CHANNELS.length} channels · Real Rayna Tours products</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowBaseGallery(true)} style={{ gap: 6 }}>
            <Layout size={14} /> Base Templates
          </button>
          <button className="btn" onClick={() => setShowProductGen(true)} style={{ gap: 6, background: 'var(--yellow)', color: 'var(--text-primary)', border: 'none' }}>
            <Package size={14} /> Generate with Products
          </button>
          <button className="btn btn-primary" onClick={() => setShowGenerate(true)} style={{ gap: 6 }}>
            <Sparkles size={14} /> AI Generate
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ gap: 6 }}>
            <Plus size={14} /> New Template
          </button>
        </div>
      </motion.div>

      {/* ── Channel Tabs ──────────────────────────────── */}
      <motion.div variants={fadeInUp} className="tabs" style={{ marginBottom: 20 }}>
        {['all', ...CHANNELS].map(ch => (
          <button key={ch} onClick={() => handleTabChange(ch)}
            className={`tab ${tab === ch ? 'active' : ''}`}
            style={{ textTransform: 'capitalize' }}>
            {ch === 'all' ? `All (${total})` : ch}
          </button>
        ))}
      </motion.div>

      {/* ── Template Grid ─────────────────────────────── */}
      <motion.div variants={fadeInUp} className="grid-auto">
        {templates.map(t => (
          <div key={t.id} className="card card-flush" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {t.media_url && (
              <div style={{ height: 140, overflow: 'hidden', position: 'relative' }}>
                <img src={t.media_url} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
                  <span className={t.channel === 'whatsapp' ? 'badge-green' : t.channel === 'email' ? 'badge-red' : 'badge-orange'} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{t.channel}</span>
                </div>
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                  <span className={t.status === 'approved' ? 'badge-green' : t.status === 'rejected' ? 'badge-red' : 'badge-orange'} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{t.status}</span>
                </div>
              </div>
            )}
            {!t.media_url && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px 0' }}>
                <span className={t.channel === 'whatsapp' ? 'badge-green' : t.channel === 'email' ? 'badge-red' : 'badge-orange'} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{t.channel}</span>
                <span className={t.status === 'approved' ? 'badge-green' : t.status === 'rejected' ? 'badge-red' : 'badge-orange'} style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{t.status}</span>
              </div>
            )}
            <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t.name}</div>
              {t.segment_label && <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginBottom: 6 }}>{t.segment_label}</div>}
              {t.subject && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Subject: {t.subject}</div>}
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', maxHeight: 60, overflow: 'hidden', marginBottom: 12, flex: 1 }}>
                {t.body?.replace(/<[^>]*>/g, '').slice(0, 120)}...
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {t.ai_generated && <span className="badge-orange" style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>AI</span>}
                {t.cta_text && <span style={{ padding: '2px 8px', borderRadius: 8, background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: 10 }}>CTA: {t.cta_text}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                <button onClick={async () => {
                  if (t.channel === 'email') {
                    setShowPreview({ ...t, _previewHtml: null });
                    try {
                      const res = await previewTemplate(t.id);
                      setShowPreview({ ...t, _previewHtml: res.data?.html || t.body });
                    } catch {
                      setShowPreview({ ...t, _previewHtml: t.body });
                    }
                  } else {
                    setShowPreview(t);
                  }
                }} className="btn btn-ghost btn-sm" style={{ flex: 1, gap: 4 }}>
                  <Eye size={12} /> Preview
                </button>
                {t.status === 'draft' && (
                  <>
                    <button onClick={() => handleApprove(t.id)} className="btn btn-sm" style={{ gap: 4, background: 'var(--green)', color: '#fff', border: 'none' }}>
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => handleReject(t.id)} className="btn btn-primary btn-sm" style={{ gap: 4 }}>
                      <X size={12} /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {templates.length === 0 && (
          <div className="card" style={{ gridColumn: '1/-1', padding: 60, textAlign: 'center' }}>
            <Package size={48} style={{ color: 'var(--text-tertiary)' }} />
            <p style={{ color: 'var(--text-secondary)', marginTop: 12 }}>No templates yet. Generate with products or create manually.</p>
          </div>
        )}
      </motion.div>

      {/* ── Preview Modal ─────────────────────────────── */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowPreview(null)}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '90vh', overflow: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>{showPreview.name}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{showPreview.channel} · {showPreview.segment_label} · {showPreview.status}</div>
              </div>
              <button onClick={() => setShowPreview(null)} className="btn btn-ghost btn-sm"><X size={18} /></button>
            </div>
            {showPreview.media_url && (
              <div style={{ padding: '0 24px', marginTop: 16 }}>
                <img src={showPreview.media_url} alt="Template" style={{ width: '100%', borderRadius: 12, maxHeight: 200, objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ padding: 24 }}>
              {showPreview.subject && <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>Subject: {showPreview.subject}</div>}
              {showPreview.channel === 'email' ? (
                showPreview._previewHtml ? (
                  <iframe srcDoc={showPreview._previewHtml} style={{ width: '100%', minWidth: 700, height: 700, border: '1px solid var(--border-color)', borderRadius: 8 }} title="Email Preview" />
                ) : (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading preview...</div>
                )
              ) : (
                <div style={{ background: showPreview.channel === 'whatsapp' ? 'var(--green-dim)' : 'var(--bg-secondary)', padding: 16, borderRadius: 12, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {showPreview.body?.replace(/<[^>]*>/g, '')}
                </div>
              )}
              {showPreview.cta_url && (
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <a href={showPreview.cta_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'inline-block', padding: '10px 24px', textDecoration: 'none' }}>
                    {showPreview.cta_text || 'Click Here'}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Product Content Generator Modal ────────── */}
      {showProductGen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setShowProductGen(false); setProductGenResult(null); }}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}><Package size={20} style={{ color: 'var(--yellow)' }} /> Generate Content with Real Products</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>Creates email/WA content with real Rayna Tours product images and pricing</p>
            </div>
            <div style={{ padding: 24 }}>
              <div className="card-grid card-grid-2" style={{ marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target Segment</label>
                  <select value={prodGenForm.segmentLabel} onChange={e => setProdGenForm({...prodGenForm, segmentLabel: e.target.value})}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}>
                    <option value="">Select segment...</option>
                    {segments.map(s => <option key={s.segment_label || s.segment_name} value={s.segment_label || s.segment_name}>{s.segment_label || s.segment_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Channel</label>
                  <select value={prodGenForm.channel} onChange={e => setProdGenForm({...prodGenForm, channel: e.target.value})}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}>
                    <option value="email">Email (HTML with images)</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Heading</label>
                  <input value={prodGenForm.heading} onChange={e => setProdGenForm({...prodGenForm, heading: e.target.value})}
                    placeholder="e.g. We Miss You!" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Coupon Code</label>
                  <input value={prodGenForm.couponCode} onChange={e => setProdGenForm({...prodGenForm, couponCode: e.target.value})}
                    placeholder="e.g. RAYNOW" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13, fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Products to Show</label>
                  <select value={prodGenForm.productCount} onChange={e => setProdGenForm({...prodGenForm, productCount: parseInt(e.target.value)})}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} product{n>1?'s':''}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleProductGenerate} disabled={generating || !prodGenForm.segmentLabel}
                className="btn" style={{ gap: 8, background: generating ? 'var(--text-tertiary)' : 'var(--yellow)', color: generating ? '#fff' : 'var(--text-primary)', border: 'none', cursor: generating ? 'not-allowed' : 'pointer' }}>
                {generating ? 'Generating...' : <><Sparkles size={16} /> Generate Content</>}
              </button>

              {productGenResult && (
                <div style={{ marginTop: 24, borderTop: '1px solid var(--border-color)', paddingTop: 24 }}>
                  <h4 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}><Eye size={16} /> Preview</h4>
                  {productGenResult.products && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' }}>
                      {productGenResult.products.map((p, i) => (
                        <div key={i} className="card card-flush" style={{ flexShrink: 0, width: 160, overflow: 'hidden', padding: 0 }}>
                          <img src={p.image} alt={p.name} style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                          <div style={{ padding: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>AED {p.salePrice}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {productGenResult.channel === 'email' ? (
                    <iframe srcDoc={productGenResult.body} style={{ width: '100%', height: 400, border: '1px solid var(--border-color)', borderRadius: 8 }} title="Email Preview" />
                  ) : (
                    <div style={{ background: 'var(--green-dim)', padding: 16, borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                      {productGenResult.body}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setShowProductGen(false); setProductGenResult(null); }} className="btn btn-ghost">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Generate Modal ─────────────────────────── */}
      {showGenerate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowGenerate(false)}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 500, padding: 24 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}><Sparkles size={18} style={{ color: 'var(--red)' }} /> AI Content Generator</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Channel</label>
                <select value={genForm.channel} onChange={e => setGenForm({ ...genForm, channel: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                  {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Target Segment</label>
                <select value={genForm.segmentLabel} onChange={e => setGenForm({ ...genForm, segmentLabel: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                  <option value="">Select...</option>
                  {segments.map(s => <option key={s.segment_label || s.segment_name} value={s.segment_label || s.segment_name}>{s.segment_label || s.segment_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Tone</label>
                <select value={genForm.tone} onChange={e => setGenForm({ ...genForm, tone: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual & Friendly</option>
                  <option value="urgent">Urgent</option>
                  <option value="luxury">Luxury</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Campaign Goal</label>
                <input value={genForm.goal} onChange={e => setGenForm({ ...genForm, goal: e.target.value })}
                  placeholder="e.g. Drive bookings for desert safari"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowGenerate(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleGenerate} disabled={generating || !genForm.segmentLabel} className="btn btn-primary">
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Base Templates Gallery ────────────────────── */}
      {showBaseGallery && !basePreview && !segPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowBaseGallery(false)}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 960, maxHeight: '90vh', overflow: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}><Layout size={20} style={{ color: 'var(--red)' }} /> Rayna Tours Email Templates</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>Production-ready templates — {baseTemplates.length} base layouts + {segmentTemplates.length} segment-specific emails</p>
              </div>
              <button onClick={() => setShowBaseGallery(false)} className="btn btn-ghost btn-sm"><X size={18} /></button>
            </div>

            {/* Gallery Tabs */}
            <div className="tabs" style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--border-color)' }}>
              <button onClick={() => setGalleryTab('base')}
                className={`tab ${galleryTab === 'base' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layout size={14} /> Base Layouts ({baseTemplates.length})
              </button>
              <button onClick={() => setGalleryTab('segments')}
                className={`tab ${galleryTab === 'segments' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} /> All 28 Segments ({segmentTemplates.length})
              </button>
            </div>

            {/* Base Templates Grid */}
            {galleryTab === 'base' && (
              <div className="grid-auto" style={{ padding: 24 }}>
                {baseTemplates.map(tpl => {
                  const ICONS = { 'cart-abandonment': ShoppingCart, 'exclusive-coupon': Tag, 'product-recommendation': Package, 'wishlist-reminder': Heart, 'welcome-back': UserCheck };
                  const COLORS = { recovery: 'var(--red)', promotion: 'var(--yellow)', engagement: 'var(--orange)', winback: 'var(--red)' };
                  const Icon = ICONS[tpl.id] || Package;
                  const color = COLORS[tpl.category] || 'var(--text-secondary)';
                  return (
                    <div key={tpl.id} className="card card-flush" style={{ overflow: 'hidden', padding: 0, transition: 'all 0.2s' }}
                      onMouseOver={e => e.currentTarget.style.boxShadow = '0 8px 24px rgba(220,38,38,0.12)'}
                      onMouseOut={e => e.currentTarget.style.boxShadow = 'none'}>
                      <div style={{ background: 'var(--bg-card-hover)', padding: '24px 20px', textAlign: 'center', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--bg-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                          <Icon size={22} style={{ color }} />
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{tpl.name}</div>
                        <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 10px', borderRadius: 12, background: 'var(--bg-secondary)', color, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{tpl.category}</span>
                      </div>
                      <div style={{ padding: '16px 20px' }}>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px', minHeight: 36 }}>{tpl.description}</p>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                          {tpl.hasProducts && <span className="badge-orange" style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>Products</span>}
                          {tpl.hasCoupon && <span className="badge-red" style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>Coupon</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>Best for: {tpl.bestFor?.slice(0, 2).join(', ')}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => handleBasePreview(tpl)} className="btn btn-ghost btn-sm" style={{ flex: 1, gap: 4 }}>
                            <Eye size={12} /> Preview
                          </button>
                          <button onClick={() => handleUseBaseTemplate(tpl)} disabled={savingBase} className="btn btn-primary btn-sm" style={{ flex: 1, gap: 4 }}>
                            <Plus size={12} /> Use
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Segment Templates Grid */}
            {galleryTab === 'segments' && (
              <div style={{ padding: 24 }}>
                {(() => {
                  const STAGE_COLORS = { 'Awareness': 'var(--yellow)', 'Consideration': 'var(--orange)', 'Conversion': 'var(--green)', 'Growth': 'var(--red)', 'Win-Back': 'var(--red)', 'Advocacy': 'var(--yellow)', 'Special': 'var(--orange)' };
                  const grouped = {};
                  const segWithStage = segmentTemplates.map(st => {
                    const seg = segments.find(s => (s.segment_label || s.segment_name) === st.segmentName);
                    return { ...st, stage_name: seg?.stage_name || 'Other' };
                  });
                  segWithStage.forEach(st => { (grouped[st.stage_name] = grouped[st.stage_name] || []).push(st); });

                  return Object.entries(grouped).map(([stage, items]) => (
                    <div key={stage} style={{ marginBottom: 24 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: STAGE_COLORS[stage] || 'var(--text-tertiary)' }} />
                        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{stage}</h4>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--border-color)', fontSize: 11, color: 'var(--text-secondary)' }}>{items.length} segments</span>
                      </div>
                      <div className="grid-auto">
                        {items.map(st => {
                          const color = STAGE_COLORS[stage] || 'var(--text-secondary)';
                          return (
                            <div key={st.segmentName} className="card" style={{ padding: 16, transition: 'all 0.2s' }}
                              onMouseOver={e => e.currentTarget.style.borderColor = color}
                              onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border-color)'}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{st.segmentName}</div>
                                <Mail size={14} style={{ color }} />
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
                                {st.subject?.slice(0, 60)}{st.subject?.length > 60 ? '...' : ''}
                              </div>
                              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                                <span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg-secondary)', color, fontSize: 10, fontWeight: 600 }}>{st.baseTemplate}</span>
                                {st.hasCoupon && <span className="badge-orange" style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600 }}>{st.coupon_code}</span>}
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => handleSegPreview(st.segmentName)} className="btn btn-ghost btn-sm" style={{ flex: 1, gap: 4 }}>
                                  <Eye size={11} /> Preview
                                </button>
                                <button onClick={() => handleUseSegTemplate(st.segmentName)} disabled={savingBase} className="btn btn-secondary btn-sm" style={{ flex: 1, gap: 4 }}>
                                  <Plus size={11} /> Use
                                </button>
                                {(() => {
                                  const status = startingCampaign[st.segmentName];
                                  const isLoading = status === 'loading';
                                  const isSuccess = status === 'success';
                                  const isError = status === 'error';
                                  return (
                                    <button
                                      onClick={() => handleStartCampaign(st.segmentName, st)}
                                      disabled={isLoading || isSuccess}
                                      className={`btn btn-sm ${isSuccess ? '' : 'btn-primary'}`}
                                      style={{
                                        flex: 1, gap: 4,
                                        background: isSuccess ? 'var(--green)' : isError ? 'var(--red)' : isLoading ? 'var(--text-tertiary)' : undefined,
                                        color: '#fff', border: 'none',
                                        cursor: isLoading || isSuccess ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.2s'
                                      }}
                                    >
                                      {isLoading ? <><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> Starting...</>
                                        : isSuccess ? <><CheckCircle size={11} /> Started</>
                                        : isError ? <><AlertCircle size={11} /> Failed</>
                                        : <><Play size={11} /> Start</>}
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Base Template Preview ──────────────────────── */}
      {basePreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setBasePreview(null); setBasePreviewHtml(''); }}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 750, maxHeight: '90vh', overflow: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>{basePreview.name}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Subject: {basePreview.subject}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleUseBaseTemplate(basePreview)} disabled={savingBase} className="btn btn-primary" style={{ gap: 4 }}>
                  {savingBase ? 'Saving...' : <><Plus size={14} /> Use This Template</>}
                </button>
                <button onClick={() => { setBasePreview(null); setBasePreviewHtml(''); }} className="btn btn-ghost btn-sm"><X size={18} /></button>
              </div>
            </div>
            <div style={{ padding: 20, background: 'var(--bg-secondary)' }}>
              {basePreviewHtml ? (
                <iframe srcDoc={basePreviewHtml} style={{ width: '100%', height: 600, border: 'none', borderRadius: 8, background: 'var(--bg-secondary)' }} title="Base Template Preview" />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading preview...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Segment Template Preview ──────────────────── */}
      {segPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setSegPreview(null); setSegPreviewHtml(''); }}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 750, maxHeight: '90vh', overflow: 'auto', padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>{segPreview}</h3>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>Segment-specific email template</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleUseSegTemplate(segPreview)} disabled={savingBase} className="btn btn-secondary" style={{ gap: 4 }}>
                  {savingBase ? 'Saving...' : <><Plus size={14} /> Use This Template</>}
                </button>
                {(() => {
                  const status = startingCampaign[segPreview];
                  const isLoading = status === 'loading';
                  const isSuccess = status === 'success';
                  const isError = status === 'error';
                  return (
                    <button
                      onClick={() => handleStartCampaign(segPreview)}
                      disabled={isLoading || isSuccess}
                      className={`btn ${isSuccess ? '' : 'btn-primary'}`}
                      style={{
                        gap: 6,
                        background: isSuccess ? 'var(--green)' : isError ? 'var(--red)' : isLoading ? 'var(--text-tertiary)' : undefined,
                        color: '#fff', border: 'none',
                        cursor: isLoading || isSuccess ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {isLoading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Starting...</>
                        : isSuccess ? <><CheckCircle size={14} /> Campaign Started</>
                        : isError ? <><AlertCircle size={14} /> Failed</>
                        : <><Play size={14} /> Start Campaign</>}
                    </button>
                  );
                })()}
                <button onClick={() => { setSegPreview(null); setSegPreviewHtml(''); }} className="btn btn-ghost btn-sm"><X size={18} /></button>
              </div>
            </div>
            <div style={{ padding: 20, background: 'var(--bg-secondary)' }}>
              {segPreviewHtml ? (
                <iframe srcDoc={segPreviewHtml} style={{ width: '100%', height: 600, border: 'none', borderRadius: 8, background: 'var(--bg-secondary)' }} title="Segment Template Preview" />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Loading preview...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Create Template Modal ─────────────────────── */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setShowCreate(false); setGenerated(null); }}>
          <div className="card" style={{ borderRadius: 16, width: '100%', maxWidth: 600, padding: 24, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', color: 'var(--text-primary)' }}>{generated ? 'Review AI Content' : 'Create Template'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Channel</label>
                <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }}>
                  {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
              </div>
              {(form.channel === 'email' || form.channel === 'push') && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Subject</label>
                  <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Body</label>
                <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={8} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }} />
              </div>
              <div className="card-grid card-grid-2">
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>CTA Text</label>
                  <input value={form.ctaText} onChange={e => setForm({ ...form, ctaText: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>CTA URL</label>
                  <input value={form.ctaUrl} onChange={e => setForm({ ...form, ctaUrl: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 8 }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => { setShowCreate(false); setGenerated(null); }} className="btn btn-ghost">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name || !form.body} className="btn btn-primary">Save Template</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
