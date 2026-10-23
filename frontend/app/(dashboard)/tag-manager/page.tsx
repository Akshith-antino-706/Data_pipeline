'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getGTMSnippet, getDataLayerScripts, getGTMAnalytics, getGTMEventDetail, getSpecialOccasions, getGTMExport } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Button, Card, Chip, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import type { ChipTone } from '@/components/ui';
import s from './page.module.css';
import { Code, Calendar, Download, Activity, Layers, Copy, Mail } from 'lucide-react';

interface GtmSnippet { head: string; body: string }
interface TopEvent { event_name: string; count: string; unique_users: string; total_value: string }
interface DailyRow { day: string; event_count?: number | string | null; unique_users?: number | string | null }
interface GtmAnalytics { daily: DailyRow[]; top_events?: TopEvent[]; range?: { from: string | null; to: string | null } }
interface EventDetail {
  event_id?: string | number; event_label?: string; event_value?: string; event_category?: string; page_url?: string;
  device_type?: string; browser?: string; city?: string; country?: string; utm_source?: string; utm_campaign?: string; created_at: string;
}
interface SpecialOccasion {
  occasion_id: string | number; occasion_type: string; name?: string; is_active?: boolean; campaign_theme?: string;
  start_date: string; end_date: string; discount_code?: string; coupon_active?: boolean; discount_value?: number | string;
  target_markets?: string[] | string;
}
type Wrapped<T> = { data?: T } & T;

type TabKey = 'overview' | 'datalayer' | 'occasions' | 'snippet';

const n0 = (v: unknown): number => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0; };
const errText = (e: unknown): string => (e instanceof Error && e.message) || 'Request failed';

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
  // Each tab loads the first time it is opened and keeps its data (null = not loaded yet).
  const [analytics, setAnalytics] = useState<GtmAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<GtmSnippet | null>(null);
  const [snippetError, setSnippetError] = useState<string | null>(null);
  const [scripts, setScripts] = useState<Record<string, string> | null>(null);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [occasions, setOccasions] = useState<SpecialOccasion[] | null>(null);
  const [occasionsError, setOccasionsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [selectedScript, setSelectedScript] = useState('page_view');
  const [copied, setCopied] = useState('');

  // Event detail state
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [eventDetails, setEventDetails] = useState<EventDetail[]>([]);
  const [eventDetailLoading, setEventDetailLoading] = useState(false);

  const loadAnalytics = useCallback(async () => {
    try {
      const ana = await getGTMAnalytics() as Wrapped<GtmAnalytics> | null;
      const data = ana?.data || ana;
      setAnalyticsError(null);
      setAnalytics({ daily: Array.isArray(data?.daily) ? data.daily : [], top_events: Array.isArray(data?.top_events) ? data.top_events : [], range: data?.range });
    } catch (err) { console.error(err); setAnalyticsError(errText(err)); }
  }, []);
  const loadScripts = useCallback(async () => {
    try {
      const scr = await getDataLayerScripts() as Wrapped<Record<string, string>> | null;
      setScriptsError(null);
      setScripts(scr?.data || scr || {});
    } catch (err) { console.error(err); setScriptsError(errText(err)); }
  }, []);
  const loadOccasions = useCallback(async () => {
    try {
      const occ = await getSpecialOccasions() as { data?: SpecialOccasion[] } | SpecialOccasion[] | null;
      setOccasionsError(null);
      setOccasions(Array.isArray(occ) ? occ : (occ?.data || []));
    } catch (err) { console.error(err); setOccasionsError(errText(err)); }
  }, []);
  const loadSnippet = useCallback(async () => {
    try {
      const snip = await getGTMSnippet() as Wrapped<GtmSnippet> | null;
      setSnippetError(null);
      setSnippet(snip?.data || snip || null);
    } catch (err) { console.error(err); setSnippetError(errText(err)); }
  }, []);

  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => {
    if (activeTab === 'datalayer' && scripts === null) void loadScripts();
    if (activeTab === 'occasions' && occasions === null) void loadOccasions();
    if (activeTab === 'snippet' && snippet === null) void loadSnippet();
  }, [activeTab, scripts, occasions, snippet, loadScripts, loadOccasions, loadSnippet]);

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

  const tabs: { id: TabKey; label: string; icon: typeof Activity }[] = [
    { id: 'overview',      label: 'Event Analytics',   icon: Activity },
    { id: 'datalayer',     label: 'DataLayer Scripts',  icon: Code },
    { id: 'occasions',     label: 'Special Occasions',  icon: Calendar },
    { id: 'snippet',       label: 'GTM Container',      icon: Layers },
  ];

  if (!analytics && !analyticsError) return <LoadingSkeleton />;
  const topEvents = analytics?.top_events ?? [];
  const daily = analytics?.daily ?? [];

  const tooltipStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--ink)', fontSize: 12 };

  return (
    <div className={s.page}>
      <PageHeader
        title="GTM & BigQuery"
        description="Google Tag Manager integration, dataLayer events, and BigQuery export"
        actions={(
          <>
            <Link href="/utm?tab=visits" className="ui-btn ui-btn--sm"><Mail size={14} aria-hidden /> Email visits</Link>
            <Button variant="primary" onClick={handleExport}><Download size={16} aria-hidden /> Export to BigQuery</Button>
          </>
        )}
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
            </span>
          ),
        }))}
      />

      {/* ── Event Analytics ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && analyticsError && (
        <Card><ErrorState title="Couldn't load event analytics" description={analyticsError} action={<Button size="sm" onClick={() => { setAnalyticsError(null); void loadAnalytics(); }}>Try again</Button>} /></Card>
      )}
      {activeTab === 'overview' && !analyticsError && (
        <div className={s.stack}>
          {topEvents.length > 0 && (
            <div className={s.kpis}>
              {topEvents.map(e => (
                <button key={e.event_name} type="button" className={s.kpiBtn} aria-pressed={selectedEvent === e.event_name} onClick={() => loadEventDetail(e.event_name)}>
                  <span className={s.kpiLabel}>{e.event_name}</span>
                  <span className={s.kpiValue}>{n0(e.count).toLocaleString()}</span>
                  <span className={s.kpiSub}>{n0(e.unique_users).toLocaleString()} unique users</span>
                  {n0(e.total_value) > 0 && <span className={s.kpiMoney}>AED {n0(e.total_value).toFixed(0)}</span>}
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

          <Card title="Daily event volume" actions={<Chip tone="mute">Last 30 days</Chip>}>
            {daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={daily.map(d => ({ day: d.day, event_count: n0(d.event_count), unique_users: n0(d.unique_users) }))}>
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

      {/* ── DataLayer Scripts ───────────────────────────────────────────── */}
      {activeTab === 'datalayer' && scriptsError && (
        <Card><ErrorState title="Couldn't load dataLayer scripts" description={scriptsError} action={<Button size="sm" onClick={() => { setScriptsError(null); void loadScripts(); }}>Try again</Button>} /></Card>
      )}
      {activeTab === 'datalayer' && !scriptsError && scripts === null && (
        <div className={s.split} aria-busy="true" aria-label="Loading dataLayer scripts">
          <Card><div className={s.eventList}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={30} />)}</div></Card>
          <Card><Skeleton height={220} /></Card>
        </div>
      )}
      {activeTab === 'datalayer' && scripts !== null && (
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
      {activeTab === 'occasions' && occasionsError && (
        <Card><ErrorState title="Couldn't load special occasions" description={occasionsError} action={<Button size="sm" onClick={() => { setOccasionsError(null); void loadOccasions(); }}>Try again</Button>} /></Card>
      )}
      {activeTab === 'occasions' && !occasionsError && occasions === null && (
        <div className={s.occGrid} aria-busy="true" aria-label="Loading special occasions">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i}><Skeleton height={120} /></Card>)}
        </div>
      )}
      {activeTab === 'occasions' && occasions !== null && (
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
      {activeTab === 'snippet' && snippetError && (
        <Card><ErrorState title="Couldn't load the GTM container snippet" description={snippetError} action={<Button size="sm" onClick={() => { setSnippetError(null); void loadSnippet(); }}>Try again</Button>} /></Card>
      )}
      {activeTab === 'snippet' && !snippetError && snippet === null && (
        <div className={s.stack} aria-busy="true" aria-label="Loading GTM snippet"><Card><Skeleton height={140} /></Card><Card><Skeleton height={100} /></Card></div>
      )}
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
