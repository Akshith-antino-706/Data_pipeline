import { useState, useEffect } from 'react';
import { getUTMAnalytics, getUTMSegments, buildUTM, generateSegmentUTM, generateAllUTM } from '../api';
// recharts available for future UTM analytics charts
import { Link2, Copy, Zap, RefreshCw, Target, MousePointer, TrendingUp, ExternalLink, Check, Globe, Mail, MessageSquare, Phone, Bell, Hash } from 'lucide-react';

const CHANNEL_COLORS = { email: '#3b82f6', whatsapp: '#22c55e', sms: '#f59e0b', push: '#ef4444', rcs: '#06b6d4', web: '#8b5cf6' };
const CHANNEL_ICONS = { email: Mail, whatsapp: MessageSquare, sms: Phone, push: Bell, rcs: Hash, web: Globe };

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
      setAnalytics(a);
      setSegments(s.data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadAnalytics() {
    try {
      const a = await getUTMAnalytics(filterSegment ? { segmentLabel: filterSegment } : {});
      setAnalytics(a);
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
    <div>
      {/* Header */}
      <div className="page-header">
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
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Campaign Links', value: totalLinks, color: '#dc2626', icon: Link2 },
          { label: 'Segments Tracked', value: `${segmentsWithUtm}/${segments.length}`, color: '#8b5cf6', icon: Target },
          { label: 'Total Clicks', value: totalClicks, color: '#22c55e', icon: MousePointer },
          { label: 'Conversions', value: totalConversions, color: '#f59e0b', icon: TrendingUp },
          { label: 'Revenue', value: `AED ${totalRevenue.toLocaleString()}`, color: '#3b82f6', icon: Globe },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card" style={{ padding: '16px 20px', borderTop: `3px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={18} color={color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Channel Distribution + Segment Filter */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginBottom: 24 }}>
        {/* Channel Pills */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text-dim)' }}>Links by Channel</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(analytics.summary || []).map(ch => {
              const Icon = CHANNEL_ICONS[ch.channel] || Globe;
              const color = CHANNEL_COLORS[ch.channel] || '#6b7280';
              return (
                <div key={ch.channel} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
                  background: `${color}08`, border: `1.5px solid ${color}30`, borderRadius: 12, minWidth: 130
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={16} color={color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color }}>{ch.total_links}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'capitalize' }}>{ch.channel}</div>
                  </div>
                </div>
              );
            })}
            {(!analytics.summary || analytics.summary.length === 0) && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>No UTM links yet. Click "Generate All Campaign UTMs".</div>
            )}
          </div>
        </div>

        {/* Segment Filter */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text-dim)' }}>Filter by Segment</div>
          <select value={filterSegment} onChange={e => setFilterSegment(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg)', marginBottom: 12 }}>
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
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Showing all {totalLinks} links across {segmentsWithUtm} segments
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {[
          { key: 'campaigns', label: 'Campaign Links', count: analytics.links?.length || 0 },
          { key: 'segments', label: 'Segment Overview', count: segments.length },
          { key: 'builder', label: 'UTM Builder', count: null },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: activeTab === tab.key ? 'var(--accent)' : 'transparent',
            color: activeTab === tab.key ? '#fff' : 'var(--text-dim)',
            borderRadius: '8px 8px 0 0', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            {tab.label}
            {tab.count !== null && (
              <span style={{
                padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                background: activeTab === tab.key ? 'rgba(255,255,255,0.25)' : 'var(--bg)',
                color: activeTab === tab.key ? '#fff' : 'var(--text-dim)'
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Campaign Links */}
      {activeTab === 'campaigns' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {analytics.links?.length > 0 ? analytics.links.slice(0, 60).map(l => {
            const Icon = CHANNEL_ICONS[l.channel] || Globe;
            const color = CHANNEL_COLORS[l.channel] || '#6b7280';
            const isCopied = copiedId === l.utm_id;
            return (
              <div key={l.utm_id} className="card" style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={18} color={color} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{l.campaign_name || l.template_name || 'Unnamed'}</span>
                      <span className={`badge badge-${l.channel === 'whatsapp' ? 'green' : l.channel === 'email' ? 'blue' : l.channel === 'sms' ? 'orange' : 'purple'}`} style={{ fontSize: 9 }}>
                        {l.channel}
                      </span>
                      <span className={`badge ${l.campaign_status === 'running' ? 'badge-green' : l.campaign_status === 'scheduled' ? 'badge-blue' : 'badge-gray'}`} style={{ fontSize: 9 }}>
                        {l.campaign_status || 'draft'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-dim)' }}>
                      <span>Segment: <b>{l.segment_label}</b></span>
                      <span>Audience: <b>{Number(l.target_count || 0).toLocaleString()}</b></span>
                    </div>
                    <div style={{
                      marginTop: 6, padding: '5px 10px', background: 'var(--bg)', borderRadius: 6,
                      border: '1px solid var(--border)', fontSize: 10, fontFamily: 'monospace',
                      color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {l.full_url}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#22c55e' }}>{l.clicks}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>clicks</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#f59e0b' }}>{l.conversions}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>conv.</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#3b82f6' }}>{parseFloat(l.revenue || 0).toFixed(0)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>AED</div>
                    </div>
                  </div>
                  <button
                    onClick={() => copyUrl(l.full_url, l.utm_id)}
                    style={{
                      padding: '5px 14px', borderRadius: 6, border: `1px solid ${isCopied ? '#22c55e' : 'var(--border)'}`,
                      background: isCopied ? '#22c55e' : '#fff', color: isCopied ? '#fff' : 'var(--text)',
                      cursor: 'pointer', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s'
                    }}>
                    {isCopied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy UTM</>}
                  </button>
                </div>
              </div>
            );
          }) : (
            <div className="card" style={{ padding: 60, textAlign: 'center' }}>
              <Link2 size={40} color="var(--text-muted)" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No campaign UTM links yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16 }}>Generate UTM links to track every campaign across all segments</div>
              <button className="btn btn-primary" onClick={handleGenerateAll} disabled={generating}>
                <Zap size={14} /> Generate All Campaign UTMs
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Segment Overview */}
      {activeTab === 'segments' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {segments.map(s => {
            const hasUtm = parseInt(s.utm_count) > 0;
            const campaignCount = parseInt(s.campaign_count) || 0;
            return (
              <div key={s.segment_name} className="card" style={{
                padding: 18, borderLeft: `4px solid ${hasUtm ? '#22c55e' : '#e7e5e4'}`,
                opacity: campaignCount === 0 ? 0.5 : 1
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{s.segment_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {Number(s.customer_count || 0).toLocaleString()} customers
                    </div>
                  </div>
                  {hasUtm ? (
                    <span className="badge badge-green" style={{ fontSize: 10 }}>{s.utm_count} links</span>
                  ) : (
                    <span className="badge badge-gray" style={{ fontSize: 10 }}>No UTM</span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6' }}>{campaignCount}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>campaigns</div>
                  </div>
                  <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e' }}>{Number(s.total_clicks || 0).toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>clicks</div>
                  </div>
                  <div style={{ background: 'var(--bg)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#f59e0b' }}>{Number(s.total_conversions || 0).toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>conversions</div>
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
        </div>
      )}

      {/* Tab: UTM Builder */}
      {activeTab === 'builder' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Builder Form */}
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#dc262612', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Link2 size={18} color="#dc2626" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Custom UTM Builder</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Build a tracked link for any campaign</div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="form-group">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Segment</label>
                <select value={builder.segmentLabel} onChange={e => setBuilder({...builder, segmentLabel: e.target.value})}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
                  <option value="">Select segment...</option>
                  {segments.map(s => (
                    <option key={s.segment_name} value={s.segment_name}>
                      {s.segment_name} ({s.customer_count} customers)
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Campaign Name</label>
                <input value={builder.campaignName} onChange={e => setBuilder({...builder, campaignName: e.target.value})}
                  placeholder="e.g. Spring_Sale_Email" style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Channel</label>
                  <select value={builder.channel} onChange={e => setBuilder({...builder, channel: e.target.value})}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}>
                    {['email', 'whatsapp', 'sms', 'push', 'web'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Content #</label>
                  <input type="number" value={builder.contentNumber} onChange={e => setBuilder({...builder, contentNumber: parseInt(e.target.value) || 1})}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
                </div>
              </div>
              <div className="form-group">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>Landing Page URL</label>
                <input value={builder.baseUrl} onChange={e => setBuilder({...builder, baseUrl: e.target.value})}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
              </div>
              <button className="btn btn-primary" onClick={handleBuild} disabled={!builder.segmentLabel || !builder.campaignName}
                style={{ width: '100%', padding: '12px', justifyContent: 'center' }}>
                <Link2 size={14} /> Generate UTM Link
              </button>
            </div>
          </div>

          {/* Result + Reference */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Generated URL */}
            {generatedUrl ? (
              <div className="card" style={{ padding: 20, borderTop: '3px solid #22c55e' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={14} /> Generated UTM Link
                </div>
                <div style={{
                  padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)',
                  fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.8, marginBottom: 12
                }}>
                  {generatedUrl.split('?')[0]}
                  <span style={{ color: 'var(--text-muted)' }}>?</span>
                  {generatedUrl.split('?')[1]?.split('&').map((p, i) => {
                    const [key, val] = p.split('=');
                    return (
                      <span key={i}>
                        {i > 0 && <span style={{ color: 'var(--text-muted)' }}>&</span>}
                        <span style={{ color: '#dc2626' }}>{key}</span>
                        <span style={{ color: 'var(--text-muted)' }}>=</span>
                        <span style={{ color: '#22c55e', fontWeight: 600 }}>{decodeURIComponent(val)}</span>
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => copyUrl(generatedUrl, 'builder')} style={{
                    flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${copiedId === 'builder' ? '#22c55e' : 'var(--border)'}`,
                    background: copiedId === 'builder' ? '#22c55e' : '#fff', color: copiedId === 'builder' ? '#fff' : 'var(--text)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                  }}>
                    {copiedId === 'builder' ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy Full URL</>}
                  </button>
                  <a href={generatedUrl} target="_blank" rel="noreferrer" style={{
                    padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff',
                    color: 'var(--text)', textDecoration: 'none', fontSize: 12, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <ExternalLink size={12} /> Test
                  </a>
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Link2 size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>Fill in the form and click Generate</div>
              </div>
            )}

            {/* UTM Parameter Reference */}
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-dim)' }}>UTM Parameter Reference</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {[
                  { param: 'utm_source', value: 'rayna_platform', desc: 'Fixed — identifies our platform' },
                  { param: 'utm_medium', value: 'email / whatsapp / sms', desc: 'Channel used to send' },
                  { param: 'utm_campaign', value: '[campaign]_[segment]', desc: 'Campaign name + segment' },
                  { param: 'utm_content', value: '[channel]_camp[id]', desc: 'Channel + campaign ID' },
                ].map(r => (
                  <div key={r.param} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, padding: '8px 10px', background: 'var(--bg)', borderRadius: 6, fontSize: 11 }}>
                    <code style={{ color: '#dc2626', fontWeight: 600 }}>{r.param}</code>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.value}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
