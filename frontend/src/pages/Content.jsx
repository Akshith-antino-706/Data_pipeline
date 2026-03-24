import { useState, useEffect } from 'react';
import { getTemplates, createTemplate, approveTemplate, rejectTemplate, generateContent, getSegments, generateContentWithProducts, getSegmentProducts, getBaseTemplates, previewBaseTemplate, useBaseTemplate, getSegmentEmailTemplates, previewSegmentEmail, useSegmentEmail, createCampaign, executeCampaign } from '../api';
import { Plus, Sparkles, Check, X, Image, Eye, Package, Send, Layout, ShoppingCart, Tag, Heart, UserCheck, Mail, Users, Play, Loader, CheckCircle, AlertCircle } from 'lucide-react';

const CHANNELS = ['whatsapp', 'email', 'sms', 'push'];
const STATUS_BADGE = { draft: 'badge-gray', pending_approval: 'badge-orange', approved: 'badge-green', rejected: 'badge-red' };

// ── Yellow & Red Theme Colors ──────────────────────────────
const T = {
  red: '#dc2626',
  redDark: '#b91c1c',
  redLight: '#fef2f2',
  redBg: '#fee2e2',
  yellow: '#eab308',
  yellowDark: '#ca8a04',
  yellowLight: '#fefce8',
  yellowBg: '#fef9c3',
  amber: '#f59e0b',
  amberBg: '#fffbeb',
  dark: '#1c1917',
  darkSoft: '#292524',
  warmGray: '#78716c',
  warmGrayLight: '#a8a29e',
  border: '#e7e5e4',
  borderLight: '#f5f5f4',
  bg: '#fafaf9',
};

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
    const params = {};
    if (channel && channel !== 'all') params.channel = channel;
    const data = await getTemplates(params);
    setTemplates(data.data);
    setTotal(data.total);
  };

  useEffect(() => {
    Promise.all([getTemplates(), getSegments(), getBaseTemplates(), getSegmentEmailTemplates()])
      .then(([t, s, bt, st]) => {
        setTemplates(t.data); setTotal(t.total); setSegments(s.data || s); setBaseTemplates(bt.data || []); setSegmentTemplates(st.data || []);
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
    setTemplates([data.data, ...templates]);
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
    <div style={{ padding: 24 }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: T.dark }}>Content Templates</h1>
          <p style={{ color: T.warmGray, margin: '4px 0 0' }}>{total} templates across {CHANNELS.length} channels · Real Rayna Tours products</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowBaseGallery(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: T.dark, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            <Layout size={14} /> Base Templates
          </button>
          <button onClick={() => setShowProductGen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: T.yellow, color: T.dark, border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            <Package size={14} /> Generate with Products
          </button>
          <button onClick={() => setShowGenerate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: T.red, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            <Sparkles size={14} /> AI Generate
          </button>
          <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: T.redDark, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            <Plus size={14} /> New Template
          </button>
        </div>
      </div>

      {/* ── Channel Tabs ──────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', ...CHANNELS].map(ch => (
          <button key={ch} onClick={() => handleTabChange(ch)}
            style={{ padding: '8px 20px', borderRadius: 20, border: tab === ch ? `2px solid ${T.red}` : `1px solid ${T.border}`, background: tab === ch ? T.redLight : 'white', color: tab === ch ? T.red : T.warmGray, cursor: 'pointer', fontSize: 13, fontWeight: tab === ch ? 600 : 500, textTransform: 'capitalize' }}>
            {ch === 'all' ? `All (${total})` : ch}
          </button>
        ))}
      </div>

      {/* ── Template Grid ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {templates.map(t => (
          <div key={t.id} style={{ background: 'white', borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column' }}>
            {t.media_url && (
              <div style={{ height: 140, overflow: 'hidden', position: 'relative' }}>
                <img src={t.media_url} alt={t.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
                  <span style={{ padding: '3px 10px', borderRadius: 12, background: t.channel === 'whatsapp' ? '#22c55e' : t.channel === 'email' ? T.red : T.yellow, color: '#fff', fontSize: 11, fontWeight: 600 }}>{t.channel}</span>
                </div>
                <div style={{ position: 'absolute', top: 8, right: 8 }}>
                  <span style={{ padding: '3px 10px', borderRadius: 12, background: t.status === 'approved' ? '#22c55e' : t.status === 'rejected' ? T.red : T.yellow, color: t.status === 'approved' ? '#fff' : t.status === 'rejected' ? '#fff' : T.dark, fontSize: 11, fontWeight: 600 }}>{t.status}</span>
                </div>
              </div>
            )}
            {!t.media_url && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px 0' }}>
                <span style={{ padding: '3px 10px', borderRadius: 12, background: t.channel === 'whatsapp' ? '#dcfce7' : t.channel === 'email' ? T.redLight : T.yellowLight, color: t.channel === 'whatsapp' ? '#16a34a' : t.channel === 'email' ? T.red : T.yellowDark, fontSize: 11, fontWeight: 600 }}>{t.channel}</span>
                <span style={{ padding: '3px 10px', borderRadius: 12, background: t.status === 'approved' ? '#dcfce7' : t.status === 'rejected' ? T.redBg : T.yellowBg, color: t.status === 'approved' ? '#16a34a' : t.status === 'rejected' ? T.red : T.yellowDark, fontSize: 11, fontWeight: 600 }}>{t.status}</span>
              </div>
            )}
            <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.dark, marginBottom: 4 }}>{t.name}</div>
              {t.segment_label && <div style={{ fontSize: 11, color: T.red, fontWeight: 600, marginBottom: 6 }}>{t.segment_label}</div>}
              {t.subject && <div style={{ fontSize: 12, color: T.warmGray, marginBottom: 4 }}>Subject: {t.subject}</div>}
              <div style={{ fontSize: 12, color: T.warmGrayLight, maxHeight: 60, overflow: 'hidden', marginBottom: 12, flex: 1 }}>
                {t.body?.replace(/<[^>]*>/g, '').slice(0, 120)}...
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {t.ai_generated && <span style={{ padding: '2px 8px', borderRadius: 8, background: T.yellowBg, color: T.yellowDark, fontSize: 10, fontWeight: 600 }}>AI</span>}
                {t.cta_text && <span style={{ padding: '2px 8px', borderRadius: 8, background: T.borderLight, color: T.warmGray, fontSize: 10 }}>CTA: {t.cta_text}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12, borderTop: `1px solid ${T.borderLight}`, paddingTop: 12 }}>
                <button onClick={() => setShowPreview(t)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 12px', background: T.borderLight, color: T.warmGray, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                  <Eye size={12} /> Preview
                </button>
                {t.status === 'draft' && (
                  <>
                    <button onClick={() => handleApprove(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => handleReject(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: T.red, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                      <X size={12} /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {templates.length === 0 && (
          <div style={{ gridColumn: '1/-1', background: 'white', borderRadius: 12, padding: 60, textAlign: 'center', border: `1px solid ${T.border}` }}>
            <Package size={48} color={T.warmGrayLight} />
            <p style={{ color: T.warmGray, marginTop: 12 }}>No templates yet. Generate with products or create manually.</p>
          </div>
        )}
      </div>

      {/* ── Preview Modal ─────────────────────────────── */}
      {showPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowPreview(null)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 700, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: T.dark }}>{showPreview.name}</h3>
                <div style={{ fontSize: 12, color: T.warmGray, marginTop: 4 }}>{showPreview.channel} · {showPreview.segment_label} · {showPreview.status}</div>
              </div>
              <button onClick={() => setShowPreview(null)} style={{ background: T.borderLight, border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {showPreview.media_url && (
              <div style={{ padding: '0 24px', marginTop: 16 }}>
                <img src={showPreview.media_url} alt="Template" style={{ width: '100%', borderRadius: 12, maxHeight: 200, objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ padding: 24 }}>
              {showPreview.subject && <div style={{ fontWeight: 600, marginBottom: 12, color: T.dark }}>Subject: {showPreview.subject}</div>}
              {showPreview.channel === 'email' && showPreview.body?.startsWith('<!DOCTYPE') ? (
                <iframe srcDoc={showPreview.body} style={{ width: '100%', height: 500, border: `1px solid ${T.border}`, borderRadius: 8 }} title="Email Preview" />
              ) : (
                <div style={{ background: showPreview.channel === 'whatsapp' ? '#dcf8c6' : T.bg, padding: 16, borderRadius: 12, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {showPreview.body?.replace(/<[^>]*>/g, '')}
                </div>
              )}
              {showPreview.cta_url && (
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <a href={showPreview.cta_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '10px 24px', background: T.red, color: '#fff', textDecoration: 'none', borderRadius: 8, fontWeight: 600 }}>
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
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, borderBottom: `1px solid ${T.border}` }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: T.dark }}><Package size={20} color={T.yellow} /> Generate Content with Real Products</h3>
              <p style={{ color: T.warmGray, fontSize: 13, margin: '4px 0 0' }}>Creates email/WA content with real Rayna Tours product images and pricing</p>
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Target Segment</label>
                  <select value={prodGenForm.segmentLabel} onChange={e => setProdGenForm({...prodGenForm, segmentLabel: e.target.value})}
                    style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13 }}>
                    <option value="">Select segment...</option>
                    {segments.map(s => <option key={s.segment_label || s.segment_name} value={s.segment_label || s.segment_name}>{s.segment_label || s.segment_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Channel</label>
                  <select value={prodGenForm.channel} onChange={e => setProdGenForm({...prodGenForm, channel: e.target.value})}
                    style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13 }}>
                    <option value="email">Email (HTML with images)</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Heading</label>
                  <input value={prodGenForm.heading} onChange={e => setProdGenForm({...prodGenForm, heading: e.target.value})}
                    placeholder="e.g. We Miss You!" style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Coupon Code</label>
                  <input value={prodGenForm.couponCode} onChange={e => setProdGenForm({...prodGenForm, couponCode: e.target.value})}
                    placeholder="e.g. RAYNOW" style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Products to Show</label>
                  <select value={prodGenForm.productCount} onChange={e => setProdGenForm({...prodGenForm, productCount: parseInt(e.target.value)})}
                    style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13 }}>
                    {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} product{n>1?'s':''}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleProductGenerate} disabled={generating || !prodGenForm.segmentLabel}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', background: generating ? T.warmGrayLight : T.yellow, color: generating ? '#fff' : T.dark, border: 'none', borderRadius: 8, cursor: generating ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}>
                {generating ? 'Generating...' : <><Sparkles size={16} /> Generate Content</>}
              </button>

              {productGenResult && (
                <div style={{ marginTop: 24, borderTop: `1px solid ${T.border}`, paddingTop: 24 }}>
                  <h4 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, color: T.dark }}><Eye size={16} /> Preview</h4>
                  {productGenResult.products && (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' }}>
                      {productGenResult.products.map((p, i) => (
                        <div key={i} style={{ flexShrink: 0, width: 160, background: T.bg, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}` }}>
                          <img src={p.image} alt={p.name} style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                          <div style={{ padding: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.dark }}>{p.name}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: T.red }}>AED {p.salePrice}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {productGenResult.channel === 'email' ? (
                    <iframe srcDoc={productGenResult.body} style={{ width: '100%', height: 400, border: `1px solid ${T.border}`, borderRadius: 8 }} title="Email Preview" />
                  ) : (
                    <div style={{ background: '#dcf8c6', padding: 16, borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                      {productGenResult.body}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => { setShowProductGen(false); setProductGenResult(null); }}
                style={{ padding: '8px 20px', background: T.borderLight, color: T.warmGray, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Generate Modal ─────────────────────────── */}
      {showGenerate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowGenerate(false)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, padding: 24 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8, color: T.dark }}><Sparkles size={18} color={T.red} /> AI Content Generator</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Channel</label>
                <select value={genForm.channel} onChange={e => setGenForm({ ...genForm, channel: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Target Segment</label>
                <select value={genForm.segmentLabel} onChange={e => setGenForm({ ...genForm, segmentLabel: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  <option value="">Select...</option>
                  {segments.map(s => <option key={s.segment_label || s.segment_name} value={s.segment_label || s.segment_name}>{s.segment_label || s.segment_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Tone</label>
                <select value={genForm.tone} onChange={e => setGenForm({ ...genForm, tone: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual & Friendly</option>
                  <option value="urgent">Urgent</option>
                  <option value="luxury">Luxury</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Campaign Goal</label>
                <input value={genForm.goal} onChange={e => setGenForm({ ...genForm, goal: e.target.value })}
                  placeholder="e.g. Drive bookings for desert safari"
                  style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowGenerate(false)} style={{ padding: '8px 20px', background: T.borderLight, color: T.warmGray, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleGenerate} disabled={generating || !genForm.segmentLabel}
                style={{ padding: '8px 20px', background: T.red, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Base Templates Gallery ────────────────────── */}
      {showBaseGallery && !basePreview && !segPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowBaseGallery(false)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 960, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 24, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8, color: T.dark }}><Layout size={20} color={T.red} /> Rayna Tours Email Templates</h3>
                <p style={{ color: T.warmGray, fontSize: 13, margin: '4px 0 0' }}>Production-ready templates — {baseTemplates.length} base layouts + {segmentTemplates.length} segment-specific emails</p>
              </div>
              <button onClick={() => setShowBaseGallery(false)} style={{ background: T.borderLight, border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}><X size={18} /></button>
            </div>

            {/* Gallery Tabs */}
            <div style={{ display: 'flex', gap: 8, padding: '16px 24px 0', borderBottom: `1px solid ${T.borderLight}` }}>
              <button onClick={() => setGalleryTab('base')}
                style={{ padding: '10px 20px', borderRadius: '8px 8px 0 0', border: 'none', background: galleryTab === 'base' ? T.red : T.borderLight, color: galleryTab === 'base' ? '#fff' : T.warmGray, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Layout size={14} /> Base Layouts ({baseTemplates.length})
              </button>
              <button onClick={() => setGalleryTab('segments')}
                style={{ padding: '10px 20px', borderRadius: '8px 8px 0 0', border: 'none', background: galleryTab === 'segments' ? T.red : T.borderLight, color: galleryTab === 'segments' ? '#fff' : T.warmGray, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} /> All 28 Segments ({segmentTemplates.length})
              </button>
            </div>

            {/* Base Templates Grid */}
            {galleryTab === 'base' && (
              <div style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                {baseTemplates.map(tpl => {
                  const ICONS = { 'cart-abandonment': ShoppingCart, 'exclusive-coupon': Tag, 'product-recommendation': Package, 'wishlist-reminder': Heart, 'welcome-back': UserCheck };
                  const COLORS = { recovery: T.red, promotion: T.yellow, engagement: T.amber, winback: T.redDark };
                  const Icon = ICONS[tpl.id] || Package;
                  const color = COLORS[tpl.category] || T.warmGray;
                  return (
                    <div key={tpl.id} style={{ background: '#fff', borderRadius: 12, border: `1px solid ${T.border}`, overflow: 'hidden', transition: 'all 0.2s' }}
                      onMouseOver={e => e.currentTarget.style.boxShadow = '0 8px 24px rgba(220,38,38,0.12)'}
                      onMouseOut={e => e.currentTarget.style.boxShadow = 'none'}>
                      <div style={{ background: `linear-gradient(135deg, ${color}15, ${color}08)`, padding: '24px 20px', textAlign: 'center', borderBottom: `1px solid ${T.borderLight}` }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: `${color}15`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                          <Icon size={22} color={color} />
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: T.dark }}>{tpl.name}</div>
                        <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 10px', borderRadius: 12, background: `${color}15`, color, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{tpl.category}</span>
                      </div>
                      <div style={{ padding: '16px 20px' }}>
                        <p style={{ fontSize: 12, color: T.warmGray, lineHeight: 1.5, margin: '0 0 12px', minHeight: 36 }}>{tpl.description}</p>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                          {tpl.hasProducts && <span style={{ padding: '2px 8px', borderRadius: 6, background: T.yellowLight, color: T.yellowDark, fontSize: 10, fontWeight: 600 }}>Products</span>}
                          {tpl.hasCoupon && <span style={{ padding: '2px 8px', borderRadius: 6, background: T.redLight, color: T.red, fontSize: 10, fontWeight: 600 }}>Coupon</span>}
                        </div>
                        <div style={{ fontSize: 11, color: T.warmGrayLight, marginBottom: 12 }}>Best for: {tpl.bestFor?.slice(0, 2).join(', ')}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => handleBasePreview(tpl)}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 12px', background: T.borderLight, color: T.warmGray, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                            <Eye size={12} /> Preview
                          </button>
                          <button onClick={() => handleUseBaseTemplate(tpl)} disabled={savingBase}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 12px', background: T.red, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
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
                  const STAGE_COLORS = { 'Awareness': T.yellow, 'Consideration': T.amber, 'Conversion': '#22c55e', 'Growth': T.red, 'Win-Back': T.redDark, 'Advocacy': T.yellow, 'Special': T.amber };
                  const grouped = {};
                  const segWithStage = segmentTemplates.map(st => {
                    const seg = segments.find(s => (s.segment_label || s.segment_name) === st.segmentName);
                    return { ...st, stage_name: seg?.stage_name || 'Other' };
                  });
                  segWithStage.forEach(st => { (grouped[st.stage_name] = grouped[st.stage_name] || []).push(st); });

                  return Object.entries(grouped).map(([stage, items]) => (
                    <div key={stage} style={{ marginBottom: 24 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: STAGE_COLORS[stage] || T.warmGrayLight }} />
                        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.dark }}>{stage}</h4>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: T.borderLight, fontSize: 11, color: T.warmGray }}>{items.length} segments</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                        {items.map(st => {
                          const color = STAGE_COLORS[stage] || T.warmGray;
                          return (
                            <div key={st.segmentName} style={{ background: '#fff', borderRadius: 10, border: `1px solid ${T.border}`, padding: 16, transition: 'all 0.2s' }}
                              onMouseOver={e => e.currentTarget.style.borderColor = color}
                              onMouseOut={e => e.currentTarget.style.borderColor = T.border}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: T.dark, flex: 1 }}>{st.segmentName}</div>
                                <Mail size={14} color={color} />
                              </div>
                              <div style={{ fontSize: 11, color: T.warmGray, marginBottom: 8, lineHeight: 1.4 }}>
                                {st.subject?.slice(0, 60)}{st.subject?.length > 60 ? '...' : ''}
                              </div>
                              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                                <span style={{ padding: '2px 8px', borderRadius: 6, background: `${color}10`, color, fontSize: 10, fontWeight: 600 }}>{st.baseTemplate}</span>
                                {st.hasCoupon && <span style={{ padding: '2px 8px', borderRadius: 6, background: T.yellowBg, color: T.yellowDark, fontSize: 10, fontWeight: 600 }}>{st.coupon_code}</span>}
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => handleSegPreview(st.segmentName)}
                                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 10px', background: T.borderLight, color: T.warmGray, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
                                  <Eye size={11} /> Preview
                                </button>
                                <button onClick={() => handleUseSegTemplate(st.segmentName)} disabled={savingBase}
                                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 10px', background: T.dark, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
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
                                      style={{
                                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        padding: '6px 10px',
                                        background: isSuccess ? '#22c55e' : isError ? T.red : isLoading ? T.warmGrayLight : T.red,
                                        color: '#fff', border: 'none', borderRadius: 6,
                                        cursor: isLoading || isSuccess ? 'not-allowed' : 'pointer',
                                        fontSize: 11, fontWeight: 600, transition: 'all 0.2s'
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
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 750, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: T.dark }}>{basePreview.name}</h3>
                <div style={{ fontSize: 12, color: T.warmGray, marginTop: 4 }}>Subject: {basePreview.subject}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleUseBaseTemplate(basePreview)} disabled={savingBase}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', background: T.red, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  {savingBase ? 'Saving...' : <><Plus size={14} /> Use This Template</>}
                </button>
                <button onClick={() => { setBasePreview(null); setBasePreviewHtml(''); }} style={{ background: T.borderLight, border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}><X size={18} /></button>
              </div>
            </div>
            <div style={{ padding: 20, background: T.bg }}>
              {basePreviewHtml ? (
                <iframe srcDoc={basePreviewHtml} style={{ width: '100%', height: 600, border: 'none', borderRadius: 8, background: T.bg }} title="Base Template Preview" />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: T.warmGrayLight }}>Loading preview...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Segment Template Preview ──────────────────── */}
      {segPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setSegPreview(null); setSegPreviewHtml(''); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 750, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: 20, borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: T.dark }}>{segPreview}</h3>
                <div style={{ fontSize: 12, color: T.warmGray, marginTop: 4 }}>Segment-specific email template</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleUseSegTemplate(segPreview)} disabled={savingBase}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', background: T.dark, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
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
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                        background: isSuccess ? '#22c55e' : isError ? T.red : isLoading ? T.warmGrayLight : T.red,
                        color: '#fff', border: 'none', borderRadius: 8,
                        cursor: isLoading || isSuccess ? 'not-allowed' : 'pointer',
                        fontSize: 13, fontWeight: 600, transition: 'all 0.2s'
                      }}
                    >
                      {isLoading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Starting...</>
                        : isSuccess ? <><CheckCircle size={14} /> Campaign Started</>
                        : isError ? <><AlertCircle size={14} /> Failed</>
                        : <><Play size={14} /> Start Campaign</>}
                    </button>
                  );
                })()}
                <button onClick={() => { setSegPreview(null); setSegPreviewHtml(''); }} style={{ background: T.borderLight, border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}><X size={18} /></button>
              </div>
            </div>
            <div style={{ padding: 20, background: T.bg }}>
              {segPreviewHtml ? (
                <iframe srcDoc={segPreviewHtml} style={{ width: '100%', height: 600, border: 'none', borderRadius: 8, background: T.bg }} title="Segment Template Preview" />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: T.warmGrayLight }}>Loading preview...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Create Template Modal ─────────────────────── */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setShowCreate(false); setGenerated(null); }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600, padding: 24, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', color: T.dark }}>{generated ? 'Review AI Content' : 'Create Template'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Channel</label>
                <select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }}>
                  {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
              </div>
              {(form.channel === 'email' || form.channel === 'push') && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Subject</label>
                  <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>Body</label>
                <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={8} style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>CTA Text</label>
                  <input value={form.ctaText} onChange={e => setForm({ ...form, ctaText: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.warmGray, display: 'block', marginBottom: 4 }}>CTA URL</label>
                  <input value={form.ctaUrl} onChange={e => setForm({ ...form, ctaUrl: e.target.value })} style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8 }} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => { setShowCreate(false); setGenerated(null); }} style={{ padding: '8px 20px', background: T.borderLight, color: T.warmGray, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} disabled={!form.name || !form.body}
                style={{ padding: '8px 20px', background: T.red, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Save Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
