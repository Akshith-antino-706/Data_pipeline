'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getGTMSnippet, getDataLayerScripts, getGTMAnalytics, getGTMEventDetail, getSpecialOccasions, getGTMExport, getEmailUtmLog, getEmailUtmSummary } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Code, Calendar, Download, Activity, Layers, Copy, Mail, MousePointer, Users, Target, ExternalLink, RefreshCw, Search } from 'lucide-react';

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

  // Event detail state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetails, setEventDetails] = useState([]);
  const [eventDetailLoading, setEventDetailLoading] = useState(false);

  // Email UTM tracking state
  const [utmVisits, setUtmVisits] = useState([]);
  const [utmTotal, setUtmTotal] = useState(0);
  const [utmPage, setUtmPage] = useState(1);
  const [utmSummary, setUtmSummary] = useState({ byCampaign: [], bySource: [] });
  const [utmLoading, setUtmLoading] = useState(false);
  const [utmSearch, setUtmSearch] = useState('');
  const [utmCampaignFilter, setUtmCampaignFilter] = useState('');

  useEffect(() => { load(); loadUtmData(); }, []);

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

  async function loadEventDetail(eventName) {
    if (selectedEvent === eventName) { setSelectedEvent(null); setEventDetails([]); return; }
    setSelectedEvent(eventName);
    setEventDetailLoading(true);
    try {
      const res = await getGTMEventDetail(eventName);
      setEventDetails(res?.data || []);
    } catch (err) { console.error(err); }
    setEventDetailLoading(false);
  }

  async function loadUtmData(page = 1, search = '', campaign = '') {
    setUtmLoading(true);
    try {
      const params = { page, limit: 50 };
      if (search) params.email = search;
      if (campaign) params.utm_campaign = campaign;

      const [visits, summary] = await Promise.all([
        getEmailUtmLog(params),
        getEmailUtmSummary(),
      ]);
      setUtmVisits(visits?.data?.rows || []);
      setUtmTotal(visits?.data?.total || 0);
      setUtmPage(page);
      setUtmSummary({ byCampaign: summary?.data?.byCampaign || [], bySource: summary?.data?.bySource || [] });
    } catch (err) { console.error(err); }
    setUtmLoading(false);
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
    { id: 'overview',      label: 'Event Analytics',   icon: Activity },
    { id: 'emailtracking', label: 'Email Tracking',     icon: Mail,        badge: utmTotal || null },
    { id: 'datalayer',     label: 'DataLayer Scripts',  icon: Code },
    { id: 'occasions',     label: 'Special Occasions',  icon: Calendar },
    { id: 'snippet',       label: 'GTM Container',      icon: Layers },
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
            {t.badge != null && (
              <span style={{
                fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700,
                background: activeTab === t.id ? 'rgba(255,255,255,0.25)' : 'var(--bg-secondary)',
                color: activeTab === t.id ? '#fff' : 'var(--text-secondary)',
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </motion.div>

      {/* ── Event Analytics ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <motion.div variants={fadeInUp}>
          <div className="kpi-strip" style={{ marginBottom: 24 }}>
            {analytics.top_events?.map(e => (
              <div key={e.event_name} className="card" onClick={() => loadEventDetail(e.event_name)}
                style={{ cursor: 'pointer', border: selectedEvent === e.event_name ? '2px solid var(--brand-primary)' : undefined, transition: 'border 0.2s' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{e.event_name}</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{parseInt(e.count).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{parseInt(e.unique_users).toLocaleString()} unique users</div>
                {parseFloat(e.total_value) > 0 && <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>AED {parseFloat(e.total_value).toFixed(0)}</div>}
                <div style={{ fontSize: 10, color: 'var(--brand-primary)', marginTop: 4 }}>Click to view details →</div>
              </div>
            ))}
          </div>

          {/* Event Detail Table */}
          {selectedEvent && (
            <div className="card" style={{ overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Activity size={16} color="var(--brand-primary)" />
                  {selectedEvent} — Activity Details
                  <span className="badge badge-blue" style={{ fontSize: 10 }}>{eventDetails.length}</span>
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => { setSelectedEvent(null); setEventDetails([]); }}>✕ Close</button>
              </div>
              {eventDetailLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</div>
              ) : eventDetails.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        {['Product / Label', 'Value (AED)', 'Category', 'Page', 'Device', 'Browser', 'Location', 'UTM Source', 'Campaign', 'Time'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {eventDetails.map((e, i) => (
                        <tr key={e.event_id || i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 600, maxWidth: 200 }}>{e.event_label || '—'}</td>
                          <td style={{ padding: '10px 14px', color: 'var(--green)', fontWeight: 700 }}>
                            {e.event_value ? `AED ${parseFloat(e.event_value).toFixed(0)}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span className="badge badge-gray" style={{ fontSize: 10 }}>{e.event_category || '—'}</span>
                          </td>
                          <td style={{ padding: '10px 14px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.page_url ? (
                              <a href={e.page_url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontSize: 11 }}>
                                {(() => { try { return new URL(e.page_url).pathname; } catch { return e.page_url; } })()}
                              </a>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                            <span className="badge badge-blue" style={{ fontSize: 10 }}>{e.device_type || '—'}</span>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 11 }}>{e.browser || '—'}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 11 }}>
                            {[e.city, e.country].filter(Boolean).join(', ') || '—'}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 11 }}>{e.utm_source || '—'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 11 }}>{e.utm_campaign || '—'}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 11 }}>
                            {new Date(e.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>No detail rows found.</div>
              )}
            </div>
          )}

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

      {/* ── Email Tracking ──────────────────────────────────────────────── */}
      {activeTab === 'emailtracking' && (
        <motion.div variants={fadeInUp} className="flex flex-col gap-16">

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Total Clicks',     value: utmTotal,                                    color: 'var(--brand-primary)', icon: MousePointer },
              { label: 'Unique Contacts',  value: new Set(utmVisits.map(v => v.email)).size,   color: 'var(--purple)',        icon: Users },
              { label: 'Campaigns',        value: utmSummary.byCampaign.length,                color: 'var(--green)',         icon: Target },
              { label: 'Sources',          value: utmSummary.bySource.length,                  color: 'var(--orange)',        icon: Mail },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="card" style={{ padding: '16px 20px', borderTop: `3px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                  </div>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `color-mix(in srgb, ${color} 10%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={color} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Campaign breakdown chart */}
          {utmSummary.byCampaign.length > 0 && (
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Clicks by Campaign</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={utmSummary.byCampaign} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} style={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="utm_campaign" width={180} style={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v, n) => [v, n === 'total_clicks' ? 'Total Clicks' : 'Unique Visitors']}
                  />
                  <Bar dataKey="total_clicks"    fill="var(--brand-primary)" radius={[0, 4, 4, 0]} name="total_clicks" />
                  <Bar dataKey="unique_visitors" fill="var(--purple)"        radius={[0, 4, 4, 0]} name="unique_visitors" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Campaign summary table */}
          {utmSummary.byCampaign.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: 13 }}>
                Campaign Breakdown
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    {['Campaign', 'Source', 'Medium', 'Total Clicks', 'Unique Visitors', 'Unique Emails'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {utmSummary.byCampaign.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600 }}>
                        <button onClick={() => { setUtmCampaignFilter(r.utm_campaign); loadUtmData(1, utmSearch, r.utm_campaign); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand-primary)', fontWeight: 600, fontSize: 12, padding: 0 }}>
                          {r.utm_campaign}
                        </button>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>{r.utm_source}</span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className="badge badge-gray" style={{ fontSize: 10 }}>{r.utm_medium}</span>
                      </td>
                      <td style={{ padding: '10px 16px', fontWeight: 700, color: 'var(--green)' }}>{r.total_clicks}</td>
                      <td style={{ padding: '10px 16px' }}>{r.unique_visitors}</td>
                      <td style={{ padding: '10px 16px' }}>{r.unique_emails}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Filters */}
          <div className="card p-16" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, alignItems: 'end' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Search by Email</div>
              <div style={{ position: 'relative' }}>
                <Search size={13} style={{ position: 'absolute', left: 9, top: 10, color: 'var(--text-tertiary)' }} />
                <input value={utmSearch}
                  onChange={e => setUtmSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadUtmData(1, utmSearch, utmCampaignFilter)}
                  placeholder="email@example.com"
                  style={{ width: '100%', padding: '9px 12px 9px 28px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, background: 'var(--bg-secondary)' }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Filter by Campaign</div>
              <select value={utmCampaignFilter} onChange={e => setUtmCampaignFilter(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 12, background: 'var(--bg-secondary)' }}>
                <option value="">All Campaigns</option>
                {utmSummary.byCampaign.map(c => (
                  <option key={c.utm_campaign} value={c.utm_campaign}>{c.utm_campaign}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary flex items-center gap-4" onClick={() => loadUtmData(1, utmSearch, utmCampaignFilter)}>
              <Search size={13} /> Search
            </button>
            <button className="btn btn-secondary flex items-center gap-4" onClick={() => { setUtmSearch(''); setUtmCampaignFilter(''); loadUtmData(1); }}>
              <RefreshCw size={13} /> Reset
            </button>
          </div>

          {/* Visits table */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mail size={15} color="var(--brand-primary)" />
                Email UTM Visits
                <span className="badge badge-blue" style={{ fontSize: 10 }}>{utmTotal}</span>
              </div>
              <button className="btn btn-sm btn-secondary flex items-center gap-4" onClick={() => loadUtmData(utmPage, utmSearch, utmCampaignFilter)}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>

            {utmLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</div>
            ) : utmVisits.length > 0 ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        {['Contact', 'Email', 'Campaign', 'Source / Medium', 'Destination URL', 'Visited At'].map(h => (
                          <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {utmVisits.map(v => (
                        <tr key={v.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '10px 16px', fontWeight: 600, whiteSpace: 'nowrap' }}>{v.contact_name || '—'}</td>
                          <td style={{ padding: '10px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{v.email}</td>
                          <td style={{ padding: '10px 16px' }}>
                            <span className="badge badge-blue" style={{ fontSize: 10 }}>{v.utm_campaign || '—'}</span>
                          </td>
                          <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 11 }}>{v.utm_source || '—'}</span>
                            {v.utm_medium && <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}> / {v.utm_medium}</span>}
                          </td>
                          <td style={{ padding: '10px 16px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.destination_url ? (
                              <a href={v.destination_url} target="_blank" rel="noreferrer"
                                style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <ExternalLink size={10} />
                                {(() => { try { return new URL(v.destination_url).pathname; } catch { return v.destination_url; } })()}
                              </a>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 11 }}>
                            {new Date(v.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {utmTotal > 50 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Showing {(utmPage - 1) * 50 + 1}–{Math.min(utmPage * 50, utmTotal)} of {utmTotal}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm btn-secondary" disabled={utmPage === 1}
                        onClick={() => loadUtmData(utmPage - 1, utmSearch, utmCampaignFilter)}>← Prev</button>
                      <button className="btn btn-sm btn-secondary" disabled={utmPage * 50 >= utmTotal}
                        onClick={() => loadUtmData(utmPage + 1, utmSearch, utmCampaignFilter)}>Next →</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <Mail size={40} color="var(--text-tertiary)" style={{ opacity: 0.3, marginBottom: 12 }} />
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 15 }}>No email visits yet</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Send a test email and click a link — the UTM data will appear here.
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── DataLayer Scripts ───────────────────────────────────────────── */}
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
            <pre className="code-block">{scripts[selectedScript]}</pre>
          </div>
        </motion.div>
      )}

      {/* ── Special Occasions ───────────────────────────────────────────── */}
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
                <div>{o.coupon_active && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{o.discount_value}% off</span>}</div>
                {o.target_markets && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Markets:</span>{' '}
                    {(Array.isArray(o.target_markets) ? o.target_markets : typeof o.target_markets === 'string' ? o.target_markets.replace(/[{}]/g, '').split(',').filter(Boolean) : []).join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* ── GTM Container Snippet ───────────────────────────────────────── */}
      {activeTab === 'snippet' && snippet && (
        <motion.div variants={fadeInUp}>
          <div className="card" style={{ padding: 24, marginBottom: 16 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Head Snippet (place in &lt;head&gt;)</h3>
              <button onClick={() => copyToClipboard(snippet.head, 'head')}
                className={`btn btn-sm ${copied === 'head' ? 'btn-primary' : 'btn-secondary'}`} style={{ gap: 4 }}>
                <Copy size={12} /> {copied === 'head' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="code-block">{snippet.head}</pre>
          </div>
          <div className="card" style={{ padding: 24 }}>
            <div className="card-header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Body Snippet (place after &lt;body&gt;)</h3>
              <button onClick={() => copyToClipboard(snippet.body, 'body')}
                className={`btn btn-sm ${copied === 'body' ? 'btn-primary' : 'btn-secondary'}`} style={{ gap: 4 }}>
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
