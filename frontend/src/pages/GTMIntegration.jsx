import { useState, useEffect } from 'react';
import { getGTMSnippet, getDataLayerScripts, getGTMAnalytics, getSpecialOccasions, getGTMExport } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Code, Calendar, Download, Activity, Layers, Copy } from 'lucide-react';

export default function GTMIntegration() {
  const [snippet, setSnippet] = useState(null);
  const [scripts, setScripts] = useState({});
  const [analytics, setAnalytics] = useState({ daily: [], top_events: [] });
  const [occasions, setOccasions] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedScript, setSelectedScript] = useState('page_view');
  const [copied, setCopied] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [snip, scr, ana, occ] = await Promise.all([
        getGTMSnippet(), getDataLayerScripts(), getGTMAnalytics(), getSpecialOccasions()
      ]);
      setSnippet(snip);
      setScripts(scr);
      setAnalytics(ana);
      setOccasions(occ);
    } catch (err) { console.error(err); }
  }

  function copyToClipboard(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  async function handleExport() {
    try {
      const data = await getGTMExport();
      const blob = new Blob([JSON.stringify(data.rows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'bigquery_export.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  }

  const tabs = [
    { id: 'overview', label: 'Event Analytics', icon: Activity },
    { id: 'datalayer', label: 'DataLayer Scripts', icon: Code },
    { id: 'occasions', label: 'Special Occasions', icon: Calendar },
    { id: 'snippet', label: 'GTM Container', icon: Layers },
  ];

  const occasionColors = { festival: '#fbbf24', holiday: '#ef4444', season: '#22c55e', event: '#dc2626', custom: '#eab308' };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>GTM & BigQuery</h1>
          <p style={{ color: '#78716c', margin: '4px 0 0' }}>Google Tag Manager integration, dataLayer events, and BigQuery export</p>
        </div>
        <button onClick={handleExport}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          <Download size={16} /> Export to BigQuery
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 20, border: activeTab === t.id ? '2px solid #dc2626' : '1px solid #e7e5e4', background: activeTab === t.id ? '#fef2f2' : 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Event Analytics */}
      {activeTab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            {analytics.top_events?.map(e => (
              <div key={e.event_name} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e7e5e4' }}>
                <div style={{ fontSize: 12, color: '#78716c', marginBottom: 4 }}>{e.event_name}</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{parseInt(e.count).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: '#a8a29e' }}>{parseInt(e.unique_users).toLocaleString()} unique users</div>
                {parseFloat(e.total_value) > 0 && <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>AED {parseFloat(e.total_value).toFixed(0)}</div>}
              </div>
            ))}
          </div>

          <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
            <h3 style={{ margin: '0 0 16px' }}>Daily Event Volume</h3>
            {analytics.daily?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.daily.slice(0, 30)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                  <YAxis />
                  <Tooltip labelFormatter={d => new Date(d).toLocaleDateString()} />
                  <Bar dataKey="event_count" fill="#dc2626" radius={[6, 6, 0, 0]} name="Events" />
                  <Bar dataKey="unique_users" fill="#22c55e" radius={[6, 6, 0, 0]} name="Users" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p style={{ color: '#a8a29e', textAlign: 'center', padding: 40 }}>GTM events will appear here as they are captured.</p>}
          </div>
        </div>
      )}

      {/* DataLayer Scripts */}
      {activeTab === 'datalayer' && (
        <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 24 }}>
          <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #e7e5e4' }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Events ({Object.keys(scripts).length})</h4>
            {Object.keys(scripts).map(key => (
              <button key={key} onClick={() => setSelectedScript(key)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', marginBottom: 4, borderRadius: 6, border: selectedScript === key ? '2px solid #dc2626' : '1px solid transparent', background: selectedScript === key ? '#fef2f2' : 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                {key}
              </button>
            ))}
          </div>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedScript}</h3>
              <button onClick={() => copyToClipboard(scripts[selectedScript], selectedScript)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', border: '1px solid #e7e5e4', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: copied === selectedScript ? '#22c55e' : 'white', color: copied === selectedScript ? 'white' : '#333' }}>
                <Copy size={12} /> {copied === selectedScript ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre style={{ background: '#1e293b', color: '#e7e5e4', padding: 20, borderRadius: 8, fontSize: 12, lineHeight: 1.6, overflowX: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>
              {scripts[selectedScript]}
            </pre>
          </div>
        </div>
      )}

      {/* Special Occasions */}
      {activeTab === 'occasions' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
          {occasions.map(o => (
            <div key={o.occasion_id} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e7e5e4', borderLeft: `4px solid ${occasionColors[o.occasion_type]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{o.name}</div>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `${occasionColors[o.occasion_type]}15`, color: occasionColors[o.occasion_type], fontWeight: 600, textTransform: 'capitalize' }}>
                    {o.occasion_type}
                  </span>
                </div>
                {o.is_active && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#22c55e', color: 'white' }}>Active</span>}
              </div>
              <div style={{ fontSize: 13, color: '#78716c', marginBottom: 8 }}>{o.campaign_theme}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div><span style={{ color: '#a8a29e' }}>Start:</span> {new Date(o.start_date).toLocaleDateString()}</div>
                <div><span style={{ color: '#a8a29e' }}>End:</span> {new Date(o.end_date).toLocaleDateString()}</div>
                <div><span style={{ color: '#a8a29e' }}>Coupon:</span> <code style={{ background: '#f5f5f4', padding: '1px 4px', borderRadius: 3 }}>{o.discount_code}</code></div>
                <div>
                  {o.coupon_active && <span style={{ color: '#22c55e', fontWeight: 600 }}>{o.discount_value}% off</span>}
                </div>
                {o.target_markets && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: '#a8a29e' }}>Markets:</span> {o.target_markets?.join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GTM Container Snippet */}
      {activeTab === 'snippet' && snippet && (
        <div>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Head Snippet (place in &lt;head&gt;)</h3>
              <button onClick={() => copyToClipboard(snippet.head, 'head')}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', border: '1px solid #e7e5e4', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: copied === 'head' ? '#22c55e' : 'white', color: copied === 'head' ? 'white' : '#333' }}>
                <Copy size={12} /> {copied === 'head' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre style={{ background: '#1e293b', color: '#e7e5e4', padding: 16, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>{snippet.head}</pre>
          </div>
          <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #e7e5e4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Body Snippet (place after &lt;body&gt;)</h3>
              <button onClick={() => copyToClipboard(snippet.body, 'body')}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', border: '1px solid #e7e5e4', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: copied === 'body' ? '#22c55e' : 'white', color: copied === 'body' ? 'white' : '#333' }}>
                <Copy size={12} /> {copied === 'body' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre style={{ background: '#1e293b', color: '#e7e5e4', padding: 16, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>{snippet.body}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
