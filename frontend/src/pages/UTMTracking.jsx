import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getUTMAnalytics, getUTMSegments, buildUTM, generateSegmentUTM, generateAllUTM } from '../api';
// recharts available for future UTM analytics charts
import { Link2, Copy, Zap, RefreshCw, Target, MousePointer, TrendingUp, ExternalLink, Check, Globe, Mail, MessageSquare, Phone, Bell, Hash } from 'lucide-react';

const CHANNEL_COLORS = { email: 'var(--brand-primary)', whatsapp: 'var(--green)', sms: 'var(--orange)', push: 'var(--red)', rcs: 'var(--brand-primary)', web: 'var(--purple)' };
const CHANNEL_ICONS = { email: Mail, whatsapp: MessageSquare, sms: Phone, push: Bell, rcs: Hash, web: Globe };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

export default function UTMTracking() {
  const [analytics, setAnalytics] = useState({ links: [], summary: [], segmentSummary: [] });
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingOne, setGeneratingOne] = useState(null);
  const [filterSegment, setFilterSegment] = useState('');
  const [activeTab, setActiveTab] = useState('campaigns');
  const [copiedId, setCopiedId] = useState(null);
  const [toast, setToast] = useState(null);

  // Builder
  const [builder, setBuilder] = useState({ baseUrl: 'https://www.raynatours.com/activities', channel: 'email', campaignName: '', segmentLabel: '', contentNumber: 1 });
  const [generatedUrl, setGeneratedUrl] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        getUTMAnalytics(filterSegment ? { segmentLabel: filterSegment } : {}),
        getUTMSegments()
      ]);
      const analyticsData = a?.data || a || {};
      setAnalytics({ links: analyticsData.links || [], summary: analyticsData.summary || [], segmentSummary: analyticsData.segmentSummary || [] });
      setSegments(Array.isArray(s) ? s : (s.data || []));
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadAnalytics() {
    try {
      const a = await getUTMAnalytics(filterSegment ? { segmentLabel: filterSegment } : {});
      const aData = a?.data || a || {};
      setAnalytics({ links: aData.links || [], summary: aData.summary || [], segmentSummary: aData.segmentSummary || [] });
    } catch (err) { console.error(err); }
  }

  useEffect(() => { if (!loading) loadAnalytics(); }, [filterSegment]);

  async function handleGenerateAll() {
    setGenerating(true);
    try {
      const result = await generateAllUTM();
      showToast(`Generated ${result.total_links} UTM links across ${result.segments_processed} segments`, 'success');
      await loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    setGenerating(false);
  }

  async function handleGenerateSegment(label) {
    setGeneratingOne(label);
    try {
      const result = await generateSegmentUTM(label);
      showToast(`Generated ${result.links?.length || 0} UTM links for ${label}`, 'success');
      await loadAll();
    } catch (err) { showToast(err.message, 'error'); }
    setGeneratingOne(null);
  }

  async function handleBuild() {
    try {
      const result = await buildUTM(builder);
      setGeneratedUrl(result.utm_url);
    } catch (err) { console.error(err); }
  }

  function copyUrl(url, id) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function showToast(msg, type = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  const totalLinks = analytics.summary?.reduce((s, r) => s + parseInt(r.total_links || 0), 0) || 0;
  const totalClicks = analytics.summary?.reduce((s, r) => s + parseInt(r.total_clicks || 0), 0) || 0;
  const totalConversions = analytics.summary?.reduce((s, r) => s + parseInt(r.total_conversions || 0), 0) || 0;
  const totalRevenue = analytics.summary?.reduce((s, r) => s + parseFloat(r.total_revenue || 0), 0) || 0;
  const segmentsWithUtm = segments.filter(s => parseInt(s.utm_count) > 0).length;

  if (loading) return <div className="spinner">Loading UTM data...</div>;

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
      {/* Header */}
      <motion.div variants={fadeInUp} className="page-header">
        <div>
          <h2>UTM Campaign Tracker</h2>
          <div className="page-header-sub">Track every campaign link across all 28 segments</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={loadAll}><RefreshCw size={14} /></button>
          <button className="btn btn-primary" onClick={handleGenerateAll} disabled={generating}>
            <Zap size={14} /> {generating ? 'Generating...' : 'Generate All Campaign UTMs'}
          </button>
        </div>
      </motion.div>

      {/* KPI Strip */}
      <motion.div variants={fadeInUp} className="grid-5 mb-24">
        {[
          { label: 'Campaign Links', value: totalLinks, color: 'var(--brand-primary)', icon: Link2 },
          { label: 'Segments Tracked', value: `${segmentsWithUtm}/${segments.length}`, color: 'var(--purple)', icon: Target },
          { label: 'Total Clicks', value: totalClicks, color: 'var(--green)', icon: MousePointer },
          { label: 'Conversions', value: totalConversions, color: 'var(--orange)', icon: TrendingUp },
          { label: 'Revenue', value: `AED ${totalRevenue.toLocaleString()}`, color: 'var(--brand-primary)', icon: Globe },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card" style={{ padding: '16px 20px', borderTop: `3px solid ${color}` }}>
            <div className="flex justify-between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="text-xs text-secondary uppercase tracking-wide mb-4">{label}</div>
                <div className="font-bold" style={{ fontSize: 22, color }}>{value}</div>
              </div>
              <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 10, background: `color-mix(in srgb, ${color} 7%, transparent)` }}>
                <Icon size={18} color={color} />
              </div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Channel Distribution + Segment Filter */}
      <motion.div variants={fadeInUp} className="mb-24" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
        {/* Channel Pills */}
        <div className="card p-20">
          <div className="text-sm font-semibold text-secondary mb-16">Links by Channel</div>
          <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
            {(analytics.summary || []).map(ch => {
              const Icon = CHANNEL_ICONS[ch.channel] || Globe;
              const color = CHANNEL_COLORS[ch.channel] || 'var(--text-tertiary)';
              return (
                <div key={ch.channel} className="flex items-center gap-8" style={{
                  padding: '12px 18px',
                  background: `color-mix(in srgb, ${color} 3%, transparent)`,
                  border: `1.5px solid color-mix(in srgb, ${color} 19%, transparent)`,
                  borderRadius: 12, minWidth: 130
                }}>
                  <div className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 8, background: `color-mix(in srgb, ${color} 9%, transparent)` }}>
                    <Icon size={16} color={color} />
                  </div>
                  <div>
                    <div className="font-bold" style={{ fontSize: 16, color }}>{ch.total_links}</div>
                    <div className="text-xs text-secondary" style={{ textTransform: 'capitalize' }}>{ch.channel}</div>
                  </div>
                </div>
              );
            })}
            {(!analytics.summary || analytics.summary.length === 0) && (
              <div className="text-sm text-secondary p-20">No UTM links yet. Click "Generate All Campaign UTMs".</div>
            )}
          </div>
        </div>

        {/* Segment Filter */}
        <div className="card p-20">
          <div className="text-sm font-semibold text-secondary mb-16">Filter by Segment</div>
          <select value={filterSegment} onChange={e => setFilterSegment(e.target.value)}
            className="mb-8"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13, background: 'var(--bg-secondary)' }}>
            <option value="">All Segments</option>
            {segments.map(s => (
              <option key={s.segment_name} value={s.segment_name}>
                {s.segment_name} ({s.campaign_count} campaigns)
              </option>
            ))}
          </select>
          {filterSegment && (
            <button className="btn btn-sm btn-secondary" onClick={() => setFilterSegment('')} style={{ width: '100%' }}>
              Clear Filter
            </button>
          )}
          {!filterSegment && (
            <div className="text-xs text-tertiary mt-8">
              Showing all {totalLinks} links across {segmentsWithUtm} segments
            </div>
          )}
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={fadeInUp} className="flex gap-4 mb-16" style={{ borderBottom: '2px solid var(--border-color)', paddingBottom: 0 }}>
        {[
          { key: 'campaigns', label: 'Campaign Links', count: analytics.links?.length || 0 },
          { key: 'segments', label: 'Segment Overview', count: segments.length },
          { key: 'builder', label: 'UTM Builder', count: null },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'} flex items-center gap-4`}
            style={{ borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 600 }}>
            {tab.label}
            {tab.count !== null && (
              <span className="badge" style={{
                padding: '1px 8px', fontSize: 10,
                background: activeTab === tab.key ? 'rgba(255,255,255,0.25)' : 'var(--bg-secondary)',
                color: activeTab === tab.key ? '#fff' : 'var(--text-secondary)'
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </motion.div>

      {/* Tab: Campaign Links */}
      {activeTab === 'campaigns' && (
        <motion.div variants={fadeInUp} className="flex flex-col gap-8">
          {analytics.links?.length > 0 ? analytics.links.slice(0, 60).map(l => {
            const Icon = CHANNEL_ICONS[l.channel] || Globe;
            const color = CHANNEL_COLORS[l.channel] || 'var(--text-tertiary)';
            const isCopied = copiedId === l.utm_id;
            return (
              <div key={l.utm_id} className="card" style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
                <div className="flex gap-12 items-center" style={{ minWidth: 0 }}>
                  <div className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 10, background: `color-mix(in srgb, ${color} 8%, transparent)`, flexShrink: 0 }}>
                    <Icon size={18} color={color} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="flex items-center gap-8 mb-4" style={{ flexWrap: 'wrap' }}>
                      <span className="font-semibold text-sm">{l.campaign_name || l.template_name || 'Unnamed'}</span>
                      <span className={`badge badge-${l.channel === 'whatsapp' ? 'green' : l.channel === 'email' ? 'blue' : l.channel === 'sms' ? 'orange' : 'purple'}`} style={{ fontSize: 9 }}>
                        {l.channel}
                      </span>
                      <span className={`badge ${l.campaign_status === 'running' ? 'badge-green' : l.campaign_status === 'scheduled' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 9 }}>
                        {l.campaign_status || 'draft'}
                      </span>
                    </div>
                    <div className="flex gap-16 text-xs text-secondary">
                      <span>Segment: <b>{l.segment_label}</b></span>
                      <span>Audience: <b>{Number(l.target_count || 0).toLocaleString()}</b></span>
                    </div>
                    <div className="code-block" style={{
                      marginTop: 6, padding: '5px 10px', fontSize: 10,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {l.full_url}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-4" style={{ alignItems: 'flex-end' }}>
                  <div className="flex gap-12 text-xs">
                    <div className="text-center">
                      <div className="font-bold" style={{ fontSize: 16, color: 'var(--green)' }}>{l.clicks}</div>
                      <div className="text-xs text-tertiary">clicks</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold" style={{ fontSize: 16, color: 'var(--orange)' }}>{l.conversions}</div>
                      <div className="text-xs text-tertiary">conv.</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold" style={{ fontSize: 16, color: 'var(--brand-primary)' }}>{parseFloat(l.revenue || 0).toFixed(0)}</div>
                      <div className="text-xs text-tertiary">AED</div>
                    </div>
                  </div>
                  <button
                    onClick={() => copyUrl(l.full_url, l.utm_id)}
                    className={`btn btn-sm ${isCopied ? 'btn-primary' : 'btn-secondary'} flex items-center gap-4`}
                    style={{ fontSize: 11 }}>
                    {isCopied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy UTM</>}
                  </button>
                </div>
              </div>
            );
          }) : (
            <div className="card p-24 text-center">
              <Link2 size={40} color="var(--text-tertiary)" className="mb-8" />
              <div className="font-semibold mb-4" style={{ fontSize: 15 }}>No campaign UTM links yet</div>
              <div className="text-sm text-secondary mb-16">Generate UTM links to track every campaign across all segments</div>
              <button className="btn btn-primary" onClick={handleGenerateAll} disabled={generating}>
                <Zap size={14} /> Generate All Campaign UTMs
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Tab: Segment Overview */}
      {activeTab === 'segments' && (
        <motion.div variants={fadeInUp} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {segments.map(s => {
            const hasUtm = parseInt(s.utm_count) > 0;
            const campaignCount = parseInt(s.campaign_count) || 0;
            return (
              <div key={s.segment_name} className="card" style={{
                padding: 18, borderLeft: `4px solid ${hasUtm ? 'var(--green)' : 'var(--border-color)'}`,
                opacity: campaignCount === 0 ? 0.5 : 1
              }}>
                <div className="flex justify-between mb-8" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="font-semibold text-sm mb-4">{s.segment_name}</div>
                    <div className="text-xs text-secondary">
                      {Number(s.customer_count || 0).toLocaleString()} customers
                    </div>
                  </div>
                  {hasUtm ? (
                    <span className="badge badge-green" style={{ fontSize: 10 }}>{s.utm_count} links</span>
                  ) : (
                    <span className="badge badge-gray" style={{ fontSize: 10 }}>No UTM</span>
                  )}
                </div>
                <div className="mb-8" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div className="text-center" style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
                    <div className="font-bold" style={{ fontSize: 15, color: 'var(--purple)' }}>{campaignCount}</div>
                    <div className="text-xs text-tertiary">campaigns</div>
                  </div>
                  <div className="text-center" style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
                    <div className="font-bold" style={{ fontSize: 15, color: 'var(--green)' }}>{Number(s.total_clicks || 0).toLocaleString()}</div>
                    <div className="text-xs text-tertiary">clicks</div>
                  </div>
                  <div className="text-center" style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
                    <div className="font-bold" style={{ fontSize: 15, color: 'var(--orange)' }}>{Number(s.total_conversions || 0).toLocaleString()}</div>
                    <div className="text-xs text-tertiary">conversions</div>
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleGenerateSegment(s.segment_name)}
                  disabled={generatingOne === s.segment_name || campaignCount === 0}
                  style={{ width: '100%', fontSize: 11, justifyContent: 'center' }}
                >
                  {generatingOne === s.segment_name ? 'Generating...' : hasUtm ? 'Regenerate UTM Links' : 'Generate UTM Links'}
                </button>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* Tab: UTM Builder */}
      {activeTab === 'builder' && (
        <motion.div variants={fadeInUp} className="card-grid card-grid-2 gap-20">
          {/* Builder Form */}
          <div className="card card-section">
            <div className="flex items-center gap-8 mb-20">
              <div className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--red-dim)' }}>
                <Link2 size={18} color="var(--red)" />
              </div>
              <div>
                <div className="font-bold" style={{ fontSize: 15 }}>Custom UTM Builder</div>
                <div className="text-xs text-secondary">Build a tracked link for any campaign</div>
              </div>
            </div>
            <div className="flex flex-col gap-12">
              <div className="form-group">
                <label className="text-xs font-semibold text-secondary" style={{ display: 'block', marginBottom: 4 }}>Segment</label>
                <select value={builder.segmentLabel} onChange={e => setBuilder({...builder, segmentLabel: e.target.value})}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}>
                  <option value="">Select segment...</option>
                  {segments.map(s => (
                    <option key={s.segment_name} value={s.segment_name}>
                      {s.segment_name} ({s.customer_count} customers)
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="text-xs font-semibold text-secondary" style={{ display: 'block', marginBottom: 4 }}>Campaign Name</label>
                <input value={builder.campaignName} onChange={e => setBuilder({...builder, campaignName: e.target.value})}
                  placeholder="e.g. Spring_Sale_Email" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="text-xs font-semibold text-secondary" style={{ display: 'block', marginBottom: 4 }}>Channel</label>
                  <select value={builder.channel} onChange={e => setBuilder({...builder, channel: e.target.value})}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }}>
                    {['email', 'whatsapp', 'sms', 'push', 'web'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="text-xs font-semibold text-secondary" style={{ display: 'block', marginBottom: 4 }}>Content #</label>
                  <input type="number" value={builder.contentNumber} onChange={e => setBuilder({...builder, contentNumber: parseInt(e.target.value) || 1})}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }} />
                </div>
              </div>
              <div className="form-group">
                <label className="text-xs font-semibold text-secondary" style={{ display: 'block', marginBottom: 4 }}>Landing Page URL</label>
                <input value={builder.baseUrl} onChange={e => setBuilder({...builder, baseUrl: e.target.value})}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 13 }} />
              </div>
              <button className="btn btn-primary" onClick={handleBuild} disabled={!builder.segmentLabel || !builder.campaignName}
                style={{ width: '100%', padding: '12px', justifyContent: 'center' }}>
                <Link2 size={14} /> Generate UTM Link
              </button>
            </div>
          </div>

          {/* Result + Reference */}
          <div className="flex flex-col gap-16">
            {/* Generated URL */}
            {generatedUrl ? (
              <div className="card p-20" style={{ borderTop: '3px solid var(--green)' }}>
                <div className="text-sm font-semibold mb-8 flex items-center gap-4" style={{ color: 'var(--green)' }}>
                  <Check size={14} /> Generated UTM Link
                </div>
                <div className="code-block mb-8" style={{
                  padding: 12, fontSize: 12, wordBreak: 'break-all', lineHeight: 1.8
                }}>
                  {generatedUrl.split('?')[0]}
                  <span className="text-tertiary">?</span>
                  {generatedUrl.split('?')[1]?.split('&').map((p, i) => {
                    const [key, val] = p.split('=');
                    return (
                      <span key={i}>
                        {i > 0 && <span className="text-tertiary">&</span>}
                        <span style={{ color: 'var(--red)' }}>{key}</span>
                        <span className="text-tertiary">=</span>
                        <span className="font-semibold" style={{ color: 'var(--green)' }}>{decodeURIComponent(val)}</span>
                      </span>
                    );
                  })}
                </div>
                <div className="flex gap-8">
                  <button onClick={() => copyUrl(generatedUrl, 'builder')}
                    className={`btn ${copiedId === 'builder' ? 'btn-primary' : 'btn-secondary'} flex items-center justify-center gap-4`}
                    style={{ flex: 1, padding: '10px', fontSize: 12 }}>
                    {copiedId === 'builder' ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy Full URL</>}
                  </button>
                  <a href={generatedUrl} target="_blank" rel="noreferrer"
                    className="btn btn-secondary flex items-center gap-4"
                    style={{ padding: '10px 16px', fontSize: 12, textDecoration: 'none' }}>
                    <ExternalLink size={12} /> Test
                  </a>
                </div>
              </div>
            ) : (
              <div className="card p-24 text-center text-tertiary">
                <Link2 size={32} className="mb-8" style={{ opacity: 0.3 }} />
                <div className="text-sm">Fill in the form and click Generate</div>
              </div>
            )}

            {/* UTM Parameter Reference */}
            <div className="card p-20">
              <div className="text-sm font-semibold text-secondary mb-8">UTM Parameter Reference</div>
              <div className="flex flex-col gap-4">
                {[
                  { param: 'utm_source', value: 'rayna_platform', desc: 'Fixed -- identifies our platform' },
                  { param: 'utm_medium', value: 'email / whatsapp / sms', desc: 'Channel used to send' },
                  { param: 'utm_campaign', value: '[campaign]_[segment]', desc: 'Campaign name + segment' },
                  { param: 'utm_content', value: '[channel]_camp[id]', desc: 'Channel + campaign ID' },
                ].map(r => (
                  <div key={r.param} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, padding: '8px 10px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 11 }}>
                    <code style={{ color: 'var(--red)', fontWeight: 600 }}>{r.param}</code>
                    <div>
                      <div className="font-semibold">{r.value}</div>
                      <div className="text-xs text-tertiary">{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </motion.div>
  );
}
