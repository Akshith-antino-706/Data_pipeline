import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getGTMSnippet, getDataLayerScripts, getGTMAnalytics, getSpecialOccasions, getGTMExport } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Code, Calendar, Download, Activity, Layers, Copy } from 'lucide-react';

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

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
      setSnippet(snip?.data || snip || null);
      setScripts(scr?.data || scr || {});
      setAnalytics(ana?.data || ana || { daily: [], top_events: [] });
      setOccasions(Array.isArray(occ) ? occ : (occ?.data || []));
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

  const occasionColors = { festival: 'var(--yellow)', holiday: 'var(--red)', season: 'var(--green)', event: 'var(--red)', custom: 'var(--yellow)' };

  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: 24 }}>
      <motion.div variants={fadeInUp} className="card-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>GTM & BigQuery</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>Google Tag Manager integration, dataLayer events, and BigQuery export</p>
        </div>
        <button className="btn btn-primary" onClick={handleExport} style={{ gap: 8 }}>
          <Download size={16} /> Export to BigQuery
        </button>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={fadeInUp} className="tabs" style={{ marginBottom: 24 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </motion.div>

      {/* Event Analytics */}
      {activeTab === 'overview' && (
        <motion.div variants={fadeInUp}>
          <div className="kpi-strip" style={{ marginBottom: 24 }}>
            {analytics.top_events?.map(e => (
              <div key={e.event_name} className="card">
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{e.event_name}</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{parseInt(e.count).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{parseInt(e.unique_users).toLocaleString()} unique users</div>
                {parseFloat(e.total_value) > 0 && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>AED {parseFloat(e.total_value).toFixed(0)}</div>}
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: '0 0 16px' }}>Daily Event Volume</h3>
            {analytics.daily?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.daily.slice(0, 30)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickFormatter={d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                  <YAxis />
                  <Tooltip labelFormatter={d => new Date(d).toLocaleDateString()} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="event_count" fill="var(--red)" radius={[6, 6, 0, 0]} name="Events" />
                  <Bar dataKey="unique_users" fill="var(--green)" radius={[6, 6, 0, 0]} name="Users" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 40 }}>GTM events will appear here as they are captured.</p>}
          </div>
        </motion.div>
      )}

      {/* DataLayer Scripts */}
      {activeTab === 'datalayer' && (
        <motion.div variants={fadeInUp} style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 24 }}>
          <div className="card" style={{ padding: 16 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Events ({Object.keys(scripts).length})</h4>
            {Object.keys(scripts).map(key => (
              <button key={key} onClick={() => setSelectedScript(key)}
                className={`tab ${selectedScript === key ? 'active' : ''}`}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}>
                {key}
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{selectedScript}</h3>
              <button onClick={() => copyToClipboard(scripts[selectedScript], selectedScript)}
                className={`btn btn-sm ${copied === selectedScript ? 'btn-primary' : 'btn-secondary'}`}
                style={{ gap: 4 }}>
                <Copy size={12} /> {copied === selectedScript ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="code-block">
              {scripts[selectedScript]}
            </pre>
          </div>
        </motion.div>
      )}

      {/* Special Occasions */}
      {activeTab === 'occasions' && (
        <motion.div variants={fadeInUp} className="grid-auto">
          {occasions.map(o => (
            <div key={o.occasion_id} className="card" style={{ borderLeft: `4px solid ${occasionColors[o.occasion_type]}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{o.name}</div>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: `color-mix(in srgb, ${occasionColors[o.occasion_type]} 10%, transparent)`, color: occasionColors[o.occasion_type], fontWeight: 600, textTransform: 'capitalize' }}>
                    {o.occasion_type}
                  </span>
                </div>
                {o.is_active && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--green)', color: '#fff' }}>Active</span>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{o.campaign_theme}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Start:</span> {new Date(o.start_date).toLocaleDateString()}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>End:</span> {new Date(o.end_date).toLocaleDateString()}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Coupon:</span> <code style={{ background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3 }}>{o.discount_code}</code></div>
                <div>
                  {o.coupon_active && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{o.discount_value}% off</span>}
                </div>
                {o.target_markets && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Markets:</span> {(Array.isArray(o.target_markets) ? o.target_markets : typeof o.target_markets === 'string' ? o.target_markets.replace(/[{}]/g, '').split(',').filter(Boolean) : []).join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* GTM Container Snippet */}
      {activeTab === 'snippet' && snippet && (
        <motion.div variants={fadeInUp}>
          <div className="card" style={{ padding: 24, marginBottom: 16 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Head Snippet (place in &lt;head&gt;)</h3>
              <button onClick={() => copyToClipboard(snippet.head, 'head')}
                className={`btn btn-sm ${copied === 'head' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ gap: 4 }}>
                <Copy size={12} /> {copied === 'head' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="code-block">{snippet.head}</pre>
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Body Snippet (place after &lt;body&gt;)</h3>
              <button onClick={() => copyToClipboard(snippet.body, 'body')}
                className={`btn btn-sm ${copied === 'body' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ gap: 4 }}>
                <Copy size={12} /> {copied === 'body' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="code-block">{snippet.body}</pre>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
