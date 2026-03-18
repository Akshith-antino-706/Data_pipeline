import { useState, useEffect } from 'react';
import { getUTMAnalytics, buildUTM, generateSegmentUTM } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Link2, Copy, ExternalLink, Zap } from 'lucide-react';

export default function UTMTracking() {
  const [analytics, setAnalytics] = useState({ links: [], summary: [] });
  const [loading, setLoading] = useState(true);
  const [builder, setBuilder] = useState({ baseUrl: 'https://rayna.com', channel: 'email', campaignName: '', segmentLabel: '', contentNumber: 1 });
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { loadAnalytics(); }, []);

  async function loadAnalytics() {
    setLoading(true);
    try {
      const data = await getUTMAnalytics();
      setAnalytics(data);
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function handleBuild() {
    try {
      const result = await buildUTM(builder);
      setGeneratedUrl(result.utm_url);
    } catch (err) { console.error(err); }
  }

  function copyUrl() {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const channelColors = { email: '#dc2626', whatsapp: '#22c55e', sms: '#fbbf24', push: '#eab308', rcs: '#06b6d4', web: '#dc2626' };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>UTM Tracking</h1>
      <p style={{ color: '#78716c', margin: '0 0 24px' }}>
        Format: <code style={{ background: '#f5f5f4', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
          ?utm_source=AI_marketer&utm_medium=[channel]&utm_campaign=[name]_[segment]&utm_content=[channel]_[number]
        </code>
      </p>

      {/* UTM Builder */}
      <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4', marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}><Link2 size={18} /> UTM Builder</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#78716c', display: 'block', marginBottom: 4 }}>Base URL</label>
            <input value={builder.baseUrl} onChange={e => setBuilder({...builder, baseUrl: e.target.value})}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#78716c', display: 'block', marginBottom: 4 }}>Channel (Medium)</label>
            <select value={builder.channel} onChange={e => setBuilder({...builder, channel: e.target.value})}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 13 }}>
              {['email', 'whatsapp', 'sms', 'push', 'rcs', 'web'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#78716c', display: 'block', marginBottom: 4 }}>Campaign Name</label>
            <input value={builder.campaignName} onChange={e => setBuilder({...builder, campaignName: e.target.value})}
              placeholder="e.g. Welcome_Flow" style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#78716c', display: 'block', marginBottom: 4 }}>Segment Label</label>
            <input value={builder.segmentLabel} onChange={e => setBuilder({...builder, segmentLabel: e.target.value})}
              placeholder="e.g. S1" style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#78716c', display: 'block', marginBottom: 4 }}>Content #</label>
            <input type="number" value={builder.contentNumber} onChange={e => setBuilder({...builder, contentNumber: parseInt(e.target.value) || 1})}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #e7e5e4', borderRadius: 6, fontSize: 13 }} />
          </div>
        </div>
        <button onClick={handleBuild} style={{ padding: '10px 24px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
          Generate UTM URL
        </button>

        {generatedUrl && (
          <div style={{ marginTop: 16, background: '#fafaf9', border: '1px solid #e7e5e4', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#78716c' }}>Generated URL:</span>
              <span style={{ fontSize: 10, padding: '2px 8px', background: '#22c55e', color: 'white', borderRadius: 10 }}>utm_source=AI_marketer</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, fontSize: 12, padding: 8, background: 'white', borderRadius: 6, border: '1px solid #e7e5e4', wordBreak: 'break-all' }}>
                {generatedUrl}
              </code>
              <button onClick={copyUrl} style={{ padding: '8px 16px', border: '1px solid #e7e5e4', borderRadius: 6, cursor: 'pointer', background: copied ? '#22c55e' : 'white', color: copied ? 'white' : '#333', fontSize: 12 }}>
                <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Channel Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>UTM Links by Channel</h3>
          {analytics.summary?.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={analytics.summary}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total_links" fill="#dc2626" radius={[6, 6, 0, 0]} name="Links" />
                <Bar dataKey="total_clicks" fill="#22c55e" radius={[6, 6, 0, 0]} name="Clicks" />
                <Bar dataKey="total_conversions" fill="#fbbf24" radius={[6, 6, 0, 0]} name="Conversions" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p style={{ color: '#a8a29e', textAlign: 'center', padding: 40 }}>No UTM data yet. Generate UTM links for segments to see analytics.</p>}
        </div>

        <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>UTM Parameters Reference</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e7e5e4' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Parameter</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Value</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Example</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['utm_source', 'AI_marketer', 'AI_marketer (fixed)'],
                ['utm_medium', 'Channel type', 'email, whatsapp, sms'],
                ['utm_campaign', 'Campaign_Segment', 'Welcome_Flow_S1'],
                ['utm_content', 'Channel_Number', 'email_1, whatsapp_2'],
              ].map(([param, val, ex]) => (
                <tr key={param} style={{ borderBottom: '1px solid #f5f5f4' }}>
                  <td style={{ padding: 8 }}><code style={{ background: '#f5f5f4', padding: '1px 4px', borderRadius: 4 }}>{param}</code></td>
                  <td style={{ padding: 8, color: '#78716c' }}>{val}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11 }}>{ex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent UTM Links */}
      <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Recent UTM Links ({analytics.links?.length || 0})</h3>
        {analytics.links?.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e7e5e4', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Segment</th>
                  <th style={{ padding: 8 }}>Channel</th>
                  <th style={{ padding: 8 }}>Campaign</th>
                  <th style={{ padding: 8 }}>Content</th>
                  <th style={{ padding: 8 }}>Clicks</th>
                  <th style={{ padding: 8 }}>Conv.</th>
                  <th style={{ padding: 8 }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {analytics.links.slice(0, 30).map(l => (
                  <tr key={l.utm_id} style={{ borderBottom: '1px solid #f5f5f4' }}>
                    <td style={{ padding: 8 }}>{l.segment_label}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: `${channelColors[l.channel] || '#6b7280'}15`, color: channelColors[l.channel] || '#6b7280', fontSize: 11, fontWeight: 600 }}>
                        {l.channel}
                      </span>
                    </td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>{l.utm_campaign}</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>{l.utm_content}</td>
                    <td style={{ padding: 8, fontWeight: 600 }}>{l.clicks}</td>
                    <td style={{ padding: 8, fontWeight: 600 }}>{l.conversions}</td>
                    <td style={{ padding: 8, fontWeight: 600 }}>AED {parseFloat(l.revenue || 0).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p style={{ color: '#a8a29e', textAlign: 'center', padding: 40 }}>No UTM links generated yet.</p>}
      </div>
    </div>
  );
}
