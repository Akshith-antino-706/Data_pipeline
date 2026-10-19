'use client';

import { useState, useEffect } from 'react';
import { getGTMSnippet, getDataLayerScripts, getGTMAnalytics, getGTMEventDetail, getSpecialOccasions, getGTMExport, getEmailUtmLog, getEmailUtmSummary } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { QueryParams } from '@/types/api';
import { Button, Card, Chip, EmptyState, Input, PageHeader, Select, Skeleton, Tabs } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import s from './page.module.css';
import { Code, Calendar, Download, Activity, Layers, Copy, Mail, MousePointer, Users, Target, ExternalLink, RefreshCw, Search } from 'lucide-react';

interface GtmSnippet { head: string; body: string }
interface TopEvent { event_name: string; count: string; unique_users: string; total_value: string }
interface GtmAnalytics { daily: Record<string, unknown>[]; top_events?: TopEvent[] }
interface EventDetail {
  event_id?: string | number; event_label?: string; event_value?: string; event_category?: string; page_url?: string;
  device_type?: string; browser?: string; city?: string; country?: string; utm_source?: string; utm_campaign?: string; created_at: string;
}
interface UtmVisit {
  id: string | number; contact_name?: string; email?: string; utm_campaign?: string; utm_source?: string; utm_medium?: string;
  destination_url?: string; created_at: string;
}
interface UtmCampaignRow {
  utm_campaign: string; utm_source?: string; utm_medium?: string; total_clicks?: number | string;
  unique_visitors?: number | string; unique_emails?: number | string;
}
interface UtmSummary { byCampaign: UtmCampaignRow[]; bySource: Record<string, unknown>[] }
interface SpecialOccasion {
  occasion_id: string | number; occasion_type: string; name?: string; is_active?: boolean; campaign_theme?: string;
  start_date: string; end_date: string; discount_code?: string; coupon_active?: boolean; discount_value?: number | string;
  target_markets?: string[] | string;
}
type Wrapped<T> = { data?: T } & T;

type TabKey = 'overview' | 'emailtracking' | 'datalayer' | 'occasions' | 'snippet';

const occasionTones: Record<string, ChipTone> = { festival: 'gold', holiday: 'bad', season: 'ok', event: 'info', custom: 'warn' };

const urlPath = (u: string): string => { try { return new URL(u).pathname; } catch { return u; } };

function LoadingSkeleton() {
  return (
    <div className={s.page} aria-busy="true" aria-label="Loading GTM data">
      <div className={s.stack}>
        <Skeleton width={220} height={28} />
        <Skeleton width={380} height={14} />
      </div>
      <div className={s.skelRow}>
        {[110, 130, 140, 130, 120].map((w, i) => <Skeleton key={i} width={w} height={32} />)}
      </div>
      <div className={s.kpis}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <Skeleton width={90} height={11} />
            <div style={{ height: 10 }} />
            <Skeleton width={110} height={26} />
          </Card>
        ))}
      </div>
      <Card>
        <div className={s.skelBars}>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className={s.skelBar} style={{ height: `${30 + (i * 37) % 65}%` }} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function GTMIntegration() {
  const [loading, setLoading] = useState(true);
  const [snippet, setSnippet] = useState<GtmSnippet | null>(null);
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [analytics, setAnalytics] = useState<GtmAnalytics>({ daily: [], top_events: [] });
  const [occasions, setOccasions] = useState<SpecialOccasion[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [selectedScript, setSelectedScript] = useState('page_view');
  const [copied, setCopied] = useState('');

  // Event detail state
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [eventDetails, setEventDetails] = useState<EventDetail[]>([]);
  const [eventDetailLoading, setEventDetailLoading] = useState(false);

  // Email UTM tracking state
  const [utmVisits, setUtmVisits] = useState<UtmVisit[]>([]);
  const [utmTotal, setUtmTotal] = useState(0);
  const [utmPage, setUtmPage] = useState(1);
  const [utmSummary, setUtmSummary] = useState<UtmSummary>({ byCampaign: [], bySource: [] });
  const [utmLoading, setUtmLoading] = useState(false);
  const [utmSearch, setUtmSearch] = useState('');
  const [utmCampaignFilter, setUtmCampaignFilter] = useState('');

  useEffect(() => { load(); loadUtmData(); }, []);

  async function load() {
    try {
      const [snip, scr, ana, occ] = await Promise.all([
        getGTMSnippet(), getDataLayerScripts(), getGTMAnalytics(), getSpecialOccasions()
      ]) as [Wrapped<GtmSnippet> | null, Wrapped<Record<string, string>> | null, Wrapped<GtmAnalytics> | null, { data?: SpecialOccasion[] } | SpecialOccasion[] | null];
      setSnippet(snip?.data || snip || null);
      setScripts(scr?.data || scr || {});
      setAnalytics(ana?.data || ana || { daily: [], top_events: [] });
      setOccasions(Array.isArray(occ) ? occ : (occ?.data || []));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function loadEventDetail(eventName: string) {
    if (selectedEvent === eventName) { setSelectedEvent(null); setEventDetails([]); return; }
    setSelectedEvent(eventName);
    setEventDetailLoading(true);
    try {
      const res = await getGTMEventDetail(eventName) as { data?: EventDetail[] } | null;
      setEventDetails(res?.data || []);
    } catch (err) { console.error(err); }
    setEventDetailLoading(false);
  }

  async function loadUtmData(page = 1, search = '', campaign = '') {
    setUtmLoading(true);
    try {
      const params: QueryParams = { page, limit: 50 };
      if (search) params.email = search;
      if (campaign) params.utm_campaign = campaign;

      const [visits, summary] = await Promise.all([
        getEmailUtmLog(params),
        getEmailUtmSummary(),
      ]) as [{ data?: { rows?: UtmVisit[]; total?: number } } | null, { data?: Partial<UtmSummary> } | null];
      setUtmVisits(visits?.data?.rows || []);
      setUtmTotal(visits?.data?.total || 0);
      setUtmPage(page);
      setUtmSummary({ byCampaign: summary?.data?.byCampaign || [], bySource: summary?.data?.bySource || [] });
    } catch (err) { console.error(err); }
    setUtmLoading(false);
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  async function handleExport() {
    try {
      const data = await getGTMExport() as { rows?: unknown };
      const blob = new Blob([JSON.stringify(data.rows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'bigquery_export.json'; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  }

  const tabs: { id: TabKey; label: string; icon: typeof Activity; badge?: number | null }[] = [
    { id: 'overview',      label: 'Event Analytics',   icon: Activity },
    { id: 'emailtracking', label: 'Email Tracking',     icon: Mail,        badge: utmTotal || null },
    { id: 'datalayer',     label: 'DataLayer Scripts',  icon: Code },
    { id: 'occasions',     label: 'Special Occasions',  icon: Calendar },
    { id: 'snippet',       label: 'GTM Container',      icon: Layers },
  ];

  if (loading) return <LoadingSkeleton />;

  const tooltipStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 };

  return (
    <div className={s.page}>
      <PageHeader
        title="GTM & BigQuery"
        description="Google Tag Manager integration, dataLayer events, and BigQuery export"
        actions={<Button variant="primary" onClick={handleExport}><Download size={16} aria-hidden /> Export to BigQuery</Button>}
      />

      <Tabs
        label="GTM sections"
        value={activeTab}
        onChange={setActiveTab}
        items={tabs.map(t => ({
          key: t.id,
          label: (
            <span className={s.tabLabel}>
              <t.icon size={14} aria-hidden /> <span>{t.label}</span>
              {t.badge != null && <span className={s.count}>{t.badge}</span>}
            </span>
          ),
        }))}
      />

      {/* ── Event Analytics ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className={s.stack}>
          {(analytics.top_events?.length ?? 0) > 0 && (
            <div className={s.kpis}>
              {analytics.top_events?.map(e => (
                <button key={e.event_name} type="button" className={s.kpiBtn} aria-pressed={selectedEvent === e.event_name} onClick={() => loadEventDetail(e.event_name)}>
                  <span className={s.kpiLabel}>{e.event_name}</span>
                  <span className={s.kpiValue}>{(parseInt(e.count) || 0).toLocaleString()}</span>
                  <span className={s.kpiSub}>{(parseInt(e.unique_users) || 0).toLocaleString()} unique users</span>
                  {parseFloat(e.total_value) > 0 && <span className={s.kpiMoney}>AED {parseFloat(e.total_value).toFixed(0)}</span>}
                  <span className={s.kpiHint}>Click to view details →</span>
                </button>
              ))}
            </div>
          )}

          {selectedEvent && (
            <Card className={s.flush}>
              <div className={s.flushHead}>
                <h2 className={s.flushTitle}>
                  <Activity size={16} aria-hidden />
                  {selectedEvent} — Activity Details
                  <Chip tone="info">{eventDetails.length}</Chip>
                </h2>
                <Button size="sm" onClick={() => { setSelectedEvent(null); setEventDetails([]); }}>✕ Close</Button>
              </div>
              {eventDetailLoading ? (
                <div className={s.loading}>Loading...</div>
              ) : eventDetails.length > 0 ? (
                <div className={s.tableScroll}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        {['Product / Label', 'Value (AED)', 'Category', 'Page', 'Device', 'Browser', 'Location', 'UTM Source', 'Campaign', 'Time'].map(h => <th key={h}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {eventDetails.map((e, i) => (
                        <tr key={e.event_id || i}>
                          <td className={s.strong}>{e.event_label || '—'}</td>
                          <td className={s.money}>{e.event_value ? `AED ${parseFloat(e.event_value).toFixed(0)}` : '—'}</td>
                          <td><Chip tone="mute">{e.event_category || '—'}</Chip></td>
                          <td className={s.trunc}>
                            {e.page_url ? <a href={e.page_url} target="_blank" rel="noreferrer" className={s.link}>{urlPath(e.page_url)}</a> : '—'}
                          </td>
                          <td className={s.nowrap}><Chip tone="info">{e.device_type || '—'}</Chip></td>
                          <td>{e.browser || '—'}</td>
                          <td className={s.nowrap}>{[e.city, e.country].filter(Boolean).join(', ') || '—'}</td>
                          <td>{e.utm_source || '—'}</td>
                          <td>{e.utm_campaign || '—'}</td>
                          <td className={`${s.nowrap} ${s.muted}`}>{new Date(e.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={s.loading}>No detail rows found.</div>
              )}
            </Card>
          )}

          <Card title="Daily Event Volume">
            {analytics.daily?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.daily.slice(0, 30)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--ink3)' }} tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ink3)' }} />
                  <Tooltip labelFormatter={(d: React.ReactNode) => new Date(d as string).toLocaleDateString()} contentStyle={tooltipStyle} />
                  <Bar dataKey="event_count" fill="var(--gold)" radius={[6, 6, 0, 0]} name="Events" />
                  <Bar dataKey="unique_users" fill="var(--info)" radius={[6, 6, 0, 0]} name="Users" />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={<Activity size={20} />} title="No events yet" description="GTM events will appear here as they are captured." />}
          </Card>
        </div>
      )}

      {/* ── Email Tracking ──────────────────────────────────────────────── */}
      {activeTab === 'emailtracking' && (
        <div className={s.stack}>
          <div className={s.statGrid}>
            {[
              { label: 'Total Clicks',     value: utmTotal,                                    icon: MousePointer },
              { label: 'Unique Contacts',  value: new Set(utmVisits.map(v => v.email)).size,   icon: Users },
              { label: 'Campaigns',        value: utmSummary.byCampaign.length,                icon: Target },
              { label: 'Sources',          value: utmSummary.bySource.length,                  icon: Mail },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <div className={s.stat}>
                  <div>
                    <div className={s.kpiLabel}>{label}</div>
                    <div className={s.kpiValue}>{value.toLocaleString()}</div>
                  </div>
                  <span className={s.statIcon} aria-hidden><Icon size={18} /></span>
                </div>
              </Card>
            ))}
          </div>

          {utmSummary.byCampaign.length > 0 && (
            <Card title="Clicks by Campaign">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={utmSummary.byCampaign} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--line)" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink3)' }} />
                  <YAxis type="category" dataKey="utm_campaign" width={140} tick={{ fontSize: 11, fill: 'var(--ink3)' }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v, n) => [v, n === 'total_clicks' ? 'Total Clicks' : 'Unique Visitors']}
                  />
                  <Bar dataKey="total_clicks"    fill="var(--gold)" radius={[0, 4, 4, 0]} name="total_clicks" />
                  <Bar dataKey="unique_visitors" fill="var(--info)" radius={[0, 4, 4, 0]} name="unique_visitors" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {utmSummary.byCampaign.length > 0 && (
            <Card className={s.flush}>
              <div className={s.flushHead}><h2 className={s.flushTitle}>Campaign Breakdown</h2></div>
              <div className={s.tableScroll}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      {['Campaign', 'Source', 'Medium', 'Total Clicks', 'Unique Visitors', 'Unique Emails'].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {utmSummary.byCampaign.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <button type="button" className={s.linkBtn} onClick={() => { setUtmCampaignFilter(r.utm_campaign); loadUtmData(1, utmSearch, r.utm_campaign); }}>
                            {r.utm_campaign}
                          </button>
                        </td>
                        <td>{r.utm_source ? <Chip tone="info">{r.utm_source}</Chip> : '—'}</td>
                        <td>{r.utm_medium ? <Chip tone="mute">{r.utm_medium}</Chip> : '—'}</td>
                        <td className={s.money}>{r.total_clicks ?? '—'}</td>
                        <td>{r.unique_visitors ?? '—'}</td>
                        <td>{r.unique_emails ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <div className={s.filters}>
              <div className="ui-field">
                <label className="ui-label" htmlFor="utm-search">Search by Email</label>
                <div className={s.searchWrap}>
                  <Search size={14} className={s.searchIcon} aria-hidden />
                  <Input id="utm-search" className={s.searchInput} value={utmSearch}
                    onChange={e => setUtmSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && loadUtmData(1, utmSearch, utmCampaignFilter)}
                    placeholder="email@example.com" />
                </div>
              </div>
              <div className="ui-field">
                <label className="ui-label" htmlFor="utm-campaign">Filter by Campaign</label>
                <Select id="utm-campaign" value={utmCampaignFilter} onChange={e => setUtmCampaignFilter(e.target.value)}>
                  <option value="">All Campaigns</option>
                  {utmSummary.byCampaign.map(c => (
                    <option key={c.utm_campaign} value={c.utm_campaign}>{c.utm_campaign}</option>
                  ))}
                </Select>
              </div>
              <Button variant="primary" onClick={() => loadUtmData(1, utmSearch, utmCampaignFilter)}>
                <Search size={14} aria-hidden /> Search
              </Button>
              <Button onClick={() => { setUtmSearch(''); setUtmCampaignFilter(''); loadUtmData(1); }}>
                <RefreshCw size={14} aria-hidden /> Reset
              </Button>
            </div>
          </Card>

          <Card className={s.flush}>
            <div className={s.flushHead}>
              <h2 className={s.flushTitle}>
                <Mail size={15} aria-hidden />
                Email UTM Visits
                <Chip tone="info">{utmTotal}</Chip>
              </h2>
              <Button size="sm" onClick={() => loadUtmData(utmPage, utmSearch, utmCampaignFilter)}>
                <RefreshCw size={12} aria-hidden /> Refresh
              </Button>
            </div>

            {utmLoading ? (
              <div className={s.loading}>Loading...</div>
            ) : utmVisits.length > 0 ? (
              <>
                <div className={s.tableScroll}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        {['Contact', 'Email', 'Campaign', 'Source / Medium', 'Destination URL', 'Visited At'].map(h => <th key={h}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {utmVisits.map(v => (
                        <tr key={v.id}>
                          <td className={`${s.strong} ${s.nowrap}`}>{v.contact_name || '—'}</td>
                          <td className={`${s.muted} ${s.nowrap}`}>{v.email || '—'}</td>
                          <td><Chip tone="info">{v.utm_campaign || '—'}</Chip></td>
                          <td className={s.nowrap}>
                            {v.utm_source || '—'}
                            {v.utm_medium && <span className={s.muted}> / {v.utm_medium}</span>}
                          </td>
                          <td className={s.trunc}>
                            {v.destination_url ? (
                              <a href={v.destination_url} target="_blank" rel="noreferrer" className={s.link}>
                                <ExternalLink size={10} aria-hidden />
                                {urlPath(v.destination_url)}
                              </a>
                            ) : '—'}
                          </td>
                          <td className={`${s.nowrap} ${s.muted}`}>{new Date(v.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {utmTotal > 50 && (
                  <div className={s.pager}>
                    <div className={s.pagerInfo}>
                      Showing {(utmPage - 1) * 50 + 1}–{Math.min(utmPage * 50, utmTotal)} of {utmTotal}
                    </div>
                    <div className={s.pagerBtns}>
                      <Button size="sm" disabled={utmPage === 1} onClick={() => loadUtmData(utmPage - 1, utmSearch, utmCampaignFilter)}>← Prev</Button>
                      <Button size="sm" disabled={utmPage * 50 >= utmTotal} onClick={() => loadUtmData(utmPage + 1, utmSearch, utmCampaignFilter)}>Next →</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <EmptyState icon={<Mail size={20} />} title="No email visits yet" description="Send a test email and click a link — the UTM data will appear here." />
            )}
          </Card>
        </div>
      )}

      {/* ── DataLayer Scripts ───────────────────────────────────────────── */}
      {activeTab === 'datalayer' && (
        <div className={s.split}>
          <Card title={`Events (${Object.keys(scripts).length})`}>
            <div className={s.eventList}>
              {Object.keys(scripts).map(key => (
                <button key={key} type="button" className={s.eventItem} aria-pressed={selectedScript === key} onClick={() => setSelectedScript(key)}>
                  {key}
                </button>
              ))}
            </div>
          </Card>
          <Card
            title={selectedScript}
            actions={
              <Button size="sm" variant={copied === selectedScript ? 'primary' : 'secondary'} onClick={() => copyToClipboard(scripts[selectedScript], selectedScript)}>
                <Copy size={12} aria-hidden /> {copied === selectedScript ? 'Copied!' : 'Copy'}
              </Button>
            }
          >
            <pre className={s.code}>{scripts[selectedScript]}</pre>
          </Card>
        </div>
      )}

      {/* ── Special Occasions ───────────────────────────────────────────── */}
      {activeTab === 'occasions' && (
        occasions.length > 0 ? (
          <div className={s.occGrid}>
            {occasions.map(o => (
              <Card key={o.occasion_id}>
                <div className={s.occHead}>
                  <div>
                    <div className={s.occName}>{o.name}</div>
                    <Chip tone={occasionTones[o.occasion_type] ?? 'mute'} className={s.cap}>{o.occasion_type}</Chip>
                  </div>
                  {o.is_active && <Chip tone="ok" dot>Active</Chip>}
                </div>
                {o.campaign_theme && <p className={s.occTheme}>{o.campaign_theme}</p>}
                <div className={s.occMeta}>
                  <div><span className={s.muted}>Start:</span> {new Date(o.start_date).toLocaleDateString()}</div>
                  <div><span className={s.muted}>End:</span> {new Date(o.end_date).toLocaleDateString()}</div>
                  <div><span className={s.muted}>Coupon:</span> {o.discount_code ? <code className={s.mono}>{o.discount_code}</code> : '—'}</div>
                  <div>{o.coupon_active && <span className={s.money}>{o.discount_value}% off</span>}</div>
                  {o.target_markets && (
                    <div className={s.occWide}>
                      <span className={s.muted}>Markets:</span>{' '}
                      {(Array.isArray(o.target_markets) ? o.target_markets : typeof o.target_markets === 'string' ? o.target_markets.replace(/[{}]/g, '').split(',').filter(Boolean) : []).join(', ')}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : <Card><EmptyState icon={<Calendar size={20} />} title="No special occasions" /></Card>
      )}

      {/* ── GTM Container Snippet ───────────────────────────────────────── */}
      {activeTab === 'snippet' && snippet && (
        <div className={s.stack}>
          <Card
            title="Head Snippet (place in <head>)"
            actions={
              <Button size="sm" variant={copied === 'head' ? 'primary' : 'secondary'} onClick={() => copyToClipboard(snippet.head, 'head')}>
                <Copy size={12} aria-hidden /> {copied === 'head' ? 'Copied!' : 'Copy'}
              </Button>
            }
          >
            <pre className={s.code}>{snippet.head}</pre>
          </Card>
          <Card
            title="Body Snippet (place after <body>)"
            actions={
              <Button size="sm" variant={copied === 'body' ? 'primary' : 'secondary'} onClick={() => copyToClipboard(snippet.body, 'body')}>
                <Copy size={12} aria-hidden /> {copied === 'body' ? 'Copied!' : 'Copy'}
              </Button>
            }
          >
            <pre className={s.code}>{snippet.body}</pre>
          </Card>
        </div>
      )}
    </div>
  );
}
