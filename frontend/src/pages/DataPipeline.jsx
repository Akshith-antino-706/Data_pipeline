import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getRaynaSyncStatus, getMappingStats, triggerRaynaSync, triggerRaynaSyncEndpoint, refreshBookingMapping } from '../api';
import { RefreshCw, Database, ArrowRightLeft, CheckCircle2, XCircle, Clock, Loader2, Plane, Building2, Globe, MapPin, Phone, Mail, Users, MessageSquare, Ticket, Activity } from 'lucide-react';

const SOURCE_ICONS = { tours: MapPin, hotels: Building2, visas: Globe, flights: Plane };
const SOURCE_COLORS = { tours: 'var(--brand-primary)', hotels: 'var(--orange)', visas: 'var(--green)', flights: 'var(--red)' };

const fadeInUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } } };
const staggerContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };

function formatDate(d) {
  if (!d) return '--';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatNum(n) {
  return (n || 0).toLocaleString();
}

function StatusBadge({ status }) {
  const map = {
    success: { cls: 'badge-green', icon: CheckCircle2, label: 'Synced' },
    error: { cls: 'badge-red', icon: XCircle, label: 'Error' },
    running: { cls: 'badge-blue', icon: Loader2, label: 'Running' },
  };
  const s = map[status] || { cls: 'badge-gray', icon: Clock, label: status || 'Pending' };
  const Icon = s.icon;
  return (
    <span className={s.cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      <Icon size={13} style={status === 'running' ? { animation: 'spin 1s linear infinite' } : {}} /> {s.label}
    </span>
  );
}

export default function DataPipeline() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [mappingStats, setMappingStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [sync, mapping] = await Promise.all([getRaynaSyncStatus(), getMappingStats()]);
      setSyncStatus(sync);
      setMappingStats(mapping);
    } catch (err) {
      console.error('Failed to load pipeline data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSyncAll = async () => {
    setSyncing({ all: true });
    try {
      await triggerRaynaSync();
      await loadData();
    } catch (err) {
      console.error('Sync failed:', err);
    }
    setSyncing({});
  };

  const handleSyncOne = async (ep) => {
    setSyncing({ [ep]: true });
    try {
      await triggerRaynaSyncEndpoint(ep);
      await loadData();
    } catch (err) {
      console.error(`Sync ${ep} failed:`, err);
    }
    setSyncing(prev => ({ ...prev, [ep]: false }));
  };

  const handleRefreshMapping = async () => {
    setRefreshing(true);
    try {
      await refreshBookingMapping();
      await loadData();
    } catch (err) {
      console.error('Mapping refresh failed:', err);
    }
    setRefreshing(false);
  };

  if (loading) return <div className="spinner">Loading...</div>;

  const tables = syncStatus?.tables || [];
  const overall = mappingStats?.overall || {};
  const coverage = mappingStats?.coverage || {};
  const breakdown = mappingStats?.breakdown || [];
  const dataOverview = mappingStats?.dataOverview || {};
  const deptBreakdown = mappingStats?.deptBreakdown || [];
  const ga4Status = mappingStats?.ga4Status || [];
  const mysqlStatus = mappingStats?.mysqlStatus || [];


  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} style={{ padding: '0 0 40px' }}>
      {/* Header */}
      <motion.div variants={fadeInUp} className="card-header" style={{ marginBottom: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Data Pipeline</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            Rayna API sync, MySQL sync, and booking-customer mapping
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={loadData} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={handleSyncAll} disabled={syncing.all}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {syncing.all ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Database size={14} />}
            {syncing.all ? 'Syncing...' : 'Sync All APIs'}
          </button>
        </div>
      </motion.div>

      {/* KPI Row */}
      <motion.div variants={fadeInUp} className="kpi-strip" style={{ marginBottom: 28 }}>
        {[
          { label: 'Users', value: formatNum(dataOverview.users), color: 'var(--brand-primary)', icon: Users },
          { label: 'Travel Bookings', value: formatNum(dataOverview.travelBookings), color: 'var(--green)', icon: MapPin },
          { label: 'Tickets', value: formatNum(dataOverview.tickets), color: 'var(--orange)', icon: Ticket },
          { label: 'Chats', value: formatNum(dataOverview.chats), color: '#25D366', icon: MessageSquare },
          { label: 'Unified Data', value: formatNum(dataOverview.unifiedData), color: 'var(--red)', icon: Database },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 18px' }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: `color-mix(in srgb, ${color} 10%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Data Sources Overview */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 24, marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 18px', fontSize: 16 }}>Data Sources Overview</h3>
        <div className="kpi-strip">
          {[
            { label: 'Users', value: formatNum(dataOverview.users), sub: 'customer profiles', icon: Users, color: 'var(--brand-primary)' },
            { label: 'Unique Emails', value: formatNum(dataOverview.uniqueEmails), sub: 'verified', icon: Mail, color: 'var(--purple)' },
            { label: 'Phones', value: formatNum(dataOverview.phones), sub: 'contact numbers', icon: Phone, color: '#25D366' },
            { label: 'Departments', value: formatNum(dataOverview.departments), sub: 'active', icon: Building2, color: 'var(--brand-primary)' },
            { label: 'Dept Emails', value: formatNum(dataOverview.deptEmails), sub: 'mapped', icon: Mail, color: 'var(--orange)' },
            { label: 'Tickets', value: formatNum(dataOverview.tickets), sub: 'email tickets', icon: Ticket, color: 'var(--orange)' },
            { label: 'Travel Bookings', value: formatNum(dataOverview.travelBookings), sub: 'all sources', icon: MapPin, color: 'var(--green)' },
            { label: 'Chats', value: formatNum(dataOverview.chats), sub: 'WhatsApp', icon: MessageSquare, color: '#25D366' },
            { label: 'Tours', value: formatNum(dataOverview.tours), sub: 'from API', icon: MapPin, color: SOURCE_COLORS.tours },
            { label: 'Hotels', value: formatNum(dataOverview.hotels), sub: 'from API', icon: Building2, color: SOURCE_COLORS.hotels },
            { label: 'Visas', value: formatNum(dataOverview.visas), sub: 'from API', icon: Globe, color: SOURCE_COLORS.visas },
            { label: 'Flights', value: formatNum(dataOverview.flights), sub: 'from API', icon: Plane, color: SOURCE_COLORS.flights },
            { label: 'GA4 Events', value: formatNum(dataOverview.ga4Events), sub: `${formatNum(dataOverview.ga4Users)} users`, icon: Activity, color: 'var(--green)' },
          ].map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="card" style={{ padding: '16px 14px', textAlign: 'center' }}>
              <Icon size={20} style={{ color, marginBottom: 6 }} />
              <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
              <div style={{ fontSize: 10, color, marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* B2B vs B2C Breakdown */}
      {deptBreakdown.length > 0 && (
        <motion.div variants={fadeInUp} className="card" style={{ padding: 24, marginBottom: 28 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>B2B vs B2C Breakdown</h3>
          <div className="grid-auto">
            {deptBreakdown.map(d => (
                <div key={d.name} className="card" style={{
                  padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      <span className={`badge ${d.name === 'B2B' ? 'badge-blue' : d.name === 'B2C' ? 'badge-green' : 'badge-orange'}`} style={{ fontSize: 12 }}>
                        {d.name}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {formatNum(d.customers)} customers
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#25D366' }}>{formatNum(d.chats)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Chats</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--orange)' }}>{formatNum(d.tickets)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Tickets</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-primary)' }}>{formatNum(d.bookings)}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Bookings</div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </motion.div>
      )}

      {/* Sync Status: Rayna API + MySQL + GA4 */}
      <motion.div variants={fadeInUp} className="card-grid card-grid-3" style={{ marginBottom: 28 }}>

        {/* Rayna API Sync Status */}
        <div className="card" style={{ padding: 24 }}>
          <div className="card-header" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Rayna API Sync</h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Every 10 min</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {['tours', 'hotels', 'visas', 'flights'].map(ep => {
              const t = tables.find(r => r.table_name === `rayna_${ep}`) || {};
              const Icon = SOURCE_ICONS[ep];
              return (
                <div key={ep} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon size={18} style={{ color: SOURCE_COLORS[ep] }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{ep}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {formatNum(dataOverview[ep] || 0)} rows  |  Last: {formatDate(t.last_synced_at)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={t.sync_status} />
                    <button className="btn btn-ghost btn-sm" onClick={() => handleSyncOne(ep)} disabled={syncing[ep]}>
                      {syncing[ep] ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MySQL Sync Status */}
        <div className="card" style={{ padding: 24 }}>
          <div className="card-header" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>MySQL Sync (CRM)</h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Every 10 min</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mysqlStatus.filter(t => t.table_name.startsWith('mysql_')).map(t => (
              <div key={t.table_name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.table_name.replace('mysql_', '')}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {formatNum(t.rows_synced)} rows | {t.sync_duration_ms ? `${(t.sync_duration_ms / 1000).toFixed(1)}s` : '--'} | Last: {formatDate(t.last_synced_at)}
                  </div>
                </div>
                <StatusBadge status={t.sync_status} />
              </div>
            ))}
            {mysqlStatus.filter(t => t.table_name.startsWith('mysql_')).length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>
                No MySQL sync data yet
              </div>
            )}
          </div>
        </div>

        {/* GA4 BigQuery Sync Status */}
        <div className="card" style={{ padding: 24 }}>
          <div className="card-header" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>GA4 BigQuery Sync</h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Every 30 sec</span>
          </div>
          <div style={{
            padding: '16px 14px', borderRadius: 8, background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)', marginBottom: 12, textAlign: 'center',
          }}>
            <Activity size={24} style={{ color: 'var(--green)', marginBottom: 6 }} />
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNum(dataOverview.ga4Events)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>GA4 Events</div>
            <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4 }}>{formatNum(dataOverview.ga4Users)} unique users</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {ga4Status.length > 0 ? ga4Status.map(t => (
              <div key={t.table_name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.table_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {formatNum(t.rows_synced)} rows  |  {t.sync_duration_ms ? `${(t.sync_duration_ms / 1000).toFixed(1)}s` : '--'}  |  Last: {formatDate(t.last_synced_at)}
                  </div>
                </div>
                <StatusBadge status={t.sync_status} />
              </div>
            )) : (
              <div style={{
                padding: '12px 14px', borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)', fontSize: 12, color: 'var(--text-secondary)',
              }}>
                GA4 sync not active — set BQ_SYNC_ENABLED=true in backend .env
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Booking <-> Customer Mapping */}
      <motion.div variants={fadeInUp} className="card" style={{ padding: 24, marginBottom: 28 }}>
        <div className="card-header" style={{ marginBottom: 20 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>Booking ↔ Customer Mapping</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              Matched {formatNum(overall.totalMapped)} bookings to {formatNum(overall.customersWithBookings)} customers ({overall.matchRate || 0}% of customer base)
            </p>
          </div>
          <button className="btn btn-secondary" onClick={handleRefreshMapping} disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {refreshing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRightLeft size={14} />}
            {refreshing ? 'Refreshing...' : 'Refresh Mapping'}
          </button>
        </div>

        {/* Coverage + Match type grid */}
        <div className="card-grid card-grid-2" style={{ marginBottom: 20 }}>
          {/* Coverage bars */}
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>Coverage by Source</h4>
            {['tours', 'hotels', 'visas', 'flights'].map(src => {
              const c = coverage[src] || { total: 0, mapped: 0 };
              const pct = c.total > 0 ? ((c.mapped / c.total) * 100).toFixed(1) : 0;
              const Icon = SOURCE_ICONS[src];
              return (
                <div key={src} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                      <Icon size={14} style={{ color: SOURCE_COLORS[src] }} /> {src}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatNum(c.mapped)} / {formatNum(c.total)} ({pct}%)
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, borderRadius: 4, background: SOURCE_COLORS[src], transition: 'width 0.5s' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Match type breakdown */}
          <div>
            <h4 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-secondary)' }}>Match Method</h4>
            {breakdown.length > 0 ? breakdown.map((b, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', marginBottom: 8, borderRadius: 8, background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {b.match_type === 'phone' ? <Phone size={14} style={{ color: 'var(--brand-primary)' }} /> : <Mail size={14} style={{ color: 'var(--orange)' }} />}
                  <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                    {b.booking_source} ({b.match_type})
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{formatNum(b.matched_bookings)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{formatNum(b.unique_customers)} customers</div>
                </div>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-secondary)', fontSize: 13 }}>
                No mapping data yet. Run sync first, then refresh mapping.
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </motion.div>
  );
}
